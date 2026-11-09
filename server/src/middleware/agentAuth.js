import crypto from 'crypto';
import { query } from '../db/pool.js';

/**
 * Robust Agent Authentication & RBAC Middleware
 * Enforces session validity, membership deactivation checks, and CSRF protection on state mutations.
 */
export async function requireAgentAuth(req, res, next) {
  // Extract token from Cookie or Bearer header
  let rawToken = null;
  if (req.headers.cookie) {
    const match = req.headers.cookie.match(/resolve_agent_session=([^;]+)/);
    if (match) rawToken = match[1];
  }
  if (!rawToken && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    rawToken = req.headers.authorization.slice(7).trim();
  }

  // Reject customer widget tokens
  if (rawToken && rawToken.startsWith('wgt_')) {
    return res.status(403).json({ error: 'Customer widget tokens are not authorized for agent endpoints.' });
  }

  // In demo development mode when no DB session is configured and no token passed:
  if (!rawToken && process.env.NODE_ENV !== 'production' && !process.env.DATABASE_URL) {
    req.agent = {
      id: 'user_sarah_lin',
      brandId: 'brand_novacart',
      name: 'Sarah Lin',
      role: 'agent'
    };
    return next();
  }

  if (!rawToken) {
    return res.status(401).json({ error: 'Agent authentication required.' });
  }

  try {
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    // Query session joined with brand_memberships to verify deactivation status
    const sessionRes = await query(`
      SELECT 
        s.id AS session_id,
        s.user_id,
        s.brand_id,
        s.csrf_token,
        m.role,
        m.deactivated_at,
        u.name,
        u.email
      FROM agent_sessions s
      JOIN brand_memberships m ON s.brand_id = m.brand_id AND s.user_id = m.user_id
      JOIN users u ON s.user_id = u.id
      WHERE s.session_token_hash = $1
        AND s.revoked_at IS NULL
        AND s.expires_at > NOW()
    `, [tokenHash]);

    if (sessionRes.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid, expired, or revoked agent session.' });
    }

    const session = sessionRes.rows[0];

    // Enforce membership deactivation
    if (session.deactivated_at) {
      return res.status(403).json({ error: 'Agent membership has been deactivated.' });
    }

    // CSRF check on state-changing methods
    const mutationMethods = ['POST', 'PATCH', 'PUT', 'DELETE'];
    if (mutationMethods.includes(req.method.toUpperCase())) {
      const csrfHeader = req.headers['x-csrf-token'];
      if (!csrfHeader || csrfHeader !== session.csrf_token) {
        return res.status(403).json({ error: 'CSRF token validation failed.' });
      }
    }

    req.agent = {
      id: session.user_id,
      brandId: session.brand_id,
      name: session.name,
      email: session.email,
      role: session.role
    };

    next();
  } catch (err) {
    console.error('[AgentAuth Middleware Error]:', err.message);
    return res.status(500).json({ error: 'Authentication verification failure.' });
  }
}

export default {
  requireAgentAuth
};
