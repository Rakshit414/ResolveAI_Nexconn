import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PGlite } from '@electric-sql/pglite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');
const TEST_DB_PATH = path.resolve(ROOT_DIR, 'server/data/postgres_test_db');

console.log('=== [TEST SUITE 9: Actual PostgreSQL Engine & Storage Verification] ===');

async function runActualPostgresVerification() {
  // Clean prior test database directory if present
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.rmSync(TEST_DB_PATH, { recursive: true, force: true });
  }
  fs.mkdirSync(TEST_DB_PATH, { recursive: true });

  let db = new PGlite(TEST_DB_PATH);

  try {
    // 1. Engine & Version Verification
    const versionRes = await db.query('SELECT version();');
    const versionStr = versionRes.rows[0].version;
    console.log('[Postgres Engine Version]:', versionStr);
    assert.ok(versionStr.includes('PostgreSQL'), 'Engine must be authentic PostgreSQL compiled backend');
    console.log('[PASS] Authentic PostgreSQL engine verified');

    // 2. Migration Tracking Schema Setup
    await db.exec(`
      CREATE TABLE IF NOT EXISTS _schema_migrations (
        version VARCHAR(64) PRIMARY KEY,
        applied_at TIMESTAMPTZ DEFAULT NOW(),
        checksum VARCHAR(64) NOT NULL
      );
    `);

    // 3. Apply Canonical 17-Table Schema DDL
    const ddlPath = path.resolve(ROOT_DIR, 'server/src/db/migrations/001_canonical_schema.sql');
    const ddlSql = fs.readFileSync(ddlPath, 'utf8');
    await db.exec(ddlSql);

    // Record migration 001
    await db.query(`
      INSERT INTO _schema_migrations (version, checksum)
      VALUES ('001_canonical_schema', 'sha256_canonical_ddl_v1')
    `);

    // Verify all 17 public tables created
    const tablesRes = await db.query(`
      SELECT tablename FROM pg_catalog.pg_tables 
      WHERE schemaname = 'public' AND tablename != '_schema_migrations'
      ORDER BY tablename ASC;
    `);
    assert.strictEqual(tablesRes.rows.length, 17, `Expected 17 public tables, found ${tablesRes.rows.length}`);
    console.log(`[PASS] 17 canonical tables successfully created on PostgreSQL engine`);

    // 4. Apply Demo Seed Data Migration
    const seedPath = path.resolve(ROOT_DIR, 'server/src/db/migrations/002_seed_demo_data.sql');
    const seedSql = fs.readFileSync(seedPath, 'utf8');
    await db.exec(seedSql);

    // Record migration 002
    await db.query(`
      INSERT INTO _schema_migrations (version, checksum)
      VALUES ('002_seed_demo_data', 'sha256_demo_seed_v1')
    `);

    // 5. Test Migration Retryability & Idempotency
    // Re-applying the seed migration must not fail and must not duplicate rows
    await db.exec(seedSql);

    const custCount = await db.query(`SELECT COUNT(*)::int as count FROM customers WHERE brand_id = 'brand_novacart'`);
    assert.strictEqual(custCount.rows[0].count, 3, 'Seed re-execution must not duplicate customers');

    const orderCount = await db.query(`SELECT COUNT(*)::int as count FROM orders WHERE brand_id = 'brand_novacart'`);
    assert.strictEqual(orderCount.rows[0].count, 3, 'Seed re-execution must not duplicate orders');

    const ticketCount = await db.query(`SELECT COUNT(*)::int as count FROM tickets WHERE brand_id = 'brand_novacart'`);
    assert.strictEqual(ticketCount.rows[0].count, 3, 'Seed re-execution must not duplicate tickets');
    console.log('[PASS] Seed migrations are idempotent and safely retryable with zero duplication');

    // 6. Test Foreign Keys & Composite Customer-Order Ownership
    // Customer Aarav ('cust_aarav') owns Order 'ord_1021'.
    // Customer Priya ('cust_priya') owns Order 'ord_1022'.
    // Attempt to insert a ticket for Aarav referencing Priya's order 'ord_1022'
    let crossCustomerPrevented = false;
    try {
      await db.query(`
        INSERT INTO tickets (id, brand_id, customer_id, order_id, category, priority, status)
        VALUES ('tkt_rogue', 'brand_novacart', 'cust_aarav', 'ord_1022', 'Fraud Attempt', 'High', 'AI Handling');
      `);
    } catch (err) {
      crossCustomerPrevented = true;
      assert.ok(err.message.includes('violates foreign key constraint') || err.message.includes('foreign key'), 'Must be a foreign key constraint violation');
    }
    assert.strictEqual(crossCustomerPrevented, true, 'Composite foreign key MUST reject cross-customer order references');
    console.log('[PASS] Composite foreign key (brand_id, order_id, customer_id) strictly enforced');

    // 7. Test Non-Member Agent Assignment Integrity
    let nonMemberPrevented = false;
    try {
      await db.query(`
        UPDATE tickets 
        SET assigned_agent_id = 'user_intruder'
        WHERE id = 'tkt_1021';
      `);
    } catch (err) {
      nonMemberPrevented = true;
      assert.ok(err.message.includes('violates foreign key constraint') || err.message.includes('foreign key'), 'Must reject non-member agent assignment');
    }
    assert.strictEqual(nonMemberPrevented, true, 'Foreign key MUST reject non-member agent assignment');
    console.log('[PASS] Agent membership integrity foreign key strictly enforced');

    // 8. Test Transaction Atomicity & Rollback
    await db.exec('BEGIN');
    await db.query(`
      INSERT INTO idempotency_keys (brand_id, request_scope, idempotency_key, request_hash, ticket_id, response_code, response_body, expires_at)
      VALUES ('brand_novacart', 'ticket_create', 'key_tx_rollback', 'hash_test', 'tkt_1021', 200, '{"ok":true}'::jsonb, NOW() + INTERVAL '1 hour');
    `);
    await db.exec('ROLLBACK');

    const rollbackRes = await db.query(`SELECT idempotency_key FROM idempotency_keys WHERE idempotency_key = 'key_tx_rollback'`);
    assert.strictEqual(rollbackRes.rows.length, 0, 'Rolled-back transaction data must not be persisted');
    console.log('[PASS] PostgreSQL ACID transaction rollback verified');

    // 9. Test Disk Persistence Across Process/Instance Restart
    // Insert a persistent verification row
    await db.query(`
      INSERT INTO idempotency_keys (brand_id, request_scope, idempotency_key, request_hash, ticket_id, response_code, response_body, expires_at)
      VALUES ('brand_novacart', 'ticket_create', 'key_persist_verified', 'hash_persist_123', 'tkt_1021', 200, '{"persisted":true}'::jsonb, NOW() + INTERVAL '1 hour');
    `);

    // Close the database instance
    await db.close();
    console.log('[Postgres Engine]: Closed primary database instance');

    // Re-open brand new instance pointing to same on-disk path
    const reopenedDb = new PGlite(TEST_DB_PATH);
    const persistedRes = await reopenedDb.query(`SELECT idempotency_key, response_body FROM idempotency_keys WHERE idempotency_key = 'key_persist_verified'`);
    assert.strictEqual(persistedRes.rows.length, 1, 'Data must persist on disk across engine shutdown and restart');
    assert.strictEqual(persistedRes.rows[0].response_body.persisted, true);
    console.log('[PASS] True on-disk WAL and table data persistence verified across engine restarts');

    // 10. Test Schema Rollback
    const downPath = path.resolve(ROOT_DIR, 'server/src/db/migrations/001_canonical_schema_down.sql');
    const downSql = fs.readFileSync(downPath, 'utf8');
    await reopenedDb.exec(downSql);

    const postDownTables = await reopenedDb.query(`
      SELECT tablename FROM pg_catalog.pg_tables 
      WHERE schemaname = 'public' AND tablename != '_schema_migrations';
    `);
    assert.strictEqual(postDownTables.rows.length, 0, 'Rollback migration must cleanly drop all 17 tables');
    console.log('[PASS] Reversible rollback schema migration verified (0 public tables remaining)');

    await reopenedDb.close();

    console.log('\n[ALL TESTS PASSED IN actualPostgresVerification.test.js]');
  } catch (err) {
    console.error('[TEST FAILED]:', err);
    process.exit(1);
  } finally {
    // Clean test directory
    try {
      fs.rmSync(TEST_DB_PATH, { recursive: true, force: true });
    } catch (e) {}
  }
}

runActualPostgresVerification();
