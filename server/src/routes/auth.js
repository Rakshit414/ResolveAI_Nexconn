import express from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { query } from '../db/pool.js';
import { requireAgentAuth } from '../middleware/agentAuth.js';

const router = express.Router();

/**
 * POST /api/auth/agent/login
 * Authenticates Sarah Lin or registered brand agents.
 */
router.post('/agent/login', async (req, res) => {
  const { email, password, brandId = 'brand_novacart' } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  // Production security gate
  if (process.env.NODE_ENV === 'production' && !process.env.AGENT_JWT_SECRET) {
    console.error('[FATAL] AGENT_JWT_SECRET is required in production.');
    return res.status(500).json({ error: 'Server security configuration missing.' });
  }

  try {
    // 1. Look up user and active membership
    const userRes = await query(`
      SELECT 
        u.id, u.email, u.name, u.password_hash,
        m.role, m.deactivated_at
      FROM users u
      JOIN brand_memberships m ON u.id = m.user_id AND m.brand_id = $1
      WHERE u.email = $2
    `, [brandId, email.toLowerCase().trim()]);

    if (userRes.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials or brand membership.' });
    }

    const user = userRes.rows[0];

    // 2. Enforce active membership
    if (user.deactivated_at) {
      return res.status(403).json({ error: 'This agent account has been deactivated.' });
    }

    // 3. Verify bcrypt password
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    // 4. Generate opaque session token and CSRF token
    const sessionToken = `agent_sess_${crypto.randomBytes(32).toString('hex')}`;
    const sessionTokenHash = crypto.createHash('sha256').update(sessionToken).digest('hex');
    const csrfToken = crypto.randomBytes(24).toString('hex');
    const sessionId = `sess_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 8); // 8 hours

    await query(`
      INSERT INTO agent_sessions (id, brand_id, user_id, session_token_hash, csrf_token, ip_address, user_agent, expires_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [
      sessionId,
      brandId,
      user.id,
      sessionTokenHash,
      csrfToken,
      req.ip || '127.0.0.1',
      req.headers['user-agent'] || 'unknown',
      expiresAt
    ]);

    // 5. Set secure HttpOnly cookie
    res.cookie('resolve_agent_session', sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 1000 * 60 * 60 * 8, // 8 hours
      path: '/'
    });

    return res.json({
      success: true,
      csrfToken,
      agent: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        brandId
      }
    });
  } catch (err) {
    console.error('[Agent Login Error]:', err.message);
    return res.status(500).json({ error: 'Internal authentication failure.' });
  }
});

/**
 * POST /api/auth/agent/logout
 * Revokes active agent session and clears cookie.
 */
router.post('/agent/logout', async (req, res) => {
  let rawToken = null;
  if (req.headers.cookie) {
    const match = req.headers.cookie.match(/resolve_agent_session=([^;]+)/);
    if (match) rawToken = match[1];
  }

  if (rawToken) {
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    await query(`UPDATE agent_sessions SET revoked_at = NOW() WHERE session_token_hash = $1`, [tokenHash]).catch(() => {});
  }

  res.clearCookie('resolve_agent_session', { path: '/' });
  return res.json({ success: true, message: 'Logged out successfully.' });
});

/**
 * GET /api/auth/agent/me
 * Returns current authenticated agent profile.
 */
router.get('/agent/me', requireAgentAuth, (req, res) => {
  return res.json({
    success: true,
    agent: req.agent
  });
});

export default router;
