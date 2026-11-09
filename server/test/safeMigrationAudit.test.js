import assert from 'assert';
import fs from 'fs';
import { runMigration, runRollback, backupTicketsJson } from '../src/db/migrate.js';
import { query } from '../src/db/pool.js';

async function runSafeMigrationAuditTests() {
  console.log('=== [TEST SUITE 7: Safe Migration, Row-Count Audit & Rollback] ===');

  // Test 1: Verified Backup of tickets.json
  const backupPath = await backupTicketsJson();
  assert(backupPath !== null, 'Backup path should be returned');
  assert(fs.existsSync(backupPath), 'Backup file must exist on disk');
  const backupStat = fs.statSync(backupPath);
  assert(backupStat.size > 0, 'Backup file must not be empty');
  console.log('[PASS] Verified backup of tickets.json created:', backupPath, `(${backupStat.size} bytes)`);

  // Test 2: Dry Run Mode
  const dryRunReport = await runMigration({ dryRun: true });
  assert.strictEqual(dryRunReport.success, true);
  assert.strictEqual(dryRunReport.dryRun, true);
  assert.strictEqual(dryRunReport.sourceTicketsCount, 3);
  assert.deepStrictEqual(dryRunReport.customers, ['Aarav Sharma', 'Priya Mehta', 'Kabir Verma']);
  assert.deepStrictEqual(dryRunReport.orders, ['NC1021', 'NC1022', 'NC1023']);
  assert.deepStrictEqual(dryRunReport.tickets, ['tkt_1021', 'tkt_1022', 'tkt_1023']);
  console.log('[PASS] Dry-run audit successfully verified all 3 demo tickets, customers, and orders');

  // Test 3: Live Migration Execution & Database Audit
  const liveReport = await runMigration({ dryRun: false });
  assert.strictEqual(liveReport.success, true);
  const audit = liveReport.audit;

  assert.strictEqual(Number(audit.brands), 1);
  assert.strictEqual(Number(audit.users), 1);
  assert.strictEqual(Number(audit.memberships), 1);
  assert.strictEqual(Number(audit.customers), 3);
  assert.strictEqual(Number(audit.orders), 3);
  assert.strictEqual(Number(audit.tickets), 3);
  assert.strictEqual(Number(audit.mappings), 3);
  assert.strictEqual(Number(audit.archived_messages), 3);
  assert.strictEqual(Number(audit.non_usd_orders), 0);
  console.log('[PASS] Post-migration row counts match exact specifications: 1 brand, 1 user, 1 membership, 3 customers, 3 orders, 3 tickets, 3 mappings, 3 messages, 0 non-USD');

  // Test 4: Rollback Strategy
  const rollbackReport = await runRollback();
  assert.strictEqual(rollbackReport.success, true);
  console.log('[PASS] Schema rollback executed down migration cleanly');

  // Re-apply migration so database is ready for subsequent operations
  await runMigration({ dryRun: false });
  console.log('[PASS] Re-applied migration to leave database in healthy active state');

  console.log('[ALL TESTS PASSED IN safeMigrationAudit.test.js]\n');
}

runSafeMigrationAuditTests().catch(err => {
  console.error('[TEST FAILURE]:', err);
  process.exit(1);
});
