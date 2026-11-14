// server/src/services/outboxService.js
import crypto from 'crypto';
import { getPool } from '../db/pool.js';
import { processNextOutboxJob, reconcileUncertainJobs } from './outboxWorker.js';

/**
 * Records an immutable, append-only reconciliation audit record into the dedicated audit table
 * created canonically by Migration 005.
 */
export async function recordReconciliationAuditRecord({
  brandId,
  outboxId,
  operatorId,
  operatorRole,
  outcome,
  evidence,
  poolOrClient
}) {
  const runner = poolOrClient || getPool();
  const auditId = `aud_rec_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const res = await runner.query(`
    INSERT INTO outbox_reconciliation_audit (
      id, outbox_id, brand_id, operator_id, operator_role, outcome, evidence, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
    RETURNING id, outbox_id, brand_id, operator_id, operator_role, outcome, evidence, created_at
  `, [
    auditId,
    outboxId,
    brandId,
    operatorId || 'system',
    operatorRole || 'supervisor',
    outcome,
    typeof evidence === 'object' ? JSON.stringify(evidence) : (evidence || '')
  ]);
  return res.rows[0];
}

/**
 * Retrieves all immutable audit records for a given outbox job.
 */
export async function getOutboxReconciliationAuditRecords(outboxId, brandId) {
  const pool = getPool();
  const res = await pool.query(`
    SELECT * FROM outbox_reconciliation_audit
    WHERE outbox_id = $1 AND brand_id = $2
    ORDER BY created_at ASC
  `, [outboxId, brandId]);
  return res.rows;
}

/**
 * Enqueue an outbound customer message into the transactional outbox table.
 * Strictly verifies and uses the registered conversation mapping.
 */
export async function enqueueOutboundMessage({
  brandId,
  ticketId,
  senderUserId = null,
  targetUserId = null,
  messageText,
  messageType = 'RC:TxtMsg',
  dedupeKey = null,
  metadata = {},
  client: externalClient = null
}) {
  if (!brandId) throw new Error('brandId is required');
  if (!ticketId) throw new Error('ticketId is required');
  if (!messageText || !messageText.trim()) throw new Error('messageText is required');

  const pool = getPool();
  const client = externalClient || pool;

  // 1. Authoritative conversation mapping lookup
  const mappingRes = await client.query(`
    SELECT id, brand_id, ticket_id, customer_id, customer_user_id, support_identity, conversation_key
    FROM conversation_mappings
    WHERE brand_id = $1 AND ticket_id = $2
  `, [brandId, ticketId]);

  if (mappingRes.rows.length === 0) {
    const err = new Error(`No registered conversation mapping found for ticket ${ticketId}`);
    err.statusCode = 404;
    throw err;
  }

  const mapping = mappingRes.rows[0];

  // Canonical registered identities
  const canonicalSender = mapping.support_identity;
  const canonicalTarget = mapping.customer_user_id;

  if (senderUserId && senderUserId !== canonicalSender && !senderUserId.includes('support')) {
    metadata.authorAgentId = senderUserId;
  }

  if (targetUserId && targetUserId !== canonicalTarget) {
    const err = new Error(`Target user ID mismatch: supplied ${targetUserId} does not match conversation mapping ${canonicalTarget}`);
    err.statusCode = 400;
    throw err;
  }

  // Generate deterministic dedupeKey if not provided
  const canonicalDedupeKey = dedupeKey ||
    `outbox_${brandId}_${ticketId}_${crypto.createHash('sha256').update(`${canonicalSender}:${canonicalTarget}:${messageText}`).digest('hex').slice(0, 32)}`;

  const outboxId = `outbox_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

  // Insert into outbox_messages table (dedupe_key enforces idempotency)
  const insertRes = await client.query(`
    INSERT INTO outbox_messages (
      id, brand_id, ticket_id, conversation_mapping_id, dedupe_key,
      target_user_id, sender_user_id, message_type, message_text,
      content_payload, metadata, dispatch_status
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending'
    )
    ON CONFLICT (dedupe_key) DO UPDATE SET next_attempt_at = NOW()
    RETURNING *;
  `, [
    outboxId,
    brandId,
    ticketId,
    mapping.id,
    canonicalDedupeKey,
    canonicalTarget,
    canonicalSender,
    messageType,
    messageText,
    JSON.stringify({ content: messageText, extra: { ticketId, brandId, conversationKey: mapping.conversation_key } }),
    JSON.stringify(metadata)
  ]);

  // Update ticket last_updated timestamp
  await client.query(`
    UPDATE tickets SET last_updated = NOW() WHERE brand_id = $1 AND id = $2
  `, [brandId, ticketId]);

  return insertRes.rows[0];
}

/**
 * High-level agent reply API service.
 * Verifies agent authorization and ticket ownership before enqueueing outbox message.
 */
export async function sendAgentReply({
  brandId,
  ticketId,
  agentUserId,
  agentRole = 'agent',
  messageText,
  dedupeKey = null,
  client: externalClient = null
}) {
  if (!brandId) throw new Error('brandId is required');
  if (!ticketId) throw new Error('ticketId is required');
  if (!agentUserId) throw new Error('agentUserId is required');
  if (!messageText || !messageText.trim()) throw new Error('messageText cannot be empty');

  const pool = getPool();
  const client = externalClient || await pool.connect();
  const shouldManageTx = !externalClient;

  try {
    if (shouldManageTx) await client.query('BEGIN');

    // 1. Verify ticket ownership and status
    const ticketRes = await client.query(`
      SELECT id, brand_id, status, assigned_agent_id, customer_id
      FROM tickets
      WHERE brand_id = $1 AND id = $2
      FOR UPDATE
    `, [brandId, ticketId]);

    if (ticketRes.rows.length === 0) {
      const err = new Error(`Ticket ${ticketId} not found`);
      err.statusCode = 404;
      throw err;
    }

    const ticket = ticketRes.rows[0];

    if (ticket.status === 'Closed') {
      const err = new Error('Cannot send replies to a Closed ticket');
      err.statusCode = 400;
      throw err;
    }

    // 2. Authorization check: must be assigned agent, or support lead/admin
    const isAssigned = ticket.assigned_agent_id === agentUserId;
    const isSupervisor = ['support_lead', 'admin'].includes(agentRole);

    if (!isAssigned && !isSupervisor) {
      const err = new Error('Unauthorized: only the assigned agent or support leads can reply to this ticket');
      err.statusCode = 403;
      throw err;
    }

    // 3. Enqueue through secure outbox
    const outboxJob = await enqueueOutboundMessage({
      brandId,
      ticketId,
      senderUserId: agentUserId,
      messageText,
      dedupeKey,
      metadata: { authorAgentId: agentUserId, authorRole: agentRole },
      client
    });

    if (shouldManageTx) await client.query('COMMIT');

    // 4. Immediately attempt outbox dispatch
    const dispatchResult = await processNextOutboxJob();

    return {
      success: true,
      ticketId,
      outboxId: outboxJob.id,
      dedupeKey: outboxJob.dedupe_key,
      dispatchStatus: dispatchResult?.status || 'pending',
      messageId: dispatchResult?.messageId || null
    };
  } catch (err) {
    if (shouldManageTx) await client.query('ROLLBACK');
    throw err;
  } finally {
    if (shouldManageTx) client.release();
  }
}

/**
 * Safely sweep pending outbox messages on startup/wake.
 * 1. Calls reconcileUncertainJobs() to resolve any pending webhooks.
 * 2. Only processes messages where dispatch_status = 'pending' (or expired 'dispatching' leases).
 * 3. Never touches or redispatches 'uncertain' jobs!
 */
export async function sweepPendingOutboxJobs() {
  const reconcileRes = await reconcileUncertainJobs();
  let processed = 0;
  let job;
  // Bounded sweep: process up to 20 strictly pending jobs
  do {
    job = await processNextOutboxJob();
    if (job) processed++;
  } while (job && processed < 20);
  return { reconciledCount: reconcileRes.length, processedPendingCount: processed };
}

/**
 * Operations / Admin reporting service for unresolved uncertain outbox messages.
 * Audits message age, attempt counts, provider receipts, and last error.
 */
export async function getUncertainOutboxReport({ brandId = null, limit = 50 } = {}) {
  const pool = getPool();
  const res = await pool.query(`
    SELECT
      id,
      brand_id,
      ticket_id,
      conversation_mapping_id,
      dedupe_key,
      target_user_id,
      sender_user_id,
      message_type,
      message_text,
      dispatch_status,
      attempt_count,
      max_attempts,
      locked_at,
      lease_expires_at,
      next_attempt_at,
      last_error,
      created_at,
      EXTRACT(EPOCH FROM (NOW() - created_at))::INT AS age_seconds,
      EXISTS (
        SELECT 1 FROM webhook_receipts wr
        WHERE wr.raw_payload::text LIKE '%' || outbox_messages.id || '%'
           OR wr.raw_payload::text LIKE '%' || outbox_messages.dedupe_key || '%'
      ) AS has_webhook_evidence,
      EXISTS (
        SELECT 1 FROM message_archive ma
        WHERE ma.brand_id = outbox_messages.brand_id
          AND (ma.content_payload::text LIKE '%' || outbox_messages.id || '%' OR ma.id = 'arch_' || outbox_messages.id)
      ) AS has_archive_evidence
    FROM outbox_messages
    WHERE dispatch_status = 'uncertain'
      AND ($1::VARCHAR IS NULL OR brand_id = $1)
    ORDER BY created_at ASC
    LIMIT $2
  `, [brandId, limit]);

  return res.rows.map(row => ({
    id: row.id,
    brandId: row.brand_id,
    ticketId: row.ticket_id,
    targetUserId: row.target_user_id,
    senderUserId: row.sender_user_id,
    messageType: row.message_type,
    messagePreview: row.message_text ? row.message_text.slice(0, 100) : '',
    dispatchStatus: row.dispatch_status,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    ageSeconds: row.age_seconds,
    hasDeliveryEvidence: Boolean(row.has_webhook_evidence || row.has_archive_evidence),
    lastError: row.last_error,
    createdAt: row.created_at
  }));
}

/**
 * Safe manual reconciliation procedure.
 * STRICT SAFETY RULES:
 * - Never mark delivered without verified delivery evidence.
 * - Never resend an uncertain message without reliable proof of non-delivery.
 * - If forceFailWithEvidence is provided, requires non-empty verified reason.
 */
export async function manualReconcileOutboxJob({
  brandId,
  outboxId,
  forceFailWithEvidence = null,
  operatorUserId = null,
  operatorRole = null
}) {
  if (!brandId) throw new Error('brandId is required');
  if (!outboxId) throw new Error('outboxId is required');

  const pool = getPool();
  const jobRes = await pool.query(`
    SELECT * FROM outbox_messages
    WHERE id = $1 AND brand_id = $2
  `, [outboxId, brandId]);

  if (jobRes.rows.length === 0) {
    const err = new Error(`Outbox message ${outboxId} not found`);
    err.statusCode = 404;
    throw err;
  }

  const job = jobRes.rows[0];

  if (job.dispatch_status !== 'uncertain') {
    const err = new Error(`Cannot overwrite immutable audit record: outbox message ${job.id} is already in status '${job.dispatch_status}'`);
    err.statusCode = 409;
    throw err;
  }

  const operatorLabel = operatorUserId ? `${operatorUserId} (${operatorRole || 'supervisor'})` : 'authorized supervisor';

  // 1. Explicit verified non-delivery fail
  if (forceFailWithEvidence) {
    const evidenceStr = String(forceFailWithEvidence).trim();
    if (!evidenceStr) {
      const err = new Error('forceFailWithEvidence requires non-empty verified proof of non-delivery');
      err.statusCode = 400;
      throw err;
    }

    const auditDetail = `Manual operator termination by ${operatorLabel} with verified non-delivery proof: ${evidenceStr}`;
    const auditRecord = {
      operator_id: operatorUserId,
      operator_role: operatorRole,
      timestamp: new Date().toISOString(),
      outcome: 'marked_failed',
      evidence: evidenceStr
    };
    const auditMeta = {
      reconciled_by: operatorUserId,
      reconciled_role: operatorRole,
      reconciled_at: auditRecord.timestamp,
      reconciliation_outcome: 'marked_failed',
      reconciliation_evidence: evidenceStr
    };

    await pool.query(`
      UPDATE outbox_messages
      SET dispatch_status = 'failed',
          last_error = $1,
          metadata = jsonb_set(
            metadata || $2::jsonb,
            '{reconciliation_audit_trail}',
            COALESCE(metadata->'reconciliation_audit_trail', '[]'::jsonb) || jsonb_build_array($3::jsonb)
          )
      WHERE id = $4
    `, [auditDetail, JSON.stringify(auditMeta), JSON.stringify(auditRecord), job.id]);

    await recordReconciliationAuditRecord({
      brandId: job.brand_id,
      outboxId: job.id,
      operatorId: operatorUserId,
      operatorRole,
      outcome: 'marked_failed',
      evidence: evidenceStr,
      poolOrClient: pool
    });

    return {
      success: true,
      outboxId: job.id,
      dispatchStatus: 'failed',
      outcome: 'marked_failed',
      evidence: evidenceStr,
      reconciledBy: operatorUserId,
      operatorRole,
      auditTimestamp: auditMeta.reconciled_at
    };
  }

  // 2. Evidence-based reconciliation against webhook receipts
  const checkReceipt = await pool.query(`
    SELECT event_id, raw_payload FROM webhook_receipts
    WHERE raw_payload::text LIKE $1 OR raw_payload::text LIKE $2
    ORDER BY timestamp_ms DESC
    LIMIT 1
  `, [`%${job.id}%`, `%${job.dedupe_key}%`]);

  if (checkReceipt.rows.length > 0) {
    const observedMsgId = checkReceipt.rows[0].event_id;
    const auditDetail = `Manually reconciled by ${operatorLabel} via verified webhook evidence`;
    const auditRecord = {
      operator_id: operatorUserId,
      operator_role: operatorRole,
      timestamp: new Date().toISOString(),
      outcome: 'reconciled_dispatched',
      evidence_source: 'webhook_receipts',
      observed_message_id: observedMsgId
    };
    const auditMeta = {
      reconciled_by: operatorUserId,
      reconciled_role: operatorRole,
      reconciled_at: auditRecord.timestamp,
      reconciliation_outcome: 'reconciled_dispatched',
      evidence_source: 'webhook_receipts',
      observed_message_id: observedMsgId
    };

    await pool.query(`
      UPDATE outbox_messages
      SET dispatch_status = 'dispatched',
          nexconn_message_id = $1,
          dispatched_at = NOW(),
          last_error = $2,
          metadata = jsonb_set(
            metadata || $3::jsonb,
            '{reconciliation_audit_trail}',
            COALESCE(metadata->'reconciliation_audit_trail', '[]'::jsonb) || jsonb_build_array($4::jsonb)
          )
      WHERE id = $5
    `, [observedMsgId, auditDetail, JSON.stringify(auditMeta), JSON.stringify(auditRecord), job.id]);

    await recordReconciliationAuditRecord({
      brandId: job.brand_id,
      outboxId: job.id,
      operatorId: operatorUserId,
      operatorRole,
      outcome: 'reconciled_dispatched',
      evidence: `webhook_receipts: observed message ${observedMsgId}`,
      poolOrClient: pool
    });

    return {
      success: true,
      outboxId: job.id,
      dispatchStatus: 'dispatched',
      outcome: 'reconciled_dispatched',
      messageId: observedMsgId,
      evidenceSource: 'webhook_receipts',
      reconciledBy: operatorUserId,
      operatorRole,
      auditTimestamp: auditMeta.reconciled_at
    };
  }

  // 3. Evidence-based reconciliation against message archive
  const checkArchive = await pool.query(`
    SELECT nexconn_message_id FROM message_archive
    WHERE brand_id = $1 AND (content_payload::text LIKE $2 OR id = $3)
    LIMIT 1
  `, [job.brand_id, `%${job.id}%`, `arch_${job.id}`]);

  if (checkArchive.rows.length > 0 && checkArchive.rows[0].nexconn_message_id) {
    const confirmedMsgId = checkArchive.rows[0].nexconn_message_id;
    const auditDetail = `Manually reconciled by ${operatorLabel} via verified message archive evidence`;
    const auditRecord = {
      operator_id: operatorUserId,
      operator_role: operatorRole,
      timestamp: new Date().toISOString(),
      outcome: 'reconciled_dispatched',
      evidence_source: 'message_archive',
      confirmed_message_id: confirmedMsgId
    };
    const auditMeta = {
      reconciled_by: operatorUserId,
      reconciled_role: operatorRole,
      reconciled_at: auditRecord.timestamp,
      reconciliation_outcome: 'reconciled_dispatched',
      evidence_source: 'message_archive',
      confirmed_message_id: confirmedMsgId
    };

    await pool.query(`
      UPDATE outbox_messages
      SET dispatch_status = 'dispatched',
          nexconn_message_id = $1,
          dispatched_at = NOW(),
          last_error = $2,
          metadata = jsonb_set(
            metadata || $3::jsonb,
            '{reconciliation_audit_trail}',
            COALESCE(metadata->'reconciliation_audit_trail', '[]'::jsonb) || jsonb_build_array($4::jsonb)
          )
      WHERE id = $5
    `, [confirmedMsgId, auditDetail, JSON.stringify(auditMeta), JSON.stringify(auditRecord), job.id]);

    await recordReconciliationAuditRecord({
      brandId: job.brand_id,
      outboxId: job.id,
      operatorId: operatorUserId,
      operatorRole,
      outcome: 'reconciled_dispatched',
      evidence: `message_archive: confirmed message ${confirmedMsgId}`,
      poolOrClient: pool
    });

    return {
      success: true,
      outboxId: job.id,
      dispatchStatus: 'dispatched',
      outcome: 'reconciled_dispatched',
      messageId: confirmedMsgId,
      evidenceSource: 'message_archive',
      reconciledBy: operatorUserId,
      operatorRole,
      auditTimestamp: auditMeta.reconciled_at
    };
  }

  // 4. Strict Safety Enforcement: NO EVIDENCE = PRESERVE UNCERTAIN
  // Never mark delivered without evidence, and never resend!
  await pool.query(`
    UPDATE outbox_messages
    SET last_error = 'Manual audit check: zero delivery evidence found; preserved in uncertain status to prevent duplicate customer message'
    WHERE id = $1
  `, [job.id]);

  return {
    success: true,
    outboxId: job.id,
    dispatchStatus: 'uncertain',
    outcome: 'preserved_uncertain',
    message: 'Zero delivery receipts or archive matches found. Preserved in UNCERTAIN status to prevent duplicate sends.'
  };
}

export { processNextOutboxJob, reconcileUncertainJobs };

export default {
  enqueueOutboundMessage,
  sendAgentReply,
  processNextOutboxJob,
  reconcileUncertainJobs,
  sweepPendingOutboxJobs,
  getUncertainOutboxReport,
  manualReconcileOutboxJob
};
