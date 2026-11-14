import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import pg from 'pg';
import EmbeddedPostgres from 'embedded-postgres';
import axios from 'axios';
import { runMigration } from '../src/db/migrate.js';
import { closePool } from '../src/db/pool.js';
import { app } from '../src/server.js';
import { enqueueOrReopenTicket } from '../src/services/queueService.js';
import { assignQueuedTicketAtomically } from '../src/services/routingService.js';
import { resolveTicketAndReleaseCapacity, transferTicketAtomically, reconcileAgentCapacity } from '../src/services/capacityService.js';
import {
  getAgentProfile,
  updateAgentConfiguredStatus,
  createAgentSession,
  refreshAgentHeartbeat,
  terminateAgentSession
} from '../src/services/agentAvailabilityService.js';
import { maskCustomerPii } from '../src/services/sharedInboxService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');
const TEST_PORT = 54338;
const PG16_DATA_DIR = path.resolve(ROOT_DIR, 'server/data/pg16_e2b2_test_instance');
const TEST_DB_URL = `postgresql://postgres:postgres@127.0.0.1:${TEST_PORT}/postgres`;

console.log('================================================================================');
console.log('=== [TEST SUITE: Checkpoint E2-B2 Agent Availability, Sessions & Shared Inbox] ===');
console.log('================================================================================\n');

async function runE2B2Tests() {
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
  process.env.NODE_ENV = 'test';

  const { Pool } = pg;
  const directPool = new Pool({
    connectionString: TEST_DB_URL,
    max: 20,
    idleTimeoutMillis: 5000,
    connectionTimeoutMillis: 5000
  });

  // Start Express HTTP server on ephemeral port
  const httpServer = http.createServer(app);
  await new Promise(resolve => httpServer.listen(0, resolve));
  const serverPort = httpServer.address().port;
  const baseUrl = `http://127.0.0.1:${serverPort}`;
  console.log(`[HTTP Server] Express test server listening on port ${serverPort}`);

  const apiClient = axios.create({
    baseURL: baseUrl,
    validateStatus: () => true // Prevent axios from throwing on 4xx/5xx
  });

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Migration 005 Incompatible Schema Validation Across All Tables
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 1: Migration 005 Incompatible Schema Rejection Across Tables ---');
    const m1Sql = fs.readFileSync(path.join(__dirname, '../src/db/migrations/001_canonical_schema.sql'), 'utf8');
    const m2Sql = fs.readFileSync(path.join(__dirname, '../src/db/migrations/002_seed_demo_data.sql'), 'utf8');
    const m3Sql = fs.readFileSync(path.join(__dirname, '../src/db/migrations/003_attachment_blob_storage.sql'), 'utf8');
    const m4Sql = fs.readFileSync(path.join(__dirname, '../src/db/migrations/004_seed_sample_attachment.sql'), 'utf8');
    const m5Sql = fs.readFileSync(path.join(__dirname, '../src/db/migrations/005_checkpoint_e_workforce_schema.sql'), 'utf8');

    await directPool.query(m1Sql);
    await directPool.query(m2Sql);
    await directPool.query(m3Sql);
    await directPool.query(m4Sql);

    // 1a: Pre-create incompatible agent_status_history (missing trigger_source check constraint / invalid FK)
    console.log('  [1a] Testing pre-existing incompatible agent_status_history...');
    const client1a = await directPool.connect();
    let incompatibility1aCaught = false;
    try {
      await client1a.query('BEGIN');
      await client1a.query(`
        CREATE TABLE agent_status_history (
          id VARCHAR(64) PRIMARY KEY,
          brand_id VARCHAR(64) NOT NULL,
          user_id VARCHAR(64) NOT NULL,
          previous_status VARCHAR(32) NOT NULL,
          new_status VARCHAR(32) NOT NULL,
          trigger_source VARCHAR(32) NOT NULL CHECK (trigger_source IN ('bogus_trigger')),
          reason TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);
      await client1a.query(m5Sql);
      await client1a.query('COMMIT');
    } catch (err) {
      await client1a.query('ROLLBACK').catch(() => {});
      incompatibility1aCaught = true;
      assert.ok(
        err.message.includes('agent_status_history') && err.message.includes('Schema Incompatibility'),
        `Expected agent_status_history schema incompatibility, got: ${err.message}`
      );
      console.log('  [Incompatibility Detected]:', err.message);
    } finally {
      await client1a.query('DROP TABLE IF EXISTS agent_status_history CASCADE').catch(() => {});
      client1a.release();
    }
    assert.ok(incompatibility1aCaught, 'Migration 005 must reject incompatible agent_status_history table');

    // 1b: Pre-create incompatible brand_routing_state (wrong column type)
    console.log('  [1b] Testing pre-existing incompatible brand_routing_state...');
    const client1b = await directPool.connect();
    let incompatibility1bCaught = false;
    try {
      await client1b.query('BEGIN');
      await client1b.query(`
        CREATE TABLE brand_routing_state (
          brand_id VARCHAR(64) PRIMARY KEY REFERENCES brands(id) ON DELETE CASCADE,
          last_scheduled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          total_tickets_dispatched VARCHAR(100) NOT NULL DEFAULT 'zero',
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);
      await client1b.query(m5Sql);
      await client1b.query('COMMIT');
    } catch (err) {
      await client1b.query('ROLLBACK').catch(() => {});
      incompatibility1bCaught = true;
      assert.ok(
        err.message.includes('brand_routing_state.total_tickets_dispatched must be integer NOT NULL'),
        `Expected brand_routing_state column type error, got: ${err.message}`
      );
      console.log('  [Incompatibility Detected]:', err.message);
    } finally {
      await client1b.query('DROP TABLE IF EXISTS brand_routing_state CASCADE').catch(() => {});
      client1b.release();
    }
    assert.ok(incompatibility1bCaught, 'Migration 005 must reject incompatible brand_routing_state table');

    // Clean execution of all migrations
    await closePool();
    const runRes = await runMigration({ dryRun: false });
    assert.strictEqual(runRes.success, true);
    console.log('[PASS] Test 1: Migration 005 exhaustive validation and clean application verified.');

    // -------------------------------------------------------------------------
    // TEST 2: Multi-Agent Provisioning for Test Scenarios
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 2: Multi-Agent Provisioning ---');
    // Sarah Lin already provisioned by migration 005 backfill
    // Provision Carlos Gomez (Agent) in NovaCart
    await directPool.query(`
      INSERT INTO users (id, email, password_hash, name)
      VALUES ('user_carlos', 'carlos@novacart.com', 'carlos_hash', 'Carlos Gomez')
      ON CONFLICT (id) DO NOTHING;
      INSERT INTO brand_memberships (id, brand_id, user_id, role)
      VALUES ('mem_carlos_novacart', 'brand_novacart', 'user_carlos', 'agent')
      ON CONFLICT (brand_id, user_id) DO NOTHING;
      INSERT INTO agent_profiles (
        brand_id, user_id, nexconn_user_id, display_name, configured_status, primary_language, supported_languages, skills, max_concurrent_tickets, active_ticket_count, last_heartbeat_at
      ) VALUES (
        'brand_novacart', 'user_carlos', 'agent_carlos', 'Carlos Gomez', 'Offline', 'es-ES', ARRAY['es-ES', 'en-US'], ARRAY['returns', 'billing'], 3, 0, NOW()
      ) ON CONFLICT (brand_id, user_id) DO UPDATE SET configured_status = 'Offline', active_ticket_count = 0;
    `);

    // Provision Elena Rostova (Support Lead) in NovaCart
    await directPool.query(`
      INSERT INTO users (id, email, password_hash, name)
      VALUES ('user_elena_lead', 'elena@novacart.com', 'elena_hash', 'Elena Rostova')
      ON CONFLICT (id) DO NOTHING;
      INSERT INTO brand_memberships (id, brand_id, user_id, role)
      VALUES ('mem_elena_novacart', 'brand_novacart', 'user_elena_lead', 'support_lead')
      ON CONFLICT (brand_id, user_id) DO NOTHING;
      INSERT INTO agent_profiles (
        brand_id, user_id, nexconn_user_id, display_name, configured_status, primary_language, supported_languages, skills, max_concurrent_tickets, active_ticket_count, last_heartbeat_at
      ) VALUES (
        'brand_novacart', 'user_elena_lead', 'agent_elena', 'Elena Rostova', 'Available', 'en-US', ARRAY['en-US'], ARRAY['general_inquiry', 'returns', 'logistics', 'damages'], 5, 0, NOW()
      ) ON CONFLICT (brand_id, user_id) DO UPDATE SET configured_status = 'Available', active_ticket_count = 0;
    `);

    // Provision Maya Lin (Agent) in Brand Second (for cross-tenant rejection tests)
    await directPool.query(`
      INSERT INTO brands (id, name, slug, support_identity, api_key_hash, allow_general_fallback)
      VALUES ('brand_second', 'Second Store', 'second', 'second_support', 'dummy_hash', TRUE)
      ON CONFLICT (id) DO NOTHING;
      INSERT INTO users (id, email, password_hash, name)
      VALUES ('user_maya_ext', 'maya@secondstore.com', 'maya_hash', 'Maya Ext')
      ON CONFLICT (id) DO NOTHING;
      INSERT INTO brand_memberships (id, brand_id, user_id, role)
      VALUES ('mem_maya_second', 'brand_second', 'user_maya_ext', 'agent')
      ON CONFLICT (brand_id, user_id) DO NOTHING;
      INSERT INTO agent_profiles (
        brand_id, user_id, nexconn_user_id, display_name, configured_status, primary_language, supported_languages, skills, max_concurrent_tickets, active_ticket_count, last_heartbeat_at
      ) VALUES (
        'brand_second', 'user_maya_ext', 'agent_maya', 'Maya Ext', 'Available', 'en-US', ARRAY['en-US'], ARRAY['general_inquiry'], 3, 0, NOW()
      ) ON CONFLICT (brand_id, user_id) DO UPDATE SET configured_status = 'Available';
    `);

    console.log('[PASS] Test 2: Sarah Lin, Carlos Gomez, Elena Rostova (Lead), and Maya Ext provisioned.');

    // -------------------------------------------------------------------------
    // TEST 3: Agent Sessions, Heartbeat Renewal & Expiry
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 3: Agent Sessions, Heartbeat Renewal & Expiry ---');
    // 3a: Create session for Sarah Lin via API
    const sessRes = await apiClient.post('/api/agent/session', {
      brandId: 'brand_novacart',
      userId: 'user_sarah_lin'
    });
    assert.strictEqual(sessRes.status, 200);
    assert.strictEqual(sessRes.data.success, true);
    assert.ok(sessRes.data.sessionToken.startsWith('agent_sess_'));
    assert.ok(sessRes.data.csrfToken.length >= 24);

    const sarahToken = sessRes.data.sessionToken;
    const sarahCsrf = sessRes.data.csrfToken;
    const sarahHeaders = {
      Authorization: `Bearer ${sarahToken}`,
      'X-CSRF-Token': sarahCsrf
    };

    // 3b: Heartbeat renewal via API
    const hbRes = await apiClient.post('/api/agent/heartbeat', {}, { headers: sarahHeaders });
    assert.strictEqual(hbRes.status, 200);
    assert.strictEqual(hbRes.data.success, true);
    assert.ok(hbRes.data.lastHeartbeatAt !== null);

    // 3c: Stale heartbeat (>60 seconds) transitions effective status to Offline
    console.log('  [3c] Testing heartbeat staleness threshold (>60s)...');
    await directPool.query(`
      UPDATE agent_profiles
      SET configured_status = 'Available', last_heartbeat_at = NOW() - INTERVAL '70 seconds'
      WHERE user_id = 'user_sarah_lin';
    `);

    const staleProfRes = await apiClient.get('/api/agent/profile', { headers: sarahHeaders });
    assert.strictEqual(staleProfRes.status, 200);
    assert.strictEqual(staleProfRes.data.profile.configured_status, 'Available');
    assert.strictEqual(staleProfRes.data.profile.effective_status, 'Offline', 'Stale heartbeat (>60s) must produce Offline effective status');

    // 3d: Renewal brings effective status back to Available
    const renewRes = await apiClient.post('/api/agent/heartbeat', {}, { headers: sarahHeaders });
    assert.strictEqual(renewRes.status, 200);
    assert.strictEqual(renewRes.data.effectiveStatus, 'Available', 'Heartbeat renewal must restore Available effective status');

    // 3e: Session termination (Logout)
    console.log('  [3e] Testing session termination and logout...');
    const termRes = await apiClient.post('/api/agent/session/terminate', {}, { headers: sarahHeaders });
    assert.strictEqual(termRes.status, 200);
    assert.strictEqual(termRes.data.terminated, true);

    // Subsequent call with revoked token must be rejected with 401
    const revokedRes = await apiClient.get('/api/agent/profile', { headers: sarahHeaders });
    assert.strictEqual(revokedRes.status, 401, 'Revoked session must be rejected with 401');

    console.log('[PASS] Test 3: Agent sessions, heartbeat renewal, staleness, and termination verified.');

    // -------------------------------------------------------------------------
    // TEST 4: Available, Busy, Away, Offline & At Capacity Transitions
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 4: Configured & Effective Status State Machine ---');
    // Establish fresh session for Sarah
    const sarahSess2 = await createAgentSession({ brandId: 'brand_novacart', userId: 'user_sarah_lin' });
    const s2Headers = {
      Authorization: `Bearer ${sarahSess2.sessionToken}`,
      'X-CSRF-Token': sarahSess2.csrfToken
    };

    // 4a: Transition to Available
    const toAvail = await apiClient.patch('/api/agent/status', { status: 'Available', reason: 'Ready for work' }, { headers: s2Headers });
    assert.strictEqual(toAvail.status, 200);
    assert.strictEqual(toAvail.data.profile.configured_status, 'Available');
    assert.strictEqual(toAvail.data.profile.effective_status, 'Available');

    // 4b: Transition to Busy
    const toBusy = await apiClient.patch('/api/agent/status', { status: 'Busy', reason: 'In a meeting' }, { headers: s2Headers });
    assert.strictEqual(toBusy.status, 200);
    assert.strictEqual(toBusy.data.profile.configured_status, 'Busy');
    assert.strictEqual(toBusy.data.profile.effective_status, 'Busy');

    // 4c: Transition to Away
    const toAway = await apiClient.patch('/api/agent/status', { status: 'Away', reason: 'Lunch break' }, { headers: s2Headers });
    assert.strictEqual(toAway.status, 200);
    assert.strictEqual(toAway.data.profile.configured_status, 'Away');
    assert.strictEqual(toAway.data.profile.effective_status, 'Away');

    // 4d: Transition to Offline
    const toOff = await apiClient.patch('/api/agent/status', { status: 'Offline', reason: 'Shift ended' }, { headers: s2Headers });
    assert.strictEqual(toOff.status, 200);
    assert.strictEqual(toOff.data.profile.configured_status, 'Offline');
    assert.strictEqual(toOff.data.profile.effective_status, 'Offline');

    // 4e: At Capacity transition
    console.log('  [4e] Testing dynamic "At Capacity" effective status...');
    await directPool.query(`
      UPDATE agent_profiles
      SET configured_status = 'Available', active_ticket_count = 3, max_concurrent_tickets = 3, last_heartbeat_at = NOW()
      WHERE user_id = 'user_sarah_lin';
    `);

    const atCapProf = await apiClient.get('/api/agent/profile', { headers: s2Headers });
    assert.strictEqual(atCapProf.status, 200);
    assert.strictEqual(atCapProf.data.profile.configured_status, 'Available');
    assert.strictEqual(atCapProf.data.profile.effective_status, 'At Capacity', 'Agent at max tickets must evaluate to "At Capacity"');

    // 4f: Invalid status rejected
    const invalidStatusRes = await apiClient.patch('/api/agent/status', { status: 'Sleeping' }, { headers: s2Headers });
    assert.strictEqual(invalidStatusRes.status, 400);

    // 4g: Status audit history log verified
    const histRes = await apiClient.get('/api/agent/status-history', { headers: s2Headers });
    assert.strictEqual(histRes.status, 200);
    assert.ok(histRes.data.history.length >= 3);
    assert.strictEqual(histRes.data.history[0].user_id, 'user_sarah_lin');

    console.log('[PASS] Test 4: All 5 status transitions (including At Capacity) and audit logging verified.');

    // -------------------------------------------------------------------------
    // TEST 5: Role-Based Authorization & Cross-Tenant Rejection
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 5: Role-Based Authorization & Cross-Tenant Rejection ---');
    // Session for Carlos (regular agent)
    const carlosSess = await createAgentSession({ brandId: 'brand_novacart', userId: 'user_carlos' });
    const carlosHeaders = {
      Authorization: `Bearer ${carlosSess.sessionToken}`,
      'X-CSRF-Token': carlosSess.csrfToken
    };

    // Session for Elena (support_lead)
    const elenaSess = await createAgentSession({ brandId: 'brand_novacart', userId: 'user_elena_lead' });
    const elenaHeaders = {
      Authorization: `Bearer ${elenaSess.sessionToken}`,
      'X-CSRF-Token': elenaSess.csrfToken
    };

    // Session for Maya (brand_second)
    const mayaSess = await createAgentSession({ brandId: 'brand_second', userId: 'user_maya_ext' });
    const mayaHeaders = {
      Authorization: `Bearer ${mayaSess.sessionToken}`,
      'X-CSRF-Token': mayaSess.csrfToken
    };

    // 5a: Regular agent Sarah cannot update Carlos status
    console.log('  [5a] Regular agent attempting to mutate another agent status...');
    const unauthStatus = await apiClient.patch('/api/agent/status', {
      userId: 'user_carlos',
      status: 'Busy'
    }, { headers: s2Headers });
    assert.strictEqual(unauthStatus.status, 403, 'Regular agent must NOT be allowed to mutate another agent status');

    // 5b: Support lead Elena CAN update Carlos status
    console.log('  [5b] Support lead updating another agent status...');
    const leadUpdate = await apiClient.patch('/api/agent/status', {
      userId: 'user_carlos',
      status: 'Available',
      reason: 'Assigned by Support Lead'
    }, { headers: elenaHeaders });
    assert.strictEqual(leadUpdate.status, 200, 'Support lead must be authorized to update agent status');
    assert.strictEqual(leadUpdate.data.profile.configured_status, 'Available');

    // 5c: Cross-tenant access rejection
    console.log('  [5c] Cross-tenant access rejection...');
    // Maya (brand_second) attempts to query NovaCart tickets or Carlos profile
    const crossTenantProfile = await apiClient.get('/api/agent/profile?userId=user_carlos', { headers: mayaHeaders });
    assert.strictEqual(crossTenantProfile.status, 403, 'Cross-tenant agent access must be strictly rejected');

    // 5d: Deactivated membership check
    console.log('  [5d] Deactivated membership authentication rejection...');
    await directPool.query(`UPDATE brand_memberships SET deactivated_at = NOW() WHERE brand_id = 'brand_novacart' AND user_id = 'user_carlos'`);
    const deactHeartbeat = await apiClient.post('/api/agent/heartbeat', {}, { headers: carlosHeaders });
    assert.strictEqual(deactHeartbeat.status, 403, 'Deactivated agent membership must be rejected with 403');

    // Restore Carlos membership
    await directPool.query(`UPDATE brand_memberships SET deactivated_at = NULL WHERE brand_id = 'brand_novacart' AND user_id = 'user_carlos'`);
    console.log('[PASS] Test 5: Role-based permissions, cross-tenant isolation, and deactivation checks verified.');

    // -------------------------------------------------------------------------
    // TEST 6: Shared Inbox Views & Customer PII Masking
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 6: Shared Inbox Views & Customer PII Masking ---');
    // Ensure clean queue state
    await directPool.query(`DELETE FROM ticket_routing_queue WHERE brand_id = 'brand_novacart'`);

    // Enqueue an unassigned ticket with customer Aarav Sharma
    await directPool.query(`
      INSERT INTO tickets (id, brand_id, customer_id, category, priority, status, human_requested, summary, last_updated)
      VALUES ('tkt_unassigned_pii', 'brand_novacart', 'cust_aarav', 'returns', 'Critical', 'Human Requested', TRUE, 'PII mask test', NOW())
      ON CONFLICT (brand_id, id) DO UPDATE SET status = 'Human Requested', assigned_agent_id = NULL;
      INSERT INTO ticket_routing_queue (id, brand_id, ticket_id, customer_id, priority, customer_language, required_skills, status)
      VALUES ('q_unassigned_pii', 'brand_novacart', 'tkt_unassigned_pii', 'cust_aarav', 'Critical', 'en-US', ARRAY['returns'], 'queued')
      ON CONFLICT (id) DO UPDATE SET status = 'queued', assigned_agent_id = NULL;
    `);

    // 6a: Unassigned tickets view: verify PII masking
    console.log('  [6a] Verifying customer PII masking on unassigned tickets...');
    const unassignedRes = await apiClient.get('/api/inbox/unassigned', { headers: s2Headers });
    assert.strictEqual(unassignedRes.status, 200);
    assert.strictEqual(unassignedRes.data.success, true);
    assert.ok(unassignedRes.data.tickets.length >= 1);

    const maskedTkt = unassignedRes.data.tickets.find(t => t.id === 'tkt_unassigned_pii');
    assert.ok(maskedTkt);
    assert.ok(maskedTkt.customer);
    // Name must be masked: "A*** S***"
    assert.ok(maskedTkt.customer.name.includes('***'), `Expected masked name, got: ${maskedTkt.customer.name}`);
    // Email must be masked: "a***@..."
    assert.ok(maskedTkt.customer.email.includes('***'), `Expected masked email, got: ${maskedTkt.customer.email}`);
    console.log('  [Masked Customer Info]:', maskedTkt.customer);

    // 6b: My Tickets view: assign tkt_my_test to Sarah and verify UNMASKED customer details
    console.log('  [6b] Verifying unmasked customer info on assigned My Tickets...');
    await directPool.query(`
      INSERT INTO tickets (id, brand_id, customer_id, category, priority, status, assigned_agent_id, human_requested, summary, last_updated)
      VALUES ('tkt_my_test', 'brand_novacart', 'cust_aarav', 'billing', 'High', 'Human Agent Active', 'user_sarah_lin', TRUE, 'My test', NOW())
      ON CONFLICT (brand_id, id) DO UPDATE SET assigned_agent_id = 'user_sarah_lin', status = 'Human Agent Active';
      INSERT INTO ticket_routing_queue (id, brand_id, ticket_id, customer_id, priority, customer_language, required_skills, status, assigned_agent_id)
      VALUES ('q_my_test', 'brand_novacart', 'tkt_my_test', 'cust_aarav', 'High', 'en-US', ARRAY['billing'], 'assigned', 'user_sarah_lin')
      ON CONFLICT (id) DO UPDATE SET status = 'assigned', assigned_agent_id = 'user_sarah_lin';
    `);

    const myTicketsRes = await apiClient.get('/api/inbox/my-tickets', { headers: s2Headers });
    assert.strictEqual(myTicketsRes.status, 200);
    const myTkt = myTicketsRes.data.tickets.find(t => t.id === 'tkt_my_test');
    assert.ok(myTkt);
    assert.strictEqual(myTkt.customer.name, 'Aarav Sharma', 'Assigned agent owner must receive unmasked customer name');
    assert.strictEqual(myTkt.customer.email, 'aarav.sharma@example.com', 'Assigned agent owner must receive unmasked email');

    // 6c: Team Overview view
    const teamRes = await apiClient.get('/api/inbox/team-overview', { headers: s2Headers });
    assert.strictEqual(teamRes.status, 200);
    assert.ok(teamRes.data.metrics.unassigned_count >= 1);
    assert.ok(teamRes.data.roster.length >= 2);

    // 6d: Roster view
    const rosterRes = await apiClient.get('/api/inbox/roster', { headers: s2Headers });
    assert.strictEqual(rosterRes.status, 200);
    assert.ok(rosterRes.data.roster.length >= 3);
    const sarahRoster = rosterRes.data.roster.find(r => r.userId === 'user_sarah_lin');
    assert.ok(sarahRoster);
    assert.ok(['Available', 'At Capacity'].includes(sarahRoster.effectiveStatus));

    console.log('[PASS] Test 6: Shared inbox views, PII masking, and roster metrics verified.');

    // -------------------------------------------------------------------------
    // TEST 7: Ticket Details, Conversation History & Confidentiality
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 7: Ticket Details, Conversation History & Confidentiality ---');
    // Insert message archive row and handoff summary for tkt_my_test
    await directPool.query(`
      INSERT INTO message_archive (
        id, brand_id, ticket_id, nexconn_message_id, sender_user_id, target_user_id, sender_role, sender_name, message_text
      ) VALUES (
        'msg_hist_1', 'brand_novacart', 'tkt_my_test', 'nx_msg_hist_1', 'cust_aarav', 'novacart_support', 'customer', 'Aarav Sharma', 'Where is my order?'
      ) ON CONFLICT (id) DO NOTHING;

      INSERT INTO ticket_handoff_summaries (
        id, brand_id, ticket_id, from_agent_id, to_agent_id, ai_summary_json, internal_notes
      ) VALUES (
        'handoff_hist_1', 'brand_novacart', 'tkt_my_test', 'user_sarah_lin', 'user_sarah_lin', '{"intent":"Inquiry"}'::jsonb, 'Agent internal note: VIP customer'
      ) ON CONFLICT (id) DO NOTHING;
    `);

    // 7a: Sarah accesses her assigned ticket details
    const detailRes = await apiClient.get('/api/inbox/tickets/tkt_my_test', { headers: s2Headers });
    assert.strictEqual(detailRes.status, 200);
    assert.strictEqual(detailRes.data.ticket.id, 'tkt_my_test');
    assert.strictEqual(detailRes.data.ticket.customer.name, 'Aarav Sharma');
    assert.strictEqual(detailRes.data.ticket.conversationHistory.length, 1);
    assert.strictEqual(detailRes.data.ticket.handoffSummaries.length, 1);
    assert.strictEqual(detailRes.data.ticket.handoffSummaries[0].internal_notes, 'Agent internal note: VIP customer');

    // 7b: Carlos (regular agent) attempts to view Sarah's assigned ticket details -> 403 Forbidden
    console.log('  [7b] Another regular agent attempting to access assigned ticket details...');
    const unauthDetail = await apiClient.get('/api/inbox/tickets/tkt_my_test', { headers: carlosHeaders });
    assert.strictEqual(unauthDetail.status, 403, 'Regular agent must NOT access another agent assigned ticket');

    // 7c: Elena (support lead) views Sarah's ticket -> 200 OK
    const leadDetail = await apiClient.get('/api/inbox/tickets/tkt_my_test', { headers: elenaHeaders });
    assert.strictEqual(leadDetail.status, 200, 'Support lead must be authorized to view any ticket');

    // 7d: Verify customer widget endpoint does NOT expose internal notes
    console.log('  [7d] Verifying confidentiality: customer widget endpoint must not leak handoff summaries...');
    const widgetRes = await apiClient.get('/api/tickets/tkt_my_test?brandId=brand_novacart');
    assert.strictEqual(widgetRes.status, 200);
    assert.strictEqual(widgetRes.data.ticket.handoffSummaries, undefined, 'Public/widget ticket must NEVER expose handoff summaries');
    assert.strictEqual(widgetRes.data.ticket.internalNotes, undefined, 'Public/widget ticket must NEVER expose internal notes');

    console.log('[PASS] Test 7: Ticket details, conversation history, and internal note confidentiality verified.');

    // -------------------------------------------------------------------------
    // TEST 8: Ticket Assignment & Reassignment via API
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 8: Ticket Assignment & Reassignment via API ---');
    // Ensure Sarah has capacity
    await directPool.query(`
      UPDATE agent_profiles
      SET configured_status = 'Available', last_heartbeat_at = NOW(), active_ticket_count = 0, max_concurrent_tickets = 5
      WHERE user_id = 'user_sarah_lin';
    `);

    // 8a: Sarah self-claims tkt_unassigned_pii
    const claimRes = await apiClient.post('/api/inbox/tickets/tkt_unassigned_pii/assign', {}, { headers: s2Headers });
    assert.strictEqual(claimRes.status, 200);
    assert.strictEqual(claimRes.data.assignedAgentId, 'user_sarah_lin');
    assert.strictEqual(claimRes.data.status, 'Human Agent Active');

    // Verify ticket and capacity in DB
    const tktClaimed = (await directPool.query(`SELECT assigned_agent_id, status FROM tickets WHERE id = 'tkt_unassigned_pii'`)).rows[0];
    assert.strictEqual(tktClaimed.assigned_agent_id, 'user_sarah_lin');
    assert.strictEqual(tktClaimed.status, 'Human Agent Active');

    const sarahCntAfterClaim = (await directPool.query(`SELECT active_ticket_count FROM agent_profiles WHERE user_id = 'user_sarah_lin'`)).rows[0].active_ticket_count;
    assert.strictEqual(sarahCntAfterClaim, 1);

    // 8b: Regular agent Sarah attempts to reassign ticket to Carlos -> 403 Forbidden
    const unauthReassign = await apiClient.post('/api/inbox/tickets/tkt_unassigned_pii/assign', {
      targetAgentId: 'user_carlos'
    }, { headers: s2Headers });
    assert.strictEqual(unauthReassign.status, 403, 'Regular agent cannot reassign to another agent');

    // 8c: Lead Elena reassigns ticket to Carlos
    // Ensure Carlos is Available with fresh heartbeat
    await directPool.query(`
      UPDATE agent_profiles
      SET configured_status = 'Available', last_heartbeat_at = NOW(), active_ticket_count = 0, max_concurrent_tickets = 3
      WHERE user_id = 'user_carlos';
    `);

    const leadReassign = await apiClient.post('/api/inbox/tickets/tkt_unassigned_pii/assign', {
      targetAgentId: 'user_carlos'
    }, { headers: elenaHeaders });
    assert.strictEqual(leadReassign.status, 200);
    assert.strictEqual(leadReassign.data.assignedAgentId, 'user_carlos');

    // Verify Sarah decremented (1 -> 0) and Carlos incremented (0 -> 1)
    const sarahAfterLeadReassign = (await directPool.query(`SELECT active_ticket_count FROM agent_profiles WHERE user_id = 'user_sarah_lin'`)).rows[0].active_ticket_count;
    const carlosAfterLeadReassign = (await directPool.query(`SELECT active_ticket_count FROM agent_profiles WHERE user_id = 'user_carlos'`)).rows[0].active_ticket_count;
    assert.strictEqual(sarahAfterLeadReassign, 0);
    assert.strictEqual(carlosAfterLeadReassign, 1);

    console.log('[PASS] Test 8: Ticket self-claim, RBAC assignment gating, and lead reassignment verified.');

    // -------------------------------------------------------------------------
    // TEST 9: Ticket Transfer & Resolution via API
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 9: Ticket Transfer & Resolution via API ---');
    // Carlos transfers tkt_unassigned_pii back to Sarah
    const transferRes = await apiClient.post('/api/inbox/tickets/tkt_unassigned_pii/transfer', {
      toAgentId: 'user_sarah_lin',
      handoffSummaryJson: {
        customerIntent: 'Defective item exchange',
        attemptedTroubleshooting: 'Verified RMA criteria',
        nextAction: 'Send return shipping label'
      },
      internalNotes: 'Customer requested Sarah Lin specifically.'
    }, { headers: carlosHeaders });

    assert.strictEqual(transferRes.status, 200);
    assert.strictEqual(transferRes.data.success, true);
    assert.strictEqual(transferRes.data.toAgentId, 'user_sarah_lin');

    // Verify handoff was persisted
    const handoffRow = (await directPool.query(`SELECT * FROM ticket_handoff_summaries WHERE id = $1`, [transferRes.data.handoffId])).rows[0];
    assert.strictEqual(handoffRow.from_agent_id, 'user_carlos');
    assert.strictEqual(handoffRow.to_agent_id, 'user_sarah_lin');
    assert.strictEqual(handoffRow.internal_notes, 'Customer requested Sarah Lin specifically.');

    // Sarah resolves the ticket via API
    const resolveRes = await apiClient.post('/api/inbox/tickets/tkt_unassigned_pii/resolve', {}, { headers: s2Headers });
    assert.strictEqual(resolveRes.status, 200);
    assert.strictEqual(resolveRes.data.status, 'Resolved');

    const tktResolved = (await directPool.query(`SELECT status FROM tickets WHERE id = 'tkt_unassigned_pii'`)).rows[0];
    assert.strictEqual(tktResolved.status, 'Resolved');

    console.log('[PASS] Test 9: Ticket transfer with structured handoff summary and resolution verified.');

    // -------------------------------------------------------------------------
    // TEST 10: Mixed Concurrency Stress Test & Final Database Consistency
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 10: Mixed Concurrency Stress Test & Capacity Consistency ---');
    // 10a: Opposing concurrent transfers
    console.log('  [10a] Opposing concurrent transfers (Sarah -> Carlos AND Carlos -> Sarah)...');
    await directPool.query(`
      UPDATE agent_profiles SET configured_status = 'Available', last_heartbeat_at = NOW(), active_ticket_count = 1, max_concurrent_tickets = 10 WHERE user_id = 'user_sarah_lin';
      UPDATE agent_profiles SET configured_status = 'Available', last_heartbeat_at = NOW(), active_ticket_count = 1, max_concurrent_tickets = 10 WHERE user_id = 'user_carlos';
      DELETE FROM ticket_routing_queue WHERE brand_id = 'brand_novacart';

      -- Ticket 1 assigned to Sarah
      INSERT INTO tickets (id, brand_id, customer_id, category, priority, status, assigned_agent_id, human_requested, summary, last_updated)
      VALUES ('tkt_opp_b2_1', 'brand_novacart', 'cust_aarav', 'returns', 'High', 'Human Agent Active', 'user_sarah_lin', TRUE, 'Opp 1', NOW())
      ON CONFLICT (brand_id, id) DO UPDATE SET assigned_agent_id = 'user_sarah_lin', status = 'Human Agent Active';
      INSERT INTO ticket_routing_queue (id, brand_id, ticket_id, customer_id, priority, customer_language, required_skills, status, assigned_agent_id)
      VALUES ('q_opp_b2_1', 'brand_novacart', 'tkt_opp_b2_1', 'cust_aarav', 'High', 'en-US', ARRAY['returns'], 'assigned', 'user_sarah_lin')
      ON CONFLICT (id) DO UPDATE SET status = 'assigned', assigned_agent_id = 'user_sarah_lin';

      -- Ticket 2 assigned to Carlos
      INSERT INTO tickets (id, brand_id, customer_id, category, priority, status, assigned_agent_id, human_requested, summary, last_updated)
      VALUES ('tkt_opp_b2_2', 'brand_novacart', 'cust_priya', 'returns', 'High', 'Human Agent Active', 'user_carlos', TRUE, 'Opp 2', NOW())
      ON CONFLICT (brand_id, id) DO UPDATE SET assigned_agent_id = 'user_carlos', status = 'Human Agent Active';
      INSERT INTO ticket_routing_queue (id, brand_id, ticket_id, customer_id, priority, customer_language, required_skills, status, assigned_agent_id)
      VALUES ('q_opp_b2_2', 'brand_novacart', 'tkt_opp_b2_2', 'cust_priya', 'High', 'es-ES', ARRAY['returns'], 'assigned', 'user_carlos')
      ON CONFLICT (id) DO UPDATE SET status = 'assigned', assigned_agent_id = 'user_carlos';
    `);

    const opposingRes = await Promise.allSettled([
      transferTicketAtomically({
        brandId: 'brand_novacart',
        ticketId: 'tkt_opp_b2_1',
        fromAgentId: 'user_sarah_lin',
        toAgentId: 'user_carlos',
        handoffSummaryJson: { note: 'opposing 1' }
      }),
      transferTicketAtomically({
        brandId: 'brand_novacart',
        ticketId: 'tkt_opp_b2_2',
        fromAgentId: 'user_carlos',
        toAgentId: 'user_sarah_lin',
        handoffSummaryJson: { note: 'opposing 2' }
      })
    ]);

    const opposingDeadlocks = opposingRes.filter(r => r.status === 'rejected' && r.reason?.code === '40P01');
    assert.strictEqual(opposingDeadlocks.length, 0, 'Opposing transfers must produce zero deadlocks');
    assert.strictEqual(opposingRes[0].status, 'fulfilled');
    assert.strictEqual(opposingRes[1].status, 'fulfilled');
    console.log('  [PASS] Opposing transfers succeeded concurrently with ZERO deadlocks.');

    // 10b: Full mixed concurrency stress run across 15 tickets
    console.log('  [10b] Full mixed concurrency stress run (enqueue, routing, transfers, resolutions, reconciliations)...');
    await directPool.query(`
      UPDATE tickets SET status = 'Resolved' WHERE brand_id = 'brand_novacart' AND status IN ('Human Requested', 'Human Agent Active');
      DELETE FROM ticket_routing_queue WHERE brand_id = 'brand_novacart';
      UPDATE agent_profiles SET configured_status = 'Available', last_heartbeat_at = NOW(), active_ticket_count = 0, max_concurrent_tickets = 10 WHERE user_id = 'user_sarah_lin';
      UPDATE agent_profiles SET configured_status = 'Available', last_heartbeat_at = NOW(), active_ticket_count = 0, max_concurrent_tickets = 10 WHERE user_id = 'user_carlos';
    `);

    // Create 15 tickets
    for (let i = 0; i < 15; i++) {
      const tid = `tkt_stress_b2_${i}`;
      await directPool.query(`
        INSERT INTO tickets (id, brand_id, customer_id, category, priority, status, human_requested, summary, last_updated)
        VALUES ($1, 'brand_novacart', 'cust_aarav', 'general_inquiry', 'High', 'AI Handling', FALSE, 'Stress B2', NOW())
        ON CONFLICT (brand_id, id) DO UPDATE SET status = 'AI Handling', human_requested = FALSE, assigned_agent_id = NULL;
      `, [tid]);
    }

    const tasks = [];
    for (let i = 0; i < 15; i++) {
      const tid = `tkt_stress_b2_${i}`;
      tasks.push((async () => {
        // Enqueue
        await enqueueOrReopenTicket({
          brandId: 'brand_novacart',
          ticketId: tid,
          priority: 'High',
          customerLanguage: 'en-US',
          requiredSkills: ['general_inquiry']
        });

        // Atomic Routing
        const assignRes = await assignQueuedTicketAtomically('brand_novacart', { translationAvailable: true });

        if (assignRes.assigned && assignRes.ticketId === tid) {
          // If assigned to Sarah, transfer some to Carlos
          if (assignRes.agentId === 'user_sarah_lin' && i % 3 === 0) {
            await transferTicketAtomically({
              brandId: 'brand_novacart',
              ticketId: tid,
              fromAgentId: 'user_sarah_lin',
              toAgentId: 'user_carlos',
              handoffSummaryJson: { stress: true }
            }).catch(() => {});
          }

          // Resolve half of the tickets
          if (i % 2 === 0) {
            await resolveTicketAndReleaseCapacity({
              brandId: 'brand_novacart',
              ticketId: tid
            }).catch(() => {});
          }
        }
      })());
    }

    // Interleave concurrent live reconciliation
    tasks.push(reconcileAgentCapacity({ brandId: 'brand_novacart', userId: 'user_sarah_lin' }));
    tasks.push(reconcileAgentCapacity({ brandId: 'brand_novacart', userId: 'user_carlos' }));

    const stressOutcomes = await Promise.allSettled(tasks);
    const deadlocks = stressOutcomes.filter(r => r.status === 'rejected' && r.reason?.code === '40P01');
    assert.strictEqual(deadlocks.length, 0, `Expected 0 deadlocks (40P01), found ${deadlocks.length}`);
    console.log(`  [Concurrent Execution]: Completed ${tasks.length} concurrent operations with ZERO deadlocks.`);

    // 10c: Final Database Consistency Audit
    console.log('  [10c] Final Capacity Audit: comparing active_ticket_count against committed active assignments...');
    const sarahCommitted = (await directPool.query(`
      SELECT COUNT(*)::INTEGER AS count FROM tickets
      WHERE brand_id = 'brand_novacart' AND assigned_agent_id = 'user_sarah_lin' AND status IN ('Human Requested', 'Human Agent Active')
    `)).rows[0].count;

    const sarahProfile = (await directPool.query(`
      SELECT active_ticket_count FROM agent_profiles WHERE brand_id = 'brand_novacart' AND user_id = 'user_sarah_lin'
    `)).rows[0].active_ticket_count;

    assert.strictEqual(sarahProfile, sarahCommitted, `Sarah active_ticket_count (${sarahProfile}) must strictly match committed active assignments (${sarahCommitted})`);

    const carlosCommitted = (await directPool.query(`
      SELECT COUNT(*)::INTEGER AS count FROM tickets
      WHERE brand_id = 'brand_novacart' AND assigned_agent_id = 'user_carlos' AND status IN ('Human Requested', 'Human Agent Active')
    `)).rows[0].count;

    const carlosProfile = (await directPool.query(`
      SELECT active_ticket_count FROM agent_profiles WHERE brand_id = 'brand_novacart' AND user_id = 'user_carlos'
    `)).rows[0].active_ticket_count;

    assert.strictEqual(carlosProfile, carlosCommitted, `Carlos active_ticket_count (${carlosProfile}) must strictly match committed active assignments (${carlosCommitted})`);

    console.log(`  [Final Database Audit]: Sarah committed=${sarahCommitted}, profile=${sarahProfile}; Carlos committed=${carlosCommitted}, profile=${carlosProfile}`);
    console.log('[PASS] Test 10: Concurrency safety, opposing transfers, and exact capacity consistency verified.');

    // Wait for any debounced scheduler setImmediate cycles to complete
    await new Promise(resolve => setTimeout(resolve, 500));

    console.log('\n================================================================================');
    console.log('=== [ALL 10 CHECKPOINT E2-B2 INTEGRATION TESTS PASSED SUCCESSFULLY] ===');
    console.log('================================================================================\n');

  } catch (err) {
    console.error('\n[FATAL TEST FAILURE IN BODY]:', err);
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

runE2B2Tests().catch(err => {
  console.error('\n[FATAL TEST FAILURE]:', err);
  process.exit(1);
});
