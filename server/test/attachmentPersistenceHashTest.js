import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import axios from 'axios';
import { spawn } from 'child_process';
import { query, closePool } from '../src/db/pool.js';
import { runMigration } from '../src/db/migrate.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');

console.log('=== [ATTACHMENT PERSISTENCE & SHA-256 CONTENT HASH TEST] ===');
console.log('Testing: Upload -> BYTEA storage -> Ephemeral disk wipe -> Server restart -> Download hash match\n');

async function testAttachmentPersistence() {
  const PG_PORT = 54331;
  const pgModule = await import('embedded-postgres');
  const EmbeddedPostgres = pgModule.default || pgModule;
  const pgInstancePath = path.join(ROOT_DIR, 'server/data/pg16_attachment_hash_test');
  if (fs.existsSync(pgInstancePath)) {
    fs.rmSync(pgInstancePath, { recursive: true, force: true });
  }

  const pg = new EmbeddedPostgres({
    port: PG_PORT,
    databaseDir: pgInstancePath,
    user: 'postgres',
    password: 'password'
  });

  await pg.initialise();
  await pg.start();
  console.log(`[PG16] Spawner cluster listening on port ${PG_PORT}`);

  const testDbUrl = `postgresql://postgres:password@127.0.0.1:${PG_PORT}/postgres?sslmode=disable`;
  process.env.DATABASE_URL = testDbUrl;
  process.env.NODE_ENV = 'production';

  // 1. Run migrations
  await runMigration();
  console.log('[PASS] Migrations 001, 002, 003 applied');

  // 2. Spawn application server
  const TEST_PORT = 5009;
  let serverProc = spawn('node', ['server/src/server.js'], {
    cwd: ROOT_DIR,
    stdio: 'pipe',
    env: { ...process.env, PORT: String(TEST_PORT), DATABASE_URL: testDbUrl, NODE_ENV: 'production' }
  });

  try {
    // Wait for server ready
    let ready = false;
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 400));
      try {
        const h = await axios.get(`http://127.0.0.1:${TEST_PORT}/api/health`, { timeout: 1000 });
        if (h.status === 200) { ready = true; break; }
      } catch (e) {}
    }
    if (!ready) throw new Error('Server failed to start');
    console.log('[PASS] Production server running on port', TEST_PORT);

    // 3. Create authentic test PNG image with random entropy
    const pngHeader = Buffer.from('89504e470d0a1a0a0000000d494844520000000200000002080600000072b60d24', 'hex');
    const randomPayload = crypto.randomBytes(1024); // 1KB sample payload
    const testImageBuffer = Buffer.concat([pngHeader, randomPayload]);
    const originalHash = crypto.createHash('sha256').update(testImageBuffer).digest('hex');
    console.log(`[Original Image]: Size = ${testImageBuffer.length} bytes, SHA-256 = ${originalHash}`);

    // 4. Upload image via /api/attachments/upload
    const uploadRes = await axios.post(`http://127.0.0.1:${TEST_PORT}/api/attachments/upload`, testImageBuffer, {
      headers: {
        'Content-Type': 'image/png',
        'X-File-Name': 'damage_proof_nc1021.png',
        'X-Ticket-Id': 'tkt_1021',
        'X-Brand-Id': 'brand_novacart',
        'X-Customer-Id': 'cust_aarav'
      }
    });

    if (uploadRes.status !== 200 || !uploadRes.data.success) {
      throw new Error(`Upload failed: ${JSON.stringify(uploadRes.data)}`);
    }

    const attachmentId = uploadRes.data.attachment.id;
    console.log('[PASS] Upload succeeded. Generated Attachment ID:', attachmentId);

    // 5. Query PostgreSQL directly to verify BYTEA column
    const dbRes = await query('SELECT id, file_name, mime_type, file_size_bytes, file_data FROM attachments WHERE id = $1', [attachmentId]);
    const dbRow = dbRes.rows[0];
    if (!dbRow || !dbRow.file_data) {
      throw new Error('Database record missing or file_data BYTEA column is NULL');
    }

    const dbDataHash = crypto.createHash('sha256').update(dbRow.file_data).digest('hex');
    console.log(`[PostgreSQL BYTEA]: Size = ${dbRow.file_data.length} bytes, SHA-256 = ${dbDataHash}`);
    if (dbDataHash !== originalHash) {
      throw new Error(`BYTEA hash mismatch! DB: ${dbDataHash}, Original: ${originalHash}`);
    }
    console.log('[PASS] PostgreSQL BYTEA matches original image SHA-256 bit-for-bit');

    // 6. Simulate container destruction: Stop server and WIPE local uploads directory completely!
    console.log('\n--- 6. Simulating Render Free Ephemeral Container Destruction ---');
    serverProc.kill('SIGTERM');
    await new Promise(r => setTimeout(r, 1000));

    const uploadsDir = path.join(ROOT_DIR, 'uploads');
    if (fs.existsSync(uploadsDir)) {
      fs.rmSync(uploadsDir, { recursive: true, force: true });
      console.log('[Ephemeral Disk Wiped]: Removed all files in uploads/ directory (simulating container cycle)');
    }

    // 7. Restart server
    console.log('--- 7. Starting New Server Process from Ephemeral State ---');
    serverProc = spawn('node', ['server/src/server.js'], {
      cwd: ROOT_DIR,
      stdio: 'pipe',
      env: { ...process.env, PORT: String(TEST_PORT), DATABASE_URL: testDbUrl, NODE_ENV: 'production' }
    });

    ready = false;
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 400));
      try {
        const h = await axios.get(`http://127.0.0.1:${TEST_PORT}/api/health`, { timeout: 1000 });
        if (h.status === 200) { ready = true; break; }
      } catch (e) {}
    }
    if (!ready) throw new Error('Restarted server failed to start');
    console.log('[PASS] New server instance booted successfully');

    // 8. Download the attachment via /api/attachments/:id/download
    console.log('\n--- 8. Downloading Attachment via HTTP API ---');
    const downloadRes = await axios.get(`http://127.0.0.1:${TEST_PORT}/api/attachments/${attachmentId}/download`, {
      responseType: 'arraybuffer'
    });

    if (downloadRes.status !== 200) {
      throw new Error(`Download failed with status ${downloadRes.status}`);
    }

    const downloadedBuffer = Buffer.from(downloadRes.data);
    const downloadedHash = crypto.createHash('sha256').update(downloadedBuffer).digest('hex');
    console.log(`[Downloaded Buffer]: Size = ${downloadedBuffer.length} bytes, SHA-256 = ${downloadedHash}`);

    if (downloadedHash !== originalHash) {
      throw new Error(`Downloaded image hash mismatch! Downloaded: ${downloadedHash}, Original: ${originalHash}`);
    }
    console.log('[PASS] Downloaded image SHA-256 EXACTLY MATCHES original hash after ephemeral disk wipe');

    // 9. Database Storage Capacity Monitoring against 1 GB Free Limit
    console.log('\n--- 9. Database Capacity Monitoring against Render 1 GB Limit ---');
    const sizeRes = await query(`
      SELECT 
        pg_size_pretty(pg_database_size(current_database())) as total_db_size,
        pg_database_size(current_database()) as total_bytes,
        pg_size_pretty(pg_total_relation_size('attachments')) as attachments_table_size,
        pg_total_relation_size('attachments') as attachments_bytes
    `);

    const stats = sizeRes.rows[0];
    const totalBytes = parseInt(stats.total_bytes);
    const limitBytes = 1024 * 1024 * 1024; // 1 GB
    const usedPercentage = ((totalBytes / limitBytes) * 100).toFixed(4);
    const remainingMb = ((limitBytes - totalBytes) / (1024 * 1024)).toFixed(2);

    console.log(`Current Total Database Size: ${stats.total_db_size} (${totalBytes} bytes)`);
    console.log(`Attachments Table Size: ${stats.attachments_table_size} (${stats.attachments_bytes} bytes)`);
    console.log(`Render Free Tier Quota: 1.00 GB (${limitBytes} bytes)`);
    console.log(`Quota Used: ${usedPercentage}%`);
    console.log(`Remaining Capacity: ${remainingMb} MB`);

    console.log('\n=================================================================');
    console.log('ALL ATTACHMENT PERSISTENCE & SHA-256 HASH CHECKS PASSED');
    console.log('=================================================================');
  } finally {
    if (serverProc) serverProc.kill('SIGTERM');
    await closePool();
    await pg.stop();
  }
}

testAttachmentPersistence().catch(err => {
  console.error('[ATTACHMENT PERSISTENCE TEST FAILED]:', err);
  process.exit(1);
});
