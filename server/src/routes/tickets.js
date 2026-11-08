import express from 'express';
import { DEMO_CUSTOMERS } from '../data/demoData.js';

const router = express.Router();

// In-memory tickets store initialized from DEMO_CUSTOMERS
let tickets = DEMO_CUSTOMERS.map(c => ({
  ...c.ticket,
  customer: {
    id: c.id,
    name: c.name,
    email: c.email,
    avatar: c.avatar,
    order: c.order,
  }
}));

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

  res.json({
    success: true,
    message: 'Human agent assistance requested successfully',
    ticket: tickets[index],
  });
});

export default router;
