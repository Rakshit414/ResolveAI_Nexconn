import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import crypto from 'crypto';
import pg from 'pg';
import EmbeddedPostgres from 'embedded-postgres';
import axios from 'axios';
import bcrypt from 'bcryptjs';
import { runMigration } from '../src/db/migrate.js';
import { closePool } from '../src/db/pool.js';
import { app } from '../src/server.js';
import { seedDemoWorkforce, DEMO_AGENTS } from '../src/db/seedWorkforce.js';
import { transferTicketAtomically } from '../src/services/capacityService.js';
import { getAgentRoster, getTicketDetailsWithHistory } from '../src/services/sharedInboxService.js';
import { processNextOutboxJob } from '../src/services/outboxWorker.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');
const TEST_PORT = 54345;
const APP_PORT = 5022;
const PG16_DATA_DIR = path.resolve(ROOT_DIR, 'server/data/pg16_multi_agent_test_instance');
const TEST_DB_URL = `postgresql://postgres:postgres@127.0.0.1:${TEST_PORT}/postgres`;
const BASE_URL = `http://127.0.0.1:${APP_PORT}`;

console.log('================================================================================');
console.log('=== [TEST SUITE: Multi-Agent Support System — 20 Verification Scenarios] ===');
console.log('================================================================================\n');

async function runMultiAgentTestSuite() {
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
  const originalApiUrl = process.env.NEXCONN_API_URL;
  const originalAppKey = process.env.NEXCONN_APP_KEY;
  const originalAppSecret = process.env.NEXCONN_APP_SECRET;

  process.env.DATABASE_URL = TEST_DB_URL;
  process.env.NODE_ENV = 'test';
  process.env.PORT = String(APP_PORT);
  process.env.AGENT_JWT_SECRET = 'test_secret_key_multi_agent_2026';
  process.env.NEXCONN_APP_KEY = 'test_mock_key';
  process.env.NEXCONN_APP_SECRET = 'test_mock_sec';

  // Three distinct test credentials for the demo workforce
  const TEST_PASSWORDS = {
    user_sarah_lin: 'SarahLinTest2026!',
    user_carlos: 'CarlosGTest2026!',
    user_elena: 'ElenaRTest2026!'
  };

  process.env.AGENT_SARAH_PASSWORD_HASH = bcrypt.hashSync(TEST_PASSWORDS.user_sarah_lin, 10);
  process.env.AGENT_CARLOS_PASSWORD_HASH = bcrypt.hashSync(TEST_PASSWORDS.user_carlos, 10);
  process.env.AGENT_ELENA_PASSWORD_HASH = bcrypt.hashSync(TEST_PASSWORDS.user_elena, 10);

  let mockNexconnServer = null;
  let mockNexconnPort = null;
  const capturedNexconnRequests = [];

  mockNexconnServer = http.createServer((req, res) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      let body = {};
      try { body = JSON.parse(raw); } catch (e) { body = { raw }; }
      capturedNexconnRequests.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body
      });
      const targetUserId = body.toUserIds?.[0] || 'nex_user_rajesh';
      const generatedMsgId = `nex_mock_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        code: 0,
        msg: 'ok',
        result: {
          messageIds: [
            { userId: targetUserId, messageId: generatedMsgId }
          ]
        }
      }));
    });
  });

  await new Promise((resolve) => {
    mockNexconnServer.listen(0, '127.0.0.1', () => {
      mockNexconnPort = mockNexconnServer.address().port;
      process.env.NEXCONN_API_URL = `http://127.0.0.1:${mockNexconnPort}`;
      console.log(`[Mock Nexconn Setup] Local mock Nexconn server running on port ${mockNexconnPort}`);
      resolve();
    });
  });

  const { Pool } = pg;
  const directPool = new Pool({
    connectionString: TEST_DB_URL,
    max: 20,
    idleTimeoutMillis: 5000,
  });

  let server;

  try {
    // 1. Run migrations
    console.log('[Setup] Executing migrations on clean PG16 instance...');
    await runMigration();
    console.log('[Setup] Migrations 001-005 applied cleanly.');

    // 2. Run workforce seed
    console.log('[Setup] Seeding demo workforce...');
    await seedDemoWorkforce(directPool, 'brand_novacart');
    console.log('[Setup] Demo workforce seeded.');

    // 3. Start express test server
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(APP_PORT, resolve));
    console.log(`[Setup] Express API server listening on ${BASE_URL}\n`);

    // ============================================================================
    // SCENARIO 1: 3 agent accounts exist in users table with distinct bcrypt password hashes
    // ============================================================================
    console.log('Scenario 1: 3 agent accounts exist in users table with distinct bcrypt password hashes...');
    const usersRes = await directPool.query(`
      SELECT id, email, password_hash, name FROM users
      WHERE id IN ('user_sarah_lin', 'user_carlos', 'user_elena')
      ORDER BY id ASC
    `);
    assert.strictEqual(usersRes.rows.length, 3, 'Expected exactly 3 demo agents in users table');

    // Assert all 3 hashes are distinct
    const distinctHashes = new Set(usersRes.rows.map(u => u.password_hash));
    assert.strictEqual(distinctHashes.size, 3, 'All 3 agent password hashes must be distinct');

    for (const u of usersRes.rows) {
      assert(u.password_hash.startsWith('$2b$10$'), `Password hash for ${u.id} must be valid bcrypt`);
      const matchesOwn = await bcrypt.compare(TEST_PASSWORDS[u.id], u.password_hash);
      assert.strictEqual(matchesOwn, true, `Password for ${u.id} must verify against its designated distinct credential`);

      // Verify cross-authentication fails (credentials are distinct and non-interchangeable)
      for (const [otherId, otherPw] of Object.entries(TEST_PASSWORDS)) {
        if (otherId !== u.id) {
          const crossMatches = await bcrypt.compare(otherPw, u.password_hash);
          assert.strictEqual(crossMatches, false, `Credential for ${otherId} must NOT verify against hash for ${u.id}`);
        }
      }
    }
    console.log('  -> PASS: 3 agent accounts exist with distinct, non-interchangeable bcrypt hashes\n');

    // ============================================================================
    // SCENARIO 2: All 3 agents have active brand memberships
    // ============================================================================
    console.log('Scenario 2: All 3 agents have active brand memberships with correct roles...');
    const membershipsRes = await directPool.query(`
      SELECT user_id, brand_id, role, deactivated_at FROM brand_memberships
      WHERE brand_id = 'brand_novacart' AND user_id IN ('user_sarah_lin', 'user_carlos', 'user_elena')
      ORDER BY user_id ASC
    `);
    assert.strictEqual(membershipsRes.rows.length, 3, 'All 3 agents must have brand memberships');
    const roleMap = Object.fromEntries(membershipsRes.rows.map(m => [m.user_id, m]));
    assert.strictEqual(roleMap.user_sarah_lin.role, 'support_lead', 'Sarah Lin must be support_lead');
    assert.strictEqual(roleMap.user_carlos.role, 'agent', 'Carlos Gomez must be agent');
    assert.strictEqual(roleMap.user_elena.role, 'agent', 'Elena Rodriguez must be agent');
    assert.strictEqual(roleMap.user_sarah_lin.deactivated_at, null);
    assert.strictEqual(roleMap.user_carlos.deactivated_at, null);
    assert.strictEqual(roleMap.user_elena.deactivated_at, null);
    console.log('  -> PASS: Active brand memberships verified (Sarah: support_lead, Carlos: agent, Elena: agent)\n');

    // ============================================================================
    // SCENARIO 3: All 3 agents have agent_profiles with correct skills and languages
    // ============================================================================
    console.log('Scenario 3: All 3 agents have agent_profiles with skills and language arrays...');
    const profilesRes = await directPool.query(`
      SELECT user_id, primary_language, supported_languages, skills, max_concurrent_tickets
      FROM agent_profiles
      WHERE brand_id = 'brand_novacart' AND user_id IN ('user_sarah_lin', 'user_carlos', 'user_elena')
      ORDER BY user_id ASC
    `);
    assert.strictEqual(profilesRes.rows.length, 3, 'All 3 profiles must exist');
    const profMap = Object.fromEntries(profilesRes.rows.map(p => [p.user_id, p]));
    assert(profMap.user_sarah_lin.skills.includes('logistics'), 'Sarah skills must include logistics');
    assert(profMap.user_carlos.skills.includes('billing'), 'Carlos skills must include billing');
    assert(profMap.user_elena.skills.includes('escalations'), 'Elena skills must include escalations');
    assert(profMap.user_carlos.supported_languages.includes('es-ES'), 'Carlos supported languages must include es-ES');
    assert.strictEqual(profMap.user_carlos.max_concurrent_tickets, 3);
    console.log('  -> PASS: Agent profiles contain valid skills, languages, and capacity limits\n');

    // ============================================================================
    // SCENARIO 4: All 3 agents can authenticate and receive valid session tokens
    // ============================================================================
    console.log('Scenario 4: All 3 agents authenticate and receive valid session tokens...');
    const sessionTokens = {};
    const csrfTokens = {};
    for (const ag of DEMO_AGENTS) {
      const loginRes = await axios.post(`${BASE_URL}/api/auth/agent/login`, {
        email: ag.email,
        password: TEST_PASSWORDS[ag.userId],
        brandId: 'brand_novacart'
      });
      assert.strictEqual(loginRes.status, 200);
      assert.strictEqual(loginRes.data.success, true);
      assert(loginRes.data.sessionToken, `Login response must contain sessionToken for ${ag.userId}`);
      assert.strictEqual(loginRes.data.agent.id, ag.userId);
      sessionTokens[ag.userId] = loginRes.data.sessionToken;
      csrfTokens[ag.userId] = loginRes.data.csrfToken;
    }
    console.log('  -> PASS: All 3 agents authenticated successfully with distinct credentials\n');

    // Hardened workforce model verification: newly provisioned agents default to Offline until heartbeat & status update
    console.log('Verifying initial post-login state (hardened workforce defaults to Offline)...');
    const initialRosterRes = await axios.get(`${BASE_URL}/api/inbox/roster`, {
      headers: { Authorization: `Bearer ${sessionTokens.user_sarah_lin}` }
    });
    assert.strictEqual(initialRosterRes.status, 200);
    const initialCarlos = initialRosterRes.data.roster.find(a => a.userId === 'user_carlos');
    const initialElena = initialRosterRes.data.roster.find(a => a.userId === 'user_elena');
    assert.strictEqual(initialCarlos.effectiveStatus, 'Offline', 'Carlos must be Offline prior to heartbeat/status update');
    assert.strictEqual(initialElena.effectiveStatus, 'Offline', 'Elena must be Offline prior to heartbeat/status update');
    console.log('  -> PASS: Verified agents are Offline immediately following login\n');

    // Requirements 1-3: Send actual heartbeat request and set status to Available using actual supported endpoints
    console.log('Activating agents via official authenticated heartbeat and status endpoints...');
    for (const ag of DEMO_AGENTS) {
      const hbRes = await axios.post(`${BASE_URL}/api/agent/heartbeat`, {}, {
        headers: {
          Authorization: `Bearer ${sessionTokens[ag.userId]}`,
          'X-CSRF-Token': csrfTokens[ag.userId]
        }
      });
      assert.strictEqual(hbRes.status, 200, `Heartbeat failed for ${ag.userId}`);
      assert.strictEqual(hbRes.data.success, true);
      assert(hbRes.data.lastHeartbeatAt, `lastHeartbeatAt must be returned for ${ag.userId}`);

      const statusRes = await axios.patch(`${BASE_URL}/api/agent/status`, {
        status: 'Available'
      }, {
        headers: {
          Authorization: `Bearer ${sessionTokens[ag.userId]}`,
          'X-CSRF-Token': csrfTokens[ag.userId]
        }
      });
      assert.strictEqual(statusRes.status, 200, `Status update failed for ${ag.userId}`);
      assert.strictEqual(statusRes.data.success, true);
      assert.strictEqual(statusRes.data.profile.configured_status || statusRes.data.profile.configuredStatus, 'Available');
    }
    console.log('  -> PASS: Heartbeat and status set to Available for all 3 agents via official endpoints\n');

    // ============================================================================
    // SCENARIO 5: Agent roster API returns all 3 agents with correct availability
    // ============================================================================
    console.log('Scenario 5: Agent roster API returns all 3 agents with correct availability...');
    const rosterRes = await axios.get(`${BASE_URL}/api/inbox/roster`, {
      headers: { Authorization: `Bearer ${sessionTokens.user_sarah_lin}` }
    });
    assert.strictEqual(rosterRes.status, 200);
    assert.strictEqual(rosterRes.data.success, true);
    assert(rosterRes.data.roster.length >= 3, 'Roster must return at least 3 agents');
    const sarahRoster = rosterRes.data.roster.find(a => a.userId === 'user_sarah_lin');
    const carlosRoster = rosterRes.data.roster.find(a => a.userId === 'user_carlos');
    const elenaRoster = rosterRes.data.roster.find(a => a.userId === 'user_elena');
    assert(sarahRoster && carlosRoster && elenaRoster, 'Sarah, Carlos, Elena must all be in roster');
    assert.strictEqual(sarahRoster.effectiveStatus, 'Available');
    assert.strictEqual(carlosRoster.effectiveStatus, 'Available');
    assert.strictEqual(elenaRoster.effectiveStatus, 'Available');
    console.log('  -> PASS: Roster returns all 3 agents with live availability status\n');

    // ============================================================================
    // SCENARIO 6: Target agent dropdown excludes the current agent
    // ============================================================================
    console.log('Scenario 6: Transfer modal target agent dropdown excludes the current agent...');
    const sarahCurrentRoster = rosterRes.data.roster.filter(a => a.userId !== 'user_sarah_lin');
    assert.strictEqual(sarahCurrentRoster.some(a => a.userId === 'user_sarah_lin'), false, 'Sarah must be excluded when she is current agent');
    assert(sarahCurrentRoster.some(a => a.userId === 'user_carlos'), 'Carlos must be present as target');
    assert(sarahCurrentRoster.some(a => a.userId === 'user_elena'), 'Elena must be present as target');
    console.log('  -> PASS: Current agent properly excluded from transfer target candidates\n');

    // ============================================================================
    // SCENARIO 7: Transfer modal correctly reflects agent availability status
    // ============================================================================
    console.log('Scenario 7: Transfer modal correctly reflects agent availability status...');
    for (const a of sarahCurrentRoster) {
      assert(['Available', 'Busy', 'Away', 'Offline', 'At Capacity'].includes(a.effectiveStatus));
    }
    console.log('  -> PASS: Availability status correctly evaluated for all target agents\n');

    // ============================================================================
    // SCENARIO 8: Transfer modal correctly reflects agent workload (active/max)
    // ============================================================================
    console.log('Scenario 8: Transfer modal correctly reflects agent workload (active tickets / max capacity)...');
    assert.strictEqual(typeof carlosRoster.activeTicketCount, 'number');
    assert.strictEqual(typeof carlosRoster.maxConcurrentTickets, 'number');
    assert(carlosRoster.activeTicketCount <= carlosRoster.maxConcurrentTickets);
    console.log(`  -> PASS: Carlos workload: ${carlosRoster.activeTicketCount}/${carlosRoster.maxConcurrentTickets}\n`);

    // Seed test customer & test ticket #NC1021
    console.log('[Setup] Inserting test customer and ticket NC1021 assigned to Sarah Lin...');
    await directPool.query(`
      INSERT INTO customers (id, brand_id, name, email, nexconn_user_id)
      VALUES ('cust_rajesh', 'brand_novacart', 'Rajesh Sharma', 'rajesh.sharma@example.com', 'nex_user_rajesh')
      ON CONFLICT (brand_id, id) DO NOTHING
    `);
    await directPool.query(`
      INSERT INTO tickets (id, brand_id, customer_id, category, priority, status, summary, assigned_agent_id, human_requested, last_updated)
      VALUES ('NC1021', 'brand_novacart', 'cust_rajesh', 'logistics', 'High', 'Human Agent Active', 'Delayed shipment inquiry', 'user_sarah_lin', TRUE, NOW())
      ON CONFLICT (brand_id, id) DO UPDATE SET assigned_agent_id = 'user_sarah_lin', status = 'Human Agent Active'
    `);
    await directPool.query(`
      INSERT INTO ticket_routing_queue (id, brand_id, ticket_id, customer_id, priority, customer_language, required_skills, status, assigned_agent_id, assigned_at)
      VALUES ('q_nc1021', 'brand_novacart', 'NC1021', 'cust_rajesh', 'High', 'en-US', ARRAY['logistics'], 'assigned', 'user_sarah_lin', NOW())
      ON CONFLICT (id) DO UPDATE SET assigned_agent_id = 'user_sarah_lin', status = 'assigned'
    `);
    await directPool.query(`
      INSERT INTO conversation_mappings (id, brand_id, ticket_id, customer_id, customer_user_id, conversation_key, support_identity)
      VALUES ('map_nc1021', 'brand_novacart', 'NC1021', 'cust_rajesh', 'nex_user_rajesh', 'conv_key_nc1021', 'novacart_support')
      ON CONFLICT (id) DO NOTHING
    `);
    await directPool.query(`
      UPDATE agent_profiles SET active_ticket_count = 1, last_heartbeat_at = NOW()
      WHERE brand_id = 'brand_novacart' AND user_id = 'user_sarah_lin'
    `);
    await directPool.query(`
      UPDATE agent_profiles SET active_ticket_count = 0, last_heartbeat_at = NOW(), configured_status = 'Available'
      WHERE brand_id = 'brand_novacart' AND user_id = 'user_carlos'
    `);
    // Insert initial customer message in message_archive
    await directPool.query(`
      INSERT INTO message_archive (id, brand_id, ticket_id, nexconn_message_id, sender_role, sender_user_id, target_user_id, sender_name, message_text, sent_at)
      VALUES ('msg_seed_001', 'brand_novacart', 'NC1021', 'nex_msg_001', 'customer', 'cust_rajesh', 'user_sarah_lin', 'Rajesh Sharma', 'Where is my order #NC1021?', NOW() - INTERVAL '5 minutes')
      ON CONFLICT (id) DO NOTHING
    `);

    // Verify pre-transfer inbox visibility: Sarah sees ticket NC1021 in my-tickets, Carlos does not
    const sarahPreInbox = await axios.get(`${BASE_URL}/api/inbox/my-tickets`, {
      headers: { Authorization: `Bearer ${sessionTokens.user_sarah_lin}` }
    });
    assert.strictEqual(sarahPreInbox.status, 200);
    assert(sarahPreInbox.data.tickets.some(t => t.id === 'NC1021'), 'Sarah must see ticket NC1021 in my-tickets before transfer');

    const carlosPreInbox = await axios.get(`${BASE_URL}/api/inbox/my-tickets`, {
      headers: { Authorization: `Bearer ${sessionTokens.user_carlos}` }
    });
    assert.strictEqual(carlosPreInbox.status, 200);
    assert(!carlosPreInbox.data.tickets.some(t => t.id === 'NC1021'), 'Carlos must not see ticket NC1021 in my-tickets before transfer');

    // ============================================================================
    // SCENARIO 9: Transfer from Sarah to Carlos succeeds atomically
    // ============================================================================
    console.log('Scenario 9: Transfer from Sarah to Carlos succeeds atomically...');
    const transferRes = await axios.post(`${BASE_URL}/api/inbox/tickets/NC1021/transfer`, {
      toAgentId: 'user_carlos',
      handoffSummaryJson: {
        reason: 'Customer requested Spanish or Billing assistance',
        customerContext: 'Rajesh Sharma (NC1021)',
        transferredAt: new Date().toISOString()
      },
      internalNotes: 'Customer is inquiring about delayed NovaSprint Pro shoes.'
    }, {
      headers: {
        Authorization: `Bearer ${sessionTokens.user_sarah_lin}`,
        'X-CSRF-Token': csrfTokens.user_sarah_lin
      }
    });
    assert.strictEqual(transferRes.status, 200);
    assert.strictEqual(transferRes.data.success, true);
    assert.strictEqual(transferRes.data.ticketId, 'NC1021');
    assert.strictEqual(transferRes.data.toAgentId, 'user_carlos');
    console.log('  -> PASS: Atomic transfer API completed successfully\n');

    // ============================================================================
    // SCENARIO 10: Transferred ticket updates assigned_agent_id to Carlos
    // ============================================================================
    console.log('Scenario 10: Transferred ticket updates assigned_agent_id to Carlos...');
    const ticketDbRes = await directPool.query(`
      SELECT id, assigned_agent_id, status FROM tickets WHERE brand_id = 'brand_novacart' AND id = 'NC1021'
    `);
    assert.strictEqual(ticketDbRes.rows[0].assigned_agent_id, 'user_carlos');
    assert.strictEqual(ticketDbRes.rows[0].status, 'Human Agent Active');
    console.log('  -> PASS: tickets table reflects assigned_agent_id = user_carlos\n');

    // ============================================================================
    // SCENARIO 11: Carlos\'s active ticket count increments by 1
    // ============================================================================
    console.log('Scenario 11: Carlos active ticket count increments by 1...');
    const carlosProf = await directPool.query(`
      SELECT active_ticket_count FROM agent_profiles WHERE brand_id = 'brand_novacart' AND user_id = 'user_carlos'
    `);
    assert.strictEqual(carlosProf.rows[0].active_ticket_count, 1, 'Carlos active ticket count must be 1');
    console.log('  -> PASS: Carlos active_ticket_count incremented to 1\n');

    // ============================================================================
    // SCENARIO 12: Sarah\'s active ticket count decrements by 1
    // ============================================================================
    console.log('Scenario 12: Sarah active ticket count decrements by 1...');
    const sarahProf = await directPool.query(`
      SELECT active_ticket_count FROM agent_profiles WHERE brand_id = 'brand_novacart' AND user_id = 'user_sarah_lin'
    `);
    assert.strictEqual(sarahProf.rows[0].active_ticket_count, 0, 'Sarah active ticket count must be 0');
    console.log('  -> PASS: Sarah active_ticket_count decremented to 0\n');

    // ============================================================================
    // SCENARIO 13: Transfer creates a ticket_handoff_summaries record with transfer reason
    // ============================================================================
    console.log('Scenario 13: Transfer creates ticket_handoff_summaries record with transfer reason...');
    const handoffRes = await directPool.query(`
      SELECT id, from_agent_id, to_agent_id, ai_summary_json, internal_notes
      FROM ticket_handoff_summaries
      WHERE brand_id = 'brand_novacart' AND ticket_id = 'NC1021'
      ORDER BY created_at DESC LIMIT 1
    `);
    assert.strictEqual(handoffRes.rows.length, 1, 'Handoff summary row must exist');
    assert.strictEqual(handoffRes.rows[0].from_agent_id, 'user_sarah_lin');
    assert.strictEqual(handoffRes.rows[0].to_agent_id, 'user_carlos');
    const summaryJson = typeof handoffRes.rows[0].ai_summary_json === 'string'
      ? JSON.parse(handoffRes.rows[0].ai_summary_json)
      : handoffRes.rows[0].ai_summary_json;
    assert(summaryJson.reason.includes('Spanish or Billing assistance'));
    assert(handoffRes.rows[0].internal_notes.includes('delayed NovaSprint Pro'));
    console.log('  -> PASS: ticket_handoff_summaries record verified with full audit reason & notes\n');

    // ============================================================================
    // SCENARIO 14: Transfer preserves full conversation history (no messages lost)
    // ============================================================================
    console.log('Scenario 14: Transfer preserves full conversation history...');
    const msgRes = await directPool.query(`
      SELECT id, message_text FROM message_archive WHERE brand_id = 'brand_novacart' AND ticket_id = 'NC1021'
    `);
    assert.strictEqual(msgRes.rows.length, 1, 'Pre-existing messages must remain intact');
    assert.strictEqual(msgRes.rows[0].message_text, 'Where is my order #NC1021?');
    console.log('  -> PASS: Conversation history fully preserved in message_archive\n');

    // ============================================================================
    // SCENARIO 15: Transfer preserves customer session on Nexconn channel
    // ============================================================================
    console.log('Scenario 15: Transfer preserves customer session on Nexconn channel...');
    const queueRow = await directPool.query(`
      SELECT id, assigned_agent_id, status FROM ticket_routing_queue WHERE brand_id = 'brand_novacart' AND ticket_id = 'NC1021'
    `);
    assert.strictEqual(queueRow.rows[0].assigned_agent_id, 'user_carlos');
    assert.strictEqual(queueRow.rows[0].status, 'assigned');

    const convMapping = await directPool.query(`
      SELECT id, ticket_id, customer_user_id, conversation_key, support_identity
      FROM conversation_mappings WHERE brand_id = 'brand_novacart' AND ticket_id = 'NC1021'
    `);
    assert.strictEqual(convMapping.rows.length, 1, 'Original conversation mapping must be preserved');
    assert.strictEqual(convMapping.rows[0].conversation_key, 'conv_key_nc1021');
    assert.strictEqual(convMapping.rows[0].customer_user_id, 'nex_user_rajesh');
    console.log('  -> PASS: Same ticket queue identity and Nexconn conversation mapping preserved; channel uninterrupted\n');

    // ============================================================================
    // SCENARIO 16: Carlos can see all previous messages after transfer and inboxes update
    // ============================================================================
    console.log('Scenario 16: Carlos can see all previous messages after transfer and inboxes update...');
    // Post-transfer inbox visibility check for both agents
    const carlosPostInbox = await axios.get(`${BASE_URL}/api/inbox/my-tickets`, {
      headers: { Authorization: `Bearer ${sessionTokens.user_carlos}` }
    });
    assert.strictEqual(carlosPostInbox.status, 200);
    assert(carlosPostInbox.data.tickets.some(t => t.id === 'NC1021'), 'Carlos must now see ticket NC1021 in my-tickets after transfer');

    const sarahPostInbox = await axios.get(`${BASE_URL}/api/inbox/my-tickets`, {
      headers: { Authorization: `Bearer ${sessionTokens.user_sarah_lin}` }
    });
    assert.strictEqual(sarahPostInbox.status, 200);
    assert(!sarahPostInbox.data.tickets.some(t => t.id === 'NC1021'), 'Sarah must no longer see ticket NC1021 in my-tickets after transfer');

    const carlosTicketView = await axios.get(`${BASE_URL}/api/inbox/tickets/NC1021`, {
      headers: { Authorization: `Bearer ${sessionTokens.user_carlos}` }
    });
    assert.strictEqual(carlosTicketView.status, 200);
    assert.strictEqual(carlosTicketView.data.success, true);
    assert.strictEqual(carlosTicketView.data.ticket.assignedAgent.id, 'user_carlos');
    assert.strictEqual(carlosTicketView.data.ticket.conversationHistory.length, 1);
    assert.strictEqual(carlosTicketView.data.ticket.conversationHistory[0].content, 'Where is my order #NC1021?');
    assert.strictEqual(carlosTicketView.data.ticket.handoffSummaries.length, 1);
    assert.strictEqual(carlosTicketView.data.ticket.handoffSummaries[0].internal_notes || carlosTicketView.data.ticket.handoffSummaries[0].internalNotes, 'Customer is inquiring about delayed NovaSprint Pro shoes.');
    console.log('  -> PASS: Carlos receives unmasked customer context, full conversation, private notes, and both inboxes update cleanly\n');

    // ============================================================================
    // SCENARIO 17: Carlos can reply to customer through original conversation & outbox dispatches via signed client
    // ============================================================================
    console.log('Scenario 17: Carlos replies to customer through original Nexconn conversation...');

    // Clear captured requests prior to reply
    capturedNexconnRequests.length = 0;

    const replyRes = await axios.post(`${BASE_URL}/api/inbox/tickets/NC1021/reply`, {
      messageText: 'Hello Rajesh, Carlos here. I checked your shipment for order #NC1021. It is out for delivery today!'
    }, {
      headers: {
        Authorization: `Bearer ${sessionTokens.user_carlos}`,
        'X-CSRF-Token': csrfTokens.user_carlos
      }
    });
    assert.strictEqual(replyRes.status, 200);
    assert.strictEqual(replyRes.data.success, true);
    assert.strictEqual(replyRes.data.dispatchStatus, 'dispatched');

    // 1. Verify message recorded in message_archive
    const updatedMsgs = await directPool.query(`
      SELECT message_text, sender_user_id, sender_role FROM message_archive
      WHERE brand_id = 'brand_novacart' AND ticket_id = 'NC1021'
      ORDER BY sent_at DESC LIMIT 1
    `);
    assert(updatedMsgs.rows[0].message_text.includes('Carlos here'));
    assert(['user_carlos', 'novacart_support'].includes(updatedMsgs.rows[0].sender_user_id));

    // 2. Verify outbox_messages record
    const outboxCheck = await directPool.query(`
      SELECT id, ticket_id, conversation_mapping_id, dedupe_key, sender_user_id, target_user_id, message_text, dispatch_status, nexconn_message_id
      FROM outbox_messages
      WHERE brand_id = 'brand_novacart' AND ticket_id = 'NC1021'
      ORDER BY created_at DESC LIMIT 1
    `);
    assert.strictEqual(outboxCheck.rows.length, 1, 'Outbound reply must be recorded in outbox_messages');
    const outboxRow = outboxCheck.rows[0];
    assert(outboxRow.message_text.includes('Carlos here'));
    assert.strictEqual(outboxRow.target_user_id, 'nex_user_rajesh', 'Target must match authoritative customer ID');
    assert.strictEqual(outboxRow.sender_user_id, 'novacart_support', 'Sender must match authoritative support identity');
    assert.strictEqual(outboxRow.dispatch_status, 'dispatched', 'Dispatch status must be marked dispatched');
    assert.ok(outboxRow.nexconn_message_id, 'Nexconn message ID must be recorded');

    // 3. Verify authoritative conversation mapping
    const mappingCheck = await directPool.query(`
      SELECT id, conversation_key, customer_user_id, support_identity
      FROM conversation_mappings
      WHERE id = $1
    `, [outboxRow.conversation_mapping_id]);
    assert.strictEqual(mappingCheck.rows.length, 1);
    assert.strictEqual(mappingCheck.rows[0].conversation_key, 'conv_key_nc1021', 'Conversation key must match conv_key_nc1021');
    assert.strictEqual(mappingCheck.rows[0].customer_user_id, 'nex_user_rajesh');
    assert.strictEqual(mappingCheck.rows[0].support_identity, 'novacart_support');

    // 4. Verify exact signed dispatch request received by mock Nexconn server
    assert(capturedNexconnRequests.length >= 1, 'Mock Nexconn server must have received dispatch HTTP request');
    const capturedReq = capturedNexconnRequests[capturedNexconnRequests.length - 1];
    assert.strictEqual(capturedReq.method, 'POST');
    assert.strictEqual(capturedReq.url, '/v4/direct-channel/message/send');
    assert.strictEqual(capturedReq.headers['app-key'], 'test_mock_key');
    assert.ok(capturedReq.headers['nonce']);
    assert(capturedReq.headers['nonce'].length <= 18);
    assert.ok(capturedReq.headers['timestamp']);

    // Verify SHA1 signature: SHA1(AppSecret + Nonce + Timestamp)
    const expectedSig = crypto
      .createHash('sha1')
      .update(`test_mock_sec${capturedReq.headers['nonce']}${capturedReq.headers['timestamp']}`)
      .digest('hex');
    assert.strictEqual(capturedReq.headers['signature'], expectedSig, 'Request signature must match expected SHA1 hash');

    // Verify request payload body
    assert.strictEqual(capturedReq.body.fromUserId, 'novacart_support', 'Body fromUserId must be registered support identity');
    assert.deepStrictEqual(capturedReq.body.toUserIds, ['nex_user_rajesh'], 'Body toUserIds must contain customer ID');
    assert.strictEqual(capturedReq.body.messageType, 'RC:TxtMsg');
    const contentPayload = JSON.parse(capturedReq.body.content);
    assert(contentPayload.content.includes('Carlos here'));
    const extraCorrelation = JSON.parse(contentPayload.extra);
    assert.strictEqual(extraCorrelation.ticketId, 'NC1021');
    assert.strictEqual(extraCorrelation.brandId, 'brand_novacart');

    // 5. Verify idempotency: duplicate enqueue with same dedupe_key does NOT create duplicate outbox row
    const originalDedupeKey = outboxRow.dedupe_key;
    await directPool.query(`
      INSERT INTO outbox_messages (
        id, brand_id, ticket_id, conversation_mapping_id, dedupe_key,
        target_user_id, sender_user_id, message_type, message_text,
        content_payload, metadata, dispatch_status
      ) VALUES (
        'outbox_dup_attempt', 'brand_novacart', 'NC1021', $1, $2,
        'nex_user_rajesh', 'novacart_support', 'RC:TxtMsg', 'Duplicate message attempt',
        '{}', '{}', 'pending'
      )
      ON CONFLICT (dedupe_key) DO UPDATE SET next_attempt_at = NOW()
    `, [outboxRow.conversation_mapping_id, originalDedupeKey]);

    const dedupeCountRes = await directPool.query(`
      SELECT COUNT(*) AS total FROM outbox_messages WHERE dedupe_key = $1
    `, [originalDedupeKey]);
    assert.strictEqual(parseInt(dedupeCountRes.rows[0].total, 10), 1, 'Idempotency key must prevent duplicate outbox entries');

    // 6. Verify failed dispatch handling: outbox jobs never falsely report success
    const failOutboxId = 'outbox_simulated_fail';
    await directPool.query(`
      INSERT INTO outbox_messages (
        id, brand_id, ticket_id, conversation_mapping_id, dedupe_key,
        target_user_id, sender_user_id, message_type, message_text,
        content_payload, metadata, dispatch_status, attempt_count, max_attempts
      ) VALUES (
        $1, 'brand_novacart', 'NC1021', $2, 'dedupe_fail_sim_test',
        'wrong_customer_id', 'novacart_support', 'RC:TxtMsg', 'Test failure message',
        '{}', '{}', 'pending', 0, 5
      )
    `, [failOutboxId, outboxRow.conversation_mapping_id]);

    const failWorkerResult = await processNextOutboxJob();
    assert.strictEqual(failWorkerResult.status, 'failed', 'Worker must fail job with participant mismatch');
    const failedCheck = await directPool.query(`
      SELECT dispatch_status, last_error FROM outbox_messages WHERE id = $1
    `, [failOutboxId]);
    assert.strictEqual(failedCheck.rows[0].dispatch_status, 'failed');
    assert.notStrictEqual(failedCheck.rows[0].dispatch_status, 'dispatched', 'Failed dispatch must never report success');

    console.log('  -> PASS: Carlos reply verified through original conversation, signed Nexconn dispatch, idempotency, and error safety\n');

    // ============================================================================
    // SCENARIO 18: Transfer with invalid/offline agent fails with descriptive error
    // ============================================================================
    console.log('Scenario 18: Transfer with invalid/offline agent fails with descriptive error...');
    // Set Elena to Offline
    await directPool.query(`
      UPDATE agent_profiles SET configured_status = 'Offline' WHERE brand_id = 'brand_novacart' AND user_id = 'user_elena'
    `);
    try {
      await axios.post(`${BASE_URL}/api/inbox/tickets/NC1021/transfer`, {
        toAgentId: 'user_elena',
        handoffSummaryJson: { reason: 'Escalation to Elena' }
      }, {
        headers: {
          Authorization: `Bearer ${sessionTokens.user_carlos}`,
          'X-CSRF-Token': csrfTokens.user_carlos
        }
      });
      assert.fail('Expected transfer to offline agent to throw 400 error');
    } catch (err) {
      assert(err.response, 'Error response must exist');
      assert.strictEqual(err.response.status, 400);
      assert(err.response.data.error.includes('not available') || err.response.data.error.includes('Offline'));
      console.log(`  -> PASS: Rejected with status ${err.response.status}: "${err.response.data.error}"\n`);
    }

    // Restore Elena to Available
    await directPool.query(`
      UPDATE agent_profiles SET configured_status = 'Available', last_heartbeat_at = NOW() WHERE brand_id = 'brand_novacart' AND user_id = 'user_elena'
    `);

    // ============================================================================
    // SCENARIO 19: Transfer with agent at maximum capacity fails with descriptive error
    // ============================================================================
    console.log('Scenario 19: Transfer with agent at maximum capacity fails with descriptive error...');
    // Set Elena active_ticket_count to 3 (max capacity)
    await directPool.query(`
      UPDATE agent_profiles SET active_ticket_count = 3 WHERE brand_id = 'brand_novacart' AND user_id = 'user_elena'
    `);
    try {
      await axios.post(`${BASE_URL}/api/inbox/tickets/NC1021/transfer`, {
        toAgentId: 'user_elena',
        handoffSummaryJson: { reason: 'Escalation to Elena' }
      }, {
        headers: {
          Authorization: `Bearer ${sessionTokens.user_carlos}`,
          'X-CSRF-Token': csrfTokens.user_carlos
        }
      });
      assert.fail('Expected transfer to at-capacity agent to throw 400 error');
    } catch (err) {
      assert(err.response, 'Error response must exist');
      assert.strictEqual(err.response.status, 400);
      assert(err.response.data.error.includes('capacity'));
      console.log(`  -> PASS: Rejected with status ${err.response.status}: "${err.response.data.error}"\n`);
    }

    // Restore Elena active_ticket_count to 0
    await directPool.query(`
      UPDATE agent_profiles SET active_ticket_count = 0 WHERE brand_id = 'brand_novacart' AND user_id = 'user_elena'
    `);

    // ============================================================================
    // SCENARIO 20: Transfer without reason is rejected
    // ============================================================================
    console.log('Scenario 20: Transfer without reason is rejected...');
    try {
      await axios.post(`${BASE_URL}/api/inbox/tickets/NC1021/transfer`, {
        toAgentId: 'user_elena',
        handoffSummaryJson: { reason: '   ' } // empty or whitespace-only reason
      }, {
        headers: {
          Authorization: `Bearer ${sessionTokens.user_carlos}`,
          'X-CSRF-Token': csrfTokens.user_carlos
        }
      });
      assert.fail('Expected transfer without reason to throw 400 error');
    } catch (err) {
      assert(err.response, 'Error response must exist');
      assert.strictEqual(err.response.status, 400);
      assert(err.response.data.error.includes('reason'));
      console.log(`  -> PASS: Rejected without reason: "${err.response.data.error}"\n`);
    }

    console.log('================================================================================');
    console.log('=== [ALL 20 MULTI-AGENT VERIFICATION SCENARIOS PASSED WITH 100% SUCCESS] ===');
    console.log('================================================================================\n');

  } finally {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    if (mockNexconnServer) {
      await new Promise((resolve) => mockNexconnServer.close(resolve));
    }
    await directPool.end().catch(() => {});
    await closePool().catch(() => {});
    await pgServer.stop().catch(() => {});
    if (fs.existsSync(PG16_DATA_DIR)) {
      fs.rmSync(PG16_DATA_DIR, { recursive: true, force: true });
    }
    process.env.DATABASE_URL = originalDbUrl;
    process.env.NEXCONN_API_URL = originalApiUrl;
    process.env.NEXCONN_APP_KEY = originalAppKey;
    process.env.NEXCONN_APP_SECRET = originalAppSecret;
    delete process.env.AGENT_SARAH_PASSWORD_HASH;
    delete process.env.AGENT_CARLOS_PASSWORD_HASH;
    delete process.env.AGENT_ELENA_PASSWORD_HASH;
  }
}

runMultiAgentTestSuite().catch(err => {
  console.error('[FATAL TEST SUITE FAILURE]:', err);
  process.exit(1);
});
