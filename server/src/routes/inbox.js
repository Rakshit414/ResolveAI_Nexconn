// server/src/routes/inbox.js
import express from 'express';
import { requireAgentAuth } from '../middleware/agentAuth.js';
import {
  getUnassignedTickets,
  getMyTickets,
  getTeamOverview,
  getAgentRoster,
  getTicketDetailsWithHistory,
  claimOrReassignTicket,
  transferTicket,
  resolveTicket
} from '../services/sharedInboxService.js';
import { sendAgentReply } from '../services/outboxService.js';

const router = express.Router();

/**
 * GET /api/inbox/unassigned
 * Returns unassigned tickets with masked customer PII.
 */
router.get('/unassigned', requireAgentAuth, async (req, res) => {
  const { priority, limit = 50, offset = 0 } = req.query;

  try {
    const tickets = await getUnassignedTickets({
      brandId: req.agent.brandId,
      priority,
      limit: parseInt(limit, 10) || 50,
      offset: parseInt(offset, 10) || 0
    });

    return res.json({
      success: true,
      count: tickets.length,
      tickets
    });
  } catch (err) {
    console.error('[Inbox Unassigned Route Error]:', err.message);
    return res.status(500).json({ error: 'Failed to fetch unassigned tickets' });
  }
});

/**
 * GET /api/inbox/my-tickets
 * Returns tickets assigned to authenticated agent with full unmasked customer details.
 */
router.get('/my-tickets', requireAgentAuth, async (req, res) => {
  const { limit = 50, offset = 0 } = req.query;

  try {
    const tickets = await getMyTickets({
      brandId: req.agent.brandId,
      agentId: req.agent.id,
      limit: parseInt(limit, 10) || 50,
      offset: parseInt(offset, 10) || 0
    });

    return res.json({
      success: true,
      count: tickets.length,
      tickets
    });
  } catch (err) {
    console.error('[Inbox MyTickets Route Error]:', err.message);
    return res.status(500).json({ error: 'Failed to fetch agent tickets' });
  }
});

/**
 * GET /api/inbox/team-overview
 * Returns shared team metrics, roster, unassigned preview (masked), and active assigned preview.
 */
router.get('/team-overview', requireAgentAuth, async (req, res) => {
  try {
    const overview = await getTeamOverview({ brandId: req.agent.brandId });
    return res.json({
      success: true,
      ...overview
    });
  } catch (err) {
    console.error('[Inbox TeamOverview Route Error]:', err.message);
    return res.status(500).json({ error: 'Failed to fetch team overview' });
  }
});

/**
 * GET /api/inbox/roster
 * Returns all agents with dynamic effective statuses and committed workload.
 */
router.get('/roster', requireAgentAuth, async (req, res) => {
  try {
    const roster = await getAgentRoster({ brandId: req.agent.brandId });
    return res.json({
      success: true,
      count: roster.length,
      roster
    });
  } catch (err) {
    console.error('[Inbox Roster Route Error]:', err.message);
    return res.status(500).json({ error: 'Failed to fetch agent roster' });
  }
});

/**
 * GET /api/inbox/tickets/:ticketId
 * Returns tenant-scoped ticket details, continuous conversation history, and agent-only handoffs.
 */
router.get('/tickets/:ticketId', requireAgentAuth, async (req, res) => {
  const { ticketId } = req.params;

  try {
    const details = await getTicketDetailsWithHistory({
      brandId: req.agent.brandId,
      ticketId,
      requestingAgentId: req.agent.id,
      requestingAgentRole: req.agent.role
    });

    if (!details) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    return res.json({
      success: true,
      ticket: details
    });
  } catch (err) {
    const statusCode = err.statusCode || 500;
    return res.status(statusCode).json({ error: err.message });
  }
});

/**
 * POST /api/inbox/tickets/:ticketId/assign
 * Claims or reassigns a ticket using atomic checks and the global lock hierarchy.
 */
router.post('/tickets/:ticketId/assign', requireAgentAuth, async (req, res) => {
  const { ticketId } = req.params;
  const targetAgentId = req.body.targetAgentId || req.agent.id;

  try {
    const result = await claimOrReassignTicket({
      brandId: req.agent.brandId,
      ticketId,
      targetAgentId,
      requestingAgentId: req.agent.id,
      requestingAgentRole: req.agent.role
    });

    return res.json(result);
  } catch (err) {
    const statusCode = err.statusCode || 500;
    return res.status(statusCode).json({ error: err.message });
  }
});

/**
 * POST /api/inbox/tickets/:ticketId/transfer
 * Atomically transfers a ticket to another agent with handoff summary and internal notes.
 */
router.post('/tickets/:ticketId/transfer', requireAgentAuth, async (req, res) => {
  const { ticketId } = req.params;
  const { toAgentId, handoffSummaryJson, internalNotes = '' } = req.body;

  if (!toAgentId) {
    return res.status(400).json({ error: 'toAgentId is required' });
  }

  // Authorization: normal agents can only transfer tickets assigned to them
  const fromAgentId = req.body.fromAgentId || req.agent.id;
  if (fromAgentId !== req.agent.id && !['support_lead', 'admin'].includes(req.agent.role)) {
    return res.status(403).json({ error: 'Unauthorized to transfer tickets assigned to other agents' });
  }

  try {
    const result = await transferTicket({
      brandId: req.agent.brandId,
      ticketId,
      fromAgentId,
      toAgentId,
      handoffSummaryJson,
      internalNotes
    });

    return res.json(result);
  } catch (err) {
    const statusCode = err.statusCode || 500;
    return res.status(statusCode).json({ error: err.message });
  }
});

/**
 * POST /api/inbox/tickets/:ticketId/resolve
 * Resolves a ticket and releases agent capacity using atomic capacityService.
 */
router.post('/tickets/:ticketId/resolve', requireAgentAuth, async (req, res) => {
  const { ticketId } = req.params;

  try {
    const result = await resolveTicket({
      brandId: req.agent.brandId,
      ticketId
    });

    return res.json(result);
  } catch (err) {
    const statusCode = err.statusCode || 500;
    return res.status(statusCode).json({ error: err.message });
  }
});

/**
 * POST /api/inbox/tickets/:ticketId/reply
 * Dispatches an agent reply through the transactional outbox and Nexconn.
 */
router.post('/tickets/:ticketId/reply', requireAgentAuth, async (req, res) => {
  const { ticketId } = req.params;
  const { messageText, dedupeKey } = req.body;

  if (!messageText || !messageText.trim()) {
    return res.status(400).json({ error: 'messageText is required' });
  }

  try {
    const result = await sendAgentReply({
      brandId: req.agent.brandId,
      ticketId,
      agentUserId: req.agent.id,
      agentRole: req.agent.role,
      messageText,
      dedupeKey
    });

    return res.json(result);
  } catch (err) {
    const statusCode = err.statusCode || 500;
    return res.status(statusCode).json({ error: err.message });
  }
});

export default router;
