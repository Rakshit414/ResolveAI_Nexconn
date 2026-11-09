import crypto from 'crypto';
import { query } from '../db/pool.js';
import { sendDirectChannelMessage } from './nexconnApiClient.js';

const WORKER_ID = `outbox_worker_${process.pid}_${crypto.randomBytes(4).toString('hex')}`;

/**
 * Process a single pending or expired outbox message with row-level leasing
 */
export async function processNextOutboxJob() {
  const isDedicatedPostgres = Boolean(process.env.DATABASE_URL);
  const skipLocked = isDedicatedPostgres ? 'FOR UPDATE SKIP LOCKED' : '';

  // Acquire next available job with a 30-second lease
  const acquireSql = `
    UPDATE outbox_messages
    SET 
      dispatch_status = 'dispatching',
      worker_id = $1,
      locked_at = NOW(),
      lease_expires_at = NOW() + INTERVAL '30 seconds',
      attempt_count = attempt_count + 1
    WHERE id = (
      SELECT id FROM outbox_messages
      WHERE (dispatch_status = 'pending' AND next_attempt_at <= NOW())
         OR (dispatch_status = 'dispatching' AND lease_expires_at < NOW())
      ORDER BY created_at ASC
      LIMIT 1
      ${skipLocked}
    )
    RETURNING *;
  `;

  const jobRes = await query(acquireSql, [WORKER_ID]);
  if (!jobRes.rows || jobRes.rows.length === 0) {
    return null; // No jobs ready
  }

  const job = jobRes.rows[0];

  try {
    // 1. Authoritative participant validation
    const mappingRes = await query(
      `SELECT customer_user_id, support_identity 
       FROM conversation_mappings 
       WHERE brand_id = $1 AND id = $2`,
      [job.brand_id, job.conversation_mapping_id]
    );

    if (mappingRes.rows.length === 0) {
      await query(
        `UPDATE outbox_messages 
         SET dispatch_status = 'failed', 
             last_error = 'Authoritative conversation mapping not found' 
         WHERE id = $1`,
        [job.id]
      );
      return { id: job.id, status: 'failed', error: 'Missing mapping' };
    }

    const mapping = mappingRes.rows[0];

    // Strictly validate sender and target match authoritative mapping
    if (job.sender_user_id !== mapping.support_identity || job.target_user_id !== mapping.customer_user_id) {
      await query(
        `UPDATE outbox_messages 
         SET dispatch_status = 'failed', 
             last_error = $1 
         WHERE id = $2`,
        [`Participant mismatch: outbox (${job.sender_user_id} -> ${job.target_user_id}) does not match conversation (${mapping.support_identity} -> ${mapping.customer_user_id})`, job.id]
      );
      return { id: job.id, status: 'failed', error: 'Participant mismatch' };
    }

    // 2. Dispatch via official signed API client
    const correlationData = {
      ticketId: job.ticket_id,
      outboxId: job.id,
      brandId: job.brand_id
    };

    const dispatchRes = await sendDirectChannelMessage({
      fromUserId: job.sender_user_id,
      toUserId: job.target_user_id,
      messageType: job.message_type,
      content: job.message_text,
      correlationData,
      topLevelMetadata: Object.keys(job.metadata || {}).length ? job.metadata : null
    });

    if (dispatchRes.success && dispatchRes.messageId) {
      // 3. Success state
      await query(
        `UPDATE outbox_messages
         SET dispatch_status = 'dispatched',
             nexconn_message_id = $1,
             dispatched_at = NOW(),
             last_error = NULL
         WHERE id = $2`,
        [dispatchRes.messageId, job.id]
      );

      // Append to message_archive
      await query(
        `INSERT INTO message_archive (
           id, brand_id, ticket_id, nexconn_message_id, sender_user_id, target_user_id, 
           sender_role, sender_name, message_type, message_text, content_payload
         )
         VALUES ($1, $2, $3, $4, $5, $6, 'agent', 'Support Agent', $7, $8, $9)
         ON CONFLICT (nexconn_message_id) DO NOTHING`,
        [
          `arch_${job.id}`,
          job.brand_id,
          job.ticket_id,
          dispatchRes.messageId,
          job.sender_user_id,
          job.target_user_id,
          job.message_type,
          job.message_text,
          JSON.stringify({ content: job.message_text, extra: correlationData })
        ]
      );

      return { id: job.id, status: 'dispatched', messageId: dispatchRes.messageId };
    }

    if (dispatchRes.isNetworkTimeout) {
      // 4. Uncertain state: network timed out after sending bytes
      console.warn(`[Outbox] Job ${job.id} timed out awaiting response; transitioning to UNCERTAIN`);
      await query(
        `UPDATE outbox_messages
         SET dispatch_status = 'uncertain',
             last_error = 'Network timeout awaiting Nexconn response; reconciliation required'
         WHERE id = $1`,
        [job.id]
      );
      return { id: job.id, status: 'uncertain' };
    }

    // 5. Standard failure retry
    const maxAttempts = job.max_attempts || 5;
    if (job.attempt_count >= maxAttempts) {
      await query(
        `UPDATE outbox_messages 
         SET dispatch_status = 'failed', 
             last_error = $1 
         WHERE id = $2`,
        [JSON.stringify(dispatchRes.error || 'Max attempts reached'), job.id]
      );
      return { id: job.id, status: 'failed' };
    }

    // Schedule retry with exponential backoff: 2^attempts * 2 seconds
    const backoffSeconds = Math.pow(2, job.attempt_count) * 2;
    await query(
      `UPDATE outbox_messages
       SET dispatch_status = 'pending',
           next_attempt_at = NOW() + ($1 || ' seconds')::INTERVAL,
           last_error = $2
       WHERE id = $3`,
      [backoffSeconds, JSON.stringify(dispatchRes.error || 'Dispatch error'), job.id]
    );

    return { id: job.id, status: 'pending', retryIn: backoffSeconds };
  } catch (err) {
    console.error(`[Outbox] Unexpected exception on job ${job.id}:`, err.message);
    await query(
      `UPDATE outbox_messages 
       SET dispatch_status = 'failed', 
           last_error = $1 
       WHERE id = $2`,
      [err.message, job.id]
    );
    return { id: job.id, status: 'failed', error: err.message };
  }
}

/**
 * Reconcile UNCERTAIN outbox jobs by inspecting webhook receipts and message archive
 */
export async function reconcileUncertainJobs() {
  const uncertainJobs = await query(`
    SELECT * FROM outbox_messages
    WHERE dispatch_status = 'uncertain'
    ORDER BY created_at ASC
    LIMIT 10
  `);

  const reconciled = [];

  for (const job of uncertainJobs.rows) {
    // Check if webhook_receipts or message_archive already captured this outboxId
    const checkReceipt = await query(`
      SELECT event_id, raw_payload FROM webhook_receipts
      WHERE raw_payload::text LIKE $1
      LIMIT 1
    `, [`%${job.id}%`]);

    if (checkReceipt.rows.length > 0) {
      const observedMsgId = checkReceipt.rows[0].event_id;
      console.log(`[Outbox Reconcile] Job ${job.id} confirmed delivered via webhook receipt ${observedMsgId}`);
      await query(`
        UPDATE outbox_messages
        SET dispatch_status = 'dispatched',
            nexconn_message_id = $1,
            dispatched_at = NOW(),
            last_error = 'Reconciled via webhook confirmation'
        WHERE id = $2
      `, [observedMsgId, job.id]);
      reconciled.push({ id: job.id, outcome: 'reconciled_dispatched', messageId: observedMsgId });
      continue;
    }

    // If no evidence after 2 minutes, return to pending retry
    const jobAgeRes = await query(`
      SELECT EXTRACT(EPOCH FROM (NOW() - locked_at)) AS age_seconds 
      FROM outbox_messages WHERE id = $1
    `, [job.id]);
    
    const ageSeconds = jobAgeRes.rows[0]?.age_seconds || 0;
    if (ageSeconds > 120 && job.attempt_count < (job.max_attempts || 5)) {
      console.log(`[Outbox Reconcile] Job ${job.id} had no evidence after 2m; re-queuing for retry`);
      await query(`
        UPDATE outbox_messages
        SET dispatch_status = 'pending',
            next_attempt_at = NOW(),
            last_error = 'Reconciled unconfirmed timeout; re-attempting'
        WHERE id = $1
      `, [job.id]);
      reconciled.push({ id: job.id, outcome: 'requeued_retry' });
    }
  }

  return reconciled;
}

export default {
  processNextOutboxJob,
  reconcileUncertainJobs
};
