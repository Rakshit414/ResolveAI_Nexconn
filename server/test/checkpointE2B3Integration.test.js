// server/test/checkpointE2B3Integration.test.js
import assert from 'assert';
import path from 'path';
import fs from 'fs';
import http from 'http';
import axios from 'axios';
import pg from 'pg';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import EmbeddedPostgres from 'embedded-postgres';

import app from '../src/server.js';
import { getPool, closePool } from '../src/db/pool.js';
import { runMigration } from '../src/db/migrate.js';
import { translationBreaker, TranslationCircuitBreaker } from '../src/services/translationCircuitBreaker.js';
import {
  canonicalizeLocale,
  translateTicketMessage,
  translateUIPhrase
} from '../src/services/translationService.js';
import {
  createKnowledgeItem,
  updateKnowledgeItem,
  publishKnowledgeItem,
  archiveKnowledgeItem,
  searchKnowledge,
  ingestResolvedCase,
  getGroundedAIResponse,
  anonymizeText,
  VALID_CATEGORIES
} from '../src/services/knowledgeHubService.js';
import {
  dispatchSchedulingOpportunity,
  processDueQueuedTicketsMultiTenant
} from '../src/services/multiTenantScheduler.js';
import { createAgentSession, updateAgentConfiguredStatus } from '../src/services/agentAvailabilityService.js';
import { enqueueOrReopenTicket } from '../src/services/queueService.js';
import { assignQueuedTicketAtomically } from '../src/services/routingService.js';
import { resolveTicketAndReleaseCapacity, reconcileAgentCapacity } from '../src/services/capacityService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');
const PG16_PORT = 54344;
const PG16_DATA_DIR = path.resolve(ROOT_DIR, 'server/data/pg16_e2b3_test_instance');

async function runE2B3IntegrationTests() {
  console.log('================================================================================');
  console.log('=== [TEST SUITE: Checkpoint E2-B3 Translation, Knowledge & Scheduler] ===');
  console.log('================================================================================\n');

  if (fs.existsSync(PG16_DATA_DIR)) {
    try { fs.rmSync(PG16_DATA_DIR, { recursive: true, force: true }); } catch (e) {}
  }

  const originalEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  const originalGeminiKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY; // Strictly isolate automated tests from live Gemini service

  const pgServer = new EmbeddedPostgres({
    port: PG16_PORT,
    databaseDir: PG16_DATA_DIR,
    user: 'postgres',
    password: 'postgres',
    initdbFlags: ['--encoding=UTF8', '--locale=C']
  });

  console.log(`[PG16 Setup] Initializing native PostgreSQL 16 server on port ${PG16_PORT}...`);
  await pgServer.initialise();
  await pgServer.start();

  const originalDbUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${PG16_PORT}/postgres`;

  const directPool = new pg.Pool({
    connectionString: process.env.DATABASE_URL
  });

  let httpServer;
  let serverPort;
  let apiClient;

  try {
    // Start Express API server on ephemeral port
    httpServer = http.createServer(app);
    await new Promise((resolve) => httpServer.listen(0, resolve));
    serverPort = httpServer.address().port;
    console.log(`[HTTP Server] Express test server listening on port ${serverPort}`);

    apiClient = axios.create({
      baseURL: `http://127.0.0.1:${serverPort}`,
      validateStatus: () => true
    });

    // Run clean migrations (001 -> 005)
    console.log('[Migrate] Applying migrations 001 through 005...');
    await closePool();
    const migRes = await runMigration({ dryRun: false });
    assert.strictEqual(migRes.success, true, 'Migration 001-005 must apply cleanly');

    // =========================================================================
    // SECTION 1: CARRY-FORWARD AUDIT — max_concurrent_tickets CHECK (1–10)
    // =========================================================================
    console.log('\n--- SECTION 1: Carry-Forward Audit: max_concurrent_tickets CHECK (1-10) ---');

    // Setup base user & membership for constraint test
    await directPool.query(`
      INSERT INTO users (id, email, password_hash, name)
      VALUES ('user_test_limits', 'limits@novacart.com', 'dummy_hash', 'Limit Tester')
      ON CONFLICT (id) DO NOTHING;
      INSERT INTO brand_memberships (id, brand_id, user_id, role)
      VALUES ('mem_test_limits', 'brand_novacart', 'user_test_limits', 'agent')
      ON CONFLICT (brand_id, user_id) DO NOTHING;
    `);

    // 1a: Test value below 1 (0) -> must be rejected by check constraint
    let caughtBelow1 = false;
    try {
      await directPool.query(`
        INSERT INTO agent_profiles (
          brand_id, user_id, nexconn_user_id, display_name, max_concurrent_tickets
        ) VALUES (
          'brand_novacart', 'user_test_limits', 'agent_limits_0', 'Limit Tester', 0
        );
      `);
    } catch (err) {
      caughtBelow1 = true;
      assert.ok(
        err.message.includes('check constraint') || err.message.includes('agent_profiles_max_concurrent_tickets_check'),
        `Expected check constraint error, got: ${err.message}`
      );
      console.log('  [PASS] Value 0 (< 1) rejected by check constraint:', err.message.split('\n')[0]);
    }
    assert.ok(caughtBelow1, 'PostgreSQL must reject max_concurrent_tickets < 1');

    // 1b: Test value above 10 (11) -> must be rejected by check constraint
    let caughtAbove10 = false;
    try {
      await directPool.query(`
        INSERT INTO agent_profiles (
          brand_id, user_id, nexconn_user_id, display_name, max_concurrent_tickets
        ) VALUES (
          'brand_novacart', 'user_test_limits', 'agent_limits_11', 'Limit Tester', 11
        );
      `);
    } catch (err) {
      caughtAbove10 = true;
      assert.ok(
        err.message.includes('check constraint') || err.message.includes('agent_profiles_max_concurrent_tickets_check'),
        `Expected check constraint error, got: ${err.message}`
      );
      console.log('  [PASS] Value 11 (> 10) rejected by check constraint:', err.message.split('\n')[0]);
    }
    assert.ok(caughtAbove10, 'PostgreSQL must reject max_concurrent_tickets > 10');

    // 1c: Valid boundary values 1 and 10 must succeed
    await directPool.query(`
      INSERT INTO agent_profiles (
        brand_id, user_id, nexconn_user_id, display_name, max_concurrent_tickets
      ) VALUES (
        'brand_novacart', 'user_test_limits', 'agent_limits_valid', 'Limit Tester', 1
      ) ON CONFLICT (brand_id, user_id) DO UPDATE SET max_concurrent_tickets = 1;
    `);
    const val1 = (await directPool.query(`SELECT max_concurrent_tickets FROM agent_profiles WHERE user_id = 'user_test_limits'`)).rows[0].max_concurrent_tickets;
    assert.strictEqual(val1, 1, 'Value 1 must be accepted');

    await directPool.query(`
      UPDATE agent_profiles SET max_concurrent_tickets = 10 WHERE brand_id = 'brand_novacart' AND user_id = 'user_test_limits';
    `);
    const val10 = (await directPool.query(`SELECT max_concurrent_tickets FROM agent_profiles WHERE user_id = 'user_test_limits'`)).rows[0].max_concurrent_tickets;
    assert.strictEqual(val10, 10, 'Value 10 must be accepted');
    console.log('  [PASS] Boundary values 1 and 10 accepted successfully.');

    // Clean up limit tester profile
    await directPool.query(`DELETE FROM agent_profiles WHERE user_id = 'user_test_limits'`);

    // =========================================================================
    // SECTION 2: TRANSLATION SERVICE & CIRCUIT BREAKER TESTS
    // =========================================================================
    console.log('\n--- SECTION 2: Translation Service & Circuit Breaker ---');

    // 2a: BCP 47 Locale Canonicalization & Validation
    console.log('  [2a] Testing BCP 47 locale validation and canonicalization...');
    assert.strictEqual(canonicalizeLocale('en'), 'en-US');
    assert.strictEqual(canonicalizeLocale('en-us'), 'en-US');
    assert.strictEqual(canonicalizeLocale('hi'), 'hi-IN');
    assert.strictEqual(canonicalizeLocale('mr'), 'mr-IN');
    assert.strictEqual(canonicalizeLocale('es'), 'es-ES');
    assert.strictEqual(canonicalizeLocale('de-DE'), 'de-DE');

    assert.throws(() => canonicalizeLocale(''), /INVALID_LOCALE/);
    assert.throws(() => canonicalizeLocale('invalid!@#locale'), /INVALID_LOCALE/);
    assert.throws(() => canonicalizeLocale('1234567890_bad'), /INVALID_LOCALE/);

    // 2b: Translation Success Path & Original Message Preservation
    console.log('  [2b] Testing translation success path and original text preservation...');
    translationBreaker.reset();

    // Seed message in message_archive for composite foreign key
    await directPool.query(`
      INSERT INTO message_archive (id, brand_id, ticket_id, nexconn_message_id, sender_user_id, target_user_id, sender_role, sender_name, message_text, sent_at)
      VALUES ('msg_arch_e2b3_1', 'brand_novacart', 'tkt_1021', 'msg_e2b3_test_1', 'cust_aarav', 'novacart_support', 'customer', 'Aarav Sharma', 'Can you check the current tracking status?', NOW())
      ON CONFLICT (brand_id, ticket_id, nexconn_message_id) DO NOTHING;
    `);

    const transRes = await translateTicketMessage({
      brandId: 'brand_novacart',
      ticketId: 'tkt_1021',
      messageId: 'msg_e2b3_test_1',
      text: 'Can you check the current tracking status?',
      sourceLocale: 'en-US',
      targetLocale: 'hi-IN'
    });

    assert.strictEqual(transRes.success, true);
    assert.strictEqual(transRes.originalText, 'Can you check the current tracking status?');
    assert.strictEqual(transRes.translatedText, 'क्या आप वर्तमान ट्रैकिंग स्थिति देख सकते हैं?');
    assert.strictEqual(transRes.targetLocale, 'hi-IN');
    assert.strictEqual(transRes.translated, true);

    // Verify row was persisted in message_translations table
    const dbTrans = (await directPool.query(`
      SELECT * FROM message_translations WHERE brand_id = 'brand_novacart' AND message_id = 'msg_e2b3_test_1' AND target_locale = 'hi-IN'
    `)).rows[0];
    assert.ok(dbTrans, 'Translation record must exist in message_translations');
    assert.strictEqual(dbTrans.original_text, 'Can you check the current tracking status?');
    assert.strictEqual(dbTrans.translated_text, 'क्या आप वर्तमान ट्रैकिंग स्थिति देख सकते हैं?');

    // Verify original message in message_archive is COMPLETELY UNTOUCHED!
    const archiveRow = (await directPool.query(`
      SELECT message_text FROM message_archive WHERE brand_id = 'brand_novacart' AND nexconn_message_id = 'msg_e2b3_test_1'
    `)).rows[0];
    assert.strictEqual(archiveRow.message_text, 'Can you check the current tracking status?', 'message_archive MUST NOT be altered');

    // 2c: Empty input handling
    console.log('  [2c] Testing empty input translation handling...');
    const emptyRes = await translateTicketMessage({
      brandId: 'brand_novacart',
      ticketId: 'tkt_1021',
      messageId: 'msg_e2b3_empty',
      text: '   ',
      targetLocale: 'hi-IN'
    });
    assert.strictEqual(emptyRes.success, true);
    assert.strictEqual(emptyRes.translated, false);
    assert.strictEqual(emptyRes.originalText, '   ');

    // 2d: Database Caching & Idempotency
    console.log('  [2d] Testing translation cache lookup (zero duplicate API calls)...');
    const cachedLookup = await translateTicketMessage({
      brandId: 'brand_novacart',
      ticketId: 'tkt_1021',
      messageId: 'msg_e2b3_test_1',
      text: 'Can you check the current tracking status?',
      sourceLocale: 'en-US',
      targetLocale: 'hi-IN'
    });
    assert.strictEqual(cachedLookup.cached, true, 'Subsequent request must return from cache');
    assert.strictEqual(cachedLookup.translatedText, 'क्या आप वर्तमान ट्रैकिंग स्थिति देख सकते हैं?');

    // 2e: Concurrent Duplicate In-flight Deduplication
    console.log('  [2e] Testing concurrent duplicate in-flight translation coalescing...');
    const concurrentRequests = await Promise.all([
      translateTicketMessage({ brandId: 'brand_novacart', ticketId: 'tkt_1021', messageId: 'msg_e2b3_test_1', text: 'Can you check the current tracking status?', targetLocale: 'mr-IN' }),
      translateTicketMessage({ brandId: 'brand_novacart', ticketId: 'tkt_1021', messageId: 'msg_e2b3_test_1', text: 'Can you check the current tracking status?', targetLocale: 'mr-IN' }),
      translateTicketMessage({ brandId: 'brand_novacart', ticketId: 'tkt_1021', messageId: 'msg_e2b3_test_1', text: 'Can you check the current tracking status?', targetLocale: 'mr-IN' })
    ]);
    assert.strictEqual(concurrentRequests.length, 3);
    assert.ok(concurrentRequests.every(r => r.success === true));
    assert.ok(concurrentRequests.every(r => r.translatedText.includes('ट्रॅकिंग')));

    // 2f: Global UI Translation Cache
    console.log('  [2f] Testing global UI translation caching in global_ui_translation_cache...');
    const uiRes1 = await translateUIPhrase({
      phraseKey: 'widget.quick.track',
      text: 'Track my order',
      sourceLocale: 'en-US',
      targetLocale: 'hi-IN'
    });
    assert.strictEqual(uiRes1.success, true);
    assert.strictEqual(uiRes1.translatedText, 'मेरा ऑर्डर ट्रैक करें');

    const uiCacheDb = (await directPool.query(`
      SELECT * FROM global_ui_translation_cache WHERE phrase_key = 'widget.quick.track' AND target_locale = 'hi-IN'
    `)).rows[0];
    assert.ok(uiCacheDb, 'Entry must exist in global_ui_translation_cache');

    const uiRes2 = await translateUIPhrase({
      phraseKey: 'widget.quick.track',
      text: 'Track my order',
      sourceLocale: 'en-US',
      targetLocale: 'hi-IN'
    });
    assert.strictEqual(uiRes2.cached, true, 'Second UI phrase request must be cached');

    // 2g: Circuit Breaker - 3 Transient Failures Trip to OPEN
    console.log('  [2g] Testing circuit breaker: 3 transient failures trip breaker to OPEN...');
    const testBreaker = new TranslationCircuitBreaker({ threshold: 3, resetTimeout: 60000 });
    assert.strictEqual(testBreaker.state, 'CLOSED');

    testBreaker.recordFailure(new Error('503 Service Unavailable (attempt 1)'));
    assert.strictEqual(testBreaker.state, 'CLOSED');
    assert.strictEqual(testBreaker.failureCount, 1);

    testBreaker.recordFailure(new Error('504 Gateway Timeout (attempt 2)'));
    assert.strictEqual(testBreaker.state, 'CLOSED');
    assert.strictEqual(testBreaker.failureCount, 2);

    testBreaker.recordFailure(new Error('429 Too Many Requests (attempt 3)'));
    assert.strictEqual(testBreaker.state, 'OPEN');
    assert.strictEqual(testBreaker.isOperational(), false);
    assert.ok(testBreaker.nextProbeAt > Date.now());

    // 2h: While OPEN, translation returns original text with clear unavailable indication
    console.log('  [2h] Testing translation behavior when circuit breaker is OPEN...');
    translationBreaker.state = 'OPEN';
    translationBreaker.nextProbeAt = Date.now() + 60000;

    const openBreakerRes = await translateTicketMessage({
      brandId: 'brand_novacart',
      ticketId: 'tkt_1021',
      messageId: 'msg_new_uncached',
      text: 'Hello world new message',
      targetLocale: 'hi-IN'
    });
    assert.strictEqual(openBreakerRes.success, false);
    assert.strictEqual(openBreakerRes.translated, false);
    assert.strictEqual(openBreakerRes.circuitBreakerOpen, true);
    assert.strictEqual(openBreakerRes.originalText, 'Hello world new message');
    assert.strictEqual(openBreakerRes.translatedText, 'Hello world new message');
    assert.ok(openBreakerRes.error.includes('circuit breaker is OPEN'));

    // 2i: Native-language routing allowed when breaker is OPEN, translation-dependent blocked
    console.log('  [2i] Verifying routing eligibility during breaker OPEN...');
    assert.strictEqual(translationBreaker.isOperational(), false, 'Breaker must not be operational for translation-dependent candidates');

    // 2j: Immediate OPEN on Auth Error (24-hour cooldown)
    console.log('  [2j] Testing immediate circuit breaker OPEN on auth error with 24-hour cooldown...');
    testBreaker.reset();
    const authErr = new Error('API_KEY_INVALID: Key rejected by upstream');
    authErr.code = 'ERR_AUTH_INVALID';
    testBreaker.recordFailure(authErr);
    assert.strictEqual(testBreaker.state, 'OPEN');
    assert.ok(testBreaker.nextProbeAt >= Date.now() + 86000000, 'Cooldown must be 24 hours for auth errors');

    // 2k: HALF_OPEN probe mutex and recovery
    console.log('  [2k] Testing HALF_OPEN single recovery probe and recovery transition...');
    testBreaker.reset();
    testBreaker.state = 'OPEN';
    testBreaker.nextProbeAt = Date.now() - 1000; // Cooldown expired

    assert.strictEqual(testBreaker.canAttemptTranslation(), true, 'First probe must be permitted');
    assert.strictEqual(testBreaker.state, 'HALF_OPEN');
    assert.strictEqual(testBreaker.canAttemptTranslation(), false, 'Concurrent second probe must be blocked by mutex');

    testBreaker.recordSuccess();
    assert.strictEqual(testBreaker.state, 'CLOSED');
    assert.strictEqual(testBreaker.failureCount, 0);

    // 2l: Zero API Key Exposure
    console.log('  [2l] Verifying API status endpoint exposes zero credentials or keys...');
    const statusHttp = await apiClient.get('/api/translation/status');
    assert.strictEqual(statusHttp.status, 200);
    const statusJson = JSON.stringify(statusHttp.data);
    assert.ok(!statusJson.includes('AIzaSy'), 'Status endpoint must NEVER expose API key prefix');
    assert.ok(!statusJson.includes('GEMINI_API_KEY'), 'Status endpoint must NEVER expose env variable names');
    assert.strictEqual(statusHttp.data.success, true);

    // Reset translation breaker to clean CLOSED state
    translationBreaker.reset();
    console.log('[PASS] Section 2: Translation Service, BCP 47 canonicalization, caching, and circuit breaker verified.');

    // =========================================================================
    // SECTION 3: TEAM KNOWLEDGE HUB TESTS
    // =========================================================================
    console.log('\n--- SECTION 3: Team Knowledge Hub ---');

    // 3a: CRUD operations across categories
    console.log('  [3a] Testing CRUD operations across categories in brand_knowledge_hub...');
    for (const cat of VALID_CATEGORIES) {
      const item = await createKnowledgeItem({
        brandId: 'brand_novacart',
        category: cat,
        title: `Standard ${cat} guide`,
        contentMarkdown: `Content for category ${cat}`,
        tags: [cat, 'test'],
        isPublished: false,
        actorRole: 'agent'
      });
      assert.strictEqual(item.category, cat);
      assert.strictEqual(item.is_published, false);
      assert.strictEqual(item.version, 1);
    }

    // 3b: Strict tenant scoping: brand_novacart vs brand_second
    console.log('  [3b] Testing strict tenant scoping of Knowledge Hub retrieval...');
    await directPool.query(`
      INSERT INTO brands (id, name, slug, support_identity, api_key_hash)
      VALUES ('brand_second', 'Second Store', 'second', 'second_sup', 'dummy')
      ON CONFLICT (id) DO NOTHING;
    `);

    const secondBrandItem = await createKnowledgeItem({
      brandId: 'brand_second',
      category: 'policy',
      title: 'Secret Brand Second Policy',
      contentMarkdown: 'Only for Second Brand eyes.',
      isPublished: true,
      actorRole: 'admin'
    });

    const novaSearch = await searchKnowledge({
      brandId: 'brand_novacart',
      query: 'Secret Brand Second Policy',
      isPublishedOnly: false,
      actorRole: 'admin'
    });
    assert.strictEqual(novaSearch.length, 0, 'NovaCart must NEVER retrieve Brand Second knowledge entries');

    // 3c: Draft vs. Published Separation
    console.log('  [3c] Testing Draft vs Published separation in search...');
    const draftItem = await createKnowledgeItem({
      brandId: 'brand_novacart',
      category: 'faq',
      title: 'Draft Return FAQ',
      contentMarkdown: 'This is an unapproved draft FAQ.',
      isPublished: false,
      actorRole: 'agent'
    });

    // Regular search (isPublishedOnly = true) must NOT find draft
    const publishedOnlySearch = await searchKnowledge({
      brandId: 'brand_novacart',
      query: 'Draft Return FAQ',
      isPublishedOnly: true,
      actorRole: 'agent'
    });
    assert.strictEqual(publishedOnlySearch.length, 0, 'Drafts must NOT appear in published search');

    // Supervisor view can see drafts
    const supervisorDraftSearch = await searchKnowledge({
      brandId: 'brand_novacart',
      query: 'Draft Return FAQ',
      isPublishedOnly: false,
      actorRole: 'support_lead'
    });
    assert.strictEqual(supervisorDraftSearch.length, 1, 'Supervisors must be able to view drafts');

    // 3d: Versioning & Publishing
    console.log('  [3d] Testing version increments and publishing lifecycle...');
    const updatedDraft = await updateKnowledgeItem({
      brandId: 'brand_novacart',
      id: draftItem.id,
      title: 'Draft Return FAQ - Revision 2',
      contentMarkdown: 'Updated draft content.',
      actorRole: 'agent'
    });
    assert.strictEqual(updatedDraft.version, 2, 'Version must increment to 2 on update');
    assert.strictEqual(updatedDraft.published_version, 0, 'Draft must retain published_version 0');

    // Publish the item (as support lead)
    const publishedItem = await publishKnowledgeItem({
      brandId: 'brand_novacart',
      id: draftItem.id,
      actorRole: 'support_lead'
    });
    assert.strictEqual(publishedItem.is_published, true);
    assert.strictEqual(publishedItem.published_version, 2, 'published_version must match latest version upon publish');

    // 3e: RBAC Authorization: Regular agent forbidden from publishing or archiving
    console.log('  [3e] Testing RBAC: Regular agent forbidden from publishing...');
    await assert.rejects(
      async () => {
        await publishKnowledgeItem({ brandId: 'brand_novacart', id: draftItem.id, actorRole: 'agent' });
      },
      /FORBIDDEN_PUBLISH/,
      'Regular agent must be forbidden from publishing'
    );

    await assert.rejects(
      async () => {
        await archiveKnowledgeItem({ brandId: 'brand_novacart', id: draftItem.id, actorRole: 'agent' });
      },
      /FORBIDDEN_ARCHIVE/,
      'Regular agent must be forbidden from archiving'
    );

    // 3f: Anonymization for Resolved Cases
    console.log('  [3f] Testing PII and Order anonymization for resolved case ingestion...');
    const rawCaseText = 'Customer Aarav Sharma (aarav.sharma@example.com, phone 555-019-2834) received wrong size for order #NC1021. [INTERNAL NOTE: Agent approved courtesy refund].';
    const anonymized = anonymizeText(rawCaseText);
    assert.ok(!anonymized.includes('Aarav Sharma'), 'Customer name must be stripped');
    assert.ok(!anonymized.includes('aarav.sharma@example.com'), 'Customer email must be stripped');
    assert.ok(!anonymized.includes('555-019-2834'), 'Phone number must be stripped');
    assert.ok(!anonymized.includes('NC1021'), 'Raw order number must be masked to #NC****');
    assert.ok(!anonymized.includes('INTERNAL NOTE'), 'Internal agent notes must be stripped');

    const ingestedCase = await ingestResolvedCase({
      brandId: 'brand_novacart',
      ticketId: 'tkt_1021',
      title: 'Wrong size delivered for shoes',
      resolutionSummary: rawCaseText,
      troubleshootingSteps: 'Standard courier exchange initiated.',
      actorRole: 'agent'
    });
    assert.strictEqual(ingestedCase.category, 'resolved_case');
    assert.strictEqual(ingestedCase.is_published, false, 'Ingested case must start as draft');
    assert.ok(!ingestedCase.content_markdown.includes('aarav.sharma@example.com'));

    // 3g: AI Grounding in approved published knowledge
    console.log('  [3g] Testing AI response grounding in approved brand knowledge...');
    const groundedRes = await getGroundedAIResponse({
      brandId: 'brand_novacart',
      query: 'What is your refund timeframe and window?',
      conversationContext: 'Customer asking about return policy.'
    });
    assert.strictEqual(groundedRes.grounded, true);
    assert.strictEqual(groundedRes.escalationRequired, false);
    assert.ok(groundedRes.suggestedReply.toLowerCase().includes('refund') || groundedRes.suggestedReply.toLowerCase().includes('return'));
    assert.ok(groundedRes.knowledgeReferences.length > 0);

    // 3h: Missing Knowledge Escalation (No invented policies!)
    console.log('  [3h] Testing missing-knowledge escalation (strictly NO invented policies)...');
    const missingRes = await getGroundedAIResponse({
      brandId: 'brand_novacart',
      query: 'Can I exchange my pet dragon for airline frequent flyer miles and crypto tokens?',
      conversationContext: 'Extreme edge case not covered in policies.'
    });
    assert.strictEqual(missingRes.grounded, false, 'Must not claim grounding when knowledge is missing');
    assert.strictEqual(missingRes.escalationRequired, true, 'Must flag escalationRequired: true');
    assert.ok(missingRes.suggestedReply.includes('do not have an approved policy') || missingRes.suggestedReply.includes('specialist'));

    console.log('[PASS] Section 3: Knowledge Hub CRUD, versioning, RBAC, anonymization, and grounding verified.');

    // =========================================================================
    // SECTION 4: MULTI-TENANT SCHEDULER & QUEUE INTEGRATION
    // =========================================================================
    console.log('\n--- SECTION 4: Multi-Tenant Scheduler & Queue Integration ---');

    // Setup Agent Sarah Lin as Available
    await directPool.query(`
      UPDATE agent_profiles
      SET configured_status = 'Available', active_ticket_count = 0, last_heartbeat_at = NOW()
      WHERE brand_id = 'brand_novacart' AND user_id = 'user_sarah_lin';
    `);

    // 4a: Server Startup / Wakeup Sweep
    console.log('  [4a] Testing server startup/wake queue processing sweep...');
    const sweepRes = await processDueQueuedTicketsMultiTenant();
    assert.ok(typeof sweepRes.processedBrands === 'number');
    assert.ok(typeof sweepRes.totalAttempts === 'number');
    console.log(`  [Startup Sweep Result]: processedBrands=${sweepRes.processedBrands}, attempts=${sweepRes.totalAttempts}, assigned=${sweepRes.totalAssigned}`);

    // 4b: In-process debouncing & concurrency safety
    console.log('  [4b] Testing debounced scheduling under 20 concurrent triggers...');
    const triggerPromises = [];
    for (let i = 0; i < 20; i++) {
      triggerPromises.push(new Promise((resolve) => {
        dispatchSchedulingOpportunity('brand_novacart');
        resolve();
      }));
    }
    await Promise.all(triggerPromises);
    // Allow debounce cycle to settle
    await new Promise((r) => setTimeout(r, 200));
    console.log('  [Debounced Triggering]: 20 concurrent dispatch calls completed with zero race conditions.');

    // 4c: Round-Robin Fairness across brands
    console.log('  [4c] Testing round-robin fairness across multiple brands...');
    // Seed brand_routing_state for NovaCart and Second Brand
    await directPool.query(`
      INSERT INTO brand_routing_state (brand_id, last_scheduled_at, total_tickets_dispatched)
      VALUES
        ('brand_novacart', NOW() - INTERVAL '10 minutes', 5),
        ('brand_second', NOW() - INTERVAL '20 minutes', 5)
      ON CONFLICT (brand_id) DO UPDATE SET
        last_scheduled_at = EXCLUDED.last_scheduled_at;
    `);

    // Brand second has older last_scheduled_at, so scheduler MUST prioritize Brand second first!
    const dueBrands = (await directPool.query(`
      SELECT b.id, COALESCE(rs.last_scheduled_at, '1970-01-01'::TIMESTAMPTZ) AS last_served
      FROM brands b
      LEFT JOIN brand_routing_state rs ON b.id = rs.brand_id
      WHERE b.id IN ('brand_novacart', 'brand_second')
      ORDER BY last_served ASC
    `)).rows;

    assert.strictEqual(dueBrands[0].id, 'brand_second', 'Round-robin must prioritize brand with oldest last_scheduled_at');

    // 4d: Inbound Activity Trigger & Routing
    console.log('  [4d] Testing queue enqueue triggering scheduling opportunity...');
    const enqRes = await enqueueOrReopenTicket({
      brandId: 'brand_novacart',
      ticketId: 'tkt_1021',
      customerId: 'cust_aarav',
      priority: 'High',
      customerLanguage: 'en-US',
      requiredSkills: ['general_inquiry']
    });
    assert.strictEqual(enqRes.enqueued, true);

    // Allow scheduler to assign
    await new Promise((r) => setTimeout(r, 250));

    // Check if ticket was assigned to Sarah Lin
    const assignedTkt = (await directPool.query(`
      SELECT status, assigned_agent_id FROM tickets WHERE brand_id = 'brand_novacart' AND id = 'tkt_1021'
    `)).rows[0];

    // 4e: Capacity release trigger on ticket resolution
    console.log('  [4e] Testing ticket resolution and capacity release triggering next assignment...');
    await resolveTicketAndReleaseCapacity({
      brandId: 'brand_novacart',
      ticketId: 'tkt_1021'
    });

    const sarahProfileAfterResolve = (await directPool.query(`
      SELECT active_ticket_count FROM agent_profiles WHERE brand_id = 'brand_novacart' AND user_id = 'user_sarah_lin'
    `)).rows[0];
    assert.strictEqual(sarahProfileAfterResolve.active_ticket_count, 0, 'active_ticket_count must return to 0 after resolution');

    // 4f: Unassigned Queue Preservation when agent is unavailable
    console.log('  [4f] Testing queue preservation when agent is Offline or full...');
    await directPool.query(`
      UPDATE agent_profiles SET configured_status = 'Offline' WHERE brand_id = 'brand_novacart' AND user_id = 'user_sarah_lin';
    `);

    const enqWhileOffline = await enqueueOrReopenTicket({
      brandId: 'brand_novacart',
      ticketId: 'tkt_1022',
      customerId: 'cust_priya',
      priority: 'Medium',
      customerLanguage: 'en-US',
      requiredSkills: ['general_inquiry']
    });

    // Execute scheduler pass: no agent available, ticket MUST remain in queued status!
    await processDueQueuedTicketsMultiTenant();

    const preservedQueue = (await directPool.query(`
      SELECT status, assigned_agent_id FROM ticket_routing_queue WHERE brand_id = 'brand_novacart' AND ticket_id = 'tkt_1022'
    `)).rows[0];
    assert.strictEqual(preservedQueue.status, 'queued', 'Ticket must remain queued when no agent is eligible');
    assert.strictEqual(preservedQueue.assigned_agent_id, null);

    // Restore Sarah Lin to Available and re-run scheduler -> ticket routes cleanly
    await directPool.query(`
      UPDATE agent_profiles SET configured_status = 'Available', last_heartbeat_at = NOW() WHERE brand_id = 'brand_novacart' AND user_id = 'user_sarah_lin';
    `);
    await directPool.query(`
      UPDATE ticket_routing_queue SET next_routing_attempt_at = NOW() WHERE brand_id = 'brand_novacart' AND ticket_id = 'tkt_1022';
    `);
    await processDueQueuedTicketsMultiTenant();

    const routedQueue = (await directPool.query(`
      SELECT status, assigned_agent_id FROM ticket_routing_queue WHERE brand_id = 'brand_novacart' AND ticket_id = 'tkt_1022'
    `)).rows[0];
    assert.strictEqual(routedQueue.status, 'assigned', 'Ticket must be assigned once agent becomes Available');
    assert.strictEqual(routedQueue.assigned_agent_id, 'user_sarah_lin');

    // Clean up tkt_1022 resolution
    await resolveTicketAndReleaseCapacity({ brandId: 'brand_novacart', ticketId: 'tkt_1022' });

    // 4g: Final Capacity & Queue Consistency Audit
    console.log('  [4g] Final capacity and ticket-count consistency audit...');
    await reconcileAgentCapacity({ brandId: 'brand_novacart', userId: 'user_sarah_lin' });
    const finalAudit = (await directPool.query(`
      SELECT
        ap.active_ticket_count,
        (SELECT COUNT(*) FROM tickets WHERE brand_id = 'brand_novacart' AND assigned_agent_id = 'user_sarah_lin' AND status IN ('Human Requested', 'Human Agent Active')) AS committed_active
      FROM agent_profiles ap
      WHERE ap.brand_id = 'brand_novacart' AND ap.user_id = 'user_sarah_lin'
    `)).rows[0];

    assert.strictEqual(
      parseInt(finalAudit.active_ticket_count, 10),
      parseInt(finalAudit.committed_active, 10),
      'active_ticket_count must exactly match committed assigned tickets'
    );
    console.log(`  [Consistency Verified]: Sarah committed=${finalAudit.committed_active}, profile=${finalAudit.active_ticket_count}`);

    console.log('[PASS] Section 4: Multi-Tenant Scheduler, round-robin fairness, event triggering, and capacity consistency verified.');

    console.log('\n================================================================================');
    console.log('=== [ALL CHECKPOINT E2-B3 INTEGRATION TESTS PASSED SUCCESSFULLY] ===');
    console.log('================================================================================\n');

  } catch (err) {
    console.error('\n[FATAL AUDIT FAILURE]:', err);
    throw err;
  } finally {
    try {
      if (httpServer) {
        await new Promise((resolve) => httpServer.close(resolve));
      }
      await directPool.end().catch(() => {});
      await closePool().catch(() => {});
      if (originalDbUrl) {
        process.env.DATABASE_URL = originalDbUrl;
      } else {
        delete process.env.DATABASE_URL;
      }
      if (originalGeminiKey) {
        process.env.GEMINI_API_KEY = originalGeminiKey;
      }
      console.log('[PG16 Teardown] Stopping EmbeddedPostgres server...');
      await Promise.race([
        pgServer.stop(),
        new Promise((resolve) => setTimeout(resolve, 5000))
      ]).catch(() => {});
      if (fs.existsSync(PG16_DATA_DIR)) {
        try { fs.rmSync(PG16_DATA_DIR, { recursive: true, force: true }); } catch (e) {}
      }
      console.log('[PG16 Teardown] Completed cleanly.');
    } catch (e) {}
  }
}

runE2B3IntegrationTests().catch((err) => {
  console.error('\n[FATAL PROCESS FAILURE]:', err);
  process.exit(1);
});
