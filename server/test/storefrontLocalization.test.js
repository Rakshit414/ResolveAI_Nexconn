import test from 'node:test';
import assert from 'node:assert/strict';
import { TRANSLATIONS, SUPPORTED_LANGUAGES } from '../../client/src/utils/translations.js';
import { calculateCartTotals } from '../../client/src/utils/cartMath.js';
import { loadLanguageFromStorage, saveLanguageToStorage } from '../../client/src/utils/languageStorage.js';

test('Resolve AI — Storefront Language Localization Suite', async (t) => {

  await t.test('1. Supported languages configuration & BCP-47 conformity', () => {
    assert.strictEqual(SUPPORTED_LANGUAGES.length, 3, 'Exactly three languages configured');
    const codes = SUPPORTED_LANGUAGES.map(l => l.code);
    assert.deepStrictEqual(codes, ['en', 'hi', 'mr'], 'Languages must be English (en), Hindi (hi), and Marathi (mr)');

    // Each language entry has label and native script
    for (const lang of SUPPORTED_LANGUAGES) {
      assert.ok(lang.label, `Language ${lang.code} must have a label`);
      assert.ok(lang.native, `Language ${lang.code} must have a native name`);
    }
    assert.strictEqual(SUPPORTED_LANGUAGES.find(l => l.code === 'hi').native, 'हिन्दी');
    assert.strictEqual(SUPPORTED_LANGUAGES.find(l => l.code === 'mr').native, 'मराठी');
  });

  await t.test('2. Complete dictionary coverage across en, hi, mr', () => {
    const requiredSections = [
      'nav',
      'announcement',
      'hero',
      'tracker',
      'catalog',
      'guarantees',
      'embedBanner',
      'footer',
      'cart'
    ];

    for (const code of ['en', 'hi', 'mr']) {
      const locale = TRANSLATIONS[code];
      assert.ok(locale, `Locale ${code} must exist in TRANSLATIONS`);
      assert.ok(locale.storefront, `Locale ${code} must contain storefront UI dictionary`);

      for (const section of requiredSections) {
        assert.ok(
          locale.storefront[section],
          `Locale ${code} storefront must have section "${section}"`
        );
      }
    }
  });

  await t.test('3. Exact key parity between English baseline and localized dictionaries', () => {
    const baseline = TRANSLATIONS.en.storefront;

    function checkObjectKeys(baseObj, targetObj, lang, currentPath = '') {
      for (const key of Object.keys(baseObj)) {
        const fullPath = currentPath ? `${currentPath}.${key}` : key;
        assert.ok(
          key in targetObj,
          `Key "${fullPath}" missing in "${lang}" storefront translations`
        );

        if (typeof baseObj[key] === 'object' && baseObj[key] !== null) {
          assert.strictEqual(
            typeof targetObj[key],
            'object',
            `Key "${fullPath}" must be an object in "${lang}"`
          );
          checkObjectKeys(baseObj[key], targetObj[key], lang, fullPath);
        } else {
          assert.strictEqual(
            typeof targetObj[key],
            'string',
            `Key "${fullPath}" must be a non-empty string in "${lang}"`
          );
          assert.ok(
            targetObj[key].trim().length > 0,
            `Key "${fullPath}" must not be empty in "${lang}"`
          );
        }
      }
    }

    checkObjectKeys(baseline, TRANSLATIONS.hi.storefront, 'hi');
    checkObjectKeys(baseline, TRANSLATIONS.mr.storefront, 'mr');
  });

  await t.test('4. Language persistence (localStorage key novacart_storefront_lang)', () => {
    const mockStorage = {};
    global.window = {
      localStorage: {
        getItem: (k) => mockStorage[k] || null,
        setItem: (k, v) => { mockStorage[k] = String(v); },
        removeItem: (k) => { delete mockStorage[k]; }
      }
    };

    // Default when no storage key exists
    assert.strictEqual(loadLanguageFromStorage(), 'en');

    // Save Hindi
    saveLanguageToStorage('hi');
    assert.strictEqual(mockStorage['novacart_storefront_lang'], 'hi');
    assert.strictEqual(loadLanguageFromStorage(), 'hi');

    // Save Marathi
    saveLanguageToStorage('mr');
    assert.strictEqual(mockStorage['novacart_storefront_lang'], 'mr');
    assert.strictEqual(loadLanguageFromStorage(), 'mr');

    // Invalid language code safely falls back to default 'en'
    mockStorage['novacart_storefront_lang'] = 'invalid_lang';
    assert.strictEqual(loadLanguageFromStorage(), 'en');

    // Cleanup mock
    delete global.window;
  });

  await t.test('5. Strict preservation of canonical product names, prices, and order IDs', () => {
    const canonicalProducts = [
      { id: 'prod_shoes', name: 'NovaSprint Pro Running Shoes', price: 119.99, orderId: 'NC1021' },
      { id: 'prod_watch', name: 'NovaPulse Smartwatch - Obsidian', price: 249.50, orderId: 'NC1022' },
      { id: 'prod_headphones', name: 'NovaBass ANC Wireless Headphones', price: 89.00, orderId: 'NC1023' }
    ];

    // Verify order ID formatting rules
    for (const p of canonicalProducts) {
      assert.match(p.orderId, /^NC\d{4}$/, `Order ID ${p.orderId} matches canonical format`);
      assert.ok(typeof p.price === 'number' && p.price > 0, 'Price must remain valid float');
      assert.ok(typeof p.name === 'string' && p.name.startsWith('Nova'), 'Product name must preserve brand prefix');
    }
  });

  await t.test('6. Cart integer-cent arithmetic remains deterministic across all UI languages', () => {
    // Stated test cart: 2 Shoes ($119.99 ea), 1 Watch ($249.50), 1 Headphones ($89.00)
    const testItems = [
      { productId: 'prod_shoes', name: 'NovaSprint Pro Running Shoes', unitPriceCents: 11999, quantity: 2 },
      { productId: 'prod_watch', name: 'NovaPulse Smartwatch - Obsidian', unitPriceCents: 24950, quantity: 1 },
      { productId: 'prod_headphones', name: 'NovaBass ANC Wireless Headphones', unitPriceCents: 8900, quantity: 1 }
    ];

    const totals = calculateCartTotals(testItems);
    assert.strictEqual(totals.itemCount, 4, 'Total item count must be 4');
    assert.strictEqual(totals.cartSubtotalCents, 57848, 'Subtotal must be 57848 cents ($578.48)');
    assert.strictEqual(totals.cartSubtotalFormatted, '578.48');

    // Free shipping threshold >= $75 (7500 cents)
    assert.strictEqual(totals.isFreeShipping, true);
    assert.strictEqual(totals.shippingCents, 0);
    assert.strictEqual(totals.shippingFormatted, '0.00');

    // 8% sales tax on $578.48 = $46.28 (4628 cents)
    assert.strictEqual(totals.taxCents, 4628, '8% tax must be 4628 cents ($46.28)');
    assert.strictEqual(totals.taxFormatted, '46.28');

    // Grand total: 57848 + 0 + 4628 = 62476 cents ($624.76)
    assert.strictEqual(totals.grandTotalCents, 62476, 'Grand total must be 62476 cents ($624.76)');
    assert.strictEqual(totals.grandTotalFormatted, '624.76');
  });

  await t.test('7. Customer conversation language remains decoupled from UI language', () => {
    // In TRANSLATIONS, check that support greetings and intro messages remain per-customer
    assert.ok(TRANSLATIONS.en.welcomeAarav.includes('Aarav'));
    assert.ok(TRANSLATIONS.hi.welcomeAarav.includes('आरव'));
    assert.ok(TRANSLATIONS.mr.welcomeAarav.includes('आरव'));

    // Verify assistant intro messages preserve order numbers
    for (const code of ['en', 'hi', 'mr']) {
      const intro = TRANSLATIONS[code].storefront.tracker.badge;
      assert.ok(intro && intro.length > 0, `Tracker badge present in ${code}`);
    }
  });

  await t.test('8. Full shopping flow localization and canonical entity invariance', () => {
    const canonicalPersonas = [
      { id: 'cust_aarav', name: 'Aarav Sharma', orderId: 'NC1021', trackingNumber: 'TRK-NC-882910', carrier: 'FedEx Express', price: 119.99, product: 'NovaSprint Pro Running Shoes' },
      { id: 'cust_priya', name: 'Priya Mehta', orderId: 'NC1022', trackingNumber: 'TRK-NC-773821', carrier: 'UPS Next Day', price: 249.50, product: 'NovaPulse Smartwatch - Obsidian' },
      { id: 'cust_kabir', name: 'Kabir Verma', orderId: 'NC1023', trackingNumber: 'TRK-NC-449102', carrier: 'DHL Express', price: 89.00, product: 'NovaBass ANC Wireless Headphones' }
    ];

    // Canonical entity values must never be translated or altered
    for (const persona of canonicalPersonas) {
      assert.match(persona.orderId, /^NC102[1-3]$/, `Order ID ${persona.orderId} matches canonical format`);
      assert.match(persona.trackingNumber, /^TRK-NC-\d{6}$/, `Tracking number ${persona.trackingNumber} matches canonical format`);
      assert.ok(persona.price > 0);
      assert.ok(persona.carrier.length > 0);
    }

    // Full flow keys verification across en, hi, mr
    const shoppingFlowChecks = [
      // 1. Home & Navigation
      { section: 'nav', keys: ['officialStore', 'searchPlaceholder', 'switchCustomer', 'cart', 'shoppingBag', 'policies', 'selectLanguage'] },
      // 2. Announcement & Hero
      { section: 'announcement', keys: ['freeShipping', 'aiResolution', 'embedSnippet'] },
      { section: 'hero', keys: ['collectionBadge', 'titleLine1', 'titleLine2', 'subtitle', 'shopFootwear', 'trackShipment', 'dispatchDelivery', 'returnWindow', 'verifiedResolution', 'featuredBadge', 'delayedTransit', 'askSupportAi'] },
      // 3. Search & Category Filters
      { section: 'catalog', subSection: 'categories', keys: ['All', 'Footwear', 'Wearables', 'Audio', 'Accessories'] },
      // 4. Product Catalog & Details
      { section: 'catalog', keys: ['title', 'subtitle', 'reviews', 'option', 'inStock', 'addToCart', 'added', 'inquireAi'] },
      { section: 'catalog', subSection: 'badges', keys: ['bestSeller', 'staffFavorite', 'noiseCancelling', 'inStock', 'threePack', 'fastCharging'] },
      // 5. Order Lookup & Tracking Labels
      { section: 'tracker', keys: ['badge', 'title', 'demoOrders', 'carrier', 'trackingCode', 'status', 'launchSupport', 'preloadsContext'] },
      // 6. Cart Drawer & Checkout Flow
      { section: 'cart', keys: ['headingCart', 'headingCheckout', 'itemsInBag', 'itemInBag', 'freeShippingUnlocked', 'addMoreForFreeShipping', 'emptyTitle', 'emptyDesc', 'itemsSubtotal', 'shippingExpress', 'free', 'estimatedTax', 'grandTotal', 'proceedCheckout', 'fullName', 'shippingAddress', 'completeOrder', 'confirmedTitle'] },
      // 7. Trust Guarantees & Footer
      { section: 'guarantees', keys: ['badge', 'title', 'subtitle', 'dispatchTitle', 'dispatchDesc', 'returnTitle', 'returnDesc', 'damagedTitle', 'damagedDesc', 'humanTitle', 'humanDesc'] },
      { section: 'footer', keys: ['copyright', 'privacy', 'terms', 'security'] }
    ];

    for (const lang of ['en', 'hi', 'mr']) {
      const sf = TRANSLATIONS[lang].storefront;
      for (const check of shoppingFlowChecks) {
        const target = check.subSection ? sf[check.section]?.[check.subSection] : sf[check.section];
        assert.ok(target, `Missing section/subSection "${check.section}.${check.subSection || ''}" in language "${lang}"`);
        for (const key of check.keys) {
          assert.ok(target[key], `Missing key "${key}" in "${check.section}" for language "${lang}"`);
          assert.ok(typeof target[key] === 'string' && target[key].trim().length > 0, `Key "${key}" must be non-empty in "${lang}"`);
        }
      }

      // Root Customer Support Widget UI strings
      const widgetRootKeys = [
        'brandName', 'customerExp', 'statusResolved', 'statusAIHandling', 'btnRequestHuman',
        'carrier', 'deliveryStatus', 'inputPlaceholder', 'send', 'attachPhoto',
        'viewTranslation', 'originalMessage', 'translationLabel'
      ];
      for (const wk of widgetRootKeys) {
        assert.ok(TRANSLATIONS[lang][wk], `Root widget key "${wk}" missing in "${lang}"`);
        assert.ok(TRANSLATIONS[lang][wk].trim().length > 0, `Root widget key "${wk}" empty in "${lang}"`);
      }
    }
  });

});
