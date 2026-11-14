// server/src/services/routingService.js
import { getPool } from '../db/pool.js';
import { translationBreaker } from './translationCircuitBreaker.js';

export async function assignQueuedTicketAtomically(brandId, { client: externalClient = null, translationAvailable = null } = {}) {
  const pool = getPool();
  const client = externalClient || await pool.connect();
  const shouldManageTransaction = !externalClient;

  try {
    if (shouldManageTransaction) await client.query('BEGIN');

    // Step 1 of Global Lock Hierarchy: Lock the candidate ticket row first
    const ticketRes = await client.query(`
      SELECT t.id, t.brand_id, t.customer_id, t.status, t.assigned_agent_id
      FROM tickets t
      WHERE t.brand_id = $1
        AND EXISTS (
          SELECT 1 FROM ticket_routing_queue q
          WHERE q.brand_id = t.brand_id
            AND q.ticket_id = t.id
            AND q.status = 'queued'
            AND q.next_routing_attempt_at <= NOW()
        )
      ORDER BY (
          SELECT
            (CASE q.priority
                WHEN 'Critical' THEN 10000 + LEAST(EXTRACT(EPOCH FROM (NOW() - q.queued_at)) * 5.0, 5000)
                WHEN 'High'     THEN 5000  + LEAST(EXTRACT(EPOCH FROM (NOW() - q.queued_at)) * 2.0, 2500)
                WHEN 'Medium'   THEN 2000  + LEAST(EXTRACT(EPOCH FROM (NOW() - q.queued_at)) * 1.0, 3500)
                ELSE                 500   + LEAST(EXTRACT(EPOCH FROM (NOW() - q.queued_at)) * 0.5, 2000)
             END)
          FROM ticket_routing_queue q
          WHERE q.brand_id = t.brand_id AND q.ticket_id = t.id AND q.status = 'queued'
          LIMIT 1
      ) DESC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `, [brandId]);

    if (ticketRes.rows.length === 0) {
      if (shouldManageTransaction) await client.query('COMMIT');
      return { assigned: false, reason: 'NO_DUE_QUEUED_TICKETS' };
    }

    const lockedTicket = ticketRes.rows[0];

    // Step 2 of Global Lock Hierarchy: Lock corresponding queue row
    const queueRes = await client.query(`
      SELECT q.id AS queue_id, q.ticket_id, q.brand_id, q.priority, q.customer_language, q.required_skills
      FROM ticket_routing_queue q
      WHERE q.brand_id = $1
        AND q.ticket_id = $2
        AND q.status = 'queued'
      FOR UPDATE
    `, [brandId, lockedTicket.id]);

    if (queueRes.rows.length === 0) {
      if (shouldManageTransaction) await client.query('COMMIT');
      return { assigned: false, reason: 'QUEUE_ROW_NOT_AVAILABLE' };
    }

    const lockedQueue = queueRes.rows[0];

    // Check translation operational status strictly (CLOSED only, never consumes probe slot)
    const isTranslationAvailable = (translationAvailable !== null)
      ? Boolean(translationAvailable)
      : translationBreaker.isOperational();

    // Step 3 of Global Lock Hierarchy: Lock candidate agent profile row
    // Evaluates against the Justified 5-Tier Matching Hierarchy
    const candidateRes = await client.query(`
      SELECT
        ap.user_id,
        ap.active_ticket_count,
        ap.max_concurrent_tickets,
        ap.configured_status,
        ap.last_heartbeat_at
      FROM agent_profiles ap
      JOIN brand_memberships bm
        ON ap.brand_id = bm.brand_id AND ap.user_id = bm.user_id
      JOIN brands b
        ON ap.brand_id = b.id
      CROSS JOIN (
        SELECT $2::TEXT[] AS required_skills, $3::TEXT AS customer_language, $4::BOOLEAN AS translation_online
      ) req
      WHERE ap.brand_id = $1
        AND ap.configured_status = 'Available'
        AND ap.active_ticket_count < ap.max_concurrent_tickets
        AND ap.last_heartbeat_at > NOW() - INTERVAL '120 seconds'
        AND bm.deactivated_at IS NULL
        AND bm.role IN ('agent', 'support_lead', 'admin')
        AND (
          -- TIER 1: Direct Specialist + Native Language (Native speaker of customer locale)
          (cardinality(req.required_skills) > 0 AND req.required_skills <@ ap.skills AND req.customer_language = ANY(ap.supported_languages))
          OR
          -- TIER 2: Direct Specialist + English Bridge (Enabled ONLY if translation service is CLOSED)
          (req.translation_online = TRUE AND cardinality(req.required_skills) > 0 AND req.required_skills <@ ap.skills AND 'en-US' = ANY(ap.supported_languages))
          OR
          -- TIER 3: Partial Specialist Overlap + Native Language (At least 1 specialized skill match)
          (cardinality(req.required_skills) > 0 AND req.required_skills && ap.skills AND req.customer_language = ANY(ap.supported_languages))
          OR
          -- TIER 4: Partial Specialist Overlap + English Bridge (Enabled ONLY if translation service is CLOSED)
          (req.translation_online = TRUE AND cardinality(req.required_skills) > 0 AND req.required_skills && ap.skills AND 'en-US' = ANY(ap.supported_languages))
          OR
          -- TIER 5: Generalist Fallback (Empty skills or allow_general_fallback = TRUE)
          (
            (cardinality(req.required_skills) = 0 OR 'general_inquiry' = ANY(req.required_skills) OR b.allow_general_fallback = TRUE)
            AND 'general_inquiry' = ANY(ap.skills)
            AND (req.customer_language = ANY(ap.supported_languages) OR (req.translation_online = TRUE AND 'en-US' = ANY(ap.supported_languages)))
          )
        )
      ORDER BY
        (CASE
            WHEN (cardinality(req.required_skills) > 0 AND req.required_skills <@ ap.skills AND req.customer_language = ANY(ap.supported_languages)) THEN 1
            WHEN (req.translation_online = TRUE AND cardinality(req.required_skills) > 0 AND req.required_skills <@ ap.skills AND 'en-US' = ANY(ap.supported_languages)) THEN 2
            WHEN (cardinality(req.required_skills) > 0 AND req.required_skills && ap.skills AND req.customer_language = ANY(ap.supported_languages)) THEN 3
            WHEN (req.translation_online = TRUE AND cardinality(req.required_skills) > 0 AND req.required_skills && ap.skills AND 'en-US' = ANY(ap.supported_languages)) THEN 4
            ELSE 5
         END) ASC,
        (ap.active_ticket_count::FLOAT / ap.max_concurrent_tickets::FLOAT) ASC,
        ap.last_assigned_at ASC NULLS FIRST,
        ap.user_id ASC
      LIMIT 1
      FOR UPDATE OF ap SKIP LOCKED
    `, [brandId, lockedQueue.required_skills, lockedQueue.customer_language, isTranslationAvailable]);

    if (candidateRes.rows.length === 0) {
      // Back off unassignable ticket to prevent head-of-line blocking
      await client.query(`
        UPDATE ticket_routing_queue
        SET
          retry_count = retry_count + 1,
          next_routing_attempt_at = NOW() + (INTERVAL '15 seconds' * LEAST(retry_count + 1, 4))
        WHERE id = $1
      `, [lockedQueue.queue_id]);

      if (shouldManageTransaction) await client.query('COMMIT');
      return { assigned: false, reason: 'NO_ELIGIBLE_AGENT_AVAILABLE' };
    }

    const selectedAgent = candidateRes.rows[0];

    // Invariant recheck under lock
    if (
      selectedAgent.configured_status !== 'Available' ||
      selectedAgent.active_ticket_count >= selectedAgent.max_concurrent_tickets ||
      !selectedAgent.last_heartbeat_at ||
      new Date(selectedAgent.last_heartbeat_at).getTime() < Date.now() - 120000
    ) {
      if (shouldManageTransaction) await client.query('ROLLBACK');
      return { assigned: false, reason: 'CONCURRENT_CAPACITY_SLOT_CONSUMED' };
    }

    // Atomically update agent capacity, ticket assignment, and queue status
    const agentUpd = await client.query(`
      UPDATE agent_profiles
      SET active_ticket_count = active_ticket_count + 1, last_assigned_at = NOW(), updated_at = NOW()
      WHERE brand_id = $1 AND user_id = $2
    `, [brandId, selectedAgent.user_id]);

    const ticketUpd = await client.query(`
      UPDATE tickets
      SET assigned_agent_id = $1, status = 'Human Agent Active', last_updated = NOW()
      WHERE brand_id = $2 AND id = $3
    `, [selectedAgent.user_id, brandId, lockedTicket.id]);

    const queueUpd = await client.query(`
      UPDATE ticket_routing_queue
      SET status = 'assigned', assigned_agent_id = $1, assigned_at = NOW(),
          routing_lease_token = NULL, routing_lease_expires_at = NULL
      WHERE id = $2
    `, [selectedAgent.user_id, lockedQueue.queue_id]);

    // Invariant: Verify exactly one row was updated for each table
    if (agentUpd.rowCount !== 1 || ticketUpd.rowCount !== 1 || queueUpd.rowCount !== 1) {
      throw new Error(`Assignment invariant failed: row count mismatch (agent=${agentUpd.rowCount}, ticket=${ticketUpd.rowCount}, queue=${queueUpd.rowCount})`);
    }

    if (shouldManageTransaction) await client.query('COMMIT');
    return { assigned: true, ticketId: lockedTicket.id, agentId: selectedAgent.user_id };
  } catch (err) {
    if (shouldManageTransaction) await client.query('ROLLBACK');
    throw err;
  } finally {
    if (shouldManageTransaction) client.release();
  }
}

export default {
  assignQueuedTicketAtomically
};
