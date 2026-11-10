import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import http from 'http';
import EmbeddedPostgres from 'embedded-postgres';
import { runMigration, runRollback } from '../src/db/migrate.js';
import { getPool, closePool, healthCheck } from '../src/db/pool.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');
const PG16_DATA_DIR = path.resolve(ROOT_DIR, 'server/data/pg16_test_instance');
const TEST_PORT = 54329;
const TEST_DB_URL = `postgresql://postgres:postgres@127.0.0.1:${TEST_PORT}/postgres`;

console.log('=== [TEST SUITE 13: Actual PostgreSQL 16 Server Integration & Migration Verification] ===');

async function runPostgres16IntegrationTests() {
  // Clean prior data dir
  if (fs.existsSync(PG16_DATA_DIR)) {
    fs.rmSync(PG16_DATA_DIR, { recursive: true, force: true });
  }

  console.log(`[PG16 Setup] Initializing native PostgreSQL 16 server on port ${TEST_PORT}...`);
  const pgServer = new EmbeddedPostgres({
    port: TEST_PORT,
    databaseDir: PG16_DATA_DIR,
    user: 'postgres',
    password: 'postgres'
  });

  await pgServer.initialise();
  await pgServer.start();
  console.log(`[PG16 Setup] PostgreSQL 16 server started successfully on port ${TEST_PORT}`);

  // Set environment variable DATABASE_URL for the application
  const originalDbUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = TEST_DB_URL;

  const { Pool } = pg;
  const directPool = new Pool({
    connectionString: TEST_DB_URL,
    max: 10,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 5000
  });

  try {
    // 1. Verify PostgreSQL Engine & Exact Version
    console.log('\n--- 1. Native PostgreSQL Engine & Version Verification ---');
    const versionRes = await directPool.query('SELECT version();');
    const versionStr = versionRes.rows[0].version;
    console.log('[Native PostgreSQL Version]:', versionStr);
    assert.ok(versionStr.includes('PostgreSQL 16'), `Must be PostgreSQL 16 engine, received: ${versionStr}`);
    console.log('[PASS] Confirmed native PostgreSQL 16 binary (matches Render Singapore spec)');

    // 2. Run Application Actual Migration Runner (migrate.js) against PostgreSQL 16
    console.log('\n--- 2. Executing Application Migration Runner (migrate.js) ---');
    // Ensure application pool is refreshed to use TEST_DB_URL
    await closePool();
    const migrationReport = await runMigration({ dryRun: false });
    assert.strictEqual(migrationReport.success, true, 'Migration must succeed against PostgreSQL 16');

    // 3. Verify _schema_migrations Tracking
    console.log('\n--- 3. Verifying Migration Tracking (_schema_migrations) ---');
    const migrationsRes = await directPool.query('SELECT version, checksum, applied_at FROM _schema_migrations ORDER BY applied_at ASC');
    console.log('[Applied Migrations]:', migrationsRes.rows.map(r => r.version));
    assert.strictEqual(migrationsRes.rows.length, 2, 'Must record both 001_canonical_schema and 002_seed_demo_data');
    assert.strictEqual(migrationsRes.rows[0].version, '001_canonical_schema');
    assert.strictEqual(migrationsRes.rows[1].version, '002_seed_demo_data');
    console.log('[PASS] _schema_migrations tracking verified in PostgreSQL 16 catalog');

    // 4. Verify 17 Canonical Public Tables
    console.log('\n--- 4. Verifying Catalog Public Tables ---');
    const tablesRes = await directPool.query(`
      SELECT tablename FROM pg_catalog.pg_tables 
      WHERE schemaname = 'public' AND tablename != '_schema_migrations'
      ORDER BY tablename ASC;
    `);
    console.log(`[Public Tables Count]: ${tablesRes.rows.length}`);
    assert.strictEqual(tablesRes.rows.length, 17, `Expected 17 public tables, found ${tablesRes.rows.length}`);
    const expectedTables = [
      'agent_sessions', 'attachments', 'brand_memberships', 'brand_policies', 'brands',
      'conversation_mappings', 'customers', 'idempotency_keys', 'message_archive',
      'orders', 'outbox_messages', 'ticket_feedback', 'tickets', 'unrouted_messages',
      'users', 'webhook_receipts', 'widget_sessions'
    ];
    for (const tbl of expectedTables) {
      assert.ok(tablesRes.rows.some(r => r.tablename === tbl), `Missing expected table: ${tbl}`);
    }
    console.log('[PASS] All 17 canonical tables verified in native PostgreSQL 16 catalog');

    // 5. Test Seed Idempotency & Persona Non-Duplication
    console.log('\n--- 5. Seed Idempotency Verification ---');
    // Re-run migration
    await runMigration({ dryRun: false });
    const custCount = await directPool.query(`SELECT COUNT(*)::int as count FROM customers WHERE brand_id = 'brand_novacart'`);
    assert.strictEqual(custCount.rows[0].count, 3, 'Seed re-execution must not duplicate customers');
    const orderCount = await directPool.query(`SELECT COUNT(*)::int as count FROM orders WHERE brand_id = 'brand_novacart'`);
    assert.strictEqual(orderCount.rows[0].count, 3, 'Seed re-execution must not duplicate orders');
    const ticketCount = await directPool.query(`SELECT COUNT(*)::int as count FROM tickets WHERE brand_id = 'brand_novacart'`);
    assert.strictEqual(ticketCount.rows[0].count, 3, 'Seed re-execution must not duplicate tickets');
    console.log('[PASS] Seed re-execution verified idempotent with zero persona duplication');

    // 6. Test Foreign Key Constraints: Customer-Order Ownership
    console.log('\n--- 6. Relational Invariants: Customer-Order Ownership FK ---');
    let fkRejected = false;
    try {
      // Customer Aarav ('cust_aarav') attempting to reference Priya's order ('ord_1022')
      await directPool.query(`
        INSERT INTO tickets (id, brand_id, customer_id, order_id, category, priority, status)
        VALUES ('tkt_rogue_16', 'brand_novacart', 'cust_aarav', 'ord_1022', 'Shipping', 'High', 'AI Handling');
      `);
    } catch (err) {
      fkRejected = true;
      assert.ok(err.message.includes('foreign key constraint') || err.message.includes('fk_ticket_order_ownership'), 'Must violate fk_ticket_order_ownership');
    }
    assert.strictEqual(fkRejected, true, 'Composite FK (brand_id, order_id, customer_id) MUST reject cross-customer order reference');
    console.log('[PASS] PostgreSQL 16 enforced composite FK (brand_id, order_id, customer_id)');

    // 7. Test Transaction Atomicity & Rollback
    console.log('\n--- 7. Transaction Atomicity & Rollback ---');
    const client = await directPool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`
        INSERT INTO idempotency_keys (brand_id, request_scope, idempotency_key, request_hash, ticket_id, response_code, response_body)
        VALUES ('brand_novacart', 'test_scope', 'key_tx_test_pg16', 'hash_pg16', 'tkt_1021', 200, '{"tx":true}'::jsonb)
      `);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }

    const txCheck = await directPool.query(`SELECT idempotency_key FROM idempotency_keys WHERE idempotency_key = 'key_tx_test_pg16'`);
    assert.strictEqual(txCheck.rows.length, 0, 'Rolled-back record must NOT exist in PostgreSQL 16');
    console.log('[PASS] PostgreSQL 16 ACID transaction rollback verified');

    // 8. Test Data Persistence Across Server Restart
    console.log('\n--- 8. Disk Persistence Across PostgreSQL 16 Server Restart ---');
    await directPool.query(`
      INSERT INTO idempotency_keys (brand_id, request_scope, idempotency_key, request_hash, ticket_id, response_code, response_body)
      VALUES ('brand_novacart', 'test_scope', 'key_persist_pg16', 'hash_persist', 'tkt_1021', 200, '{"persisted":true}'::jsonb)
    `);

    // Close pool and shut down server process
    await directPool.end();
    await closePool();
    console.log('[PG16 Server] Stopping server process...');
    await pgServer.stop();

    // Re-start server process from same databaseDir
    console.log('[PG16 Server] Restarting server process from on-disk directory...');
    await pgServer.start();

    // Reconnect new pool
    const reconnectedPool = new Pool({ connectionString: TEST_DB_URL });
    const persistedRes = await reconnectedPool.query(`SELECT idempotency_key, response_body FROM idempotency_keys WHERE idempotency_key = 'key_persist_pg16'`);
    assert.strictEqual(persistedRes.rows.length, 1, 'Data must persist across PostgreSQL 16 server restarts');
    assert.strictEqual(persistedRes.rows[0].response_body.persisted, true);
    console.log('[PASS] Full on-disk WAL and table data persistence verified across PostgreSQL 16 restarts');

    // 9. Verify Application Database Health & Start with DATABASE_URL
    console.log('\n--- 9. Verifying Application Health & DATABASE_URL Mode ---');
    const health = await healthCheck();
    console.log('[Application DB Health]:', health);
    assert.strictEqual(health.healthy, true, 'Application health check must return healthy');
    assert.strictEqual(health.mode, 'postgresql', 'Application health check mode MUST be postgresql when DATABASE_URL is set');
    console.log('[PASS] Application successfully connected and operating via DATABASE_URL');

    await reconnectedPool.end();
    await closePool();

    console.log('\n====================================================================');
    console.log('ALL TESTS PASSED AGAINST NATIVE POSTGRESQL 16 SERVER INSTANCE');
    console.log('====================================================================');
  } catch (err) {
    console.error('POSTGRESQL 16 INTEGRATION TEST FAILED:', err);
    process.exit(1);
  } finally {
    try {
      await directPool.end().catch(() => {});
      await closePool().catch(() => {});
      await pgServer.stop().catch(() => {});
      process.env.DATABASE_URL = originalDbUrl;
      fs.rmSync(PG16_DATA_DIR, { recursive: true, force: true });
    } catch (e) {}
  }
}

runPostgres16IntegrationTests();
