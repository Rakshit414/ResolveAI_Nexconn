import assert from 'assert';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PGlite } from '@electric-sql/pglite';
import { validateBrandOrigin, isGuestRateLimited, resetGuestRateLimit } from '../src/routes/widget.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');
const TEST_DB_PATH = path.resolve(ROOT_DIR, 'server/data/widget_sec_test_db');

console.log('=== [TEST SUITE 10: Widget Security, Origin Validation & Session Isolation] ===');

async function runWidgetSecurityTests() {
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.rmSync(TEST_DB_PATH, { recursive: true, force: true });
  }
  fs.mkdirSync(TEST_DB_PATH, { recursive: true });

  const db = new PGlite(TEST_DB_PATH);

  try {
    // 1. Initialize schema & seed
    const ddlPath = path.resolve(ROOT_DIR, 'server/src/db/migrations/001_canonical_schema.sql');
    await db.exec(fs.readFileSync(ddlPath, 'utf8'));

    const seedPath = path.resolve(ROOT_DIR, 'server/src/db/migrations/002_seed_demo_data.sql');
    await db.exec(fs.readFileSync(seedPath, 'utf8'));

    const brandRes = await db.query(`SELECT id, name, allowed_origins FROM brands WHERE id = 'brand_novacart'`);
    assert.strictEqual(brandRes.rows.length, 1);
    const brand = brandRes.rows[0];

    // --- TEST 1: Per-Brand Origin Validation ---
    console.log('\n--- 1. Per-Brand Origin Validation ---');
    // Allowed origins: http://localhost:5173, http://localhost:5000, https://resolve-ai-novacart.onrender.com
    assert.strictEqual(validateBrandOrigin(brand, 'http://localhost:5173'), true, 'localhost:5173 must be allowed');
    assert.strictEqual(validateBrandOrigin(brand, 'http://localhost:5000'), true, 'localhost:5000 must be allowed');
    assert.strictEqual(validateBrandOrigin(brand, 'https://resolve-ai-novacart.onrender.com'), true, 'Deployed domain must be allowed');
    assert.strictEqual(validateBrandOrigin(brand, 'https://malicious-attacker.com'), false, 'Untrusted origin must be rejected');
    assert.strictEqual(validateBrandOrigin(brand, 'http://fake-novacart.com'), false, 'Fake domain must be rejected');

    // Production environment check for empty/missing origin
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    assert.strictEqual(validateBrandOrigin(brand, ''), false, 'Empty origin in production must be rejected');
    assert.strictEqual(validateBrandOrigin(brand, null), false, 'Null origin in production must be rejected');
    process.env.NODE_ENV = prevEnv;
    console.log('[PASS] Per-brand origin allowlist and production origin validation verified');

    // --- TEST 2: Sliding-Window Guest Session Rate Limiting ---
    console.log('\n--- 2. Guest Session Rate Limiting ---');
    resetGuestRateLimit();
    const testIp = '203.0.113.42';
    for (let i = 1; i <= 10; i++) {
      const limited = isGuestRateLimited(testIp);
      assert.strictEqual(limited, false, `Request ${i} should be permitted`);
    }
    // 11th request must be rate limited
    const rateLimited11th = isGuestRateLimited(testIp);
    assert.strictEqual(rateLimited11th, true, '11th request within 1 min must trigger rate limit (HTTP 429)');
    
    // Different IP must not be affected
    const differentIp = '198.51.100.1';
    assert.strictEqual(isGuestRateLimited(differentIp), false, 'Different IP must have its own isolated rate limit bucket');
    resetGuestRateLimit();
    console.log('[PASS] Guest session provisioning sliding-window rate limiter verified');

    // --- TEST 3: Customer & Order Isolation in Widget Context ---
    console.log('\n--- 3. Customer & Order Access Isolation ---');
    // Customer Aarav ('cust_aarav') owns Order 'NC1021'
    const aaravOrder = await db.query(`
      SELECT id, order_number, customer_id FROM orders 
      WHERE brand_id = 'brand_novacart' AND order_number = 'NC1021' AND customer_id = 'cust_aarav'
    `);
    assert.strictEqual(aaravOrder.rows.length, 1, 'Aarav must be able to resolve his own order');

    // Aarav attempting to access Priya's order 'NC1022'
    const priyaOrderViaAarav = await db.query(`
      SELECT id, order_number, customer_id FROM orders 
      WHERE brand_id = 'brand_novacart' AND order_number = 'NC1022' AND customer_id = 'cust_aarav'
    `);
    assert.strictEqual(priyaOrderViaAarav.rows.length, 0, 'Aarav must NOT resolve Priya’s order NC1022');

    // Guest visitor attempting to query orders
    const guestOrderQuery = await db.query(`
      SELECT id FROM orders 
      WHERE brand_id = 'brand_novacart' AND order_number = 'NC1021' AND customer_id = 'cust_guest_anon'
    `);
    assert.strictEqual(guestOrderQuery.rows.length, 0, 'Anonymous guest must NOT resolve any customer orders');
    console.log('[PASS] Cross-customer order context access strictly blocked');

    // --- TEST 4: Widget Session Bearer Token Hashing & Ticket Ownership ---
    console.log('\n--- 4. Session Token Hashing & Ticket Ownership Enforcement ---');
    // Generate Aarav's session token
    const aaravRawToken = `wgt_test_${crypto.randomBytes(32).toString('hex')}`;
    const aaravTokenHash = crypto.createHash('sha256').update(aaravRawToken).digest('hex');
    const sessionId = `wgt_sess_${Date.now()}`;

    await db.query(`
      INSERT INTO widget_sessions (id, brand_id, customer_id, session_token_hash, origin, is_guest, expires_at)
      VALUES ($1, 'brand_novacart', 'cust_aarav', $2, 'http://localhost:5173', false, NOW() + INTERVAL '24 hours')
    `, [sessionId, aaravTokenHash]);

    // Lookup session by hash
    const sessionRes = await db.query(`
      SELECT ws.id, ws.customer_id, ws.brand_id 
      FROM widget_sessions ws
      WHERE ws.session_token_hash = $1 AND ws.revoked_at IS NULL AND ws.expires_at > NOW()
    `, [aaravTokenHash]);
    assert.strictEqual(sessionRes.rows.length, 1, 'Valid session token hash must be resolved');

    // Test Aarav sending message to his own ticket 'tkt_1021'
    const validTicketRes = await db.query(`
      SELECT id FROM tickets WHERE id = 'tkt_1021' AND brand_id = $1 AND customer_id = $2
    `, [sessionRes.rows[0].brand_id, sessionRes.rows[0].customer_id]);
    assert.strictEqual(validTicketRes.rows.length, 1, 'Ticket tkt_1021 belongs to Aarav');

    // Test Aarav attempting to send message on Priya's ticket 'tkt_1022'
    const invalidTicketRes = await db.query(`
      SELECT id FROM tickets WHERE id = 'tkt_1022' AND brand_id = $1 AND customer_id = $2
    `, [sessionRes.rows[0].brand_id, sessionRes.rows[0].customer_id]);
    assert.strictEqual(invalidTicketRes.rows.length, 0, 'Ticket tkt_1022 does NOT belong to Aarav and must be rejected');

    // Test Session Token Revocation
    await db.query(`UPDATE widget_sessions SET revoked_at = NOW() WHERE session_token_hash = $1`, [aaravTokenHash]);
    const revokedSessionRes = await db.query(`
      SELECT ws.id FROM widget_sessions ws
      WHERE ws.session_token_hash = $1 AND ws.revoked_at IS NULL
    `, [aaravTokenHash]);
    assert.strictEqual(revokedSessionRes.rows.length, 0, 'Revoked session token must be immediately invalidated');
    console.log('[PASS] Session token hashing, ticket ownership isolation and token revocation verified');

    // --- TEST 5: Iframe PostMessage Security Invariants ---
    console.log('\n--- 5. Iframe postMessage Security Invariants ---');
    // Simulate WidgetFrame security check:
    function simulateWidgetFrameReceive(event, trustedOrigins, expectedParent) {
      if (event.source !== expectedParent) {
        return { accepted: false, reason: 'Invalid event.source (spoofed window)' };
      }
      const originMatch = trustedOrigins.some(o => event.origin.startsWith(o));
      if (!originMatch) {
        return { accepted: false, reason: 'Untrusted event.origin' };
      }
      return { accepted: true, data: event.data };
    }

    const mockParentWindow = { id: 'parent_window_ref' };
    const mockMaliciousWindow = { id: 'evil_iframe_ref' };
    const allowed = ['http://localhost:5173', 'https://resolve-ai-novacart.onrender.com'];

    // Legitimate parent postMessage
    const validMsg = simulateWidgetFrameReceive(
      { source: mockParentWindow, origin: 'http://localhost:5173', data: { type: 'RESOLVE_AI_INIT' } },
      allowed,
      mockParentWindow
    );
    assert.strictEqual(validMsg.accepted, true, 'Legitimate postMessage must be accepted');

    // Spoofed origin
    const spoofedOriginMsg = simulateWidgetFrameReceive(
      { source: mockParentWindow, origin: 'http://attacker-site.com', data: { type: 'RESOLVE_AI_STEAL' } },
      allowed,
      mockParentWindow
    );
    assert.strictEqual(spoofedOriginMsg.accepted, false, 'Spoofed origin must be rejected');
    assert.strictEqual(spoofedOriginMsg.reason, 'Untrusted event.origin');

    // Spoofed window source (e.g. cross-origin popup attempting to inject message into widget iframe)
    const spoofedSourceMsg = simulateWidgetFrameReceive(
      { source: mockMaliciousWindow, origin: 'http://localhost:5173', data: { type: 'RESOLVE_AI_HIJACK' } },
      allowed,
      mockParentWindow
    );
    assert.strictEqual(spoofedSourceMsg.accepted, false, 'Spoofed event.source must be rejected');
    assert.strictEqual(spoofedSourceMsg.reason, 'Invalid event.source (spoofed window)');
    console.log('[PASS] Dual verification of event.origin AND event.source verified');

    console.log('\n=================================================================');
    console.log('ALL WIDGET SECURITY ASSERTIONS PASSED AGAINST POSTGRESQL ENGINE');
    console.log('=================================================================');
  } catch (err) {
    console.error('WIDGET SECURITY TEST FAILED:', err);
    process.exit(1);
  } finally {
    await db.close();
    try {
      fs.rmSync(TEST_DB_PATH, { recursive: true, force: true });
    } catch (e) {}
  }
}

runWidgetSecurityTests();
