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
export function extractCorrelationData(eventData) {
  let contentObj = {};
  try {
    contentObj = typeof eventData.content === 'string' ? JSON.parse(eventData.content) : (eventData.content || {});
  } catch (e) {
    contentObj = { content: eventData.content };
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
 * Validates Nexconn webhook headers according to official specification:
 * Signature = SHA1(AppSecret + Nonce + Timestamp)
 */
export function validateWebhookHeaders(headers, appKeyEnv, appSecretEnv) {
  const reqAppKey = headers['app-key'] || headers['appkey'];
  const nonce = headers['nonce'];
  const timestamp = headers['timestamp'];
  const signature = headers['signature'];

  if (!reqAppKey || !nonce || !timestamp || !signature) {
    return { valid: false, status: 401, error: 'Missing required Nexconn webhook headers (App-Key, Nonce, Timestamp, Signature)' };
  }

  // 1. Validate App-Key matches registered Nexconn Application Key
  if (appKeyEnv && reqAppKey !== appKeyEnv) {
    return { valid: false, status: 401, error: 'App-Key header does not match configured Nexconn application key' };
  }

  // 2. Nonce length check (<= 18 chars per Nexconn specification)
  if (nonce.length > 18) {
    return { valid: false, status: 400, error: 'Nonce exceeds maximum allowed length of 18 characters' };
  }

  // 3. Timestamp freshness check (|now - ts| <= 300,000 ms = 5 minutes)
  const timestampMs = Number(timestamp);
  if (isNaN(timestampMs) || Math.abs(Date.now() - timestampMs) > 300000) {
    return { valid: false, status: 400, error: 'Webhook timestamp expired or outside freshness tolerance (+/- 5 min)' };
  }

  // 4. Constant-time signature verification: SHA1(AppSecret + Nonce + Timestamp)
  const expectedSig = crypto
    .createHash('sha1')
    .update(`${appSecretEnv}${nonce}${timestamp}`)
    .digest('hex');

  if (!constantTimeEquals(expectedSig, signature)) {
    return { valid: false, status: 401, error: 'Invalid Nexconn webhook signature' };
  }

  return { valid: true, timestampMs, nonce, signature };
}

/**
 * Normalizes incoming request into an array of canonical webhook envelopes:
 * Each item has: { type, id, time, data }
 */
export function parseWebhookEnvelopes(body, timestampMs) {
  if (!body) return [];

  // Case A: Array of envelopes [{ type, id, time, data }, ...]
  if (Array.isArray(body)) {
    return body.map(item => ({
      type: item.type || item.event || 'message:send',
      id: item.id || item.msgUID || item.messageId || `evt_${crypto.randomBytes(8).toString('hex')}`,
      time: item.time || timestampMs,
      data: item.data || item
    }));
  }

  // Case B: Single envelope with batched data array { type, id, time, data: [...] }
  if (body.type && Array.isArray(body.data)) {
    return body.data.map(d => ({
      type: body.type,
      id: d.msgUID || d.messageId || d.id || `${body.id}_${crypto.randomBytes(4).toString('hex')}`,
      time: body.time || timestampMs,
      data: d
    }));
  }

  // Case C: Single envelope { type, id, time, data }
  if (body.type && body.data) {
    return [{
      type: body.type,
      id: body.id || body.data.msgUID || body.data.messageId || `evt_${crypto.randomBytes(8).toString('hex')}`,
      time: body.time || timestampMs,
      data: body.data
    }];
  }

  // Case D: Direct event payload (e.g. direct message payload)
  const directId = body.msgUID || body.messageId || body.id || `evt_${crypto.randomBytes(8).toString('hex')}`;
  return [{
    type: body.event || 'message:send',
    id: directId,
    time: body.time || timestampMs,
    data: body
  }];
}

/**
 * Core Webhook Processing Handler
 */
export async function handleNexconnWebhook(req, res) {
  const appKey = process.env.NEXCONN_APP_KEY;
  const appSecret = process.env.NEXCONN_APP_SECRET;

  if (!appSecret) {
    return res.status(500).json({ error: 'NEXCONN_APP_SECRET not configured on server' });
  }

  // 1. Validate security headers
  const validation = validateWebhookHeaders(req.headers, appKey, appSecret);
  if (!validation.valid) {
    return res.status(validation.status).json({ error: validation.error });
  }

  const { timestampMs, nonce, signature } = validation;

  // 2. Parse envelopes (supporting batched delivery)
  const envelopes = parseWebhookEnvelopes(req.body, timestampMs);
  const results = [];

  for (const env of envelopes) {
    const eventId = env.id;
    const eventType = env.type;
    const eventData = env.data;

    try {
      // 3. Durable Event Deduplication via webhook_receipts
      const existing = await query(`SELECT event_id, processing_status FROM webhook_receipts WHERE event_id = $1`, [eventId]);
      if (existing.rows && existing.rows.length > 0) {
        results.push({ eventId, type: eventType, status: 'duplicate_skipped' });
        continue;
      }

      // Record receipt in ledger
      await query(`
        INSERT INTO webhook_receipts (event_id, event_type, raw_payload, signature, nonce, timestamp_ms, processing_status)
        VALUES ($1, $2, $3, $4, $5, $6, 'received')
        ON CONFLICT (event_id) DO NOTHING
      `, [eventId, eventType, JSON.stringify(env), signature, nonce, timestampMs]);

      // 4. Handle event by type
      if (eventType === 'user:connection_status' || eventType.includes('connection_status')) {
        // User online/offline connection status event
        const targetUserId = eventData.userId || eventData.fromUserId;
        const onlineStatus = eventData.status === 0 || eventData.status === 'online' ? 'online' : 'offline';

        await query(`
          UPDATE webhook_receipts 
          SET processing_status = 'processed', processed_at = NOW() 
          WHERE event_id = $1
        `, [eventId]);

        results.push({ eventId, type: eventType, userId: targetUserId, status: onlineStatus, processed: true });
        continue;
      }

      if (eventType === 'message:send' || eventType.includes('message')) {
        // Message event handling
        const recipientUserId = eventData.toUserId || (Array.isArray(eventData.toUserIds) ? eventData.toUserIds[0] : null);
        const senderUserId = eventData.fromUserId;

        // Brand lookup by recipient support identity
        const brandRes = await query(`SELECT id FROM brands WHERE support_identity = $1`, [recipientUserId]);

        if (brandRes.rows.length === 0) {
          // Global Quarantine for unrecognized brands (brand_id = NULL)
          await query(`
            INSERT INTO unrouted_messages (
              id, brand_id, sender_user_id, recipient_user_id, nexconn_message_id,
              message_type, message_text, content_payload, ambiguity_reason
            )
            VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, 'UNRECOGNIZED_BRAND')
            ON CONFLICT (nexconn_message_id) DO NOTHING
          `, [
            `unr_${eventId}`,
            senderUserId,
            recipientUserId,
            eventId,
            eventData.objectName || 'RC:TxtMsg',
            eventData.content,
            JSON.stringify(eventData)
          ]);

          await query(`UPDATE webhook_receipts SET processing_status = 'processed', processed_at = NOW() WHERE event_id = $1`, [eventId]);
          results.push({ eventId, type: eventType, status: 'quarantined_unrecognized_brand' });
          continue;
        }

        const brandId = brandRes.rows[0].id;
        const { text, ticketId } = extractCorrelationData(eventData);

        // Ticket Correlation Strategy
        let resolvedTicketId = null;

        if (ticketId) {
          const ticketCheck = await query(`
            SELECT t.id 
            FROM tickets t
            JOIN customers c ON t.customer_id = c.id AND t.brand_id = c.brand_id
            WHERE t.id = $1 AND t.brand_id = $2 AND c.nexconn_user_id = $3
          `, [ticketId, brandId, senderUserId]);

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
          `, [brandId, senderUserId]);

          const activeTickets = activeTicketsRes.rows;

          if (activeTickets.length === 1) {
            resolvedTicketId = activeTickets[0].id;
          } else if (activeTickets.length > 1) {
            // AMBIGUOUS: Multiple active tickets -> Quarantine
            await query(`
              INSERT INTO unrouted_messages (
                id, brand_id, sender_user_id, recipient_user_id, nexconn_message_id,
                message_type, message_text, content_payload, ambiguity_reason, candidate_ticket_ids
              )
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'MULTIPLE_ACTIVE_TICKETS', $9)
              ON CONFLICT (nexconn_message_id) DO NOTHING
            `, [
              `unr_${eventId}`,
              brandId,
              senderUserId,
              recipientUserId,
              eventId,
              eventData.objectName || 'RC:TxtMsg',
              text,
              JSON.stringify(eventData),
              activeTickets.map(t => t.id)
            ]);

            await query(`UPDATE webhook_receipts SET processing_status = 'processed', processed_at = NOW() WHERE event_id = $1`, [eventId]);
            results.push({ eventId, type: eventType, status: 'unrouted_ambiguous' });
            continue;
          } else {
            // NO ACTIVE TICKET -> Quarantine
            await query(`
              INSERT INTO unrouted_messages (
                id, brand_id, sender_user_id, recipient_user_id, nexconn_message_id,
                message_type, message_text, content_payload, ambiguity_reason
              )
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'NO_ACTIVE_TICKET')
              ON CONFLICT (nexconn_message_id) DO NOTHING
            `, [
              `unr_${eventId}`,
              brandId,
              senderUserId,
              recipientUserId,
              eventId,
              eventData.objectName || 'RC:TxtMsg',
              text,
              JSON.stringify(eventData)
            ]);

            await query(`UPDATE webhook_receipts SET processing_status = 'processed', processed_at = NOW() WHERE event_id = $1`, [eventId]);
            results.push({ eventId, type: eventType, status: 'unrouted_no_ticket' });
            continue;
          }
        }

        // Correlated: Persist directly into message_archive
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
          senderUserId,
          recipientUserId,
          eventData.objectName || 'RC:TxtMsg',
          text,
          JSON.stringify(eventData)
        ]);

        await query(`UPDATE tickets SET last_updated = NOW() WHERE id = $1 AND brand_id = $2`, [resolvedTicketId, brandId]);
        await query(`UPDATE webhook_receipts SET processing_status = 'processed', processed_at = NOW() WHERE event_id = $1`, [eventId]);

        results.push({ eventId, type: eventType, status: 'archived', ticketId: resolvedTicketId });
        continue;
      }

      // Generic event fallback
      await query(`UPDATE webhook_receipts SET processing_status = 'processed', processed_at = NOW() WHERE event_id = $1`, [eventId]);
      results.push({ eventId, type: eventType, status: 'processed_generic' });
    } catch (err) {
      console.error(`[Webhook Process Error on ${eventId}]:`, err.message);
      await query(`UPDATE webhook_receipts SET processing_status = 'failed', error_message = $2 WHERE event_id = $1`, [eventId, err.message]).catch(() => {});
      results.push({ eventId, type: eventType, status: 'error', error: err.message });
    }
  }

  return res.status(200).json({ success: true, processed: results });
}

// Register endpoints for both standard /nexconn and legacy /nexconn/message
router.post('/nexconn', handleNexconnWebhook);
router.post('/nexconn/message', handleNexconnWebhook);

export default router;
