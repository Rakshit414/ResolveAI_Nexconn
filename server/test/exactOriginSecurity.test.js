import assert from 'assert';
import { validateBrandOrigin, normalizeOrigin } from '../src/routes/widget.js';

console.log('=== [TEST SUITE 11: Exact Origin Normalization & Prefix-Confusion Attack Defense] ===');

function runExactOriginSecurityTests() {
  const brand = {
    id: 'brand_novacart',
    name: 'NovaCart',
    allowed_origins: [
      'https://resolve-ai-novacart.onrender.com',
      'http://localhost:5173',
      'http://localhost:5000'
    ]
  };

  // 1. Normalization Function Tests
  console.log('\n--- 1. URL Normalization Invariants ---');
  assert.strictEqual(normalizeOrigin('https://resolve-ai-novacart.onrender.com/path?query=1'), 'https://resolve-ai-novacart.onrender.com');
  assert.strictEqual(normalizeOrigin('HTTPS://RESOLVE-AI-NOVACART.ONRENDER.COM:443'), 'https://resolve-ai-novacart.onrender.com');
  assert.strictEqual(normalizeOrigin('http://localhost:5173/'), 'http://localhost:5173');
  assert.strictEqual(normalizeOrigin('invalid-url'), null);
  assert.strictEqual(normalizeOrigin('javascript:alert(1)'), null);
  assert.strictEqual(normalizeOrigin('data:text/html,<html></html>'), null);
  assert.strictEqual(normalizeOrigin('ftp://resolve-ai-novacart.onrender.com'), null);
  assert.strictEqual(normalizeOrigin(null), null);
  assert.strictEqual(normalizeOrigin(''), null);
  assert.strictEqual(normalizeOrigin('null'), null);
  console.log('[PASS] normalizeOrigin strictly sanitizes schemes and strips paths/queries');

  // 2. Production Defense Against Prefix-Confusion Attacks
  console.log('\n--- 2. Production Prefix-Confusion Attack Defenses ---');
  const prevEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';

  // Legitimate allowed origin
  assert.strictEqual(validateBrandOrigin(brand, 'https://resolve-ai-novacart.onrender.com'), true, 'Exact legitimate origin MUST be allowed');

  // Attack 1: Appended domain suffix (e.g. startsWith bypass)
  const attackerSuffix = 'https://resolve-ai-novacart.onrender.com.attacker.com';
  assert.strictEqual(validateBrandOrigin(brand, attackerSuffix), false, 'Prefix-confusion domain suffix MUST be rejected');

  // Attack 2: Hyphenated phish domain
  const attackerHyphen = 'https://resolve-ai-novacart.onrender.com-phish.net';
  assert.strictEqual(validateBrandOrigin(brand, attackerHyphen), false, 'Hyphenated spoof domain MUST be rejected');

  // Attack 3: Unexpected port injection
  const attackerPort = 'https://resolve-ai-novacart.onrender.com:8443';
  assert.strictEqual(validateBrandOrigin(brand, attackerPort), false, 'Unexpected port MUST be rejected');

  // Attack 4: HTTP instead of HTTPS
  const attackerHttp = 'http://resolve-ai-novacart.onrender.com';
  assert.strictEqual(validateBrandOrigin(brand, attackerHttp), false, 'Insecure HTTP scheme for production domain MUST be rejected');

  // Attack 5: Null / sandboxed origin bypass
  assert.strictEqual(validateBrandOrigin(brand, 'null'), false, 'Null origin MUST be rejected');
  assert.strictEqual(validateBrandOrigin(brand, ''), false, 'Empty origin in production MUST be rejected');

  // Attack 6: Localhost in production MUST be stripped and rejected
  assert.strictEqual(validateBrandOrigin(brand, 'http://localhost:5173'), false, 'Localhost MUST be blocked in production');
  assert.strictEqual(validateBrandOrigin(brand, 'http://127.0.0.1:5173'), false, '127.0.0.1 MUST be blocked in production');

  // 3. Development Mode Tests
  console.log('\n--- 3. Development Mode Behavior ---');
  process.env.NODE_ENV = 'development';
  assert.strictEqual(validateBrandOrigin(brand, 'http://localhost:5173'), true, 'Localhost 5173 permitted in development');
  assert.strictEqual(validateBrandOrigin(brand, 'http://127.0.0.1:5173'), true, '127.0.0.1 5173 permitted in development');
  assert.strictEqual(validateBrandOrigin(brand, 'http://localhost:3000'), false, 'Unapproved local port 3000 rejected in development');
  assert.strictEqual(validateBrandOrigin(brand, attackerSuffix), false, 'Attacker prefix-confusion rejected even in development');

  process.env.NODE_ENV = prevEnv;

  console.log('\n====================================================================');
  console.log('ALL EXACT ORIGIN & PREFIX-CONFUSION DEFENSE TESTS PASSED');
  console.log('====================================================================');
}

runExactOriginSecurityTests();
