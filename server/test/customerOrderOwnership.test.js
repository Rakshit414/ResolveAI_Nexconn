import assert from 'assert';
import { runMigration } from '../src/db/migrate.js';
import { query } from '../src/db/pool.js';

async function runCustomerOrderOwnershipTests() {
  console.log('=== [TEST SUITE 1: Customer-Order Ownership Constraints] ===');
  
  // 1. Initialize schema and seed data
  await runMigration();

  // Test 1: Verify Aarav's valid ticket references Aarav's order
  const validRes = await query(`
    SELECT id, customer_id, order_id 
    FROM tickets 
    WHERE id = 'tkt_1021'
  `);
  assert.strictEqual(validRes.rows.length, 1);
  assert.strictEqual(validRes.rows[0].customer_id, 'cust_aarav');
  assert.strictEqual(validRes.rows[0].order_id, 'ord_1021');
  console.log('[PASS] Valid ticket tkt_1021 correctly links cust_aarav with ord_1021');

  // Test 2: Attempt to insert a ticket with Aarav (cust_aarav) and Priya's order (ord_1022)
  let crossCustomerError = null;
  try {
    await query(`
      INSERT INTO tickets (id, brand_id, customer_id, order_id, category, priority, status)
      VALUES ('tkt_invalid_cross', 'brand_novacart', 'cust_aarav', 'ord_1022', 'Fraud Attempt', 'High', 'AI Handling')
    `);
  } catch (err) {
    crossCustomerError = err;
  }

  assert(crossCustomerError !== null, 'Expected cross-customer order insertion to be rejected');
  console.log('[PASS] Rejected cross-customer order insertion:', crossCustomerError.message);

  // Test 3: Attempt to insert a ticket with Kabir (cust_kabir) and Aarav's order (ord_1021)
  let crossCustomerError2 = null;
  try {
    await query(`
      INSERT INTO tickets (id, brand_id, customer_id, order_id, category, priority, status)
      VALUES ('tkt_invalid_cross2', 'brand_novacart', 'cust_kabir', 'ord_1021', 'Fraud Attempt', 'High', 'AI Handling')
    `);
  } catch (err) {
    crossCustomerError2 = err;
  }

  assert(crossCustomerError2 !== null, 'Expected cross-customer order insertion to be rejected');
  console.log('[PASS] Rejected second cross-customer order insertion:', crossCustomerError2.message);

  console.log('[ALL TESTS PASSED IN customerOrderOwnership.test.js]\n');
}

runCustomerOrderOwnershipTests().catch(err => {
  console.error('[TEST FAILURE]:', err);
  process.exit(1);
});
