import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer-core';
import assert from 'assert';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const LIVE_URL = 'https://resolve-ai-novacart.onrender.com/store';

const ARTIFACT_DIR = 'C:/Users/Rakshit Jain/.gemini/antigravity/brain/4f19604b-ba21-48f5-8507-572a2a9548c7';
const ARTIFACT_SCREENSHOTS = path.join(ARTIFACT_DIR, 'screenshots');
const LOCAL_SCREENSHOTS = path.join(ROOT_DIR, 'screenshots');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runLiveScenarioTests() {
  console.log('================================================================');
  console.log(' LIVE RENDER — COMPLETE CART SCENARIOS (A THROUGH F)');
  console.log(' Target URL:', LIVE_URL);
  console.log('================================================================\n');

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

    page.on('dialog', async (dialog) => {
      console.error('❌ FATAL: BROWSER DIALOG TRIGGERED ON LIVE:', dialog.type(), dialog.message());
      await dialog.dismiss();
      throw new Error(`Unexpected live dialog: ${dialog.message()}`);
    });

    async function capture(name) {
      const artPath = path.join(ARTIFACT_SCREENSHOTS, name);
      const locPath = path.join(LOCAL_SCREENSHOTS, name);
      await page.screenshot({ path: artPath });
      fs.copyFileSync(artPath, locPath);
      console.log(`  ✓ Screenshot captured: ${name}`);
    }

    console.log('Navigating to', LIVE_URL);
    await page.goto(LIVE_URL, { waitUntil: 'networkidle0', timeout: 60000 });

    // Print the currently loaded bundle asset
    const scriptSrc = await page.evaluate(() => {
      const scripts = Array.from(document.querySelectorAll('script[src]'));
      return scripts.map(s => s.getAttribute('src')).find(s => s.includes('assets/index-')) || 'unknown';
    });
    console.log(`Live Bundle Asset: ${scriptSrc}\n`);

    // -------------------------------------------------------------------------
    // SCENARIO A: Add First Product (NovaSprint Pro Running Shoes - $119.99)
    // -------------------------------------------------------------------------
    console.log('--- SCENARIO A: Add First Product ---');
    await page.evaluate(() => {
      window.localStorage.removeItem('novacart_storefront_cart');
    });
    await page.reload({ waitUntil: 'networkidle0' });
    await sleep(400);

    const initialBadge = await page.$eval('#cart-badge-count', el => el.textContent.trim());
    console.log(`  Initial cart badge: ${initialBadge}`);
    assert.strictEqual(initialBadge, '0', 'Initial cart badge after clear must be 0');

    console.log('  Adding NovaSprint Pro Running Shoes ($119.99)...');
    const addShoesBtn = await page.waitForSelector('#btn-add-to-cart-prod_shoes', { timeout: 15000 });
    await addShoesBtn.click();
    await sleep(600);

    const drawerA = await page.waitForSelector('#cart-drawer', { visible: true, timeout: 5000 });
    assert.ok(drawerA, 'Cart drawer must open automatically upon Add to Cart');
    console.log('  ✓ Drawer opened automatically upon Add to Cart');

    const badgeA = await page.$eval('#cart-badge-count', el => el.textContent.trim());
    console.log(`  Cart badge after adding shoes: ${badgeA}`);
    assert.strictEqual(badgeA, '1', 'Badge must equal 1 after adding first item');

    const subtotalA = await page.$eval('#cart-subtotal', el => el.textContent.trim());
    console.log(`  Cart subtotal: ${subtotalA}`);
    assert.ok(subtotalA.includes('119.99'), `Subtotal must equal $119.99. Found: ${subtotalA}`);

    const shoesItemA = await page.waitForSelector('#cart-item-prod_shoes', { visible: true });
    assert.ok(shoesItemA, 'Shoes product card must be visible in drawer');
    await capture('live_render_scenario_a_shoes.png');
    console.log('[PASS] Scenario A: First product added, badge=1, subtotal=$119.99, drawer open\n');

    // -------------------------------------------------------------------------
    // SCENARIO B: Add Second Product (NovaPulse Smartwatch - $249.50)
    // -------------------------------------------------------------------------
    console.log('--- SCENARIO B: Add Second Product ---');
    await page.click('#btn-close-cart');
    await sleep(400);

    console.log('  Adding NovaPulse Smartwatch ($249.50)...');
    const addWatchBtn = await page.waitForSelector('#btn-add-to-cart-prod_watch');
    await addWatchBtn.click();
    await sleep(600);

    await page.waitForSelector('#cart-drawer', { visible: true });

    const badgeB = await page.$eval('#cart-badge-count', el => el.textContent.trim());
    console.log(`  Cart badge after adding watch: ${badgeB}`);
    assert.strictEqual(badgeB, '2', 'Badge must equal 2 after adding second item');

    const subtotalB = await page.$eval('#cart-subtotal', el => el.textContent.trim());
    console.log(`  Cart subtotal: ${subtotalB}`);
    assert.ok(subtotalB.includes('369.49'), `Subtotal must equal $369.49. Found: ${subtotalB}`);

    assert.ok(await page.$('#cart-item-prod_shoes'), 'Shoes card must be visible');
    assert.ok(await page.$('#cart-item-prod_watch'), 'Watch card must be visible');
    await capture('live_render_scenario_b_watch.png');
    console.log('[PASS] Scenario B: Second product added, badge=2, subtotal=$369.49, both cards visible\n');

    // -------------------------------------------------------------------------
    // SCENARIO C: Increase Quantity (Shoes qty -> 2)
    // -------------------------------------------------------------------------
    console.log('--- SCENARIO C: Increase Quantity ---');
    console.log('  Clicking plus button on Shoes...');
    const plusShoes = await page.waitForSelector('#btn-qty-plus-prod_shoes');
    await plusShoes.click();
    await sleep(500);

    const badgeC = await page.$eval('#cart-badge-count', el => el.textContent.trim());
    console.log(`  Cart badge after incrementing shoes: ${badgeC}`);
    assert.strictEqual(badgeC, '3', 'Badge must equal 3 after incrementing shoes qty to 2');

    const subtotalC = await page.$eval('#cart-subtotal', el => el.textContent.trim());
    console.log(`  Cart subtotal: ${subtotalC}`);
    assert.ok(subtotalC.includes('489.48'), `Subtotal must equal $489.48. Found: ${subtotalC}`);

    const shoesQtyC = await page.$eval('#cart-item-qty-prod_shoes', el => el.textContent.trim());
    assert.strictEqual(shoesQtyC, '2', 'Shoes quantity must equal 2');
    await capture('live_render_scenario_c_qty.png');
    console.log('[PASS] Scenario C: Shoes qty=2, badge=3, subtotal=$489.48\n');

    // -------------------------------------------------------------------------
    // SCENARIO D: Remove Smartwatch
    // -------------------------------------------------------------------------
    console.log('--- SCENARIO D: Remove Smartwatch ---');
    console.log('  Clicking remove button on Watch...');
    const removeWatchBtn = await page.waitForSelector('#btn-remove-prod_watch');
    await removeWatchBtn.click();
    await sleep(500);

    const badgeD = await page.$eval('#cart-badge-count', el => el.textContent.trim());
    console.log(`  Cart badge after removing watch: ${badgeD}`);
    assert.strictEqual(badgeD, '2', 'Badge must equal 2 after removing watch');

    const subtotalD = await page.$eval('#cart-subtotal', el => el.textContent.trim());
    console.log(`  Cart subtotal: ${subtotalD}`);
    assert.ok(subtotalD.includes('239.98'), `Subtotal must equal $239.98. Found: ${subtotalD}`);

    const watchCardD = await page.$('#cart-item-prod_watch');
    assert.strictEqual(watchCardD, null, 'Watch card must no longer exist in DOM');
    await capture('live_render_scenario_d_remove.png');
    console.log('[PASS] Scenario D: Watch removed, badge=2, subtotal=$239.98\n');

    // -------------------------------------------------------------------------
    // SCENARIO E: Persistence across Refresh
    // -------------------------------------------------------------------------
    console.log('--- SCENARIO E: Persistence across Refresh ---');
    console.log('  Reloading browser page...');
    await page.reload({ waitUntil: 'networkidle0' });
    await sleep(500);

    const badgeE = await page.$eval('#cart-badge-count', el => el.textContent.trim());
    console.log(`  Badge after reload: ${badgeE}`);
    assert.strictEqual(badgeE, '2', 'Badge must remain 2 after page reload');

    console.log('  Opening drawer via #btn-cart-toggle...');
    await (await page.waitForSelector('#btn-cart-toggle')).click();
    await sleep(500);

    const subtotalE = await page.$eval('#cart-subtotal', el => el.textContent.trim());
    console.log(`  Subtotal after reload: ${subtotalE}`);
    assert.ok(subtotalE.includes('239.98'), `Subtotal must remain $239.98 after reload. Found: ${subtotalE}`);

    const shoesQtyE = await page.$eval('#cart-item-qty-prod_shoes', el => el.textContent.trim());
    assert.strictEqual(shoesQtyE, '2', 'Shoes quantity must remain 2 after reload');
    await capture('live_render_scenario_e_persistence.png');
    console.log('[PASS] Scenario E: Persistence verified, badge=2, subtotal=$239.98\n');

    // Close drawer cleanly before transitioning to mobile
    const closeBtnE = await page.waitForSelector('#btn-close-cart');
    await closeBtnE.click();
    await sleep(400);

    // -------------------------------------------------------------------------
    // SCENARIO F: Responsive Layout (375x812 mobile)
    // -------------------------------------------------------------------------
    console.log('--- SCENARIO F: Responsive Layout (375x812 mobile) ---');
    await page.setViewport({ width: 375, height: 812, isMobile: true });
    await sleep(400);

    assert.strictEqual(await page.$('#cart-drawer'), null, 'Drawer must be closed before mobile test');

    console.log('  Clicking #btn-cart-toggle on mobile...');
    const mobileCartToggle = await page.waitForSelector('#btn-cart-toggle', { visible: true });
    await mobileCartToggle.click();
    await sleep(500);

    const drawerF = await page.waitForSelector('#cart-drawer', { visible: true });
    assert.ok(drawerF, 'Drawer must open on mobile');
    console.log('  ✓ Mobile full-screen drawer opened');

    const headingF = await page.$eval('#cart-heading', el => el.textContent.trim());
    assert.strictEqual(headingF, 'Your Shopping Bag', 'Drawer heading must say "Your Shopping Bag"');

    const subtotalF = await page.$eval('#cart-subtotal', el => el.textContent.trim());
    console.log(`  Mobile cart subtotal: ${subtotalF}`);
    assert.ok(subtotalF.includes('239.98'), `Mobile subtotal must equal $239.98. Found: ${subtotalF}`);

    assert.ok(await page.$('#cart-item-prod_shoes'), 'Shoes card must be visible on mobile');
    await capture('live_render_scenario_f_mobile.png');

    const closeBtnF = await page.waitForSelector('#btn-close-cart', { visible: true });
    await closeBtnF.click();
    await sleep(400);
    assert.strictEqual(await page.$('#cart-drawer'), null, 'Drawer must close on mobile');
    console.log('[PASS] Scenario F: Mobile full-screen layout verified at 375x812\n');

    console.log('================================================================');
    console.log(' ALL 6 SCENARIOS (A THROUGH F) PASSED 100% ON LIVE RENDER!');
    console.log('================================================================');
  } finally {
    await browser.close();
  }
}

runLiveScenarioTests().catch(err => {
  console.error('\n❌ LIVE SCENARIO AUDIT FAILED:', err.message);
  process.exit(1);
});
