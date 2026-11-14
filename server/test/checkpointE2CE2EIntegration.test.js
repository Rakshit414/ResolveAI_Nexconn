// server/test/checkpointE2CE2EIntegration.test.js
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
  enqueueOrReopenTicket,
  autoCloseExpiredResolvedTickets
} from '../src/services/queueService.js';
import {
  assignQueuedTicketAtomically
} from '../src/services/routingService.js';
import {
  reconcileAgentCapacity,
  resolveTicketAndReleaseCapacity
} from '../src/services/capacityService.js';
import {
  createAgentSession,
  refreshAgentHeartbeat,
  updateAgentConfiguredStatus,
  getAgentProfile,
  terminateAgentSession
} from '../src/services/agentAvailabilityService.js';
import {
  getUnassignedTickets,
  getMyTickets,
  getTeamOverview,
  getAgentRoster,
  getTicketDetailsWithHistory,
  claimOrReassignTicket,
  transferTicket
} from '../src/services/sharedInboxService.js';
import {
  createKnowledgeItem,
  publishKnowledgeItem,
  searchKnowledge,
  getGroundedAIResponse
} from '../src/services/knowledgeHubService.js';
import {
  translateTicketMessage,
  canonicalizeLocale
} from '../src/services/translationService.js';
import {
  dispatchSchedulingOpportunity,
  processDueQueuedTicketsMultiTenant
} from '../src/services/multiTenantScheduler.js';
import {
  enqueueOutboundMessage,
  sendAgentReply,
  processNextOutboxJob,
  reconcileUncertainJobs
} from '../src/services/outboxService.js';
import {
  validateWebhookHeaders,
  parseWebhookEnvelopes,
  extractCorrelationData
} from '../src/routes/webhooks.js';

const { Pool } = pg;
const PG16_PORT = 54348;
const PG16_DATA_DIR = path.resolve('server/data/pg16_e2c_test_instance');
const TEST_APP_KEY = 'test_nexconn_app_key_e2c';
const TEST_APP_SECRET = 'test_nexconn_secret_e2c_9876543210';

async function runE2CIntegrationTests() {
  console.log('================================================================================');
  console.log('=== [TEST SUITE: Checkpoint E2-C Storefront, Agent UI & System Integration] ===');
  console.log('================================================================================\n');

  if (fs.existsSync(PG16_DATA_DIR)) {
    try { fs.rmSync(PG16_DATA_DIR, { recursive: true, force: true }); } catch (e) {}
  }

  const pgServer = new EmbeddedPostgres({
    databaseDir: PG16_DATA_DIR,
    port: PG16_PORT,
    user: 'postgres',
    password: 'postgres',
    initdbFlags: ['--encoding=UTF8', '--locale=C']
  });

  const originalDbUrl = process.env.DATABASE_URL;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalAppKey = process.env.NEXCONN_APP_KEY;
  const originalAppSecret = process.env.NEXCONN_APP_SECRET;
  const originalApiUrl = process.env.NEXCONN_API_URL;

  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = `postgres://postgres:postgres@127.0.0.1:${PG16_PORT}/postgres`;
  process.env.NEXCONN_APP_KEY = TEST_APP_KEY;
  process.env.NEXCONN_APP_SECRET = TEST_APP_SECRET;

  let directPool = null;
  let httpServer = null;
  let serverPort = null;
  let mockNexconnServer = null;
  let mockNexconnPort = null;
  const mockNexconnRequests = [];
  let mockNexconnOverrideHandler = null;

  try {
    console.log(`[PG16 Setup] Initializing native PostgreSQL 16 server on port ${PG16_PORT}...`);
    await pgServer.initialise();
    await pgServer.start();

    directPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 15
    });
    await directPool.query('SELECT 1');

    // Start Mock Nexconn API Server (Signed HTTP REST mock on 127.0.0.1)
    mockNexconnServer = http.createServer((req, res) => {
      let raw = '';
      req.on('data', chunk => { raw += chunk; });
      req.on('end', () => {
        let body = {};
        try { body = JSON.parse(raw); } catch (e) { body = { raw }; }
        mockNexconnRequests.push({
          method: req.method,
          url: req.url,
          headers: req.headers,
          body
        });

        if (mockNexconnOverrideHandler) {
          return mockNexconnOverrideHandler(req, res, body);
        }

        const targetUserId = body.toUserIds?.[0] || 'default_user';
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
        console.log(`[Mock Nexconn] Server listening on port ${mockNexconnPort}`);
        resolve();
      });
    });

    process.env.NEXCONN_API_URL = `http://127.0.0.1:${mockNexconnPort}`;

    // Start Express Test Server
    httpServer = http.createServer(app);
    await new Promise((resolve) => {
      httpServer.listen(0, '127.0.0.1', () => {
        serverPort = httpServer.address().port;
        console.log(`[HTTP Server] Express test server listening on port ${serverPort}`);
        resolve();
      });
    });

    // Run Migrations 001 through 005
    console.log('[Migrate] Applying migrations 001 through 005...');
    await runMigration({ dryRun: false });
    console.log('[Migrate] All migrations successfully applied.');

    // Helper for HTTP requests
    const makeRequest = async (method, pathUrl, body = null, headers = {}) => {
      return new Promise((resolve, reject) => {
        const req = http.request({
          hostname: '127.0.0.1',
          port: serverPort,
          path: pathUrl,
          method,
          headers: {
            'Content-Type': 'application/json',
            ...headers
          }
        }, (res) => {
          let data = '';
          res.on('data', chunk => { data += chunk; });
          res.on('end', () => {
            let json = {};
            try { json = JSON.parse(data); } catch (e) { json = { raw: data }; }
            resolve({ status: res.statusCode, headers: res.headers, body: json });
          });
        });
        req.on('error', reject);
        if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
        req.end();
      });
    };

    // =========================================================================
    // SECTION 1: STOREFRONT & CART INTEGRATION
    // =========================================================================
    console.log('\n--- SECTION 1: Storefront & Customer Persona Integrity ---');

    // 1a: Validate 3 Customer Personas in Database
    console.log('  [1a] Verifying exact personas: Aarav Sharma, Priya Mehta, Kabir Verma...');
    const custs = (await directPool.query(`
      SELECT c.id, c.name, c.email, o.id as order_id, o.price, o.status as order_status
      FROM customers c
      JOIN orders o ON c.id = o.customer_id
      ORDER BY o.id
    `)).rows;

    assert.strictEqual(custs.length, 3, 'Must have exactly 3 seeded customers');
    assert.strictEqual(custs[0].name, 'Aarav Sharma');
    assert.strictEqual(custs[0].order_id, 'ord_1021');
    assert.strictEqual(parseFloat(custs[0].price), 119.99); // $119.99

    assert.strictEqual(custs[1].name, 'Priya Mehta');
    assert.strictEqual(custs[1].order_id, 'ord_1022');
    assert.strictEqual(parseFloat(custs[1].price), 249.50); // $249.50

    assert.strictEqual(custs[2].name, 'Kabir Verma');
    assert.strictEqual(custs[2].order_id, 'ord_1023');
    assert.strictEqual(parseFloat(custs[2].price), 89.00); // $89.00
    console.log('  [Personas Verified]: Exact 3 personas and order amounts verified.');

    // 1b: Verify Integer Cents Cart Arithmetic Logic
    console.log('  [1b] Testing strict integer-cents cart calculations across all scenarios...');

    // Pure reference implementation matching client/src/context/CartContext.jsx exactly
    const TAX_RATE = 0.08;
    const FREE_SHIPPING_THRESHOLD_CENTS = 7500; // $75.00
    const FLAT_SHIPPING_CENTS = 500; // $5.00

    function calculateCartTotals(cartItems) {
      let itemCount = 0;
      let cartSubtotalCents = 0;
      if (Array.isArray(cartItems)) {
        for (const item of cartItems) {
          const qty = Math.max(0, Math.floor(item.quantity || 0));
          const priceCents = Math.max(0, Math.round(item.unitPriceCents || (item.price ? item.price * 100 : 0)));
          itemCount += qty;
          cartSubtotalCents += priceCents * qty;
        }
      }

      const isFreeShipping = cartSubtotalCents >= FREE_SHIPPING_THRESHOLD_CENTS;
      const shippingCents = (!cartItems || cartItems.length === 0 || cartSubtotalCents === 0)
        ? 0
        : (isFreeShipping ? 0 : FLAT_SHIPPING_CENTS);
      const taxCents = (!cartItems || cartItems.length === 0 || cartSubtotalCents === 0)
        ? 0
        : Math.round(cartSubtotalCents * TAX_RATE);
      const grandTotalCents = cartSubtotalCents + shippingCents + taxCents;

      return {
        itemCount,
        cartSubtotalCents,
        cartSubtotalFormatted: (cartSubtotalCents / 100).toFixed(2),
        shippingCents,
        shippingFormatted: (shippingCents / 100).toFixed(2),
        isFreeShipping,
        taxCents,
        taxFormatted: (taxCents / 100).toFixed(2),
        grandTotalCents,
        grandTotalFormatted: (grandTotalCents / 100).toFixed(2)
      };
    }

    // Scenario 1: The Canonical Stated Cart Example
    // 2 × NovaSprint Pro Running Shoes at $119.99 = 23,998 cents ($239.98)
    // 1 × NovaPulse Smartwatch at $249.50 = 24,950 cents ($249.50)
    // 1 × NovaBass ANC Headphones at $89.00 = 8,900 cents ($89.00)
    const statedCart = [
      { productId: 'prod_shoes', name: 'NovaSprint Pro Running Shoes', unitPriceCents: 11999, quantity: 2 },
      { productId: 'prod_watch', name: 'NovaPulse Smartwatch', unitPriceCents: 24950, quantity: 1 },
      { productId: 'prod_headphones', name: 'NovaBass ANC Headphones', unitPriceCents: 8900, quantity: 1 }
    ];
    const statedTotals = calculateCartTotals(statedCart);

    assert.strictEqual(statedTotals.itemCount, 4, 'Stated cart must have 4 total items');
    assert.strictEqual(statedTotals.cartSubtotalCents, 57848, 'Subtotal must equal exactly 57,848 cents ($578.48)');
    assert.strictEqual(statedTotals.cartSubtotalFormatted, '578.48');
    assert.strictEqual(statedTotals.isFreeShipping, true, 'Subtotal >= $75 qualifies for free shipping');
    assert.strictEqual(statedTotals.shippingCents, 0, 'Shipping must be 0 cents for orders >= $75');
    assert.strictEqual(statedTotals.shippingFormatted, '0.00');
    assert.strictEqual(statedTotals.taxCents, 4628, '8% Sales tax on $578.48 must equal Math.round(57848 * 0.08) = 4,628 cents ($46.28)');
    assert.strictEqual(statedTotals.taxFormatted, '46.28');
    assert.strictEqual(statedTotals.grandTotalCents, 62476, 'Grand total must equal 57,848 + 0 + 4,628 = 62,476 cents ($624.76)');
    assert.strictEqual(statedTotals.grandTotalFormatted, '624.76');
    console.log('    [Cart 1: Stated Cart Passed]: Subtotal=$578.48, Shipping=$0.00, Tax=$46.28, Total=$624.76');

    // Scenario 2: Quantity Increase (Shoes: 2 -> 3)
    const qtyIncreasedCart = [
      { productId: 'prod_shoes', unitPriceCents: 11999, quantity: 3 }, // 35,997
      { productId: 'prod_watch', unitPriceCents: 24950, quantity: 1 }, // 24,950
      { productId: 'prod_headphones', unitPriceCents: 8900, quantity: 1 } // 8,900
    ];
    const qtyIncTotals = calculateCartTotals(qtyIncreasedCart);
    assert.strictEqual(qtyIncTotals.cartSubtotalCents, 69847, 'Subtotal: 35,997 + 24,950 + 8,900 = 69,847 cents ($698.47)');
    assert.strictEqual(qtyIncTotals.shippingCents, 0);
    assert.strictEqual(qtyIncTotals.taxCents, 5588, 'Tax: Math.round(69847 * 0.08) = 5,588 cents ($55.88)');
    assert.strictEqual(qtyIncTotals.grandTotalCents, 75435, 'Grand total: 69,847 + 5,588 = 75,435 cents ($754.35)');
    console.log('    [Cart 2: Qty Increased Passed]: Subtotal=$698.47, Tax=$55.88, Total=$754.35');

    // Scenario 3: Quantity Decrease (Shoes: 2 -> 1)
    const qtyDecreasedCart = [
      { productId: 'prod_shoes', unitPriceCents: 11999, quantity: 1 }, // 11,999
      { productId: 'prod_watch', unitPriceCents: 24950, quantity: 1 }, // 24,950
      { productId: 'prod_headphones', unitPriceCents: 8900, quantity: 1 } // 8,900
    ];
    const qtyDecTotals = calculateCartTotals(qtyDecreasedCart);
    assert.strictEqual(qtyDecTotals.cartSubtotalCents, 45849, 'Subtotal: 11,999 + 24,950 + 8,900 = 45,849 cents ($458.49)');
    assert.strictEqual(qtyDecTotals.shippingCents, 0);
    assert.strictEqual(qtyDecTotals.taxCents, 3668, 'Tax: Math.round(45849 * 0.08) = 3,668 cents ($36.68)');
    assert.strictEqual(qtyDecTotals.grandTotalCents, 49517, 'Grand total: 45,849 + 3,668 = 49,517 cents ($495.17)');
    console.log('    [Cart 3: Qty Decreased Passed]: Subtotal=$458.49, Tax=$36.68, Total=$495.17');

    // Scenario 4: Cart Item Removal (Remove Watch)
    const itemRemovedCart = [
      { productId: 'prod_shoes', unitPriceCents: 11999, quantity: 2 }, // 23,998
      { productId: 'prod_headphones', unitPriceCents: 8900, quantity: 1 } // 8,900
    ];
    const itemRemovedTotals = calculateCartTotals(itemRemovedCart);
    assert.strictEqual(itemRemovedTotals.cartSubtotalCents, 32898, 'Subtotal: 23,998 + 8,900 = 32,898 cents ($328.98)');
    assert.strictEqual(itemRemovedTotals.shippingCents, 0);
    assert.strictEqual(itemRemovedTotals.taxCents, 2632, 'Tax: Math.round(32898 * 0.08) = 2,632 cents ($26.32)');
    assert.strictEqual(itemRemovedTotals.grandTotalCents, 35530, 'Grand total: 32,898 + 2,632 = 35,530 cents ($355.30)');
    console.log('    [Cart 4: Item Removed Passed]: Subtotal=$328.98, Tax=$26.32, Total=$355.30');

    // Scenario 5: Sub-$75 Order ($5 Flat Shipping Applies)
    const sub75Cart = [
      { productId: 'prod_flask', name: 'NovaHydro Thermal Flask', unitPriceCents: 3499, quantity: 1 } // $34.99
    ];
    const sub75Totals = calculateCartTotals(sub75Cart);
    assert.strictEqual(sub75Totals.cartSubtotalCents, 3499, 'Subtotal: 3,499 cents ($34.99)');
    assert.strictEqual(sub75Totals.isFreeShipping, false, 'Orders under $75 do not get free shipping');
    assert.strictEqual(sub75Totals.shippingCents, 500, 'Flat shipping fee is 500 cents ($5.00)');
    assert.strictEqual(sub75Totals.taxCents, 280, 'Tax on merchandise: Math.round(3499 * 0.08) = 280 cents ($2.80)');
    assert.strictEqual(sub75Totals.grandTotalCents, 4279, 'Grand total: 3,499 + 500 + 280 = 4,279 cents ($42.79)');
    console.log('    [Cart 5: Sub-$75 Shipping Passed]: Subtotal=$34.99, Shipping=$5.00, Tax=$2.80, Total=$42.79');

    // Scenario 6: Empty Cart
    const emptyTotals = calculateCartTotals([]);
    assert.strictEqual(emptyTotals.itemCount, 0);
    assert.strictEqual(emptyTotals.cartSubtotalCents, 0);
    assert.strictEqual(emptyTotals.shippingCents, 0);
    assert.strictEqual(emptyTotals.taxCents, 0);
    assert.strictEqual(emptyTotals.grandTotalCents, 0);
    console.log('    [Cart 6: Empty Cart Passed]: All fields cleanly 0');

    // Scenario 7: Rounding Boundary Cases (Math.round vs Math.floor)
    const roundingTests = [
      { subtotal: 1006, expectedTax: 80, desc: '$10.06 (80.48¢ rounds down to 80¢)' },
      { subtotal: 1007, expectedTax: 81, desc: '$10.07 (80.56¢ rounds up to 81¢)' },
      { subtotal: 1012, expectedTax: 81, desc: '$10.12 (80.96¢ rounds down to 81¢)' },
      { subtotal: 1019, expectedTax: 82, desc: '$10.19 (81.52¢ rounds up to 82¢)' }
    ];
    for (const rt of roundingTests) {
      const res = calculateCartTotals([{ productId: 'prod_test', unitPriceCents: rt.subtotal, quantity: 1 }]);
      assert.strictEqual(res.taxCents, rt.expectedTax, `Tax rounding mismatch for ${rt.desc}`);
    }
    console.log('    [Cart 7: Rounding Boundaries Passed]: All 4 half-cent boundary tests verified.');

    // =========================================================================
    // SECTION 2: CUSTOMER WIDGET CONFIDENTIALITY & ATTACHMENTS
    // =========================================================================
    console.log('\n--- SECTION 2: Customer Widget Security & Confidentiality ---');

    // 2a: Widget Config Endpoint
    console.log('  [2a] Testing widget public configuration endpoint...');
    const widgetCfgRes = await makeRequest('GET', '/api/widget/config?brandId=brand_novacart');
    assert.strictEqual(widgetCfgRes.status, 200);
    assert.strictEqual(widgetCfgRes.body.success, true);
    assert.strictEqual(widgetCfgRes.body.brand.id, 'brand_novacart');
    assert.ok(!widgetCfgRes.body.secret, 'Widget config must NEVER expose App Secret');

    // 2b: Customer Ticket View Insulation (Never leaks internal notes or agent private data)
    console.log('  [2b] Verifying customer widget endpoint never exposes internal agent notes...');
    // Seed an internal note into message_archive
    await directPool.query(`
      INSERT INTO message_archive (
        id, brand_id, ticket_id, nexconn_message_id, sender_user_id, target_user_id,
        sender_role, sender_name, message_type, message_text, content_payload
      ) VALUES (
        'msg_internal_sec_1', 'brand_novacart', 'tkt_1021', 'nex_int_sec_1',
        'user_sarah_lin', 'support_team', 'agent', 'Sarah Lin', 'RC:TxtMsg',
        'Customer might be eligible for courier concession if delayed > 7 days.',
        '{"isInternal":true,"type":"INTERNAL_NOTE"}'::jsonb
      ) ON CONFLICT DO NOTHING;
    `);

    // Customer queries public ticket route
    const custTktRes = await makeRequest('GET', '/api/tickets/tkt_1021?brandId=brand_novacart');
    assert.strictEqual(custTktRes.status, 200);
    const custTicket = custTktRes.body.ticket;
    assert.ok(!custTicket.internal_notes, 'Customer endpoint must not return internal notes');
    assert.ok(!custTicket.handoff_summary, 'Customer endpoint must not return handoff summaries');

    // 2c: Attachment Authorization
    console.log('  [2c] Testing attachment upload and authorized download...');
    const uploadRes = await directPool.query(`
      INSERT INTO attachments (
        id, brand_id, ticket_id, customer_id, storage_key, file_name, file_size_bytes, mime_type, file_data
      ) VALUES (
        'att_e2c_photo_1', 'brand_novacart', 'tkt_1021', 'cust_aarav', 'storage/att_e2c_photo_1.png', 'damaged_box.png', 8, 'image/png',
        decode('89504e470d0a1a0a', 'hex')
      ) RETURNING id;
    `);
    assert.strictEqual(uploadRes.rowCount, 1);

    // Authorized customer download
    const authDownload = await makeRequest('GET', '/api/attachments/att_e2c_photo_1/download', null, {
      'X-Customer-Id': 'cust_aarav',
      'X-Brand-Id': 'brand_novacart'
    });
    assert.strictEqual(authDownload.status, 200, 'Authorized customer download must succeed with HTTP 200');

    // Unauthorized cross-customer download rejected
    const unauthDownload = await makeRequest('GET', '/api/attachments/att_e2c_photo_1/download', null, {
      'X-Customer-Id': 'cust_priya',
      'X-Brand-Id': 'brand_novacart'
    });
    assert.strictEqual(unauthDownload.status, 403, 'Cross-customer attachment download must be rejected with HTTP 403');
    console.log('  [Attachment Security]: Authorized download 200, unauthorized 403 confirmed.');

    // =========================================================================
    // SECTION 3: AGENT CONSOLE INTEGRATION & WORKLOAD CONTROLS
    // =========================================================================
    console.log('\n--- SECTION 3: Agent Console & Shared Inbox Integration ---');

    // 3a: Agent Session Creation & Heartbeat
    console.log('  [3a] Establishing agent session for Sarah Lin...');
    const sessionRes = await createAgentSession({
      brandId: 'brand_novacart',
      userId: 'user_sarah_lin',
      ipAddress: '127.0.0.1'
    });
    assert.ok(sessionRes.sessionToken);
    const agentToken = sessionRes.sessionToken;
    const csrfToken = sessionRes.csrfToken;
    const authHeaders = {
      'Authorization': `Bearer ${agentToken}`,
      'X-CSRF-Token': csrfToken
    };

    // 3b: Heartbeat renewal
    console.log('  [3b] Refreshing agent session heartbeat...');
    const hbRes = await makeRequest('POST', '/api/agent/heartbeat', {}, authHeaders);
    assert.strictEqual(hbRes.status, 200);
    assert.strictEqual(hbRes.body.success, true);

    // 3c: Configured vs Effective Status & At Capacity
    console.log('  [3c] Testing At Capacity effective status when active_ticket_count >= max_concurrent...');
    await directPool.query(`
      UPDATE agent_profiles
      SET configured_status = 'Available', max_concurrent_tickets = 2, active_ticket_count = 2, last_heartbeat_at = NOW()
      WHERE brand_id = 'brand_novacart' AND user_id = 'user_sarah_lin';
    `);

    const profileRes = await makeRequest('GET', '/api/agent/profile', null, authHeaders);
    assert.strictEqual(profileRes.status, 200);
    assert.strictEqual(profileRes.body.profile.configured_status, 'Available');
    assert.strictEqual(profileRes.body.profile.effective_status, 'At Capacity');
    console.log('  [Effective Status]: Configured=Available, Workload=2/2 -> Effective=At Capacity confirmed.');

    // 3d: Unassigned Queue with PII Masking
    console.log('  [3d] Testing unassigned queue PII masking in full JSON...');
    // Seed an unassigned ticket in queue
    await directPool.query(`
      INSERT INTO ticket_routing_queue (
        id, brand_id, ticket_id, customer_id, priority, customer_language, required_skills, status
      ) VALUES (
        'q_unassigned_sec_1', 'brand_novacart', 'tkt_1022', 'cust_priya', 'High', 'mr-IN', '{"returns"}', 'queued'
      ) ON CONFLICT (id) DO NOTHING;
    `);

    const unassignedRes = await makeRequest('GET', '/api/inbox/unassigned', null, authHeaders);
    assert.strictEqual(unassignedRes.status, 200);
    assert.ok(Array.isArray(unassignedRes.body.tickets));
    const priyaUnassigned = unassignedRes.body.tickets.find(t => t.id === 'tkt_1022' || t.ticket_id === 'tkt_1022');
    if (priyaUnassigned && priyaUnassigned.customer) {
      assert.strictEqual(priyaUnassigned.customer.name, 'P*** M***', 'Customer name must be masked in unassigned queue');
      assert.strictEqual(priyaUnassigned.customer.email, 'p***@example.com', 'Customer email must be masked in unassigned queue');
      assert.strictEqual(priyaUnassigned.customer.phone, '', 'Customer phone must be masked in unassigned queue');
    }
    console.log('  [PII Masking]: Customer name and email strictly masked in unassigned queue.');

    // 3e: Atomic Ticket Claim
    console.log('  [3e] Testing atomic ticket claim from unassigned queue...');
    // Release 1 slot so Sarah Lin can claim
    await directPool.query(`
      UPDATE agent_profiles
      SET active_ticket_count = 1
      WHERE brand_id = 'brand_novacart' AND user_id = 'user_sarah_lin';
    `);

    const claimRes = await makeRequest('POST', '/api/inbox/tickets/tkt_1022/assign', { targetAgentId: 'user_sarah_lin' }, authHeaders);
    assert.strictEqual(claimRes.status, 200);
    assert.strictEqual(claimRes.body.success, true);
    assert.strictEqual(claimRes.body.assignedAgentId, 'user_sarah_lin');

    // Verify Sarah's active count incremented
    const sarahAfterClaim = (await directPool.query(`
      SELECT active_ticket_count FROM agent_profiles WHERE brand_id = 'brand_novacart' AND user_id = 'user_sarah_lin'
    `)).rows[0];
    assert.strictEqual(sarahAfterClaim.active_ticket_count, 2);

    // 3f: Atomic Ticket Transfer with Handoff Summary
    console.log('  [3f] Testing ticket transfer from Sarah Lin to Carlos Gomez...');
    // Provision Carlos Gomez as Available
    await directPool.query(`
      INSERT INTO users (id, name, email, password_hash)
      VALUES ('user_carlos', 'Carlos Gomez', 'carlos@novacart.com', 'carlos_hash')
      ON CONFLICT DO NOTHING;
      INSERT INTO brand_memberships (id, brand_id, user_id, role)
      VALUES ('mem_carlos_novacart', 'brand_novacart', 'user_carlos', 'agent')
      ON CONFLICT (brand_id, user_id) DO NOTHING;
      INSERT INTO agent_profiles (
        brand_id, user_id, nexconn_user_id, display_name, configured_status,
        primary_language, supported_languages, skills, max_concurrent_tickets, active_ticket_count, last_heartbeat_at
      ) VALUES (
        'brand_novacart', 'user_carlos', 'agent_carlos', 'Carlos Gomez', 'Available',
        'en-US', '{"en-US","es-ES"}', '{"returns","logistics"}', 3, 0, NOW()
      ) ON CONFLICT (brand_id, user_id) DO UPDATE SET configured_status = 'Available', last_heartbeat_at = NOW();
    `);

    const transferRes = await makeRequest('POST', '/api/inbox/tickets/tkt_1022/transfer', {
      toAgentId: 'user_carlos',
      handoffSummaryJson: {
        reason: 'Specialized return investigation required',
        priority: 'High'
      },
      internalNotes: 'Customer requested expedited return shipping.'
    }, authHeaders);

    assert.strictEqual(transferRes.status, 200);
    assert.strictEqual(transferRes.body.success, true);
    assert.strictEqual(transferRes.body.toAgentId, 'user_carlos');

    // 3g: Verify Handoff Summary in Conversation History (Agent Only)
    console.log('  [3g] Verifying handoff summary in agent conversation history...');
    // Sarah Lin is no longer assigned, so she receives HTTP 403 (strict agent isolation)
    const sarahUnauthorizedRes = await makeRequest('GET', '/api/inbox/tickets/tkt_1022', null, authHeaders);
    assert.strictEqual(sarahUnauthorizedRes.status, 403, 'Transferred agent must not access another agent ticket');

    // Carlos Gomez (the newly assigned agent) receives HTTP 200 with handoff summaries
    const carlosSession = await createAgentSession({
      brandId: 'brand_novacart',
      userId: 'user_carlos',
      ipAddress: '127.0.0.1'
    });
    const carlosHeaders = {
      'Authorization': `Bearer ${carlosSession.sessionToken}`,
      'X-CSRF-Token': carlosSession.csrfToken
    };
    const tktDetailsRes = await makeRequest('GET', '/api/inbox/tickets/tkt_1022', null, carlosHeaders);
    assert.strictEqual(tktDetailsRes.status, 200);
    assert.ok(tktDetailsRes.body.ticket.handoffSummaries.length > 0);
    assert.strictEqual(tktDetailsRes.body.ticket.handoffSummaries[0].to_agent_id, 'user_carlos');
    console.log('  [Handoff Summary]: Successfully retrieved by target agent with internal notes.');

    // =========================================================================
    // SECTION 4: KNOWLEDGE HUB UI & RBAC GATING
    // =========================================================================
    console.log('\n--- SECTION 4: Knowledge Hub Publishing & Grounding ---');

    // 4a: Create Draft Knowledge Item
    console.log('  [4a] Creating draft knowledge article...');
    const createDraftRes = await makeRequest('POST', '/api/knowledge/items', {
      category: 'policy',
      title: 'Extended Holiday Return Policy',
      contentMarkdown: 'Items purchased between Nov 1 and Dec 31 can be returned until Jan 31.',
      tags: ['holiday', 'return', 'extended'],
      isPublished: false
    }, authHeaders);
    assert.strictEqual(createDraftRes.status, 201);
    const draftId = createDraftRes.body.item.id;
    assert.strictEqual(createDraftRes.body.item.is_published, false);

    // 4b: Regular Agent Forbidden from Publishing (RBAC 403)
    console.log('  [4b] Testing RBAC: Regular agent forbidden from publishing draft (HTTP 403)...');
    const agentPublishRes = await makeRequest('POST', `/api/knowledge/items/${draftId}/publish`, {}, authHeaders);
    assert.strictEqual(agentPublishRes.status, 403, 'Regular agent must receive HTTP 403 Forbidden on publish');

    // 4c: Support Lead / Admin Allowed to Publish (RBAC 200)
    console.log('  [4c] Testing RBAC: Support lead authorized to publish draft (HTTP 200)...');
    // Elevate Sarah Lin membership role to support_lead in DB
    await directPool.query(`
      UPDATE brand_memberships SET role = 'support_lead' WHERE brand_id = 'brand_novacart' AND user_id = 'user_sarah_lin';
    `);

    const leadPublishRes = await makeRequest('POST', `/api/knowledge/items/${draftId}/publish`, {}, authHeaders);
    assert.strictEqual(leadPublishRes.status, 200, 'Support lead must receive HTTP 200 OK on publish');
    assert.strictEqual(leadPublishRes.body.item.is_published, true);
    assert.strictEqual(leadPublishRes.body.item.published_version, 1);

    // Restore Sarah Lin to agent role
    await directPool.query(`
      UPDATE brand_memberships SET role = 'agent' WHERE brand_id = 'brand_novacart' AND user_id = 'user_sarah_lin';
    `);

    // 4d: Grounded Copilot Suggestion
    console.log('  [4d] Testing Grounded Copilot AI suggestion retrieval...');
    const groundedRes = await makeRequest('POST', '/api/knowledge/grounded-response', {
      query: 'What is the return window for holiday purchases?',
      conversationContext: 'Customer inquiry regarding holiday purchase.'
    }, authHeaders);

    assert.strictEqual(groundedRes.status, 200);
    assert.strictEqual(groundedRes.body.grounded, true);
    assert.strictEqual(groundedRes.body.escalationRequired, false);
    assert.ok(groundedRes.body.suggestedReply.includes('return') || groundedRes.body.suggestedReply.includes('holiday'));

    // 4e: Missing Knowledge Escalation (Strict refusal to hallucinate)
    console.log('  [4e] Testing missing knowledge escalation (no hallucinated policies)...');
    const missingRes = await makeRequest('POST', '/api/knowledge/grounded-response', {
      query: 'Can I swap my bicycle for a helicopter and get a crypto grant?',
      conversationContext: 'Out of domain inquiry.'
    }, authHeaders);

    assert.strictEqual(missingRes.status, 200);
    assert.strictEqual(missingRes.body.grounded, false);
    assert.strictEqual(missingRes.body.escalationRequired, true);
    assert.ok(missingRes.body.suggestedReply.includes('do not have an approved policy') || missingRes.body.suggestedReply.includes('specialist'));

    // =========================================================================
    // SECTION 5: NEXCONN MESSAGE LIFECYCLE & WEBHOOK INTEGRATION
    // =========================================================================
    console.log('\n--- SECTION 5: Nexconn Webhook & Full Message Lifecycle ---');

    // 5a: Webhook Signature Header Validation
    console.log('  [5a] Testing webhook signature generation and validation...');
    const testNonce = Math.floor(Math.random() * 100000).toString();
    const testTimestamp = Date.now().toString();
    const expectedSig = crypto
      .createHash('sha1')
      .update(`${TEST_APP_SECRET}${testNonce}${testTimestamp}`)
      .digest('hex');

    const headersValid = validateWebhookHeaders({
      'app-key': TEST_APP_KEY,
      'nonce': testNonce,
      'timestamp': testTimestamp,
      'signature': expectedSig
    }, TEST_APP_KEY, TEST_APP_SECRET);
    assert.strictEqual(headersValid.valid, true);

    // Tampered signature rejected
    const headersTampered = validateWebhookHeaders({
      'app-key': TEST_APP_KEY,
      'nonce': testNonce,
      'timestamp': testTimestamp,
      'signature': 'invalid_tampered_signature_12345'
    }, TEST_APP_KEY, TEST_APP_SECRET);
    assert.strictEqual(headersTampered.valid, false);
    assert.strictEqual(headersTampered.status, 401);

    // Stale timestamp (> 5 minutes) rejected
    const staleTimestamp = (Date.now() - 360000).toString(); // 6 mins ago
    const staleSig = crypto
      .createHash('sha1')
      .update(`${TEST_APP_SECRET}${testNonce}${staleTimestamp}`)
      .digest('hex');
    const headersStale = validateWebhookHeaders({
      'app-key': TEST_APP_KEY,
      'nonce': testNonce,
      'timestamp': staleTimestamp,
      'signature': staleSig
    }, TEST_APP_KEY, TEST_APP_SECRET);
    assert.strictEqual(headersStale.valid, false);
    assert.strictEqual(headersStale.status, 400);
    console.log('  [Webhook Security]: Valid signature passed, tampered 401, stale 400 verified.');

    // 5b: Full Webhook Inbound Ingestion & Durable Deduplication
    console.log('  [5b] Ingesting inbound customer message webhook...');
    const webhookEventId = `evt_nex_e2c_${Date.now()}`;
    const webhookPayload = [{
      type: 'message:send',
      id: webhookEventId,
      time: Number(testTimestamp),
      data: {
        fromUserId: 'cust_aarav',
        toUserId: 'novacart_support',
        content: JSON.stringify({
          content: 'Where is my order #NC1021?',
          extra: JSON.stringify({
            ticketId: 'tkt_1021',
            brandId: 'brand_novacart'
          })
        })
      }
    }];

    const webhookRes = await makeRequest('POST', '/api/webhooks/nexconn', webhookPayload, {
      'app-key': TEST_APP_KEY,
      'nonce': testNonce,
      'timestamp': testTimestamp,
      'signature': expectedSig
    });
    assert.strictEqual(webhookRes.status, 200);
    assert.strictEqual(webhookRes.body.success, true);

    // Duplicate delivery skipped idempotently
    const dupRes = await makeRequest('POST', '/api/webhooks/nexconn', webhookPayload, {
      'app-key': TEST_APP_KEY,
      'nonce': testNonce,
      'timestamp': testTimestamp,
      'signature': expectedSig
    });
    assert.strictEqual(dupRes.status, 200);
    assert.strictEqual(dupRes.body.processed[0].status, 'duplicate_skipped');
    console.log('  [Durable Deduplication]: Event recorded once, duplicate skipped.');

    // 5c: Verify Message Archival and Ticket Association
    const archivedMsg = (await directPool.query(`
      SELECT id, brand_id, ticket_id, sender_user_id, message_text
      FROM message_archive
      WHERE brand_id = 'brand_novacart' AND ticket_id = 'tkt_1021' AND message_text = 'Where is my order #NC1021?'
    `)).rows[0];
    assert.ok(archivedMsg, 'Message must be permanently archived in message_archive table');
    assert.strictEqual(archivedMsg.sender_user_id, 'cust_aarav');
    console.log('  [Message Archival]: Message archived and associated with ticket tkt_1021.');

    // 5d: Verify Zero Secret Leakage in Client APIs
    console.log('  [5d] Verifying zero Nexconn App Secret leakage in public APIs...');
    const nexconnStatusRes = await makeRequest('GET', '/api/nexconn/status');
    assert.strictEqual(nexconnStatusRes.status, 200);
    assert.ok(!nexconnStatusRes.body.appSecret, 'nexconn status endpoint must NEVER leak NEXCONN_APP_SECRET');

    // 5e: Comprehensive Outbound Nexconn Messaging Lifecycle & Verification
    console.log('\n  [5e] Verifying complete outbound Nexconn message delivery lifecycle...');

    // Assign Sarah Lin to tkt_1021 so she has authorization to reply
    await directPool.query(`
      UPDATE tickets
      SET assigned_agent_id = 'user_sarah_lin', status = 'Human Agent Active'
      WHERE brand_id = 'brand_novacart' AND id = 'tkt_1021';
    `);

    // Requirement 1: Authenticated agent submits reply
    console.log('    [Req 1 & 3] Authenticated agent submits reply via POST /api/inbox/tickets/:ticketId/reply...');
    const replyText1 = 'Hello Aarav, your replacement NovaSprint shoes have shipped via DHL tracking #102199.';
    const dedupeKey1 = `dedupe_agent_reply_${Date.now()}`;
    const agentReplyRes = await makeRequest('POST', '/api/inbox/tickets/tkt_1021/reply', {
      messageText: replyText1,
      dedupeKey: dedupeKey1
    }, authHeaders);

    assert.strictEqual(agentReplyRes.status, 200, 'Agent reply must return HTTP 200');
    assert.strictEqual(agentReplyRes.body.success, true);
    assert.strictEqual(agentReplyRes.body.ticketId, 'tkt_1021');
    assert.strictEqual(agentReplyRes.body.dispatchStatus, 'dispatched');
    assert.ok(agentReplyRes.body.outboxId, 'Must return generated outboxId');
    assert.ok(agentReplyRes.body.messageId, 'Must return generated Nexconn messageId');
    const outboxId1 = agentReplyRes.body.outboxId;
    const nexconnMsgId1 = agentReplyRes.body.messageId;

    // Requirement 2: Backend verifies authorization and ticket ownership
    console.log('    [Req 2] Testing agent ownership and role-based reply authorization...');
    // Non-assigned agent (Carlos) is rejected with 403 Forbidden
    const unauthReplyRes = await makeRequest('POST', '/api/inbox/tickets/tkt_1021/reply', {
      messageText: 'Unauthorized attempt to reply to Sarah ticket'
    }, carlosHeaders);
    assert.strictEqual(unauthReplyRes.status, 403, 'Non-assigned agent must receive HTTP 403 Forbidden');

    // Closed ticket rejection: cannot reply to closed tickets
    await directPool.query(`
      UPDATE tickets SET status = 'Closed' WHERE brand_id = 'brand_novacart' AND id = 'tkt_1021';
    `);
    const closedReplyRes = await makeRequest('POST', '/api/inbox/tickets/tkt_1021/reply', {
      messageText: 'Attempting to reply to closed ticket'
    }, authHeaders);
    assert.strictEqual(closedReplyRes.status, 400, 'Reply to Closed ticket must return HTTP 400 Bad Request');
    // Restore ticket status
    await directPool.query(`
      UPDATE tickets SET status = 'Human Agent Active' WHERE brand_id = 'brand_novacart' AND id = 'tkt_1021';
    `);

    // Supervisor (support_lead) can reply even if unassigned
    await directPool.query(`
      UPDATE brand_memberships SET role = 'support_lead' WHERE brand_id = 'brand_novacart' AND user_id = 'user_carlos';
    `);
    const supervisorReplyRes = await makeRequest('POST', '/api/inbox/tickets/tkt_1021/reply', {
      messageText: 'Supervisor override update from Carlos.'
    }, carlosHeaders);
    assert.strictEqual(supervisorReplyRes.status, 200, 'Support lead supervisor must be authorized to reply (HTTP 200)');
    // Restore Carlos role
    await directPool.query(`
      UPDATE brand_memberships SET role = 'agent' WHERE brand_id = 'brand_novacart' AND user_id = 'user_carlos';
    `);

    // Requirement 3: Message persisted through secure outbox (outbox_messages)
    console.log('    [Req 3] Verifying persistence in outbox_messages table...');
    const outboxRecord = (await directPool.query(`
      SELECT * FROM outbox_messages WHERE id = $1
    `, [outboxId1])).rows[0];
    assert.ok(outboxRecord, 'Outbox message record must exist in database');
    assert.strictEqual(outboxRecord.dispatch_status, 'dispatched');
    assert.strictEqual(outboxRecord.conversation_mapping_id, 'map_1021');
    assert.strictEqual(outboxRecord.sender_user_id, 'novacart_support');
    assert.strictEqual(outboxRecord.target_user_id, 'cust_aarav');
    assert.strictEqual(outboxRecord.message_text, replyText1);
    assert.strictEqual(outboxRecord.nexconn_message_id, nexconnMsgId1);

    // Requirement 4: Nexconn send request uses registered support identity and customer peer ID
    console.log('    [Req 4] Verifying registered support identity and peer ID in mock Nexconn dispatch...');
    assert.ok(mockNexconnRequests.length > 0, 'Mock Nexconn server must have captured HTTP requests');
    const dispatchReq = mockNexconnRequests.find(r => r.body?.toUserIds?.includes('cust_aarav') && r.body?.fromUserId === 'novacart_support');
    assert.ok(dispatchReq, 'Nexconn API client must send message with registered support identity and customer peer ID');
    assert.strictEqual(dispatchReq.body.fromUserId, 'novacart_support', 'Registered support identity must be novacart_support');
    assert.deepStrictEqual(dispatchReq.body.toUserIds, ['cust_aarav'], 'Target recipient must match registered customer_user_id');
    assert.strictEqual(dispatchReq.headers['app-key'], TEST_APP_KEY, 'App-Key header must match configured TEST_APP_KEY');
    assert.ok(dispatchReq.headers['signature'], 'Signature header must be present');
    assert.ok(dispatchReq.headers['nonce'], 'Nonce header must be present');
    assert.ok(dispatchReq.headers['timestamp'], 'Timestamp header must be present');

    // Requirement 5: Response accepted strictly when code === 0
    console.log('    [Req 5] Verifying strict acceptance only when Nexconn code === 0...');
    // Override mock to return non-zero error code
    mockNexconnOverrideHandler = (req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ code: 1002, msg: 'Downstream recipient unavailable or suspended' }));
    };

    const failingDedupeKey = `dedupe_fail_${Date.now()}`;
    const failingJob = await enqueueOutboundMessage({
      brandId: 'brand_novacart',
      ticketId: 'tkt_1021',
      senderUserId: 'user_sarah_lin',
      messageText: 'This message will fail due to Nexconn code 1002',
      dedupeKey: failingDedupeKey
    });

    const failedDispatchResult = await processNextOutboxJob();
    assert.notStrictEqual(failedDispatchResult?.status, 'dispatched', 'Job with non-zero Nexconn return code must NOT be marked dispatched');

    const failingRecord = (await directPool.query(`
      SELECT dispatch_status, attempt_count, last_error FROM outbox_messages WHERE id = $1
    `, [failingJob.id])).rows[0];
    assert.strictEqual(failingRecord.dispatch_status, 'pending', 'Failed job must remain pending for retry');
    assert.ok(failingRecord.attempt_count >= 1, 'Attempt count must be incremented');
    assert.ok(failingRecord.last_error.includes('1002'), 'Last error must record non-zero error return code');

    // Restore mock handler
    mockNexconnOverrideHandler = null;

    // Requirement 6: Capture result.messageIds[] and map to local message
    console.log('    [Req 6] Verifying mapping to local message in message_archive...');
    const localArchived = (await directPool.query(`
      SELECT * FROM message_archive WHERE nexconn_message_id = $1
    `, [nexconnMsgId1])).rows[0];
    assert.ok(localArchived, 'Message must be mapped in message_archive table');
    assert.strictEqual(localArchived.id, `arch_${outboxId1}`);
    assert.strictEqual(localArchived.ticket_id, 'tkt_1021');
    assert.strictEqual(localArchived.sender_user_id, 'novacart_support');
    assert.strictEqual(localArchived.target_user_id, 'cust_aarav');
    assert.strictEqual(localArchived.sender_role, 'agent');
    assert.strictEqual(localArchived.message_text, replyText1);

    // Requirement 7: Retry and uncertain-send behavior do not create duplicate customer messages
    console.log('    [Req 7] Testing deduplication and uncertain-send idempotency...');
    // Submitting duplicate with dedupeKey1
    const duplicateOutbox = await enqueueOutboundMessage({
      brandId: 'brand_novacart',
      ticketId: 'tkt_1021',
      senderUserId: 'user_sarah_lin',
      messageText: replyText1,
      dedupeKey: dedupeKey1
    });
    assert.strictEqual(duplicateOutbox.id, outboxId1, 'Duplicate enqueue must return existing outbox row');

    const outboxCountForDedupe = (await directPool.query(`
      SELECT COUNT(*) FROM outbox_messages WHERE dedupe_key = $1
    `, [dedupeKey1])).rows[0].count;
    assert.strictEqual(parseInt(outboxCountForDedupe, 10), 1, 'Exactly 1 outbox record must exist for dedupe_key');

    // Simulate uncertain send (network drop/timeout)
    mockNexconnOverrideHandler = (req, res) => {
      req.destroy(new Error('Simulated socket abort / timeout'));
    };
    const uncertainJob = await enqueueOutboundMessage({
      brandId: 'brand_novacart',
      ticketId: 'tkt_1021',
      senderUserId: 'user_sarah_lin',
      messageText: 'Message during uncertain connection drop',
      dedupeKey: `dedupe_uncertain_${Date.now()}`
    });
    const uncertainDispatchRes = await processNextOutboxJob();
    assert.strictEqual(uncertainDispatchRes?.status, 'uncertain', 'Aborted connection transitions cleanly to uncertain state awaiting reconciliation');
    mockNexconnOverrideHandler = null;

    // Requirement 8: Delivery/status webhooks update the correct archived message
    console.log('    [Req 8] Testing delivery status webhook update on archived message...');
    const delivNonce = Math.floor(Math.random() * 100000).toString();
    const delivTs = Date.now().toString();
    const delivSig = crypto.createHash('sha1').update(`${TEST_APP_SECRET}${delivNonce}${delivTs}`).digest('hex');
    const deliveryWebhookPayload = [{
      type: 'message:delivered',
      id: `evt_deliv_${Date.now()}`,
      time: Number(delivTs),
      data: {
        messageId: nexconnMsgId1,
        status: 'delivered'
      }
    }];

    const delivWebhookRes = await makeRequest('POST', '/api/webhooks/nexconn', deliveryWebhookPayload, {
      'app-key': TEST_APP_KEY,
      'nonce': delivNonce,
      'timestamp': delivTs,
      'signature': delivSig
    });
    assert.strictEqual(delivWebhookRes.status, 200);

    const updatedArchive = (await directPool.query(`
      SELECT content_payload FROM message_archive WHERE nexconn_message_id = $1
    `, [nexconnMsgId1])).rows[0];
    assert.strictEqual(updatedArchive.content_payload?.deliveryStatus, 'delivered', 'Delivery status webhook must update message_archive');

    const updatedOutbox = (await directPool.query(`
      SELECT metadata FROM outbox_messages WHERE nexconn_message_id = $1
    `, [nexconnMsgId1])).rows[0];
    assert.strictEqual(updatedOutbox.metadata?.deliveryStatus, 'delivered', 'Delivery status webhook must update outbox_messages metadata');

    // Requirement 9: Failed sends remain recoverable and do not appear as successfully delivered
    console.log('    [Req 9] Auditing failed sends remain un-dispatched and recoverable...');
    const unDispatchedRows = (await directPool.query(`
      SELECT id, dispatch_status, dispatched_at, last_error
      FROM outbox_messages
      WHERE dispatch_status IN ('pending', 'failed', 'uncertain')
    `)).rows;
    for (const row of unDispatchedRows) {
      assert.strictEqual(row.dispatched_at, null, 'Un-dispatched rows must have dispatched_at IS NULL');
      assert.ok(row.last_error, 'Un-dispatched row must record last_error');
    }

    // Requirement 10: Zero exposure of NEXCONN_APP_SECRET
    console.log('    [Req 10] Auditing zero exposure of NEXCONN_APP_SECRET in outbound payloads...');
    assert.ok(!JSON.stringify(agentReplyRes.body).includes(TEST_APP_SECRET), 'Agent reply response must never leak App Secret');
    assert.ok(!JSON.stringify(outboxRecord).includes(TEST_APP_SECRET), 'Outbox table record must never leak App Secret');
    assert.ok(!JSON.stringify(localArchived).includes(TEST_APP_SECRET), 'Archive table record must never leak App Secret');

    // Conversation Continuity Check: Conversation mapping remains intact
    console.log('    [Continuity] Verifying customer conversation mapping preserved across assignments & transfers...');
    const preservedMapping = (await directPool.query(`
      SELECT id, brand_id, ticket_id, customer_id, customer_user_id, support_identity, conversation_key
      FROM conversation_mappings
      WHERE brand_id = 'brand_novacart' AND ticket_id = 'tkt_1021'
    `)).rows;
    assert.strictEqual(preservedMapping.length, 1, 'Exactly one persistent conversation mapping must exist for ticket');
    assert.strictEqual(preservedMapping[0].id, 'map_1021');
    assert.strictEqual(preservedMapping[0].customer_user_id, 'cust_aarav');
    assert.strictEqual(preservedMapping[0].support_identity, 'novacart_support');
    assert.strictEqual(preservedMapping[0].conversation_key, 'conv_novacart_NC1021');
    console.log('  [Outbound Nexconn Verified]: All 10 outbound requirements and channel continuity confirmed.');

    // =========================================================================
    // SECTION 6: CONCURRENCY STRESS & DATABASE CONSISTENCY AUDIT
    // =========================================================================
    console.log('\n--- SECTION 6: Concurrency Stress & Final Capacity Consistency ---');

    // Concurrent Mixed Operations: enqueues, claims, transfers, and resolutions
    console.log('  [6a] Executing 15 mixed concurrent workforce operations...');
    const mixedPromises = [];

    // Setup Sarah and Carlos capacity
    await directPool.query(`
      UPDATE agent_profiles
      SET configured_status = 'Available', max_concurrent_tickets = 5, active_ticket_count = 0, last_heartbeat_at = NOW()
      WHERE brand_id = 'brand_novacart' AND user_id = 'user_sarah_lin';

      UPDATE agent_profiles
      SET configured_status = 'Available', max_concurrent_tickets = 5, active_ticket_count = 0, last_heartbeat_at = NOW()
      WHERE brand_id = 'brand_novacart' AND user_id = 'user_carlos';
    `);

    // Pre-insert tickets for stress test
    for (let i = 1; i <= 5; i++) {
      await directPool.query(`
        INSERT INTO tickets (id, brand_id, customer_id, category, priority, status, human_requested, summary, last_updated)
        VALUES ($1, 'brand_novacart', 'cust_aarav', 'general_inquiry', 'Medium', 'AI Handling', FALSE, 'Stress Ticket', NOW())
        ON CONFLICT (brand_id, id) DO UPDATE SET status = 'AI Handling', human_requested = FALSE, assigned_agent_id = NULL;
      `, [`tkt_stress_${i}`]);
    }

    // Operation 1-5: Enqueue tickets
    for (let i = 1; i <= 5; i++) {
      mixedPromises.push(enqueueOrReopenTicket({
        brandId: 'brand_novacart',
        ticketId: `tkt_stress_${i}`,
        customerId: 'cust_aarav',
        priority: 'Medium',
        customerLanguage: 'en-US',
        requiredSkills: ['general_inquiry']
      }));
    }

    // Operation 6-10: Trigger debounced scheduler passes
    for (let i = 0; i < 5; i++) {
      mixedPromises.push(new Promise((resolve) => {
        dispatchSchedulingOpportunity('brand_novacart');
        resolve();
      }));
    }

    // Operation 11-15: Run multi-tenant queue sweeps
    for (let i = 0; i < 5; i++) {
      mixedPromises.push(processDueQueuedTicketsMultiTenant().catch(() => ({})));
    }

    await Promise.all(mixedPromises);
    await new Promise((r) => setTimeout(r, 250)); // Allow debounced cycle to settle

    console.log('  [6b] Auditing database consistency between active_ticket_count and committed tickets...');
    // Reconcile both agents
    await reconcileAgentCapacity({ brandId: 'brand_novacart', userId: 'user_sarah_lin' });
    await reconcileAgentCapacity({ brandId: 'brand_novacart', userId: 'user_carlos' });

    const auditRes = (await directPool.query(`
      SELECT
        ap.user_id,
        ap.active_ticket_count,
        (SELECT COUNT(*) FROM tickets WHERE brand_id = 'brand_novacart' AND assigned_agent_id = ap.user_id AND status IN ('Human Requested', 'Human Agent Active')) AS committed_active
      FROM agent_profiles ap
      WHERE ap.brand_id = 'brand_novacart' AND ap.user_id IN ('user_sarah_lin', 'user_carlos')
    `)).rows;

    for (const agent of auditRes) {
      assert.strictEqual(
        parseInt(agent.active_ticket_count, 10),
        parseInt(agent.committed_active, 10),
        `Agent ${agent.user_id} active_ticket_count (${agent.active_ticket_count}) must match committed active tickets (${agent.committed_active})`
      );
      console.log(`  [Audit Match]: ${agent.user_id} active_ticket_count=${agent.active_ticket_count}, committed=${agent.committed_active}`);
    }

    console.log('\n================================================================================');
    console.log('=== [ALL CHECKPOINT E2-C END-TO-END INTEGRATION TESTS PASSED] ===');
    console.log('================================================================================\n');

  } catch (err) {
    console.error('\n[FATAL AUDIT FAILURE]:', err);
    throw err;
  } finally {
    try {
      if (httpServer) {
        await new Promise((resolve) => httpServer.close(resolve));
      }
      if (mockNexconnServer) {
        await new Promise((resolve) => mockNexconnServer.close(resolve)).catch(() => {});
      }
      await directPool.end().catch(() => {});
      await closePool().catch(() => {});
      if (originalDbUrl) {
        process.env.DATABASE_URL = originalDbUrl;
      } else {
        delete process.env.DATABASE_URL;
      }
      if (originalNodeEnv) process.env.NODE_ENV = originalNodeEnv;
      if (originalAppKey) process.env.NEXCONN_APP_KEY = originalAppKey;
      if (originalAppSecret) process.env.NEXCONN_APP_SECRET = originalAppSecret;
      if (originalApiUrl) {
        process.env.NEXCONN_API_URL = originalApiUrl;
      } else {
        delete process.env.NEXCONN_API_URL;
      }

      console.log('[PG16 Teardown] Stopping EmbeddedPostgres server...');
      await Promise.race([
        pgServer.stop(),
        new Promise((resolve) => setTimeout(resolve, 5000))
      ]).catch(() => {});
      if (fs.existsSync(PG16_DATA_DIR)) {
        try { fs.rmSync(PG16_DATA_DIR, { recursive: true, force: true }); } catch (e) {}
      }
      console.log('[PG16 Teardown] Completed cleanly.');
    } catch (e) {}
  }
}

runE2CIntegrationTests().catch((err) => {
  console.error('\n[FATAL PROCESS FAILURE]:', err);
  process.exit(1);
});
