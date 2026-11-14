// server/src/services/agentAvailabilityService.js
import crypto from 'crypto';
import { getPool } from '../db/pool.js';
import { dispatchSchedulingOpportunity } from './multiTenantScheduler.js';
import { reconcileAgentCapacity } from './capacityService.js';

export const HEARTBEAT_INTERVAL_MS = 20000; // 20 seconds
export const HEARTBEAT_STALE_MS = 60000;    // 60 seconds (stale threshold)

/**
 * Dynamically computes an agent's effective status.
 * Evaluates configured status, heartbeat freshness, active session, and committed capacity.
 */
export function calculateEffectiveStatus({
  configuredStatus,
  activeTicketCount,
  maxConcurrentTickets,
  lastHeartbeatAt,
  isSessionActive = true,
  isDeactivated = false
}) {
  if (isDeactivated) {
    return 'Offline';
  }

  if (!isSessionActive) {
    return 'Offline';
  }

  if (!lastHeartbeatAt) {
    return 'Offline';
  }

  const heartbeatAge = Date.now() - new Date(lastHeartbeatAt).getTime();
  if (heartbeatAge > HEARTBEAT_STALE_MS) {
    return 'Offline';
  }

  if (configuredStatus === 'Offline') {
    return 'Offline';
  }

  if (configuredStatus === 'Busy') {
    return 'Busy';
  }

  if (configuredStatus === 'Away') {
    return 'Away';
  }

  if (configuredStatus === 'Available') {
    if (activeTicketCount >= maxConcurrentTickets) {
      return 'At Capacity';
    }
    return 'Available';
  }

  return 'Offline';
}

/**
 * Fetches an agent profile with calculated effective status.
 */
export async function getAgentProfile(brandId, userId, { client: externalClient = null } = {}) {
  const pool = getPool();
  const client = externalClient || pool;

  const res = await client.query(`
    SELECT
      ap.brand_id,
      ap.user_id,
      ap.nexconn_user_id,
      ap.display_name,
      ap.avatar_url,
      ap.configured_status,
      ap.status_reason,
      ap.primary_language,
      ap.supported_languages,
      ap.skills,
      ap.max_concurrent_tickets,
      ap.active_ticket_count,
      ap.last_assigned_at,
      ap.last_heartbeat_at,
      ap.created_at,
      ap.updated_at,
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
    WHERE ap.brand_id = $1 AND ap.user_id = $2
  `, [brandId, userId]);

  if (res.rows.length === 0) {
    return null;
  }

  const row = res.rows[0];
  const effectiveStatus = calculateEffectiveStatus({
    configuredStatus: row.configured_status,
    activeTicketCount: row.active_ticket_count,
    maxConcurrentTickets: row.max_concurrent_tickets,
    lastHeartbeatAt: row.last_heartbeat_at,
    isSessionActive: row.has_active_session,
    isDeactivated: Boolean(row.deactivated_at)
  });

  return {
    ...row,
    effective_status: effectiveStatus
  };
}

/**
 * Changes an agent's configured status.
 * Enforces role authorization, row-level locking, and writes to agent_status_history.
 */
export async function updateAgentConfiguredStatus({
  brandId,
  userId,
  newStatus,
  reason = '',
  triggerSource = 'manual',
  performedByUserId,
  performedByRole
}) {
  const validStatuses = ['Available', 'Busy', 'Away', 'Offline'];
  if (!validStatuses.includes(newStatus)) {
    const err = new Error(`Invalid configured status "${newStatus}". Must be one of: ${validStatuses.join(', ')}`);
    err.statusCode = 400;
    throw err;
  }

  // Authorization: agents can only update self; leads/admins can update any agent in tenant
  if (performedByUserId !== userId && !['support_lead', 'admin'].includes(performedByRole)) {
    const err = new Error('Unauthorized: only support leads or admins may change another agent status');
    err.statusCode = 403;
    throw err;
  }

  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Row lock on agent_profiles
    const lockRes = await client.query(`
      SELECT
        ap.configured_status,
        ap.active_ticket_count,
        ap.max_concurrent_tickets,
        ap.last_heartbeat_at,
        bm.deactivated_at
      FROM agent_profiles ap
      JOIN brand_memberships bm ON ap.brand_id = bm.brand_id AND ap.user_id = bm.user_id
      WHERE ap.brand_id = $1 AND ap.user_id = $2
      FOR UPDATE OF ap
    `, [brandId, userId]);

    if (lockRes.rows.length === 0) {
      const err = new Error(`Agent profile not found for user ${userId}`);
      err.statusCode = 404;
      throw err;
    }

    const current = lockRes.rows[0];
    if (current.deactivated_at) {
      const err = new Error('Cannot change status: agent membership is deactivated');
      err.statusCode = 403;
      throw err;
    }

    const previousStatus = current.configured_status;

    // Idempotent: if no change, commit and return current profile
    if (previousStatus === newStatus) {
      await client.query('COMMIT');
      return await getAgentProfile(brandId, userId);
    }

    // Update agent_profiles
    await client.query(`
      UPDATE agent_profiles
      SET configured_status = $1, status_reason = $2, updated_at = NOW()
      WHERE brand_id = $3 AND user_id = $4
    `, [newStatus, reason || null, brandId, userId]);

    // Insert audit record into agent_status_history
    const historyId = `hist_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    await client.query(`
      INSERT INTO agent_status_history (
        id, brand_id, user_id, previous_status, new_status, trigger_source, reason
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [historyId, brandId, userId, previousStatus, newStatus, triggerSource, reason || `Status changed by ${performedByUserId}`]);

    await client.query('COMMIT');

    // If agent transitioned to Available, dispatch scheduling opportunity
    if (newStatus === 'Available') {
      try {
        dispatchSchedulingOpportunity(brandId);
      } catch (e) {}
    }

    return await getAgentProfile(brandId, userId);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Creates an agent session and returns tokens.
 */
export async function createAgentSession({
  brandId,
  userId,
  ipAddress = '127.0.0.1',
  userAgent = 'unknown'
}) {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Verify membership is active
    const memRes = await client.query(`
      SELECT role, deactivated_at
      FROM brand_memberships
      WHERE brand_id = $1 AND user_id = $2
    `, [brandId, userId]);

    if (memRes.rows.length === 0) {
      const err = new Error('User is not a member of this brand');
      err.statusCode = 403;
      throw err;
    }
    if (memRes.rows[0].deactivated_at) {
      const err = new Error('Account membership has been deactivated');
      err.statusCode = 403;
      throw err;
    }

    const sessionId = `sess_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const rawSessionToken = `agent_sess_${crypto.randomBytes(32).toString('hex')}`;
    const sessionTokenHash = crypto.createHash('sha256').update(rawSessionToken).digest('hex');
    const csrfToken = crypto.randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 12); // 12 hours

    await client.query(`
      INSERT INTO agent_sessions (
        id, brand_id, user_id, session_token_hash, csrf_token, ip_address, user_agent, expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [sessionId, brandId, userId, sessionTokenHash, csrfToken, ipAddress, userAgent, expiresAt]);

    // Update heartbeat to NOW() on session creation
    await client.query(`
      UPDATE agent_profiles
      SET last_heartbeat_at = NOW(), updated_at = NOW()
      WHERE brand_id = $1 AND user_id = $2
    `, [brandId, userId]);

    await client.query('COMMIT');

    const profile = await getAgentProfile(brandId, userId);

    return {
      sessionId,
      sessionToken: rawSessionToken,
      csrfToken,
      expiresAt,
      profile
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Refreshes an agent's heartbeat.
 * Stale threshold is 60 seconds. Must be invoked every ~20 seconds by active clients.
 */
export async function refreshAgentHeartbeat({ brandId, userId, sessionId }) {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Verify session is active and not revoked
    const sessRes = await client.query(`
      SELECT id, expires_at, revoked_at
      FROM agent_sessions
      WHERE id = $1 AND brand_id = $2 AND user_id = $3
      FOR UPDATE
    `, [sessionId, brandId, userId]);

    if (sessRes.rows.length === 0 || sessRes.rows[0].revoked_at || new Date(sessRes.rows[0].expires_at).getTime() < Date.now()) {
      const err = new Error('Session is expired or revoked');
      err.statusCode = 401;
      throw err;
    }

    // Atomically update last_heartbeat_at
    const updRes = await client.query(`
      UPDATE agent_profiles
      SET last_heartbeat_at = NOW(), updated_at = NOW()
      WHERE brand_id = $1 AND user_id = $2
      RETURNING configured_status, active_ticket_count, max_concurrent_tickets, last_heartbeat_at
    `, [brandId, userId]);

    if (updRes.rows.length === 0) {
      const err = new Error('Agent profile not found');
      err.statusCode = 404;
      throw err;
    }

    await client.query('COMMIT');

    const row = updRes.rows[0];
    const effectiveStatus = calculateEffectiveStatus({
      configuredStatus: row.configured_status,
      activeTicketCount: row.active_ticket_count,
      maxConcurrentTickets: row.max_concurrent_tickets,
      lastHeartbeatAt: row.last_heartbeat_at,
      isSessionActive: true,
      isDeactivated: false
    });

    return {
      success: true,
      lastHeartbeatAt: row.last_heartbeat_at,
      effectiveStatus,
      activeTicketCount: row.active_ticket_count,
      maxConcurrentTickets: row.max_concurrent_tickets
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Terminates an agent session (logout).
 */
export async function terminateAgentSession({ brandId, userId, sessionId, setOffline = true }) {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    await client.query(`
      UPDATE agent_sessions
      SET revoked_at = NOW()
      WHERE id = $1 AND brand_id = $2 AND user_id = $3
    `, [sessionId, brandId, userId]);

    if (setOffline) {
      // Check if any other active sessions exist
      const otherRes = await client.query(`
        SELECT COUNT(*)::INTEGER AS active_count
        FROM agent_sessions
        WHERE brand_id = $1 AND user_id = $2 AND revoked_at IS NULL AND expires_at > NOW()
      `, [brandId, userId]);

      if (otherRes.rows[0].active_count === 0) {
        const profRes = await client.query(`
          SELECT configured_status FROM agent_profiles WHERE brand_id = $1 AND user_id = $2 FOR UPDATE
        `, [brandId, userId]);

        if (profRes.rows.length > 0 && profRes.rows[0].configured_status !== 'Offline') {
          const prev = profRes.rows[0].configured_status;
          await client.query(`
            UPDATE agent_profiles SET configured_status = 'Offline', updated_at = NOW() WHERE brand_id = $1 AND user_id = $2
          `, [brandId, userId]);

          const historyId = `hist_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
          await client.query(`
            INSERT INTO agent_status_history (
              id, brand_id, user_id, previous_status, new_status, trigger_source, reason
            ) VALUES ($1, $2, $3, $4, 'Offline', 'manual', 'Session termination / logout')
          `, [historyId, brandId, userId, prev]);
        }
      }
    }

    await client.query('COMMIT');
    return { success: true, terminated: true };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Returns chronological status audit history for an agent.
 */
export async function getAgentStatusHistory({ brandId, userId, limit = 50 }) {
  const pool = getPool();
  const res = await pool.query(`
    SELECT id, brand_id, user_id, previous_status, new_status, trigger_source, reason, created_at
    FROM agent_status_history
    WHERE brand_id = $1 AND user_id = $2
    ORDER BY created_at DESC
    LIMIT $3
  `, [brandId, userId, limit]);

  return res.rows;
}

export default {
  calculateEffectiveStatus,
  getAgentProfile,
  updateAgentConfiguredStatus,
  createAgentSession,
  refreshAgentHeartbeat,
  terminateAgentSession,
  getAgentStatusHistory,
  reconcileAgentCapacity
};
