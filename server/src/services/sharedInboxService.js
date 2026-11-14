// server/src/services/sharedInboxService.js
import crypto from 'crypto';
import { getPool } from '../db/pool.js';
import { calculateEffectiveStatus } from './agentAvailabilityService.js';
import { transferTicketAtomically, resolveTicketAndReleaseCapacity } from './capacityService.js';

/**
 * Masks customer PII for unclaimed / shared queue views.
 */
export function maskCustomerPii(customer) {
  if (!customer) return null;
  const name = customer.name || '';
  const email = customer.email || '';
  const phone = customer.phone || '';

  const maskedName = name
    .split(' ')
    .filter(Boolean)
    .map(part => part.length <= 1 ? part : part[0] + '***')
    .join(' ');

  let maskedEmail = email;
  if (email.includes('@')) {
    const [user, domain] = email.split('@');
    maskedEmail = (user.length > 0 ? user[0] : '') + '***@' + domain;
  }

  let maskedPhone = phone;
  if (phone.length > 5) {
    maskedPhone = phone.slice(0, 3) + '***' + phone.slice(-3);
  }

  return {
    id: customer.id,
    name: maskedName || 'Valued Customer',
    email: maskedEmail,
    phone: maskedPhone,
    locale: customer.locale || 'en-US'
  };
}

/**
 * Returns unassigned tickets with masked customer PII.
 */
export async function getUnassignedTickets({ brandId, priority, limit = 50, offset = 0 }) {
  const pool = getPool();

  let filterSql = '';
  const params = [brandId, limit, offset];
  if (priority && priority !== 'All') {
    params.push(priority);
    filterSql = `AND q.priority = $${params.length}`;
  }

  const res = await pool.query(`
    SELECT
      t.id, t.brand_id, t.customer_id, t.category, t.priority, t.status, t.summary,
      t.human_requested, t.last_updated, t.created_at,
      q.id AS queue_id, q.status AS queue_status, q.priority AS queue_priority,
      q.customer_language, q.required_skills, q.routing_attempts, q.queued_at,
      c.name AS customer_name, c.email AS customer_email, NULL::TEXT AS customer_phone, q.customer_language AS customer_locale
    FROM tickets t
    JOIN ticket_routing_queue q
      ON t.brand_id = q.brand_id AND t.id = q.ticket_id
    LEFT JOIN customers c
      ON t.brand_id = c.brand_id AND t.customer_id = c.id
    WHERE t.brand_id = $1
      AND q.status IN ('queued', 'routing')
      AND t.status IN ('AI Handling', 'Human Requested')
      ${filterSql}
    ORDER BY
      (CASE q.priority WHEN 'Critical' THEN 1 WHEN 'High' THEN 2 WHEN 'Medium' THEN 3 ELSE 4 END) ASC,
      q.queued_at ASC
    LIMIT $2 OFFSET $3
  `, params);

  return res.rows.map(row => ({
    id: row.id,
    brandId: row.brand_id,
    category: row.category,
    priority: row.priority,
    status: row.status,
    summary: row.summary,
    humanRequested: row.human_requested,
    lastUpdated: row.last_updated,
    createdAt: row.created_at,
    queue: {
      id: row.queue_id,
      status: row.queue_status,
      priority: row.queue_priority,
      customerLanguage: row.customer_language,
      requiredSkills: row.required_skills,
      routingAttempts: row.routing_attempts,
      queuedAt: row.queued_at
    },
    // Customer PII is strictly masked in unassigned view
    customer: maskCustomerPii({
      id: row.customer_id,
      name: row.customer_name,
      email: row.customer_email,
      phone: row.customer_phone,
      locale: row.customer_locale
    })
  }));
}

/**
 * Returns tickets assigned to current authenticated agent.
 */
export async function getMyTickets({ brandId, agentId, limit = 50, offset = 0 }) {
  const pool = getPool();

  const res = await pool.query(`
    SELECT
      t.id, t.brand_id, t.customer_id, t.category, t.priority, t.status, t.summary,
      t.assigned_agent_id, t.human_requested, t.last_updated, t.created_at,
      q.id AS queue_id, q.status AS queue_status, q.customer_language, q.required_skills, q.assigned_at,
      c.name AS customer_name, c.email AS customer_email, NULL::TEXT AS customer_phone, COALESCE(q.customer_language, 'en-US') AS customer_locale
    FROM tickets t
    LEFT JOIN ticket_routing_queue q
      ON t.brand_id = q.brand_id AND t.id = q.ticket_id AND q.status = 'assigned'
    LEFT JOIN customers c
      ON t.brand_id = c.brand_id AND t.customer_id = c.id
    WHERE t.brand_id = $1
      AND t.assigned_agent_id = $2
      AND t.status IN ('Human Requested', 'Human Agent Active')
    ORDER BY t.last_updated DESC
    LIMIT $3 OFFSET $4
  `, [brandId, agentId, limit, offset]);

  return res.rows.map(row => ({
    id: row.id,
    brandId: row.brand_id,
    category: row.category,
    priority: row.priority,
    status: row.status,
    summary: row.summary,
    assignedAgentId: row.assigned_agent_id,
    humanRequested: row.human_requested,
    lastUpdated: row.last_updated,
    createdAt: row.created_at,
    queue: row.queue_id ? {
      id: row.queue_id,
      status: row.queue_status,
      customerLanguage: row.customer_language,
      requiredSkills: row.required_skills,
      assignedAt: row.assigned_at
    } : null,
    // Customer details are unmasked for the assigned agent owner
    customer: {
      id: row.customer_id,
      name: row.customer_name,
      email: row.customer_email,
      phone: row.customer_phone,
      locale: row.customer_locale
    }
  }));
}

/**
 * Returns shared team overview: unassigned tickets, assigned workloads, and agent roster.
 */
export async function getTeamOverview({ brandId }) {
  const pool = getPool();

  // 1. Fetch counts
  const countsRes = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE q.status IN ('queued', 'routing'))::INTEGER AS unassigned_count,
      COUNT(*) FILTER (WHERE t.status = 'Human Agent Active')::INTEGER AS assigned_active_count,
      COUNT(*) FILTER (WHERE q.priority = 'Critical' AND q.status IN ('queued', 'routing'))::INTEGER AS critical_unassigned_count,
      COUNT(*) FILTER (WHERE t.status IN ('Human Requested', 'Human Agent Active'))::INTEGER AS total_workforce_active_count
    FROM tickets t
    LEFT JOIN ticket_routing_queue q ON t.brand_id = q.brand_id AND t.id = q.ticket_id AND q.status IN ('queued', 'routing')
    WHERE t.brand_id = $1
  `, [brandId]);

  // 2. Fetch roster with effective status
  const roster = await getAgentRoster({ brandId });

  // 3. Fetch unassigned preview (first 10, masked)
  const unassigned = await getUnassignedTickets({ brandId, limit: 10 });

  // 4. Fetch assigned preview (first 10)
  const assignedRes = await pool.query(`
    SELECT
      t.id, t.category, t.priority, t.status, t.summary, t.last_updated, t.assigned_agent_id,
      ap.display_name AS agent_name, ap.avatar_url AS agent_avatar,
      c.name AS customer_name, c.email AS customer_email
    FROM tickets t
    JOIN agent_profiles ap ON t.brand_id = ap.brand_id AND t.assigned_agent_id = ap.user_id
    LEFT JOIN customers c ON t.brand_id = c.brand_id AND t.customer_id = c.id
    WHERE t.brand_id = $1 AND t.status IN ('Human Requested', 'Human Agent Active')
    ORDER BY t.last_updated DESC
    LIMIT 10
  `, [brandId]);

  const assigned = assignedRes.rows.map(r => ({
    id: r.id,
    category: r.category,
    priority: r.priority,
    status: r.status,
    summary: r.summary,
    lastUpdated: r.last_updated,
    assignedAgent: {
      id: r.assigned_agent_id,
      name: r.agent_name,
      avatarUrl: r.agent_avatar
    },
    customer: maskCustomerPii({ name: r.customer_name, email: r.customer_email })
  }));

  return {
    metrics: countsRes.rows[0],
    unassigned,
    assigned,
    roster
  };
}

/**
 * Returns agent roster with dynamic effective statuses and committed workload.
 */
export async function getAgentRoster({ brandId }) {
  const pool = getPool();

  const res = await pool.query(`
    SELECT
      ap.user_id,
      ap.display_name,
      ap.avatar_url,
      ap.configured_status,
      ap.status_reason,
      ap.primary_language,
      ap.supported_languages,
      ap.skills,
      ap.max_concurrent_tickets,
      ap.active_ticket_count,
      ap.last_heartbeat_at,
      ap.last_assigned_at,
      bm.role,
      bm.deactivated_at,
      u.email,
      EXISTS (
        SELECT 1 FROM agent_sessions s
        WHERE s.brand_id = ap.brand_id
          AND s.user_id = ap.user_id
          AND s.revoked_at IS NULL
          AND s.expires_at > NOW()
      ) AS has_active_session
    FROM agent_profiles ap
    JOIN brand_memberships bm ON ap.brand_id = bm.brand_id AND ap.user_id = bm.user_id
    JOIN users u ON ap.user_id = u.id
    WHERE ap.brand_id = $1
    ORDER BY ap.display_name ASC
  `, [brandId]);

  return res.rows.map(row => {
    const effectiveStatus = calculateEffectiveStatus({
      configuredStatus: row.configured_status,
      activeTicketCount: row.active_ticket_count,
      maxConcurrentTickets: row.max_concurrent_tickets,
      lastHeartbeatAt: row.last_heartbeat_at,
      isSessionActive: row.has_active_session,
      isDeactivated: Boolean(row.deactivated_at)
    });

    return {
      userId: row.user_id,
      displayName: row.display_name,
      avatarUrl: row.avatar_url,
      email: row.email,
      role: row.role,
      configuredStatus: row.configured_status,
      effectiveStatus,
      statusReason: row.status_reason,
      primaryLanguage: row.primary_language,
      supportedLanguages: row.supported_languages,
      skills: row.skills,
      maxConcurrentTickets: row.max_concurrent_tickets,
      activeTicketCount: row.active_ticket_count,
      lastHeartbeatAt: row.last_heartbeat_at,
      lastAssignedAt: row.last_assigned_at
    };
  });
}

/**
 * Fetches ticket details, continuous conversation history, and agent-only handoff summaries.
 */
export async function getTicketDetailsWithHistory({ brandId, ticketId, requestingAgentId, requestingAgentRole }) {
  const pool = getPool();

  const ticketRes = await pool.query(`
    SELECT
      t.id, t.brand_id, t.customer_id, t.parent_ticket_id, t.category, t.priority, t.status,
      t.summary, t.assigned_agent_id, t.human_requested, t.last_updated, t.created_at,
      c.name AS customer_name, c.email AS customer_email, NULL::TEXT AS customer_phone, COALESCE(q.customer_language, 'en-US') AS customer_locale,
      q.id AS queue_id, q.status AS queue_status, q.priority AS queue_priority,
      q.customer_language, q.required_skills, q.routing_attempts, q.queued_at, q.assigned_at,
      ap.display_name AS assigned_agent_name, ap.avatar_url AS assigned_agent_avatar
    FROM tickets t
    LEFT JOIN customers c ON t.brand_id = c.brand_id AND t.customer_id = c.id
    LEFT JOIN ticket_routing_queue q ON t.brand_id = q.brand_id AND t.id = q.ticket_id AND q.status IN ('queued', 'routing', 'assigned')
    LEFT JOIN agent_profiles ap ON t.brand_id = ap.brand_id AND t.assigned_agent_id = ap.user_id
    WHERE t.brand_id = $1 AND t.id = $2
  `, [brandId, ticketId]);

  if (ticketRes.rows.length === 0) {
    return null;
  }

  const row = ticketRes.rows[0];

  // RBAC Access Check: regular agents may only view unassigned tickets or tickets assigned to them
  const isAssignedToRequesting = row.assigned_agent_id === requestingAgentId;
  const isUnassigned = !row.assigned_agent_id;
  const isLeadOrAdmin = ['support_lead', 'admin'].includes(requestingAgentRole);

  if (!isAssignedToRequesting && !isUnassigned && !isLeadOrAdmin) {
    const err = new Error('Access denied: ticket is assigned to another agent');
    err.statusCode = 403;
    throw err;
  }

  // Customer PII: unmasked if assigned to requesting agent or lead/admin; masked if unassigned
  const customer = (isAssignedToRequesting || isLeadOrAdmin)
    ? {
        id: row.customer_id,
        name: row.customer_name,
        email: row.customer_email,
        phone: row.customer_phone,
        locale: row.customer_locale
      }
    : maskCustomerPii({
        id: row.customer_id,
        name: row.customer_name,
        email: row.customer_email,
        phone: row.customer_phone,
        locale: row.customer_locale
      });

  // Fetch continuous conversation history from message_archive
  const messagesRes = await pool.query(`
    SELECT
      id, nexconn_message_id, sender_role, sender_user_id AS sender_id, sender_name,
      message_text AS content, sent_at AS created_at
    FROM message_archive
    WHERE brand_id = $1 AND ticket_id = $2
    ORDER BY sent_at ASC
  `, [brandId, ticketId]);

  // Fetch internal notes & handoff summaries (Strictly agent-only!)
  const handoffsRes = await pool.query(`
    SELECT
      h.id, h.from_agent_id, h.to_agent_id, h.ai_summary_json, h.internal_notes,
      h.attempted_resolutions, h.customer_commitments, h.pending_actions, h.created_at,
      from_ap.display_name AS from_agent_name,
      to_ap.display_name AS to_agent_name
    FROM ticket_handoff_summaries h
    LEFT JOIN agent_profiles from_ap ON h.brand_id = from_ap.brand_id AND h.from_agent_id = from_ap.user_id
    LEFT JOIN agent_profiles to_ap ON h.brand_id = to_ap.brand_id AND h.to_agent_id = to_ap.user_id
    WHERE h.brand_id = $1 AND h.ticket_id = $2
    ORDER BY h.created_at DESC
  `, [brandId, ticketId]);

  return {
    id: row.id,
    brandId: row.brand_id,
    parentTicketId: row.parent_ticket_id,
    category: row.category,
    priority: row.priority,
    status: row.status,
    summary: row.summary,
    humanRequested: row.human_requested,
    lastUpdated: row.last_updated,
    createdAt: row.created_at,
    assignedAgent: row.assigned_agent_id ? {
      id: row.assigned_agent_id,
      name: row.assigned_agent_name,
      avatarUrl: row.assigned_agent_avatar
    } : null,
    queue: row.queue_id ? {
      id: row.queue_id,
      status: row.queue_status,
      priority: row.queue_priority,
      customerLanguage: row.customer_language,
      requiredSkills: row.required_skills,
      routingAttempts: row.routing_attempts,
      queuedAt: row.queued_at,
      assignedAt: row.assigned_at
    } : null,
    customer,
    conversationHistory: messagesRes.rows,
    handoffSummaries: handoffsRes.rows
  };
}

/**
 * Claims or manually reassigns a ticket using atomic checks and the global lock hierarchy.
 * Lock Hierarchy: tickets (Step 1) -> ticket_routing_queue (Step 2) -> agent_profiles (Step 3).
 */
export async function claimOrReassignTicket({
  brandId,
  ticketId,
  targetAgentId,
  requestingAgentId,
  requestingAgentRole
}) {
  // Authorization: agents can only claim for self; leads/admins can assign to anyone
  if (targetAgentId !== requestingAgentId && !['support_lead', 'admin'].includes(requestingAgentRole)) {
    const err = new Error('Unauthorized: only support leads or admins may reassign tickets to other agents');
    err.statusCode = 403;
    throw err;
  }

  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Step 1: Lock ticket row
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

    if (ticket.status === 'Resolved' || ticket.status === 'Closed') {
      const err = new Error(`Cannot assign ticket in status ${ticket.status}`);
      err.statusCode = 400;
      throw err;
    }

    const previousAgentId = ticket.assigned_agent_id;

    // Step 2: Lock active queue row (if any)
    const queueRes = await client.query(`
      SELECT id, status, assigned_agent_id
      FROM ticket_routing_queue
      WHERE brand_id = $1 AND ticket_id = $2 AND status IN ('queued', 'routing', 'assigned')
      FOR UPDATE
    `, [brandId, ticketId]);

    const activeQueueRow = queueRes.rows[0] || null;

    // Step 3: Lock target agent profile (and previous agent if reassigning) in deterministic user_id order
    const agentIdsToLock = [targetAgentId];
    if (previousAgentId && previousAgentId !== targetAgentId) {
      agentIdsToLock.push(previousAgentId);
    }
    agentIdsToLock.sort();

    const agentsRes = await client.query(`
      SELECT ap.user_id, ap.active_ticket_count, ap.max_concurrent_tickets, ap.configured_status, ap.last_heartbeat_at, bm.deactivated_at
      FROM agent_profiles ap
      JOIN brand_memberships bm ON ap.brand_id = bm.brand_id AND ap.user_id = bm.user_id
      WHERE ap.brand_id = $1 AND ap.user_id = ANY($2::TEXT[])
      ORDER BY ap.user_id ASC
      FOR UPDATE OF ap
    `, [brandId, agentIdsToLock]);

    const agentMap = new Map(agentsRes.rows.map(a => [a.user_id, a]));
    const targetAgent = agentMap.get(targetAgentId);

    if (!targetAgent) {
      const err = new Error(`Target agent profile not found: ${targetAgentId}`);
      err.statusCode = 404;
      throw err;
    }
    if (targetAgent.deactivated_at) {
      const err = new Error('Target agent membership is deactivated');
      err.statusCode = 400;
      throw err;
    }
    if (targetAgent.configured_status !== 'Available') {
      const err = new Error(`Target agent is not available (${targetAgent.configured_status})`);
      err.statusCode = 400;
      throw err;
    }
    if (!targetAgent.last_heartbeat_at || new Date(targetAgent.last_heartbeat_at).getTime() < Date.now() - 60000) {
      const err = new Error('Target agent heartbeat is stale (>60s)');
      err.statusCode = 400;
      throw err;
    }
    if (targetAgent.active_ticket_count >= targetAgent.max_concurrent_tickets) {
      const err = new Error('Target agent is at maximum concurrent ticket capacity');
      err.statusCode = 400;
      throw err;
    }

    // Step 4: Decrement previous agent if reassigning
    if (previousAgentId && previousAgentId !== targetAgentId) {
      const prevAgent = agentMap.get(previousAgentId);
      if (prevAgent) {
        await client.query(`
          UPDATE agent_profiles
          SET active_ticket_count = GREATEST(active_ticket_count - 1, 0), updated_at = NOW()
          WHERE brand_id = $1 AND user_id = $2
        `, [brandId, previousAgentId]);
      }
    }

    // Step 5: Update ticket assignment and status
    await client.query(`
      UPDATE tickets
      SET
        assigned_agent_id = $1,
        status = 'Human Agent Active',
        human_requested = TRUE,
        last_updated = NOW()
      WHERE brand_id = $2 AND id = $3
    `, [targetAgentId, brandId, ticketId]);

    // Step 6: Update or create assigned queue row
    if (activeQueueRow) {
      await client.query(`
        UPDATE ticket_routing_queue
        SET
          status = 'assigned',
          assigned_agent_id = $1,
          assigned_at = NOW()
        WHERE id = $2
      `, [targetAgentId, activeQueueRow.id]);
    } else {
      const queueId = `q_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      await client.query(`
        INSERT INTO ticket_routing_queue (
          id, brand_id, ticket_id, customer_id, priority, customer_language, required_skills, status, assigned_agent_id, assigned_at
        ) VALUES ($1, $2, $3, $4, 'High', 'en-US', ARRAY['general_inquiry'], 'assigned', $5, NOW())
      `, [queueId, brandId, ticketId, ticket.customer_id || 'cust_unknown', targetAgentId]);
    }

    // Step 7: Increment target agent capacity
    await client.query(`
      UPDATE agent_profiles
      SET active_ticket_count = active_ticket_count + 1, last_assigned_at = NOW(), updated_at = NOW()
      WHERE brand_id = $1 AND user_id = $2
    `, [brandId, targetAgentId]);

    await client.query('COMMIT');

    return {
      success: true,
      ticketId,
      assignedAgentId: targetAgentId,
      status: 'Human Agent Active'
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export const transferTicket = transferTicketAtomically;
export const resolveTicket = resolveTicketAndReleaseCapacity;

export default {
  maskCustomerPii,
  getUnassignedTickets,
  getMyTickets,
  getTeamOverview,
  getAgentRoster,
  getTicketDetailsWithHistory,
  claimOrReassignTicket,
  transferTicket: transferTicketAtomically,
  resolveTicket: resolveTicketAndReleaseCapacity
};
