// server/src/routes/agent.js
import express from 'express';
import { requireAgentAuth } from '../middleware/agentAuth.js';
import {
  getAgentProfile,
  updateAgentConfiguredStatus,
  createAgentSession,
  refreshAgentHeartbeat,
  terminateAgentSession,
  getAgentStatusHistory
} from '../services/agentAvailabilityService.js';
import { reconcileAgentCapacity } from '../services/capacityService.js';
import {
  getUncertainOutboxReport,
  manualReconcileOutboxJob
} from '../services/outboxService.js';

const router = express.Router();

/**
 * GET /api/agent/profile
 * Returns authenticated agent profile, or specified agent profile for support_lead/admin.
 */
router.get('/profile', requireAgentAuth, async (req, res) => {
  const targetUserId = req.query.userId || req.agent.id;

  if (targetUserId !== req.agent.id && !['support_lead', 'admin'].includes(req.agent.role)) {
    return res.status(403).json({ error: 'Unauthorized to view another agent profile' });
  }

  try {
    const profile = await getAgentProfile(req.agent.brandId, targetUserId);
    if (!profile) {
      return res.status(404).json({ error: 'Agent profile not found' });
    }
    return res.json({ success: true, profile });
  } catch (err) {
    console.error('[Agent Profile Route Error]:', err.message);
    return res.status(500).json({ error: 'Failed to retrieve agent profile' });
  }
});

/**
 * PATCH /api/agent/status
 * Updates configured status among ('Available', 'Busy', 'Away', 'Offline').
 */
router.patch('/status', requireAgentAuth, async (req, res) => {
  const { status, reason, userId } = req.body;
  const targetUserId = userId || req.agent.id;

  if (!status) {
    return res.status(400).json({ error: 'Status is required' });
  }

  try {
    const updatedProfile = await updateAgentConfiguredStatus({
      brandId: req.agent.brandId,
      userId: targetUserId,
      newStatus: status,
      reason,
      performedByUserId: req.agent.id,
      performedByRole: req.agent.role
    });

    return res.json({ success: true, profile: updatedProfile });
  } catch (err) {
    const statusCode = err.statusCode || 500;
    return res.status(statusCode).json({ error: err.message });
  }
});

/**
 * POST /api/agent/session
 * Establishes a new agent session.
 */
router.post('/session', async (req, res) => {
  const { brandId = 'brand_novacart', userId } = req.body;

  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }

  try {
    const sessionData = await createAgentSession({
      brandId,
      userId,
      ipAddress: req.ip || '127.0.0.1',
      userAgent: req.headers['user-agent'] || 'unknown'
    });

    // Set HttpOnly cookie
    res.cookie('resolve_agent_session', sessionData.sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 1000 * 60 * 60 * 12,
      path: '/'
    });

    return res.json({
      success: true,
      sessionId: sessionData.sessionId,
      sessionToken: sessionData.sessionToken,
      csrfToken: sessionData.csrfToken,
      expiresAt: sessionData.expiresAt,
      profile: sessionData.profile
    });
  } catch (err) {
    const statusCode = err.statusCode || 500;
    return res.status(statusCode).json({ error: err.message });
  }
});

/**
 * POST /api/agent/heartbeat
 * Renews agent heartbeat (20s interval, stale after 60s).
 */
router.post('/heartbeat', requireAgentAuth, async (req, res) => {
  try {
    const result = await refreshAgentHeartbeat({
      brandId: req.agent.brandId,
      userId: req.agent.id,
      sessionId: req.agent.sessionId
    });

    return res.json(result);
  } catch (err) {
    const statusCode = err.statusCode || 500;
    return res.status(statusCode).json({ error: err.message });
  }
});

/**
 * POST /api/agent/session/terminate
 * Revokes current agent session and sets agent to Offline.
 */
router.post('/session/terminate', requireAgentAuth, async (req, res) => {
  try {
    const result = await terminateAgentSession({
      brandId: req.agent.brandId,
      userId: req.agent.id,
      sessionId: req.agent.sessionId,
      setOffline: req.body.setOffline !== false
    });

    res.clearCookie('resolve_agent_session', { path: '/' });
    return res.json(result);
  } catch (err) {
    const statusCode = err.statusCode || 500;
    return res.status(statusCode).json({ error: err.message });
  }
});

/**
 * GET /api/agent/status-history
 * Returns chronological status audit history.
 */
router.get('/status-history', requireAgentAuth, async (req, res) => {
  const targetUserId = req.query.userId || req.agent.id;

  if (targetUserId !== req.agent.id && !['support_lead', 'admin'].includes(req.agent.role)) {
    return res.status(403).json({ error: 'Unauthorized to view another agent history' });
  }

  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
    const history = await getAgentStatusHistory({
      brandId: req.agent.brandId,
      userId: targetUserId,
      limit
    });

    return res.json({ success: true, history });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to retrieve status history' });
  }
});

/**
 * POST /api/agent/reconcile
 * Reconciles agent capacity counters with committed active assignments.
 */
router.post('/reconcile', requireAgentAuth, async (req, res) => {
  const targetUserId = req.body.userId || req.agent.id;

  if (targetUserId !== req.agent.id && !['support_lead', 'admin'].includes(req.agent.role)) {
    return res.status(403).json({ error: 'Unauthorized to reconcile another agent' });
  }

  try {
    const result = await reconcileAgentCapacity({
      brandId: req.agent.brandId,
      userId: targetUserId
    });

    return res.json({ success: true, ...result });
  } catch (err) {
    const statusCode = err.statusCode || 500;
    return res.status(statusCode).json({ error: err.message });
  }
});

/**
 * GET /api/agent/outbox/uncertain
 * Auditable reporting endpoint for unresolved uncertain outbox messages.
 * Accessible strictly to support_lead or admin.
 */
router.get('/outbox/uncertain', requireAgentAuth, async (req, res) => {
  if (!['support_lead', 'admin'].includes(req.agent.role)) {
    return res.status(403).json({ error: 'Unauthorized: support_lead or admin role required' });
  }

  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
    const report = await getUncertainOutboxReport({
      brandId: req.agent.brandId,
      limit
    });

    return res.json({
      success: true,
      count: report.length,
      uncertainMessages: report
    });
  } catch (err) {
    console.error('[Agent Outbox Uncertain Route Error]:', err.message);
    return res.status(500).json({ error: 'Failed to retrieve uncertain outbox report' });
  }
});

/**
 * POST /api/agent/outbox/reconcile
 * Safe manual reconciliation endpoint for an uncertain outbox message.
 * Strictly adheres to zero-blind-resend and evidence-based completion.
 * Accessible strictly to support_lead or admin.
 */
router.post('/outbox/reconcile', requireAgentAuth, async (req, res) => {
  if (!['support_lead', 'admin'].includes(req.agent.role)) {
    return res.status(403).json({ error: 'Unauthorized: support_lead or admin role required' });
  }

  const { outboxId, forceFailWithEvidence } = req.body;

  if (!outboxId) {
    return res.status(400).json({ error: 'outboxId is required' });
  }

  try {
    const result = await manualReconcileOutboxJob({
      brandId: req.agent.brandId,
      outboxId,
      forceFailWithEvidence,
      operatorUserId: req.agent.id,
      operatorRole: req.agent.role
    });

    return res.json({ success: true, ...result });
  } catch (err) {
    const statusCode = err.statusCode || 500;
    return res.status(statusCode).json({ error: err.message });
  }
});

export default router;
