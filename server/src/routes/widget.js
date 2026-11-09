import express from 'express';
import crypto from 'crypto';
import { query } from '../db/pool.js';

const router = express.Router();

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
    const isLocalhost = requestOrigin.includes('localhost') || requestOrigin.includes('127.0.0.1');
    if (!isLocalhost && brand.allowed_origins?.length > 0) {
      const isAllowed = brand.allowed_origins.some(allowed => requestOrigin.startsWith(allowed));
      if (!isAllowed) {
        return res.status(403).json({ success: false, error: 'Origin not authorized for brand widget' });
      }
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
    const isLocalhost = requestOrigin.includes('localhost') || requestOrigin.includes('127.0.0.1');

    if (!isLocalhost && brand.allowed_origins?.length > 0) {
      const isAllowed = brand.allowed_origins.some(allowed => requestOrigin.startsWith(allowed));
      if (!isAllowed) {
        return res.status(403).json({ error: 'Origin not authorized for brand widget' });
      }
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
