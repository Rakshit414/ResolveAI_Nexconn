import path from 'path';
import fs from 'fs';
import http from 'http';
import puppeteer from 'puppeteer-core';
import app from '../src/server.js';

const SCREENSHOT_DIR = path.resolve('C:/Users/Rakshit Jain/.gemini/antigravity/brain/4f19604b-ba21-48f5-8507-572a2a9548c7/screenshots');
const CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const APP_PORT = 5006;

async function captureLocalizationScreenshots() {
  console.log('=== [CAPTURING LOCALIZATION SCREENSHOTS: EN, HI, MR] ===\n');

  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }

  let httpServer = null;
  let browser = null;

  try {
    httpServer = http.createServer(app);
    await new Promise((resolve) => httpServer.listen(APP_PORT, '127.0.0.1', resolve));
    console.log(`[HTTP Server] Listening on http://127.0.0.1:${APP_PORT}`);

    browser = await puppeteer.launch({
      executablePath: CHROME_PATH,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--window-size=1536,864']
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1536, height: 864, deviceScaleFactor: 1 });

    // -------------------------------------------------------------------------
    // 1. English Storefront (storefront_en.png)
    // -------------------------------------------------------------------------
    console.log('\n--- Capturing Screenshot: storefront_en.png ---');
    await page.goto(`http://127.0.0.1:${APP_PORT}/store`, { waitUntil: 'networkidle0' });
    await page.evaluate(() => {
      localStorage.setItem('novacart_storefront_lang', 'en');
    });
    await page.reload({ waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 600));

    // Open language dropdown to show selector options
    const langBtn = await page.$('#btn-storefront-lang-toggle');
    if (langBtn) await langBtn.click();
    await new Promise(r => setTimeout(r, 400));

    const pathEn = path.join(SCREENSHOT_DIR, 'storefront_en.png');
    await page.screenshot({ path: pathEn });
    console.log(`✓ Saved ${pathEn} (${fs.statSync(pathEn).size} bytes)`);

    // -------------------------------------------------------------------------
    // 2. Hindi Storefront with Cart Drawer (storefront_hi.png)
    // -------------------------------------------------------------------------
    console.log('\n--- Capturing Screenshot: storefront_hi.png ---');
    await page.evaluate(() => {
      localStorage.setItem('novacart_storefront_lang', 'hi');
      const sampleCart = [
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
          variant: '42mm Obsidian',
          unitPriceCents: 24950,
          quantity: 1
        },
        {
          productId: 'prod_headphones',
          name: 'NovaBass ANC Wireless Headphones',
          image: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=600&q=80',
          variant: 'Matte Black',
          unitPriceCents: 8900,
          quantity: 1
        }
      ];
      localStorage.setItem('novacart_storefront_cart', JSON.stringify(sampleCart));
    });
    await page.reload({ waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 600));

    // Open cart drawer
    const cartBtn = await page.$('#btn-cart-toggle');
    if (cartBtn) await cartBtn.click();
    await new Promise(r => setTimeout(r, 600));

    const pathHi = path.join(SCREENSHOT_DIR, 'storefront_hi.png');
    await page.screenshot({ path: pathHi });
    console.log(`✓ Saved ${pathHi} (${fs.statSync(pathHi).size} bytes)`);

    // Close cart drawer
    const closeBtn = await page.$('#btn-close-cart');
    if (closeBtn) await closeBtn.click();
    await new Promise(r => setTimeout(r, 400));

    // -------------------------------------------------------------------------
    // 3. Marathi Storefront (storefront_mr.png)
    // -------------------------------------------------------------------------
    console.log('\n--- Capturing Screenshot: storefront_mr.png ---');
    await page.evaluate(() => {
      localStorage.setItem('novacart_storefront_lang', 'mr');
    });
    await page.reload({ waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 600));

    // Open language selector dropdown
    const mrLangBtn = await page.$('#btn-storefront-lang-toggle');
    if (mrLangBtn) await mrLangBtn.click();
    await new Promise(r => setTimeout(r, 400));

    const pathMr = path.join(SCREENSHOT_DIR, 'storefront_mr.png');
    await page.screenshot({ path: pathMr });
    console.log(`✓ Saved ${pathMr} (${fs.statSync(pathMr).size} bytes)`);

    console.log('\n=== [ALL 3 LOCALIZATION SCREENSHOTS CAPTURED CLEANLY] ===\n');

  } finally {
    if (browser) await browser.close();
    if (httpServer) await new Promise(resolve => httpServer.close(resolve));
  }
}

captureLocalizationScreenshots().catch(err => {
  console.error('[Screenshot Capture Error]:', err);
  process.exit(1);
});
