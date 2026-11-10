import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer-core';
import axios from 'axios';
import assert from 'assert';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PROD_PORT = 5005;
const PROD_SERVER_URL = `http://127.0.0.1:${PROD_PORT}`;

const ARTIFACT_DIR = 'C:/Users/Rakshit Jain/.gemini/antigravity/brain/4f19604b-ba21-48f5-8507-572a2a9548c7';
const ARTIFACT_SCREENSHOTS = path.join(ARTIFACT_DIR, 'screenshots');
const LOCAL_SCREENSHOTS = path.join(ROOT_DIR, 'screenshots');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForServer(url, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await axios.get(url, { timeout: 1500, validateStatus: () => true });
      if (res.status === 200 || res.status === 304 || res.status === 503) return true;
    } catch (e) {}
    await sleep(400);
  }
  throw new Error(`Server at ${url} failed to respond within ${timeoutMs}ms`);
}

async function runProductionCartAcceptance() {
  console.log('================================================================');
  console.log(' EXPRESS PRODUCTION-SERVED STOREFRONT CART ACCEPTANCE TEST');
  console.log(' Serving client/dist via Express (NODE_ENV=production)');
  console.log('================================================================\n');

  // Verify client/dist exists
  const distHtml = path.join(ROOT_DIR, 'client/dist/index.html');
  assert.ok(fs.existsSync(distHtml), 'client/dist/index.html must exist before testing production serve');

  console.log('[Step 1] Spawning Express server with NODE_ENV=production on port', PROD_PORT);
  const serverProc = spawn('node', ['server/src/server.js'], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(PROD_PORT),
      SESSION_SECRET: 'test-prod-cart-secret-1234567890',
      ALLOWED_ORIGINS: PROD_SERVER_URL,
      CLIENT_URL: PROD_SERVER_URL
    },
    stdio: 'pipe'
  });

  serverProc.stdout.on('data', d => {
    process.stdout.write(`[Express Prod]: ${d}`);
  });
  serverProc.stderr.on('data', d => {
    process.stderr.write(`[Express Prod ERR]: ${d}`);
  });

  try {
    await waitForServer(`${PROD_SERVER_URL}/api/health`);
    console.log(`-> Express production server READY at ${PROD_SERVER_URL}`);

    console.log('\n[Step 2] Launching Headless Chrome...');
    const browser = await puppeteer.launch({
      executablePath: CHROME_PATH,
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-web-security'
      ]
    });

    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1440, height: 900 });

      // Strict dialog listener: FAIL IF ANY ALERT IS TRIGGERED
      let dialogTriggered = null;
      page.on('dialog', async (dialog) => {
        dialogTriggered = {
          type: dialog.type(),
          message: dialog.message()
        };
        console.error('❌ FATAL: BROWSER DIALOG TRIGGERED:', dialog.type(), dialog.message());
        await dialog.dismiss();
      });

      // 1. Navigate to /store
      console.log('\n1. Navigating to production-served /store route...');
      await page.goto(`${PROD_SERVER_URL}/store`, { waitUntil: 'networkidle0', timeout: 30000 });

      // Reset cart to pristine demo default so tests run deterministically
      await page.evaluate(() => {
        localStorage.removeItem('novacart_storefront_cart');
      });
      await page.reload({ waitUntil: 'networkidle0' });
      await sleep(500);

      // 2. Click the actual top-navigation cart icon
      console.log('2. Clicking top-navigation cart icon (#btn-cart-toggle)...');
      const cartBtn = await page.waitForSelector('#btn-cart-toggle', { timeout: 10000 });
      assert.ok(cartBtn, 'Cart button #btn-cart-toggle must exist in DOM');
      await cartBtn.click();
      await sleep(600);

      // 3. Assert no JavaScript alert/dialog appears
      console.log('3. Asserting no JavaScript alert/dialog appeared...');
      assert.strictEqual(dialogTriggered, null, `FAIL: Dialog appeared: ${JSON.stringify(dialogTriggered)}`);
      console.log('[PASS] No JavaScript alert/dialog appeared');

      // 4. Assert cart drawer becomes visible
      console.log('4. Asserting cart drawer became visible...');
      const drawer = await page.waitForSelector('#cart-drawer', { visible: true, timeout: 5000 });
      assert.ok(drawer, 'Cart drawer #cart-drawer must be visible');
      console.log('[PASS] Cart drawer is visible');

      // 5. Assert heading "Your Shopping Bag" is visible
      console.log('5. Asserting heading "Your Shopping Bag" is visible...');
      const headingEl = await page.waitForSelector('#cart-heading', { visible: true, timeout: 5000 });
      const headingText = await page.evaluate(el => el.textContent.trim(), headingEl);
      assert.strictEqual(headingText, 'Your Shopping Bag', 'Drawer heading must say "Your Shopping Bag"');
      console.log(`[PASS] Heading verified: "${headingText}"`);

      // 6. Assert existing cart items are rendered
      console.log('6. Asserting existing cart items are rendered...');
      const items = await page.$$('[id^="cart-item-"]');
      console.log(`Rendered cart items count: ${items.length}`);
      assert.ok(items.length >= 2, 'Default cart must contain at least 2 demo items');
      console.log('[PASS] Existing cart items rendered');

      // 7. Test quantity increment, decrement, and removal
      console.log('7. Testing quantity increment, decrement, and removal...');
      const plusBtns = await page.$$('[id^="btn-qty-plus-"]');
      assert.ok(plusBtns.length > 0, 'Must have at least one quantity plus button');
      
      const badgeBefore = await page.$eval('#cart-badge-count', el => parseInt(el.textContent.trim(), 10));
      await plusBtns[0].click();
      await sleep(300);
      const badgeAfterPlus = await page.$eval('#cart-badge-count', el => parseInt(el.textContent.trim(), 10));
      assert.strictEqual(badgeAfterPlus, badgeBefore + 1, 'Plus button must increment total quantity by 1');
      console.log(`[PASS] Plus button incremented badge from ${badgeBefore} to ${badgeAfterPlus}`);

      const minusBtns = await page.$$('[id^="btn-qty-minus-"]');
      await minusBtns[0].click();
      await sleep(300);
      const badgeAfterMinus = await page.$eval('#cart-badge-count', el => parseInt(el.textContent.trim(), 10));
      assert.strictEqual(badgeAfterMinus, badgeBefore, 'Minus button must decrement total quantity by 1');
      console.log(`[PASS] Minus button decremented badge back to ${badgeAfterMinus}`);

      const removeBtns = await page.$$('[id^="btn-remove-"]');
      assert.ok(removeBtns.length > 0, 'Must have at least one remove item button');
      await removeBtns[0].click();
      await sleep(300);
      const itemsAfterRemove = await page.$$('[id^="cart-item-"]');
      assert.strictEqual(itemsAfterRemove.length, items.length - 1, 'Line item must be removed from drawer');
      console.log(`[PASS] Item removal removed 1 item, remaining: ${itemsAfterRemove.length}`);

      // 8. Test closing the drawer using close button, backdrop, and Escape key
      console.log('8. Testing closing drawer via close button, backdrop, and Escape key...');
      // 8a. Close via close button
      const closeBtn = await page.waitForSelector('#btn-close-cart', { visible: true });
      await closeBtn.click();
      await sleep(400);
      let drawerEl = await page.$('#cart-drawer');
      assert.strictEqual(drawerEl, null, 'Drawer must be closed after clicking close button');
      console.log('[PASS] Drawer closed via close button');

      // 8b. Re-open and close via Escape key
      await (await page.waitForSelector('#btn-cart-toggle')).click();
      await sleep(400);
      assert.ok(await page.$('#cart-drawer'), 'Drawer must be open before pressing Escape');
      await page.keyboard.press('Escape');
      await sleep(400);
      drawerEl = await page.$('#cart-drawer');
      assert.strictEqual(drawerEl, null, 'Drawer must be closed after pressing Escape');
      console.log('[PASS] Drawer closed via Escape key');

      // 8c. Re-open and close via backdrop click
      await (await page.waitForSelector('#btn-cart-toggle')).click();
      await sleep(400);
      assert.ok(await page.$('#cart-drawer'), 'Drawer must be open before clicking backdrop');
      await page.click('#cart-backdrop');
      await sleep(400);
      drawerEl = await page.$('#cart-drawer');
      assert.strictEqual(drawerEl, null, 'Drawer must be closed after clicking backdrop');
      console.log('[PASS] Drawer closed via backdrop click');

      // 9. Refresh the browser and verify cart persistence
      console.log('9. Refreshing browser and verifying cart persistence...');
      await page.reload({ waitUntil: 'networkidle0' });
      await sleep(500);
      const badgeAfterReload = await page.$eval('#cart-badge-count', el => parseInt(el.textContent.trim(), 10));
      assert.strictEqual(badgeAfterReload, itemsAfterRemove.length, 'Badge must persist across reload');
      console.log(`[PASS] Cart persistence verified: badge is ${badgeAfterReload} after reload`);

      // 10. Repeat test at 375x812 mobile viewport
      console.log('10. Repeating test at 375x812 mobile viewport...');
      await page.setViewport({ width: 375, height: 812, isMobile: true });
      await (await page.waitForSelector('#btn-cart-toggle')).click();
      await sleep(500);
      assert.strictEqual(dialogTriggered, null, 'No dialog allowed on mobile cart toggle');
      
      const mobileHeading = await page.waitForSelector('#cart-heading', { visible: true });
      assert.ok(mobileHeading, 'Cart heading must be visible on mobile full-screen panel');
      
      const mobileShotArt = path.join(ARTIFACT_SCREENSHOTS, 'prod_served_cart_mobile_375x812.png');
      const mobileShotLoc = path.join(LOCAL_SCREENSHOTS, 'prod_served_cart_mobile_375x812.png');
      await page.screenshot({ path: mobileShotArt });
      fs.copyFileSync(mobileShotArt, mobileShotLoc);
      console.log('[PASS] Mobile full-screen layout verified and screenshot captured');

      console.log('\n================================================================');
      console.log(' ALL 10 PRODUCTION-SERVED CART VERIFICATION CHECKS PASSED (100%)');
      console.log('================================================================');
    } finally {
      await browser.close();
    }
  } finally {
    serverProc.kill('SIGTERM');
  }
}

runProductionCartAcceptance().catch(err => {
  console.error('\n❌ PRODUCTION ACCEPTANCE FAILED:', err.message);
  process.exit(1);
});
