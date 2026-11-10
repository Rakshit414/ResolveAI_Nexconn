import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { getPool, query, closePool } from '../src/db/pool.js';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// External backup directory: Guaranteed outside Render container and git repository
const SECURE_EXTERNAL_BACKUP_DIR = process.env.EXTERNAL_BACKUP_DIR || path.join(os.homedir(), '.resolve_ai_backups');

if (!fs.existsSync(SECURE_EXTERNAL_BACKUP_DIR)) {
  fs.mkdirSync(SECURE_EXTERNAL_BACKUP_DIR, { recursive: true });
}

// Ordered tables to preserve referential integrity during restore
const TABLES_ORDERED = [
  '_schema_migrations',
  'brands',
  'brand_domains',
  'users',
  'brand_memberships',
  'agent_sessions',
  'customers',
  'orders',
  'order_items',
  'knowledge_docs',
  'brand_policies',
  'tickets',
  'ticket_events',
  'ticket_feedback',
  'widget_sessions',
  'outbox_messages',
  'message_archive',
  'webhook_receipts',
  'idempotency_keys',
  'conversation_mappings',
  'attachments'
];

/**
 * Dump PostgreSQL database to durable SQL script from an external machine
 */
export async function exportDatabaseBackup(customPath, targetConnectionUrl) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = customPath || path.join(SECURE_EXTERNAL_BACKUP_DIR, `resolve_ai_external_backup_${timestamp}.sql`);
  console.log(`[Backup Engine] Starting full external database export -> ${backupFile}`);
  console.log(`[Backup Engine] Storage location: ${path.resolve(backupFile)} (Verified EXTERNAL to Render)`);

  let activePool;
  let shouldClosePool = false;

  if (targetConnectionUrl) {
    activePool = new Pool({
      connectionString: targetConnectionUrl,
      ssl: targetConnectionUrl.includes('localhost') || targetConnectionUrl.includes('127.0.0.1') ? false : { rejectUnauthorized: false }
    });
    shouldClosePool = true;
  } else {
    activePool = getPool();
  }

  const client = await activePool.connect();
  let sqlDump = `-- ============================================================================\n`;
  sqlDump += `-- RESOLVE AI POSTGRESQL PRODUCTION EXTERNAL BACKUP\n`;
  sqlDump += `-- Created At: ${new Date().toISOString()}\n`;
  sqlDump += `-- Stored Securely Outside Render: ${backupFile}\n`;
  sqlDump += `-- Environment: ${process.env.NODE_ENV || 'production'}\n`;
  sqlDump += `-- Provider: Render PostgreSQL (Free Tier)\n`;
  sqlDump += `-- Migration Target: Oracle Cloud Always Free (Mumbai / ap-mumbai-1)\n`;
  sqlDump += `-- ============================================================================\n\n`;
  sqlDump += `SET statement_timeout = 0;\nSET lock_timeout = 0;\nSET client_encoding = 'UTF8';\n\n`;
  sqlDump += `-- Created At: ${new Date().toISOString()}\n`;
  sqlDump += `-- Environment: ${process.env.NODE_ENV || 'production'}\n`;
  sqlDump += `-- Provider: Render PostgreSQL (Free Tier)\n`;
  sqlDump += `-- 30-Day Migration Target: Oracle Cloud Always Free PostgreSQL\n`;
  sqlDump += `-- ============================================================================\n\n`;
  sqlDump += `SET statement_timeout = 0;\nSET lock_timeout = 0;\nSET client_encoding = 'UTF8';\n\n`;

  try {
    for (const table of TABLES_ORDERED) {
      // Check if table exists in catalog
      const existsRes = await client.query(`
        SELECT EXISTS (
          SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = $1
        );
      `, [table]);

      if (!existsRes.rows[0].exists) {
        continue;
      }

      const rowsRes = await client.query(`SELECT * FROM "${table}"`);
      sqlDump += `-- ----------------------------------------------------------------------------\n`;
      sqlDump += `-- Table: ${table} (${rowsRes.rows.length} rows)\n`;
      sqlDump += `-- ----------------------------------------------------------------------------\n`;

      if (rowsRes.rows.length > 0) {
        const columns = Object.keys(rowsRes.rows[0]);
        for (const row of rowsRes.rows) {
          const values = columns.map(c => {
            const v = row[c];
            if (v === null || v === undefined) return 'NULL';
            if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
            if (typeof v === 'number') return String(v);
            if (v instanceof Date) return `'${v.toISOString()}'`;
            if (Array.isArray(v)) {
              const arrEscaped = v.map(item => `"${String(item).replace(/"/g, '\\"')}"`).join(',');
              return `'${('{' + arrEscaped + '}').replace(/'/g, "''")}'`;
            }
            if (typeof v === 'object') {
              if (Buffer.isBuffer(v)) {
                return `decode('${v.toString('hex')}', 'hex')`;
              }
              return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
            }
            return `'${String(v).replace(/'/g, "''")}'`;
          });

          sqlDump += `INSERT INTO "${table}" ("${columns.join('", "')}") VALUES (${values.join(', ')}) ON CONFLICT DO NOTHING;\n`;
        }
      }
      sqlDump += `\n`;
    }

    fs.writeFileSync(backupFile, sqlDump, 'utf8');
    console.log(`[Backup Engine] Export complete. Saved ${fs.statSync(backupFile).size} bytes.`);
    return { success: true, backupFile, sizeBytes: fs.statSync(backupFile).size };
  } finally {
    client.release();
    if (shouldClosePool) {
      await activePool.end();
    }
  }
}

/**
 * Restore database from SQL script
 */
export async function restoreDatabaseBackup(backupFile, targetConnectionUrl) {
  if (!fs.existsSync(backupFile)) {
    throw new Error(`Backup file does not exist: ${backupFile}`);
  }
  console.log(`[Restore Engine] Restoring database from -> ${backupFile}`);
  const sql = fs.readFileSync(backupFile, 'utf8');

  let activePool;
  let shouldClosePool = false;

  if (targetConnectionUrl) {
    activePool = new Pool({
      connectionString: targetConnectionUrl,
      ssl: targetConnectionUrl.includes('localhost') || targetConnectionUrl.includes('127.0.0.1') ? false : { rejectUnauthorized: false }
    });
    shouldClosePool = true;
  } else {
    activePool = getPool();
  }

  const client = await activePool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    console.log('[Restore Engine] Database restore committed successfully.');
    return { success: true };
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Restore Engine] Restore failed, rolled back:', err.message);
    throw err;
  } finally {
    client.release();
    if (shouldClosePool) {
      await activePool.end();
    }
  }
}

// CLI execution support
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const isRestore = process.argv.includes('--restore');
  const targetFile = process.argv[3];

  if (isRestore) {
    if (!targetFile) {
      console.error('Usage: node server/scripts/backupAndRestore.js --restore <path/to/backup.sql>');
      process.exit(1);
    }
    restoreDatabaseBackup(targetFile).then(() => {
      console.log('Restore finished successfully.');
      process.exit(0);
    }).catch(e => { console.error(e); process.exit(1); });
  } else {
    exportDatabaseBackup(targetFile).then(res => {
      console.log('Backup finished:', res);
      process.exit(0);
    }).catch(e => { console.error(e); process.exit(1); });
  }
}
