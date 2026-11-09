import assert from 'assert';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { runMigration } from '../src/db/migrate.js';
import { query } from '../src/db/pool.js';
import { requireAgentAuth } from '../src/middleware/agentAuth.js';

async function runAgentAuthSessionCSRFTests() {
  console.log('=== [TEST SUITE 6: Agent Authentication, Sessions & CSRF Protection] ===');
  await runMigration();

  // Test 1: Verify Sarah Lin password verification
  const userRes = await query(`SELECT password_hash FROM users WHERE email = 'sarah.lin@novacart.com'`);
  assert.strictEqual(userRes.rows.length, 1);
  const hash = userRes.rows[0].password_hash;
  const isMatch = await bcrypt.compare('DemoSecret2026!', hash);
  const isWrongMatch = await bcrypt.compare('WrongPassword', hash);
  assert.strictEqual(isMatch, true);
  assert.strictEqual(isWrongMatch, false);
  console.log('[PASS] Sarah Lin password authentication verified with bcrypt');

  // Test 2: Session creation and token hashing
  const rawSessionToken = `agent_sess_${crypto.randomBytes(32).toString('hex')}`;
  const tokenHash = crypto.createHash('sha256').update(rawSessionToken).digest('hex');
  const csrfToken = crypto.randomBytes(24).toString('hex');
  const sessionId = `sess_test_${Date.now()}`;

  await query(`
    INSERT INTO agent_sessions (id, brand_id, user_id, session_token_hash, csrf_token, ip_address, expires_at)
    VALUES ($1, 'brand_novacart', 'user_sarah_lin', $2, $3, '127.0.0.1', NOW() + INTERVAL '8 hours')
  `, [sessionId, tokenHash, csrfToken]);

  // Test 3: Middleware validation - Reject customer widget tokens
  const mockReqWidget = {
    headers: { authorization: 'Bearer wgt_customer_token_123' },
    method: 'GET'
  };
  let widgetRejected = false;
  const mockResWidget = {
    status: (code) => {
      assert.strictEqual(code, 403);
      return {
        json: (data) => {
          widgetRejected = true;
          assert.strictEqual(data.error.includes('Customer widget tokens are not authorized'), true);
        }
      };
    }
  };
  await requireAgentAuth(mockReqWidget, mockResWidget, () => {});
  assert.strictEqual(widgetRejected, true);
  console.log('[PASS] Customer widget token rejected with 403 Forbidden on agent middleware');

  // Test 4: Middleware validation - State mutation requires matching X-CSRF-Token
  const mockReqMutationNoCSRF = {
    headers: { cookie: `resolve_agent_session=${rawSessionToken}` },
    method: 'PATCH'
  };
  let csrfRejected = false;
  const mockResCSRF = {
    status: (code) => {
      assert.strictEqual(code, 403);
      return {
        json: (data) => {
          csrfRejected = true;
          assert.strictEqual(data.error.includes('CSRF token validation failed'), true);
        }
      };
    }
  };
  await requireAgentAuth(mockReqMutationNoCSRF, mockResCSRF, () => {});
  assert.strictEqual(csrfRejected, true);
  console.log('[PASS] State mutation request without matching X-CSRF-Token rejected with 403');

  // Test 5: Middleware validation - Valid session cookie + matching X-CSRF-Token
  const mockReqValid = {
    headers: {
      cookie: `resolve_agent_session=${rawSessionToken}`,
      'x-csrf-token': csrfToken
    },
    method: 'PATCH'
  };
  let validNextCalled = false;
  await requireAgentAuth(mockReqValid, {}, () => {
    validNextCalled = true;
  });
  assert.strictEqual(validNextCalled, true);
  assert.strictEqual(mockReqValid.agent.id, 'user_sarah_lin');
  assert.strictEqual(mockReqValid.agent.brandId, 'brand_novacart');
  console.log('[PASS] Valid session and CSRF token passed agent middleware authentication');

  // Test 6: Membership deactivation immediately revokes agent access
  await query(`
    UPDATE brand_memberships 
    SET deactivated_at = NOW() 
    WHERE brand_id = 'brand_novacart' AND user_id = 'user_sarah_lin'
  `);

  let deactivationRejected = false;
  const mockResDeactivated = {
    status: (code) => {
      assert.strictEqual(code, 403);
      return {
        json: (data) => {
          deactivationRejected = true;
          assert.strictEqual(data.error.includes('membership has been deactivated'), true);
        }
      };
    }
  };
  await requireAgentAuth(mockReqValid, mockResDeactivated, () => {});
  assert.strictEqual(deactivationRejected, true);
  console.log('[PASS] Deactivated agent membership immediately rejected with 403 Forbidden');

  // Clean up: reactivate membership
  await query(`
    UPDATE brand_memberships 
    SET deactivated_at = NULL 
    WHERE brand_id = 'brand_novacart' AND user_id = 'user_sarah_lin'
  `);

  console.log('[ALL TESTS PASSED IN agentAuthSessionCSRF.test.js]\n');
}

runAgentAuthSessionCSRFTests().catch(err => {
  console.error('[TEST FAILURE]:', err);
  process.exit(1);
});
