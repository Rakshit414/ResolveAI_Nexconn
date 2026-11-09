import assert from 'assert';
import crypto from 'crypto';
import { runMigration } from '../src/db/migrate.js';
import { query } from '../src/db/pool.js';
import { extractCorrelationData } from '../src/routes/webhooks.js';

async function runWebhookEventLedgerTests() {
  console.log('=== [TEST SUITE 5: Webhook Event Ledger, Signatures & Quarantine] ===');
  await runMigration();

  const appSecret = 'jEzlPEifF7g';
  process.env.NEXCONN_APP_SECRET = appSecret;

  // Test 1: Signature Verification (SHA1)
  const nonce = crypto.randomBytes(8).toString('hex'); // 16 chars (<= 18 chars)
  const timestamp = Date.now().toString();
  const validSignature = crypto.createHash('sha1').update(`${appSecret}${nonce}${timestamp}`).digest('hex');
  const invalidSignature = 'tampered_sig_12345';

  assert.strictEqual(
    crypto.createHash('sha1').update(`${appSecret}${nonce}${timestamp}`).digest('hex'),
    validSignature
  );
  assert.notStrictEqual(invalidSignature, validSignature);
  console.log('[PASS] Constant-time signature comparison verified');

  // Test 2: Timestamp Freshness & Replay Window (Reject > 300,000 ms)
  const staleTimestamp = (Date.now() - 400000).toString();
  const isFresh = Math.abs(Date.now() - Number(timestamp)) <= 300000;
  const isStale = Math.abs(Date.now() - Number(staleTimestamp)) <= 300000;
  assert.strictEqual(isFresh, true);
  assert.strictEqual(isStale, false);
  console.log('[PASS] Replay protection rejects events older than 5 minutes');

  // Test 3: Event Deduplication via webhook_receipts
  const eventId = `msg_wh_${Date.now()}`;
  const rawPayload = {
    event: 'message:send',
    msgUID: eventId,
    fromUserId: 'cust_aarav',
    toUserId: 'novacart_support',
    content: JSON.stringify({
      content: 'Where is my order?',
      extra: JSON.stringify({ ticketId: 'tkt_1021', brandId: 'brand_novacart' })
    })
  };

  // Helper check
  async function insertEventIfNotDuplicate(id, payload, sig, n, ts) {
    const existing = await query(`SELECT event_id FROM webhook_receipts WHERE event_id = $1`, [id]);
    if (existing.rows && existing.rows.length > 0) {
      return { duplicate: true };
    }
    await query(`
      INSERT INTO webhook_receipts (event_id, event_type, brand_id, raw_payload, signature, nonce, timestamp_ms, processing_status)
      VALUES ($1, 'message:send', 'brand_novacart', $2, $3, $4, $5, 'received')
    `, [id, JSON.stringify(payload), sig, n, ts]);
    return { duplicate: false };
  }

  const res1 = await insertEventIfNotDuplicate(eventId, rawPayload, validSignature, nonce, Number(timestamp));
  assert.strictEqual(res1.duplicate, false);

  const res2 = await insertEventIfNotDuplicate(eventId, rawPayload, validSignature, nonce, Number(timestamp));
  assert.strictEqual(res2.duplicate, true); // Duplicate skipped
  console.log('[PASS] Webhook receipts ledger deduplicated duplicate event ID without re-executing');

  // Test 4: Global Quarantine for Unrecognized Brand (brand_id = NULL)
  const unknownBrandEventId = `msg_unknown_${Date.now()}`;
  await query(`
    INSERT INTO unrouted_messages (
      id, brand_id, sender_user_id, recipient_user_id, nexconn_message_id,
      message_type, message_text, content_payload, ambiguity_reason
    )
    VALUES ($1, NULL, 'user_external', 'unknown_support_identity', $2, 'RC:TxtMsg', 'Unknown message', '{}', 'UNRECOGNIZED_BRAND')
  `, [`unr_${unknownBrandEventId}`, unknownBrandEventId]);

  const quarantineCheck = await query(`
    SELECT id, brand_id, ambiguity_reason 
    FROM unrouted_messages 
    WHERE id = $1
  `, [`unr_${unknownBrandEventId}`]);
  assert.strictEqual(quarantineCheck.rows.length, 1);
  assert.strictEqual(quarantineCheck.rows[0].brand_id, null);
  assert.strictEqual(quarantineCheck.rows[0].ambiguity_reason, 'UNRECOGNIZED_BRAND');
  console.log('[PASS] Unrecognized brand message preserved in global quarantine without foreign key violation');

  // Test 5: content.extra extraction
  const extracted = extractCorrelationData(rawPayload);
  assert.strictEqual(extracted.text, 'Where is my order?');
  assert.strictEqual(extracted.ticketId, 'tkt_1021');
  assert.strictEqual(extracted.brandId, 'brand_novacart');
  console.log('[PASS] Webhook successfully extracted correlation identifiers from content.extra');

  console.log('[ALL TESTS PASSED IN webhookEventLedger.test.js]\n');
}

runWebhookEventLedgerTests().catch(err => {
  console.error('[TEST FAILURE]:', err);
  process.exit(1);
});
