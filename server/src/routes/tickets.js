import express from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DEMO_CUSTOMERS } from '../data/demoData.js';
import { storageService } from '../services/storageService.js';
import { requireAgentAuth } from '../middleware/agentAuth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../../data');
const TICKETS_FILE = path.resolve(DATA_DIR, 'tickets.json');

const router = express.Router();

function getInitialTickets() {
  return DEMO_CUSTOMERS.map(c => ({
    ...c.ticket,
    customer: {
      id: c.id,
      name: c.name,
      email: c.email,
      avatar: c.avatar,
      order: c.order,
    }
  }));
}

// Mutex promise queue to serialize disk persistence and prevent race conditions or corrupt partial writes
let writeQueue = Promise.resolve();

function saveTicketsAtomic(ticketsList) {
  writeQueue = writeQueue.then(async () => {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      const tempFile = path.resolve(DATA_DIR, `tickets.tmp.${Date.now()}.${Math.random().toString(36).substring(2, 7)}`);
      const payload = JSON.stringify(ticketsList, null, 2);
      await fs.promises.writeFile(tempFile, payload, 'utf8');
      await fs.promises.rename(tempFile, TICKETS_FILE);
    } catch (err) {
      console.warn('[Tickets] Atomic persistence error:', err.message);
    }
  });
  return writeQueue;
}

function saveTicketsSync(ticketsList) {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const tempFile = path.resolve(DATA_DIR, `tickets.tmp.${Date.now()}`);
    fs.writeFileSync(tempFile, JSON.stringify(ticketsList, null, 2), 'utf8');
    fs.renameSync(tempFile, TICKETS_FILE);
  } catch (err) {
    console.warn('[Tickets] Sync persistence error:', err.message);
  }
}

function loadTickets() {
  try {
    if (fs.existsSync(TICKETS_FILE)) {
      const data = fs.readFileSync(TICKETS_FILE, 'utf8');
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (err) {
    console.warn('[Tickets] Failed to load tickets from disk, seeding defaults:', err.message);
  }
  const defaults = getInitialTickets();
  saveTicketsSync(defaults);
  return defaults;
}

// In-memory tickets store backed by local disk persistence
let tickets = loadTickets();

const VALID_STATUSES = ['AI Handling', 'Human Requested', 'Human Agent Active', 'Resolved'];
const VALID_PRIORITIES = ['Critical', 'High', 'Medium', 'Low'];
const VALID_CATEGORIES = ['Delivery Delay', 'Refund Request', 'Wrong Product', 'Cancellation', 'General Inquiry', 'Damaged Product', 'Payment Issue', 'Other'];

// GET /api/tickets - List all tickets with optional filtering and customer scoping
router.get('/', async (req, res) => {
  const { priority, status, category, customerId, brandId = 'brand_novacart' } = req.query;

  if (storageService.isPostgresMode) {
    try {
      let dbTickets = await storageService.getTickets({ brandId, status: status !== 'All' ? status : null });
      if (customerId) {
        dbTickets = dbTickets.filter(t => t.customerId === customerId || t.customer?.id === customerId);
      }
      if (priority && priority !== 'All') {
        dbTickets = dbTickets.filter(t => t.priority.toLowerCase() === priority.toLowerCase());
      }
      if (category && category !== 'All') {
        dbTickets = dbTickets.filter(t => t.category.toLowerCase() === category.toLowerCase());
      }
      return res.json({
        success: true,
        count: dbTickets.length,
        tickets: dbTickets
      });
    } catch (err) {
      console.warn('[Tickets] Storage query error, using local fallback:', err.message);
    }
  }

  let filtered = [...tickets];

  if (customerId) {
    filtered = filtered.filter(t => t.customerId === customerId || t.customer?.id === customerId);
  }

  if (priority && priority !== 'All') {
    filtered = filtered.filter(t => t.priority.toLowerCase() === priority.toLowerCase());
  }

  if (status && status !== 'All') {
    if (status === 'Human Assistance Requested' || status === 'Human Requested') {
      filtered = filtered.filter(t => t.humanRequested || t.status === 'Human Requested' || t.status === 'Human Assistance Requested');
    } else {
      filtered = filtered.filter(t => t.status.toLowerCase() === status.toLowerCase());
    }
  }

  if (category && category !== 'All') {
    filtered = filtered.filter(t => t.category.toLowerCase() === category.toLowerCase());
  }

  res.json({
    success: true,
    count: filtered.length,
    tickets: filtered,
  });
});

// POST /api/tickets - Ingest or dynamically create a ticket with request-level idempotency
router.post('/', async (req, res) => {
  const idempotencyKey = req.headers['idempotency-key'] || req.body.idempotencyKey || null;
  const { brandId = 'brand_novacart', customer, orderNumber, category = 'General Inquiry', priority = 'Medium', sentiment = 'Neutral', initialMessage = '' } = req.body;

  // Compute canonical request hash
  const requestPayload = { brandId, customerId: customer?.id, orderNumber, category, priority, initialMessage };
  const requestHash = crypto.createHash('sha256').update(JSON.stringify(requestPayload)).digest('hex');

  try {
    const result = await storageService.createTicket({
      brandId,
      customer,
      orderNumber,
      category,
      priority,
      sentiment,
      initialMessage,
      idempotencyKey,
      requestHash
    });

    if (result.cached) {
      res.setHeader('X-Cache-Lookup', 'HIT-IDEMPOTENT');
    }
    return res.status(result.statusCode).json(result.data);
  } catch (err) {
    if (err.statusCode === 409) {
      return res.status(409).json({ error: err.message });
    }
    console.error('[Create Ticket Error]:', err.message);
    return res.status(500).json({ error: 'Failed to create ticket.' });
  }
});

// GET /api/tickets/:id - Get specific ticket with optional customer ownership verification
router.get('/:id', async (req, res) => {
  const { customerId, brandId = 'brand_novacart' } = req.query;

  if (storageService.isPostgresMode) {
    try {
      const ticket = await storageService.getTicketById(req.params.id, brandId);
      if (!ticket) return res.status(404).json({ success: false, error: 'Ticket not found' });
      if (customerId && ticket.customerId !== customerId && ticket.customer?.id !== customerId) {
        return res.status(403).json({ success: false, error: 'Access denied: ticket does not belong to specified customer' });
      }
      return res.json({ success: true, ticket });
    } catch (err) {
      console.warn('[Tickets] Query error:', err.message);
    }
  }

  const ticket = tickets.find(t => t.id === req.params.id || t.orderId === req.params.id);
  if (!ticket) {
    return res.status(404).json({ success: false, error: 'Ticket not found' });
  }

  if (customerId && ticket.customerId !== customerId && ticket.customer?.id !== customerId) {
    return res.status(403).json({ success: false, error: 'Access denied: ticket does not belong to specified customer' });
  }

  res.json({ success: true, ticket });
});

// PATCH /api/tickets/:id - Update ticket status, priority, or category with strict validation
router.patch('/:id', async (req, res) => {
  const { status, priority, category, summary, suggestedReply, pendingAction } = req.body;

  if (status !== undefined && !VALID_STATUSES.includes(status)) {
    return res.status(400).json({ 
      success: false, 
      error: `Invalid status "${status}". Allowed values: ${VALID_STATUSES.join(', ')}` 
    });
  }

  if (priority !== undefined && !VALID_PRIORITIES.includes(priority)) {
    return res.status(400).json({ 
      success: false, 
      error: `Invalid priority "${priority}". Allowed values: ${VALID_PRIORITIES.join(', ')}` 
    });
  }

  if (category !== undefined && !VALID_CATEGORIES.includes(category)) {
    return res.status(400).json({ 
      success: false, 
      error: `Invalid category "${category}". Allowed values: ${VALID_CATEGORIES.join(', ')}` 
    });
  }

  const updates = {};
  if (status !== undefined) updates.status = status;
  if (priority !== undefined) updates.priority = priority;
  if (category !== undefined) updates.category = category;
  if (summary !== undefined) updates.summary = summary;
  if (suggestedReply !== undefined) updates.suggestedReply = suggestedReply;
  if (pendingAction !== undefined) updates.pendingAction = pendingAction;

  if (storageService.isPostgresMode) {
    try {
      const updated = await storageService.updateTicket(req.params.id, updates);
      if (updated) return res.json({ success: true, ticket: updated });
    } catch (err) {
      console.warn('[Tickets] Storage update error:', err.message);
    }
  }

  const index = tickets.findIndex(t => t.id === req.params.id || t.orderId === req.params.id);
  if (index === -1) {
    return res.status(404).json({ success: false, error: 'Ticket not found' });
  }

  if (status !== undefined) {
    tickets[index].status = status;
    tickets[index].humanRequested = status === 'Human Requested' ? true : status === 'Resolved' ? false : tickets[index].humanRequested;
  }
  if (priority !== undefined) tickets[index].priority = priority;
  if (category !== undefined) tickets[index].category = category;
  if (summary !== undefined) tickets[index].summary = summary;
  if (suggestedReply !== undefined) tickets[index].suggestedReply = suggestedReply;
  if (pendingAction !== undefined) tickets[index].pendingAction = pendingAction;
  
  tickets[index].lastUpdated = new Date().toISOString();
  await saveTicketsAtomic(tickets);

  res.json({ success: true, ticket: tickets[index] });
});

// POST /api/tickets/:id/human-handoff - Customer requests human assistance
router.post('/:id/human-handoff', async (req, res) => {
  const index = tickets.findIndex(t => t.id === req.params.id || t.orderId === req.params.id);
  if (index === -1) {
    return res.status(404).json({ success: false, error: 'Ticket not found' });
  }

  tickets[index].humanRequested = true;
  tickets[index].status = 'Human Requested';
  tickets[index].lastUpdated = new Date().toISOString();
  await saveTicketsAtomic(tickets);

  if (storageService.isPostgresMode) {
    await storageService.updateTicket(req.params.id, { status: 'Human Requested', human_requested: true }).catch(() => {});
  }

  res.json({
    success: true,
    message: 'Human agent assistance requested successfully',
    ticket: tickets[index],
  });
});

// POST /api/tickets/:id/take-over - Agent takes over ticket
router.post('/:id/take-over', async (req, res) => {
  const index = tickets.findIndex(t => t.id === req.params.id || t.orderId === req.params.id);
  if (index === -1) {
    return res.status(404).json({ success: false, error: 'Ticket not found' });
  }

  tickets[index].humanRequested = false;
  tickets[index].status = 'Human Agent Active';
  tickets[index].lastUpdated = new Date().toISOString();
  await saveTicketsAtomic(tickets);

  if (storageService.isPostgresMode) {
    await storageService.updateTicket(req.params.id, { 
      status: 'Human Agent Active', 
      human_requested: false,
      assigned_agent_id: req.agent?.id || 'user_sarah_lin'
    }).catch(() => {});
  }

  res.json({
    success: true,
    message: 'Agent took over ticket successfully',
    ticket: tickets[index],
  });
});

// POST /api/tickets/:id/resolve - Agent marks ticket as resolved
router.post('/:id/resolve', async (req, res) => {
  const index = tickets.findIndex(t => t.id === req.params.id || t.orderId === req.params.id);
  if (index === -1) {
    return res.status(404).json({ success: false, error: 'Ticket not found' });
  }

  tickets[index].humanRequested = false;
  tickets[index].status = 'Resolved';
  tickets[index].lastUpdated = new Date().toISOString();
  await saveTicketsAtomic(tickets);

  if (storageService.isPostgresMode) {
    await storageService.updateTicket(req.params.id, { status: 'Resolved', human_requested: false }).catch(() => {});
  }

  res.json({
    success: true,
    message: 'Ticket marked as resolved successfully',
    ticket: tickets[index],
  });
});

// POST /api/tickets/:id/feedback - Customer submits resolution feedback
router.post('/:id/feedback', async (req, res) => {
  const index = tickets.findIndex(t => t.id === req.params.id || t.orderId === req.params.id);
  if (index === -1) {
    return res.status(404).json({ success: false, error: 'Ticket not found' });
  }

  const { resolved, rating, comment } = req.body;
  if (resolved === undefined && rating === undefined) {
    return res.status(400).json({ success: false, error: 'Feedback must contain at least resolved status or rating' });
  }

  const feedbackData = {
    resolved: resolved === true,
    rating: typeof rating === 'number' ? Math.max(1, Math.min(5, Math.round(rating))) : 5,
    comment: String(comment || '').trim().substring(0, 500),
    submittedAt: new Date().toISOString(),
  };

  tickets[index].feedback = feedbackData;
  tickets[index].lastUpdated = new Date().toISOString();
  await saveTicketsAtomic(tickets);

  res.json({
    success: true,
    message: 'Resolution feedback recorded successfully',
    feedback: feedbackData,
    ticket: tickets[index],
  });
});

// POST /api/tickets/reset - Reset tickets to initial seed state (Protected Demo/Dev endpoint)
router.post('/reset', async (req, res) => {
  if (process.env.NODE_ENV === 'production' && !process.env.ALLOW_DEMO_RESET) {
    return res.status(403).json({
      success: false,
      error: 'Ticket reset is disabled in production environment.'
    });
  }

  tickets = getInitialTickets();
  await saveTicketsAtomic(tickets);
  console.log('[Tickets] Seed reset executed by client/test harness.');

  res.json({
    success: true,
    message: 'Tickets reset to demo defaults successfully',
    tickets,
  });
});

export default router;
