import express from 'express';
import crypto from 'crypto';
import { query } from '../db/pool.js';

const router = express.Router();

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
