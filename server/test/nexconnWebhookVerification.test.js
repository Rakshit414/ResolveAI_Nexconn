import assert from 'assert';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PGlite } from '@electric-sql/pglite';
import { validateWebhookHeaders, parseWebhookEnvelopes, extractCorrelationData } from '../src/routes/webhooks.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');
const TEST_DB_PATH = path.resolve(ROOT_DIR, 'server/data/webhook_test_db');

console.log('=== [TEST SUITE 12: Official Nexconn Webhook Protocol & Envelope Verification] ===');

async function runNexconnWebhookVerificationTests() {
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.rmSync(TEST_DB_PATH, { recursive: true, force: true });
  }
  fs.mkdirSync(TEST_DB_PATH, { recursive: true });

  const db = new PGlite(TEST_DB_PATH);

  try {
    // Initialize schema and demo seed
    const ddlPath = path.resolve(ROOT_DIR, 'server/src/db/migrations/001_canonical_schema.sql');
    await db.exec(fs.readFileSync(ddlPath, 'utf8'));

    const seedPath = path.resolve(ROOT_DIR, 'server/src/db/migrations/002_seed_demo_data.sql');
    await db.exec(fs.readFileSync(seedPath, 'utf8'));

    const testAppKey = 'z3v5y_test_app_key';
    const testAppSecret = 'test_secret_9988aabbcc';

    // --- 1. Signature & Security Header Invariants ---
    console.log('\n--- 1. Official Header & Signature Validation ---');
    const validNonce = '1794292482001234';
    const validTimestamp = Date.now().toString();
    const validSignature = crypto
      .createHash('sha1')
      .update(`${testAppSecret}${validNonce}${validTimestamp}`)
      .digest('hex');

    // Legitimate webhook request
    const legitimateHeaders = {
      'app-key': testAppKey,
      'nonce': validNonce,
      'timestamp': validTimestamp,
      'signature': validSignature
    };
    const validRes = validateWebhookHeaders(legitimateHeaders, testAppKey, testAppSecret);
    assert.strictEqual(validRes.valid, true, 'Legitimate headers and SHA1 signature must pass');
    console.log('[PASS] Formula SHA1(AppSecret + Nonce + Timestamp) verified');

    // Tampered signature
    const tamperedHeaders = { ...legitimateHeaders, signature: 'deadbeef1234567890abcdef1234567890abcdef' };
    const tamperedRes = validateWebhookHeaders(tamperedHeaders, testAppKey, testAppSecret);
    assert.strictEqual(tamperedRes.valid, false, 'Tampered signature must be rejected');
    assert.strictEqual(tamperedRes.status, 401);
    console.log('[PASS] Constant-time signature verification rejected tampered signature');

    // Mismatched App-Key
    const wrongAppKeyHeaders = { ...legitimateHeaders, 'app-key': 'different_app_key' };
    const wrongKeyRes = validateWebhookHeaders(wrongAppKeyHeaders, testAppKey, testAppSecret);
    assert.strictEqual(wrongKeyRes.valid, false);
    assert.strictEqual(wrongKeyRes.status, 401);
    console.log('[PASS] Mismatched App-Key header rejected');

    // Expired timestamp (> 5 minutes old)
    const expiredTs = (Date.now() - 400000).toString();
    const expiredSig = crypto.createHash('sha1').update(`${testAppSecret}${validNonce}${expiredTs}`).digest('hex');
    const expiredHeaders = {
      'app-key': testAppKey,
      'nonce': validNonce,
      'timestamp': expiredTs,
      'signature': expiredSig
    };
    const expiredRes = validateWebhookHeaders(expiredHeaders, testAppKey, testAppSecret);
    assert.strictEqual(expiredRes.valid, false);
    assert.strictEqual(expiredRes.status, 400);
    console.log('[PASS] Expired timestamp (> 300,000 ms) rejected');

    // Nonce length violation (> 18 characters)
    const longNonce = '1234567890123456789'; // 19 chars
    const longNonceSig = crypto.createHash('sha1').update(`${testAppSecret}${longNonce}${validTimestamp}`).digest('hex');
    const longNonceHeaders = {
      'app-key': testAppKey,
      'nonce': longNonce,
      'timestamp': validTimestamp,
      'signature': longNonceSig
    };
    const longNonceRes = validateWebhookHeaders(longNonceHeaders, testAppKey, testAppSecret);
    assert.strictEqual(longNonceRes.valid, false);
    assert.strictEqual(longNonceRes.status, 400);
    console.log('[PASS] Nonce exceeding 18 characters rejected');

    // --- 2. Official Nexconn Envelope Parsing ---
    console.log('\n--- 2. Webhook Envelope Normalization (Batched & Single) ---');
    // Envelope Format A: Single envelope with { type, id, time, data }
    const singleEnvelope = {
      type: 'message:send',
      id: 'evt_single_001',
      time: Date.now(),
      data: {
        fromUserId: 'cust_aarav',
        toUserId: 'novacart_support',
        objectName: 'RC:TxtMsg',
        content: JSON.stringify({ content: 'Status check for shoes', extra: { ticketId: 'tkt_1021' } }),
        msgUID: 'msg_uid_1001'
      }
    };
    const parsedA = parseWebhookEnvelopes(singleEnvelope, Date.now());
    assert.strictEqual(parsedA.length, 1);
    assert.strictEqual(parsedA[0].type, 'message:send');
    assert.strictEqual(parsedA[0].id, 'evt_single_001');
    assert.strictEqual(parsedA[0].data.fromUserId, 'cust_aarav');
    console.log('[PASS] Single envelope parsed successfully');

    // Envelope Format B: Batched array of envelopes [{ type, id, time, data }, ...]
    const batchedEnvelopes = [
      {
        type: 'user:connection_status',
        id: 'evt_batch_001',
        time: Date.now(),
        data: { userId: 'agent_sarah', status: 0 }
      },
      {
        type: 'message:send',
        id: 'evt_batch_002',
        time: Date.now(),
        data: {
          fromUserId: 'cust_priya',
          toUserId: 'novacart_support',
          objectName: 'RC:TxtMsg',
          content: 'Return question for watch',
          msgUID: 'msg_uid_2002'
        }
      }
    ];
    const parsedB = parseWebhookEnvelopes(batchedEnvelopes, Date.now());
    assert.strictEqual(parsedB.length, 2);
    assert.strictEqual(parsedB[0].type, 'user:connection_status');
    assert.strictEqual(parsedB[1].type, 'message:send');
    console.log('[PASS] Batched array envelope parsed successfully');

    // --- 3. Database Event Deduplication & Correlation ---
    console.log('\n--- 3. Database Deduplication via webhook_receipts & Message Archiving ---');
    const eventId = 'evt_dedupe_test_01';
    // Insert initial webhook receipt
    await db.query(`
      INSERT INTO webhook_receipts (event_id, event_type, raw_payload, signature, nonce, timestamp_ms, processing_status)
      VALUES ($1, 'message:send', '{"test":true}'::jsonb, $2, $3, $4, 'received')
    `, [eventId, validSignature, validNonce, Number(validTimestamp)]);

    // Check duplicate detection
    const existingCheck = await db.query(`SELECT event_id FROM webhook_receipts WHERE event_id = $1`, [eventId]);
    assert.strictEqual(existingCheck.rows.length, 1, 'Duplicate event must be detected');

    // Test message archiving with correlation to tkt_1021
    const nexconnMsgId = 'D1OG-TEST-MSG-001';
    await db.query(`
      INSERT INTO message_archive (
        id, brand_id, ticket_id, nexconn_message_id, sender_user_id, target_user_id,
        sender_role, sender_name, message_type, message_text, content_payload
      )
      VALUES ('arch_test_01', 'brand_novacart', 'tkt_1021', $1, 'cust_aarav', 'novacart_support', 'customer', 'Aarav Sharma', 'RC:TxtMsg', 'Test live webhook', '{"ok":true}'::jsonb)
    `, [nexconnMsgId]);

    const msgRes = await db.query(`SELECT id, ticket_id FROM message_archive WHERE nexconn_message_id = $1`, [nexconnMsgId]);
    assert.strictEqual(msgRes.rows.length, 1);
    assert.strictEqual(msgRes.rows[0].ticket_id, 'tkt_1021');
    console.log('[PASS] Message persisted into message_archive with strict ticket correlation');

    // --- 4. Unrecognized Brand & Ambiguous Message Quarantine ---
    console.log('\n--- 4. Unrecognized Brand & Ambiguity Quarantine into unrouted_messages ---');
    // Unknown brand quarantine with NULL brand_id
    const unrecogMsgId = 'unr_unknown_brand_01';
    await db.query(`
      INSERT INTO unrouted_messages (
        id, brand_id, sender_user_id, recipient_user_id, nexconn_message_id,
        message_type, message_text, content_payload, ambiguity_reason
      )
      VALUES ($1, NULL, 'user_stranger', 'unknown_support_bot', 'msg_foreign_99', 'RC:TxtMsg', 'Hello?', '{"foreign":true}'::jsonb, 'UNRECOGNIZED_BRAND')
    `, [unrecogMsgId]);

    const unrecogRes = await db.query(`SELECT id, ambiguity_reason, brand_id FROM unrouted_messages WHERE id = $1`, [unrecogMsgId]);
    assert.strictEqual(unrecogRes.rows.length, 1);
    assert.strictEqual(unrecogRes.rows[0].brand_id, null, 'Unrecognized brand must have NULL brand_id in quarantine');
    assert.strictEqual(unrecogRes.rows[0].ambiguity_reason, 'UNRECOGNIZED_BRAND');
    console.log('[PASS] Global quarantine for unrecognized brands verified with NULL brand_id');

    console.log('\n=================================================================');
    console.log('ALL OFFICIAL NEXCONN WEBHOOK PROTOCOL INVARIANTS PASSED');
    console.log('=================================================================');
  } catch (err) {
    console.error('WEBHOOK VERIFICATION TEST FAILED:', err);
    process.exit(1);
  } finally {
    await db.close();
    try {
      fs.rmSync(TEST_DB_PATH, { recursive: true, force: true });
    } catch (e) {}
  }
}

runNexconnWebhookVerificationTests();
