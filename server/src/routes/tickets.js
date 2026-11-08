import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DEMO_CUSTOMERS } from '../data/demoData.js';

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

function saveTickets(ticketsList) {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(TICKETS_FILE, JSON.stringify(ticketsList, null, 2), 'utf8');
  } catch (err) {
    console.warn('[Tickets] Failed to persist tickets to disk:', err.message);
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
  saveTickets(defaults);
  return defaults;
}

// In-memory tickets store backed by local disk persistence
let tickets = loadTickets();

// GET /api/tickets - List all tickets with optional filtering
router.get('/', (req, res) => {
  const { priority, status, category } = req.query;
  let filtered = [...tickets];

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

// GET /api/tickets/:id - Get specific ticket
router.get('/:id', (req, res) => {
  const ticket = tickets.find(t => t.id === req.params.id || t.orderId === req.params.id);
  if (!ticket) {
    return res.status(404).json({ success: false, error: 'Ticket not found' });
  }
  res.json({ success: true, ticket });
});

// PATCH /api/tickets/:id - Update ticket status, priority, or category
router.patch('/:id', (req, res) => {
  const index = tickets.findIndex(t => t.id === req.params.id || t.orderId === req.params.id);
  if (index === -1) {
    return res.status(404).json({ success: false, error: 'Ticket not found' });
  }

  const { status, priority, category, summary, suggestedReply, pendingAction } = req.body;

  if (status !== undefined) tickets[index].status = status;
  if (priority !== undefined) tickets[index].priority = priority;
  if (category !== undefined) tickets[index].category = category;
  if (summary !== undefined) tickets[index].summary = summary;
  if (suggestedReply !== undefined) tickets[index].suggestedReply = suggestedReply;
  if (pendingAction !== undefined) tickets[index].pendingAction = pendingAction;
  
  tickets[index].lastUpdated = new Date().toISOString();
  saveTickets(tickets);

  res.json({ success: true, ticket: tickets[index] });
});

// POST /api/tickets/:id/human-handoff - Customer requests human assistance
router.post('/:id/human-handoff', (req, res) => {
  const index = tickets.findIndex(t => t.id === req.params.id || t.orderId === req.params.id);
  if (index === -1) {
    return res.status(404).json({ success: false, error: 'Ticket not found' });
  }

  tickets[index].humanRequested = true;
  tickets[index].status = 'Human Requested';
  tickets[index].lastUpdated = new Date().toISOString();
  saveTickets(tickets);

  res.json({
    success: true,
    message: 'Human agent assistance requested successfully',
    ticket: tickets[index],
  });
});

// POST /api/tickets/:id/take-over - Agent takes over ticket
router.post('/:id/take-over', (req, res) => {
  const index = tickets.findIndex(t => t.id === req.params.id || t.orderId === req.params.id);
  if (index === -1) {
    return res.status(404).json({ success: false, error: 'Ticket not found' });
  }

  tickets[index].humanRequested = false;
  tickets[index].status = 'Human Agent Active';
  tickets[index].lastUpdated = new Date().toISOString();
  saveTickets(tickets);

  res.json({
    success: true,
    message: 'Agent took over ticket successfully',
    ticket: tickets[index],
  });
});

// POST /api/tickets/:id/resolve - Agent marks ticket as resolved
router.post('/:id/resolve', (req, res) => {
  const index = tickets.findIndex(t => t.id === req.params.id || t.orderId === req.params.id);
  if (index === -1) {
    return res.status(404).json({ success: false, error: 'Ticket not found' });
  }

  tickets[index].humanRequested = false;
  tickets[index].status = 'Resolved';
  tickets[index].lastUpdated = new Date().toISOString();
  saveTickets(tickets);

  res.json({
    success: true,
    message: 'Ticket marked as resolved successfully',
    ticket: tickets[index],
  });
});

// POST /api/tickets/reset - Reset tickets to initial seed state
router.post('/reset', (req, res) => {
  tickets = getInitialTickets();
  saveTickets(tickets);
  res.json({
    success: true,
    message: 'Tickets reset to demo defaults successfully',
    tickets,
  });
});

export default router;
