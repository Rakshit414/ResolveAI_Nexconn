import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import EmbeddedPostgres from 'embedded-postgres';
import { runMigration } from '../src/db/migrate.js';
import { closePool } from '../src/db/pool.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');
const TEST_PORT = 54332;
const PG16_DATA_DIR = path.resolve(ROOT_DIR, 'server/data/pg16_e2a_test_instance');
const TEST_DB_URL = `postgresql://postgres:postgres@127.0.0.1:${TEST_PORT}/postgres`;

console.log('================================================================================');
console.log('=== [TEST SUITE: Checkpoint E2-A Workforce Schema & Database Foundation] ===');
console.log('================================================================================\n');

async function runCheckpointE2AMigrationTests() {
  // Clean prior test data directory if it exists
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
  console.log(`[PG16 Setup] PostgreSQL 16 server running on port ${TEST_PORT}`);

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
    // TEST 1: Native PostgreSQL 16 Engine Verification
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 1: Native PostgreSQL 16 Engine Verification ---');
    const versionRes = await directPool.query('SELECT version();');
    const versionStr = versionRes.rows[0].version;
    console.log('[PostgreSQL Version]:', versionStr);
    assert.ok(versionStr.includes('PostgreSQL 16'), `Expected PostgreSQL 16 engine, got: ${versionStr}`);
    console.log('[PASS] Test 1: Native PostgreSQL 16 engine verified.');

    // -------------------------------------------------------------------------
    // TEST 2: Sequential Execution of Migrations 001 through 005
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 2: Sequential Migration Execution (001 -> 005) ---');
    await closePool();
    const migrationReport = await runMigration({ dryRun: false });
    assert.strictEqual(migrationReport.success, true, 'Migration run must succeed');

    const migrationsRes = await directPool.query(
      'SELECT version, checksum, applied_at FROM _schema_migrations ORDER BY applied_at ASC, version ASC'
    );
    console.log('[Recorded Migrations]:', migrationsRes.rows.map(r => r.version));
    assert.strictEqual(migrationsRes.rows.length, 5, 'All 5 migrations must be recorded in _schema_migrations');
    assert.strictEqual(migrationsRes.rows[0].version, '001_canonical_schema');
    assert.strictEqual(migrationsRes.rows[1].version, '002_seed_demo_data');
    assert.strictEqual(migrationsRes.rows[2].version, '003_attachment_blob_storage');
    assert.strictEqual(migrationsRes.rows[3].version, '004_seed_sample_attachment');
    assert.strictEqual(migrationsRes.rows[4].version, '005_checkpoint_e_workforce_schema');
    console.log('[PASS] Test 2: All 5 migrations recorded in sequence.');

    // -------------------------------------------------------------------------
    // TEST 3: Catalog Audit — Exact 26 Canonical Public Tables
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 3: Catalog Audit — Exact 26 Canonical Public Tables ---');
    const tablesRes = await directPool.query(`
      SELECT tablename FROM pg_catalog.pg_tables
      WHERE schemaname = 'public' AND tablename != '_schema_migrations'
      ORDER BY tablename ASC;
    `);
    const tableNames = tablesRes.rows.map(r => r.tablename);
    console.log(`[Public Tables Found (${tableNames.length})]:`, tableNames.join(', '));
    assert.strictEqual(tableNames.length, 26, `Expected 26 public tables, found ${tableNames.length}`);

    const expected26Tables = [
      // 17 Original Canonical Tables
      'agent_sessions', 'attachments', 'brand_memberships', 'brand_policies', 'brands',
      'conversation_mappings', 'customers', 'idempotency_keys', 'message_archive',
      'orders', 'outbox_messages', 'ticket_feedback', 'tickets', 'unrouted_messages',
      'users', 'webhook_receipts', 'widget_sessions',
      // 9 Checkpoint E Workforce, Translation & Reconciliation Tables
      'agent_profiles', 'agent_status_history', 'brand_knowledge_hub', 'brand_routing_state',
      'global_ui_translation_cache', 'message_translations', 'outbox_reconciliation_audit',
      'ticket_handoff_summaries', 'ticket_routing_queue'
    ].sort();

    assert.deepStrictEqual(tableNames, expected26Tables, 'All 26 canonical tables must match expected catalog');
    console.log('[PASS] Test 3: Verified exact 26 canonical public tables in PostgreSQL catalog.');

    // -------------------------------------------------------------------------
    // TEST 4: Idempotent Migration Execution & Seed Non-Duplication
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 4: Migration Idempotency & Replay Safety ---');
    const replayReport = await runMigration({ dryRun: false });
    assert.strictEqual(replayReport.success, true, 'Replaying migration must succeed');

    const customerCount = await directPool.query(`SELECT COUNT(*)::int AS count FROM customers WHERE brand_id = 'brand_novacart'`);
    const orderCount = await directPool.query(`SELECT COUNT(*)::int AS count FROM orders WHERE brand_id = 'brand_novacart'`);
    const ticketCount = await directPool.query(`SELECT COUNT(*)::int AS count FROM tickets WHERE brand_id = 'brand_novacart'`);
    const agentProfileCount = await directPool.query(`SELECT COUNT(*)::int AS count FROM agent_profiles WHERE brand_id = 'brand_novacart'`);

    assert.strictEqual(customerCount.rows[0].count, 3, 'Customers count must remain 3');
    assert.strictEqual(orderCount.rows[0].count, 3, 'Orders count must remain 3');
    assert.strictEqual(ticketCount.rows[0].count, 3, 'Tickets count must remain 3');
    assert.strictEqual(agentProfileCount.rows[0].count, 1, 'Agent profiles count must remain 1');
    console.log('[PASS] Test 4: Idempotency verified — zero duplicate records on replay.');

    // -------------------------------------------------------------------------
    // TEST 5: Tickets Status Check Constraint (All 5 Canonical States)
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 5: tickets_status_check Validation (5 Canonical States) ---');
    const condefRes = await directPool.query(`
      SELECT pg_get_constraintdef(c.oid) AS condef
      FROM pg_constraint c
      JOIN pg_namespace n ON n.oid = c.connamespace
      WHERE n.nspname = 'public' AND c.conname = 'tickets_status_check' AND c.conrelid = 'tickets'::regclass;
    `);
    const condef = condefRes.rows[0]?.condef;
    console.log('[Constraint Definition]:', condef);
    assert.ok(condef.includes('AI Handling'), 'Must include AI Handling');
    assert.ok(condef.includes('Human Requested'), 'Must include Human Requested');
    assert.ok(condef.includes('Human Agent Active'), 'Must include Human Agent Active');
    assert.ok(condef.includes('Resolved'), 'Must include Resolved');
    assert.ok(condef.includes('Closed'), 'Must include Closed');

    // Test inserting ticket with status 'Closed'
    await directPool.query(`
      INSERT INTO tickets (id, brand_id, customer_id, category, priority, status)
      VALUES ('tkt_test_closed', 'brand_novacart', 'cust_aarav', 'general_inquiry', 'Low', 'Closed');
    `);
    const closedTicket = await directPool.query(`SELECT status FROM tickets WHERE id = 'tkt_test_closed' AND brand_id = 'brand_novacart'`);
    assert.strictEqual(closedTicket.rows[0].status, 'Closed');

    // Test rejecting invalid status
    let rejectedInvalidStatus = false;
    try {
      await directPool.query(`
        INSERT INTO tickets (id, brand_id, customer_id, category, priority, status)
        VALUES ('tkt_test_invalid_status', 'brand_novacart', 'cust_aarav', 'general_inquiry', 'Low', 'InvalidStatus');
      `);
    } catch (err) {
      rejectedInvalidStatus = true;
      assert.strictEqual(err.code, '23514', `Expected check constraint violation (23514), got: ${err.code}`);
    }
    assert.ok(rejectedInvalidStatus, 'Must reject tickets with non-canonical status');
    console.log('[PASS] Test 5: tickets_status_check constraint verified for all 5 canonical states.');

    // -------------------------------------------------------------------------
    // TEST 6: Persisted Parent-Child Ticket Relationship
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 6: Persisted Parent-Child Ticket Relationship ---');
    // Verify parent_ticket_id column exists
    const parentColRes = await directPool.query(`
      SELECT data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'tickets' AND column_name = 'parent_ticket_id';
    `);
    assert.strictEqual(parentColRes.rows[0].data_type, 'character varying');
    assert.strictEqual(parentColRes.rows[0].is_nullable, 'YES');

    // Verify index idx_tickets_parent
    const parentIdxRes = await directPool.query(`
      SELECT pg_get_indexdef(i.indexrelid) AS indexdef
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indexrelid
      WHERE c.relname = 'idx_tickets_parent';
    `);
    assert.ok(parentIdxRes.rows[0]?.indexdef.includes('(brand_id, parent_ticket_id)'));

    // Insert parent ticket
    await directPool.query(`
      INSERT INTO tickets (id, brand_id, customer_id, category, priority, status)
      VALUES ('tkt_parent_p1', 'brand_novacart', 'cust_aarav', 'order_inquiry', 'Medium', 'Closed');
    `);

    // Insert child ticket referencing parent
    await directPool.query(`
      INSERT INTO tickets (id, brand_id, customer_id, category, priority, status, parent_ticket_id)
      VALUES ('tkt_child_c1', 'brand_novacart', 'cust_aarav', 'order_inquiry', 'Medium', 'AI Handling', 'tkt_parent_p1');
    `);

    const childRes = await directPool.query(`SELECT parent_ticket_id FROM tickets WHERE id = 'tkt_child_c1' AND brand_id = 'brand_novacart'`);
    assert.strictEqual(childRes.rows[0].parent_ticket_id, 'tkt_parent_p1');
    console.log('[PASS] Test 6: Persisted parent-child relationship verified.');

    // -------------------------------------------------------------------------
    // TEST 7: Tenant-Safe Composite FK Cross-Brand Rejection & ON DELETE RESTRICT
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 7: Tenant-Safe Composite FK Cross-Brand Rejection & ON DELETE RESTRICT ---');
    // Set up a second brand and customer
    await directPool.query(`
      INSERT INTO brands (id, name, slug, support_identity, api_key_hash)
      VALUES ('brand_second', 'Second Brand', 'second-brand', 'support_second', 'hash_second')
    `);
    await directPool.query(`
      INSERT INTO customers (id, brand_id, name, nexconn_user_id)
      VALUES ('cust_second_user', 'brand_second', 'Second Customer', 'nexconn_second_user');
    `);

    // Attempt cross-brand child ticket (brand_second attempting to link to brand_novacart parent)
    let crossBrandRejected = false;
    try {
      await directPool.query(`
        INSERT INTO tickets (id, brand_id, customer_id, category, priority, status, parent_ticket_id)
        VALUES ('tkt_cross_brand_child', 'brand_second', 'cust_second_user', 'order_inquiry', 'Medium', 'AI Handling', 'tkt_parent_p1');
      `);
    } catch (err) {
      crossBrandRejected = true;
      assert.strictEqual(err.code, '23503', `Expected FK violation (23503), got: ${err.code}`);
      console.log('[Cross-Brand Rejection Message]:', err.message);
    }
    assert.ok(crossBrandRejected, 'Must reject child ticket referencing parent from another brand');

    // Test ON DELETE RESTRICT: Attempt to delete parent ticket while child exists
    let deleteRestrictEnforced = false;
    try {
      await directPool.query(`DELETE FROM tickets WHERE id = 'tkt_parent_p1' AND brand_id = 'brand_novacart'`);
    } catch (err) {
      deleteRestrictEnforced = true;
      assert.strictEqual(err.code, '23503', `Expected RESTRICT violation (23503), got: ${err.code}`);
      console.log('[ON DELETE RESTRICT Message]:', err.message);
    }
    assert.ok(deleteRestrictEnforced, 'Must enforce ON DELETE RESTRICT on parent ticket');
    console.log('[PASS] Test 7: Tenant-safe composite FK cross-brand rejection and ON DELETE RESTRICT verified.');

    // -------------------------------------------------------------------------
    // TEST 8: Ticket Routing Queue Uniqueness & Required Skills NOT NULL
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 8: ticket_routing_queue Uniqueness & Skill Column ---');
    // Insert initial active queue record
    await directPool.query(`
      INSERT INTO ticket_routing_queue (
        id, brand_id, ticket_id, customer_id, priority, customer_language, required_skills, status
      ) VALUES (
        'q_tkt_c1_active', 'brand_novacart', 'tkt_child_c1', 'cust_aarav', 'Medium', 'en-US', ARRAY['general_inquiry']::TEXT[], 'queued'
      );
    `);

    // Attempt second active queue record for same (brand_id, ticket_id)
    let duplicateQueueRejected = false;
    try {
      await directPool.query(`
        INSERT INTO ticket_routing_queue (
          id, brand_id, ticket_id, customer_id, priority, customer_language, required_skills, status
        ) VALUES (
          'q_tkt_c1_dup', 'brand_novacart', 'tkt_child_c1', 'cust_aarav', 'High', 'en-US', ARRAY['general_inquiry']::TEXT[], 'routing'
        );
      `);
    } catch (err) {
      duplicateQueueRejected = true;
      assert.strictEqual(err.code, '23505', `Expected unique constraint violation (23505), got: ${err.code}`);
      console.log('[Queue Uniqueness Violation Message]:', err.message);
    }
    assert.ok(duplicateQueueRejected, 'Must reject concurrent duplicate active queue records');

    // Verify that once queue record is 'closed', a new queued record is allowed
    await directPool.query(`UPDATE ticket_routing_queue SET status = 'closed', closed_at = NOW() WHERE id = 'q_tkt_c1_active'`);
    await directPool.query(`
      INSERT INTO ticket_routing_queue (
        id, brand_id, ticket_id, customer_id, priority, customer_language, required_skills, status
      ) VALUES (
        'q_tkt_c1_reopened', 'brand_novacart', 'tkt_child_c1', 'cust_aarav', 'High', 'en-US', ARRAY['general_inquiry']::TEXT[], 'queued'
      );
    `);
    const reopenedQueue = await directPool.query(`SELECT status FROM ticket_routing_queue WHERE id = 'q_tkt_c1_reopened'`);
    assert.strictEqual(reopenedQueue.rows[0].status, 'queued');

    // Verify required_skills NOT NULL
    let nullSkillsRejected = false;
    try {
      await directPool.query(`
        INSERT INTO ticket_routing_queue (
          id, brand_id, ticket_id, customer_id, priority, customer_language, required_skills, status
        ) VALUES (
          'q_tkt_null_skills', 'brand_novacart', 'tkt_test_closed', 'cust_aarav', 'Low', 'en-US', NULL, 'queued'
        );
      `);
    } catch (err) {
      nullSkillsRejected = true;
      assert.strictEqual(err.code, '23502', `Expected not-null violation (23502), got: ${err.code}`);
    }
    assert.ok(nullSkillsRejected, 'Must reject NULL required_skills in ticket_routing_queue');
    console.log('[PASS] Test 8: Ticket queue partial unique index and skills constraints verified.');

    // -------------------------------------------------------------------------
    // TEST 9: Composite Integrity on message_translations & message_archive
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 9: Composite FK on message_translations ---');
    // Get existing archived message
    const msgRes = await directPool.query(`SELECT id, brand_id, ticket_id, nexconn_message_id FROM message_archive LIMIT 1`);
    assert.ok(msgRes.rows.length > 0, 'Must have at least 1 archived message from seed');
    const existingMsg = msgRes.rows[0];

    // Insert valid translation
    await directPool.query(`
      INSERT INTO message_translations (
        id, brand_id, ticket_id, message_id, target_locale, source_locale, original_text, translated_text
      ) VALUES (
        'trans_msg_1', $1, $2, $3, 'hi-IN', 'en-US', 'Original', 'Translated Hindi Text'
      );
    `, [existingMsg.brand_id, existingMsg.ticket_id, existingMsg.nexconn_message_id]);

    // Attempt mismatched ticket_id translation (use different target_locale 'mr-IN' to avoid hitting UNIQUE constraint)
    let mismatchedMsgRejected = false;
    try {
      await directPool.query(`
        INSERT INTO message_translations (
          id, brand_id, ticket_id, message_id, target_locale, source_locale, original_text, translated_text
        ) VALUES (
          'trans_msg_mismatch', $1, 'tkt_parent_p1', $2, 'mr-IN', 'en-US', 'Original', 'Translated Marathi Text'
        );
      `, [existingMsg.brand_id, existingMsg.nexconn_message_id]);
    } catch (err) {
      mismatchedMsgRejected = true;
      assert.strictEqual(err.code, '23503', `Expected composite FK violation (23503), got: ${err.code}`);
    }
    assert.ok(mismatchedMsgRejected, 'Must reject message_translations with mismatched ticket_id');
    console.log('[PASS] Test 9: Composite FK on message_translations verified.');

    // -------------------------------------------------------------------------
    // TEST 10: Composite FK & ON DELETE RESTRICT on brand_knowledge_hub
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 10: Composite FK & ON DELETE RESTRICT on brand_knowledge_hub ---');
    // Insert a policy in brand_novacart
    await directPool.query(`
      INSERT INTO brand_policies (id, brand_id, topic, rule, action_guideline)
      VALUES ('pol_test_return', 'brand_novacart', 'test_returns', 'Returns accepted within 30 days', 'Process full refund');
    `);

    // Insert valid knowledge hub entry linked to policy
    await directPool.query(`
      INSERT INTO brand_knowledge_hub (
        id, brand_id, policy_id, category, title, slug, content_markdown
      ) VALUES (
        'kh_test_1', 'brand_novacart', 'pol_test_return', 'policy', 'NovaCart Return Guidelines', 'novacart-return-guidelines', 'Markdown content'
      );
    `);

    // Attempt cross-brand policy reference: brand_second trying to reference brand_novacart policy
    let crossBrandPolicyRejected = false;
    try {
      await directPool.query(`
        INSERT INTO brand_knowledge_hub (
          id, brand_id, policy_id, category, title, slug, content_markdown
        ) VALUES (
          'kh_cross_brand', 'brand_second', 'pol_test_return', 'policy', 'Second Brand Guidelines', 'second-guidelines', 'Markdown'
        );
      `);
    } catch (err) {
      crossBrandPolicyRejected = true;
      assert.strictEqual(err.code, '23503', `Expected composite FK violation (23503), got: ${err.code}`);
      console.log('[Cross-Brand Knowledge Hub Rejection Message]:', err.message);
    }
    assert.ok(crossBrandPolicyRejected, 'Must reject brand_knowledge_hub referencing policy from another brand');

    // Test ON DELETE RESTRICT: Attempt to delete brand_policies row while knowledge hub entry references it
    let policyDeleteRestricted = false;
    try {
      await directPool.query(`DELETE FROM brand_policies WHERE id = 'pol_test_return' AND brand_id = 'brand_novacart'`);
    } catch (err) {
      policyDeleteRestricted = true;
      assert.strictEqual(err.code, '23503', `Expected ON DELETE RESTRICT violation (23503), got: ${err.code}`);
      console.log('[Policy ON DELETE RESTRICT Message]:', err.message);
    }
    assert.ok(policyDeleteRestricted, 'Must enforce ON DELETE RESTRICT on brand_policies');

    // Verify soft deletion is supported and brand_id is preserved
    await directPool.query(`UPDATE brand_policies SET deleted_at = NOW() WHERE id = 'pol_test_return' AND brand_id = 'brand_novacart'`);
    const policyRow = await directPool.query(`SELECT brand_id, deleted_at FROM brand_policies WHERE id = 'pol_test_return'`);
    assert.strictEqual(policyRow.rows[0].brand_id, 'brand_novacart');
    assert.ok(policyRow.rows[0].deleted_at !== null, 'Policy soft-deletion timestamp must be recorded');
    console.log('[PASS] Test 10: Composite FK and ON DELETE RESTRICT on brand_knowledge_hub verified.');

    // -------------------------------------------------------------------------
    // TEST 11: Sarah Lin Agent Profile Backfill & Persona Integrity
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 11: Sarah Lin Agent Profile Backfill & Persona Integrity ---');
    const sarahRes = await directPool.query(`
      SELECT
        brand_id, user_id, nexconn_user_id, display_name, configured_status,
        primary_language, supported_languages, skills, max_concurrent_tickets,
        active_ticket_count, last_heartbeat_at
      FROM agent_profiles
      WHERE user_id = 'user_sarah_lin';
    `);
    assert.strictEqual(sarahRes.rows.length, 1, 'Sarah Lin profile must exist');
    const sarah = sarahRes.rows[0];
    console.log('[Sarah Lin Profile]:', sarah);

    assert.strictEqual(sarah.brand_id, 'brand_novacart');
    assert.strictEqual(sarah.user_id, 'user_sarah_lin');
    assert.strictEqual(sarah.nexconn_user_id, 'agent_sarah');
    assert.strictEqual(sarah.display_name, 'Sarah Lin');
    assert.strictEqual(sarah.configured_status, 'Offline');
    assert.strictEqual(sarah.primary_language, 'en-US');
    assert.deepStrictEqual(sarah.supported_languages, ['en-US', 'hi-IN', 'mr-IN']);
    assert.deepStrictEqual(sarah.skills, ['general_inquiry', 'returns', 'logistics', 'damages']);
    assert.strictEqual(sarah.max_concurrent_tickets, 3);
    assert.strictEqual(sarah.active_ticket_count, 0);
    assert.strictEqual(sarah.last_heartbeat_at, null);

    // Verify total agent_profiles in database is exactly 1 (no extra demo agents)
    const allAgentsCount = await directPool.query(`SELECT COUNT(*)::int AS count FROM agent_profiles`);
    assert.strictEqual(allAgentsCount.rows[0].count, 1, 'Exactly one agent profile (Sarah Lin) must exist');

    // Verify existing customer personas
    const custPersonas = await directPool.query(`SELECT id, name, nexconn_user_id FROM customers WHERE brand_id = 'brand_novacart' ORDER BY id ASC`);
    const personaNames = custPersonas.rows.map(c => c.name);
    assert.deepStrictEqual(personaNames, ['Aarav Sharma', 'Kabir Verma', 'Priya Mehta']);
    console.log('[PASS] Test 11: Sarah Lin agent profile backfill and customer persona integrity verified.');

    // -------------------------------------------------------------------------
    // TEST 12: Schema Validation Rejection & Transaction Rollback
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 12: Schema Validation Rejection & Transaction Rollback ---');
    // Test that an incompatible column type is detected and aborted by the validation DO block
    let validationErrorCaught = false;
    const testClient = await directPool.connect();
    try {
      await testClient.query('BEGIN');
      // Create a test table with an incompatible column definition
      await testClient.query(`
        CREATE TABLE mock_brands_test (
          id VARCHAR(64) PRIMARY KEY,
          allow_general_fallback INTEGER NOT NULL DEFAULT 0
        );
      `);

      // Run validation block that checks allow_general_fallback
      await testClient.query(`
        DO $$
        DECLARE
            v_col_type TEXT;
        BEGIN
            SELECT data_type INTO v_col_type
            FROM information_schema.columns
            WHERE table_name = 'mock_brands_test' AND column_name = 'allow_general_fallback';

            IF v_col_type <> 'boolean' THEN
                RAISE EXCEPTION 'Schema Incompatibility: mock_brands_test.allow_general_fallback exists with incompatible definition (type=%)', v_col_type;
            END IF;
        END $$;
      `);
    } catch (err) {
      validationErrorCaught = true;
      assert.ok(err.message.includes('Schema Incompatibility: mock_brands_test.allow_general_fallback exists with incompatible definition'));
      console.log('[Validation Exception Successfully Caught]:', err.message);
      await testClient.query('ROLLBACK');
    } finally {
      testClient.release();
    }
    assert.ok(validationErrorCaught, 'Validation block must raise exception on schema incompatibility');

    // Verify rollback preserved state (mock_brands_test does not exist)
    const checkTable = await directPool.query(`
      SELECT tablename FROM pg_catalog.pg_tables WHERE tablename = 'mock_brands_test';
    `);
    assert.strictEqual(checkTable.rows.length, 0, 'Table created inside rolled-back transaction must not exist');
    console.log('[PASS] Test 12: Schema validation error detection and transaction rollback verified.');

    // -------------------------------------------------------------------------
    // TEST 13: Outbox Reconciliation Audit Append-Only Trigger & Immutability
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 13: Outbox Reconciliation Audit Append-Only Immutability ---');
    const sampleAuditId = 'aud_mig005_test_1';
    await directPool.query(`
      INSERT INTO outbox_messages (
        id, brand_id, ticket_id, conversation_mapping_id, dedupe_key,
        target_user_id, sender_user_id, message_type, message_text, dispatch_status
      ) VALUES (
        'outbox_test_1', 'brand_novacart', 'tkt_1021', 'map_1021', 'dedupe_test_mig_13',
        'cust_aarav', 'user_sarah_lin', 'RC:TxtMsg', 'Test message', 'uncertain'
      )
    `);

    await directPool.query(`
      INSERT INTO outbox_reconciliation_audit (
        id, outbox_id, brand_id, operator_id, operator_role, outcome, evidence
      ) VALUES (
        $1, 'outbox_test_1', 'brand_novacart', 'user_sarah_lin', 'support_lead', 'marked_failed', 'Test evidence'
      )
    `, [sampleAuditId]);

    // Test UPDATE prevention
    let auditUpdateBlocked = false;
    try {
      await directPool.query(`
        UPDATE outbox_reconciliation_audit
        SET evidence = 'tampered'
        WHERE id = $1
      `, [sampleAuditId]);
    } catch (err) {
      auditUpdateBlocked = true;
      assert.ok(err.message.includes('ImmutableAuditError'), `Expected ImmutableAuditError, got: ${err.message}`);
    }
    assert.strictEqual(auditUpdateBlocked, true, 'Direct UPDATE on outbox_reconciliation_audit must be blocked by trigger');

    // Test DELETE prevention
    let auditDeleteBlocked = false;
    try {
      await directPool.query(`
        DELETE FROM outbox_reconciliation_audit
        WHERE id = $1
      `, [sampleAuditId]);
    } catch (err) {
      auditDeleteBlocked = true;
      assert.ok(err.message.includes('ImmutableAuditError'), `Expected ImmutableAuditError, got: ${err.message}`);
    }
    assert.strictEqual(auditDeleteBlocked, true, 'Direct DELETE on outbox_reconciliation_audit must be blocked by trigger');
    console.log('[PASS] Test 13: Outbox reconciliation audit trigger blocks UPDATE and DELETE.');

    console.log('\n================================================================================');
    console.log('=== [ALL 13 CHECKPOINT E2-A VERIFICATION TESTS PASSED SUCCESSFULLY] ===');
    console.log('================================================================================\n');

  } catch (err) {
    console.error('\n[FATAL TEST FAILURE IN BODY]:', err);
    throw err;
  } finally {
    try {
      await directPool.end().catch(() => {});
      await closePool().catch(() => {});
      if (originalDbUrl) {
        process.env.DATABASE_URL = originalDbUrl;
      } else {
        delete process.env.DATABASE_URL;
      }
      console.log('[PG16 Teardown] Stopping EmbeddedPostgres server...');
      await Promise.race([
        pgServer.stop(),
        new Promise(resolve => setTimeout(resolve, 5000))
      ]).catch(() => {});
      if (fs.existsSync(PG16_DATA_DIR)) {
        try {
          fs.rmSync(PG16_DATA_DIR, { recursive: true, force: true });
        } catch (e) {}
      }
      console.log('[PG16 Teardown] Completed cleanly.');
    } catch (e) {}
  }
}

runCheckpointE2AMigrationTests().catch(err => {
  console.error('\n[FATAL TEST FAILURE]:', err);
  process.exit(1);
});
