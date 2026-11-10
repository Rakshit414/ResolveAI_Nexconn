import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { runMigration } from '../src/db/migrate.js';
import { closePool } from '../src/db/pool.js';
import { exportDatabaseBackup, restoreDatabaseBackup } from '../scripts/backupAndRestore.js';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');

console.log('=== [EXTERNAL DATABASE BACKUP & RESTORE INTEGRATION TEST] ===');

async function testExternalBackupAndRestore() {
  const pgModule = await import('embedded-postgres');
  const EmbeddedPostgres = pgModule.default || pgModule;

  // 1. Source Database on Port 54332
  const SRC_PORT = 54332;
  const srcPath = path.join(ROOT_DIR, 'server/data/pg16_src_backup_test');
  if (fs.existsSync(srcPath)) fs.rmSync(srcPath, { recursive: true, force: true });

  const srcPg = new EmbeddedPostgres({
    port: SRC_PORT,
    databaseDir: srcPath,
    user: 'postgres',
    password: 'password'
  });
  await srcPg.initialise();
  await srcPg.start();
  console.log(`[Source DB] Running on port ${SRC_PORT}`);
  const srcUrl = `postgresql://postgres:password@127.0.0.1:${SRC_PORT}/postgres?sslmode=disable`;

  // 2. Destination Database on Port 54333
  const DEST_PORT = 54333;
  const destPath = path.join(ROOT_DIR, 'server/data/pg16_dest_backup_test');
  if (fs.existsSync(destPath)) fs.rmSync(destPath, { recursive: true, force: true });

  const destPg = new EmbeddedPostgres({
    port: DEST_PORT,
    databaseDir: destPath,
    user: 'postgres',
    password: 'password'
  });
  await destPg.initialise();
  await destPg.start();
  console.log(`[Destination DB] Running on port ${DEST_PORT}`);
  const destUrl = `postgresql://postgres:password@127.0.0.1:${DEST_PORT}/postgres?sslmode=disable`;

  const srcPool = new Pool({ connectionString: srcUrl });
  const destPool = new Pool({ connectionString: destUrl });

  try {
    // 3. Migrate and seed Source DB
    process.env.DATABASE_URL = srcUrl;
    process.env.NODE_ENV = 'production';
    await runMigration();
    console.log('[PASS] Source DB migrated and seeded');

    // Add sample attachment with BYTEA
    const sampleAttachmentId = 'att_backup_test_01';
    const sampleBytes = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489', 'hex');
    const sampleHash = crypto.createHash('sha256').update(sampleBytes).digest('hex');

    await srcPool.query(`
      INSERT INTO attachments (id, brand_id, ticket_id, customer_id, storage_key, file_name, mime_type, file_size_bytes, file_data)
      VALUES ($1, 'brand_novacart', 'tkt_1021', 'cust_aarav', 'brands/brand_novacart/tickets/tkt_1021/test.png', 'test.png', 'image/png', $2, $3)
    `, [sampleAttachmentId, sampleBytes.length, sampleBytes]);

    // 4. Execute external export to user home directory (OUTSIDE Render & OUTSIDE git workspace)
    const externalBackupDir = path.join(os.homedir(), '.resolve_ai_backups_test');
    if (!fs.existsSync(externalBackupDir)) fs.mkdirSync(externalBackupDir, { recursive: true });

    const backupFile = path.join(externalBackupDir, 'resolve_ai_verified_external_backup.sql');
    const exportResult = await exportDatabaseBackup(backupFile, srcUrl);

    if (!exportResult.success || !fs.existsSync(backupFile)) {
      throw new Error('Export failed to create external backup file');
    }
    console.log('[PASS] External backup created outside project repository at:', backupFile);
    console.log('[PASS] Backup file size:', fs.statSync(backupFile).size, 'bytes');

    // 5. Restore backup into Destination DB (which has schema applied)
    // First run DDL on destination so schema exists
    await closePool();
    process.env.DATABASE_URL = destUrl;
    await runMigration();

    // Now restore data from external backup
    await restoreDatabaseBackup(backupFile, destUrl);
    console.log('[PASS] Restored external backup into independent destination database');

    // 6. Verify 17 tables, records, relationships and attachment BYTEA data in Destination DB
    const destAuditRes = await destPool.query(`
      SELECT 
        (SELECT COUNT(*) FROM brands) as brands,
        (SELECT COUNT(*) FROM users) as users,
        (SELECT COUNT(*) FROM brand_memberships) as memberships,
        (SELECT COUNT(*) FROM customers) as customers,
        (SELECT COUNT(*) FROM orders) as orders,
        (SELECT COUNT(*) FROM tickets) as tickets,
        (SELECT COUNT(*) FROM message_archive) as messages,
        (SELECT COUNT(*) FROM attachments WHERE id = '${sampleAttachmentId}') as attachments
    `);

    const destCounts = destAuditRes.rows[0];
    console.log('[Destination DB Counts]:', destCounts);

    if (
      destCounts.brands !== '1' ||
      destCounts.customers !== '3' ||
      destCounts.orders !== '3' ||
      destCounts.tickets !== '3' ||
      destCounts.attachments !== '1'
    ) {
      throw new Error(`Data mismatch in restored destination database: ${JSON.stringify(destCounts)}`);
    }

    // Verify attachment BYTEA in destination database
    const destAttRes = await destPool.query(`SELECT file_data FROM attachments WHERE id = $1`, [sampleAttachmentId]);
    const restoredBytes = destAttRes.rows[0]?.file_data;
    const restoredHash = crypto.createHash('sha256').update(restoredBytes).digest('hex');
    console.log(`[Destination BYTEA Hash]: ${restoredHash}`);

    if (restoredHash !== sampleHash) {
      throw new Error(`Restored BYTEA hash mismatch! Restored: ${restoredHash}, Expected: ${sampleHash}`);
    }
    console.log('[PASS] Restored attachment BYTEA in destination database matches original hash bit-for-bit');

    // Verify foreign key constraint enforcement in destination database
    try {
      await destPool.query(`
        INSERT INTO tickets (id, brand_id, customer_id, order_id, category, priority, sentiment, status)
        VALUES ('tkt_invalid', 'brand_novacart', 'cust_aarav', 'ord_1022', 'General Inquiry', 'Low', 'Neutral', 'AI Handling')
      `);
      throw new Error('Foreign key enforcement failed in destination database');
    } catch (fkErr) {
      if (fkErr.message.includes('foreign key constraint') || fkErr.message.includes('violates foreign key')) {
        console.log('[PASS] Destination database strictly enforces composite customer-order foreign keys');
      } else {
        throw fkErr;
      }
    }

    console.log('\n=================================================================');
    console.log('ALL EXTERNAL DATABASE BACKUP & RESTORE CHECKS PASSED');
    console.log('=================================================================');
  } finally {
    await srcPool.end();
    await destPool.end();
    await srcPg.stop();
    await destPg.stop();
  }
}

testExternalBackupAndRestore().catch(err => {
  console.error('[TEST FAILED]:', err);
  process.exit(1);
});
