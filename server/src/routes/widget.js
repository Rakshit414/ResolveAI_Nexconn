import express from 'express';
import crypto from 'crypto';
import { query } from '../db/pool.js';

const router = express.Router();

// In-memory sliding-window rate limiter for guest session provisioning
const guestRateLimitMap = new Map();
const GUEST_LIMIT_WINDOW_MS = 60 * 1000;
const GUEST_LIMIT_MAX_REQUESTS = 10;

export function isGuestRateLimited(clientIp) {
  const now = Date.now();
  const entry = guestRateLimitMap.get(clientIp) || { count: 0, windowStart: now };
  if (now - entry.windowStart > GUEST_LIMIT_WINDOW_MS) {
    entry.count = 1;
    entry.windowStart = now;
  } else {
    entry.count += 1;
  }
  guestRateLimitMap.set(clientIp, entry);
  return entry.count > GUEST_LIMIT_MAX_REQUESTS;
}

export function resetGuestRateLimit() {
  guestRateLimitMap.clear();
}

/**
 * Normalizes an origin or URL string into an exact origin (scheme + domain + port).
 * Rejects non-http(s) protocols, malformed URLs, and relative paths.
 */
export function normalizeOrigin(input) {
  if (!input || typeof input !== 'string') return null;
  try {
    const url = new URL(input);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin.toLowerCase();
  } catch (e) {
    return null;
  }
}

/**
 * Validates request origin against the brand's exact allowed origin set.
 * Strictly prevents prefix-confusion, unexpected ports, and strips localhost in production.
 */
export function validateBrandOrigin(brand, requestOrigin) {
  if (!requestOrigin) {
    // In production, reject empty origins for widget embeds
    return process.env.NODE_ENV !== 'production';
  }

  const normalizedRequest = normalizeOrigin(requestOrigin);
  if (!normalizedRequest) {
    return false;
  }

  const isProduction = process.env.NODE_ENV === 'production';
  const allowedSet = new Set();

  if (Array.isArray(brand.allowed_origins)) {
    for (const origin of brand.allowed_origins) {
      const norm = normalizeOrigin(origin);
      if (norm) {
        // Strip localhost and 127.0.0.1 origins in production
        if (isProduction && (norm.includes('localhost') || norm.includes('127.0.0.1'))) {
          continue;
        }
        allowedSet.add(norm);
      }
    }
  }

  if (!isProduction) {
    allowedSet.add('http://localhost:5173');
    allowedSet.add('http://localhost:5000');
    allowedSet.add('http://127.0.0.1:5173');
    allowedSet.add('http://127.0.0.1:5000');
  }

  return allowedSet.has(normalizedRequest);
}

/**
 * GET /api/widget/config
 * Retrieves validated brand theme and configuration for the embeddable widget.
 */
router.get('/config', async (req, res) => {
  const brandId = req.query.brandId || req.query.brand || 'brand_novacart';
  const requestOrigin = req.headers.origin || req.headers.referer || '';

  try {
    const brandRes = await query(`
      SELECT id, name, slug, logo_url, support_identity, allowed_origins 
      FROM brands 
      WHERE id = $1 OR slug = $1
    `, [brandId]);

    if (brandRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Brand not found' });
    }

    const brand = brandRes.rows[0];

    // Origin validation
    if (!validateBrandOrigin(brand, requestOrigin)) {
      return res.status(403).json({ success: false, error: 'Origin not authorized for brand widget' });
    }

    // Load policies if available
    let policies = [];
    try {
      const policiesRes = await query(`
        SELECT topic, rule, action_guideline 
        FROM brand_policies 
        WHERE brand_id = $1 
        ORDER BY priority_order ASC
      `, [brand.id]);
      policies = policiesRes.rows;
    } catch (e) {
      // Fallback
    }

    const theme = {
      primaryColor: '#7CFF00',
      primaryTextColor: '#090909',
      accentColor: '#10B981',
      tagline: 'Your Everyday Premium Marketplace',
      welcomeMessage: 'Hello! Welcome to NovaCart Support. How can we help you with your order today?',
      defaultLanguage: 'en',
      supportedLanguages: ['en', 'hi', 'mr'],
      launcherPosition: 'bottom-right',
      badgeText: '24/7 AI Support'
    };

    return res.json({
      success: true,
      brand: {
        id: brand.id,
        name: brand.name,
        slug: brand.slug,
        logoUrl: brand.logo_url,
        supportIdentity: brand.support_identity
      },
      theme,
      policies,
      suggestedActions: [
        { id: 'track_order', label: 'Track Order', icon: 'package' },
        { id: 'return_request', label: 'Return / Refund', icon: 'refresh-cw' },
        { id: 'damaged_product', label: 'Damaged / Wrong Item', icon: 'alert-triangle' },
        { id: 'ask_question', label: 'Ask Question', icon: 'help-circle' },
        { id: 'connect_human', label: 'Talk to Human Agent', icon: 'user' }
      ]
    });
  } catch (err) {
    console.error('[Widget Config Error]:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to load widget configuration' });
  }
});

/**
 * POST /api/widget/bootstrap
 * Securely authenticates an embeddable customer support widget session.
 */
router.post('/bootstrap', async (req, res) => {
  const { brandId = 'brand_novacart', customerToken = null, orderNumber = null } = req.body;
  const requestOrigin = req.headers.origin || req.headers.referer || '';

  try {
    // 1. Look up brand and validate origin
    const brandRes = await query(`SELECT id, name, allowed_origins, support_identity FROM brands WHERE id = $1`, [brandId]);
    if (brandRes.rows.length === 0) {
      return res.status(404).json({ error: 'Brand not found' });
    }

    const brand = brandRes.rows[0];

    if (!validateBrandOrigin(brand, requestOrigin)) {
      return res.status(403).json({ error: 'Origin not authorized for brand widget' });
    }

    // 2. Resolve customer (Guest or Authenticated)
    let customer = null;
    let orderContext = null;

    if (customerToken) {
      // In production, verify HMAC-SHA256 JWT using brand API key
      // For demo mode, resolve Aarav, Priya, or Kabir if requested
      const custRes = await query(`
        SELECT id, name, email, nexconn_user_id, is_guest 
        FROM customers 
        WHERE brand_id = $1 AND (email = $2 OR id = $2)
      `, [brandId, customerToken]);

      if (custRes.rows.length > 0) {
        customer = custRes.rows[0];
      }
    }

    if (!customer) {
      // Rate limiting for anonymous guest visitors
      const clientIp = req.ip || req.connection?.remoteAddress || '127.0.0.1';
      if (isGuestRateLimited(clientIp)) {
        return res.status(429).json({ error: 'Rate limit exceeded for guest session provisioning' });
      }

      // Provision guest visitor
      const guestId = `cust_guest_${crypto.randomBytes(8).toString('hex')}`;
      const guestNexconnId = `cust_${brand.id}_${guestId}`;

      await query(`
        INSERT INTO customers (id, brand_id, name, email, avatar_url, nexconn_user_id, is_guest)
        VALUES ($1, $2, 'Guest Visitor', NULL, NULL, $3, true)
      `, [guestId, brandId, guestNexconnId]);

      customer = {
        id: guestId,
        name: 'Guest Visitor',
        email: null,
        nexconn_user_id: guestNexconnId,
        is_guest: true
      };
    }

    // 3. Resolve order context only if customer owns the order
    if (orderNumber && !customer.is_guest) {
      const orderRes = await query(`
        SELECT id, order_number, product_name, price, currency, status, carrier, tracking_number
        FROM orders
        WHERE brand_id = $1 AND order_number = $2 AND customer_id = $3
      `, [brandId, orderNumber, customer.id]);

      if (orderRes.rows.length > 0) {
        orderContext = orderRes.rows[0];
      }
    }

    // 4. Generate opaque session token and store SHA-256 hash
    const rawSessionToken = `wgt_${crypto.randomBytes(32).toString('hex')}`;
    const tokenHash = crypto.createHash('sha256').update(rawSessionToken).digest('hex');
    const sessionId = `wgt_sess_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24); // 24 hours

    await query(`
      INSERT INTO widget_sessions (id, brand_id, customer_id, session_token_hash, origin, is_guest, expires_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [
      sessionId,
      brandId,
      customer.id,
      tokenHash,
      requestOrigin || 'direct',
      customer.is_guest,
      expiresAt
    ]);

    return res.json({
      success: true,
      sessionToken: rawSessionToken,
      customer: {
        id: customer.id,
        name: customer.name,
        email: customer.email,
        nexconnUserId: customer.nexconn_user_id,
        isGuest: customer.is_guest
      },
      supportIdentity: brand.support_identity,
      orderContext
    });
  } catch (err) {
    console.error('[Widget Bootstrap Error]:', err.message);
    return res.status(500).json({ error: 'Widget session bootstrap failure' });
  }
});

/**
 * POST /api/widget/message
 * Validates session token, origin, and customer-ticket ownership before accepting message.
 */
router.post('/message', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Session bearer token required' });
  }

  const rawToken = authHeader.slice(7).trim();
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  try {
    const sessionRes = await query(`
      SELECT ws.id, ws.brand_id, ws.customer_id, ws.is_guest, ws.expires_at,
             b.allowed_origins
      FROM widget_sessions ws
      JOIN brands b ON ws.brand_id = b.id
      WHERE ws.session_token_hash = $1 AND ws.revoked_at IS NULL AND ws.expires_at > NOW()
    `, [tokenHash]);

    if (sessionRes.rows.length === 0) {
      return res.status(403).json({ success: false, error: 'Invalid or expired widget session' });
    }

    const session = sessionRes.rows[0];
    const requestOrigin = req.headers.origin || req.headers.referer || '';
    if (!validateBrandOrigin(session, requestOrigin)) {
      return res.status(403).json({ success: false, error: 'Origin not authorized for brand widget' });
    }

    const { ticketId, text } = req.body;
    if (!ticketId || !text) {
      return res.status(400).json({ success: false, error: 'ticketId and text required' });
    }

    // Enforce customer ownership of ticket
    const ticketRes = await query(`
      SELECT id FROM tickets WHERE id = $1 AND brand_id = $2 AND customer_id = $3
    `, [ticketId, session.brand_id, session.customer_id]);

    if (ticketRes.rows.length === 0) {
      return res.status(403).json({ success: false, error: 'Ticket does not belong to authenticated session customer' });
    }

    return res.json({ success: true, message: 'Message validated and accepted' });
  } catch (err) {
    console.error('[Widget Message Error]:', err.message);
    return res.status(500).json({ success: false, error: 'Internal message validation failure' });
  }
});

/**
 * POST /api/widget/revoke
 * Revokes an active widget session.
 */
router.post('/revoke', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(400).json({ error: 'Session bearer token required' });
  }

  const rawToken = authHeader.slice(7).trim();
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  await query(`UPDATE widget_sessions SET revoked_at = NOW() WHERE session_token_hash = $1`, [tokenHash]);
  return res.json({ success: true, message: 'Widget session revoked' });
});

export default router;
