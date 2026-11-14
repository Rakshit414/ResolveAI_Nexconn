// server/src/services/queueService.js
import crypto from 'crypto';
import { getPool } from '../db/pool.js';
import { dispatchSchedulingOpportunity } from './multiTenantScheduler.js';

export async function enqueueOrReopenTicket({
  brandId,
  ticketId,
  customerId = null,
  priority = 'Medium',
  customerLanguage = 'en-US',
  requiredSkills = [],
  client: externalClient = null
}) {
  const pool = getPool();
  const client = externalClient || await pool.connect();
  const shouldManageTransaction = !externalClient;

  try {
    if (shouldManageTransaction) await client.query('BEGIN');

    // Step 1 of Global Lock Hierarchy: Lock ticket row explicitly
    const ticketLock = await client.query(`
      SELECT id, status, customer_id, assigned_agent_id, category, last_updated
      FROM tickets
      WHERE brand_id = $1 AND id = $2
      FOR UPDATE
    `, [brandId, ticketId]);

    if (ticketLock.rows.length === 0) {
      const err = new Error(`Ticket not found: ${ticketId}`);
      err.statusCode = 404;
      throw err;
    }

    const ticketRow = ticketLock.rows[0];
    const canonicalCustomerId = ticketRow.customer_id;

    // Validate supplied customerId against canonical ticket row
    if (customerId && customerId !== canonicalCustomerId) {
      const err = new Error(`Customer ID mismatch: supplied ${customerId} does not match ticket customer ${canonicalCustomerId}`);
      err.statusCode = 400;
      throw err;
    }

    // Normalize empty skills to ['general_inquiry']
    const normalizedSkills = Array.isArray(requiredSkills) && requiredSkills.length > 0
      ? requiredSkills
      : ['general_inquiry'];

    // 14-DAY LIFECYCLE EVALUATION:
    // If ticket is Resolved but older than 14 days, auto-close parent ticket immediately
    const isExpiredResolved = ticketRow.status === 'Resolved' &&
      (new Date(ticketRow.last_updated).getTime() < Date.now() - (14 * 24 * 60 * 60 * 1000));

    if (isExpiredResolved) {
      await client.query(
        `UPDATE tickets SET status = 'Closed', last_updated = NOW() WHERE brand_id = $1 AND id = $2`,
        [brandId, ticketId]
      );
      ticketRow.status = 'Closed';
    }

    // FORMAL CLOSED-TICKET HANDLING:
    // If ticket is permanently Closed, do not reopen closed record. Spawn a new linked child ticket!
    if (ticketRow.status === 'Closed') {
      const newTicketId = `tkt_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      const newQueueId = `queue_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

      await client.query(`
        INSERT INTO tickets (
          id, brand_id, customer_id, category, priority, status, human_requested,
          summary, parent_ticket_id, last_updated, created_at
        ) VALUES (
          $1, $2, $3, $4, $5, 'Human Requested', TRUE,
          $6, $7, NOW(), NOW()
        )
      `, [
        newTicketId, brandId, canonicalCustomerId, ticketRow.category || 'general_inquiry', priority,
        `Follow-up conversation to permanently closed ticket ${ticketId}`, ticketId
      ]);

      await client.query(`
        INSERT INTO ticket_routing_queue (
          id, brand_id, ticket_id, customer_id, priority, customer_language, required_skills, status, queued_at, next_routing_attempt_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'queued', NOW(), NOW())
      `, [newQueueId, brandId, newTicketId, canonicalCustomerId, priority, customerLanguage, normalizedSkills]);

      if (shouldManageTransaction) await client.query('COMMIT');

      // Trigger routing opportunity for new child ticket
      try {
        dispatchSchedulingOpportunity(brandId);
      } catch (e) {}

      return {
        enqueued: true,
        reopened: false,
        newTicketCreated: true,
        parentTicketId: ticketId,
        ticketId: newTicketId,
        queueId: newQueueId,
        status: 'queued'
      };
    }

    // Step 2 of Global Lock Hierarchy: Lock active queue entry if present
    const activeRes = await client.query(`
      SELECT id, status, assigned_agent_id
      FROM ticket_routing_queue
      WHERE brand_id = $1 AND ticket_id = $2
        AND status IN ('queued', 'routing', 'assigned')
      FOR UPDATE
    `, [brandId, ticketId]);

    if (activeRes.rows.length > 0) {
      const activeEntry = activeRes.rows[0];

      // If actively queued or routing, refresh metadata
      if (activeEntry.status === 'queued' || activeEntry.status === 'routing') {
        await client.query(`
          UPDATE ticket_routing_queue
          SET priority = $1, customer_language = $2, required_skills = $3, next_routing_attempt_at = NOW()
          WHERE id = $4
        `, [priority, customerLanguage, normalizedSkills, activeEntry.id]);
      }
      // If already assigned, DO NOT touch assignment metadata or re-queue!
      if (shouldManageTransaction) await client.query('COMMIT');
      return { enqueued: false, alreadyActive: true, queueId: activeEntry.id, status: activeEntry.status };
    }

    // Check for previous closed/cancelled entry to reopen (within 14 days)
    const closedRes = await client.query(`
      SELECT id, status
      FROM ticket_routing_queue
      WHERE brand_id = $1 AND ticket_id = $2
        AND status IN ('closed', 'cancelled')
      ORDER BY COALESCE(closed_at, queued_at) DESC
      LIMIT 1
      FOR UPDATE
    `, [brandId, ticketId]);

    let queueId;
    if (closedRes.rows.length > 0) {
      queueId = closedRes.rows[0].id;
      await client.query(`
        UPDATE ticket_routing_queue
        SET
          status = 'queued',
          priority = $1,
          customer_language = $2,
          required_skills = $3,
          assigned_agent_id = NULL,
          queued_at = NOW(),
          assigned_at = NULL,
          closed_at = NULL,
          routing_attempts = 0,
          retry_count = 0,
          next_routing_attempt_at = NOW(),
          routing_lease_token = NULL,
          routing_worker_id = NULL,
          routing_locked_at = NULL,
          routing_lease_expires_at = NULL
        WHERE id = $4
      `, [priority, customerLanguage, normalizedSkills, queueId]);
    } else {
      // First-time enqueue fallback: INSERT ... ON CONFLICT DO NOTHING RETURNING id, status
      queueId = `queue_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      const insertRes = await client.query(`
        INSERT INTO ticket_routing_queue (
          id, brand_id, ticket_id, customer_id, priority,
          customer_language, required_skills, status, queued_at, next_routing_attempt_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, 'queued', NOW(), NOW()
        )
        ON CONFLICT (brand_id, ticket_id) WHERE status IN ('queued', 'routing', 'assigned')
        DO NOTHING
        RETURNING id, status
      `, [queueId, brandId, ticketId, canonicalCustomerId, priority, customerLanguage, normalizedSkills]);

      if (insertRes.rows.length === 0) {
        const existingActive = await client.query(`
          SELECT id, status FROM ticket_routing_queue
          WHERE brand_id = $1 AND ticket_id = $2 AND status IN ('queued', 'routing', 'assigned')
        `, [brandId, ticketId]);

        if (shouldManageTransaction) await client.query('COMMIT');
        return {
          enqueued: false,
          alreadyActive: true,
          queueId: existingActive.rows[0].id,
          status: existingActive.rows[0].status
        };
      }
      queueId = insertRes.rows[0].id;
    }

    // Invariant: Transition ticket to 'Human Requested' and CLEAR assigned_agent_id on reopen
    if (ticketRow.status === 'Resolved' || ticketRow.status === 'AI Handling') {
      const ticketUpd = await client.query(`
        UPDATE tickets
        SET
          status = 'Human Requested',
          human_requested = TRUE,
          assigned_agent_id = NULL,
          last_updated = NOW()
        WHERE brand_id = $1 AND id = $2
      `, [brandId, ticketId]);

      if (ticketUpd.rowCount !== 1) {
        throw new Error(`Failed to update ticket status for ticket ${ticketId}`);
      }
    }

    if (shouldManageTransaction) await client.query('COMMIT');

    // Trigger routing opportunity for newly enqueued / reopened ticket
    try {
      dispatchSchedulingOpportunity(brandId);
    } catch (e) {}

    return { enqueued: true, alreadyActive: false, queueId, status: 'queued' };
  } catch (err) {
    if (shouldManageTransaction) await client.query('ROLLBACK');
    throw err;
  } finally {
    if (shouldManageTransaction) client.release();
  }
}

// Background auto-close routine for expired resolved tickets (> 14 days)
export async function autoCloseExpiredResolvedTickets() {
  const pool = getPool();
  try {
    const res = await pool.query(`
      UPDATE tickets
      SET status = 'Closed', last_updated = NOW()
      WHERE status = 'Resolved' AND last_updated < NOW() - INTERVAL '14 days'
    `);
    if (res.rowCount > 0) {
      console.log(`[LIFECYCLE AUTO-CLOSE] Permanently closed ${res.rowCount} resolved tickets exceeding 14-day inactivity window.`);
    }
    return res.rowCount;
  } catch (err) {
    console.error('[LIFECYCLE AUTO-CLOSE ERROR] Failed to auto-close expired tickets:', err.message);
    return 0;
  }
}

export default {
  enqueueOrReopenTicket,
  autoCloseExpiredResolvedTickets
};
