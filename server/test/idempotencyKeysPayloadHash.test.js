import assert from 'assert';
import crypto from 'crypto';
import { runMigration } from '../src/db/migrate.js';
import { query } from '../src/db/pool.js';
import { storageService } from '../src/services/storageService.js';

async function runIdempotencyTests() {
  console.log('=== [TEST SUITE 3: Request-Level Idempotency & Payload Hashing] ===');
  await runMigration();
  storageService.isPostgresMode = true;

  const idempotencyKey = 'idem_test_key_001';
  const customerA = { id: 'cust_aarav', name: 'Aarav Sharma', email: 'aarav.sharma@example.com' };
  
  const payload1 = {
    brandId: 'brand_novacart',
    customerId: 'cust_aarav',
    orderNumber: 'NC1021',
    category: 'Delivery Delay',
    priority: 'High',
    initialMessage: 'My sneakers are delayed.'
  };
  const hash1 = crypto.createHash('sha256').update(JSON.stringify(payload1)).digest('hex');

  // Step 1: Initial creation with idempotency key
  const res1 = await storageService.createTicket({
    brandId: payload1.brandId,
    customer: customerA,
    orderNumber: payload1.orderNumber,
    category: payload1.category,
    priority: payload1.priority,
    initialMessage: payload1.initialMessage,
    idempotencyKey,
    requestHash: hash1
  });

  assert.strictEqual(res1.cached, false);
  assert.strictEqual(res1.statusCode, 201);
  const ticketId1 = res1.data.ticketId;
  console.log('[PASS] Created initial ticket with idempotency key:', ticketId1);

  // Step 2: Retry with exact same idempotency key and exact same payload
  const res2 = await storageService.createTicket({
    brandId: payload1.brandId,
    customer: customerA,
    orderNumber: payload1.orderNumber,
    category: payload1.category,
    priority: payload1.priority,
    initialMessage: payload1.initialMessage,
    idempotencyKey,
    requestHash: hash1
  });

  assert.strictEqual(res2.cached, true);
  assert.strictEqual(res2.data.ticketId, ticketId1);
  console.log('[PASS] Idempotent retry returned cached response with zero duplicate creation');

  // Step 3: Attempt to reuse same idempotency key with a DIFFERENT payload
  const payload2 = {
    ...payload1,
    category: 'Return Request',
    initialMessage: 'Changed my mind completely.'
  };
  const hash2 = crypto.createHash('sha256').update(JSON.stringify(payload2)).digest('hex');

  let mismatchError = null;
  try {
    await storageService.createTicket({
      brandId: payload2.brandId,
      customer: customerA,
      orderNumber: payload2.orderNumber,
      category: payload2.category,
      priority: payload2.priority,
      initialMessage: payload2.initialMessage,
      idempotencyKey,
      requestHash: hash2
    });
  } catch (err) {
    mismatchError = err;
  }

  assert(mismatchError !== null, 'Expected payload mismatch error');
  assert.strictEqual(mismatchError.statusCode, 409);
  console.log('[PASS] Rejected idempotency key reuse with mismatched request payload (HTTP 409)');

  // Step 4: Verify database row count: ensure only 1 idempotency record exists for key
  const checkRes = await query(`
    SELECT COUNT(*) FROM idempotency_keys 
    WHERE brand_id = 'brand_novacart' AND idempotency_key = $1
  `, [idempotencyKey]);
  assert.strictEqual(Number(checkRes.rows[0].count), 1);
  console.log('[PASS] Verified exactly 1 idempotency record persisted');

  console.log('[ALL TESTS PASSED IN idempotencyKeysPayloadHash.test.js]\n');
}

runIdempotencyTests().catch(err => {
  console.error('[TEST FAILURE]:', err);
  process.exit(1);
});
