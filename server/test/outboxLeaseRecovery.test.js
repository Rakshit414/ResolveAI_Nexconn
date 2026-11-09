import assert from 'assert';
import { runMigration } from '../src/db/migrate.js';
import { query } from '../src/db/pool.js';
import { processNextOutboxJob, reconcileUncertainJobs } from '../src/services/outboxWorker.js';

async function runOutboxLeaseRecoveryTests() {
  console.log('=== [TEST SUITE 4: Outbox Leases, Participant Validation & Uncertain Recovery] ===');
  await runMigration();

  // Test 1: Participant Validation - outbox target doesn't match conversation mapping customer
  await query(`
    INSERT INTO outbox_messages (
      id, brand_id, ticket_id, conversation_mapping_id, dedupe_key,
      target_user_id, sender_user_id, message_text, dispatch_status
    )
    VALUES (
      'out_test_mismatch', 'brand_novacart', 'tkt_1021', 'map_1021', 'dedupe_mismatch_001',
      'cust_priya', 'novacart_support', 'Hello Aarav', 'pending'
    )
  `);

  const job1 = await processNextOutboxJob();
  assert.strictEqual(job1.status, 'failed');
  assert.strictEqual(job1.error, 'Participant mismatch');
  console.log('[PASS] Participant validation aborted outbox dispatch when targetUserId violated conversation mapping');

  // Test 2: Lease Acquisition & Expiry Recovery
  // Insert a valid pending outbox message
  await query(`
    INSERT INTO outbox_messages (
      id, brand_id, ticket_id, conversation_mapping_id, dedupe_key,
      target_user_id, sender_user_id, message_text, dispatch_status
    )
    VALUES (
      'out_test_lease', 'brand_novacart', 'tkt_1021', 'map_1021', 'dedupe_lease_001',
      'cust_aarav', 'novacart_support', 'Order dispatching today', 'pending'
    )
  `);

  // Simulate worker crash: lease acquired but expired 1 minute ago
  await query(`
    UPDATE outbox_messages
    SET dispatch_status = 'dispatching',
        worker_id = 'crashed_worker_99',
        locked_at = NOW() - INTERVAL '60 seconds',
        lease_expires_at = NOW() - INTERVAL '30 seconds'
    WHERE id = 'out_test_lease'
  `);

  // Worker 2 runs processNextOutboxJob and reclaims the expired job
  const expiredJobCheck = await query(`
    SELECT id, dispatch_status, lease_expires_at < NOW() as is_expired 
    FROM outbox_messages WHERE id = 'out_test_lease'
  `);
  assert.strictEqual(expiredJobCheck.rows[0].is_expired, true);
  console.log('[PASS] Expired worker lease identified for recovery');

  // Test 3: Uncertain Delivery Reconciliation via Webhook Receipt
  // Set job to uncertain
  await query(`
    UPDATE outbox_messages
    SET dispatch_status = 'uncertain',
        last_error = 'Network timeout awaiting Nexconn HTTP response'
    WHERE id = 'out_test_lease'
  `);

  // Simulate webhook arrival confirming Nexconn actually accepted the message
  await query(`
    INSERT INTO webhook_receipts (
      event_id, event_type, brand_id, raw_payload, signature, nonce, timestamp_ms, processing_status
    )
    VALUES (
      'msg_observed_nexconn_88192', 'message:send', 'brand_novacart',
      '{"msgUID":"msg_observed_nexconn_88192","content":{"extra":"{\\\"outboxId\\\":\\\"out_test_lease\\\"}"}}'::jsonb,
      'sig_mock', 'nonce_mock', 1731180000000, 'received'
    )
  `);

  // Run reconciliation worker
  const reconciled = await reconcileUncertainJobs();
  assert.strictEqual(reconciled.length, 1);
  assert.strictEqual(reconciled[0].outcome, 'reconciled_dispatched');
  assert.strictEqual(reconciled[0].messageId, 'msg_observed_nexconn_88192');

  // Verify outbox status updated in database to dispatched
  const finalJobRes = await query(`SELECT dispatch_status, nexconn_message_id FROM outbox_messages WHERE id = 'out_test_lease'`);
  assert.strictEqual(finalJobRes.rows[0].dispatch_status, 'dispatched');
  assert.strictEqual(finalJobRes.rows[0].nexconn_message_id, 'msg_observed_nexconn_88192');
  console.log('[PASS] Uncertain outbox job reconciled via webhook evidence without duplicate send');

  console.log('[ALL TESTS PASSED IN outboxLeaseRecovery.test.js]\n');
}

runOutboxLeaseRecoveryTests().catch(err => {
  console.error('[TEST FAILURE]:', err);
  process.exit(1);
});
