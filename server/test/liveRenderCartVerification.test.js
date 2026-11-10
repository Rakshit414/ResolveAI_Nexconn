import puppeteer from 'puppeteer-core';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import assert from 'assert';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const LIVE_URL = 'https://resolve-ai-novacart.onrender.com/store';

const ARTIFACT_DIR = 'C:/Users/Rakshit Jain/.gemini/antigravity/brain/4f19604b-ba21-48f5-8507-572a2a9548c7';
const ARTIFACT_SCREENSHOTS = path.join(ARTIFACT_DIR, 'screenshots');
const LOCAL_SCREENSHOTS = path.join(ROOT_DIR, 'screenshots');

async function testLiveCart() {
  console.log('================================================================');
  console.log(' LIVE RENDER STOREFRONT — CART INTERACTION AUDIT');
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

    let dialogFired = null;
    page.on('dialog', async (dialog) => {
      dialogFired = {
        type: dialog.type(),
        message: dialog.message()
      };
      console.error('❌ UNEXPECTED DIALOG FIRED:', dialog.type(), dialog.message());
      await dialog.dismiss();
    });

    console.log('Navigating to', LIVE_URL);
    await page.goto(LIVE_URL, { waitUntil: 'networkidle0', timeout: 60000 });

    console.log('Checking for #btn-cart-toggle...');
    const cartBtn = await page.waitForSelector('#btn-cart-toggle', { timeout: 15000 });
    assert.ok(cartBtn, 'Cart toggle button #btn-cart-toggle must exist in DOM');

    console.log('Clicking #btn-cart-toggle on LIVE Render...');
    await cartBtn.click();
    await new Promise(r => setTimeout(r, 1000));

    // Assert that NO dialog was triggered
    assert.strictEqual(dialogFired, null, `Browser alert/dialog MUST NOT appear! Received: ${JSON.stringify(dialogFired)}`);
    console.log('✓ PASS: No browser alert or dialog appeared on cart icon click');

    // Assert that drawer heading is visible
    const headingEl = await page.waitForSelector('#cart-heading', { visible: true, timeout: 5000 });
    const headingText = await page.evaluate(el => el.textContent.trim(), headingEl);
    console.log('Drawer Heading:', headingText);
    assert.strictEqual(headingText, 'Your Shopping Bag', 'Drawer heading must say "Your Shopping Bag"');
    console.log('✓ PASS: Cart drawer is visible with heading "Your Shopping Bag"');

    // Capture desktop screenshot
    const shot1Art = path.join(ARTIFACT_SCREENSHOTS, 'live_render_cart_01_desktop_drawer.png');
    const shot1Loc = path.join(LOCAL_SCREENSHOTS, 'live_render_cart_01_desktop_drawer.png');
    await page.screenshot({ path: shot1Art });
    fs.copyFileSync(shot1Art, shot1Loc);
    console.log('✓ Captured desktop screenshot:', shot1Art);

    // Test Mobile viewport
    console.log('\nTesting mobile viewport (375x812) on LIVE Render...');
    await page.setViewport({ width: 375, height: 812, isMobile: true });
    await new Promise(r => setTimeout(r, 1000));

    const shot2Art = path.join(ARTIFACT_SCREENSHOTS, 'live_render_cart_02_mobile_drawer.png');
    const shot2Loc = path.join(LOCAL_SCREENSHOTS, 'live_render_cart_02_mobile_drawer.png');
    await page.screenshot({ path: shot2Art });
    fs.copyFileSync(shot2Art, shot2Loc);
    console.log('✓ Captured mobile screenshot:', shot2Art);

    console.log('\n================================================================');
    console.log(' LIVE RENDER AUDIT: CART DRAWER IS WORKING 100% (NO ALERTS)');
    console.log('================================================================');
  } finally {
    await browser.close();
  }
}

testLiveCart().catch(err => {
  console.error('\n❌ LIVE AUDIT FAILED:', err.message);
  process.exit(1);
});
