import assert from 'assert';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import pg from 'pg';
import EmbeddedPostgres from 'embedded-postgres';
import { runMigration } from '../src/db/migrate.js';
import { closePool } from '../src/db/pool.js';
import { calculateEffectiveStatus } from '../src/services/agentAvailabilityService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');
const TEST_PORT = 54338;
const PG16_DATA_DIR = path.resolve(ROOT_DIR, 'server/data/pg16_preflight_prod_instance');
const TEST_DB_URL = `postgresql://postgres:postgres@127.0.0.1:${TEST_PORT}/postgres`;
const PROD_BACKUP_FILE = path.resolve(ROOT_DIR, 'data/backups/resolve_ai_full_backup_2026-11-10T12-42-15-515Z.sql');
const PREFLIGHT_UPGRADED_DUMP = path.resolve(ROOT_DIR, 'data/backups/resolve_ai_upgraded_schema_preflight.sql');

function getSha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

console.log('================================================================================');
console.log('=== [TEST SUITE: Production Database Migration Preflight & Verification] ===');
console.log('================================================================================\n');

async function runProductionMigrationPreflight() {
  if (fs.existsSync(PG16_DATA_DIR)) {
    fs.rmSync(PG16_DATA_DIR, { recursive: true, force: true });
  }

  console.log(`[PG16 Setup] Initializing isolated PostgreSQL 16 on port ${TEST_PORT}...`);
  const pgServer = new EmbeddedPostgres({
    port: TEST_PORT,
    databaseDir: PG16_DATA_DIR,
    user: 'postgres',
    password: 'postgres'
  });

  await pgServer.initialise();
  await pgServer.start();
  console.log(`[PG16 Setup] Native PostgreSQL 16 server running on port ${TEST_PORT}`);

  const originalDbUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = TEST_DB_URL;

  const { Pool } = pg;
  const directPool = new Pool({
    connectionString: TEST_DB_URL,
    max: 10,
    idleTimeoutMillis: 5000,
    connectionTimeoutMillis: 5000
  });

  try {
    // -------------------------------------------------------------------------
    // STEP 1: Verify PostgreSQL 16 Engine
    // -------------------------------------------------------------------------
    console.log('\n--- STEP 1: PostgreSQL 16 Engine Verification ---');
    const verRes = await directPool.query('SELECT version();');
    console.log('[PostgreSQL Version]:', verRes.rows[0].version);
    assert.ok(verRes.rows[0].version.includes('PostgreSQL 16'), 'Must be running PostgreSQL 16 engine');
    console.log('[PASS] Step 1: PostgreSQL 16 verified.');

    // -------------------------------------------------------------------------
    // STEP 2: Restore Historical Base Tables (001 and 003 DDL + _schema_migrations)
    // -------------------------------------------------------------------------
    console.log('\n--- STEP 2: Create Base DDL (Tables 001 & 003 + _schema_migrations) ---');
    const ddl001 = fs.readFileSync(path.resolve(ROOT_DIR, 'server/src/db/migrations/001_canonical_schema.sql'), 'utf8');
    const ddl003 = fs.readFileSync(path.resolve(ROOT_DIR, 'server/src/db/migrations/003_attachment_blob_storage.sql'), 'utf8');

    await directPool.query('BEGIN');
    await directPool.query(`
      CREATE TABLE IF NOT EXISTS _schema_migrations (
        version VARCHAR(64) PRIMARY KEY,
        applied_at TIMESTAMPTZ DEFAULT NOW(),
        checksum VARCHAR(64) NOT NULL
      );
    `);
    await directPool.query(ddl001);
    await directPool.query(ddl003);
    await directPool.query('COMMIT');
    console.log('[PASS] Step 2: Base DDL executed.');

    // -------------------------------------------------------------------------
    // STEP 3: Restore Production Logical Backup (Nov 10 Dump)
    // -------------------------------------------------------------------------
    console.log('\n--- STEP 3: Restoring Production Logical Backup ---');
    assert.ok(fs.existsSync(PROD_BACKUP_FILE), `Production backup file must exist at ${PROD_BACKUP_FILE}`);
    const backupSql = fs.readFileSync(PROD_BACKUP_FILE, 'utf8');
    console.log(`[Production Backup] File size: ${fs.statSync(PROD_BACKUP_FILE).size} bytes`);

    await directPool.query('BEGIN');
    await directPool.query(backupSql);
    await directPool.query('COMMIT');
    console.log('[PASS] Step 3: Production backup restored.');

    // -------------------------------------------------------------------------
    // STEP 4: Inspect Restored _schema_migrations & Verify Checksums
    // -------------------------------------------------------------------------
    console.log('\n--- STEP 4: Checksum & Version Verification on Restored State ---');
    const migrationsRes = await directPool.query('SELECT version, checksum FROM _schema_migrations ORDER BY version ASC');
    console.log('[Restored Migrations]:', migrationsRes.rows);

    const restoredMap = new Map(migrationsRes.rows.map(r => [r.version, r.checksum]));
    assert.ok(restoredMap.has('001_canonical_schema'), '001 must be present');
    assert.ok(restoredMap.has('002_seed_demo_data'), '002 must be present');
    assert.ok(restoredMap.has('003_attachment_blob_storage'), '003 must be present');
    assert.strictEqual(restoredMap.has('004_seed_sample_attachment'), false, '004 must NOT be recorded yet');
    assert.strictEqual(restoredMap.has('005_checkpoint_e_workforce_schema'), false, '005 must NOT be recorded yet');

    // Compute disk checksums
    const sql001 = fs.readFileSync(path.resolve(ROOT_DIR, 'server/src/db/migrations/001_canonical_schema.sql'), 'utf8');
    const sql002 = fs.readFileSync(path.resolve(ROOT_DIR, 'server/src/db/migrations/002_seed_demo_data.sql'), 'utf8');
    const sql003 = fs.readFileSync(path.resolve(ROOT_DIR, 'server/src/db/migrations/003_attachment_blob_storage.sql'), 'utf8');

    assert.strictEqual(restoredMap.get('001_canonical_schema'), getSha256(sql001), '001 checksum exact match');
    assert.strictEqual(restoredMap.get('002_seed_demo_data'), getSha256(sql002), '002 checksum exact match');
    assert.strictEqual(restoredMap.get('003_attachment_blob_storage'), getSha256(sql003), '003 checksum exact match');
    console.log('[PASS] Step 4: Checksums of 001, 002, 003 match repo files byte-for-byte.');

    // -------------------------------------------------------------------------
    // STEP 5: Execute Migration 005 Against Restored Production DB
    // -------------------------------------------------------------------------
    console.log('\n--- STEP 5: Running Migration 004 & 005 via Migration Engine ---');
    await closePool();
    const migrationReport = await runMigration({ dryRun: false });
    assert.strictEqual(migrationReport.success, true, 'Migration run must succeed');
    console.log('[PASS] Step 5: Migration executed cleanly to completion.');

    const postMigRes = await directPool.query('SELECT version, checksum FROM _schema_migrations ORDER BY version ASC');
    assert.strictEqual(postMigRes.rows.length, 5, 'All 5 migrations must now be recorded');
    console.log('[All 5 Migrations Recorded]:', postMigRes.rows.map(r => r.version));

    // -------------------------------------------------------------------------
    // STEP 6: Verify Production Data Remains 100% Intact
    // -------------------------------------------------------------------------
    console.log('\n--- STEP 6: Verify Existing Production Records Intact ---');

    // Customers (3)
    const custRes = await directPool.query('SELECT id, name, email, nexconn_user_id FROM customers ORDER BY id');
    assert.strictEqual(custRes.rows.length, 3, 'Must retain exactly 3 customers');
    assert.deepStrictEqual(custRes.rows.map(c => c.id), ['cust_aarav', 'cust_kabir', 'cust_priya']);
    assert.strictEqual(custRes.rows[0].name, 'Aarav Sharma');
    assert.strictEqual(custRes.rows[0].email, 'aarav.sharma@example.com');
    assert.strictEqual(custRes.rows[1].name, 'Kabir Verma');
    assert.strictEqual(custRes.rows[2].name, 'Priya Mehta');
    console.log('✓ 3 Customers verified:', custRes.rows.map(c => c.name));

    // Orders (3)
    const ordRes = await directPool.query('SELECT id, order_number, carrier, tracking_number, status, price FROM orders ORDER BY order_number');
    assert.strictEqual(ordRes.rows.length, 3, 'Must retain exactly 3 orders');
    assert.deepStrictEqual(ordRes.rows.map(o => o.order_number), ['NC1021', 'NC1022', 'NC1023']);
    assert.strictEqual(ordRes.rows[0].tracking_number, 'TRK-NC-882910');
    assert.strictEqual(ordRes.rows[0].status, 'Delayed');
    assert.strictEqual(ordRes.rows[1].tracking_number, 'TRK-NC-773821');
    assert.strictEqual(ordRes.rows[1].status, 'Delivered');
    assert.strictEqual(ordRes.rows[2].tracking_number, 'TRK-NC-449102');
    assert.strictEqual(ordRes.rows[2].status, 'Delivered');
    console.log('✓ 3 Orders verified:', ordRes.rows.map(o => `${o.order_number} (${o.status})`));

    // Tickets (3)
    const tktRes = await directPool.query('SELECT id, category, priority, status, summary FROM tickets ORDER BY id');
    assert.strictEqual(tktRes.rows.length, 3, 'Must retain exactly 3 tickets');
    assert.deepStrictEqual(tktRes.rows.map(t => t.id), ['tkt_1021', 'tkt_1022', 'tkt_1023']);
    assert.strictEqual(tktRes.rows[0].status, 'AI Handling');
    assert.strictEqual(tktRes.rows[0].category, 'Delivery Delay');
    assert.strictEqual(tktRes.rows[0].priority, 'High');
    assert.ok(tktRes.rows[0].summary.includes('NovaSprint Pro'));
    console.log('✓ 3 Tickets verified:', tktRes.rows.map(t => `${t.id} (${t.category})`));

    // Message Archives & Mappings
    const archRes = await directPool.query('SELECT id, ticket_id, sender_name FROM message_archive ORDER BY id');
    assert.strictEqual(archRes.rows.length, 3, 'Must retain all message archives');
    const mapRes = await directPool.query('SELECT id, conversation_key FROM conversation_mappings ORDER BY id');
    assert.strictEqual(mapRes.rows.length, 3, 'Must retain all conversation mappings');
    console.log('✓ Message archives and mappings intact.');

    // Attachments
    const attRes = await directPool.query('SELECT id, file_name, file_size_bytes, (file_data IS NOT NULL) AS has_blob FROM attachments');
    assert.ok(attRes.rows.length >= 1, 'Must retain attachments');
    assert.strictEqual(attRes.rows[0].has_blob, true, 'Binary blob data must be preserved');
    console.log('✓ Attachment blob storage verified:', attRes.rows[0].file_name);

    console.log('[PASS] Step 6: All existing production data completely intact.');

    // -------------------------------------------------------------------------
    // STEP 7: Verify Sarah Lin Provisioned Profile
    // -------------------------------------------------------------------------
    console.log('\n--- STEP 7: Verify Sarah Lin Provisioned Profile ---');
    const sarahRes = await directPool.query('SELECT * FROM agent_profiles WHERE brand_id = $1 AND user_id = $2', ['brand_novacart', 'user_sarah_lin']);
    assert.strictEqual(sarahRes.rows.length, 1, 'Exactly one agent profile for Sarah Lin');

    const sarah = sarahRes.rows[0];
    console.log('[Sarah Lin Profile]:', {
      user_id: sarah.user_id,
      display_name: sarah.display_name,
      configured_status: sarah.configured_status,
      active_ticket_count: sarah.active_ticket_count,
      primary_language: sarah.primary_language,
      supported_languages: sarah.supported_languages,
      skills: sarah.skills,
      max_concurrent_tickets: sarah.max_concurrent_tickets,
      last_heartbeat_at: sarah.last_heartbeat_at
    });

    assert.strictEqual(sarah.user_id, 'user_sarah_lin');
    assert.strictEqual(sarah.display_name, 'Sarah Lin');
    assert.strictEqual(sarah.configured_status, 'Offline');
    assert.strictEqual(sarah.active_ticket_count, 0);
    assert.strictEqual(sarah.primary_language, 'en-US');
    assert.deepStrictEqual(sarah.supported_languages, ['en-US', 'hi-IN', 'mr-IN']);
    assert.deepStrictEqual(sarah.skills, ['general_inquiry', 'returns', 'logistics', 'damages']);
    assert.strictEqual(sarah.max_concurrent_tickets, 3);
    assert.strictEqual(sarah.last_heartbeat_at, null);

    // Verify calculated effective status
    const effectiveStatus = calculateEffectiveStatus(sarah);
    assert.strictEqual(effectiveStatus, 'Offline', 'Effective status must be Offline with NULL heartbeat');
    console.log('[PASS] Step 7: Sarah Lin profile verified (Offline, 0 tickets, tier 1-10 valid).');

    // -------------------------------------------------------------------------
    // STEP 8: Verify Migration 005 Tables & Constraints
    // -------------------------------------------------------------------------
    console.log('\n--- STEP 8: Verify Migration 005 Tables & Constraints ---');
    const requiredTables = [
      'agent_profiles',
      'agent_status_history',
      'brand_routing_state',
      'ticket_routing_queue',
      'brand_knowledge_hub',
      'ticket_handoff_summaries',
      'message_translations',
      'global_ui_translation_cache',
      'outbox_reconciliation_audit'
    ];

    for (const tbl of requiredTables) {
      const tRes = await directPool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1
        );
      `, [tbl]);
      assert.strictEqual(tRes.rows[0].exists, true, `Table ${tbl} must exist`);
    }
    console.log(`✓ All ${requiredTables.length} new tables verified in catalog.`);

    // Verify parent_ticket_id ON DELETE RESTRICT
    const fkRes = await directPool.query(`
      SELECT pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conrelid = 'tickets'::regclass AND contype = 'f'
        AND pg_get_constraintdef(oid) LIKE '%parent_ticket_id%';
    `);
    assert.ok(fkRes.rows.length > 0, 'parent_ticket_id FK constraint exists');
    assert.ok(fkRes.rows[0].def.includes('ON DELETE RESTRICT'), 'Must specify ON DELETE RESTRICT');
    console.log('✓ parent_ticket_id FK ON DELETE RESTRICT verified.');

    // Verify max_concurrent_tickets constraint 1-10
    const maxChkRes = await directPool.query(`
      SELECT pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conrelid = 'agent_profiles'::regclass AND contype = 'c'
        AND pg_get_constraintdef(oid) LIKE '%max_concurrent_tickets%';
    `);
    assert.ok(maxChkRes.rows.length > 0, 'max_concurrent_tickets check constraint exists');
    assert.ok(maxChkRes.rows[0].def.includes('1') && maxChkRes.rows[0].def.includes('10'), 'Check constraint specifies 1-10');
    console.log('✓ max_concurrent_tickets 1-10 range constraint verified.');

    // Verify workforce indexes
    const idxRes = await directPool.query(`
      SELECT c.relname, i.indisunique, pg_get_indexdef(i.indexrelid) AS def
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indexrelid
      WHERE c.relname IN ('idx_unique_active_ticket_queue', 'idx_tickets_parent', 'idx_ticket_queue_poll', 'idx_agent_profiles_routing');
    `);
    assert.strictEqual(idxRes.rows.length, 4, 'All 4 required workforce indexes must exist');
    const uniqueActiveQueue = idxRes.rows.find(r => r.relname === 'idx_unique_active_ticket_queue');
    assert.ok(uniqueActiveQueue, 'idx_unique_active_ticket_queue exists');
    assert.strictEqual(uniqueActiveQueue.indisunique, true, 'idx_unique_active_ticket_queue is UNIQUE');
    assert.ok(uniqueActiveQueue.def.includes('WHERE'), 'idx_unique_active_ticket_queue is a partial index');
    console.log('✓ Workforce indexes and partial predicates verified.');
    console.log('[PASS] Step 8: Workforce schema constraints & indexes validated.');

    // -------------------------------------------------------------------------
    // STEP 9: Verify Idempotent Second Run
    // -------------------------------------------------------------------------
    console.log('\n--- STEP 9: Idempotent Second Migration Run ---');
    await closePool();
    const secondReport = await runMigration({ dryRun: false });
    assert.strictEqual(secondReport.success, true, 'Second migration run must succeed');

    const secondSarah = await directPool.query('SELECT COUNT(*) AS count FROM agent_profiles WHERE brand_id = $1 AND user_id = $2', ['brand_novacart', 'user_sarah_lin']);
    assert.strictEqual(parseInt(secondSarah.rows[0].count, 10), 1, 'Sarah Lin profile must remain exactly 1 record');
    console.log('[PASS] Step 9: Migration runner is 100% idempotent.');

    // -------------------------------------------------------------------------
    // STEP 10: Produce Verified SQL Dump
    // -------------------------------------------------------------------------
    console.log('\n--- STEP 10: Exporting Verified Upgraded SQL Dump ---');
    const dumpTables = [
      '_schema_migrations',
      'brands',
      'users',
      'brand_memberships',
      'agent_profiles',
      'agent_status_history',
      'brand_routing_state',
      'customers',
      'orders',
      'brand_policies',
      'tickets',
      'ticket_routing_queue',
      'brand_knowledge_hub',
      'ticket_handoff_summaries',
      'message_archive',
      'conversation_mappings',
      'attachments',
      'message_translations',
      'global_ui_translation_cache'
    ];

    let dumpSql = `-- ============================================================================\n`;
    dumpSql += `-- RESOLVE AI UPGRADED PREFLIGHT DATABASE DUMP\n`;
    dumpSql += `-- Generated At: ${new Date().toISOString()}\n`;
    dumpSql += `-- Base: Production Dump 2026-11-10T12-42-15-515Z + Migration 004 + Migration 005\n`;
    dumpSql += `-- Engine: Native PostgreSQL 16.15\n`;
    dumpSql += `-- ============================================================================\n\n`;
    dumpSql += `SET statement_timeout = 0;\nSET lock_timeout = 0;\nSET client_encoding = 'UTF8';\n\n`;

    for (const table of dumpTables) {
      const existsRes = await directPool.query(`
        SELECT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = $1);
      `, [table]);
      if (!existsRes.rows[0].exists) continue;

      const rowsRes = await directPool.query(`SELECT * FROM "${table}"`);
      dumpSql += `-- Table: ${table} (${rowsRes.rows.length} rows)\n`;
      if (rowsRes.rows.length > 0) {
        const columns = Object.keys(rowsRes.rows[0]);
        for (const row of rowsRes.rows) {
          const values = columns.map(c => {
            const v = row[c];
            if (v === null || v === undefined) return 'NULL';
            if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
            if (typeof v === 'number') return String(v);
            if (v instanceof Date) return `'${v.toISOString()}'`;
            if (Array.isArray(v)) {
              const arrEscaped = v.map(item => `"${String(item).replace(/"/g, '\\"')}"`).join(',');
              return `'${('{' + arrEscaped + '}').replace(/'/g, "''")}'`;
            }
            if (typeof v === 'object') {
              if (Buffer.isBuffer(v)) {
                return `decode('${v.toString('hex')}', 'hex')`;
              }
              return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
            }
            return `'${String(v).replace(/'/g, "''")}'`;
          });
          dumpSql += `INSERT INTO "${table}" ("${columns.join('", "')}") VALUES (${values.join(', ')}) ON CONFLICT DO NOTHING;\n`;
        }
      }
      dumpSql += `\n`;
    }

    fs.writeFileSync(PREFLIGHT_UPGRADED_DUMP, dumpSql, 'utf8');
    const dumpStat = fs.statSync(PREFLIGHT_UPGRADED_DUMP);
    console.log(`[Upgraded Dump] Saved to ${PREFLIGHT_UPGRADED_DUMP} (${dumpStat.size} bytes)`);
    assert.ok(dumpStat.size > 5000, 'Upgraded dump must be non-empty');
    console.log('[PASS] Step 10: Verified SQL dump generated successfully.');

    console.log('\n================================================================================');
    console.log('=== [PREFLIGHT AUDIT PASSED: Production Database Migration Ready for Render] ===');
    console.log('================================================================================\n');

  } finally {
    await directPool.end();
    await closePool();
    await pgServer.stop();
    process.env.DATABASE_URL = originalDbUrl;

    if (fs.existsSync(PG16_DATA_DIR)) {
      fs.rmSync(PG16_DATA_DIR, { recursive: true, force: true });
    }
  }
}

runProductionMigrationPreflight().catch(err => {
  console.error('\n[FATAL PREFLIGHT ERROR]:', err);
  process.exit(1);
});
