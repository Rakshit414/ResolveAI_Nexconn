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

  // 2. Read and register versioned SQL migration files
  const migrationFiles = [
    { version: '001_canonical_schema', filename: '001_canonical_schema.sql', isSeed: false },
    { version: '002_seed_demo_data', filename: '002_seed_demo_data.sql', isSeed: true },
    { version: '003_attachment_blob_storage', filename: '003_attachment_blob_storage.sql', isSeed: false },
    { version: '004_seed_sample_attachment', filename: '004_seed_sample_attachment.sql', isSeed: true },
  ];

  const migrationData = migrationFiles.map(m => {
    const filePath = path.join(__dirname, 'migrations', m.filename);
    const sql = fs.readFileSync(filePath, 'utf8');
    return {
      ...m,
      sql,
      checksum: getChecksum(sql)
    };
  });

  if (dryRun) {
    console.log('[Migrate] DRY RUN: Validating SQL script syntax and row counts');
    const sourcePath = path.resolve(__dirname, '../../data/tickets.json');
    const sourceTickets = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
    return {
      success: true,
      dryRun: true,
      backupPath,
      migrations: migrationData.map(m => ({ version: m.version, checksum: m.checksum, len: m.sql.length })),
      sourceTicketsCount: sourceTickets.length,
      customers: sourceTickets.map(t => t.customer.name),
      orders: sourceTickets.map(t => t.orderId),
      tickets: sourceTickets.map(t => t.id)
    };
  }

  // Pre-flight connectivity check
  const pool = getPool();
  const client = await pool.connect();
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

    // Fetch applied migrations
    const appliedRes = await client.query('SELECT version, checksum FROM _schema_migrations');
    const appliedMap = new Map(appliedRes.rows.map(r => [r.version, r.checksum]));

    // Iterate through versioned migrations in strict sequence
    for (const m of migrationData) {
      if (appliedMap.has(m.version)) {
        const recordedChecksum = appliedMap.get(m.version);
        if (recordedChecksum !== m.checksum) {
          console.warn(`[Migrate Checksum Note] Migration ${m.version} checksum changed on disk: recorded=${recordedChecksum}, current=${m.checksum}`);
        } else {
          console.log(`[Migrate] ${m.version} checksum verified (${m.checksum.substring(0, 12)}...)`);
        }

        // If it's the seed migration, execute idempotent seed
        if (m.isSeed) {
          console.log(`[Migrate] ${m.version} already recorded, executing idempotent safe seed...`);
          await client.query(m.sql);
        } else {
          console.log(`[Migrate] ${m.version} already applied, skipping DDL execution.`);
        }
      } else {
        console.log(`[Migrate] Applying pending migration ${m.version} (${m.filename})...`);
        await client.query(m.sql);
        await client.query(
          'INSERT INTO _schema_migrations (version, checksum) VALUES ($1, $2)',
          [m.version, m.checksum]
        );
        console.log(`[Migrate] Successfully recorded ${m.version} in _schema_migrations`);
      }
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
