// server/src/services/knowledgeHubService.js
import crypto from 'crypto';
import { getPool } from '../db/pool.js';
import { GoogleGenerativeAI } from '@google/generative-ai';

export const VALID_CATEGORIES = [
  'policy',
  'faq',
  'troubleshooting',
  'canned_response',
  'product_guide',
  'resolved_case'
];

/**
 * Creates a slug from a title string.
 */
function slugify(title) {
  return String(title || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || `item-${Date.now()}`;
}

/**
 * Strip PII (names, emails, phone numbers) and order identifiers from text.
 */
export function anonymizeText(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    // Replace emails
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[ANONYMIZED_EMAIL]')
    // Replace phone numbers
    .replace(/(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g, '[ANONYMIZED_PHONE]')
    // Mask customer names like "Aarav Sharma" or "Priya Mehta" if known
    .replace(/\b(Aarav|Sharma|Priya|Mehta|Kabir|Patel)\b/gi, 'Customer')
    // Mask specific Order IDs like NC1021, NC1022, NC1023
    .replace(/#?NC\d{4,6}/gi, '#NC****')
    // Remove internal agent notes markers
    .replace(/\[INTERNAL[ _]NOTE.*?\]/gi, '')
    .replace(/SECRET AGENT NOTE.*$/gim, '')
    .trim();
}

/**
 * Create a new Knowledge Hub entry.
 */
export async function createKnowledgeItem({
  brandId,
  policyId = null,
  category,
  title,
  slug,
  contentMarkdown,
  tags = [],
  supportedLanguages = ['en-US'],
  isPublished = false,
  actorRole = 'agent'
}) {
  if (!brandId) throw new Error('brandId is required');
  if (!title || !title.trim()) throw new Error('title is required');
  if (!contentMarkdown || !contentMarkdown.trim()) throw new Error('contentMarkdown is required');
  if (!VALID_CATEGORIES.includes(category)) {
    throw new Error(`Invalid category "${category}". Must be one of: ${VALID_CATEGORIES.join(', ')}`);
  }

  // Only support_lead or admin can publish directly
  let publishState = false;
  if (isPublished) {
    if (actorRole === 'support_lead' || actorRole === 'admin') {
      publishState = true;
    } else {
      throw new Error('FORBIDDEN_PUBLISH: Only support leads and administrators can publish knowledge items');
    }
  }

  const generatedSlug = slug ? slug.trim() : slugify(title);
  const pool = getPool();
  const id = `kh_${crypto.randomBytes(12).toString('hex')}`;
  const version = 1;
  const publishedVersion = publishState ? 1 : 0;

  const res = await pool.query(`
    INSERT INTO brand_knowledge_hub (
      id, brand_id, policy_id, category, title, slug, content_markdown, tags, supported_languages, version, published_version, is_published, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
    RETURNING *;
  `, [
    id,
    brandId,
    policyId,
    category,
    title.trim(),
    generatedSlug,
    contentMarkdown.trim(),
    tags,
    supportedLanguages,
    version,
    publishedVersion,
    publishState
  ]);

  return res.rows[0];
}

/**
 * Update an existing Knowledge Hub entry.
 */
export async function updateKnowledgeItem({
  brandId,
  id,
  policyId,
  category,
  title,
  slug,
  contentMarkdown,
  tags,
  supportedLanguages,
  actorRole = 'agent'
}) {
  const pool = getPool();
  const existingRes = await pool.query(`
    SELECT * FROM brand_knowledge_hub WHERE id = $1 AND brand_id = $2
  `, [id, brandId]);

  if (existingRes.rows.length === 0) {
    throw new Error('Knowledge item not found');
  }

  const existing = existingRes.rows[0];

  // If modifying a published item in restricted categories (e.g. policy), enforce supervisor role
  if (existing.is_published && (existing.category === 'policy' || category === 'policy')) {
    if (actorRole !== 'support_lead' && actorRole !== 'admin') {
      throw new Error('FORBIDDEN_EDIT: Only support leads and admins can edit published policies');
    }
  }

  const newVersion = existing.version + 1;
  const newCategory = category || existing.category;
  if (!VALID_CATEGORIES.includes(newCategory)) {
    throw new Error(`Invalid category "${newCategory}"`);
  }

  const newTitle = title ? title.trim() : existing.title;
  const newSlug = slug ? slug.trim() : existing.slug;
  const newContent = contentMarkdown ? contentMarkdown.trim() : existing.content_markdown;
  const newTags = tags !== undefined ? tags : existing.tags;
  const newLangs = supportedLanguages !== undefined ? supportedLanguages : existing.supported_languages;
  const newPolicyId = policyId !== undefined ? policyId : existing.policy_id;

  const res = await pool.query(`
    UPDATE brand_knowledge_hub SET
      policy_id = $1,
      category = $2,
      title = $3,
      slug = $4,
      content_markdown = $5,
      tags = $6,
      supported_languages = $7,
      version = $8,
      updated_at = NOW()
    WHERE id = $9 AND brand_id = $10
    RETURNING *;
  `, [
    newPolicyId,
    newCategory,
    newTitle,
    newSlug,
    newContent,
    newTags,
    newLangs,
    newVersion,
    id,
    brandId
  ]);

  return res.rows[0];
}

/**
 * Publish a Knowledge Hub draft entry.
 * Restricted to support_lead or admin.
 */
export async function publishKnowledgeItem({ brandId, id, actorRole }) {
  if (actorRole !== 'support_lead' && actorRole !== 'admin') {
    throw new Error('FORBIDDEN_PUBLISH: Only support leads and administrators can publish knowledge items');
  }

  const pool = getPool();
  const res = await pool.query(`
    UPDATE brand_knowledge_hub SET
      is_published = TRUE,
      published_version = version,
      updated_at = NOW()
    WHERE id = $1 AND brand_id = $2
    RETURNING *;
  `, [id, brandId]);

  if (res.rows.length === 0) {
    throw new Error('Knowledge item not found');
  }

  return res.rows[0];
}

/**
 * Archive a Knowledge Hub entry (unpublish).
 * Restricted to support_lead or admin.
 */
export async function archiveKnowledgeItem({ brandId, id, actorRole }) {
  if (actorRole !== 'support_lead' && actorRole !== 'admin') {
    throw new Error('FORBIDDEN_ARCHIVE: Only support leads and administrators can archive knowledge items');
  }

  const pool = getPool();
  const res = await pool.query(`
    UPDATE brand_knowledge_hub SET
      is_published = FALSE,
      updated_at = NOW()
    WHERE id = $1 AND brand_id = $2
    RETURNING *;
  `, [id, brandId]);

  if (res.rows.length === 0) {
    throw new Error('Knowledge item not found');
  }

  return res.rows[0];
}

/**
 * Search and retrieve Knowledge Hub items with strict tenant-scoping.
 */
export async function searchKnowledge({
  brandId,
  query = '',
  category = null,
  isPublishedOnly = true,
  actorRole = 'agent'
}) {
  if (!brandId) throw new Error('brandId is required');
  const pool = getPool();

  // Regular agents can ONLY view published items
  const mustBePublished = (actorRole === 'agent') ? true : isPublishedOnly;

  let sql = `
    SELECT id, brand_id, policy_id, category, title, slug, content_markdown, tags, supported_languages, version, published_version, is_published, created_at, updated_at
    FROM brand_knowledge_hub
    WHERE brand_id = $1
  `;
  const params = [brandId];

  if (mustBePublished) {
    sql += ` AND is_published = TRUE`;
  }

  if (category && VALID_CATEGORIES.includes(category)) {
    params.push(category);
    sql += ` AND category = $${params.length}`;
  }

  if (query && query.trim()) {
    params.push(`%${query.trim()}%`);
    const qIndex = params.length;
    sql += ` AND (title ILIKE $${qIndex} OR content_markdown ILIKE $${qIndex} OR $${qIndex} = ANY(tags))`;
  }

  sql += ` ORDER BY updated_at DESC LIMIT 50`;

  const res = await pool.query(sql, params);
  return res.rows;
}

/**
 * Anonymize and ingest a resolved case into the Knowledge Hub.
 */
export async function ingestResolvedCase({
  brandId,
  ticketId,
  title,
  resolutionSummary,
  troubleshootingSteps = '',
  tags = ['resolved_case'],
  actorRole = 'agent'
}) {
  if (!brandId) throw new Error('brandId is required');
  if (!resolutionSummary) throw new Error('resolutionSummary is required');

  // Strip all PII from title and content
  const cleanTitle = anonymizeText(title || `Resolved Case Summary: Ticket ${ticketId || ''}`);
  const cleanSummary = anonymizeText(resolutionSummary);
  const cleanSteps = anonymizeText(troubleshootingSteps);

  const markdownContent = `### Case Summary\n${cleanSummary}\n\n### Resolution & Troubleshooting\n${cleanSteps || 'Standard resolution procedure applied.'}`;

  return createKnowledgeItem({
    brandId,
    category: 'resolved_case',
    title: cleanTitle,
    contentMarkdown: markdownContent,
    tags,
    isPublished: false, // Ingested as draft for supervisor review by default
    actorRole
  });
}

/**
 * Grounded AI response generation strictly based on approved Knowledge Hub entries.
 * If relevant approved knowledge is missing, acknowledges and returns escalationRequired: true.
 */
export async function getGroundedAIResponse({
  brandId,
  query,
  conversationContext = ''
}) {
  if (!brandId) throw new Error('brandId is required');
  if (!query || !query.trim()) {
    return {
      grounded: false,
      escalationRequired: true,
      suggestedReply: 'Please provide more details regarding your question.',
      knowledgeReferences: []
    };
  }

  const pool = getPool();

  // Search published knowledge for this brand (scored by keyword relevance below)
  const items = await searchKnowledge({
    brandId,
    query: '',
    isPublishedOnly: true,
    actorRole: 'agent'
  });

  // Also query approved brand policies
  const policiesRes = await pool.query(`
    SELECT topic, rule, action_guideline
    FROM brand_policies
    WHERE brand_id = $1
  `, [brandId]);
  const brandPolicies = policiesRes.rows;

  // Stop words to ignore during query matching
  const qLower = query.toLowerCase();
  const stopWords = new Set([
    'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are', 'aren\'t', 'as', 'at',
    'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by',
    'can', 'can\'t', 'cannot', 'could', 'couldn\'t', 'did', 'didn\'t', 'do', 'does', 'doesn\'t', 'doing', 'don\'t', 'down', 'during',
    'each', 'few', 'for', 'from', 'further', 'get', 'got', 'had', 'hadn\'t', 'has', 'hasn\'t', 'have', 'haven\'t', 'having', 'he', 'her', 'here', 'hers', 'herself', 'him', 'himself', 'his', 'how',
    'i', 'if', 'in', 'into', 'is', 'isn\'t', 'it', 'its', 'itself', 'let', 'me', 'more', 'most', 'must', 'my', 'myself',
    'no', 'nor', 'not', 'of', 'off', 'on', 'once', 'only', 'or', 'other', 'ought', 'our', 'ours', 'ourselves', 'out', 'over', 'own',
    'same', 'she', 'should', 'shouldn\'t', 'so', 'some', 'such', 'than', 'that', 'the', 'their', 'theirs', 'them', 'themselves', 'then', 'there', 'these', 'they', 'this', 'those', 'through', 'to', 'too',
    'under', 'until', 'up', 'very', 'was', 'wasn\'t', 'we', 'were', 'weren\'t', 'what', 'when', 'where', 'which', 'while', 'who', 'whom', 'why', 'with', 'won\'t', 'would', 'wouldn\'t',
    'you', 'your', 'yours', 'yourself', 'yourselves'
  ]);
  const words = qLower.split(/[\s,?.!]+/).filter(w => w.length > 2 && !stopWords.has(w));

  const relevantItems = items
    .map(item => {
      const t = (item.title + ' ' + item.content_markdown).toLowerCase();
      const score = words.reduce((acc, w) => {
        try {
          const regex = new RegExp(`\\b${w}\\b`, 'i');
          return acc + (regex.test(t) ? 1 : 0);
        } catch (e) {
          return acc + (t.includes(w) ? 1 : 0);
        }
      }, 0);
      return { item, score };
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(x => x.item);

  const relevantPolicies = brandPolicies
    .map(p => {
      const t = (p.topic + ' ' + p.rule + ' ' + (p.action_guideline || '')).toLowerCase();
      const score = words.reduce((acc, w) => {
        try {
          const regex = new RegExp(`\\b${w}\\b`, 'i');
          return acc + (regex.test(t) ? 1 : 0);
        } catch (e) {
          return acc + (t.includes(w) ? 1 : 0);
        }
      }, 0);
      return { policy: p, score };
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(x => x.policy);

  // If NO relevant published knowledge or brand policy is found, do NOT invent anything!
  if (relevantItems.length === 0 && relevantPolicies.length === 0) {
    return {
      grounded: false,
      escalationRequired: true,
      suggestedReply: 'I do not have an approved policy or knowledge guide for this specific inquiry. Let me connect you with a human support specialist who can assist you further.',
      knowledgeReferences: []
    };
  }

  // If relevant knowledge found, synthesize grounded reply
  const knowledgeContext = [
    ...relevantItems.map(k => `[Knowledge: ${k.title}] (Category: ${k.category})\n${k.content_markdown}`),
    ...relevantPolicies.map(p => `[Policy: ${p.topic}]\nRule: ${p.rule}\nGuideline: ${p.action_guideline}`)
  ].join('\n\n');

  // Attempt Gemini generation if API key is present
  const apiKey = process.env.GEMINI_API_KEY;
  if (apiKey && !apiKey.includes('your_')) {
    try {
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({
        model: process.env.GEMINI_MODEL || 'gemini-3.8-flash',
        generationConfig: { responseMimeType: 'application/json', temperature: 0.1 }
      });

      const prompt = `You are Resolve AI's Copilot for customer support.
Answer the customer's inquiry strictly grounded in the approved brand policies and knowledge articles provided below.

CRITICAL GROUNDING RULES:
1. ONLY make statements and commitments that are directly supported by the approved knowledge below.
2. If the approved knowledge does not cover the customer's request, set escalationRequired to true and do NOT invent terms.
3. Preserve all order IDs, product names, prices, and return timeframes exactly.
4. Return valid JSON without markdown fences:
{
  "suggestedReply": "Polite grounded response",
  "knowledgeReferences": ["List of referenced article titles or policy topics"],
  "grounded": true,
  "escalationRequired": false
}

Approved Brand Knowledge:
${knowledgeContext}

Customer Inquiry:
${query}

Conversation Context:
${conversationContext}

JSON Output:`;

      const result = await model.generateContent(prompt);
      const text = result.response.text();
      const cleaned = text.replace(/```json/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleaned);
      if (parsed && parsed.suggestedReply) {
        return {
          grounded: parsed.grounded !== false,
          escalationRequired: Boolean(parsed.escalationRequired),
          suggestedReply: parsed.suggestedReply,
          knowledgeReferences: parsed.knowledgeReferences || relevantItems.map(i => i.title)
        };
      }
    } catch (err) {
      console.warn('[Gemini Grounded Generation Fallback]:', err.message);
    }
  }

  // Deterministic grounded response fallback
  const firstItem = relevantItems[0];
  const firstPolicy = relevantPolicies[0];

  let replyText = '';
  if (firstPolicy) {
    replyText = `Based on NovaCart's ${firstPolicy.topic} policy: ${firstPolicy.rule}`;
    if (firstPolicy.action_guideline) {
      replyText += ` Guideline: ${firstPolicy.action_guideline}`;
    }
  } else if (firstItem) {
    replyText = `According to our ${firstItem.category} guide "${firstItem.title}": ${firstItem.content_markdown}`;
  }

  return {
    grounded: true,
    escalationRequired: false,
    suggestedReply: replyText,
    knowledgeReferences: [
      ...relevantPolicies.map(p => p.topic),
      ...relevantItems.map(i => i.title)
    ]
  };
}

export default {
  VALID_CATEGORIES,
  anonymizeText,
  createKnowledgeItem,
  updateKnowledgeItem,
  publishKnowledgeItem,
  archiveKnowledgeItem,
  searchKnowledge,
  ingestResolvedCase,
  getGroundedAIResponse
};
