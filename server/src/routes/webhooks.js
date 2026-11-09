import express from 'express';
import crypto from 'crypto';
import { query } from '../db/pool.js';

const router = express.Router();

/**
 * Constant-time string equality check to prevent timing attacks
 */
function constantTimeEquals(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Extracts text and correlation identifiers from Nexconn content string/object
 */
export function extractCorrelationData(event) {
  let contentObj = {};
  try {
    contentObj = typeof event.content === 'string' ? JSON.parse(event.content) : (event.content || {});
  } catch (e) {
    contentObj = { content: event.content };
  }

  let extraObj = {};
  if (contentObj?.extra) {
    try {
      extraObj = typeof contentObj.extra === 'string' ? JSON.parse(contentObj.extra) : contentObj.extra;
    } catch (e) {
      extraObj = {};
    }
  }

  return {
    text: contentObj?.content || '',
    ticketId: extraObj?.ticketId || null,
    outboxId: extraObj?.outboxId || null,
    brandId: extraObj?.brandId || null
  };
}

/**
 * POST /api/webhooks/nexconn/message
 * Official Nexconn message:send webhook endpoint with signature validation and deduplication.
 */
router.post('/nexconn/message', async (req, res) => {
  const nonce = req.headers['nonce'];
  const timestamp = req.headers['timestamp'];
  const signature = req.headers['signature'];
  const appSecret = process.env.NEXCONN_APP_SECRET;

  if (!nonce || !timestamp || !signature || !appSecret) {
    return res.status(401).json({ error: 'Missing webhook security headers or app secret' });
  }

  // 1. Nonce length check (<= 18 chars)
  if (nonce.length > 18) {
    return res.status(400).json({ error: 'Nonce exceeds maximum length of 18 characters' });
  }

  // 2. Timestamp freshness check (|now - ts| < 300,000 ms)
  const timestampMs = Number(timestamp);
  if (isNaN(timestampMs) || Math.abs(Date.now() - timestampMs) > 300000) {
    return res.status(400).json({ error: 'Webhook timestamp expired or invalid' });
  }

  // 3. Constant-time signature verification: SHA1(AppSecret + Nonce + Timestamp)
  const expectedSig = crypto
    .createHash('sha1')
    .update(`${appSecret}${nonce}${timestamp}`)
    .digest('hex');

  if (!constantTimeEquals(expectedSig, signature)) {
    return res.status(401).json({ error: 'Invalid Nexconn webhook signature' });
  }

  // 4. Support single object or array payloads
  const events = Array.isArray(req.body) 
    ? req.body 
    : Array.isArray(req.body?.data) 
    ? req.body.data 
    : [req.body];

  const results = [];

  for (const event of events) {
    const eventId = event.msgUID || event.messageId;
    if (!eventId) continue;

    try {
      // 5. Durable Event Deduplication via webhook_receipts
      const existing = await query(`SELECT event_id FROM webhook_receipts WHERE event_id = $1`, [eventId]);
      if (existing.rows && existing.rows.length > 0) {
        // Duplicate event already recorded
        results.push({ eventId, status: 'duplicate_skipped' });
        continue;
      }

      await query(`
        INSERT INTO webhook_receipts (event_id, event_type, raw_payload, signature, nonce, timestamp_ms, processing_status)
        VALUES ($1, $2, $3, $4, $5, $6, 'received')
        ON CONFLICT (event_id) DO NOTHING
      `, [eventId, event.event || 'message:send', JSON.stringify(event), signature, nonce, timestampMs]);

      // 6. Brand lookup by recipient support identity
      const brandRes = await query(`SELECT id FROM brands WHERE support_identity = $1`, [event.toUserId]);

      if (brandRes.rows.length === 0) {
        // Global Quarantine for unrecognized brands (brand_id = NULL)
        await query(`
          INSERT INTO unrouted_messages (
            id, brand_id, sender_user_id, recipient_user_id, nexconn_message_id,
            message_type, message_text, content_payload, ambiguity_reason
          )
          VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, 'UNRECOGNIZED_BRAND')
        `, [
          `unr_${eventId}`,
          event.fromUserId,
          event.toUserId,
          eventId,
          event.objectName || 'RC:TxtMsg',
          event.content,
          JSON.stringify(event)
        ]);
        results.push({ eventId, status: 'quarantined_unknown_brand' });
        continue;
      }

      const brandId = brandRes.rows[0].id;
      const { text, ticketId } = extractCorrelationData(event);

      // 7. Ticket Correlation Strategy
      let resolvedTicketId = null;

      if (ticketId) {
        // Validate that ticketId belongs to this brand and sender customer
        const ticketCheck = await query(`
          SELECT t.id 
          FROM tickets t
          JOIN customers c ON t.customer_id = c.id AND t.brand_id = c.brand_id
          WHERE t.id = $1 AND t.brand_id = $2 AND c.nexconn_user_id = $3
        `, [ticketId, brandId, event.fromUserId]);

        if (ticketCheck.rows.length > 0) {
          resolvedTicketId = ticketId;
        }
      }

      if (!resolvedTicketId) {
        // Query active tickets for this customer
        const activeTicketsRes = await query(`
          SELECT t.id 
          FROM tickets t
          JOIN customers c ON t.customer_id = c.id AND t.brand_id = c.brand_id
          WHERE t.brand_id = $1 
            AND c.nexconn_user_id = $2 
            AND t.status IN ('AI Handling', 'Human Requested', 'Human Agent Active')
          ORDER BY t.last_updated DESC
        `, [brandId, event.fromUserId]);

        const activeTickets = activeTicketsRes.rows;

        if (activeTickets.length === 1) {
          resolvedTicketId = activeTickets[0].id;
        } else if (activeTickets.length > 1) {
          // AMBIGUOUS: Multiple active tickets — do NOT guess!
          await query(`
            INSERT INTO unrouted_messages (
              id, brand_id, sender_user_id, recipient_user_id, nexconn_message_id,
              message_type, message_text, content_payload, ambiguity_reason, candidate_ticket_ids
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'MULTIPLE_ACTIVE_TICKETS', $9)
          `, [
            `unr_${eventId}`,
            brandId,
            event.fromUserId,
            event.toUserId,
            eventId,
            event.objectName || 'RC:TxtMsg',
            text,
            JSON.stringify(event),
            activeTickets.map(t => t.id)
          ]);
          results.push({ eventId, status: 'unrouted_ambiguous' });
          continue;
        } else {
          // NO ACTIVE TICKET
          await query(`
            INSERT INTO unrouted_messages (
              id, brand_id, sender_user_id, recipient_user_id, nexconn_message_id,
              message_type, message_text, content_payload, ambiguity_reason
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'NO_ACTIVE_TICKET')
          `, [
            `unr_${eventId}`,
            brandId,
            event.fromUserId,
            event.toUserId,
            eventId,
            event.objectName || 'RC:TxtMsg',
            text,
            JSON.stringify(event)
          ]);
          results.push({ eventId, status: 'unrouted_no_ticket' });
          continue;
        }
      }

      // 8. Correlated: Persist directly into message_archive
      await query(`
        INSERT INTO message_archive (
          id, brand_id, ticket_id, nexconn_message_id, sender_user_id, target_user_id,
          sender_role, sender_name, message_type, message_text, content_payload
        )
        VALUES ($1, $2, $3, $4, $5, $6, 'customer', 'Customer', $7, $8, $9)
        ON CONFLICT (nexconn_message_id) DO NOTHING
      `, [
        `arch_${eventId}`,
        brandId,
        resolvedTicketId,
        eventId,
        event.fromUserId,
        event.toUserId,
        event.objectName || 'RC:TxtMsg',
        text,
        JSON.stringify(event)
      ]);

      // Update ticket last_updated timestamp
      await query(`UPDATE tickets SET last_updated = NOW() WHERE id = $1 AND brand_id = $2`, [resolvedTicketId, brandId]);

      results.push({ eventId, status: 'archived', ticketId: resolvedTicketId });
    } catch (err) {
      console.error(`[Webhook Process Error on ${eventId}]:`, err.message);
      results.push({ eventId, status: 'error', error: err.message });
    }
  }

  // 9. Return 200 OK immediately after persistence
  return res.status(200).json({ success: true, processed: results });
});

export default router;
