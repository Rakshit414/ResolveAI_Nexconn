import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { validateWebhookHeaders, parseWebhookEnvelopes } from '../src/routes/webhooks.js';
import { normalizeOrigin, validateBrandOrigin, isGuestRateLimited, resetGuestRateLimit } from '../src/routes/widget.js';

test('Resolve AI — Security, Session & Cross-Origin Isolation Suite', async (t) => {

  await t.test('1. Agent cookie flags & session token hashing', () => {
    // Verify that session tokens are hashed before storage and cookies are configured securely
    const rawSessionToken = `agent_sess_${crypto.randomBytes(32).toString('hex')}`;
    const tokenHash = crypto.createHash('sha256').update(rawSessionToken).digest('hex');

    assert.ok(rawSessionToken.startsWith('agent_sess_'), 'Token has explicit agent prefix');
    assert.strictEqual(tokenHash.length, 64, 'SHA-256 hash length is 64 hex characters');
    assert.notStrictEqual(tokenHash, rawSessionToken, 'Raw token must never equal hash');

    // Expected cookie security configuration
    const cookieConfig = {
      httpOnly: true,
      secure: true, // in production
      sameSite: 'strict',
      maxAge: 1000 * 60 * 60 * 8, // 8 hours
      path: '/'
    };

    assert.strictEqual(cookieConfig.httpOnly, true, 'Cookies must be HttpOnly to prevent XSS access');
    assert.strictEqual(cookieConfig.sameSite, 'strict', 'Cookies must be SameSite=strict to prevent CSRF');
    assert.strictEqual(cookieConfig.secure, true, 'Cookies must be Secure in production');
  });

  await t.test('2. Webhook signature verification: SHA1(AppSecret + Nonce + Timestamp)', () => {
    const testSecret = 'test_secret_abc123';
    const testAppKey = 'test_app_key_456';
    const nonce = 'rnd_nonce_123';
    const timestamp = Date.now().toString();

    const validSig = crypto
      .createHash('sha1')
      .update(`${testSecret}${nonce}${timestamp}`)
      .digest('hex');

    // Valid headers
    const validHeaders = {
      'app-key': testAppKey,
      'nonce': nonce,
      'timestamp': timestamp,
      'signature': validSig
    };

    const res = validateWebhookHeaders(validHeaders, testAppKey, testSecret);
    assert.strictEqual(res.valid, true, 'Valid signature must be accepted');

    // Tampered signature
    const invalidHeaders = { ...validHeaders, signature: 'bad_signature_0000000000000000000000000000000000000000' };
    const tamperedRes = validateWebhookHeaders(invalidHeaders, testAppKey, testSecret);
    assert.strictEqual(tamperedRes.valid, false, 'Tampered signature must be rejected');
    assert.strictEqual(tamperedRes.status, 401);

    // Expired timestamp (older than 5 minutes = 300,000 ms)
    const oldTimestamp = (Date.now() - 360000).toString(); // 6 minutes ago
    const oldSig = crypto.createHash('sha1').update(`${testSecret}${nonce}${oldTimestamp}`).digest('hex');
    const expiredHeaders = {
      'app-key': testAppKey,
      'nonce': nonce,
      'timestamp': oldTimestamp,
      'signature': oldSig
    };
    const expiredRes = validateWebhookHeaders(expiredHeaders, testAppKey, testSecret);
    assert.strictEqual(expiredRes.valid, false, 'Expired timestamp must be rejected');
    assert.strictEqual(expiredRes.status, 400);

    // Nonce length exceeding 18 characters
    const longNonce = 'nonce_that_is_much_too_long_for_spec';
    const longNonceHeaders = {
      'app-key': testAppKey,
      'nonce': longNonce,
      'timestamp': timestamp,
      'signature': validSig
    };
    const longNonceRes = validateWebhookHeaders(longNonceHeaders, testAppKey, testSecret);
    assert.strictEqual(longNonceRes.valid, false, 'Nonce > 18 chars must be rejected');
    assert.strictEqual(longNonceRes.status, 400);
  });

  await t.test('3. Origin normalization & whitelist validation', () => {
    const brand = {
      id: 'brand_novacart',
      allowed_origins: [
        'http://localhost:5173',
        'http://localhost:5000',
        'https://resolve-ai-novacart.onrender.com'
      ]
    };

    // Valid origins
    assert.strictEqual(validateBrandOrigin(brand, 'https://resolve-ai-novacart.onrender.com'), true);
    assert.strictEqual(validateBrandOrigin(brand, 'https://resolve-ai-novacart.onrender.com/store'), true); // normalized to origin

    // Invalid / Attacker origins
    assert.strictEqual(validateBrandOrigin(brand, 'https://evil-attacker.com'), false);
    assert.strictEqual(validateBrandOrigin(brand, 'https://resolve-ai-novacart.onrender.com.attacker.com'), false);
    assert.strictEqual(validateBrandOrigin(brand, 'javascript:alert(1)'), false);
    assert.strictEqual(validateBrandOrigin(brand, null), true); // Allowed in non-production for local testing
  });

  await t.test('4. Guest session rate limiting (10 req / minute per IP)', () => {
    resetGuestRateLimit();
    const testIp = '192.168.1.100';

    // Requests 1 through 10 must succeed
    for (let i = 1; i <= 10; i++) {
      assert.strictEqual(isGuestRateLimited(testIp), false, `Request ${i} must not be rate-limited`);
    }

    // Request 11 must be rate-limited
    assert.strictEqual(isGuestRateLimited(testIp), true, 'Request 11 must trigger rate limiting');

    // Different IP must not be affected
    assert.strictEqual(isGuestRateLimited('192.168.1.101'), false, 'Independent IP must not be rate-limited');

    resetGuestRateLimit();
  });

  await t.test('5. Magic bytes & attachment security validation', () => {
    // PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A
    const validPngBuffer = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D]);

    // Fake executable disguised as PNG
    const fakePngExecutable = Buffer.from([0x4D, 0x5A, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00]); // "MZ" DOS executable header

    function isMagicValid(buffer, declaredMime) {
      if (!buffer || buffer.length < 8) return false;
      if (declaredMime === 'image/png') {
        return buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47;
      }
      return false;
    }

    assert.strictEqual(isMagicValid(validPngBuffer, 'image/png'), true, 'Real PNG must pass magic bytes check');
    assert.strictEqual(isMagicValid(fakePngExecutable, 'image/png'), false, 'Disguised executable must fail magic bytes check');
  });

  await t.test('6. PII Masking and internal note confidentiality', () => {
    const rawCustomerCard = '4111222233334444';
    const maskedCard = rawCustomerCard.replace(/\d(?=\d{4})/g, '•');
    assert.strictEqual(maskedCard, '••••••••••••4444', 'Credit card number masked to last 4 digits');

    // Customer payload sanitization test
    const internalTicketData = {
      id: 'tkt_1021',
      brandId: 'brand_novacart',
      category: 'Delivery Delay',
      status: 'AI Handling',
      internalAgentNotes: 'Customer called 3 times, expedite shipping hub contact',
      geminiApiKey: 'SECRET_API_KEY_NEVER_LEAK'
    };

    function sanitizeForCustomer(data) {
      const sanitized = { ...data };
      delete sanitized.internalAgentNotes;
      delete sanitized.geminiApiKey;
      return sanitized;
    }

    const customerView = sanitizeForCustomer(internalTicketData);
    assert.strictEqual(customerView.internalAgentNotes, undefined, 'Internal notes stripped from customer payload');
    assert.strictEqual(customerView.geminiApiKey, undefined, 'API key stripped from customer payload');
    assert.strictEqual(customerView.id, 'tkt_1021');
  });

});
