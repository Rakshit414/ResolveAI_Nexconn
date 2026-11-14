// server/src/routes/knowledge.js
import express from 'express';
import { requireAgentAuth } from '../middleware/agentAuth.js';
import { BUSINESS_INFO } from '../data/demoData.js';
import { getPool } from '../db/pool.js';
import {
  createKnowledgeItem,
  updateKnowledgeItem,
  publishKnowledgeItem,
  archiveKnowledgeItem,
  searchKnowledge,
  ingestResolvedCase,
  getGroundedAIResponse,
  VALID_CATEGORIES
} from '../services/knowledgeHubService.js';

const router = express.Router();

/**
 * GET /api/knowledge
 * Public / agent accessible knowledge retrieval.
 * Supports legacy demo queries and tenant-scoped Knowledge Hub searches.
 */
router.get('/', async (req, res) => {
  const { brandId = 'brand_novacart', query, category } = req.query;
  const pool = getPool();

  if (pool && (query || category || req.headers['authorization'])) {
    try {
      const items = await searchKnowledge({
        brandId,
        query,
        category,
        isPublishedOnly: true,
        actorRole: 'agent'
      });
      return res.json({
        success: true,
        data: items
      });
    } catch (err) {
      console.warn('[Knowledge Hub Search Fallback]:', err.message);
    }
  }

  // Fallback to static demo data
  res.json({
    success: true,
    data: BUSINESS_INFO,
  });
});

/**
 * GET /api/knowledge/items
 * Agent / Supervisor search endpoint with full filter capabilities.
 */
router.get('/items', requireAgentAuth, async (req, res) => {
  try {
    const brandId = req.agent.brandId;
    const { query, category, isPublishedOnly } = req.query;

    const items = await searchKnowledge({
      brandId,
      query,
      category,
      isPublishedOnly: isPublishedOnly === 'false' ? false : true,
      actorRole: req.agent.role
    });

    res.json({ success: true, count: items.length, items });
  } catch (err) {
    console.error('[Knowledge Hub Items Error]:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/knowledge/items
 * Create new Knowledge Hub entry (draft by default; publishing restricted to leads/admins).
 */
router.post('/items', requireAgentAuth, async (req, res) => {
  try {
    const brandId = req.agent.brandId;
    const { policyId, category, title, slug, contentMarkdown, tags, supportedLanguages, isPublished } = req.body;

    const item = await createKnowledgeItem({
      brandId,
      policyId,
      category,
      title,
      slug,
      contentMarkdown,
      tags,
      supportedLanguages,
      isPublished: Boolean(isPublished),
      actorRole: req.agent.role
    });

    res.status(201).json({ success: true, item });
  } catch (err) {
    if (err.message.startsWith('FORBIDDEN')) {
      return res.status(403).json({ success: false, error: err.message });
    }
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * PUT /api/knowledge/items/:id
 * Update Knowledge Hub entry.
 */
router.put('/items/:id', requireAgentAuth, async (req, res) => {
  try {
    const brandId = req.agent.brandId;
    const { id } = req.params;
    const { policyId, category, title, slug, contentMarkdown, tags, supportedLanguages } = req.body;

    const item = await updateKnowledgeItem({
      brandId,
      id,
      policyId,
      category,
      title,
      slug,
      contentMarkdown,
      tags,
      supportedLanguages,
      actorRole: req.agent.role
    });

    res.json({ success: true, item });
  } catch (err) {
    if (err.message.startsWith('FORBIDDEN')) {
      return res.status(403).json({ success: false, error: err.message });
    }
    if (err.message.includes('not found')) {
      return res.status(404).json({ success: false, error: err.message });
    }
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/knowledge/items/:id/publish
 * Publish Knowledge Hub item (restricted to support leads and admins).
 */
router.post('/items/:id/publish', requireAgentAuth, async (req, res) => {
  try {
    const brandId = req.agent.brandId;
    const { id } = req.params;

    const item = await publishKnowledgeItem({
      brandId,
      id,
      actorRole: req.agent.role
    });

    res.json({ success: true, item });
  } catch (err) {
    if (err.message.startsWith('FORBIDDEN')) {
      return res.status(403).json({ success: false, error: err.message });
    }
    if (err.message.includes('not found')) {
      return res.status(404).json({ success: false, error: err.message });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/knowledge/items/:id/archive
 * Archive Knowledge Hub item (restricted to support leads and admins).
 */
router.post('/items/:id/archive', requireAgentAuth, async (req, res) => {
  try {
    const brandId = req.agent.brandId;
    const { id } = req.params;

    const item = await archiveKnowledgeItem({
      brandId,
      id,
      actorRole: req.agent.role
    });

    res.json({ success: true, item });
  } catch (err) {
    if (err.message.startsWith('FORBIDDEN')) {
      return res.status(403).json({ success: false, error: err.message });
    }
    if (err.message.includes('not found')) {
      return res.status(404).json({ success: false, error: err.message });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/knowledge/resolved-case
 * Ingest an anonymized resolved case summary.
 */
router.post('/resolved-case', requireAgentAuth, async (req, res) => {
  try {
    const brandId = req.agent.brandId;
    const { ticketId, title, resolutionSummary, troubleshootingSteps, tags } = req.body;

    const item = await ingestResolvedCase({
      brandId,
      ticketId,
      title,
      resolutionSummary,
      troubleshootingSteps,
      tags,
      actorRole: req.agent.role
    });

    res.status(201).json({ success: true, item });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/knowledge/grounded-response
 * Generate an AI response grounded strictly in approved brand knowledge.
 */
router.post('/grounded-response', async (req, res) => {
  try {
    const { brandId = 'brand_novacart', query, conversationContext } = req.body;
    const response = await getGroundedAIResponse({
      brandId,
      query,
      conversationContext
    });
    res.json({ success: true, ...response });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
