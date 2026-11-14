// server/src/services/capacityService.js
import crypto from 'crypto';
import { getPool } from '../db/pool.js';
import { dispatchSchedulingOpportunity } from './multiTenantScheduler.js';

export async function resolveTicketAndReleaseCapacity({ brandId, ticketId, client: externalClient = null }) {
  const pool = getPool();
  const client = externalClient || await pool.connect();
  const shouldManageTransaction = !externalClient;

  try {
    if (shouldManageTransaction) await client.query('BEGIN');

    // Step 1: Lock ticket row explicitly
    const ticketRes = await client.query(`
      SELECT id, brand_id, assigned_agent_id, status
      FROM tickets
      WHERE brand_id = $1 AND id = $2
      FOR UPDATE
    `, [brandId, ticketId]);

    if (ticketRes.rows.length === 0) {
      const err = new Error(`Ticket not found: ${ticketId}`);
      err.statusCode = 404;
      throw err;
    }
    const ticket = ticketRes.rows[0];

    // Idempotent: If already Resolved, do NOT release capacity again
    if (ticket.status !== 'Resolved') {
      // Step 2: Lock and close active queue row
      await client.query(`
        UPDATE ticket_routing_queue
        SET status = 'closed', closed_at = NOW()
        WHERE brand_id = $1 AND ticket_id = $2 AND status IN ('queued', 'routing', 'assigned')
      `, [brandId, ticketId]);

      // Step 3: Update ticket status to 'Resolved' FIRST so recomputations do not count it!
      const ticketUpd = await client.query(`
        UPDATE tickets
        SET status = 'Resolved', human_requested = FALSE, last_updated = NOW()
        WHERE brand_id = $1 AND id = $2
      `, [brandId, ticketId]);

      if (ticketUpd.rowCount !== 1) {
        throw new Error(`Failed to update ticket resolution status for ticket ${ticketId}`);
      }

      // Step 4: Lock agent profile and decrement or reconcile capacity
      if (ticket.assigned_agent_id) {
        const agentLock = await client.query(`
          SELECT user_id, active_ticket_count
          FROM agent_profiles
          WHERE brand_id = $1 AND user_id = $2
          FOR UPDATE
        `, [brandId, ticket.assigned_agent_id]);

        if (agentLock.rows.length === 0) {
          throw new Error(`Assigned agent profile not found for user ${ticket.assigned_agent_id}`);
        }

        const currentCount = agentLock.rows[0].active_ticket_count;
        if (currentCount <= 0) {
          // Counter anomaly detected: recompute truth AFTER ticket is marked Resolved!
          console.warn(`[Workload Counter Anomaly] Agent ${ticket.assigned_agent_id} active_ticket_count is ${currentCount} upon release of ticket ${ticketId}. Triggering immediate reconciliation.`);

          const countRes = await client.query(`
            SELECT COUNT(*)::INTEGER AS true_count
            FROM tickets
            WHERE brand_id = $1
              AND assigned_agent_id = $2
              AND status IN ('Human Requested', 'Human Agent Active')
          `, [brandId, ticket.assigned_agent_id]);

          const trueCount = countRes.rows[0].true_count;

          const agentUpd = await client.query(`
            UPDATE agent_profiles
            SET active_ticket_count = $1, updated_at = NOW()
            WHERE brand_id = $2 AND user_id = $3
          `, [trueCount, brandId, ticket.assigned_agent_id]);

          if (agentUpd.rowCount !== 1) {
            throw new Error(`Failed to reconcile agent capacity for user ${ticket.assigned_agent_id}`);
          }

          const historyId = `hist_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
          await client.query(`
            INSERT INTO agent_status_history (
              id, brand_id, user_id, previous_status, new_status, trigger_source, reason
            ) VALUES ($1, $2, $3, 'Active', 'Active', 'reconciliation', $4)
          `, [historyId, brandId, ticket.assigned_agent_id, `Reconciled from ${currentCount} to ${trueCount} on ticket resolution`]);
        } else {
          const agentUpd = await client.query(`
            UPDATE agent_profiles
            SET active_ticket_count = active_ticket_count - 1, updated_at = NOW()
            WHERE brand_id = $1 AND user_id = $2
          `, [brandId, ticket.assigned_agent_id]);

          if (agentUpd.rowCount !== 1) {
            throw new Error(`Failed to decrement agent capacity for user ${ticket.assigned_agent_id}`);
          }
        }
      }
    }

    if (shouldManageTransaction) await client.query('COMMIT');

    // Trigger routing opportunity since agent capacity was released
    try {
      dispatchSchedulingOpportunity(brandId);
    } catch (e) {}

    return { success: true, ticketId, status: 'Resolved' };
  } catch (err) {
    if (shouldManageTransaction) await client.query('ROLLBACK');
    throw err;
  } finally {
    if (shouldManageTransaction) client.release();
  }
}

export async function transferTicketAtomically({
  brandId,
  ticketId,
  fromAgentId,
  toAgentId,
  handoffSummaryJson,
  internalNotes = '',
  client: externalClient = null
}) {
  if (fromAgentId === toAgentId) {
    const err = new Error('Transfer denied: target agent cannot be the same as transferring agent');
    err.statusCode = 400;
    throw err;
  }

  const pool = getPool();
  const client = externalClient || await pool.connect();
  const shouldManageTransaction = !externalClient;

  try {
    if (shouldManageTransaction) await client.query('BEGIN');

    // Step 1: Lock ticket row explicitly
    const ticketRes = await client.query(`
      SELECT id, assigned_agent_id, status
      FROM tickets
      WHERE brand_id = $1 AND id = $2
      FOR UPDATE
    `, [brandId, ticketId]);

    if (ticketRes.rows.length === 0) {
      const err = new Error('Ticket not found');
      err.statusCode = 404;
      throw err;
    }
    const ticket = ticketRes.rows[0];

    if (ticket.status === 'Resolved' || ticket.status === 'Closed') {
      const err = new Error(`Cannot transfer ticket in status ${ticket.status}`);
      err.statusCode = 400;
      throw err;
    }
    if (ticket.assigned_agent_id !== fromAgentId) {
      const err = new Error('Transfer denied: ticket is not currently assigned to transferring agent');
      err.statusCode = 403;
      throw err;
    }

    // Step 2: Lock active queue row
    const queueLock = await client.query(`
      SELECT id, status FROM ticket_routing_queue
      WHERE brand_id = $1 AND ticket_id = $2 AND status = 'assigned'
      FOR UPDATE
    `, [brandId, ticketId]);

    if (queueLock.rows.length === 0) {
      const err = new Error('No active assigned queue entry found for ticket transfer');
      err.statusCode = 400;
      throw err;
    }

    // Step 3: Lock both Agent profiles in alphabetical user_id order
    const sortedUserIds = [fromAgentId, toAgentId].sort();
    const agentsRes = await client.query(`
      SELECT ap.user_id, ap.active_ticket_count, ap.max_concurrent_tickets, ap.configured_status, ap.last_heartbeat_at, bm.deactivated_at
      FROM agent_profiles ap
      JOIN brand_memberships bm ON ap.brand_id = bm.brand_id AND ap.user_id = bm.user_id
      WHERE ap.brand_id = $1 AND ap.user_id IN ($2, $3)
      ORDER BY ap.user_id ASC
      FOR UPDATE OF ap
    `, [brandId, sortedUserIds[0], sortedUserIds[1]]);

    const agentMap = new Map(agentsRes.rows.map(a => [a.user_id, a]));
    const sourceAgent = agentMap.get(fromAgentId);
    const targetAgent = agentMap.get(toAgentId);

    if (!sourceAgent || !targetAgent) {
      throw new Error('Source or target agent profile missing');
    }
    if (targetAgent.deactivated_at !== null) {
      const err = new Error('Target agent membership is deactivated');
      err.statusCode = 400;
      throw err;
    }
    if (targetAgent.configured_status !== 'Available') {
      const err = new Error(`Target agent is not available (${targetAgent.configured_status})`);
      err.statusCode = 400;
      throw err;
    }
    if (!targetAgent.last_heartbeat_at || new Date(targetAgent.last_heartbeat_at).getTime() < Date.now() - 120000) {
      const err = new Error('Target agent heartbeat has expired');
      err.statusCode = 400;
      throw err;
    }
    if (targetAgent.active_ticket_count >= targetAgent.max_concurrent_tickets) {
      const err = new Error('Target agent is at maximum capacity');
      err.statusCode = 400;
      throw err;
    }

    // Step 4: Update ticket and queue assignment FIRST so source agent recomputation does not include it!
    const ticketUpd = await client.query(`
      UPDATE tickets SET assigned_agent_id = $1, last_updated = NOW() WHERE brand_id = $2 AND id = $3
    `, [toAgentId, brandId, ticketId]);

    const queueUpd = await client.query(`
      UPDATE ticket_routing_queue SET assigned_agent_id = $1, assigned_at = NOW() WHERE brand_id = $2 AND ticket_id = $3 AND status = 'assigned'
    `, [toAgentId, brandId, ticketId]);

    // Step 5: Mutate counts
    let decrRes;
    if (sourceAgent.active_ticket_count <= 0) {
      // Recompute true count for fromAgent AFTER ticket has been reassigned to toAgent!
      const countRes = await client.query(`
        SELECT COUNT(*)::INTEGER AS true_count
        FROM tickets
        WHERE brand_id = $1
          AND assigned_agent_id = $2
          AND status IN ('Human Requested', 'Human Agent Active')
      `, [brandId, fromAgentId]);

      const trueCount = countRes.rows[0].true_count;

      decrRes = await client.query(`
        UPDATE agent_profiles SET active_ticket_count = $1, updated_at = NOW()
        WHERE brand_id = $2 AND user_id = $3
      `, [trueCount, brandId, fromAgentId]);

      const historyId = `hist_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      await client.query(`
        INSERT INTO agent_status_history (
          id, brand_id, user_id, previous_status, new_status, trigger_source, reason
        ) VALUES ($1, $2, $3, 'Active', 'Active', 'reconciliation', $4)
      `, [historyId, brandId, fromAgentId, `Reconciled from ${sourceAgent.active_ticket_count} to ${trueCount} on transfer`]);
    } else {
      decrRes = await client.query(`
        UPDATE agent_profiles SET active_ticket_count = active_ticket_count - 1, updated_at = NOW()
        WHERE brand_id = $1 AND user_id = $2
      `, [brandId, fromAgentId]);
    }

    const incrRes = await client.query(`
      UPDATE agent_profiles SET active_ticket_count = active_ticket_count + 1, last_assigned_at = NOW(), updated_at = NOW()
      WHERE brand_id = $1 AND user_id = $2
    `, [brandId, toAgentId]);

    const handoffId = `handoff_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const handoffIns = await client.query(`
      INSERT INTO ticket_handoff_summaries (
        id, brand_id, ticket_id, from_agent_id, to_agent_id, ai_summary_json, internal_notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [handoffId, brandId, ticketId, fromAgentId, toAgentId, JSON.stringify(handoffSummaryJson || {}), internalNotes]);

    // Assert row counts on every actual database mutation (Zero invented row counts!)
    if (decrRes.rowCount !== 1 || incrRes.rowCount !== 1 || ticketUpd.rowCount !== 1 || queueUpd.rowCount !== 1 || handoffIns.rowCount !== 1) {
      throw new Error('Transfer mutation invariant failed: row count mismatch');
    }

    if (shouldManageTransaction) await client.query('COMMIT');

    // Trigger routing opportunity since source agent now has capacity
    try {
      dispatchSchedulingOpportunity(brandId);
    } catch (e) {}

    return { success: true, ticketId, fromAgentId, toAgentId, handoffId };
  } catch (err) {
    if (shouldManageTransaction) await client.query('ROLLBACK');
    throw err;
  } finally {
    if (shouldManageTransaction) client.release();
  }
}

export async function reconcileAgentCapacity({ brandId, userId, client: externalClient = null }) {
  const pool = getPool();
  const client = externalClient || await pool.connect();
  const shouldManageTransaction = !externalClient;

  try {
    if (shouldManageTransaction) await client.query('BEGIN');

    const agentLock = await client.query(`
      SELECT user_id, active_ticket_count
      FROM agent_profiles
      WHERE brand_id = $1 AND user_id = $2
      FOR UPDATE
    `, [brandId, userId]);

    if (agentLock.rows.length === 0) {
      const err = new Error(`Agent profile not found: ${userId}`);
      err.statusCode = 404;
      throw err;
    }

    const previousCount = agentLock.rows[0].active_ticket_count;

    const countRes = await client.query(`
      SELECT COUNT(*)::INTEGER AS true_count
      FROM tickets
      WHERE brand_id = $1
        AND assigned_agent_id = $2
        AND status IN ('Human Requested', 'Human Agent Active')
    `, [brandId, userId]);

    const trueCount = countRes.rows[0].true_count;

    if (previousCount !== trueCount) {
      const updRes = await client.query(`
        UPDATE agent_profiles
        SET active_ticket_count = $1, updated_at = NOW()
        WHERE brand_id = $2 AND user_id = $3
      `, [trueCount, brandId, userId]);

      if (updRes.rowCount !== 1) {
        throw new Error(`Failed to update reconciled count for user ${userId}`);
      }

      const historyId = `hist_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      await client.query(`
        INSERT INTO agent_status_history (
          id, brand_id, user_id, previous_status, new_status, trigger_source, reason
        ) VALUES ($1, $2, $3, 'Active', 'Active', 'reconciliation', $4)
      `, [historyId, brandId, userId, `Direct reconciliation from ${previousCount} to ${trueCount}`]);
    }

    if (shouldManageTransaction) await client.query('COMMIT');

    return {
      reconciled: true,
      userId,
      previousCount,
      newCount: trueCount,
      adjusted: previousCount !== trueCount
    };
  } catch (err) {
    if (shouldManageTransaction) await client.query('ROLLBACK');
    throw err;
  } finally {
    if (shouldManageTransaction) client.release();
  }
}

export default {
  resolveTicketAndReleaseCapacity,
  transferTicketAtomically,
  reconcileAgentCapacity
};
