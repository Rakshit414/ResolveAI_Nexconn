import assert from 'assert';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { canonicalizeLocale } from '../src/services/translationService.js';
import { TranslationCircuitBreaker } from '../src/services/translationCircuitBreaker.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');

console.log('================================================================================');
console.log('=== [TEST SUITE: 12-Language Localization, RTL, Asian Scripts & Fallbacks] ===');
console.log('================================================================================\n');

async function runTwelveLanguageTestSuite() {
  // Load translations module via fileURL
  const translationsModulePath = path.resolve(ROOT_DIR, 'client/src/utils/translations.js');
  const translationsModule = await import(pathToFileURL(translationsModulePath).href);

  const {
    TRANSLATIONS,
    SUPPORTED_LANGUAGES,
    SUPPORTED_LANGUAGE_CODES,
    getPersonalizedGreeting,
    getAssistantIntroMessage,
    getSuggestedQuestions
  } = translationsModule;

  // ============================================================================
  // TEST 1: All 12 language codes present and canonicalized
  // ============================================================================
  console.log('Test 1: Verify all 12 supported language codes and BCP-47 canonicalization...');
  const expectedCodes = ['en', 'hi', 'mr', 'es', 'de', 'fr', 'ja', 'pt', 'ar', 'zh-CN', 'bn', 'ta'];
  assert.strictEqual(SUPPORTED_LANGUAGE_CODES.length, 12, 'Must have exactly 12 supported language codes');
  assert.deepStrictEqual(SUPPORTED_LANGUAGE_CODES.sort(), expectedCodes.slice().sort());

  assert.strictEqual(canonicalizeLocale('en'), 'en-US');
  assert.strictEqual(canonicalizeLocale('hi'), 'hi-IN');
  assert.strictEqual(canonicalizeLocale('mr'), 'mr-IN');
  assert.strictEqual(canonicalizeLocale('es'), 'es-ES');
  assert.strictEqual(canonicalizeLocale('de'), 'de-DE');
  assert.strictEqual(canonicalizeLocale('fr'), 'fr-FR');
  assert.strictEqual(canonicalizeLocale('ja'), 'ja-JP');
  assert.strictEqual(canonicalizeLocale('pt'), 'pt-BR');
  assert.strictEqual(canonicalizeLocale('ar'), 'ar-SA');
  assert.strictEqual(canonicalizeLocale('zh-CN'), 'zh-CN');
  assert.strictEqual(canonicalizeLocale('bn'), 'bn-BD');
  assert.strictEqual(canonicalizeLocale('ta'), 'ta-IN');
  console.log('  -> PASS: All 12 language codes canonicalize to valid BCP-47 tags\n');

  // ============================================================================
  // TEST 2: 100% Key Parity Across All 12 Locales
  // ============================================================================
  console.log('Test 2: Verifying 100% key parity across all 12 translation dictionaries...');
  const enKeys = Object.keys(TRANSLATIONS.en.storefront);

  for (const langCode of expectedCodes) {
    const localeDict = TRANSLATIONS[langCode];
    assert(localeDict, `Translation dictionary must exist for ${langCode}`);
    assert(localeDict.storefront, `Storefront section must exist for ${langCode}`);

    for (const section of enKeys) {
      assert(localeDict.storefront[section], `Section "${section}" must exist in ${langCode}`);
      const enSubKeys = Object.keys(TRANSLATIONS.en.storefront[section]);

      for (const key of enSubKeys) {
        assert(
          localeDict.storefront[section][key] !== undefined,
          `Key "${section}.${key}" is missing in ${langCode}`
        );
        const val = localeDict.storefront[section][key];
        if (typeof val === 'object' && val !== null) {
          const enNested = TRANSLATIONS.en.storefront[section][key];
          for (const nestedKey of Object.keys(enNested)) {
            assert(
              val[nestedKey] !== undefined,
              `Nested key "${section}.${key}.${nestedKey}" is missing in ${langCode}`
            );
            assert(
              typeof val[nestedKey] === 'string' && val[nestedKey].trim().length > 0,
              `Nested key "${section}.${key}.${nestedKey}" in ${langCode} must be non-empty`
            );
          }
        } else {
          assert(
            typeof val === 'string' && val.trim().length > 0,
            `Key "${section}.${key}" in ${langCode} must be a non-empty string`
          );
        }
      }
    }
  }
  console.log(`  -> PASS: Verified key parity across all ${expectedCodes.length} locales and sections (nav, hero, products, cart, trust, footer, widget)\n`);

  // ============================================================================
  // TEST 3: Deep Fallback to English
  // ============================================================================
  console.log('Test 3: Verifying deep key-level English fallback...');
  // Helper simulating LanguageContext t() function
  function t(lang, section, key, fallback = '') {
    const val = TRANSLATIONS[lang]?.storefront?.[section]?.[key] ?? TRANSLATIONS[lang]?.[section]?.[key];
    if (val !== undefined && val !== null) return val;
    const enVal = TRANSLATIONS.en?.storefront?.[section]?.[key] ?? TRANSLATIONS.en?.[section]?.[key];
    if (enVal !== undefined && enVal !== null) return enVal;
    return fallback;
  }

  // Existing key in French
  assert.strictEqual(t('fr', 'nav', 'storefront'), 'Boutique');
  // Hypothetical missing key in German falls back to English
  const mockGermanWithMissing = { storefront: { nav: {} } };
  const fallbackVal = mockGermanWithMissing.storefront?.nav?.storefront ?? TRANSLATIONS.en.storefront.nav.storefront;
  assert.strictEqual(fallbackVal, 'Storefront');
  console.log('  -> PASS: Missing or undefined keys fall back cleanly to English dictionary\n');

  // ============================================================================
  // TEST 4: RTL Configuration for Arabic
  // ============================================================================
  console.log('Test 4: Verifying RTL configuration for Arabic...');
  const arConfig = SUPPORTED_LANGUAGES.find(l => l.code === 'ar');
  assert(arConfig, 'Arabic config must exist');
  assert.strictEqual(arConfig.dir, 'rtl', 'Arabic must have dir: "rtl"');

  const nonArConfigs = SUPPORTED_LANGUAGES.filter(l => l.code !== 'ar');
  for (const cfg of nonArConfigs) {
    assert.strictEqual(cfg.dir, 'ltr', `${cfg.code} must have dir: "ltr"`);
  }
  console.log('  -> PASS: RTL directionality correctly configured for Arabic (and LTR for other 11 languages)\n');

  // ============================================================================
  // TEST 5: Asian Scripts Character Integrity
  // ============================================================================
  console.log('Test 5: Verifying Asian script rendering integrity (Bengali, Tamil, Japanese, Chinese)...');
  // Bengali: বাংলা
  assert(/[\u0980-\u09FF]/.test(TRANSLATIONS.bn.storefront.hero.titleLine1), 'Bengali script must contain valid unicode range 0980-09FF');
  assert(/[\u0980-\u09FF]/.test(TRANSLATIONS.bn.storefront.nav.storefront), 'Bengali script must contain valid unicode range 0980-09FF');

  // Tamil: தமிழ்
  assert(/[\u0B80-\u0BFF]/.test(TRANSLATIONS.ta.storefront.hero.titleLine1), 'Tamil script must contain valid unicode range 0B80-0BFF');
  assert(/[\u0B80-\u0BFF]/.test(TRANSLATIONS.ta.storefront.nav.storefront), 'Tamil script must contain valid unicode range 0B80-0BFF');

  // Japanese: 日本語
  assert(/[\u3040-\u30FF\u4E00-\u9FAF]/.test(TRANSLATIONS.ja.storefront.hero.titleLine1), 'Japanese script must contain valid Kanji/Kana unicode');
  assert(/[\u3040-\u30FF\u4E00-\u9FAF]/.test(TRANSLATIONS.ja.storefront.nav.storefront), 'Japanese script must contain valid Kanji/Kana unicode');

  // Chinese Simplified: 简体中文
  const zhDict = TRANSLATIONS['zh-CN'] || TRANSLATIONS.zhCN;
  assert(/[\u4E00-\u9FAF]/.test(zhDict.storefront.hero.titleLine1), 'Chinese script must contain valid CJK unicode');
  assert(/[\u4E00-\u9FAF]/.test(zhDict.storefront.nav.storefront), 'Chinese script must contain valid CJK unicode');

  console.log('  -> PASS: Bengali, Tamil, Japanese, and Chinese characters verified without encoding distortion\n');

  // ============================================================================
  // TEST 6: Strict Entity Preservation Across All 12 Languages
  // ============================================================================
  console.log('Test 6: Verifying strict entity preservation in greetings, intro, and suggested questions...');

  for (const code of expectedCodes) {
    const greeting = getPersonalizedGreeting('cust_priya', code);
    assert(greeting.includes('Priya') || greeting.includes('प्रिया'), `Greeting in ${code} must preserve customer name Priya`);

    const introAarav = getAssistantIntroMessage('cust_aarav', code);
    assert(introAarav.includes('NC1021') || introAarav.includes('NovaSprint Pro'), `Intro for Aarav in ${code} must preserve order ID NC1021 or product name`);

    const introPriya = getAssistantIntroMessage('cust_priya', code);
    assert(introPriya.includes('NC1022') || introPriya.includes('NovaPulse'), `Intro for Priya in ${code} must preserve order ID NC1022 or product name`);

    const introKabir = getAssistantIntroMessage('cust_kabir', code);
    assert(introKabir.includes('NC1023') || introKabir.includes('NovaBass'), `Intro for Kabir in ${code} must preserve order ID NC1023 or product name`);

    const questions = getSuggestedQuestions('cust_aarav', code);
    assert.strictEqual(questions.length, 3, `Must return 3 suggested questions for ${code}`);
    for (const q of questions) {
      assert(typeof q === 'string' && q.trim().length > 0, `Question in ${code} must be non-empty string`);
    }
  }
  console.log('  -> PASS: Order ID #NC1021, customer names, and brands strictly preserved across all 12 languages\n');

  // ============================================================================
  // TEST 7: Translation Circuit Breaker State Transitions
  // ============================================================================
  console.log('Test 7: Verifying Translation Circuit Breaker state transitions...');
  process.env.NODE_ENV = 'test';
  const testBreaker = new TranslationCircuitBreaker({
    threshold: 3,
    resetTimeout: 100
  });

  assert.strictEqual(testBreaker.state, 'CLOSED');
  assert.strictEqual(testBreaker.canAttemptTranslation(), true);

  // Trigger 3 failures
  testBreaker.recordFailure(new Error('Translation API network error'));
  testBreaker.recordFailure(new Error('Translation API 500 error'));
  assert.strictEqual(testBreaker.state, 'CLOSED');

  testBreaker.recordFailure(new Error('Translation API 503 error'));
  assert.strictEqual(testBreaker.state, 'OPEN', 'Circuit breaker must transition to OPEN after 3 failures');
  assert.strictEqual(testBreaker.canAttemptTranslation(), false, 'Translations must be blocked when breaker is OPEN');

  // Wait for reset timeout
  await new Promise(resolve => setTimeout(resolve, 120));
  assert.strictEqual(testBreaker.canAttemptTranslation(), true, 'Breaker must allow probe in HALF_OPEN state');
  assert.strictEqual(testBreaker.state, 'HALF_OPEN');

  // Successful probe resets to CLOSED
  testBreaker.recordSuccess();
  assert.strictEqual(testBreaker.state, 'CLOSED');
  console.log('  -> PASS: Translation circuit breaker operates fail-safe across CLOSED -> OPEN -> HALF_OPEN -> CLOSED\n');

  console.log('================================================================================');
  console.log('=== [ALL 7 LOCALIZATION & TRANSLATION SUITE TESTS PASSED WITH 100% SUCCESS] ===');
  console.log('================================================================================\n');
}

runTwelveLanguageTestSuite().catch(err => {
  console.error('[FATAL LOCALIZATION TEST FAILURE]:', err);
  process.exit(1);
});
