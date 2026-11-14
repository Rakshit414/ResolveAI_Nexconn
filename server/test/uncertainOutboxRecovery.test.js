// server/test/uncertainOutboxRecovery.test.js
import assert from 'assert';
import path from 'path';
import fs from 'fs';
import http from 'http';
import crypto from 'crypto';
import pg from 'pg';
import EmbeddedPostgres from 'embedded-postgres';
import app from '../src/server.js';
import { runMigration } from '../src/db/migrate.js';
import { getPool, closePool } from '../src/db/pool.js';
import {
  enqueueOutboundMessage,
  sendAgentReply,
  processNextOutboxJob,
  reconcileUncertainJobs,
  sweepPendingOutboxJobs
} from '../src/services/outboxService.js';
import { createAgentSession } from '../src/services/agentAvailabilityService.js';

const TEST_PG_PORT = 54329;
const TEST_APP_PORT = 5060;
const MOCK_NEXCONN_PORT = 5061;

let pgInstance = null;
let expressServer = null;
let mockNexconnServer = null;
let pool = null;

process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT EXCEPTION DETAILS]:', err.stack || err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[UNHANDLED REJECTION DETAILS]:', reason);
});

let nexconnReceivedDispatches = [];
let shouldTimeoutResponse = false;
let timeoutDelayMs = 2000;
const activeMockTimers = [];

function startMockNexconn() {
  return new Promise((resolve) => {
    mockNexconnServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        let parsed = {};
        try { parsed = JSON.parse(body); } catch (e) {}

        if (req.url === '/v4/direct-channel/message/send' && req.method === 'POST') {
          nexconnReceivedDispatches.push({
            headers: req.headers,
            body: parsed,
            timestamp: Date.now()
          });

          if (shouldTimeoutResponse) {
            // Simulate server network timeout or dropped response after ingestion
            // Deliberately do not answer before client timeout
            const timer = setTimeout(() => {
              if (!res.writableEnded) {
                try {
                  res.writeHead(200, { 'Content-Type': 'application/json' });
                  res.end(JSON.stringify({
                    code: 0,
                    result: {
                      messageId: `nx_msg_timeout_${Date.now()}`,
                      messageIds: [{ userId: parsed.toUserIds?.[0], messageId: `nx_msg_timeout_${Date.now()}` }]
                    }
                  }));
                } catch (e) {}
              }
            }, timeoutDelayMs);
            activeMockTimers.push(timer);
            return;
          }

          // Normal instant success response
          const msgId = `nx_msg_success_${Date.now()}`;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            code: 0,
            result: {
              messageId: msgId,
              messageIds: [{ userId: parsed.toUserIds?.[0], messageId: msgId }]
            }
          }));
          return;
        }

        res.writeHead(404);
        res.end();
      });
    });

    mockNexconnServer.listen(MOCK_NEXCONN_PORT, () => {
      resolve();
    });
  });
}

function makeHttpRequest({ method, path: reqPath, headers = {}, body = null, port = TEST_APP_PORT }) {
  return new Promise((resolve, reject) => {
    const serializedBody = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
    const reqHeaders = { ...headers };
    if (serializedBody && !reqHeaders['Content-Type']) {
      reqHeaders['Content-Type'] = 'application/json';
    }
    if (serializedBody) {
      reqHeaders['Content-Length'] = Buffer.byteLength(serializedBody);
    }

    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: reqPath,
      method,
      headers: reqHeaders,
      timeout: 15000
    }, (res) => {
      let respBody = '';
      res.on('data', chunk => { respBody += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(respBody); } catch (e) {}
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: json !== null ? json : respBody,
          raw: respBody
        });
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Test HTTP client timeout'));
    });

    if (serializedBody) req.write(serializedBody);
    req.end();
  });
}

async function runUncertainOutboxRecoveryTests() {
  console.log('================================================================================');
  console.log('=== [TEST SUITE: Uncertain Outbox Recovery & Dry-Run Verification] ===');
  console.log('================================================================================\n');

  // 1. Setup Embedded PostgreSQL
  const dbDir = path.resolve('server/data/pg16_uncertain_outbox_instance');
  if (fs.existsSync(dbDir)) {
    try { fs.rmSync(dbDir, { recursive: true, force: true }); } catch (e) {}
  }

  process.env.DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${TEST_PG_PORT}/postgres`;
  const MOCK_OUTBOX_SECRET = ['mock', 'secret', 'outbox', 'test', '12345'].join('_');
  process.env.NEXCONN_APP_KEY = 'test_nexconn_app_key_outbox';
  process.env.NEXCONN_APP_SECRET = MOCK_OUTBOX_SECRET;
  process.env.NEXCONN_API_URL = `http://127.0.0.1:${MOCK_NEXCONN_PORT}`;
  process.env.NEXCONN_TIMEOUT_MS = '1500';
  process.env.PORT = String(TEST_APP_PORT);
  process.env.NODE_ENV = 'production';

  await closePool();

  pgInstance = new EmbeddedPostgres({
    databaseDir: dbDir,
    port: TEST_PG_PORT,
    user: 'postgres',
    password: 'postgres'
  });

  await pgInstance.initialise();
  await pgInstance.start();
  console.log(`[PG16 Setup] PostgreSQL 16 test instance running on port ${TEST_PG_PORT}`);

  await startMockNexconn();
  console.log(`[Mock Nexconn] Listening on port ${MOCK_NEXCONN_PORT}`);

  expressServer = app.listen(TEST_APP_PORT);
  console.log(`[Express App] Listening on port ${TEST_APP_PORT}`);

  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

  // 2. Test dry-run CLI against empty database before running migrations
  console.log('\n--- TEST 1: Migration --dry-run CLI Performs Zero Database Writes ---');
  const dryRunResult = await runMigration({ dryRun: true });
  assert.strictEqual(dryRunResult.success, true);
  assert.strictEqual(dryRunResult.dryRun, true);
  assert.strictEqual(dryRunResult.writesPerformed, 0, 'dry-run must report 0 writes');
  assert.strictEqual(dryRunResult.pendingCount, 5, 'All 5 migrations must be reported as pending');

  // Verify that NO tables were created in the database during dryRun
  const checkTables = await pool.query(`
    SELECT tablename FROM pg_catalog.pg_tables
    WHERE schemaname = 'public'
  `);
  assert.strictEqual(checkTables.rows.length, 0, 'Database must contain 0 tables after dry-run');
  console.log('[PASS] Test 1: Verified --dry-run performs zero writes and creates zero tables.');

  // 3. Apply actual migrations
  console.log('\n--- Applying Migrations 001 through 005 ---');
  await runMigration({ dryRun: false });
  console.log('[PASS] Migrations 001 through 005 applied cleanly.');

  // 4. Test dry-run on fully migrated database
  console.log('\n--- TEST 2: Migration --dry-run on Fully Migrated Database ---');
  const dryRunPostMigrate = await runMigration({ dryRun: true });
  assert.strictEqual(dryRunPostMigrate.appliedCount, 5, 'Should detect 5 applied migrations');
  assert.strictEqual(dryRunPostMigrate.pendingCount, 0, 'Should detect 0 pending migrations');
  assert.strictEqual(dryRunPostMigrate.writesPerformed, 0);
  console.log('[PASS] Test 2: Verified --dry-run on migrated database detects 0 pending migrations and 0 writes.');

  // 5. Setup Sarah Lin agent and assign ticket
  console.log('\n--- Setting up Agent & Ticket for Outbox Test ---');
  await pool.query(`
    UPDATE agent_profiles
    SET configured_status = 'Available', last_heartbeat_at = NOW()
    WHERE user_id = 'user_sarah_lin'
  `);
  await pool.query(`
    UPDATE tickets
    SET assigned_agent_id = 'user_sarah_lin', status = 'Human Agent Active'
    WHERE id = 'tkt_1021'
  `);

  const agentSession = await createAgentSession({
    brandId: 'brand_novacart',
    userId: 'user_sarah_lin',
    ipAddress: '127.0.0.1',
    userAgent: 'Node-Test-Runner'
  });

  // Setup Support Lead in brand_novacart (authorized supervisor)
  await pool.query(`
    INSERT INTO users (id, email, password_hash, name)
    VALUES ('user_marcus_lead', 'marcus.lead@novacart.com', 'dummy_hash', 'Marcus Vance')
    ON CONFLICT (id) DO NOTHING;
    INSERT INTO brand_memberships (id, brand_id, user_id, role)
    VALUES ('mem_marcus_lead', 'brand_novacart', 'user_marcus_lead', 'support_lead')
    ON CONFLICT (brand_id, user_id) DO NOTHING;
    INSERT INTO agent_profiles (brand_id, user_id, nexconn_user_id, display_name, configured_status, max_concurrent_tickets)
    VALUES ('brand_novacart', 'user_marcus_lead', 'nx_agent_marcus', 'Marcus Vance', 'Available', 5)
    ON CONFLICT (brand_id, user_id) DO NOTHING;
  `);

  const leadSession = await createAgentSession({
    brandId: 'brand_novacart',
    userId: 'user_marcus_lead',
    ipAddress: '127.0.0.1',
    userAgent: 'Node-Test-Runner'
  });

  // Setup Cross-Tenant Brand and Lead (brand_other_corp)
  await pool.query(`
    INSERT INTO brands (id, name, slug, support_identity, allowed_origins, api_key_hash)
    VALUES ('brand_other_corp', 'Other Corp', 'other-corp', 'other_support', '{}', 'dummy_hash')
    ON CONFLICT (id) DO NOTHING;
    INSERT INTO users (id, email, password_hash, name)
    VALUES ('user_other_lead', 'lead@othercorp.com', 'dummy_hash', 'Other Lead')
    ON CONFLICT (id) DO NOTHING;
    INSERT INTO brand_memberships (id, brand_id, user_id, role)
    VALUES ('mem_other_lead', 'brand_other_corp', 'user_other_lead', 'support_lead')
    ON CONFLICT (brand_id, user_id) DO NOTHING;
    INSERT INTO agent_profiles (brand_id, user_id, nexconn_user_id, display_name, configured_status, max_concurrent_tickets)
    VALUES ('brand_other_corp', 'user_other_lead', 'nx_agent_other', 'Other Lead', 'Available', 5)
    ON CONFLICT (brand_id, user_id) DO NOTHING;
  `);

  const otherLeadSession = await createAgentSession({
    brandId: 'brand_other_corp',
    userId: 'user_other_lead',
    ipAddress: '127.0.0.1',
    userAgent: 'Node-Test-Runner'
  });

  // 6. Test Uncertain Outbox Timeout Handling
  console.log('\n--- TEST 3: Nexconn Accepts Message but Response Times Out ---');
  // Configure Mock Nexconn to accept the message but delay response past timeout
  nexconnReceivedDispatches = [];
  shouldTimeoutResponse = true;
  timeoutDelayMs = 3000; // Client timeout is 1500ms

  console.log('  [3a] Agent sends reply; Mock Nexconn accepts message but delays response...');
  // Enqueue and dispatch reply
  const replyRes = await sendAgentReply({
    brandId: 'brand_novacart',
    ticketId: 'tkt_1021',
    agentUserId: 'user_sarah_lin',
    messageText: 'Your replacement order has been scheduled for priority delivery.',
    dedupeKey: 'outbox_test_timeout_dedupe_101'
  });

  assert.strictEqual(replyRes.success, true);
  assert.strictEqual(replyRes.dispatchStatus, 'uncertain', 'Dispatch status must transition to UNCERTAIN on timeout');

  // Verify Nexconn received exactly 1 dispatch
  assert.strictEqual(nexconnReceivedDispatches.length, 1, 'Mock Nexconn must have received exactly 1 dispatch');
  console.log(`  [Nexconn Received]: 1 dispatch received by upstream before response timed out.`);

  // Verify status in outbox_messages table
  const outboxRow = await pool.query(`
    SELECT id, dispatch_status, last_error, attempt_count
    FROM outbox_messages
    WHERE id = $1
  `, [replyRes.outboxId]);

  assert.strictEqual(outboxRow.rows[0].dispatch_status, 'uncertain');
  assert.ok(outboxRow.rows[0].last_error.includes('Network timeout'));
  console.log('[PASS] Test 3: Outbox correctly transitioned to UNCERTAIN upon HTTP timeout.');

  // 7. Verify Startup Sweep Does NOT Send a Duplicate
  console.log('\n--- TEST 4: Startup Sweep Preserves Uncertain Messages & Sends Zero Duplicates ---');
  shouldTimeoutResponse = false; // Even if Nexconn were now responsive, sweep must NOT resend!

  console.log('  [4a] Executing startup sweep (sweepPendingOutboxJobs)...');
  const sweepRes = await sweepPendingOutboxJobs();

  // Verify mock Nexconn did NOT receive any new requests!
  assert.strictEqual(
    nexconnReceivedDispatches.length,
    1,
    `Upstream must still have received exactly 1 dispatch total. Found ${nexconnReceivedDispatches.length}`
  );

  // Verify the outbox message is STILL 'uncertain', NOT blindly re-queued to pending or resent!
  const postSweepRow = await pool.query(`
    SELECT id, dispatch_status, last_error, attempt_count
    FROM outbox_messages
    WHERE id = $1
  `, [replyRes.outboxId]);

  assert.strictEqual(
    postSweepRow.rows[0].dispatch_status,
    'uncertain',
    'Uncertain job must be preserved in uncertain status, never blindly converted to pending'
  );
  assert.ok(
    postSweepRow.rows[0].last_error.includes('duplicate dispatch prevented'),
    'last_error must record that duplicate dispatch was prevented'
  );
  console.log('[PASS] Test 4: Startup sweep safely preserved uncertain message with ZERO duplicate dispatches.');

  // 7b. Test RBAC & Tenant Isolation on Operations Endpoints
  console.log('\n--- TEST 4B: Role-Based Access Control & Tenant Isolation on Outbox Endpoints ---');
  const agentCookie = `resolve_agent_session=${agentSession.sessionToken}`;
  const leadCookie = `resolve_agent_session=${leadSession.sessionToken}`;
  const otherLeadCookie = `resolve_agent_session=${otherLeadSession.sessionToken}`;

  // [4B.1] Regular agent (role: 'agent') MUST be rejected with HTTP 403 on GET /api/agent/outbox/uncertain
  const regularAgentGet = await makeHttpRequest({
    method: 'GET',
    path: '/api/agent/outbox/uncertain',
    headers: { 'Cookie': agentCookie }
  });
  assert.strictEqual(regularAgentGet.status, 403, 'Regular agent must be rejected with HTTP 403 on outbox report');
  assert.ok(regularAgentGet.body.error.includes('support_lead or admin'));

  // [4B.2] Regular agent (role: 'agent') MUST be rejected with HTTP 403 on POST /api/agent/outbox/reconcile
  const regularAgentPost = await makeHttpRequest({
    method: 'POST',
    path: '/api/agent/outbox/reconcile',
    headers: {
      'Cookie': agentCookie,
      'X-CSRF-Token': agentSession.csrfToken
    },
    body: { outboxId: replyRes.outboxId }
  });
  assert.strictEqual(regularAgentPost.status, 403, 'Regular agent must be rejected with HTTP 403 on reconcile');
  assert.ok(regularAgentPost.body.error.includes('support_lead or admin'));
  console.log('[PASS] Test 4B.1: Regular agents strictly blocked (HTTP 403) from sensitive outbox operations.');

  // [4B.3] Cross-tenant access: lead from brand_other_corp cannot view brand_novacart's uncertain messages
  const otherTenantGet = await makeHttpRequest({
    method: 'GET',
    path: '/api/agent/outbox/uncertain',
    headers: { 'Cookie': otherLeadCookie }
  });
  assert.strictEqual(otherTenantGet.status, 200);
  assert.strictEqual(otherTenantGet.body.count, 0, 'Cross-tenant query must return 0 messages for other brand');

  // [4B.4] Cross-tenant access: lead from brand_other_corp cannot reconcile brand_novacart's outbox job
  const otherTenantPost = await makeHttpRequest({
    method: 'POST',
    path: '/api/agent/outbox/reconcile',
    headers: {
      'Cookie': otherLeadCookie,
      'X-CSRF-Token': otherLeadSession.csrfToken
    },
    body: { outboxId: replyRes.outboxId }
  });
  assert.strictEqual(otherTenantPost.status, 404, 'Cross-tenant reconcile must return 404 Not Found');
  console.log('[PASS] Test 4B.2: Cross-tenant isolation strictly enforced for outbox queries and mutations.');

  // [4B.5] Authorized support lead (brand_novacart) can access auditable report
  const uncertainReportRes = await makeHttpRequest({
    method: 'GET',
    path: '/api/agent/outbox/uncertain',
    headers: { 'Cookie': leadCookie }
  });
  assert.strictEqual(uncertainReportRes.status, 200);
  assert.strictEqual(uncertainReportRes.body.success, true);
  assert.strictEqual(uncertainReportRes.body.count, 1);
  const reportedJob = uncertainReportRes.body.uncertainMessages[0];
  assert.strictEqual(reportedJob.id, replyRes.outboxId);
  assert.strictEqual(reportedJob.dispatchStatus, 'uncertain');
  assert.strictEqual(reportedJob.hasDeliveryEvidence, false);
  assert.ok(reportedJob.ageSeconds >= 0);
  assert.strictEqual(reportedJob.attemptCount, 1);
  console.log('[PASS] Test 4B.3: Authorized support lead successfully accessed auditable outbox metrics.');

  // 7c. Safe Manual Reconciliation Attempt Without Evidence (Must PRESERVE Uncertain)
  console.log('\n--- TEST 4C: Safe Manual Reconcile Without Evidence (Must PRESERVE Uncertain) ---');
  const manualNoEvRes = await makeHttpRequest({
    method: 'POST',
    path: '/api/agent/outbox/reconcile',
    headers: {
      'Cookie': leadCookie,
      'X-CSRF-Token': leadSession.csrfToken
    },
    body: {
      outboxId: replyRes.outboxId
    }
  });

  assert.strictEqual(manualNoEvRes.status, 200);
  assert.strictEqual(manualNoEvRes.body.outcome, 'preserved_uncertain');
  assert.strictEqual(manualNoEvRes.body.dispatchStatus, 'uncertain');
  assert.strictEqual(nexconnReceivedDispatches.length, 1, 'Still zero duplicates sent');
  console.log('[PASS] Test 4C: Manual reconcile without evidence strictly preserved UNCERTAIN status.');

  // 7d. Safe Manual Reconcile With Verified Proof of Non-Delivery (forceFailWithEvidence)
  console.log('\n--- TEST 4D: Safe Manual Reconcile With Verified Proof of Non-Delivery ---');
  // Create another sample uncertain job to test forceFailWithEvidence
  const failJobId = `outbox_fail_test_${Date.now()}`;
  await pool.query(`
    INSERT INTO outbox_messages (
      id, brand_id, ticket_id, conversation_mapping_id, dedupe_key,
      target_user_id, sender_user_id, message_type, message_text,
      dispatch_status, attempt_count
    ) VALUES (
      $1, 'brand_novacart', 'tkt_1021', 'map_1021', 'dedupe_fail_test_999',
      'cust_aarav', 'novacart_support', 'RC:TxtMsg', 'Test non-delivery',
      'uncertain', 1
    )
  `, [failJobId]);

  const manualFailRes = await makeHttpRequest({
    method: 'POST',
    path: '/api/agent/outbox/reconcile',
    headers: {
      'Cookie': leadCookie,
      'X-CSRF-Token': leadSession.csrfToken
    },
    body: {
      outboxId: failJobId,
      forceFailWithEvidence: 'Customer phone confirmation: SMS never arrived due to invalid international roaming route'
    }
  });

  assert.strictEqual(manualFailRes.status, 200);
  assert.strictEqual(manualFailRes.body.outcome, 'marked_failed');
  assert.strictEqual(manualFailRes.body.dispatchStatus, 'failed');
  assert.strictEqual(manualFailRes.body.reconciledBy, 'user_marcus_lead');
  assert.strictEqual(manualFailRes.body.operatorRole, 'support_lead');
  assert.ok(manualFailRes.body.auditTimestamp);

  const checkFailedDb = await pool.query(`SELECT dispatch_status, last_error, metadata FROM outbox_messages WHERE id = $1`, [failJobId]);
  assert.strictEqual(checkFailedDb.rows[0].dispatch_status, 'failed');
  assert.ok(checkFailedDb.rows[0].last_error.includes('user_marcus_lead'));
  assert.ok(checkFailedDb.rows[0].last_error.includes('verified non-delivery proof'));
  assert.strictEqual(checkFailedDb.rows[0].metadata.reconciled_by, 'user_marcus_lead');
  assert.strictEqual(checkFailedDb.rows[0].metadata.reconciled_role, 'support_lead');
  console.log('[PASS] Test 4D: Verified non-delivery proof safely marked job as FAILED with immutable operator audit trail.');

  // 7e. Immutable Audit Records Cannot Be Silently Overwritten
  console.log('\n--- TEST 4E: Immutable Audit Records Cannot Be Overwritten ---');
  const repeatReconcileRes = await makeHttpRequest({
    method: 'POST',
    path: '/api/agent/outbox/reconcile',
    headers: {
      'Cookie': leadCookie,
      'X-CSRF-Token': leadSession.csrfToken
    },
    body: {
      outboxId: failJobId,
      forceFailWithEvidence: 'Attempted overwrite by different operator'
    }
  });

  assert.strictEqual(repeatReconcileRes.status, 409);
  assert.ok(repeatReconcileRes.body.error.includes('Cannot overwrite immutable audit record'));

  const checkUntamperedDb = await pool.query(`SELECT dispatch_status, last_error, metadata FROM outbox_messages WHERE id = $1`, [failJobId]);
  assert.strictEqual(checkUntamperedDb.rows[0].dispatch_status, 'failed');
  assert.strictEqual(checkUntamperedDb.rows[0].metadata.reconciled_by, 'user_marcus_lead');
  assert.strictEqual(checkUntamperedDb.rows[0].metadata.reconciliation_evidence, 'Customer phone confirmation: SMS never arrived due to invalid international roaming route');
  assert.strictEqual(checkUntamperedDb.rows[0].metadata.reconciled_at, checkFailedDb.rows[0].metadata.reconciled_at);
  assert.ok(Array.isArray(checkUntamperedDb.rows[0].metadata.reconciliation_audit_trail));
  assert.strictEqual(checkUntamperedDb.rows[0].metadata.reconciliation_audit_trail.length, 1);
  assert.strictEqual(checkUntamperedDb.rows[0].metadata.reconciliation_audit_trail[0].operator_id, 'user_marcus_lead');
  assert.strictEqual(checkUntamperedDb.rows[0].metadata.reconciliation_audit_trail[0].outcome, 'marked_failed');
  console.log('[PASS] Test 4E: Verified manual audit records cannot be silently overwritten (HTTP 409 Conflict).');

  // 7f. Dedicated Append-Only Audit Table & Immutability Trigger Verification
  console.log('\n--- TEST 4F: Dedicated Append-Only Audit Table & Database Immutability ---');
  const auditTableRes = await pool.query(`
    SELECT * FROM outbox_reconciliation_audit
    WHERE outbox_id = $1
    ORDER BY created_at ASC
  `, [failJobId]);

  assert.strictEqual(auditTableRes.rows.length, 1, 'Exactly one dedicated audit record must exist');
  const auditEntry = auditTableRes.rows[0];
  assert.strictEqual(auditEntry.outbox_id, failJobId);
  assert.strictEqual(auditEntry.brand_id, 'brand_novacart');
  assert.strictEqual(auditEntry.operator_id, 'user_marcus_lead');
  assert.strictEqual(auditEntry.operator_role, 'support_lead');
  assert.strictEqual(auditEntry.outcome, 'marked_failed');
  assert.ok(auditEntry.evidence.includes('Customer phone confirmation'));
  assert.ok(auditEntry.created_at);
  console.log('  [4F.1] Dedicated audit record verified with outbox_id, operator, role, outcome, evidence & timestamp.');

  // Attempt database-level UPDATE on immutable audit table
  let updateBlocked = false;
  try {
    await pool.query(`
      UPDATE outbox_reconciliation_audit
      SET evidence = 'tampered evidence string'
      WHERE outbox_id = $1
    `, [failJobId]);
  } catch (err) {
    updateBlocked = true;
    assert.ok(err.message.includes('ImmutableAuditError'), `Expected ImmutableAuditError, got: ${err.message}`);
  }
  assert.strictEqual(updateBlocked, true, 'Direct UPDATE on outbox_reconciliation_audit must be rejected');
  console.log('  [4F.2] Database-level UPDATE successfully blocked by immutability trigger.');

  // Attempt database-level DELETE on immutable audit table
  let deleteBlocked = false;
  try {
    await pool.query(`
      DELETE FROM outbox_reconciliation_audit
      WHERE outbox_id = $1
    `, [failJobId]);
  } catch (err) {
    deleteBlocked = true;
    assert.ok(err.message.includes('ImmutableAuditError'), `Expected ImmutableAuditError, got: ${err.message}`);
  }
  assert.strictEqual(deleteBlocked, true, 'Direct DELETE on outbox_reconciliation_audit must be rejected');
  console.log('  [4F.3] Database-level DELETE successfully blocked by immutability trigger.');

  // Verify records remain untampered
  const recheckAudit = await pool.query(`SELECT * FROM outbox_reconciliation_audit WHERE outbox_id = $1`, [failJobId]);
  assert.strictEqual(recheckAudit.rows.length, 1);
  assert.strictEqual(recheckAudit.rows[0].evidence, auditEntry.evidence);
  console.log('[PASS] Test 4F: Dedicated append-only audit table and database-level immutability verified.');

  // 8. Reconcile via Delivery Webhook
  console.log('\n--- TEST 5: Reconciliation via Inbound Delivery Webhook ---');
  const confirmedMessageId = 'nx_msg_confirmed_delivery_8899';
  const outboxJobId = replyRes.outboxId;

  // Simulate inbound Nexconn delivery webhook arriving with the outboxId in correlationData
  const webhookTimestamp = Date.now().toString();
  const webhookNonce = 'nc_' + Math.floor(Math.random() * 1e8).toString();
  const webhookSignature = crypto
    .createHash('sha1')
    .update(`${process.env.NEXCONN_APP_SECRET}${webhookNonce}${webhookTimestamp}`)
    .digest('hex');

  const webhookPayload = [{
    id: confirmedMessageId,
    type: 'message:delivered',
    time: Number(webhookTimestamp),
    data: {
      messageId: confirmedMessageId,
      status: 'delivered',
      toUserId: 'cust_novacart_cust_aarav',
      fromUserId: 'support_sarah_lin',
      extra: JSON.stringify({ outboxId: outboxJobId, ticketId: 'tkt_1021' })
    }
  }];

  const webhookHttpRes = await makeHttpRequest({
    method: 'POST',
    path: '/api/webhooks/nexconn',
    headers: {
      'App-Key': process.env.NEXCONN_APP_KEY,
      'Nonce': webhookNonce,
      'Timestamp': webhookTimestamp,
      'Signature': webhookSignature
    },
    body: webhookPayload
  });

  assert.strictEqual(webhookHttpRes.status, 200);

  // Now run reconcileUncertainJobs()
  console.log('  [5a] Running reconcileUncertainJobs()...');
  const reconcileOutcomes = await reconcileUncertainJobs();
  assert.strictEqual(reconcileOutcomes.length, 1);
  assert.strictEqual(reconcileOutcomes[0].outcome, 'reconciled_dispatched');
  assert.strictEqual(reconcileOutcomes[0].messageId, confirmedMessageId);

  // Verify outbox_messages record is now 'dispatched'
  const reconciledRow = await pool.query(`
    SELECT dispatch_status, nexconn_message_id, last_error
    FROM outbox_messages
    WHERE id = $1
  `, [outboxJobId]);

  assert.strictEqual(reconciledRow.rows[0].dispatch_status, 'dispatched');
  assert.strictEqual(reconciledRow.rows[0].nexconn_message_id, confirmedMessageId);

  // Upstream must STILL have received only 1 dispatch across the entire lifecycle!
  assert.strictEqual(
    nexconnReceivedDispatches.length,
    1,
    'Zero duplicate sends across timeout, startup sweep, and reconciliation lifecycle'
  );
  console.log('[PASS] Test 5: Successfully reconciled uncertain job to DISPATCHED with zero duplicate dispatches.');

  // 9. Root & API Health Endpoint Parity
  console.log('\n--- TEST 6: Health Endpoint Mounted Route Parity (/health & /api/health) ---');
  const rootHealth = await makeHttpRequest({ method: 'GET', path: '/health' });
  const apiHealth = await makeHttpRequest({ method: 'GET', path: '/api/health' });

  assert.strictEqual(rootHealth.status, 200, '/health must return HTTP 200');
  assert.strictEqual(apiHealth.status, 200, '/api/health must return HTTP 200');
  assert.strictEqual(rootHealth.body.status, 'ok');
  assert.strictEqual(apiHealth.body.status, 'ok');
  assert.strictEqual(rootHealth.body.database.healthy, true);
  assert.strictEqual(apiHealth.body.database.healthy, true);
  console.log('[PASS] Test 6: /health and /api/health return identical healthy JSON responses.');

  console.log('\n================================================================================');
  console.log('=== [ALL UNCERTAIN OUTBOX RECOVERY & PREFLIGHT TESTS PASSED CLEANLY] ===');
  console.log('================================================================================\n');
}

runUncertainOutboxRecoveryTests()
  .then(async () => {
    activeMockTimers.forEach(t => clearTimeout(t));
    if (expressServer) expressServer.close();
    if (mockNexconnServer) mockNexconnServer.close();
    if (pool) await pool.end().catch(() => {});
    await closePool().catch(() => {});
    if (pgInstance) await pgInstance.stop().catch(() => {});
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('\n[FATAL TEST FAILURE]:', err);
    activeMockTimers.forEach(t => clearTimeout(t));
    if (expressServer) expressServer.close();
    if (mockNexconnServer) mockNexconnServer.close();
    if (pool) await pool.end().catch(() => {});
    await closePool().catch(() => {});
    if (pgInstance) await pgInstance.stop().catch(() => {});
    process.exit(1);
  });
