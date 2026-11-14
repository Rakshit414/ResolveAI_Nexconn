import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import EmbeddedPostgres from 'embedded-postgres';
import { runMigration } from '../src/db/migrate.js';
import { closePool } from '../src/db/pool.js';
import { enqueueOrReopenTicket, autoCloseExpiredResolvedTickets } from '../src/services/queueService.js';
import { assignQueuedTicketAtomically } from '../src/services/routingService.js';
import { resolveTicketAndReleaseCapacity, transferTicketAtomically, reconcileAgentCapacity } from '../src/services/capacityService.js';
import { translationBreaker } from '../src/services/translationCircuitBreaker.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');
const TEST_PORT = 54336;
const PG16_DATA_DIR = path.resolve(ROOT_DIR, 'server/data/pg16_e2b1_test_instance');
const TEST_DB_URL = `postgresql://postgres:postgres@127.0.0.1:${TEST_PORT}/postgres`;

console.log('================================================================================');
console.log('=== [TEST SUITE: Checkpoint E2-B1 Queue, Routing & Capacity Services] ===');
console.log('================================================================================\n');

async function runE2B1Tests() {
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
    max: 15,
    idleTimeoutMillis: 5000,
    connectionTimeoutMillis: 5000
  });

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Migration Checksum Mismatch Fatal Error
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 1: Migration Checksum Mismatch Detection & Abort ---');
    // Pre-create _schema_migrations with a mismatched checksum for 001
    await directPool.query(`
      CREATE TABLE IF NOT EXISTS _schema_migrations (
        version VARCHAR(64) PRIMARY KEY,
        applied_at TIMESTAMPTZ DEFAULT NOW(),
        checksum VARCHAR(64) NOT NULL
      );
      INSERT INTO _schema_migrations (version, checksum)
      VALUES ('001_canonical_schema', 'tampered_invalid_checksum_1234567890');
    `);

    let checksumErrorCaught = false;
    try {
      await runMigration({ dryRun: false });
    } catch (err) {
      checksumErrorCaught = true;
      assert.ok(err.message.includes('[Migrate Checksum Fatal Error]'), `Expected fatal checksum error, got: ${err.message}`);
      console.log('[Checksum Mismatch Exception Caught]:', err.message);
    }
    assert.ok(checksumErrorCaught, 'Migration runner must throw fatal error on checksum mismatch');

    // Clean up test tamper
    await directPool.query('TRUNCATE _schema_migrations;');
    await closePool();
    console.log('[PASS] Test 1: Migration checksum tampering correctly rejected.');

    // -------------------------------------------------------------------------
    // TEST 2: Pre-existing Schema Incompatibility Rejection & Rollback
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 2: Pre-existing Schema Incompatibility Rejection & Rollback ---');
    // Apply migrations 001-004 first
    const m1Sql = fs.readFileSync(path.join(__dirname, '../src/db/migrations/001_canonical_schema.sql'), 'utf8');
    const m2Sql = fs.readFileSync(path.join(__dirname, '../src/db/migrations/002_seed_demo_data.sql'), 'utf8');
    const m3Sql = fs.readFileSync(path.join(__dirname, '../src/db/migrations/003_attachment_blob_storage.sql'), 'utf8');
    const m4Sql = fs.readFileSync(path.join(__dirname, '../src/db/migrations/004_seed_sample_attachment.sql'), 'utf8');
    const m5Sql = fs.readFileSync(path.join(__dirname, '../src/db/migrations/005_checkpoint_e_workforce_schema.sql'), 'utf8');

    await directPool.query(m1Sql);
    await directPool.query(m2Sql);
    await directPool.query(m3Sql);
    await directPool.query(m4Sql);

    // 2a: Intentionally introduce an incompatible constraint on tickets: tickets_status_check as a UNIQUE constraint instead of CHECK
    const testClient = await directPool.connect();
    let incompatibilityCaught = false;
    try {
      await testClient.query('BEGIN');
      // Create a bogus tickets_status_check unique constraint
      await testClient.query(`
        ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_status_check;
        ALTER TABLE tickets ADD CONSTRAINT tickets_status_check UNIQUE (id, brand_id);
      `);

      // Attempt to execute actual Migration 005 SQL within this transaction
      await testClient.query(m5Sql);
      await testClient.query('COMMIT');
    } catch (err) {
      incompatibilityCaught = true;
      console.log('[Actual Migration 005 Incompatibility Caught]:', err.message);
      assert.ok(
        err.message.includes('Schema Incompatibility: constraint tickets_status_check exists but is not a CHECK constraint'),
        `Unexpected error message: ${err.message}`
      );
      await testClient.query('ROLLBACK');
    } finally {
      testClient.release();
    }
    assert.ok(incompatibilityCaught, 'Actual Migration 005 must detect incompatible pre-existing constraint and abort');

    // Clean up: drop the bogus constraint and restore standard tickets_status_check
    await directPool.query('ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_status_check;');
    await directPool.query(`
      ALTER TABLE tickets ADD CONSTRAINT tickets_status_check
        CHECK (status IN ('AI Handling', 'Human Requested', 'Human Agent Active', 'Resolved'));
    `);

    // 2b: Mid-DDL Transactional Rollback Test
    console.log('  [2b] Mid-DDL transactional rollback proof on actual PostgreSQL 16...');
    const rollbackClient = await directPool.connect();
    let midDdlCaught = false;
    try {
      // Pre-create incompatible agent_profiles table with VARCHAR max_concurrent_tickets (fails at Step 6)
      await rollbackClient.query(`
        CREATE TABLE agent_profiles (
          brand_id VARCHAR(64) NOT NULL,
          user_id VARCHAR(64) NOT NULL,
          nexconn_user_id VARCHAR(64) NOT NULL,
          display_name VARCHAR(255) NOT NULL,
          configured_status VARCHAR(32) NOT NULL DEFAULT 'Offline',
          primary_language VARCHAR(16) NOT NULL DEFAULT 'en-US',
          supported_languages TEXT[] NOT NULL DEFAULT ARRAY['en-US'],
          skills TEXT[] NOT NULL DEFAULT ARRAY['general_inquiry'],
          max_concurrent_tickets VARCHAR(50) NOT NULL DEFAULT 'three',
          active_ticket_count INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (brand_id, user_id)
        );
      `);

      await rollbackClient.query('BEGIN');
      // Attempt to execute actual Migration 005 within this transaction
      // Step 1 (brands.allow_general_fallback) and Step 3 (tickets.parent_ticket_id) run before Step 6 fails
      await rollbackClient.query(m5Sql);
      await rollbackClient.query('COMMIT');
    } catch (err) {
      midDdlCaught = true;
      console.log('  [Mid-DDL Incompatibility Caught at Step 6]:', err.message);
      assert.ok(err.message.includes('Schema Incompatibility: agent_profiles columns incompatible'));
      await rollbackClient.query('ROLLBACK');
    } finally {
      // Drop the temporary incompatible table
      await rollbackClient.query('DROP TABLE IF EXISTS agent_profiles CASCADE');
      rollbackClient.release();
    }

    assert.ok(midDdlCaught, 'Migration 005 must abort mid-DDL on incompatible agent_profiles');

    // Assert that Step 1 and Step 3 DDL changes were completely rolled back
    const fallbackCol = (await directPool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'brands' AND column_name = 'allow_general_fallback'
    `)).rows;
    assert.strictEqual(fallbackCol.length, 0, 'brands.allow_general_fallback must NOT exist after rollback');

    const parentCol = (await directPool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'tickets' AND column_name = 'parent_ticket_id'
    `)).rows;
    assert.strictEqual(parentCol.length, 0, 'tickets.parent_ticket_id must NOT exist after rollback');

    const parentIdx = (await directPool.query(`
      SELECT relname FROM pg_class WHERE relname = 'idx_tickets_parent'
    `)).rows;
    assert.strictEqual(parentIdx.length, 0, 'idx_tickets_parent must NOT exist after rollback');

    // Assert original demo data remains intact
    const demoCustomers = (await directPool.query(`SELECT COUNT(*) FROM customers WHERE brand_id = 'brand_novacart'`)).rows[0].count;
    assert.ok(parseInt(demoCustomers, 10) >= 3, 'Demo customers must remain intact');
    console.log('  [PASS] Mid-DDL rollback verified: partial DDL cleanly reverted; zero orphan columns or indexes.');
    console.log('[PASS] Test 2: Actual Migration 005 schema incompatibility rejection and atomic rollback verified.');

    // -------------------------------------------------------------------------
    // TEST 3: Clean Execution of All Migrations (001 -> 005) & SQL Idempotency
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 3: Clean Execution of All Migrations (001 -> 005) & SQL Idempotency ---');
    await closePool();
    const runRes = await runMigration({ dryRun: false });
    assert.strictEqual(runRes.success, true);

    // Verify Migration 005 raw SQL is idempotent when run a second time directly on the database
    console.log('  [3b] Verifying Migration 005 raw SQL idempotency on existing schema...');
    await directPool.query(m5Sql);
    console.log('  [PASS] Migration 005 raw SQL successfully re-executed with zero errors (pure idempotency).');
    console.log('[PASS] Test 3: All migrations successfully applied and verified.');

    // -------------------------------------------------------------------------
    // TEST 4: Queue Service Lifecycle (First Enqueue, Reopen, 14-Day Child Ticket)
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 4: Queue Service Lifecycle ---');
    const brandId = 'brand_novacart';
    const testCustomerId = 'cust_aarav';

    // 4a: First-time enqueue on AI Handling ticket (tkt_1021)
    console.log('  [4a] First-time enqueue on AI Handling ticket...');
    const q1Res = await enqueueOrReopenTicket({
      brandId,
      ticketId: 'tkt_1021',
      customerId: testCustomerId,
      priority: 'High',
      customerLanguage: 'hi-IN',
      requiredSkills: ['returns', 'logistics']
    });

    assert.strictEqual(q1Res.enqueued, true);
    assert.strictEqual(q1Res.status, 'queued');

    // Verify ticket state transitioned to 'Human Requested' and assigned_agent_id is NULL
    const tkt1 = (await directPool.query(`SELECT status, human_requested, assigned_agent_id FROM tickets WHERE id = 'tkt_1021'`)).rows[0];
    assert.strictEqual(tkt1.status, 'Human Requested');
    assert.strictEqual(tkt1.human_requested, true);
    assert.strictEqual(tkt1.assigned_agent_id, null);

    // 4b: Repeated enqueue on actively queued ticket
    console.log('  [4b] Repeated enqueue on already queued ticket...');
    const q1Repeat = await enqueueOrReopenTicket({
      brandId,
      ticketId: 'tkt_1021',
      customerId: testCustomerId,
      priority: 'Critical',
      customerLanguage: 'hi-IN',
      requiredSkills: ['damages']
    });
    assert.strictEqual(q1Repeat.alreadyActive, true);
    assert.strictEqual(q1Repeat.queueId, q1Res.queueId);

    // Verify metadata was updated
    const qRow1 = (await directPool.query(`SELECT priority, required_skills FROM ticket_routing_queue WHERE id = $1`, [q1Res.queueId])).rows[0];
    assert.strictEqual(qRow1.priority, 'Critical');
    assert.deepStrictEqual(qRow1.required_skills, ['damages']);

    // 4c: Reopen Resolved ticket within 14 days
    console.log('  [4c] Reopening resolved ticket within 14 days...');
    // Mark tkt_1021 as Resolved with an assigned agent
    await directPool.query(`
      UPDATE tickets SET status = 'Resolved', assigned_agent_id = 'user_sarah_lin', last_updated = NOW() - INTERVAL '2 days' WHERE id = 'tkt_1021';
      UPDATE ticket_routing_queue SET status = 'closed', closed_at = NOW() - INTERVAL '2 days' WHERE ticket_id = 'tkt_1021';
    `);

    const sarahBeforeReopen = (await directPool.query(`SELECT active_ticket_count FROM agent_profiles WHERE user_id = 'user_sarah_lin'`)).rows[0].active_ticket_count;

    const reopenRes = await enqueueOrReopenTicket({
      brandId,
      ticketId: 'tkt_1021',
      customerId: testCustomerId,
      priority: 'Medium',
      customerLanguage: 'hi-IN',
      requiredSkills: ['general_inquiry']
    });
    assert.strictEqual(reopenRes.enqueued, true);

    const reopenedTkt = (await directPool.query(`SELECT status, human_requested, assigned_agent_id FROM tickets WHERE id = 'tkt_1021'`)).rows[0];
    assert.strictEqual(reopenedTkt.status, 'Human Requested');
    assert.strictEqual(reopenedTkt.human_requested, true);
    assert.strictEqual(reopenedTkt.assigned_agent_id, null, 'Must strictly CLEAR assigned_agent_id on reopen!');

    const sarahAfterReopen = (await directPool.query(`SELECT active_ticket_count FROM agent_profiles WHERE user_id = 'user_sarah_lin'`)).rows[0].active_ticket_count;
    assert.strictEqual(sarahAfterReopen, sarahBeforeReopen, 'Reopening must NOT increment capacity before assignment');

    // 4d: Enqueue on Resolved ticket older than 14 days (14-day rule -> Closed & child ticket)
    console.log('  [4d] 14-day rule: messaging after 14 days creates child ticket...');
    await directPool.query(`
      UPDATE tickets SET status = 'Resolved', last_updated = NOW() - INTERVAL '15 days' WHERE id = 'tkt_1021';
      UPDATE ticket_routing_queue SET status = 'closed', closed_at = NOW() - INTERVAL '15 days' WHERE ticket_id = 'tkt_1021';
    `);

    const childRes = await enqueueOrReopenTicket({
      brandId,
      ticketId: 'tkt_1021',
      customerId: testCustomerId,
      priority: 'High',
      customerLanguage: 'hi-IN',
      requiredSkills: ['returns']
    });

    assert.strictEqual(childRes.enqueued, true);
    assert.strictEqual(childRes.newTicketCreated, true);
    assert.strictEqual(childRes.parentTicketId, 'tkt_1021');
    assert.ok(childRes.ticketId.startsWith('tkt_'));

    // Verify parent ticket is permanently Closed
    const parentTkt = (await directPool.query(`SELECT status FROM tickets WHERE id = 'tkt_1021'`)).rows[0];
    assert.strictEqual(parentTkt.status, 'Closed');

    // Verify child ticket has parent_ticket_id set and is queued
    const childTkt = (await directPool.query(`SELECT status, parent_ticket_id, human_requested FROM tickets WHERE id = $1`, [childRes.ticketId])).rows[0];
    assert.strictEqual(childTkt.status, 'Human Requested');
    assert.strictEqual(childTkt.parent_ticket_id, 'tkt_1021');
    assert.strictEqual(childTkt.human_requested, true);

    // 4e: autoCloseExpiredResolvedTickets batch function
    console.log('  [4e] autoCloseExpiredResolvedTickets batch closer...');
    // Create another resolved ticket older than 14 days
    await directPool.query(`
      INSERT INTO tickets (id, brand_id, customer_id, category, priority, status, human_requested, summary, last_updated)
      VALUES ('tkt_stale_1', 'brand_novacart', 'cust_priya', 'returns', 'Medium', 'Resolved', FALSE, 'Stale test', NOW() - INTERVAL '16 days');
    `);
    const closedCount = await autoCloseExpiredResolvedTickets();
    assert.ok(closedCount >= 1);
    const staleTkt = (await directPool.query(`SELECT status FROM tickets WHERE id = 'tkt_stale_1'`)).rows[0];
    assert.strictEqual(staleTkt.status, 'Closed');

    console.log('[PASS] Test 4: Complete ticket queue lifecycle and 14-day child ticket creation verified.');

    // -------------------------------------------------------------------------
    // TEST 5: 5-Tier Matching Hierarchy & Translation Bridge Gating
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 5: 5-Tier Matching Hierarchy & Translation Bridge Gating ---');
    // Provision agents in NovaCart:
    // 1. Sarah Lin (Already exists from migration seed: primary en-US, supported ['en-US', 'hi-IN', 'mr-IN'], skills ['general_inquiry', 'returns', 'logistics', 'damages'])
    // Set Sarah Available with fresh heartbeat
    await directPool.query(`
      UPDATE agent_profiles
      SET configured_status = 'Available', last_heartbeat_at = NOW(), active_ticket_count = 0, max_concurrent_tickets = 3
      WHERE user_id = 'user_sarah_lin';
    `);

    // 2. Add Agent Carlos: Native Spanish (es-ES), skills: ['returns', 'billing']
    await directPool.query(`
      INSERT INTO users (id, email, password_hash, name) VALUES ('user_carlos', 'carlos@novacart.com', 'carlos_hash', 'Carlos Gomez') ON CONFLICT (id) DO NOTHING;
      INSERT INTO brand_memberships (id, brand_id, user_id, role) VALUES ('mem_carlos_novacart', 'brand_novacart', 'user_carlos', 'agent') ON CONFLICT (brand_id, user_id) DO NOTHING;
      INSERT INTO agent_profiles (
        brand_id, user_id, nexconn_user_id, display_name, configured_status, primary_language, supported_languages, skills, max_concurrent_tickets, active_ticket_count, last_heartbeat_at
      ) VALUES (
        'brand_novacart', 'user_carlos', 'agent_carlos', 'Carlos Gomez', 'Available', 'es-ES', ARRAY['es-ES', 'en-US'], ARRAY['returns', 'billing'], 3, 0, NOW()
      ) ON CONFLICT (brand_id, user_id) DO UPDATE SET configured_status = 'Available', last_heartbeat_at = NOW(), active_ticket_count = 0;
    `);

    // Clean active queue rows from prior tests
    await directPool.query(`DELETE FROM ticket_routing_queue WHERE brand_id = 'brand_novacart'`);

    // 5a: Tier 1 - Direct Specialist + Native Language (Customer in es-ES, needs billing & returns)
    console.log('  [5a] Tier 1: Exact specialist + native language match...');
    await directPool.query(`
      INSERT INTO tickets (id, brand_id, customer_id, category, priority, status, human_requested, summary, last_updated)
      VALUES ('tkt_tier1', 'brand_novacart', 'cust_aarav', 'billing', 'High', 'Human Requested', TRUE, 'Tier 1 test', NOW());
      INSERT INTO ticket_routing_queue (id, brand_id, ticket_id, customer_id, priority, customer_language, required_skills, status)
      VALUES ('q_tier1', 'brand_novacart', 'tkt_tier1', 'cust_aarav', 'High', 'es-ES', ARRAY['returns', 'billing'], 'queued');
    `);

    const assignTier1 = await assignQueuedTicketAtomically('brand_novacart');
    assert.strictEqual(assignTier1.assigned, true);
    assert.strictEqual(assignTier1.ticketId, 'tkt_tier1');
    assert.strictEqual(assignTier1.agentId, 'user_carlos', 'Must match Carlos (Tier 1: native es-ES + exact skills)');

    // 5b: Tier 2 - Direct Specialist + English Bridge (Customer in de-DE, needs returns & logistics)
    // Sarah has returns & logistics and en-US. Carlos lacks logistics.
    console.log('  [5b] Tier 2: Exact specialist + English bridge (translation available)...');
    await directPool.query(`
      INSERT INTO tickets (id, brand_id, customer_id, category, priority, status, human_requested, summary, last_updated)
      VALUES ('tkt_tier2', 'brand_novacart', 'cust_priya', 'logistics', 'High', 'Human Requested', TRUE, 'Tier 2 test', NOW());
      INSERT INTO ticket_routing_queue (id, brand_id, ticket_id, customer_id, priority, customer_language, required_skills, status)
      VALUES ('q_tier2', 'brand_novacart', 'tkt_tier2', 'cust_priya', 'High', 'de-DE', ARRAY['returns', 'logistics'], 'queued');
    `);

    const assignTier2 = await assignQueuedTicketAtomically('brand_novacart', { translationAvailable: true });
    assert.strictEqual(assignTier2.assigned, true);
    assert.strictEqual(assignTier2.ticketId, 'tkt_tier2');
    assert.strictEqual(assignTier2.agentId, 'user_sarah_lin', 'Must match Sarah Lin via English bridge');

    // 5c: Tier 2 Gated OFF when translation is offline
    console.log('  [5c] Tier 2 Gating: English bridge must be disabled when translation is unavailable...');
    await directPool.query(`
      INSERT INTO tickets (id, brand_id, customer_id, category, priority, status, human_requested, summary, last_updated)
      VALUES ('tkt_tier2_gated', 'brand_novacart', 'cust_priya', 'logistics', 'High', 'Human Requested', TRUE, 'Tier 2 gated test', NOW());
      INSERT INTO ticket_routing_queue (id, brand_id, ticket_id, customer_id, priority, customer_language, required_skills, status)
      VALUES ('q_tier2_gated', 'brand_novacart', 'tkt_tier2_gated', 'cust_priya', 'High', 'de-DE', ARRAY['returns', 'logistics'], 'queued');
    `);

    // With translationAvailable = false, Sarah Lin cannot bridge from German! Carlos does not speak German and lacks logistics.
    const assignTier2Gated = await assignQueuedTicketAtomically('brand_novacart', { translationAvailable: false });
    assert.strictEqual(assignTier2Gated.assigned, false);
    assert.strictEqual(assignTier2Gated.reason, 'NO_ELIGIBLE_AGENT_AVAILABLE');

    // 5d: Circuit Breaker Integration: Tripping to OPEN, native routing survives, bridge routing blocked
    console.log('  [5d] Circuit Breaker: Tripping to OPEN, verifying Tier 1 native survives and Tier 2 bridge is blocked...');
    process.env.GEMINI_API_KEY = 'test_valid_gemini_api_key';
    translationBreaker.reset();
    assert.strictEqual(translationBreaker.isOperational(), true);

    // Record 3 consecutive failures to trip breaker to OPEN
    translationBreaker.recordFailure(new Error('503 Service Unavailable'));
    translationBreaker.recordFailure(new Error('503 Service Unavailable'));
    translationBreaker.recordFailure(new Error('503 Service Unavailable'));
    assert.strictEqual(translationBreaker.state, 'OPEN');
    assert.strictEqual(translationBreaker.isOperational(), false, 'isOperational must be FALSE when OPEN');

    // Ensure Carlos and Sarah are Available with 0 active tickets
    await directPool.query(`
      UPDATE agent_profiles SET configured_status = 'Available', last_heartbeat_at = NOW(), active_ticket_count = 0, max_concurrent_tickets = 3 WHERE user_id = 'user_carlos';
      UPDATE agent_profiles SET configured_status = 'Available', last_heartbeat_at = NOW(), active_ticket_count = 0, max_concurrent_tickets = 3 WHERE user_id = 'user_sarah_lin';
      DELETE FROM ticket_routing_queue WHERE brand_id = 'brand_novacart';
    `);

    // Enqueue an es-ES ticket (Carlos is native es-ES): Native routing must succeed with breaker OPEN!
    await directPool.query(`
      INSERT INTO tickets (id, brand_id, customer_id, category, priority, status, human_requested, summary, last_updated)
      VALUES ('tkt_native_open', 'brand_novacart', 'cust_aarav', 'billing', 'Critical', 'Human Requested', TRUE, 'Native open test', NOW());
      INSERT INTO ticket_routing_queue (id, brand_id, ticket_id, customer_id, priority, customer_language, required_skills, status)
      VALUES ('q_native_open', 'brand_novacart', 'tkt_native_open', 'cust_aarav', 'Critical', 'es-ES', ARRAY['returns', 'billing'], 'queued');
    `);

    // Call without translationAvailable param - uses breaker.isOperational() directly
    const nativeAssignRes = await assignQueuedTicketAtomically('brand_novacart');
    assert.strictEqual(nativeAssignRes.assigned, true);
    assert.strictEqual(nativeAssignRes.ticketId, 'tkt_native_open');
    assert.strictEqual(nativeAssignRes.agentId, 'user_carlos', 'Tier 1 native match must succeed even when breaker is OPEN');

    // Clean up Carlos capacity and allow any scheduler cycle to settle
    await resolveTicketAndReleaseCapacity({ brandId: 'brand_novacart', ticketId: 'tkt_native_open' });
    await new Promise(r => setTimeout(r, 50));

    // Enqueue a de-DE ticket (Sarah has skills and en-US, needs translation bridge): Bridge routing must be blocked!
    await directPool.query(`
      INSERT INTO tickets (id, brand_id, customer_id, category, priority, status, human_requested, summary, last_updated)
      VALUES ('tkt_bridge_open', 'brand_novacart', 'cust_priya', 'returns', 'Critical', 'Human Requested', TRUE, 'Bridge open test', NOW());
      INSERT INTO ticket_routing_queue (id, brand_id, ticket_id, customer_id, priority, customer_language, required_skills, status)
      VALUES ('q_bridge_open', 'brand_novacart', 'tkt_bridge_open', 'cust_priya', 'Critical', 'de-DE', ARRAY['returns'], 'queued');
    `);

    // Reset due time to ensure deterministic evaluation by the direct assign call
    await directPool.query(`UPDATE ticket_routing_queue SET next_routing_attempt_at = NOW() WHERE id = 'q_bridge_open'`);
    const bridgeAssignRes = await assignQueuedTicketAtomically('brand_novacart');
    assert.strictEqual(bridgeAssignRes.assigned, false);
    assert.strictEqual(bridgeAssignRes.reason, 'NO_ELIGIBLE_AGENT_AVAILABLE', 'Translation-dependent routing must be blocked when breaker is OPEN');

    // 5e: HALF_OPEN Mutex, Probe Recovery to CLOSED, and Resumption of English bridge routing
    console.log('  [5e] Circuit Breaker: HALF_OPEN probe mutex and recovery verification...');
    // Fast forward cooldown to make probe available
    translationBreaker.nextProbeAt = Date.now() - 1000;

    // Simulate 3 concurrent translation requests attempting the recovery probe
    const probeAttempts = [
      translationBreaker.canAttemptTranslation(),
      translationBreaker.canAttemptTranslation(),
      translationBreaker.canAttemptTranslation()
    ];
    // Exactly one attempt must be granted the probe slot!
    const grantedProbes = probeAttempts.filter(p => p === true);
    const deniedProbes = probeAttempts.filter(p => p === false);
    assert.strictEqual(grantedProbes.length, 1, 'HALF_OPEN mutex must grant exactly ONE probe slot');
    assert.strictEqual(deniedProbes.length, 2, 'Concurrent requests must be blocked from acquiring multiple probe slots');
    assert.strictEqual(translationBreaker.state, 'HALF_OPEN');

    // While probe is in flight, isOperational() must STILL return false (routing cannot sneak in)
    assert.strictEqual(translationBreaker.isOperational(), false, 'isOperational must remain FALSE during HALF_OPEN probe');

    // Ticket routing attempt for de-DE ticket is still blocked
    await directPool.query(`UPDATE ticket_routing_queue SET next_routing_attempt_at = NOW() WHERE id = 'q_bridge_open'`);
    const stillBlockedAssign = await assignQueuedTicketAtomically('brand_novacart');
    assert.strictEqual(stillBlockedAssign.assigned, false);
    assert.strictEqual(stillBlockedAssign.reason, 'NO_ELIGIBLE_AGENT_AVAILABLE');

    // Probe succeeds! Call recordSuccess()
    translationBreaker.recordSuccess();
    assert.strictEqual(translationBreaker.state, 'CLOSED');
    assert.strictEqual(translationBreaker.isOperational(), true, 'Breaker is now fully operational');

    // Now de-DE bridge ticket routing immediately succeeds!
    await directPool.query(`UPDATE ticket_routing_queue SET next_routing_attempt_at = NOW() WHERE id = 'q_bridge_open'`);
    const recoveredAssign = await assignQueuedTicketAtomically('brand_novacart');
    assert.strictEqual(recoveredAssign.assigned, true);
    assert.strictEqual(recoveredAssign.ticketId, 'tkt_bridge_open');
    assert.strictEqual(recoveredAssign.agentId, 'user_sarah_lin', 'Bridge routing resumes immediately after probe success closes breaker');

    // Clean up
    await resolveTicketAndReleaseCapacity({ brandId: 'brand_novacart', ticketId: 'tkt_bridge_open' });

    console.log('[PASS] Test 5: 5-Tier candidate matching and translation circuit breaker integration verified.');

    // -------------------------------------------------------------------------
    // TEST 6: Concurrency Limits, Stale Heartbeat, and Deactivation Exclusions
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 6: Concurrency Limits, Heartbeat Timeout & Deactivation Exclusions ---');
    // 6a: Agent at maximum concurrent tickets
    console.log('  [6a] Agent at max concurrent tickets must be excluded...');
    await directPool.query(`
      UPDATE agent_profiles
      SET active_ticket_count = 3, max_concurrent_tickets = 3
      WHERE user_id = 'user_sarah_lin';
    `);

    await directPool.query(`
      INSERT INTO tickets (id, brand_id, customer_id, category, priority, status, human_requested, summary, last_updated)
      VALUES ('tkt_cap_test', 'brand_novacart', 'cust_aarav', 'returns', 'High', 'Human Requested', TRUE, 'Capacity test', NOW());
      INSERT INTO ticket_routing_queue (id, brand_id, ticket_id, customer_id, priority, customer_language, required_skills, status)
      VALUES ('q_cap_test', 'brand_novacart', 'tkt_cap_test', 'cust_aarav', 'High', 'hi-IN', ARRAY['damages'], 'queued');
    `);

    // Sarah has damages and hi-IN, but is at max capacity (3/3). Carlos does not have damages or hi-IN.
    const capAssign = await assignQueuedTicketAtomically('brand_novacart', { translationAvailable: false });
    assert.strictEqual(capAssign.assigned, false);
    assert.strictEqual(capAssign.reason, 'NO_ELIGIBLE_AGENT_AVAILABLE');

    // 6b: Stale heartbeat (> 120s) must be excluded
    console.log('  [6b] Agent with stale heartbeat (>120s) must be excluded...');
    await directPool.query(`
      UPDATE ticket_routing_queue SET next_routing_attempt_at = NOW() WHERE id = 'q_cap_test';
      UPDATE agent_profiles
      SET active_ticket_count = 1, max_concurrent_tickets = 3, last_heartbeat_at = NOW() - INTERVAL '150 seconds'
      WHERE user_id = 'user_sarah_lin';
    `);

    const hbAssign = await assignQueuedTicketAtomically('brand_novacart', { translationAvailable: false });
    assert.strictEqual(hbAssign.assigned, false);
    assert.strictEqual(hbAssign.reason, 'NO_ELIGIBLE_AGENT_AVAILABLE');

    // 6c: Deactivated brand membership must be excluded
    console.log('  [6c] Agent with deactivated membership must be excluded...');
    await directPool.query(`
      UPDATE ticket_routing_queue SET next_routing_attempt_at = NOW() WHERE id = 'q_cap_test';
      UPDATE agent_profiles
      SET last_heartbeat_at = NOW()
      WHERE user_id = 'user_sarah_lin';
      UPDATE brand_memberships
      SET deactivated_at = NOW()
      WHERE brand_id = 'brand_novacart' AND user_id = 'user_sarah_lin';
    `);

    const deactAssign = await assignQueuedTicketAtomically('brand_novacart', { translationAvailable: false });
    assert.strictEqual(deactAssign.assigned, false);
    assert.strictEqual(deactAssign.reason, 'NO_ELIGIBLE_AGENT_AVAILABLE');

    // Restore Sarah Lin membership and availability
    await directPool.query(`
      UPDATE brand_memberships SET deactivated_at = NULL WHERE brand_id = 'brand_novacart' AND user_id = 'user_sarah_lin';
      UPDATE agent_profiles SET configured_status = 'Available', last_heartbeat_at = NOW(), active_ticket_count = 0 WHERE user_id = 'user_sarah_lin';
    `);

    // 6d: Concurrent Assignment Capacity Capping: 10 concurrent workers on agent with cap 2
    console.log('  [6d] Concurrent Assignment Capacity Capping: 10 concurrent workers on agent with cap 2...');
    await directPool.query(`
      UPDATE agent_profiles SET configured_status = 'Available', last_heartbeat_at = NOW(), active_ticket_count = 0, max_concurrent_tickets = 2 WHERE user_id = 'user_sarah_lin';
      UPDATE agent_profiles SET configured_status = 'Offline' WHERE user_id = 'user_carlos';
      DELETE FROM ticket_routing_queue WHERE brand_id = 'brand_novacart';
    `);

    // Create 10 queued tickets requiring Sarah's skills
    for (let i = 0; i < 10; i++) {
      const tid = `tkt_cap_stress_${i}`;
      const qid = `q_cap_stress_${i}`;
      await directPool.query(`
        INSERT INTO tickets (id, brand_id, customer_id, category, priority, status, human_requested, summary, last_updated)
        VALUES ($1, 'brand_novacart', 'cust_aarav', 'returns', 'High', 'Human Requested', TRUE, 'Cap stress', NOW())
        ON CONFLICT (brand_id, id) DO UPDATE SET status = 'Human Requested', human_requested = TRUE, assigned_agent_id = NULL;
      `, [tid]);
      await directPool.query(`
        INSERT INTO ticket_routing_queue (id, brand_id, ticket_id, customer_id, priority, customer_language, required_skills, status)
        VALUES ($1, 'brand_novacart', $2, 'cust_aarav', 'High', 'en-US', ARRAY['returns'], 'queued')
        ON CONFLICT (id) DO UPDATE SET status = 'queued', assigned_agent_id = NULL, next_routing_attempt_at = NOW();
      `, [qid, tid]);
    }

    // Launch 10 concurrent assignment workers
    const assignWorkers = Array.from({ length: 10 }, () => assignQueuedTicketAtomically('brand_novacart', { translationAvailable: true }));
    const assignOutcomes = await Promise.all(assignWorkers);

    const assignedCount = assignOutcomes.filter(r => r.assigned === true).length;
    const rejectedCount = assignOutcomes.filter(r => r.assigned === false && r.reason === 'NO_ELIGIBLE_AGENT_AVAILABLE').length;

    assert.strictEqual(assignedCount, 2, `Exactly 2 tickets must be assigned to Sarah (capacity = 2), got ${assignedCount}`);
    assert.strictEqual(rejectedCount, 8, `Exactly 8 requests must be rejected when capacity reached, got ${rejectedCount}`);

    const sarahCapCheck = (await directPool.query(`SELECT active_ticket_count FROM agent_profiles WHERE user_id = 'user_sarah_lin'`)).rows[0];
    assert.strictEqual(sarahCapCheck.active_ticket_count, 2, 'active_ticket_count must strictly equal 2');

    // Clean up capacity test tickets and restore standard settings
    await directPool.query(`DELETE FROM ticket_routing_queue WHERE brand_id = 'brand_novacart'`);
    await directPool.query(`UPDATE agent_profiles SET configured_status = 'Available', active_ticket_count = 0, max_concurrent_tickets = 3 WHERE user_id = 'user_sarah_lin'`);
    await directPool.query(`UPDATE agent_profiles SET configured_status = 'Available', active_ticket_count = 0, max_concurrent_tickets = 3 WHERE user_id = 'user_carlos'`);

    console.log('[PASS] Test 6: Concurrency, heartbeat, deactivation, and capacity capping constraints verified.');

    // -------------------------------------------------------------------------
    // TEST 7: Ticket Resolution, Capacity Release & Counter Reconciliation
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 7: Ticket Resolution, Capacity Release & Counter Reconciliation ---');
    // Assign a ticket to Sarah Lin
    await directPool.query(`
      UPDATE tickets
      SET status = 'Human Agent Active', assigned_agent_id = 'user_sarah_lin', human_requested = TRUE
      WHERE id = 'tkt_cap_test';
      INSERT INTO ticket_routing_queue (id, brand_id, ticket_id, customer_id, priority, customer_language, required_skills, status, assigned_agent_id, assigned_at)
      VALUES ('q_cap_test', 'brand_novacart', 'tkt_cap_test', 'cust_aarav', 'High', 'en-US', ARRAY['returns'], 'assigned', 'user_sarah_lin', NOW())
      ON CONFLICT (id) DO UPDATE SET status = 'assigned', assigned_agent_id = 'user_sarah_lin', assigned_at = NOW();
      UPDATE agent_profiles
      SET active_ticket_count = 1
      WHERE user_id = 'user_sarah_lin';
    `);

    // 7a: Normal resolution: queue closed, ticket resolved, capacity decremented
    console.log('  [7a] Resolving ticket and releasing capacity...');
    const resResult = await resolveTicketAndReleaseCapacity({
      brandId: 'brand_novacart',
      ticketId: 'tkt_cap_test'
    });
    assert.strictEqual(resResult.success, true);
    assert.strictEqual(resResult.status, 'Resolved');

    const sarahAfterRes = (await directPool.query(`SELECT active_ticket_count FROM agent_profiles WHERE user_id = 'user_sarah_lin'`)).rows[0];
    assert.strictEqual(sarahAfterRes.active_ticket_count, 0, 'Capacity must decrement to 0');

    const qAfterRes = (await directPool.query(`SELECT status, closed_at FROM ticket_routing_queue WHERE ticket_id = 'tkt_cap_test'`)).rows[0];
    assert.strictEqual(qAfterRes.status, 'closed');
    assert.ok(qAfterRes.closed_at !== null);

    // 7b: Idempotent resolution does not decrement again
    console.log('  [7b] Idempotent repeat resolution does not double-decrement...');
    await resolveTicketAndReleaseCapacity({
      brandId: 'brand_novacart',
      ticketId: 'tkt_cap_test'
    });
    const sarahRepeat = (await directPool.query(`SELECT active_ticket_count FROM agent_profiles WHERE user_id = 'user_sarah_lin'`)).rows[0];
    assert.strictEqual(sarahRepeat.active_ticket_count, 0);

    // 7c: Counter anomaly reconciliation on resolution (when active_ticket_count <= 0)
    console.log('  [7c] Counter anomaly reconciliation when counter is <= 0 on resolution...');
    // Create an assigned ticket for Sarah, but intentionally force her active_ticket_count to 0
    await directPool.query(`
      INSERT INTO tickets (id, brand_id, customer_id, category, priority, status, assigned_agent_id, human_requested, summary, last_updated)
      VALUES ('tkt_anomaly_1', 'brand_novacart', 'cust_aarav', 'returns', 'Medium', 'Human Agent Active', 'user_sarah_lin', TRUE, 'Anomaly test', NOW());
      INSERT INTO ticket_routing_queue (id, brand_id, ticket_id, customer_id, priority, customer_language, required_skills, status, assigned_agent_id)
      VALUES ('q_anomaly_1', 'brand_novacart', 'tkt_anomaly_1', 'cust_aarav', 'Medium', 'en-US', ARRAY['returns'], 'assigned', 'user_sarah_lin');
      UPDATE agent_profiles SET active_ticket_count = 0 WHERE user_id = 'user_sarah_lin';
    `);

    // Resolving tkt_anomaly_1 should trigger counter anomaly reconciliation!
    await resolveTicketAndReleaseCapacity({
      brandId: 'brand_novacart',
      ticketId: 'tkt_anomaly_1'
    });

    // Verify reconciliation occurred: agent_status_history has a 'reconciliation' row
    const reconAudit = await directPool.query(`
      SELECT trigger_source, reason FROM agent_status_history
      WHERE user_id = 'user_sarah_lin' AND trigger_source = 'reconciliation'
      ORDER BY created_at DESC LIMIT 1;
    `);
    assert.strictEqual(reconAudit.rows.length, 1);
    assert.strictEqual(reconAudit.rows[0].trigger_source, 'reconciliation');
    console.log('[Reconciliation Audit Log]:', reconAudit.rows[0].reason);

    console.log('[PASS] Test 7: Resolution, capacity release, and counter reconciliation verified.');

    // -------------------------------------------------------------------------
    // TEST 8: Ticket Transfer & Alphabetical Agent Locking
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 8: Ticket Transfer & Alphabetical Agent Locking ---');
    // Set up ticket assigned to Sarah Lin to be transferred to Carlos
    await directPool.query(`
      UPDATE agent_profiles SET configured_status = 'Available', last_heartbeat_at = NOW(), active_ticket_count = 1 WHERE user_id = 'user_sarah_lin';
      UPDATE agent_profiles SET configured_status = 'Available', last_heartbeat_at = NOW(), active_ticket_count = 0 WHERE user_id = 'user_carlos';
      INSERT INTO tickets (id, brand_id, customer_id, category, priority, status, assigned_agent_id, human_requested, summary, last_updated)
      VALUES ('tkt_transfer_1', 'brand_novacart', 'cust_aarav', 'returns', 'High', 'Human Agent Active', 'user_sarah_lin', TRUE, 'Transfer test', NOW());
      INSERT INTO ticket_routing_queue (id, brand_id, ticket_id, customer_id, priority, customer_language, required_skills, status, assigned_agent_id)
      VALUES ('q_transfer_1', 'brand_novacart', 'tkt_transfer_1', 'cust_aarav', 'High', 'en-US', ARRAY['returns'], 'assigned', 'user_sarah_lin');
    `);

    const transferRes = await transferTicketAtomically({
      brandId: 'brand_novacart',
      ticketId: 'tkt_transfer_1',
      fromAgentId: 'user_sarah_lin',
      toAgentId: 'user_carlos',
      handoffSummaryJson: {
        customerIntent: 'Return defective headphones',
        attemptedTroubleshooting: 'Verified purchase date',
        nextAction: 'Issue return RMA label'
      },
      internalNotes: 'Customer verified order receipt.'
    });

    assert.strictEqual(transferRes.success, true);
    assert.strictEqual(transferRes.fromAgentId, 'user_sarah_lin');
    assert.strictEqual(transferRes.toAgentId, 'user_carlos');

    // Verify ticket reassigned to Carlos
    const tktTransfer = (await directPool.query(`SELECT assigned_agent_id FROM tickets WHERE id = 'tkt_transfer_1'`)).rows[0];
    assert.strictEqual(tktTransfer.assigned_agent_id, 'user_carlos');

    // Verify queue reassigned to Carlos
    const qTransfer = (await directPool.query(`SELECT assigned_agent_id FROM ticket_routing_queue WHERE ticket_id = 'tkt_transfer_1'`)).rows[0];
    assert.strictEqual(qTransfer.assigned_agent_id, 'user_carlos');

    // Verify Sarah decremented (1 -> 0) and Carlos incremented (0 -> 1)
    const sarahCnt = (await directPool.query(`SELECT active_ticket_count FROM agent_profiles WHERE user_id = 'user_sarah_lin'`)).rows[0].active_ticket_count;
    const carlosCnt = (await directPool.query(`SELECT active_ticket_count FROM agent_profiles WHERE user_id = 'user_carlos'`)).rows[0].active_ticket_count;
    assert.strictEqual(sarahCnt, 0);
    assert.strictEqual(carlosCnt, 1);

    // Verify handoff summary was persisted in ticket_handoff_summaries
    const handoffRow = (await directPool.query(`SELECT * FROM ticket_handoff_summaries WHERE id = $1`, [transferRes.handoffId])).rows[0];
    assert.strictEqual(handoffRow.ticket_id, 'tkt_transfer_1');
    assert.strictEqual(handoffRow.from_agent_id, 'user_sarah_lin');
    assert.strictEqual(handoffRow.to_agent_id, 'user_carlos');
    assert.strictEqual(handoffRow.ai_summary_json.customerIntent, 'Return defective headphones');
    assert.strictEqual(handoffRow.internal_notes, 'Customer verified order receipt.');

    // Verify self-transfer is rejected
    let selfTransferRejected = false;
    try {
      await transferTicketAtomically({
        brandId: 'brand_novacart',
        ticketId: 'tkt_transfer_1',
        fromAgentId: 'user_carlos',
        toAgentId: 'user_carlos'
      });
    } catch (err) {
      selfTransferRejected = true;
      assert.ok(err.message.includes('target agent cannot be the same'));
    }
    assert.ok(selfTransferRejected, 'Self-transfer must be rejected');

    // 8c: Failed Transfer Atomicity & Rollback
    console.log('  [8c] Failed Transfer Atomicity: Target agent at capacity must roll back all mutations...');
    // Sarah has tkt_transfer_fail assigned. Carlos has active_ticket_count = 3, max_concurrent_tickets = 3 (Full capacity).
    await directPool.query(`
      UPDATE agent_profiles SET configured_status = 'Available', last_heartbeat_at = NOW(), active_ticket_count = 1 WHERE user_id = 'user_sarah_lin';
      UPDATE agent_profiles SET configured_status = 'Available', last_heartbeat_at = NOW(), active_ticket_count = 3, max_concurrent_tickets = 3 WHERE user_id = 'user_carlos';
      INSERT INTO tickets (id, brand_id, customer_id, category, priority, status, assigned_agent_id, human_requested, summary, last_updated)
      VALUES ('tkt_transfer_fail', 'brand_novacart', 'cust_aarav', 'returns', 'High', 'Human Agent Active', 'user_sarah_lin', TRUE, 'Fail transfer test', NOW())
      ON CONFLICT (brand_id, id) DO UPDATE SET assigned_agent_id = 'user_sarah_lin', status = 'Human Agent Active';
      INSERT INTO ticket_routing_queue (id, brand_id, ticket_id, customer_id, priority, customer_language, required_skills, status, assigned_agent_id)
      VALUES ('q_transfer_fail', 'brand_novacart', 'tkt_transfer_fail', 'cust_aarav', 'High', 'en-US', ARRAY['returns'], 'assigned', 'user_sarah_lin')
      ON CONFLICT (id) DO UPDATE SET status = 'assigned', assigned_agent_id = 'user_sarah_lin';
    `);

    const handoffCountBefore = (await directPool.query(`SELECT COUNT(*) FROM ticket_handoff_summaries WHERE ticket_id = 'tkt_transfer_fail'`)).rows[0].count;

    let transferFailedCaught = false;
    try {
      await transferTicketAtomically({
        brandId: 'brand_novacart',
        ticketId: 'tkt_transfer_fail',
        fromAgentId: 'user_sarah_lin',
        toAgentId: 'user_carlos',
        handoffSummaryJson: { reason: 'Will fail' },
        internalNotes: 'Should not persist'
      });
    } catch (err) {
      transferFailedCaught = true;
      assert.ok(err.message.includes('Target agent is at maximum capacity'));
    }
    assert.ok(transferFailedCaught, 'Transfer to full agent must throw error');

    // Assert that EVERYTHING rolled back cleanly:
    const tktAfterFail = (await directPool.query(`SELECT assigned_agent_id, status FROM tickets WHERE id = 'tkt_transfer_fail'`)).rows[0];
    assert.strictEqual(tktAfterFail.assigned_agent_id, 'user_sarah_lin', 'Ticket assignment must remain with source agent');

    const qAfterFail = (await directPool.query(`SELECT assigned_agent_id, status FROM ticket_routing_queue WHERE ticket_id = 'tkt_transfer_fail'`)).rows[0];
    assert.strictEqual(qAfterFail.assigned_agent_id, 'user_sarah_lin', 'Queue assignment must remain with source agent');

    const sarahAfterFail = (await directPool.query(`SELECT active_ticket_count FROM agent_profiles WHERE user_id = 'user_sarah_lin'`)).rows[0].active_ticket_count;
    const carlosAfterFail = (await directPool.query(`SELECT active_ticket_count FROM agent_profiles WHERE user_id = 'user_carlos'`)).rows[0].active_ticket_count;
    assert.strictEqual(sarahAfterFail, 1, 'Source agent capacity counter must remain unchanged');
    assert.strictEqual(carlosAfterFail, 3, 'Target agent capacity counter must remain unchanged');

    const handoffCountAfter = (await directPool.query(`SELECT COUNT(*) FROM ticket_handoff_summaries WHERE ticket_id = 'tkt_transfer_fail'`)).rows[0].count;
    assert.strictEqual(handoffCountAfter, handoffCountBefore, 'No handoff record must be created on failed transfer');
    console.log('  [PASS] Failed transfer cleanly rolled back all mutations.');

    console.log('[PASS] Test 8: Ticket transfer, handoff summaries, and failed transfer rollback verified.');

    // -------------------------------------------------------------------------
    // TEST 9: Standalone Capacity Reconciliation
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 9: Standalone Capacity Reconciliation ---');
    // Artificially corrupt Carlos active_ticket_count to 99
    await directPool.query(`UPDATE agent_profiles SET active_ticket_count = 99 WHERE user_id = 'user_carlos'`);
    const reconStandalone = await reconcileAgentCapacity({
      brandId: 'brand_novacart',
      userId: 'user_carlos'
    });
    assert.strictEqual(reconStandalone.reconciled, true);
    assert.strictEqual(reconStandalone.previousCount, 99);
    assert.strictEqual(reconStandalone.newCount, 2); // 2 active tickets (tkt_tier1 and tkt_transfer_1)

    const carlosCorrected = (await directPool.query(`SELECT active_ticket_count FROM agent_profiles WHERE user_id = 'user_carlos'`)).rows[0].active_ticket_count;
    assert.strictEqual(carlosCorrected, 2);
    console.log('[PASS] Test 9: Standalone capacity reconciliation verified.');

    // -------------------------------------------------------------------------
    // TEST 10: Concurrent Execution, Opposing Transfers & Deadlock Freedom
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 10: Concurrent Execution, Opposing Transfers & Deadlock Freedom ---');

    // 10a: Opposing Concurrent Transfers
    console.log('  [10a] Opposing concurrent transfers (Sarah -> Carlos AND Carlos -> Sarah)...');
    await directPool.query(`
      UPDATE agent_profiles SET configured_status = 'Available', last_heartbeat_at = NOW(), active_ticket_count = 1, max_concurrent_tickets = 5 WHERE user_id = 'user_sarah_lin';
      UPDATE agent_profiles SET configured_status = 'Available', last_heartbeat_at = NOW(), active_ticket_count = 1, max_concurrent_tickets = 5 WHERE user_id = 'user_carlos';
      DELETE FROM ticket_routing_queue WHERE brand_id = 'brand_novacart';

      -- Ticket 1 assigned to Sarah
      INSERT INTO tickets (id, brand_id, customer_id, category, priority, status, assigned_agent_id, human_requested, summary, last_updated)
      VALUES ('tkt_opp_1', 'brand_novacart', 'cust_aarav', 'returns', 'High', 'Human Agent Active', 'user_sarah_lin', TRUE, 'Opposing 1', NOW())
      ON CONFLICT (brand_id, id) DO UPDATE SET assigned_agent_id = 'user_sarah_lin', status = 'Human Agent Active';
      INSERT INTO ticket_routing_queue (id, brand_id, ticket_id, customer_id, priority, customer_language, required_skills, status, assigned_agent_id)
      VALUES ('q_opp_1', 'brand_novacart', 'tkt_opp_1', 'cust_aarav', 'High', 'en-US', ARRAY['returns'], 'assigned', 'user_sarah_lin')
      ON CONFLICT (id) DO UPDATE SET status = 'assigned', assigned_agent_id = 'user_sarah_lin';

      -- Ticket 2 assigned to Carlos
      INSERT INTO tickets (id, brand_id, customer_id, category, priority, status, assigned_agent_id, human_requested, summary, last_updated)
      VALUES ('tkt_opp_2', 'brand_novacart', 'cust_priya', 'returns', 'High', 'Human Agent Active', 'user_carlos', TRUE, 'Opposing 2', NOW())
      ON CONFLICT (brand_id, id) DO UPDATE SET assigned_agent_id = 'user_carlos', status = 'Human Agent Active';
      INSERT INTO ticket_routing_queue (id, brand_id, ticket_id, customer_id, priority, customer_language, required_skills, status, assigned_agent_id)
      VALUES ('q_opp_2', 'brand_novacart', 'tkt_opp_2', 'cust_priya', 'High', 'es-ES', ARRAY['returns'], 'assigned', 'user_carlos')
      ON CONFLICT (id) DO UPDATE SET status = 'assigned', assigned_agent_id = 'user_carlos';
    `);

    // Run opposing transfers simultaneously
    const opposingRes = await Promise.allSettled([
      transferTicketAtomically({
        brandId: 'brand_novacart',
        ticketId: 'tkt_opp_1',
        fromAgentId: 'user_sarah_lin',
        toAgentId: 'user_carlos',
        handoffSummaryJson: { notes: 'Opposing transfer 1' }
      }),
      transferTicketAtomically({
        brandId: 'brand_novacart',
        ticketId: 'tkt_opp_2',
        fromAgentId: 'user_carlos',
        toAgentId: 'user_sarah_lin',
        handoffSummaryJson: { notes: 'Opposing transfer 2' }
      })
    ]);

    const opposingDeadlocks = opposingRes.filter(r => r.status === 'rejected' && r.reason?.code === '40P01');
    assert.strictEqual(opposingDeadlocks.length, 0, `Opposing transfers must not deadlock (40P01), found ${opposingDeadlocks.length}`);
    assert.strictEqual(opposingRes[0].status, 'fulfilled', `Transfer 1 failed: ${opposingRes[0].reason?.message}`);
    assert.strictEqual(opposingRes[1].status, 'fulfilled', `Transfer 2 failed: ${opposingRes[1].reason?.message}`);

    // Verify tickets swapped agents
    const tkt1After = (await directPool.query(`SELECT assigned_agent_id FROM tickets WHERE id = 'tkt_opp_1'`)).rows[0];
    const tkt2After = (await directPool.query(`SELECT assigned_agent_id FROM tickets WHERE id = 'tkt_opp_2'`)).rows[0];
    assert.strictEqual(tkt1After.assigned_agent_id, 'user_carlos');
    assert.strictEqual(tkt2After.assigned_agent_id, 'user_sarah_lin');
    console.log('  [PASS] Opposing transfers succeeded concurrently with ZERO deadlocks.');

    // 10b: Mixed Concurrency Stress Test across 10 Tickets
    console.log('  [10b] Mixed concurrency stress test (simultaneous enqueue, routing, resolution, reconciliation)...');
    await directPool.query(`
      UPDATE tickets SET status = 'Resolved' WHERE brand_id = 'brand_novacart' AND status IN ('Human Requested', 'Human Agent Active');
      DELETE FROM ticket_routing_queue WHERE brand_id = 'brand_novacart';
      UPDATE agent_profiles SET configured_status = 'Available', last_heartbeat_at = NOW(), active_ticket_count = 0, max_concurrent_tickets = 10 WHERE user_id = 'user_sarah_lin';
      UPDATE agent_profiles SET configured_status = 'Available', last_heartbeat_at = NOW(), active_ticket_count = 0, max_concurrent_tickets = 10 WHERE user_id = 'user_carlos';
    `);

    // Create 10 tickets
    for (let i = 0; i < 10; i++) {
      const tid = `tkt_conc_${i}`;
      await directPool.query(`
        INSERT INTO tickets (id, brand_id, customer_id, category, priority, status, human_requested, summary, last_updated)
        VALUES ($1, 'brand_novacart', 'cust_aarav', 'general_inquiry', 'High', 'AI Handling', FALSE, 'Stress', NOW())
        ON CONFLICT (brand_id, id) DO UPDATE SET status = 'AI Handling', human_requested = FALSE, assigned_agent_id = NULL;
      `, [tid]);
    }

    // Concurrently execute enqueue, assignment, resolution, and reconciliation
    const tasks = [];
    for (let i = 0; i < 10; i++) {
      const tid = `tkt_conc_${i}`;
      tasks.push((async () => {
        // Enqueue
        await enqueueOrReopenTicket({
          brandId: 'brand_novacart',
          ticketId: tid,
          priority: 'High',
          customerLanguage: 'en-US',
          requiredSkills: ['general_inquiry']
        });

        // Assign
        const assignRes = await assignQueuedTicketAtomically('brand_novacart', { translationAvailable: true });

        // Resolve (if assigned)
        if (assignRes.assigned && assignRes.ticketId === tid) {
          // Half resolve immediately, half remain active to test active capacity consistency
          if (i % 2 === 0) {
            await resolveTicketAndReleaseCapacity({
              brandId: 'brand_novacart',
              ticketId: tid
            });
          }
        }
      })());
    }

    // Add concurrent capacity reconciliation workers into the mix
    tasks.push(reconcileAgentCapacity({ brandId: 'brand_novacart', userId: 'user_sarah_lin' }));
    tasks.push(reconcileAgentCapacity({ brandId: 'brand_novacart', userId: 'user_carlos' }));

    const results = await Promise.allSettled(tasks);
    const deadlocks = results.filter(r => r.status === 'rejected' && r.reason?.code === '40P01');
    assert.strictEqual(deadlocks.length, 0, `Expected 0 deadlocks (40P01), found ${deadlocks.length}`);
    console.log(`  [Concurrent Execution]: Completed ${tasks.length} concurrent operation sets with ZERO deadlocks.`);

    // 10c: Final Database Consistency Audit
    console.log('  [10c] Final Database Consistency Audit: verifying active_ticket_count matches committed active tickets...');
    // Sarah committed active tickets:
    const sarahCommitted = (await directPool.query(`
      SELECT COUNT(*)::INTEGER AS count FROM tickets
      WHERE brand_id = 'brand_novacart' AND assigned_agent_id = 'user_sarah_lin' AND status IN ('Human Requested', 'Human Agent Active')
    `)).rows[0].count;

    const sarahProfileCount = (await directPool.query(`
      SELECT active_ticket_count FROM agent_profiles WHERE brand_id = 'brand_novacart' AND user_id = 'user_sarah_lin'
    `)).rows[0].active_ticket_count;

    assert.strictEqual(sarahProfileCount, sarahCommitted, `Sarah active_ticket_count (${sarahProfileCount}) must match committed active tickets (${sarahCommitted})`);

    // Carlos committed active tickets:
    const carlosCommitted = (await directPool.query(`
      SELECT COUNT(*)::INTEGER AS count FROM tickets
      WHERE brand_id = 'brand_novacart' AND assigned_agent_id = 'user_carlos' AND status IN ('Human Requested', 'Human Agent Active')
    `)).rows[0].count;

    const carlosProfileCount = (await directPool.query(`
      SELECT active_ticket_count FROM agent_profiles WHERE brand_id = 'brand_novacart' AND user_id = 'user_carlos'
    `)).rows[0].active_ticket_count;

    assert.strictEqual(carlosProfileCount, carlosCommitted, `Carlos active_ticket_count (${carlosProfileCount}) must match committed active tickets (${carlosCommitted})`);

    console.log(`  [Final Consistency Audit Passed]: Sarah committed=${sarahCommitted}, profile=${sarahProfileCount}; Carlos committed=${carlosCommitted}, profile=${carlosProfileCount}`);
    console.log('[PASS] Test 10: Concurrency safety, opposing transfers, and final database consistency verified.');

    // Wait for any trailing debounced scheduler setImmediate cycles to complete
    await new Promise(resolve => setTimeout(resolve, 500));

    console.log('\n================================================================================');
    console.log('=== [ALL 10 CHECKPOINT E2-B1 INTEGRATION TESTS PASSED SUCCESSFULLY] ===');
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
      // Clean up test backup files created during run
      const dataDir = path.resolve(ROOT_DIR, 'server/data');
      if (fs.existsSync(dataDir)) {
        const files = fs.readdirSync(dataDir);
        for (const f of files) {
          if (f.startsWith('tickets.backup.')) {
            try { fs.unlinkSync(path.join(dataDir, f)); } catch (e) {}
          }
        }
      }
      console.log('[PG16 Teardown] Completed cleanly.');
    } catch (e) {}
  }
}

runE2B1Tests().catch(err => {
  console.error('\n[FATAL TEST FAILURE]:', err);
  process.exit(1);
});
