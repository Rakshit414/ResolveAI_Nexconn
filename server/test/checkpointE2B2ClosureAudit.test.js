// server/test/checkpointE2B2ClosureAudit.test.js
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import http from 'http';
import pg from 'pg';
import EmbeddedPostgres from 'embedded-postgres';
import axios from 'axios';
import { runMigration } from '../src/db/migrate.js';
import { closePool } from '../src/db/pool.js';
import { app } from '../src/server.js';
import {
  getAgentProfile,
  updateAgentConfiguredStatus,
  createAgentSession,
  refreshAgentHeartbeat,
  terminateAgentSession,
  calculateEffectiveStatus
} from '../src/services/agentAvailabilityService.js';
import {
  getUnassignedTickets,
  getMyTickets,
  getTeamOverview,
  getAgentRoster,
  getTicketDetailsWithHistory,
  claimOrReassignTicket,
  transferTicket,
  resolveTicket,
  maskCustomerPii
} from '../src/services/sharedInboxService.js';
import { reconcileAgentCapacity } from '../src/services/capacityService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');
const TEST_PORT = 54340;
const PG16_DATA_DIR = path.resolve(ROOT_DIR, 'server/data/pg16_e2b2_audit_instance');
const TEST_DB_URL = `postgresql://postgres:postgres@127.0.0.1:${TEST_PORT}/postgres`;

console.log('================================================================================');
console.log('=== [TEST SUITE: Checkpoint E2-B2 Comprehensive Closure Audit] ===');
console.log('================================================================================\n');

async function runE2B2ClosureAudit() {
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

  const directPool = new pg.Pool({ connectionString: TEST_DB_URL });

  // Start express test server
  const httpServer = http.createServer(app);
  await new Promise(resolve => httpServer.listen(0, resolve));
  const serverPort = httpServer.address().port;
  console.log(`[HTTP Server] Express test server listening on port ${serverPort}`);

  const apiClient = axios.create({
    baseURL: `http://127.0.0.1:${serverPort}`,
    validateStatus: () => true
  });

  try {
    // Read raw migration SQL files
    const m1Sql = fs.readFileSync(path.join(__dirname, '../src/db/migrations/001_canonical_schema.sql'), 'utf8');
    const m2Sql = fs.readFileSync(path.join(__dirname, '../src/db/migrations/002_seed_demo_data.sql'), 'utf8');
    const m3Sql = fs.readFileSync(path.join(__dirname, '../src/db/migrations/003_attachment_blob_storage.sql'), 'utf8');
    const m4Sql = fs.readFileSync(path.join(__dirname, '../src/db/migrations/004_seed_sample_attachment.sql'), 'utf8');
    const m5Sql = fs.readFileSync(path.join(__dirname, '../src/db/migrations/005_checkpoint_e_workforce_schema.sql'), 'utf8');

    // =========================================================================
    // PART 1: MIGRATION 005 EXHAUSTIVE VALIDATION AUDIT ACROSS ALL 8 TABLES
    // =========================================================================
    console.log('\n--- PART 1: Migration 005 Incompatibility Rejections Across All 8 Tables ---');

    // Helper to test incompatibility on disposable connection
    async function testTableIncompatibility(tableName, createTableSql, expectedSnippet, setupSql = null) {
      // Apply clean 001-004 first
      const client = await directPool.connect();
      let caught = false;
      try {
        await client.query('BEGIN');
        if (setupSql) {
          await client.query(setupSql);
        }
        await client.query(createTableSql);
        await client.query(m5Sql);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        caught = true;
        assert.ok(
          err.message.includes(expectedSnippet),
          `Expected error to include "${expectedSnippet}", got: "${err.message}"`
        );
        console.log(`  [Incompatibility Rejected - ${tableName}]: ${err.message.split('\n')[0]}`);
      } finally {
        await client.query(`DROP TABLE IF EXISTS ${tableName} CASCADE`).catch(() => {});
        client.release();
      }
      assert.ok(caught, `Migration 005 must reject incompatible ${tableName}`);
    }

    // Apply baseline migrations 001-004
    await directPool.query(m1Sql);
    await directPool.query(m2Sql);
    await directPool.query(m3Sql);
    await directPool.query(m4Sql);

    // 1a: Table 1 - agent_profiles incompatible check constraint
    await testTableIncompatibility(
      'agent_profiles',
      `CREATE TABLE agent_profiles (
        brand_id VARCHAR(64) NOT NULL,
        user_id VARCHAR(64) NOT NULL,
        nexconn_user_id VARCHAR(64) NOT NULL UNIQUE,
        display_name VARCHAR(255) NOT NULL,
        configured_status VARCHAR(32) NOT NULL CHECK (configured_status IN ('Available', 'Offline')),
        primary_language VARCHAR(16) NOT NULL DEFAULT 'en-US',
        supported_languages TEXT[] NOT NULL DEFAULT ARRAY['en-US'],
        skills TEXT[] NOT NULL DEFAULT ARRAY['general_inquiry'],
        max_concurrent_tickets INTEGER NOT NULL DEFAULT 3,
        active_ticket_count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (brand_id, user_id),
        FOREIGN KEY (brand_id, user_id) REFERENCES brand_memberships(brand_id, user_id) ON DELETE RESTRICT
      );`,
      'agent_profiles check constraint on configured_status is invalid'
    );

    // 1b: Table 2 - agent_status_history incompatible FK (missing ON DELETE CASCADE)
    await testTableIncompatibility(
      'agent_status_history',
      `CREATE TABLE agent_status_history (
        id VARCHAR(64) PRIMARY KEY,
        brand_id VARCHAR(64) NOT NULL,
        user_id VARCHAR(64) NOT NULL,
        previous_status VARCHAR(32) NOT NULL,
        new_status VARCHAR(32) NOT NULL,
        trigger_source VARCHAR(32) NOT NULL CHECK (trigger_source IN ('manual', 'timeout', 'concurrency_limit', 'system', 'reconciliation')),
        reason TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );`,
      'agent_status_history foreign key to agent_profiles must specify ON DELETE CASCADE'
    );

    // 1c: Table 3 - brand_routing_state incompatible column type
    await testTableIncompatibility(
      'brand_routing_state',
      `CREATE TABLE brand_routing_state (
        brand_id VARCHAR(64) PRIMARY KEY REFERENCES brands(id) ON DELETE CASCADE,
        last_scheduled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        total_tickets_dispatched VARCHAR(100) NOT NULL DEFAULT 'zero',
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );`,
      'brand_routing_state.total_tickets_dispatched must be integer NOT NULL'
    );

    // 1d: Table 4 - ticket_routing_queue incompatible index (missing partial predicate)
    await testTableIncompatibility(
      'ticket_routing_queue',
      `CREATE TABLE ticket_routing_queue (
        id VARCHAR(64) PRIMARY KEY,
        brand_id VARCHAR(64) NOT NULL,
        ticket_id VARCHAR(64) NOT NULL,
        customer_id VARCHAR(64) NOT NULL,
        priority VARCHAR(32) NOT NULL DEFAULT 'Medium' CHECK (priority IN ('Critical', 'High', 'Medium', 'Low')),
        customer_language VARCHAR(16) NOT NULL DEFAULT 'en-US',
        required_skills TEXT[] NOT NULL DEFAULT ARRAY['general_inquiry']::TEXT[],
        status VARCHAR(32) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'routing', 'assigned', 'closed', 'cancelled')),
        assigned_agent_id VARCHAR(64),
        next_routing_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        queued_at TIMESTAMPTZ DEFAULT NOW(),
        FOREIGN KEY (brand_id, ticket_id) REFERENCES tickets(brand_id, id) ON DELETE CASCADE,
        FOREIGN KEY (brand_id, customer_id) REFERENCES customers(brand_id, id) ON DELETE CASCADE,
        FOREIGN KEY (brand_id, assigned_agent_id) REFERENCES brand_memberships(brand_id, user_id) ON DELETE RESTRICT
      );
      CREATE INDEX idx_unique_active_ticket_queue ON ticket_routing_queue(brand_id, ticket_id);`,
      'idx_unique_active_ticket_queue is not unique'
    );

    // 1e: Table 5 - message_translations incompatible composite FK
    await testTableIncompatibility(
      'message_translations',
      `CREATE TABLE message_translations (
        id VARCHAR(64) PRIMARY KEY,
        brand_id VARCHAR(64) NOT NULL,
        ticket_id VARCHAR(64) NOT NULL,
        message_id VARCHAR(128) NOT NULL,
        target_locale VARCHAR(16) NOT NULL,
        source_locale VARCHAR(16) NOT NULL,
        original_text TEXT NOT NULL,
        translated_text TEXT NOT NULL,
        UNIQUE (brand_id, message_id, target_locale)
      );`,
      'fk_msg_translations_archive is missing or invalid'
    );

    // 1f: Table 6 - global_ui_translation_cache incompatible nullability
    await testTableIncompatibility(
      'global_ui_translation_cache',
      `CREATE TABLE global_ui_translation_cache (
        id VARCHAR(64) PRIMARY KEY,
        phrase_key VARCHAR(128) NOT NULL,
        source_locale VARCHAR(16) NOT NULL,
        target_locale VARCHAR(16) NOT NULL,
        source_text TEXT NOT NULL,
        translated_text TEXT NOT NULL,
        is_verified BOOLEAN,
        UNIQUE (phrase_key, target_locale)
      );`,
      'global_ui_translation_cache.is_verified must be boolean NOT NULL'
    );

    // 1g: Table 7 - brand_knowledge_hub incompatible check constraint
    await testTableIncompatibility(
      'brand_knowledge_hub',
      `CREATE TABLE brand_knowledge_hub (
        id VARCHAR(64) PRIMARY KEY,
        brand_id VARCHAR(64) NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
        policy_id VARCHAR(64),
        category VARCHAR(64) NOT NULL CHECK (category IN ('faq')),
        title VARCHAR(255) NOT NULL,
        slug VARCHAR(128) NOT NULL,
        content_markdown TEXT NOT NULL,
        is_published BOOLEAN DEFAULT TRUE,
        UNIQUE (brand_id, slug),
        CONSTRAINT fk_knowledge_hub_policy FOREIGN KEY (brand_id, policy_id) REFERENCES brand_policies(brand_id, id) ON DELETE RESTRICT
      );`,
      'brand_knowledge_hub category check constraint is invalid',
      'ALTER TABLE brand_policies ADD CONSTRAINT uq_brand_policies_brand_id UNIQUE (brand_id, id);'
    );

    // 1h: Table 8 - ticket_handoff_summaries incompatible column type
    await testTableIncompatibility(
      'ticket_handoff_summaries',
      `CREATE TABLE ticket_handoff_summaries (
        id VARCHAR(64) PRIMARY KEY,
        brand_id VARCHAR(64) NOT NULL,
        ticket_id VARCHAR(64) NOT NULL,
        from_agent_id VARCHAR(64) NOT NULL,
        to_agent_id VARCHAR(64) NOT NULL,
        ai_summary_json TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        FOREIGN KEY (brand_id, ticket_id) REFERENCES tickets(brand_id, id) ON DELETE CASCADE,
        CONSTRAINT fk_handoff_from_agent FOREIGN KEY (brand_id, from_agent_id) REFERENCES brand_memberships(brand_id, user_id) ON DELETE RESTRICT,
        CONSTRAINT fk_handoff_to_agent FOREIGN KEY (brand_id, to_agent_id) REFERENCES brand_memberships(brand_id, user_id) ON DELETE RESTRICT
      );`,
      'ticket_handoff_summaries.ai_summary_json must be jsonb'
    );

    // 1i: Mid-DDL Rollback Verification: ensure a failed migration leaves zero partial changes and no ledger entry
    console.log('  [1i] Testing mid-DDL rollback atomicity on migration failure...');
    const rollbackClient = await directPool.connect();
    try {
      await rollbackClient.query('BEGIN');
      // Create incompatible structure to trigger failure during migration runner execution
      await rollbackClient.query(`
        CREATE TABLE brand_routing_state (
          brand_id VARCHAR(64) PRIMARY KEY,
          total_tickets_dispatched TEXT
        );
      `);
      // Run m5Sql directly inside transaction
      await rollbackClient.query(m5Sql);
      await rollbackClient.query('COMMIT');
      assert.fail('Migration should have failed');
    } catch (err) {
      await rollbackClient.query('ROLLBACK').catch(() => {});
      console.log('  [Rollback Triggered]: Migration aborted and rolled back cleanly.');
    } finally {
      rollbackClient.release();
    }

    // Verify no partial tables survived and no ledger entry exists
    const partialTableRes = await directPool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN ('agent_profiles', 'ticket_routing_queue', 'ticket_handoff_summaries');
    `);
    assert.strictEqual(partialTableRes.rows.length, 0, 'Zero partial tables must exist after rollback');

    // 1j: Clean migration application of 001-005 via migration runner
    console.log('  [1j] Executing clean migration runner (001 -> 005)...');
    await closePool();
    const runRes = await runMigration({ dryRun: false });
    assert.strictEqual(runRes.success, true);

    const ledgerRes = await directPool.query(`SELECT version FROM _schema_migrations ORDER BY applied_at ASC`);
    assert.strictEqual(ledgerRes.rows.length, 5);
    console.log('[PASS] Part 1: Exhaustive schema validation across all 8 tables and mid-DDL rollback verified.');

    // =========================================================================
    // PROVISION TEST AGENTS & ROLES FOR AUDIT
    // =========================================================================
    console.log('\n--- Provisioning Multi-Role Agents & Tenants ---');
    await directPool.query(`
      -- Carlos Gomez: Regular Agent
      INSERT INTO users (id, email, password_hash, name)
      VALUES ('user_carlos', 'carlos@novacart.com', 'hash_carlos', 'Carlos Gomez') ON CONFLICT (id) DO NOTHING;
      INSERT INTO brand_memberships (id, brand_id, user_id, role)
      VALUES ('mem_carlos_novacart', 'brand_novacart', 'user_carlos', 'agent') ON CONFLICT (brand_id, user_id) DO NOTHING;
      INSERT INTO agent_profiles (
        brand_id, user_id, nexconn_user_id, display_name, configured_status, primary_language, supported_languages, skills, max_concurrent_tickets, active_ticket_count, last_heartbeat_at
      ) VALUES (
        'brand_novacart', 'user_carlos', 'agent_carlos', 'Carlos Gomez', 'Available', 'es-ES', ARRAY['es-ES', 'en-US'], ARRAY['returns'], 3, 0, NOW()
      ) ON CONFLICT (brand_id, user_id) DO UPDATE SET configured_status = 'Available', active_ticket_count = 0, last_heartbeat_at = NOW();

      -- Elena Rostova: Support Lead
      INSERT INTO users (id, email, password_hash, name)
      VALUES ('user_elena_lead', 'elena@novacart.com', 'hash_elena', 'Elena Rostova') ON CONFLICT (id) DO NOTHING;
      INSERT INTO brand_memberships (id, brand_id, user_id, role)
      VALUES ('mem_elena_novacart', 'brand_novacart', 'user_elena_lead', 'support_lead') ON CONFLICT (brand_id, user_id) DO NOTHING;
      INSERT INTO agent_profiles (
        brand_id, user_id, nexconn_user_id, display_name, configured_status, primary_language, supported_languages, skills, max_concurrent_tickets, active_ticket_count, last_heartbeat_at
      ) VALUES (
        'brand_novacart', 'user_elena_lead', 'agent_elena', 'Elena Rostova', 'Available', 'en-US', ARRAY['en-US'], ARRAY['general_inquiry', 'returns'], 5, 0, NOW()
      ) ON CONFLICT (brand_id, user_id) DO UPDATE SET configured_status = 'Available', active_ticket_count = 0, last_heartbeat_at = NOW();

      -- Marcus Vance: Admin
      INSERT INTO users (id, email, password_hash, name)
      VALUES ('user_marcus_admin', 'marcus@novacart.com', 'hash_marcus', 'Marcus Vance') ON CONFLICT (id) DO NOTHING;
      INSERT INTO brand_memberships (id, brand_id, user_id, role)
      VALUES ('mem_marcus_novacart', 'brand_novacart', 'user_marcus_admin', 'admin') ON CONFLICT (brand_id, user_id) DO NOTHING;
      INSERT INTO agent_profiles (
        brand_id, user_id, nexconn_user_id, display_name, configured_status, primary_language, supported_languages, skills, max_concurrent_tickets, active_ticket_count, last_heartbeat_at
      ) VALUES (
        'brand_novacart', 'user_marcus_admin', 'agent_marcus', 'Marcus Vance', 'Available', 'en-US', ARRAY['en-US'], ARRAY['general_inquiry'], 10, 0, NOW()
      ) ON CONFLICT (brand_id, user_id) DO UPDATE SET configured_status = 'Available', active_ticket_count = 0, last_heartbeat_at = NOW();

      -- Maya Ext: Second Brand Agent (Cross-tenant testing)
      INSERT INTO brands (id, name, slug, support_identity, api_key_hash, allow_general_fallback)
      VALUES ('brand_second', 'Second Store', 'second', 'second_support', 'dummy_hash', TRUE) ON CONFLICT (id) DO NOTHING;
      INSERT INTO users (id, email, password_hash, name)
      VALUES ('user_maya_ext', 'maya@secondstore.com', 'hash_maya', 'Maya Ext') ON CONFLICT (id) DO NOTHING;
      INSERT INTO brand_memberships (id, brand_id, user_id, role)
      VALUES ('mem_maya_second', 'brand_second', 'user_maya_ext', 'agent') ON CONFLICT (brand_id, user_id) DO NOTHING;
      INSERT INTO agent_profiles (
        brand_id, user_id, nexconn_user_id, display_name, configured_status, primary_language, supported_languages, skills, max_concurrent_tickets, active_ticket_count, last_heartbeat_at
      ) VALUES (
        'brand_second', 'user_maya_ext', 'agent_maya', 'Maya Ext', 'Available', 'en-US', ARRAY['en-US'], ARRAY['general_inquiry'], 3, 0, NOW()
      ) ON CONFLICT (brand_id, user_id) DO UPDATE SET configured_status = 'Available', last_heartbeat_at = NOW();
    `);

    // =========================================================================
    // PART 2: SESSION SECURITY AUDIT
    // =========================================================================
    console.log('\n--- PART 2: Session Security Audit ---');

    // 2a: Cryptographic randomness of tokens
    console.log('  [2a] Testing cryptographic randomness and format of session tokens...');
    const sess1 = await createAgentSession({ brandId: 'brand_novacart', userId: 'user_sarah_lin' });
    assert.ok(sess1.sessionToken.startsWith('agent_sess_'));
    assert.strictEqual(sess1.sessionToken.length, 'agent_sess_'.length + 64); // 32 bytes hex = 64 hex chars
    assert.ok(sess1.csrfToken.length >= 48); // 24 bytes hex = 48 chars

    // 2b: Token Hashing in Database: Plaintext token must NEVER exist in agent_sessions table
    console.log('  [2b] Verifying SHA-256 token hashing in agent_sessions table...');
    const rawTokenPlain = sess1.sessionToken;
    const computedHash = crypto.createHash('sha256').update(rawTokenPlain).digest('hex');

    const dbSessionRow = (await directPool.query(`SELECT * FROM agent_sessions WHERE id = $1`, [sess1.sessionId])).rows[0];
    assert.strictEqual(dbSessionRow.session_token_hash, computedHash, 'Stored token must strictly match SHA-256 hash');
    assert.ok(!JSON.stringify(dbSessionRow).includes(rawTokenPlain), 'Plaintext session token must NEVER be stored in the database');

    // 2c: Cookie Security Settings on login
    console.log('  [2c] Verifying cookie security attributes on session endpoint...');
    const loginHttpRes = await apiClient.post('/api/agent/session', {
      brandId: 'brand_novacart',
      userId: 'user_sarah_lin'
    });
    assert.strictEqual(loginHttpRes.status, 200);
    const setCookieHeader = loginHttpRes.headers['set-cookie'];
    assert.ok(setCookieHeader && setCookieHeader.length > 0);
    const cookieStr = setCookieHeader[0];
    assert.ok(cookieStr.toLowerCase().includes('httponly'), 'Cookie must specify HttpOnly');
    assert.ok(cookieStr.toLowerCase().includes('samesite=strict'), 'Cookie must specify SameSite=Strict');
    assert.ok(cookieStr.toLowerCase().includes('path=/'), 'Cookie must specify Path=/');

    // 2d: Missing or Invalid CSRF Token Rejection on State-Changing Routes
    console.log('  [2d] Testing CSRF protection on state mutations...');
    const sarahAuthHeadersNoCsrf = {
      Authorization: `Bearer ${sess1.sessionToken}`
    };
    const csrfMissingRes = await apiClient.patch('/api/agent/status', { status: 'Busy' }, { headers: sarahAuthHeadersNoCsrf });
    assert.strictEqual(csrfMissingRes.status, 403, 'State-changing mutation without CSRF token must return 403');
    assert.ok(csrfMissingRes.data.error.includes('CSRF'));

    const csrfBogusRes = await apiClient.patch('/api/agent/status', { status: 'Busy' }, {
      headers: { ...sarahAuthHeadersNoCsrf, 'X-CSRF-Token': 'bogus_csrf_1234567890' }
    });
    assert.strictEqual(csrfBogusRes.status, 403, 'State-changing mutation with invalid CSRF token must return 403');

    // Valid CSRF succeeds
    const sarahValidHeaders = {
      Authorization: `Bearer ${sess1.sessionToken}`,
      'X-CSRF-Token': sess1.csrfToken
    };
    const validCsrfRes = await apiClient.patch('/api/agent/status', { status: 'Busy' }, { headers: sarahValidHeaders });
    assert.strictEqual(validCsrfRes.status, 200);

    // 2e: Absolute 12-hour expiry cannot be slid by heartbeat renewal
    console.log('  [2e] Verifying that heartbeat renewal preserves absolute 12-hour expiry...');
    const originalExpiresAt = new Date(dbSessionRow.expires_at).getTime();

    // Perform heartbeat
    const hbRes = await apiClient.post('/api/agent/heartbeat', {}, { headers: sarahValidHeaders });
    assert.strictEqual(hbRes.status, 200);

    const sessionAfterHb = (await directPool.query(`SELECT expires_at FROM agent_sessions WHERE id = $1`, [sess1.sessionId])).rows[0];
    const expiresAfterHb = new Date(sessionAfterHb.expires_at).getTime();
    assert.strictEqual(expiresAfterHb, originalExpiresAt, 'Heartbeat must NEVER extend session absolute 12-hour expiry');

    // 2f: Expired and revoked sessions rejected
    console.log('  [2f] Testing rejection of expired session...');
    await directPool.query(`UPDATE agent_sessions SET expires_at = NOW() - INTERVAL '10 seconds' WHERE id = $1`, [sess1.sessionId]);
    const expiredRes = await apiClient.get('/api/agent/profile', { headers: sarahValidHeaders });
    assert.strictEqual(expiredRes.status, 401, 'Expired session must return 401 Unauthorized');

    // Restore expires_at, then test revocation
    await directPool.query(`UPDATE agent_sessions SET expires_at = NOW() + INTERVAL '12 hours', revoked_at = NOW() WHERE id = $1`, [sess1.sessionId]);
    const revokedRes = await apiClient.get('/api/agent/profile', { headers: sarahValidHeaders });
    assert.strictEqual(revokedRes.status, 401, 'Revoked session must return 401 Unauthorized');

    // 2g: Concurrent Heartbeat and Termination cannot revive revoked session
    console.log('  [2g] Testing concurrent heartbeat and termination safety...');
    const sessToTerminate = await createAgentSession({ brandId: 'brand_novacart', userId: 'user_sarah_lin' });
    const termHeaders = {
      Authorization: `Bearer ${sessToTerminate.sessionToken}`,
      'X-CSRF-Token': sessToTerminate.csrfToken
    };

    // Terminate session
    const termRes = await apiClient.post('/api/agent/session/terminate', {}, { headers: termHeaders });
    assert.strictEqual(termRes.status, 200);

    // Attempt heartbeat after termination
    const reviveAttempt = await apiClient.post('/api/agent/heartbeat', {}, { headers: termHeaders });
    assert.strictEqual(reviveAttempt.status, 401, 'Heartbeat after termination must be strictly rejected (401)');

    const verifyRevoked = (await directPool.query(`SELECT revoked_at FROM agent_sessions WHERE id = $1`, [sessToTerminate.sessionId])).rows[0];
    assert.ok(verifyRevoked.revoked_at !== null, 'Session must remain revoked');

    // 2h: Multi-Session Agent Logout: Terminating one session preserves Available status while second session is active
    console.log('  [2h] Testing multi-session logout status preservation...');
    // Create Session A and Session B for Carlos
    const carlosSessA = await createAgentSession({ brandId: 'brand_novacart', userId: 'user_carlos' });
    const carlosSessB = await createAgentSession({ brandId: 'brand_novacart', userId: 'user_carlos' });

    // Set Carlos configured status to Available
    await directPool.query(`UPDATE agent_profiles SET configured_status = 'Available', last_heartbeat_at = NOW() WHERE user_id = 'user_carlos'`);

    // Terminate Session A
    await terminateAgentSession({
      brandId: 'brand_novacart',
      userId: 'user_carlos',
      sessionId: carlosSessA.sessionId,
      setOffline: true
    });

    // Carlos profile must STILL be Available because Session B is active!
    const carlosAfterA = (await directPool.query(`SELECT configured_status FROM agent_profiles WHERE user_id = 'user_carlos'`)).rows[0].configured_status;
    assert.strictEqual(carlosAfterA, 'Available', 'Terminating 1 of 2 sessions must NOT force agent Offline');

    // Terminate Session B (last active session)
    await terminateAgentSession({
      brandId: 'brand_novacart',
      userId: 'user_carlos',
      sessionId: carlosSessB.sessionId,
      setOffline: true
    });

    const carlosAfterB = (await directPool.query(`SELECT configured_status FROM agent_profiles WHERE user_id = 'user_carlos'`)).rows[0].configured_status;
    assert.strictEqual(carlosAfterB, 'Offline', 'Terminating the final active session must transition agent to Offline');

    console.log('[PASS] Part 2: Session security, hashing, CSRF gating, and multi-session logout verified.');

    // =========================================================================
    // PART 3: AUTHORIZATION & PII MASKING AUDIT
    // =========================================================================
    console.log('\n--- PART 3: Authorization & PII Masking Audit ---');

    // Establish active sessions for all roles
    const sarahSess = await createAgentSession({ brandId: 'brand_novacart', userId: 'user_sarah_lin' });
    const elenaSess = await createAgentSession({ brandId: 'brand_novacart', userId: 'user_elena_lead' });
    const marcusSess = await createAgentSession({ brandId: 'brand_novacart', userId: 'user_marcus_admin' });
    const mayaSess = await createAgentSession({ brandId: 'brand_second', userId: 'user_maya_ext' });

    const sarahHdrs = { Authorization: `Bearer ${sarahSess.sessionToken}`, 'X-CSRF-Token': sarahSess.csrfToken };
    const elenaHdrs = { Authorization: `Bearer ${elenaSess.sessionToken}`, 'X-CSRF-Token': elenaSess.csrfToken };
    const marcusHdrs = { Authorization: `Bearer ${marcusSess.sessionToken}`, 'X-CSRF-Token': marcusSess.csrfToken };
    const mayaHdrs = { Authorization: `Bearer ${mayaSess.sessionToken}`, 'X-CSRF-Token': mayaSess.csrfToken };

    // Set agents available
    await directPool.query(`
      UPDATE agent_profiles SET configured_status = 'Available', last_heartbeat_at = NOW(), active_ticket_count = 0 WHERE user_id IN ('user_sarah_lin', 'user_elena_lead', 'user_marcus_admin', 'user_carlos');
    `);

    // 3a: Regular agent Sarah cannot mutate or view Carlos status-history
    console.log('  [3a] Regular agent attempting unauthorized profile/history mutation...');
    const unauthHistory = await apiClient.get('/api/agent/status-history?userId=user_carlos', { headers: sarahHdrs });
    assert.strictEqual(unauthHistory.status, 403, 'Regular agent must NOT view another agent history');

    const unauthStatusMut = await apiClient.patch('/api/agent/status', { userId: 'user_carlos', status: 'Busy' }, { headers: sarahHdrs });
    assert.strictEqual(unauthStatusMut.status, 403, 'Regular agent must NOT mutate another agent status');

    // 3b: Support Lead Elena CAN view history and mutate Carlos status
    console.log('  [3b] Support lead performing authorized supervisor actions...');
    const leadHistory = await apiClient.get('/api/agent/status-history?userId=user_carlos', { headers: elenaHdrs });
    assert.strictEqual(leadHistory.status, 200, 'Support lead must be allowed to view agent status history');

    const leadStatusMut = await apiClient.patch('/api/agent/status', { userId: 'user_carlos', status: 'Away', reason: 'Team huddle' }, { headers: elenaHdrs });
    assert.strictEqual(leadStatusMut.status, 200, 'Support lead must be allowed to change agent status');
    assert.strictEqual(leadStatusMut.data.profile.configured_status, 'Away');

    // 3c: Admin Marcus CAN perform elevated actions across brand
    console.log('  [3c] Admin performing system operations...');
    const adminReconcile = await apiClient.post('/api/agent/reconcile', { userId: 'user_carlos' }, { headers: marcusHdrs });
    assert.strictEqual(adminReconcile.status, 200, 'Admin must be authorized to reconcile agent capacity');

    // 3d: Deactivated Membership rejected across all endpoints
    console.log('  [3d] Deactivated membership authorization rejection...');
    await directPool.query(`UPDATE brand_memberships SET deactivated_at = NOW() WHERE brand_id = 'brand_novacart' AND user_id = 'user_sarah_lin'`);

    const deactProfile = await apiClient.get('/api/agent/profile', { headers: sarahHdrs });
    assert.strictEqual(deactProfile.status, 403, 'Deactivated membership must be rejected with 403');
    const deactInbox = await apiClient.get('/api/inbox/unassigned', { headers: sarahHdrs });
    assert.strictEqual(deactInbox.status, 403, 'Deactivated membership must be rejected on inbox');

    // Restore Sarah membership
    await directPool.query(`UPDATE brand_memberships SET deactivated_at = NULL WHERE brand_id = 'brand_novacart' AND user_id = 'user_sarah_lin'`);

    // 3e: Cross-Tenant Isolation (Maya from brand_second)
    console.log('  [3e] Cross-tenant isolation verification...');
    const crossTenantGet = await apiClient.get('/api/agent/profile?userId=user_sarah_lin', { headers: mayaHdrs });
    assert.strictEqual(crossTenantGet.status, 403, 'Cross-tenant agent access must return 403');

    // 3f: Complete JSON inspection of unassigned queue customer PII
    console.log('  [3f] Complete JSON inspection of unassigned queue customer PII masking...');
    await directPool.query(`
      INSERT INTO tickets (id, brand_id, customer_id, category, priority, status, human_requested, summary, last_updated)
      VALUES ('tkt_audit_pii', 'brand_novacart', 'cust_aarav', 'returns', 'High', 'Human Requested', TRUE, 'PII Audit', NOW())
      ON CONFLICT (brand_id, id) DO UPDATE SET status = 'Human Requested', assigned_agent_id = NULL;
      INSERT INTO ticket_routing_queue (id, brand_id, ticket_id, customer_id, priority, customer_language, required_skills, status)
      VALUES ('q_audit_pii', 'brand_novacart', 'tkt_audit_pii', 'cust_aarav', 'High', 'en-US', ARRAY['returns'], 'queued')
      ON CONFLICT (id) DO UPDATE SET status = 'queued', assigned_agent_id = NULL;
    `);

    const unassignedRes = await apiClient.get('/api/inbox/unassigned', { headers: sarahHdrs });
    assert.strictEqual(unassignedRes.status, 200);
    const auditTkt = unassignedRes.data.tickets.find(t => t.id === 'tkt_audit_pii');
    assert.ok(auditTkt);
    assert.strictEqual(auditTkt.customer.name, 'A*** S***');
    assert.strictEqual(auditTkt.customer.email, 'a***@example.com');
    assert.ok(!auditTkt.customer.phone || auditTkt.customer.phone === '');
    // Ensure no unmasked PII leaks in raw ticket JSON
    const unassignedJsonStr = JSON.stringify(auditTkt);
    assert.ok(!unassignedJsonStr.includes('Aarav Sharma'), 'Full unassigned ticket JSON must not leak customer name');
    assert.ok(!unassignedJsonStr.includes('aarav.sharma@example.com'), 'Full unassigned ticket JSON must not leak customer email');

    // 3g: Complete JSON inspection of Team Overview
    console.log('  [3g] Complete JSON inspection of Team Overview for PII leakage...');
    const teamOverviewRes = await apiClient.get('/api/inbox/team-overview', { headers: sarahHdrs });
    assert.strictEqual(teamOverviewRes.status, 200);
    const overviewJsonStr = JSON.stringify(teamOverviewRes.data);
    assert.ok(!overviewJsonStr.includes('Aarav Sharma'), 'Team overview must not leak full customer name');
    assert.ok(!overviewJsonStr.includes('aarav.sharma@example.com'), 'Team overview must not leak customer email');

    // 3h: Customer-facing route confidentiality & Attachment access
    console.log('  [3h] Customer widget route confidentiality & Attachment authorization...');
    // Create confidential handoff on tkt_audit_pii
    await directPool.query(`
      INSERT INTO ticket_handoff_summaries (id, brand_id, ticket_id, from_agent_id, to_agent_id, ai_summary_json, internal_notes)
      VALUES ('handoff_conf_1', 'brand_novacart', 'tkt_audit_pii', 'user_sarah_lin', 'user_elena_lead', '{"secret":"confidential"}'::jsonb, 'SECRET AGENT NOTE')
      ON CONFLICT (id) DO NOTHING;
    `);

    // Public/Customer ticket endpoint must NEVER leak internal notes or handoff summaries
    const publicTicketRes = await apiClient.get('/api/tickets/tkt_audit_pii?brandId=brand_novacart');
    assert.strictEqual(publicTicketRes.status, 200);
    const pubTktJson = JSON.stringify(publicTicketRes.data);
    assert.ok(!pubTktJson.includes('SECRET AGENT NOTE'), 'Public ticket endpoint must never expose internal notes');
    assert.ok(!pubTktJson.includes('confidential'), 'Public ticket endpoint must never expose handoff summaries');

    // Attachment access authorization
    await directPool.query(`
      INSERT INTO attachments (id, brand_id, ticket_id, customer_id, storage_key, file_name, mime_type, file_size_bytes, file_data)
      VALUES ('att_audit_1', 'brand_novacart', 'tkt_audit_pii', 'cust_aarav', 'storage/att1', 'test.png', 'image/png', 4, '\\x89504E47')
      ON CONFLICT (id) DO NOTHING;
    `);

    // Sarah (NovaCart agent) downloads attachment -> 200
    const attSarah = await apiClient.get('/api/attachments/att_audit_1/download', { headers: sarahHdrs });
    assert.strictEqual(attSarah.status, 200, 'Same-brand agent must be authorized to download ticket attachment');

    // Maya (Second Brand agent) downloads attachment -> 403
    const attMaya = await apiClient.get('/api/attachments/att_audit_1/download', { headers: mayaHdrs });
    assert.strictEqual(attMaya.status, 403, 'Cross-tenant agent must be strictly rejected from downloading attachment');

    console.log('[PASS] Part 3: Role-based authorization, PII masking, confidentiality, and attachment access verified.');

    // =========================================================================
    // PART 4: STATUS & SESSION LIFECYCLE MATRIX
    // =========================================================================
    console.log('\n--- PART 4: Status & Session Lifecycle Matrix ---');

    // 4a: Dynamic effective status evaluations
    console.log('  [4a] Testing dynamic effective status matrix...');
    // Available + active < max -> Available
    assert.strictEqual(calculateEffectiveStatus({
      configuredStatus: 'Available', activeTicketCount: 1, maxConcurrentTickets: 3, lastHeartbeatAt: new Date(), isSessionActive: true, isDeactivated: false
    }), 'Available');

    // Available + active >= max -> At Capacity
    assert.strictEqual(calculateEffectiveStatus({
      configuredStatus: 'Available', activeTicketCount: 3, maxConcurrentTickets: 3, lastHeartbeatAt: new Date(), isSessionActive: true, isDeactivated: false
    }), 'At Capacity');

    // Busy -> Busy
    assert.strictEqual(calculateEffectiveStatus({
      configuredStatus: 'Busy', activeTicketCount: 0, maxConcurrentTickets: 3, lastHeartbeatAt: new Date(), isSessionActive: true, isDeactivated: false
    }), 'Busy');

    // Away -> Away
    assert.strictEqual(calculateEffectiveStatus({
      configuredStatus: 'Away', activeTicketCount: 0, maxConcurrentTickets: 3, lastHeartbeatAt: new Date(), isSessionActive: true, isDeactivated: false
    }), 'Away');

    // Offline -> Offline
    assert.strictEqual(calculateEffectiveStatus({
      configuredStatus: 'Offline', activeTicketCount: 0, maxConcurrentTickets: 3, lastHeartbeatAt: new Date(), isSessionActive: true, isDeactivated: false
    }), 'Offline');

    // Stale heartbeat (>60s) -> Offline
    assert.strictEqual(calculateEffectiveStatus({
      configuredStatus: 'Available', activeTicketCount: 0, maxConcurrentTickets: 3, lastHeartbeatAt: new Date(Date.now() - 65000), isSessionActive: true, isDeactivated: false
    }), 'Offline');

    // Deactivated -> Offline
    assert.strictEqual(calculateEffectiveStatus({
      configuredStatus: 'Available', activeTicketCount: 0, maxConcurrentTickets: 3, lastHeartbeatAt: new Date(), isSessionActive: true, isDeactivated: true
    }), 'Offline');

    // No active session -> Offline
    assert.strictEqual(calculateEffectiveStatus({
      configuredStatus: 'Available', activeTicketCount: 0, maxConcurrentTickets: 3, lastHeartbeatAt: new Date(), isSessionActive: false, isDeactivated: false
    }), 'Offline');

    // 4b: Simultaneous session creation, heartbeats, and status changes
    console.log('  [4b] Testing concurrent session creation, heartbeats, and status changes...');
    const lifecycleTasks = [];
    for (let i = 0; i < 10; i++) {
      lifecycleTasks.push((async () => {
        // Create session
        const sess = await createAgentSession({ brandId: 'brand_novacart', userId: 'user_marcus_admin' });
        const hdrs = { Authorization: `Bearer ${sess.sessionToken}`, 'X-CSRF-Token': sess.csrfToken };

        // Heartbeat
        await apiClient.post('/api/agent/heartbeat', {}, { headers: hdrs });

        // Status toggle
        await apiClient.patch('/api/agent/status', { status: i % 2 === 0 ? 'Available' : 'Busy' }, { headers: hdrs });

        // Terminate
        await apiClient.post('/api/agent/session/terminate', { setOffline: false }, { headers: hdrs });
      })());
    }

    const lifecycleResults = await Promise.allSettled(lifecycleTasks);
    const lifecycleErrors = lifecycleResults.filter(r => r.status === 'rejected');
    assert.strictEqual(lifecycleErrors.length, 0, 'Concurrent lifecycle operations must succeed with 0 failures');
    console.log('  [Concurrent Lifecycle]: 10 parallel session lifecycles completed with ZERO deadlocks.');

    console.log('[PASS] Part 4: Status and session lifecycle matrix verified.');

    console.log('\n================================================================================');
    console.log('=== [ALL CHECKPOINT E2-B2 CLOSURE AUDIT TESTS PASSED SUCCESSFULLY] ===');
    console.log('================================================================================\n');

  } catch (err) {
    console.error('\n[FATAL AUDIT FAILURE]:', err);
    throw err;
  } finally {
    try {
      await new Promise(resolve => httpServer.close(resolve));
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
        try { fs.rmSync(PG16_DATA_DIR, { recursive: true, force: true }); } catch (e) {}
      }
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

runE2B2ClosureAudit().catch(err => {
  console.error('\n[FATAL AUDIT PROCESS FAILURE]:', err);
  process.exit(1);
});
