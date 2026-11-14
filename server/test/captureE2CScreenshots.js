// server/test/captureE2CScreenshots.js
import path from 'path';
import fs from 'fs';
import http from 'http';
import pg from 'pg';
import EmbeddedPostgres from 'embedded-postgres';
import puppeteer from 'puppeteer-core';
import app from '../src/server.js';
import { runMigration } from '../src/db/migrate.js';
import { closePool } from '../src/db/pool.js';

const { Pool } = pg;
const PG_PORT = 54360;
const PG_DATA_DIR = path.resolve('server/data/pg16_e2c_screenshot_instance');
const SCREENSHOT_DIR = path.resolve('C:/Users/Rakshit Jain/.gemini/antigravity/brain/4f19604b-ba21-48f5-8507-572a2a9548c7/screenshots');
const CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const APP_PORT = 5005;

async function runScreenshotCapture() {
  console.log('=== [PUPPETEER SCREENSHOT CAPTURE FOR CHECKPOINT E2-C] ===\n');

  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }

  if (fs.existsSync(PG_DATA_DIR)) {
    try { fs.rmSync(PG_DATA_DIR, { recursive: true, force: true }); } catch (e) {}
  }

  const pgServer = new EmbeddedPostgres({
    databaseDir: PG_DATA_DIR,
    port: PG_PORT,
    user: 'postgres',
    password: 'postgres',
    initdbFlags: ['--encoding=UTF8', '--locale=C']
  });

  const originalDbUrl = process.env.DATABASE_URL;
  const originalNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = `postgres://postgres:postgres@127.0.0.1:${PG_PORT}/postgres`;

  let directPool = null;
  let httpServer = null;
  let browser = null;

  try {
    console.log('[1/5] Starting Embedded PostgreSQL 16 on port ' + PG_PORT + '...');
    await pgServer.initialise();
    await pgServer.start();

    directPool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
    await directPool.query('SELECT 1');

    console.log('[2/5] Running migrations 001 through 005...');
    await runMigration({ dryRun: false });

    // Seed additional rich demo data for screenshots
    console.log('[3/5] Seeding rich UI data for agent roster, unassigned queue & knowledge hub...');
    // Ensure Carlos Gomez is provisioned in agent_profiles
    await directPool.query(`
      INSERT INTO users (id, name, email, password_hash)
      VALUES ('user_carlos', 'Carlos Gomez', 'carlos@novacart.com', 'carlos_hash')
      ON CONFLICT DO NOTHING;
      INSERT INTO brand_memberships (id, brand_id, user_id, role)
      VALUES ('mem_carlos_novacart', 'brand_novacart', 'user_carlos', 'agent')
      ON CONFLICT (brand_id, user_id) DO NOTHING;
      INSERT INTO agent_profiles (
        brand_id, user_id, nexconn_user_id, display_name, configured_status,
        primary_language, supported_languages, skills, max_concurrent_tickets, active_ticket_count, last_heartbeat_at
      ) VALUES (
        'brand_novacart', 'user_carlos', 'agent_carlos', 'Carlos Gomez', 'Available',
        'en-US', '{"en-US","es-ES"}', '{"returns","logistics"}', 3, 1, NOW()
      ) ON CONFLICT (brand_id, user_id) DO UPDATE SET configured_status = 'Available', last_heartbeat_at = NOW(), active_ticket_count = 1;

      UPDATE agent_profiles
      SET configured_status = 'Available', max_concurrent_tickets = 5, active_ticket_count = 2, last_heartbeat_at = NOW()
      WHERE brand_id = 'brand_novacart' AND user_id = 'user_sarah_lin';

      -- Seed tickets in queue for Unassigned Queue view with PII masking
      INSERT INTO ticket_routing_queue (
        id, brand_id, ticket_id, customer_id, priority, customer_language, required_skills, status
      ) VALUES
        ('q_shot_1', 'brand_novacart', 'tkt_1022', 'cust_priya', 'High', 'mr-IN', '{"returns"}', 'queued'),
        ('q_shot_2', 'brand_novacart', 'tkt_1023', 'cust_kabir', 'Critical', 'hi-IN', '{"damages"}', 'queued')
      ON CONFLICT DO NOTHING;

      -- Seed handoff summary on tkt_1022
      INSERT INTO ticket_handoff_summaries (
        id, brand_id, ticket_id, from_agent_id, to_agent_id, ai_summary_json, internal_notes
      ) VALUES (
        'hnd_shot_1', 'brand_novacart', 'tkt_1022', 'user_sarah_lin', 'user_carlos',
        '{"reason":"Specialized return investigation required","priority":"High","customerSentiment":"Frustrated"}'::jsonb,
        'Customer requested expedited return shipping due to wrong wrist band sizing.'
      ) ON CONFLICT DO NOTHING;

      -- Seed draft knowledge item
      INSERT INTO brand_knowledge_hub (
        id, brand_id, category, title, slug, content_markdown, is_published, published_version, tags
      ) VALUES (
        'kh_shot_draft_1', 'brand_novacart', 'policy', 'Extended Holiday Return Policy (2026)', 'holiday-return-2026',
        'Items purchased between Nov 1 and Dec 31 can be returned until Jan 31 for full refund.', false, 1, '{"holiday","returns"}'
      ) ON CONFLICT DO NOTHING;
    `);

    // Start Express server
    console.log('[4/5] Starting Express server on port ' + APP_PORT + '...');
    httpServer = http.createServer(app);
    await new Promise((resolve) => httpServer.listen(APP_PORT, '127.0.0.1', resolve));
    console.log(`[HTTP Server] Listening at http://127.0.0.1:${APP_PORT}`);

    // Launch Chrome with Puppeteer
    console.log('[5/5] Launching Chrome via Puppeteer-core from ' + CHROME_PATH + '...');
    browser = await puppeteer.launch({
      executablePath: CHROME_PATH,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--window-size=1536,864']
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1536, height: 864, deviceScaleFactor: 1 });

    // -------------------------------------------------------------------------
    // SCREENSHOT 1: storefront_cart_drawer.png
    // Stated items: 2x Shoes ($119.99), 1x Watch ($249.50), 1x Headphones ($89.00)
    // Subtotal: $578.48, Tax (8%): $46.28, Free Shipping: $0.00, Grand Total: $624.76
    // -------------------------------------------------------------------------
    console.log('\n--- Capturing Screenshot 1: storefront_cart_drawer.png ---');
    await page.goto(`http://127.0.0.1:${APP_PORT}/store`, { waitUntil: 'networkidle0' });

    // Inject canonical stated cart items into localStorage
    await page.evaluate(() => {
      const canonicalCart = [
        {
          productId: 'prod_shoes',
          name: 'NovaSprint Pro Running Shoes',
          image: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=600&q=80',
          variant: 'Size 10 (US)',
          unitPriceCents: 11999,
          quantity: 2
        },
        {
          productId: 'prod_watch',
          name: 'NovaPulse Smartwatch - Obsidian',
          image: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=600&q=80',
          variant: '44mm Titanium',
          unitPriceCents: 24950,
          quantity: 1
        },
        {
          productId: 'prod_headphones',
          name: 'NovaBass ANC Wireless Headphones',
          image: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=600&q=80',
          variant: 'Matte Obsidian',
          unitPriceCents: 8900,
          quantity: 1
        }
      ];
      localStorage.setItem('novacart_storefront_cart', JSON.stringify(canonicalCart));
    });

    // Reload page to hydrate cart from storage
    await page.reload({ waitUntil: 'networkidle0' });

    // Click cart button to open drawer
    const cartBtn = await page.waitForSelector('button[aria-label="Open shopping bag"]', { timeout: 5000 });
    await cartBtn.click();
    await new Promise(r => setTimeout(r, 600)); // wait for drawer animation

    const shot1Path = path.join(SCREENSHOT_DIR, 'storefront_cart_drawer.png');
    await page.screenshot({ path: shot1Path });
    console.log('  [Captured]: ' + shot1Path);

    // Close cart drawer
    const closeCartBtn = await page.$('button[aria-label="Close cart drawer"]') || await page.$('button:has(svg.lucide-x)');
    if (closeCartBtn) {
      await closeCartBtn.click().catch(() => {});
      await new Promise(r => setTimeout(r, 400));
    }

    // -------------------------------------------------------------------------
    // SCREENSHOT 2: customer_support_widget.png
    // Open Customer Support Widget on Storefront with Chat Continuity
    // -------------------------------------------------------------------------
    console.log('\n--- Capturing Screenshot 2: customer_support_widget.png ---');
    // Click floating support widget launcher
    const widgetLauncher = await page.waitForSelector('button[aria-label="Open NovaCart Support Chat"]', { timeout: 5000 });
    await widgetLauncher.click();
    await new Promise(r => setTimeout(r, 700)); // wait for widget slide-up animation

    const shot2Path = path.join(SCREENSHOT_DIR, 'customer_support_widget.png');
    await page.screenshot({ path: shot2Path });
    console.log('  [Captured]: ' + shot2Path);

    // -------------------------------------------------------------------------
    // SCREENSHOT 3: agent_shared_inbox.png
    // Agent Dashboard with Unassigned Queue (Masked PII) & Live Team Roster
    // -------------------------------------------------------------------------
    console.log('\n--- Capturing Screenshot 3: agent_shared_inbox.png ---');
    await page.goto(`http://127.0.0.1:${APP_PORT}/agent`, { waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 600));

    // Click the "Queue" (Unassigned) tab in ConversationInbox
    const queueTabBtn = await page.waitForSelector('button[title="Unassigned queue (Masked PII)"]', { timeout: 5000 });
    await queueTabBtn.click();
    await new Promise(r => setTimeout(r, 500));

    const shot3Path = path.join(SCREENSHOT_DIR, 'agent_shared_inbox.png');
    await page.screenshot({ path: shot3Path });
    console.log('  [Captured]: ' + shot3Path);

    // -------------------------------------------------------------------------
    // SCREENSHOT 4: agent_conversation_transfer.png
    // Agent Conversation showing Internal Notes & Transfer Handoff Summary
    // -------------------------------------------------------------------------
    console.log('\n--- Capturing Screenshot 4: agent_conversation_transfer.png ---');
    // Switch to "My Tickets" tab or select ticket
    const myTicketsTab = await page.waitForSelector('button:has-text("My Tickets")', { timeout: 5000 }).catch(() => null)
      || await page.evaluateHandle(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        return btns.find(b => b.textContent.includes('My Tickets')) || btns[0];
      });
    if (myTicketsTab) await myTicketsTab.click().catch(() => {});
    await new Promise(r => setTimeout(r, 400));

    // Click ticket tkt_1021 or tkt_1022 in the list
    await page.evaluate(() => {
      const ticketCards = document.querySelectorAll('[data-ticket-id], .group');
      if (ticketCards.length > 0) ticketCards[0].click();
    });
    await new Promise(r => setTimeout(r, 600));

    const shot4Path = path.join(SCREENSHOT_DIR, 'agent_conversation_transfer.png');
    await page.screenshot({ path: shot4Path });
    console.log('  [Captured]: ' + shot4Path);

    // -------------------------------------------------------------------------
    // SCREENSHOT 5: knowledge_hub_drawer.png
    // Knowledge Hub Drawer with Category Tabs, Search & Published/Draft Items
    // -------------------------------------------------------------------------
    console.log('\n--- Capturing Screenshot 5: knowledge_hub_drawer.png ---');
    const policyBtn = await page.waitForSelector('button[title="NovaCart Support Policies"]', { timeout: 5000 });
    await policyBtn.click();
    await new Promise(r => setTimeout(r, 700)); // wait for drawer slide-out

    const shot5Path = path.join(SCREENSHOT_DIR, 'knowledge_hub_drawer.png');
    await page.screenshot({ path: shot5Path });
    console.log('  [Captured]: ' + shot5Path);

    // Close Knowledge Hub drawer
    await page.evaluate(() => {
      const closeBtn = document.querySelector('button[aria-label="Close drawer"]') || document.querySelector('.lucide-x')?.parentElement;
      if (closeBtn) closeBtn.click();
    });
    await new Promise(r => setTimeout(r, 400));

    // -------------------------------------------------------------------------
    // SCREENSHOT 6: translation_interface.png
    // Customer Portal or Widget showing Collapsible Translation & Language Toggle
    // -------------------------------------------------------------------------
    console.log('\n--- Capturing Screenshot 6: translation_interface.png ---');
    await page.goto(`http://127.0.0.1:${APP_PORT}/customer`, { waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 600));

    const shot6Path = path.join(SCREENSHOT_DIR, 'translation_interface.png');
    await page.screenshot({ path: shot6Path });
    console.log('  [Captured]: ' + shot6Path);

    console.log('\n=== [ALL 6 REAL APPLICATION SCREENSHOTS CAPTURED SUCCESSFULLY] ===\n');

  } catch (err) {
    console.error('[SCREENSHOT CAPTURE ERROR]:', err);
    throw err;
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (httpServer) await new Promise(r => httpServer.close(r)).catch(() => {});
    if (directPool) await directPool.end().catch(() => {});
    await closePool().catch(() => {});
    if (originalDbUrl) process.env.DATABASE_URL = originalDbUrl;
    if (originalNodeEnv) process.env.NODE_ENV = originalNodeEnv;

    console.log('[PG Teardown] Stopping EmbeddedPostgres server...');
    await Promise.race([
      pgServer.stop(),
      new Promise(r => setTimeout(r, 5000))
    ]).catch(() => {});
    if (fs.existsSync(PG_DATA_DIR)) {
      try { fs.rmSync(PG_DATA_DIR, { recursive: true, force: true }); } catch (e) {}
    }
    console.log('[PG Teardown] Done.');
  }
}

runScreenshotCapture().catch(e => {
  console.error(e);
  process.exit(1);
});
