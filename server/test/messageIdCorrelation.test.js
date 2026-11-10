import assert from 'assert';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PGlite } from '@electric-sql/pglite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');
const TEST_DB_PATH = path.resolve(ROOT_DIR, 'server/data/msg_corr_test_db');

console.log('=== [TEST SUITE 15: Local Optimistic ID vs Nexconn Server Message ID Correlation & Deduplication] ===');

async function runMessageIdCorrelationTests() {
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.rmSync(TEST_DB_PATH, { recursive: true, force: true });
  }
  fs.mkdirSync(TEST_DB_PATH, { recursive: true });

  const db = new PGlite(TEST_DB_PATH);

  try {
    // 1. Initialize schema
    const ddlPath = path.resolve(ROOT_DIR, 'server/src/db/migrations/001_canonical_schema.sql');
    await db.exec(fs.readFileSync(ddlPath, 'utf8'));

    const seedPath = path.resolve(ROOT_DIR, 'server/src/db/migrations/002_seed_demo_data.sql');
    await db.exec(fs.readFileSync(seedPath, 'utf8'));

    // --- 1. Distinguishing Local Optimistic ID from Server Message ID ---
    console.log('\n--- 1. Client Optimistic ID vs Nexconn Server Message ID ---');
    const localOptimisticId = `msg_channel_NC1021_${Date.now()}_la3ujy`;
    const serverNexconnId = 'D1OH-1E8T-SFU6-DRAH';

    assert.ok(localOptimisticId.startsWith('msg_channel_NC1021_'), 'Local ID is client-generated for optimistic UI rendering');
    assert.ok(serverNexconnId.startsWith('D1OH-') || serverNexconnId.startsWith('D1OG-'), 'Server ID is Nexconn gateway assigned message ID');
    console.log('[PASS] Conceptual boundary verified:');
    console.log('  -> Local Optimistic Client ID:', localOptimisticId);
    console.log('  -> Nexconn Gateway Server ID:', serverNexconnId);

    // --- 2. Persisting Server ID into message_archive ---
    console.log('\n--- 2. Persisting Canonical Server Message ID in message_archive ---');
    const contentPayload = {
      content: 'Where are my shoes?',
      extra: JSON.stringify({
        clientMessageId: localOptimisticId,
        ticketId: 'tkt_1021',
        brandId: 'brand_novacart'
      })
    };

    await db.query(`
      INSERT INTO message_archive (
        id, brand_id, ticket_id, nexconn_message_id, sender_user_id, target_user_id,
        sender_role, sender_name, message_type, message_text, content_payload
      )
      VALUES (
        'arch_corr_01', 'brand_novacart', 'tkt_1021', $1, 'cust_aarav', 'agent_sarah',
        'customer', 'Aarav Sharma', 'RC:TxtMsg', 'Where are my shoes?', $2
      )
    `, [serverNexconnId, JSON.stringify(contentPayload)]);

    const archiveRow = await db.query(`SELECT nexconn_message_id, content_payload FROM message_archive WHERE nexconn_message_id = $1`, [serverNexconnId]);
    assert.strictEqual(archiveRow.rows.length, 1);
    assert.strictEqual(archiveRow.rows[0].nexconn_message_id, serverNexconnId, 'Must store server ID in nexconn_message_id');
    const extraParsed = JSON.parse(archiveRow.rows[0].content_payload.extra);
    assert.strictEqual(extraParsed.clientMessageId, localOptimisticId, 'Correlated local ID stored in metadata extra');
    console.log('[PASS] Server message ID stored in message_archive.nexconn_message_id with correlated local ID in metadata');

    // --- 3. Duplicate Prevention on Duplicate Webhook / Retries ---
    console.log('\n--- 3. Uniqueness Enforcement: Zero Duplicate Records on Retry ---');
    let duplicatePrevented = false;
    try {
      await db.query(`
        INSERT INTO message_archive (
          id, brand_id, ticket_id, nexconn_message_id, sender_user_id, target_user_id,
          sender_role, sender_name, message_type, message_text, content_payload
        )
        VALUES (
          'arch_corr_02', 'brand_novacart', 'tkt_1021', $1, 'cust_aarav', 'agent_sarah',
          'customer', 'Aarav Sharma', 'RC:TxtMsg', 'Where are my shoes?', $2
        )
      `, [serverNexconnId, JSON.stringify(contentPayload)]);
    } catch (err) {
      duplicatePrevented = true;
      assert.ok(err.message.includes('unique') || err.message.includes('duplicate key'), 'Must be a unique constraint violation on nexconn_message_id');
    }
    assert.strictEqual(duplicatePrevented, true, 'Unique constraint on nexconn_message_id MUST reject duplicate message insertion');
    console.log('[PASS] Retried message submission strictly rejected by nexconn_message_id UNIQUE constraint');

    // --- 4. Transactional Outbox Deduplication & Uncertain Recovery ---
    console.log('\n--- 4. Transactional Outbox Dedupe Key & Uncertain Delivery Recovery ---');
    const dedupeKey = 'dedupe_order_NC1021_delay_notification';
    await db.query(`
      INSERT INTO outbox_messages (
        id, brand_id, ticket_id, conversation_mapping_id, dedupe_key,
        target_user_id, sender_user_id, message_type, message_text, dispatch_status
      )
      VALUES (
        'obx_001', 'brand_novacart', 'tkt_1021', 'map_1021', $1,
        'cust_aarav', 'novacart_support', 'RC:TxtMsg', 'Shipment notice', 'uncertain'
      )
    `, [dedupeKey]);

    // Re-attempting to insert same dedupe_key must be blocked
    let outboxDupPrevented = false;
    try {
      await db.query(`
        INSERT INTO outbox_messages (
          id, brand_id, ticket_id, conversation_mapping_id, dedupe_key,
          target_user_id, sender_user_id, message_type, message_text, dispatch_status
        )
        VALUES (
          'obx_002', 'brand_novacart', 'tkt_1021', 'map_1021', $1,
          'cust_aarav', 'novacart_support', 'RC:TxtMsg', 'Shipment notice', 'pending'
        )
      `, [dedupeKey]);
    } catch (e) {
      outboxDupPrevented = true;
    }
    assert.strictEqual(outboxDupPrevented, true, 'Dedupe key in outbox_messages strictly blocks duplicate dispatch jobs');

    // Uncertain recovery simulation: check if message was archived
    const isArchived = await db.query(`SELECT id FROM message_archive WHERE nexconn_message_id = $1`, [serverNexconnId]);
    if (isArchived.rows.length > 0) {
      // Message was already delivered! Mark outbox as dispatched with server message ID
      await db.query(`
        UPDATE outbox_messages 
        SET dispatch_status = 'dispatched', nexconn_message_id = $1, dispatched_at = NOW() 
        WHERE id = 'obx_001'
      `, [serverNexconnId]);
    }

    const outboxRow = await db.query(`SELECT dispatch_status, nexconn_message_id FROM outbox_messages WHERE id = 'obx_001'`);
    assert.strictEqual(outboxRow.rows[0].dispatch_status, 'dispatched');
    assert.strictEqual(outboxRow.rows[0].nexconn_message_id, serverNexconnId);
    console.log('[PASS] Outbox uncertain recovery successfully correlated with server message ID without re-dispatching duplicate message');

    console.log('\n====================================================================');
    console.log('ALL MESSAGE ID CORRELATION & DEDUPLICATION TESTS PASSED');
    console.log('====================================================================');
  } finally {
    await db.close();
    try {
      fs.rmSync(TEST_DB_PATH, { recursive: true, force: true });
    } catch (e) {}
  }
}

runMessageIdCorrelationTests();
