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

console.log('================================================================');
console.log(' RESOLVE AI — ATTACHMENT DOWNLOAD SECURITY & FIDELITY TEST');
console.log(' Tests: PNG, JPEG, WebP downloads, SHA-256 byte-for-byte fidelity,');
console.log('        customer authorization, cross-customer 403 rejection,');
console.log('        seeded sample attachments, and ephemeral disk wipe survival');
console.log('================================================================\n');

async function runAttachmentDownloadSecuritySuite() {
  const PG_PORT = 54332;
  const pgModule = await import('embedded-postgres');
  const EmbeddedPostgres = pgModule.default || pgModule;
  const pgInstancePath = path.join(ROOT_DIR, 'server/data/pg16_attachment_sec_test');
  
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
  console.log(`[PG16] Dedicated PostgreSQL test cluster active on port ${PG_PORT}`);

  const testDbUrl = `postgresql://postgres:password@127.0.0.1:${PG_PORT}/postgres?sslmode=disable`;
  process.env.DATABASE_URL = testDbUrl;
  process.env.NODE_ENV = 'production';
  await closePool();

  // 1. Run migrations (001, 002, 003, 004)
  console.log('\n--- 1. Applying Forward Migrations 001 - 004 ---');
  await runMigration();
  console.log('[PASS] Schema, seeds, blob storage, and sample attachment migrations applied.');

  // Verify Migration 004 seeded sample attachment
  const sampleCheck = await query(`
    SELECT id, brand_id, ticket_id, customer_id, file_name, mime_type, file_size_bytes, file_data 
    FROM attachments 
    WHERE id = 'att_seed_sample_nc1023'
  `);
  if (sampleCheck.rows.length === 0 || !sampleCheck.rows[0].file_data) {
    throw new Error('Migration 004 failed to seed sample attachment row with BYTEA payload');
  }
  const sampleRow = sampleCheck.rows[0];
  const sampleHash = crypto.createHash('sha256').update(sampleRow.file_data).digest('hex');
  console.log(`[PASS] Verified Seeded Sample Attachment: ID=${sampleRow.id}, file=${sampleRow.file_name}, size=${sampleRow.file_size_bytes}B, SHA-256=${sampleHash}`);

  // 2. Boot production application server
  const TEST_PORT = 5012;
  let serverProc = spawn('node', ['server/src/server.js'], {
    cwd: ROOT_DIR,
    stdio: 'pipe',
    env: { ...process.env, PORT: String(TEST_PORT), DATABASE_URL: testDbUrl, NODE_ENV: 'production' }
  });

  try {
    let ready = false;
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 400));
      try {
        const h = await axios.get(`http://127.0.0.1:${TEST_PORT}/api/health`, { timeout: 1000 });
        if (h.status === 200) { ready = true; break; }
      } catch (e) {}
    }
    if (!ready) throw new Error('Production test server failed to start within timeout');
    console.log(`[PASS] Resolve AI production server listening on port ${TEST_PORT}`);

    // =========================================================================
    // SECTION A: SEEDED SAMPLE ATTACHMENT TESTS
    // =========================================================================
    console.log('\n--- SECTION A: Seeded Sample Attachment Download & Security ---');

    // A1: Agent download of sample attachment
    console.log('Testing A1: Authorized Agent (Sarah Lin) download of sample attachment...');
    const agentSampleRes = await axios.get(`http://127.0.0.1:${TEST_PORT}/api/attachments/att_seed_sample_nc1023/download`, {
      headers: {
        'X-Agent-Id': 'user_sarah_lin',
        'X-Brand-Id': 'brand_novacart'
      },
      responseType: 'arraybuffer'
    });
    if (agentSampleRes.status !== 200) throw new Error(`Agent sample download failed: status ${agentSampleRes.status}`);
    const agentSampleBuf = Buffer.from(agentSampleRes.data);
    const agentSampleHash = crypto.createHash('sha256').update(agentSampleBuf).digest('hex');
    if (agentSampleHash !== sampleHash) throw new Error(`Agent downloaded sample hash mismatch: ${agentSampleHash} vs ${sampleHash}`);
    const agentDisp = agentSampleRes.headers['content-disposition'];
    if (!agentDisp || !agentDisp.includes('attachment') || !agentDisp.includes('wrong_wired_earphones_nc1023.png')) {
      throw new Error(`Content-Disposition header invalid: ${agentDisp}`);
    }
    console.log(`[PASS] Agent downloaded sample attachment bit-for-bit (SHA-256=${agentSampleHash}) with Content-Disposition="${agentDisp}"`);

    // A2: Authorized Customer (Kabir Verma) download of own sample attachment
    console.log('Testing A2: Authorized Customer (Kabir Verma) download of own sample attachment...');
    const custKabirRes = await axios.get(`http://127.0.0.1:${TEST_PORT}/api/attachments/att_seed_sample_nc1023/download`, {
      headers: {
        'X-Customer-Id': 'cust_kabir',
        'X-Brand-Id': 'brand_novacart'
      },
      responseType: 'arraybuffer'
    });
    if (custKabirRes.status !== 200) throw new Error(`Customer Kabir sample download failed: status ${custKabirRes.status}`);
    const custKabirBuf = Buffer.from(custKabirRes.data);
    const custKabirHash = crypto.createHash('sha256').update(custKabirBuf).digest('hex');
    if (custKabirHash !== sampleHash) throw new Error(`Customer Kabir downloaded sample hash mismatch`);
    console.log(`[PASS] Customer Kabir downloaded own sample attachment bit-for-bit (SHA-256=${custKabirHash})`);

    // A3: Cross-customer unauthorized attempt (Priya Mehta attempting to download Kabir's attachment)
    console.log('Testing A3: Unauthorized Customer (Priya Mehta) cross-customer download attempt...');
    let priyaCrossRejected = false;
    try {
      await axios.get(`http://127.0.0.1:${TEST_PORT}/api/attachments/att_seed_sample_nc1023/download`, {
        headers: {
          'X-Customer-Id': 'cust_priya',
          'X-Brand-Id': 'brand_novacart'
        }
      });
    } catch (err) {
      if (err.response && err.response.status === 403) {
        priyaCrossRejected = true;
        console.log(`[PASS] Cross-customer download rejected with HTTP 403 Forbidden: "${err.response.data.error}"`);
      } else {
        throw new Error(`Unexpected error on cross-customer test: ${err.message}`);
      }
    }
    if (!priyaCrossRejected) throw new Error('SECURITY VIOLATION: Cross-customer download was permitted!');

    // A4: Cross-customer unauthorized attempt (Aarav Sharma attempting to download Kabir's attachment)
    console.log('Testing A4: Unauthorized Customer (Aarav Sharma) cross-customer download attempt...');
    let aaravCrossRejected = false;
    try {
      await axios.get(`http://127.0.0.1:${TEST_PORT}/api/attachments/att_seed_sample_nc1023/download`, {
        headers: {
          'X-Customer-Id': 'cust_aarav',
          'X-Brand-Id': 'brand_novacart'
        }
      });
    } catch (err) {
      if (err.response && err.response.status === 403) {
        aaravCrossRejected = true;
        console.log(`[PASS] Cross-customer download rejected with HTTP 403 Forbidden: "${err.response.data.error}"`);
      }
    }
    if (!aaravCrossRejected) throw new Error('SECURITY VIOLATION: Aarav was able to download Kabir\'s attachment!');

    // =========================================================================
    // SECTION B: PNG, JPEG, WEBP UPLOAD & DOWNLOAD FIDELITY TESTS
    // =========================================================================
    console.log('\n--- SECTION B: Upload & Download Fidelity for PNG, JPEG, and WebP ---');

    // B1: PNG Attachment
    console.log('Testing B1: PNG Upload & Download (Customer Aarav Sharma - Shoes Defect)...');
    const pngHeader = Buffer.from('89504e470d0a1a0a0000000d494844520000000200000002080600000072b60d24', 'hex');
    const pngPayload = crypto.randomBytes(2048);
    const pngBuffer = Buffer.concat([pngHeader, pngPayload]);
    const pngHash = crypto.createHash('sha256').update(pngBuffer).digest('hex');

    const pngUpload = await axios.post(`http://127.0.0.1:${TEST_PORT}/api/attachments/upload`, pngBuffer, {
      headers: {
        'Content-Type': 'image/png',
        'X-File-Name': 'cracked_sole_nc1021.png',
        'X-Ticket-Id': 'tkt_1021',
        'X-Brand-Id': 'brand_novacart',
        'X-Customer-Id': 'cust_aarav'
      }
    });
    if (!pngUpload.data.success) throw new Error('PNG upload failed');
    const pngId = pngUpload.data.attachment.id;

    // Download PNG as agent
    const pngAgentRes = await axios.get(`http://127.0.0.1:${TEST_PORT}/api/attachments/${pngId}/download`, {
      headers: { 'X-Agent-Id': 'user_sarah_lin', 'X-Brand-Id': 'brand_novacart' },
      responseType: 'arraybuffer'
    });
    const pngAgentHash = crypto.createHash('sha256').update(Buffer.from(pngAgentRes.data)).digest('hex');
    if (pngAgentHash !== pngHash) throw new Error('PNG agent download hash mismatch');
    if (!pngAgentRes.headers['content-disposition'].includes('cracked_sole_nc1021.png')) {
      throw new Error('PNG Content-Disposition filename mismatch');
    }
    console.log(`[PASS] PNG download matches byte-for-byte (SHA-256=${pngAgentHash})`);

    // Download PNG as customer Aarav
    const pngCustRes = await axios.get(`http://127.0.0.1:${TEST_PORT}/api/attachments/${pngId}/download`, {
      headers: { 'X-Customer-Id': 'cust_aarav', 'X-Brand-Id': 'brand_novacart' },
      responseType: 'arraybuffer'
    });
    const pngCustHash = crypto.createHash('sha256').update(Buffer.from(pngCustRes.data)).digest('hex');
    if (pngCustHash !== pngHash) throw new Error('PNG customer download hash mismatch');
    console.log('[PASS] Customer Aarav successfully downloaded own PNG attachment');

    // Reject cross-customer download of PNG
    let pngCrossRejected = false;
    try {
      await axios.get(`http://127.0.0.1:${TEST_PORT}/api/attachments/${pngId}/download`, {
        headers: { 'X-Customer-Id': 'cust_kabir', 'X-Brand-Id': 'brand_novacart' }
      });
    } catch (e) {
      if (e.response?.status === 403) pngCrossRejected = true;
    }
    if (!pngCrossRejected) throw new Error('Cross-customer access to PNG was not blocked!');
    console.log('[PASS] Cross-customer download of PNG blocked with HTTP 403');

    // B2: JPEG Attachment
    console.log('\nTesting B2: JPEG Upload & Download (Customer Priya Mehta - Watch Scratch)...');
    const jpegHeader = Buffer.from('ffd8ffe000104a46494600010101006000600000', 'hex');
    const jpegPayload = crypto.randomBytes(3072);
    const jpegBuffer = Buffer.concat([jpegHeader, jpegPayload]);
    const jpegHash = crypto.createHash('sha256').update(jpegBuffer).digest('hex');

    const jpegUpload = await axios.post(`http://127.0.0.1:${TEST_PORT}/api/attachments/upload`, jpegBuffer, {
      headers: {
        'Content-Type': 'image/jpeg',
        'X-File-Name': 'smartwatch_scratch_nc1022.jpeg',
        'X-Ticket-Id': 'tkt_1022',
        'X-Brand-Id': 'brand_novacart',
        'X-Customer-Id': 'cust_priya'
      }
    });
    if (!jpegUpload.data.success) throw new Error('JPEG upload failed');
    const jpegId = jpegUpload.data.attachment.id;

    // Download JPEG as agent
    const jpegAgentRes = await axios.get(`http://127.0.0.1:${TEST_PORT}/api/attachments/${jpegId}/download`, {
      headers: { 'X-Agent-Id': 'user_sarah_lin', 'X-Brand-Id': 'brand_novacart' },
      responseType: 'arraybuffer'
    });
    const jpegAgentHash = crypto.createHash('sha256').update(Buffer.from(jpegAgentRes.data)).digest('hex');
    if (jpegAgentHash !== jpegHash) throw new Error('JPEG agent download hash mismatch');
    if (!jpegAgentRes.headers['content-disposition'].includes('smartwatch_scratch_nc1022.jpeg')) {
      throw new Error('JPEG Content-Disposition filename mismatch');
    }
    console.log(`[PASS] JPEG download matches byte-for-byte (SHA-256=${jpegAgentHash})`);

    // Download JPEG as customer Priya
    const jpegCustRes = await axios.get(`http://127.0.0.1:${TEST_PORT}/api/attachments/${jpegId}/download`, {
      headers: { 'X-Customer-Id': 'cust_priya', 'X-Brand-Id': 'brand_novacart' },
      responseType: 'arraybuffer'
    });
    const jpegCustHash = crypto.createHash('sha256').update(Buffer.from(jpegCustRes.data)).digest('hex');
    if (jpegCustHash !== jpegHash) throw new Error('JPEG customer download hash mismatch');
    console.log('[PASS] Customer Priya successfully downloaded own JPEG attachment');

    // Reject cross-customer download of JPEG
    let jpegCrossRejected = false;
    try {
      await axios.get(`http://127.0.0.1:${TEST_PORT}/api/attachments/${jpegId}/download`, {
        headers: { 'X-Customer-Id': 'cust_aarav', 'X-Brand-Id': 'brand_novacart' }
      });
    } catch (e) {
      if (e.response?.status === 403) jpegCrossRejected = true;
    }
    if (!jpegCrossRejected) throw new Error('Cross-customer access to JPEG was not blocked!');
    console.log('[PASS] Cross-customer download of JPEG blocked with HTTP 403');

    // B3: WebP Attachment
    console.log('\nTesting B3: WebP Upload & Download (Customer Kabir Verma - Package Barcode)...');
    const webpHeader = Buffer.from('5249464624000000574542505650382018000000', 'hex');
    const webpPayload = crypto.randomBytes(1536);
    const webpBuffer = Buffer.concat([webpHeader, webpPayload]);
    const webpHash = crypto.createHash('sha256').update(webpBuffer).digest('hex');

    const webpUpload = await axios.post(`http://127.0.0.1:${TEST_PORT}/api/attachments/upload`, webpBuffer, {
      headers: {
        'Content-Type': 'image/webp',
        'X-File-Name': 'package_barcode_nc1023.webp',
        'X-Ticket-Id': 'tkt_1023',
        'X-Brand-Id': 'brand_novacart',
        'X-Customer-Id': 'cust_kabir'
      }
    });
    if (!webpUpload.data.success) throw new Error('WebP upload failed');
    const webpId = webpUpload.data.attachment.id;

    // Download WebP as agent
    const webpAgentRes = await axios.get(`http://127.0.0.1:${TEST_PORT}/api/attachments/${webpId}/download`, {
      headers: { 'X-Agent-Id': 'user_sarah_lin', 'X-Brand-Id': 'brand_novacart' },
      responseType: 'arraybuffer'
    });
    const webpAgentHash = crypto.createHash('sha256').update(Buffer.from(webpAgentRes.data)).digest('hex');
    if (webpAgentHash !== webpHash) throw new Error('WebP agent download hash mismatch');
    if (!webpAgentRes.headers['content-disposition'].includes('package_barcode_nc1023.webp')) {
      throw new Error('WebP Content-Disposition filename mismatch');
    }
    console.log(`[PASS] WebP download matches byte-for-byte (SHA-256=${webpAgentHash})`);

    // Download WebP as customer Kabir
    const webpCustRes = await axios.get(`http://127.0.0.1:${TEST_PORT}/api/attachments/${webpId}/download`, {
      headers: { 'X-Customer-Id': 'cust_kabir', 'X-Brand-Id': 'brand_novacart' },
      responseType: 'arraybuffer'
    });
    const webpCustHash = crypto.createHash('sha256').update(Buffer.from(webpCustRes.data)).digest('hex');
    if (webpCustHash !== webpHash) throw new Error('WebP customer download hash mismatch');
    console.log('[PASS] Customer Kabir successfully downloaded own WebP attachment');

    // =========================================================================
    // SECTION C: EDGE CASES (404 NOT FOUND & UNAUTHENTICATED REQUESTS)
    // =========================================================================
    console.log('\n--- SECTION C: Edge Cases (404 Not Found & Unauthenticated Requests) ---');

    // C1: Nonexistent attachment ID -> 404
    let nonexistent404 = false;
    try {
      await axios.get(`http://127.0.0.1:${TEST_PORT}/api/attachments/att_nonexistent_9999/download`, {
        headers: { 'X-Agent-Id': 'user_sarah_lin', 'X-Brand-Id': 'brand_novacart' }
      });
    } catch (e) {
      if (e.response?.status === 404) nonexistent404 = true;
    }
    if (!nonexistent404) throw new Error('Non-existent attachment did not return HTTP 404');
    console.log('[PASS] Non-existent attachment correctly returned HTTP 404 Not Found');

    // C2: Soft-deleted attachment -> 404
    await query(`UPDATE attachments SET deleted_at = NOW() WHERE id = $1`, [pngId]);
    let deleted404 = false;
    try {
      await axios.get(`http://127.0.0.1:${TEST_PORT}/api/attachments/${pngId}/download`, {
        headers: { 'X-Agent-Id': 'user_sarah_lin', 'X-Brand-Id': 'brand_novacart' }
      });
    } catch (e) {
      if (e.response?.status === 404) deleted404 = true;
    }
    if (!deleted404) throw new Error('Soft-deleted attachment was served');
    console.log('[PASS] Soft-deleted attachment correctly returned HTTP 404 Not Found');

    // C3: Unauthenticated request in production -> 403
    let unauthenticated403 = false;
    try {
      await axios.get(`http://127.0.0.1:${TEST_PORT}/api/attachments/${jpegId}/download`);
    } catch (e) {
      if (e.response?.status === 403) unauthenticated403 = true;
    }
    if (!unauthenticated403) throw new Error('Unauthenticated download was not blocked with 403 in production!');
    console.log('[PASS] Unauthenticated download request correctly blocked with HTTP 403 Forbidden');

    // =========================================================================
    // SECTION D: SIMULATING RENDER FREE EPHEMERAL DISK WIPE & RECOVERY
    // =========================================================================
    console.log('\n--- SECTION D: Ephemeral Container Destruction & Database BYTEA Recovery ---');
    console.log('Terminating server and wiping uploads/ directory to simulate container recycle...');
    serverProc.kill('SIGTERM');
    await new Promise(r => setTimeout(r, 1000));

    const uploadsDir = path.join(ROOT_DIR, 'uploads');
    if (fs.existsSync(uploadsDir)) {
      fs.rmSync(uploadsDir, { recursive: true, force: true });
      console.log('[Disk Wiped]: Deleted local uploads directory.');
    }

    // Restart server from fresh ephemeral state
    console.log('Restarting server process...');
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
    if (!ready) throw new Error('Restarted server failed to boot');
    console.log('[PASS] Restarted server instance is operational');

    // Download WebP attachment after container wipe
    const postWipeRes = await axios.get(`http://127.0.0.1:${TEST_PORT}/api/attachments/${webpId}/download`, {
      headers: { 'X-Agent-Id': 'user_sarah_lin', 'X-Brand-Id': 'brand_novacart' },
      responseType: 'arraybuffer'
    });
    const postWipeHash = crypto.createHash('sha256').update(Buffer.from(postWipeRes.data)).digest('hex');
    if (postWipeHash !== webpHash) {
      throw new Error(`Hash mismatch after disk wipe! ${postWipeHash} vs original ${webpHash}`);
    }
    console.log(`[PASS] Attachment survived ephemeral container wipe: Downloaded SHA-256 matches original bit-for-bit (${postWipeHash})`);

    // Download Seeded Sample attachment after container wipe
    const postWipeSampleRes = await axios.get(`http://127.0.0.1:${TEST_PORT}/api/attachments/att_seed_sample_nc1023/download`, {
      headers: { 'X-Agent-Id': 'user_sarah_lin', 'X-Brand-Id': 'brand_novacart' },
      responseType: 'arraybuffer'
    });
    const postWipeSampleHash = crypto.createHash('sha256').update(Buffer.from(postWipeSampleRes.data)).digest('hex');
    if (postWipeSampleHash !== sampleHash) {
      throw new Error(`Seeded sample hash mismatch after disk wipe!`);
    }
    console.log(`[PASS] Seeded sample attachment survived ephemeral container wipe: SHA-256 matches bit-for-bit (${postWipeSampleHash})`);

    console.log('\n================================================================');
    console.log(' ALL ATTACHMENT DOWNLOAD SECURITY & FIDELITY CHECKS PASSED (100%)');
    console.log('================================================================\n');
  } finally {
    if (serverProc) {
      serverProc.kill('SIGTERM');
    }
    await closePool();
    await pg.stop();
    console.log('[PG16] Test cluster stopped cleanly.');
  }
}

runAttachmentDownloadSecuritySuite().catch(err => {
  console.error('\n[TEST FAILED]:', err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
