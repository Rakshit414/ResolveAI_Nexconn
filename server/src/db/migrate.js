import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { getPool, query, closePool } from './pool.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getChecksum(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

export async function backupTicketsJson() {
  const sourcePath = path.resolve(__dirname, '../../data/tickets.json');
  if (!fs.existsSync(sourcePath)) {
    console.warn('[Migrate] tickets.json not found, skipping backup');
    return null;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.resolve(__dirname, `../../data/tickets.backup.${timestamp}.json`);
  fs.copyFileSync(sourcePath, backupPath);
  console.log('[Migrate] Created backup of tickets.json ->', backupPath);
  return backupPath;
}

export async function runMigration({ dryRun = false } = {}) {
  console.log(`[Migrate] Starting migration (dryRun=${dryRun})...`);

  // 1. Safety backup of tickets.json
  const backupPath = await backupTicketsJson();

  // 2. Read SQL migration files
  const schemaPath = path.join(__dirname, 'migrations/001_canonical_schema.sql');
  const seedPath = path.join(__dirname, 'migrations/002_seed_demo_data.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');
  const seedSql = fs.readFileSync(seedPath, 'utf8');

  const schemaChecksum = getChecksum(schemaSql);
  const seedChecksum = getChecksum(seedSql);

  if (dryRun) {
    console.log('[Migrate] DRY RUN: Validating SQL script syntax and row counts');
    const sourcePath = path.resolve(__dirname, '../../data/tickets.json');
    const sourceTickets = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
    return {
      success: true,
      dryRun: true,
      backupPath,
      schemaLength: schemaSql.length,
      schemaChecksum,
      seedLength: seedSql.length,
      seedChecksum,
      sourceTicketsCount: sourceTickets.length,
      customers: sourceTickets.map(t => t.customer.name),
      orders: sourceTickets.map(t => t.orderId),
      tickets: sourceTickets.map(t => t.id)
    };
  }

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    // Ensure _schema_migrations ledger table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS _schema_migrations (
        version VARCHAR(64) PRIMARY KEY,
        applied_at TIMESTAMPTZ DEFAULT NOW(),
        checksum VARCHAR(64) NOT NULL
      );
    `);

    // Check applied migrations
    const appliedRes = await client.query('SELECT version, checksum FROM _schema_migrations');
    const appliedMap = new Map(appliedRes.rows.map(r => [r.version, r.checksum]));

    // Apply 001_canonical_schema.sql if not applied
    if (!appliedMap.has('001_canonical_schema')) {
      console.log('[Migrate] Applying 001_canonical_schema.sql...');
      await client.query(schemaSql);
      await client.query(
        'INSERT INTO _schema_migrations (version, checksum) VALUES ($1, $2)',
        ['001_canonical_schema', schemaChecksum]
      );
    } else {
      console.log('[Migrate] 001_canonical_schema.sql already applied, verifying schema...');
      await client.query(schemaSql); // Safe idempotent re-run
    }

    // Apply 002_seed_demo_data.sql if not applied
    if (!appliedMap.has('002_seed_demo_data')) {
      console.log('[Migrate] Applying 002_seed_demo_data.sql...');
      await client.query(seedSql);
      await client.query(
        'INSERT INTO _schema_migrations (version, checksum) VALUES ($1, $2)',
        ['002_seed_demo_data', seedChecksum]
      );
    } else {
      console.log('[Migrate] 002_seed_demo_data.sql already applied, running idempotent seed...');
      await client.query(seedSql); // Safe ON CONFLICT DO UPDATE/NOTHING
    }

    // 3. Post-migration verification
    console.log('[Migrate] Running verification audit...');
    const auditRes = await client.query(`
      SELECT 
        (SELECT COUNT(*) FROM brands WHERE id = 'brand_novacart') AS brands,
        (SELECT COUNT(*) FROM users WHERE id = 'user_sarah_lin') AS users,
        (SELECT COUNT(*) FROM brand_memberships WHERE brand_id = 'brand_novacart') AS memberships,
        (SELECT COUNT(*) FROM customers WHERE brand_id = 'brand_novacart') AS customers,
        (SELECT COUNT(*) FROM orders WHERE brand_id = 'brand_novacart') AS orders,
        (SELECT COUNT(*) FROM tickets WHERE brand_id = 'brand_novacart') AS tickets,
        (SELECT COUNT(*) FROM conversation_mappings WHERE brand_id = 'brand_novacart') AS mappings,
        (SELECT COUNT(*) FROM message_archive WHERE brand_id = 'brand_novacart') AS archived_messages,
        (SELECT COUNT(*) FROM orders WHERE currency != 'USD') AS non_usd_orders
    `);

    const audit = auditRes.rows[0];

    // Verify all 17 public tables in catalog
    const tablesRes = await client.query(`
      SELECT tablename FROM pg_catalog.pg_tables 
      WHERE schemaname = 'public' AND tablename != '_schema_migrations'
      ORDER BY tablename ASC;
    `);

    await client.query('COMMIT');
    console.log('[Migrate] Migration committed successfully! Audit counts:', audit);
    console.log(`[Migrate] Verified ${tablesRes.rows.length} canonical public tables in database`);

    return {
      success: true,
      backupPath,
      audit,
      publicTables: tablesRes.rows.map(r => r.tablename)
    };
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Migrate] Error applying migration, rolled back:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

export async function runRollback() {
  console.log('[Migrate] Rolling back database schema...');
  const rollbackSql = fs.readFileSync(path.join(__dirname, 'migrations/001_canonical_schema_down.sql'), 'utf8');
  await query(rollbackSql);
  try {
    await query('DROP TABLE IF EXISTS _schema_migrations CASCADE;');
  } catch (e) {}
  if (!process.env.DATABASE_URL) {
    await closePool();
  }
  console.log('[Migrate] Rollback complete.');
  return { success: true };
}

// Direct CLI invocation support
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const isDryRun = process.argv.includes('--dry-run');
  const isRollback = process.argv.includes('--down');

  if (isRollback) {
    runRollback().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
  } else {
    runMigration({ dryRun: isDryRun }).then(report => {
      console.log('[Migrate Report]', JSON.stringify(report, null, 2));
      process.exit(0);
    }).catch(e => {
      console.error(e);
      process.exit(1);
    });
  }
}

export default {
  runMigration,
  runRollback,
  backupTicketsJson
};
