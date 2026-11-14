import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { query } from '../db/pool.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.resolve(__dirname, '../../data/tickets.json');

class StorageService {
  get isPostgresMode() {
    return Boolean(process.env.DATABASE_URL);
  }

  constructor() {
    if (process.env.NODE_ENV === 'production' && !this.isPostgresMode) {
      console.error('[FATAL CONFIG] DATABASE_URL is strictly required in production mode. Fallback to file storage is disabled.');
    }
  }

  _assertStorageMode() {
    if (process.env.NODE_ENV === 'production' && !this.isPostgresMode) {
      throw new Error('Storage Error: PostgreSQL connection (DATABASE_URL) is strictly required in production mode. JSON storage fallback disabled.');
    }
  }

  // --- ATOMIC JSON FALLBACK METHODS (Strictly for offline test suites) ---
  _readJsonFile() {
    this._assertStorageMode();
    try {
      if (!fs.existsSync(DATA_FILE)) return [];
      const content = fs.readFileSync(DATA_FILE, 'utf8');
      return JSON.parse(content);
    } catch (err) {
      console.error('[StorageService JSON] Error reading data file:', err);
      return [];
    }
  }

  _writeJsonFile(tickets) {
    this._assertStorageMode();
    try {
      const tempFile = `${DATA_FILE}.tmp.${Date.now()}`;
      fs.writeFileSync(tempFile, JSON.stringify(tickets, null, 2), 'utf8');
      fs.renameSync(tempFile, DATA_FILE);
      return true;
    } catch (err) {
      console.error('[StorageService JSON] Error writing data file atomically:', err);
      return false;
    }
  }

  // --- UNIVERSAL STORAGE INTERFACE ---

  async getTickets({ brandId = 'brand_novacart', status = null } = {}) {
    if (this.isPostgresMode) {
      let sql = `
        SELECT
          t.id, t.brand_id AS "brandId", t.order_id AS "orderId",
          o.order_number AS "orderNumber",
          t.category, t.priority, t.sentiment, t.status,
          t.human_requested AS "humanRequested",
          t.summary, t.suggested_reply AS "suggestedReply",
          t.pending_action AS "pendingAction",
          t.assigned_agent_id AS "assignedAgentId",
          t.last_updated AS "lastUpdated",
          json_build_object(
            'id', c.id,
            'name', c.name,
            'email', c.email,
            'avatar', c.avatar_url,
            'nexconnUserId', c.nexconn_user_id,
            'order', json_build_object(
              'orderId', o.order_number,
              'product', o.product_name,
              'image', o.product_image,
              'price', o.price,
              'currency', o.currency,
              'status', o.status,
              'purchaseDate', o.purchase_date,
              'carrier', o.carrier,
              'trackingNumber', o.tracking_number,
              'trackingStatus', o.tracking_status
            )
          ) AS customer
        FROM tickets t
        JOIN customers c ON t.brand_id = c.brand_id AND t.customer_id = c.id
        LEFT JOIN orders o ON t.brand_id = o.brand_id AND t.order_id = o.id
        WHERE t.brand_id = $1
      `;
      const params = [brandId];
      if (status) {
        sql += ` AND t.status = $2`;
        params.push(status);
      }
      sql += ` ORDER BY t.last_updated DESC`;
      const res = await query(sql, params);
      return res.rows;
    }

    // JSON fallback
    let tickets = this._readJsonFile();
    if (status) {
      tickets = tickets.filter(t => t.status === status || (status === 'Human Requested' && t.humanRequested));
    }
    return tickets;
  }

  async getTicketById(id, brandId = 'brand_novacart') {
    if (this.isPostgresMode) {
      const tickets = await this.getTickets({ brandId });
      return tickets.find(t => t.id === id) || null;
    }

    const tickets = this._readJsonFile();
    return tickets.find(t => t.id === id) || null;
  }

  async createTicket({
    brandId = 'brand_novacart',
    customer,
    orderNumber = null,
    category = 'General Support',
    priority = 'Medium',
    sentiment = 'Neutral',
    initialMessage = '',
    idempotencyKey = null,
    requestHash = null
  }) {
    if (this.isPostgresMode) {
      // 1. Check idempotency table if key provided
      if (idempotencyKey) {
        const idemRes = await query(
          `SELECT response_code, response_body, request_hash
           FROM idempotency_keys
           WHERE brand_id = $1 AND idempotency_key = $2`,
          [brandId, idempotencyKey]
        );

        if (idemRes.rows.length > 0) {
          const stored = idemRes.rows[0];
          if (requestHash && stored.request_hash !== requestHash) {
            const err = new Error('Idempotency key reused with mismatched request payload');
            err.statusCode = 409;
            throw err;
          }
          return { cached: true, statusCode: stored.response_code, data: stored.response_body };
        }
      }

      // 2. Resolve or create customer
      let customerId = customer?.id;
      const nexconnUserId = customer?.nexconnUserId || customerId || `cust_${brandId}_${Date.now()}`;

      const custRes = await query(
        `INSERT INTO customers (id, brand_id, name, email, avatar_url, nexconn_user_id, is_guest)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (brand_id, email) DO UPDATE SET name = EXCLUDED.name, avatar_url = EXCLUDED.avatar_url
         RETURNING id, nexconn_user_id`,
        [
          customerId || `cust_${Date.now()}`,
          brandId,
          customer?.name || 'Customer',
          customer?.email || null,
          customer?.avatar || null,
          nexconnUserId,
          !customer?.email
        ]
      );
      customerId = custRes.rows[0].id;

      // 3. Resolve order if supplied
      let orderDbId = null;
      if (orderNumber) {
        const orderRes = await query(
          `SELECT id FROM orders WHERE brand_id = $1 AND order_number = $2 AND customer_id = $3`,
          [brandId, orderNumber, customerId]
        );
        if (orderRes.rows.length > 0) {
          orderDbId = orderRes.rows[0].id;
        }
      }

      // 4. Insert ticket
      const ticketId = `tkt_${Date.now()}`;
      await query(
        `INSERT INTO tickets (id, brand_id, customer_id, order_id, category, priority, sentiment, status, summary, suggested_reply)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'AI Handling', $8, $9)`,
        [
          ticketId, brandId, customerId, orderDbId, category, priority, sentiment,
          `Customer reported: ${initialMessage.slice(0, 200)}`,
          `Hello ${customer?.name || 'there'}, thank you for contacting support.`
        ]
      );

      // 5. Insert conversation mapping
      const mappingId = `map_${ticketId}`;
      const convKey = `conv_${brandId}_${ticketId}`;
      await query(
        `INSERT INTO conversation_mappings (id, brand_id, ticket_id, customer_id, customer_user_id, conversation_key, support_identity)
         VALUES ($1, $2, $3, $4, $5, $6, 'novacart_support')`,
        [mappingId, brandId, ticketId, customerId, nexconnUserId, convKey]
      );

      // 6. Record idempotency if key provided
      const responseBody = { success: true, ticketId, conversationKey: convKey };
      if (idempotencyKey && requestHash) {
        await query(
          `INSERT INTO idempotency_keys (brand_id, request_scope, idempotency_key, request_hash, ticket_id, response_code, response_body)
           VALUES ($1, 'ticket_creation', $2, $3, $4, 201, $5)
           ON CONFLICT (brand_id, request_scope, idempotency_key) DO NOTHING`,
          [brandId, idempotencyKey, requestHash, ticketId, JSON.stringify(responseBody)]
        );
      }

      return { cached: false, statusCode: 201, data: responseBody };
    }

    // JSON fallback
    const tickets = this._readJsonFile();
    const ticketId = `tkt_${Date.now()}`;
    const newTicket = {
      id: ticketId,
      orderId: orderNumber,
      channelId: `channel_${orderNumber || ticketId}`,
      customerId: customer?.id || `cust_${Date.now()}`,
      category,
      priority,
      sentiment,
      status: 'AI Handling',
      lastUpdated: new Date().toISOString(),
      humanRequested: false,
      summary: `Customer reported: ${initialMessage}`,
      suggestedReply: `Hello ${customer?.name || 'there'}, thank you for reaching out.`,
      pendingAction: 'Review and confirm resolution with customer.',
      customer: {
        ...customer,
        order: {
          orderId: orderNumber,
          price: 99.99,
          currency: 'USD',
          status: 'Active',
          initialMessage
        }
      }
    };
    tickets.push(newTicket);
    this._writeJsonFile(tickets);
    return { cached: false, statusCode: 201, data: { success: true, ticket: newTicket } };
  }

  async updateTicket(id, updates, brandId = 'brand_novacart') {
    if (this.isPostgresMode) {
      const allowed = ['status', 'priority', 'sentiment', 'human_requested', 'summary', 'suggested_reply', 'assigned_agent_id'];
      const setClauses = [];
      const values = [id, brandId];
      let idx = 3;

      for (const [key, val] of Object.entries(updates)) {
        const dbKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
        if (allowed.includes(dbKey)) {
          setClauses.push(`${dbKey} = $${idx}`);
          values.push(val);
          idx++;
        }
      }

      if (setClauses.length > 0) {
        setClauses.push(`last_updated = NOW()`);
        const sql = `
          UPDATE tickets
          SET ${setClauses.join(', ')}
          WHERE id = $1 AND brand_id = $2
          RETURNING *;
        `;
        const res = await query(sql, values);
        return res.rows[0] || null;
      }
      return null;
    }

    // JSON fallback
    const tickets = this._readJsonFile();
    const index = tickets.findIndex(t => t.id === id);
    if (index === -1) return null;

    tickets[index] = {
      ...tickets[index],
      ...updates,
      lastUpdated: new Date().toISOString()
    };
    this._writeJsonFile(tickets);
    return tickets[index];
  }
}

export const storageService = new StorageService();
export default storageService;
