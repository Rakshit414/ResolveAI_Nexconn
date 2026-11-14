// server/src/routes/translation.js
import express from 'express';
import { requireAgentAuth } from '../middleware/agentAuth.js';
import { translationBreaker } from '../services/translationCircuitBreaker.js';
import {
  canonicalizeLocale,
  translateTicketMessage,
  translateUIPhrase
} from '../services/translationService.js';

const router = express.Router();

/**
 * GET /api/translation/status
 * Returns current translation circuit breaker status without exposing secrets.
 */
router.get('/status', (req, res) => {
  res.json({
    success: true,
    operational: translationBreaker.isOperational(),
    state: translationBreaker.state,
    failureCount: translationBreaker.failureCount
  });
});

/**
 * POST /api/translation/translate-message
 * Tenant-scoped translation for conversation ticket messages.
 * Authenticated via agent session.
 */
router.post('/translate-message', requireAgentAuth, async (req, res) => {
  try {
    const { ticketId, messageId, text, sourceLocale, targetLocale, brandId: bodyBrandId } = req.body;
    const brandId = req.agent?.brandId || bodyBrandId;

    if (!brandId) {
      return res.status(400).json({ success: false, error: 'brandId is required' });
    }
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ success: false, error: 'text string is required' });
    }
    if (!targetLocale) {
      return res.status(400).json({ success: false, error: 'targetLocale is required' });
    }

    // Verify cross-tenant isolation: agent can only translate for their brand
    if (req.agent && req.agent.brandId && req.agent.brandId !== brandId) {
      return res.status(403).json({ success: false, error: 'Cross-tenant translation access forbidden' });
    }

    const result = await translateTicketMessage({
      brandId,
      ticketId,
      messageId,
      text,
      sourceLocale: sourceLocale || 'en-US',
      targetLocale
    });

    res.json(result);
  } catch (err) {
    if (err.message && err.message.startsWith('INVALID_LOCALE')) {
      return res.status(400).json({ success: false, error: err.message });
    }
    console.error('[Translation Route Error]:', err.message);
    res.status(500).json({ success: false, error: 'Translation operation failed' });
  }
});

/**
 * POST /api/translation/translate-phrase
 * Global UI phrase translation with persistent caching.
 */
router.post('/translate-phrase', async (req, res) => {
  try {
    const { phraseKey, text, sourceLocale, targetLocale } = req.body;

    if (!phraseKey) {
      return res.status(400).json({ success: false, error: 'phraseKey is required' });
    }
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ success: false, error: 'text string is required' });
    }
    if (!targetLocale) {
      return res.status(400).json({ success: false, error: 'targetLocale is required' });
    }

    const result = await translateUIPhrase({
      phraseKey,
      text,
      sourceLocale: sourceLocale || 'en-US',
      targetLocale
    });

    res.json(result);
  } catch (err) {
    if (err.message && err.message.startsWith('INVALID_LOCALE')) {
      return res.status(400).json({ success: false, error: err.message });
    }
    console.error('[UI Phrase Translation Error]:', err.message);
    res.status(500).json({ success: false, error: 'UI phrase translation failed' });
  }
});

export default router;
