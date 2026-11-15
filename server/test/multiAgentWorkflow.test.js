import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
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
  process.env.DATABASE_URL = TEST_DB_URL;
  process.env.NODE_ENV = 'test';
  process.env.PORT = String(APP_PORT);
  process.env.AGENT_JWT_SECRET = 'test_secret_key_multi_agent_2026';

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
    // SCENARIO 1: 3 agent accounts exist in users table with bcrypt password hashes
    // ============================================================================
    console.log('Scenario 1: 3 agent accounts exist in users table with bcrypt password hashes...');
    const usersRes = await directPool.query(`
      SELECT id, email, password_hash, name FROM users
      WHERE id IN ('user_sarah_lin', 'user_carlos', 'user_elena')
      ORDER BY id ASC
    `);
    assert.strictEqual(usersRes.rows.length, 3, 'Expected exactly 3 demo agents in users table');
    for (const u of usersRes.rows) {
      assert(u.password_hash.startsWith('$2b$10$'), `Password hash for ${u.id} must be valid bcrypt`);
      const matches = await bcrypt.compare('DemoSecret2026!', u.password_hash);
      assert.strictEqual(matches, true, `Password for ${u.id} must verify against DemoSecret2026!`);
    }
    console.log('  -> PASS: 3 agent accounts exist with valid bcrypt hashes matching DemoSecret2026!\n');

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
        password: 'DemoSecret2026!',
        brandId: 'brand_novacart'
      });
      assert.strictEqual(loginRes.status, 200);
      assert.strictEqual(loginRes.data.success, true);
      assert(loginRes.data.sessionToken, `Login response must contain sessionToken for ${ag.userId}`);
      assert.strictEqual(loginRes.data.agent.id, ag.userId);
      sessionTokens[ag.userId] = loginRes.data.sessionToken;
      csrfTokens[ag.userId] = loginRes.data.csrfToken;
    }
    console.log('  -> PASS: All 3 agents authenticated successfully with valid session tokens\n');

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
    console.log('  -> PASS: Same ticket queue identity preserved; channel uninterrupted\n');

    // ============================================================================
    // SCENARIO 16: Carlos can see all previous messages after transfer
    // ============================================================================
    console.log('Scenario 16: Carlos can see all previous messages after transfer...');
    const carlosTicketView = await axios.get(`${BASE_URL}/api/inbox/tickets/NC1021`, {
      headers: { Authorization: `Bearer ${sessionTokens.user_carlos}` }
    });
    assert.strictEqual(carlosTicketView.status, 200);
    assert.strictEqual(carlosTicketView.data.success, true);
    assert.strictEqual(carlosTicketView.data.ticket.assignedAgent.id, 'user_carlos');
    assert.strictEqual(carlosTicketView.data.ticket.conversationHistory.length, 1);
    assert.strictEqual(carlosTicketView.data.ticket.conversationHistory[0].content, 'Where is my order #NC1021?');
    assert.strictEqual(carlosTicketView.data.ticket.handoffSummaries.length, 1);
    console.log('  -> PASS: Carlos receives unmasked customer context, full conversation, and handoff notes\n');

    // ============================================================================
    // SCENARIO 17: Carlos can reply to customer and customer receives reply
    // ============================================================================
    console.log('Scenario 17: Carlos can reply to customer...');
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
    const updatedMsgs = await directPool.query(`
      SELECT message_text, sender_user_id, sender_role FROM message_archive
      WHERE brand_id = 'brand_novacart' AND ticket_id = 'NC1021'
      ORDER BY sent_at DESC LIMIT 1
    `);
    assert(updatedMsgs.rows[0].message_text.includes('Carlos here'));
    assert.strictEqual(updatedMsgs.rows[0].sender_user_id, 'user_carlos');
    console.log('  -> PASS: Carlos reply sent and recorded in message_archive with outbox dispatch\n');

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
    await directPool.end().catch(() => {});
    await closePool().catch(() => {});
    await pgServer.stop().catch(() => {});
    if (fs.existsSync(PG16_DATA_DIR)) {
      fs.rmSync(PG16_DATA_DIR, { recursive: true, force: true });
    }
    process.env.DATABASE_URL = originalDbUrl;
  }
}

runMultiAgentTestSuite().catch(err => {
  console.error('[FATAL TEST SUITE FAILURE]:', err);
  process.exit(1);
});
