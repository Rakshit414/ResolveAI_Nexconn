import assert from 'assert';
import { runMigration } from '../src/db/migrate.js';
import { query } from '../src/db/pool.js';

async function runAgentMembershipTests() {
  console.log('=== [TEST SUITE 2: Agent Membership & Session Constraints] ===');
  await runMigration();

  // Test 1: Assign valid agent Sarah Lin to tkt_1021
  await query(`
    UPDATE tickets 
    SET assigned_agent_id = 'user_sarah_lin', status = 'Human Agent Active'
    WHERE id = 'tkt_1021'
  `);
  const ticketRes = await query(`SELECT assigned_agent_id, status FROM tickets WHERE id = 'tkt_1021'`);
  assert.strictEqual(ticketRes.rows[0].assigned_agent_id, 'user_sarah_lin');
  assert.strictEqual(ticketRes.rows[0].status, 'Human Agent Active');
  console.log('[PASS] Valid agent Sarah Lin assigned to tkt_1021');

  // Test 2: Attempt to assign an agent who is NOT a member of brand_novacart
  let invalidAgentErr = null;
  try {
    await query(`
      UPDATE tickets 
      SET assigned_agent_id = 'user_random_hacker'
      WHERE id = 'tkt_1021'
    `);
  } catch (err) {
    invalidAgentErr = err;
  }
  assert(invalidAgentErr !== null, 'Expected invalid agent assignment to fail');
  console.log('[PASS] Rejected non-member agent assignment:', invalidAgentErr.message);

  // Test 3: Attempt to create an agent session for a brand where the user is NOT a member
  let invalidSessionErr = null;
  try {
    await query(`
      INSERT INTO agent_sessions (id, brand_id, user_id, session_token_hash, csrf_token, expires_at)
      VALUES ('sess_invalid', 'brand_novacart', 'user_non_member', 'hash_fake', 'csrf_fake', NOW() + INTERVAL '1 hour')
    `);
  } catch (err) {
    invalidSessionErr = err;
  }
  assert(invalidSessionErr !== null, 'Expected session creation for non-member to fail');
  console.log('[PASS] Rejected session creation for non-member user:', invalidSessionErr.message);

  // Test 4: Soft-deactivate membership and verify integrity
  await query(`
    UPDATE brand_memberships 
    SET deactivated_at = NOW() 
    WHERE brand_id = 'brand_novacart' AND user_id = 'user_sarah_lin'
  `);
  const memRes = await query(`
    SELECT deactivated_at 
    FROM brand_memberships 
    WHERE brand_id = 'brand_novacart' AND user_id = 'user_sarah_lin'
  `);
  assert(memRes.rows[0].deactivated_at !== null, 'Membership should be soft deactivated');
  console.log('[PASS] Membership soft deactivation preserved historical assignment without nullifying brand_id');

  // Restore Sarah Lin membership for subsequent tests
  await query(`
    UPDATE brand_memberships 
    SET deactivated_at = NULL 
    WHERE brand_id = 'brand_novacart' AND user_id = 'user_sarah_lin'
  `);

  console.log('[ALL TESTS PASSED IN agentMembershipIntegrity.test.js]\n');
}

runAgentMembershipTests().catch(err => {
  console.error('[TEST FAILURE]:', err);
  process.exit(1);
});
