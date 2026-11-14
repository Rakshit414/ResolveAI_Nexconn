// server/scripts/pgDumpShim.js
import fs from 'fs';
import path from 'path';
import pg from 'pg';

const { Pool } = pg;

function isLocalHost(host) {
  if (!host) return false;
  const cleanHost = host.replace(/^\[|\]$/g, '').toLowerCase().trim();
  return cleanHost === 'localhost' || cleanHost === '127.0.0.1' || cleanHost === '::1';
}

function validateLocalHost(host, sourceLabel = 'Host') {
  if (!host || !isLocalHost(host)) {
    console.error(`[pg_dump] Security Error: Remote connection rejected. ${sourceLabel} "${host || 'undefined'}" is not permitted. Only local connections (localhost, 127.0.0.1, ::1) are allowed.`);
    process.exit(1);
  }
}

async function main() {
  const args = process.argv.slice(2);
  let fileIndex = args.indexOf('-f');
  let outputFile = fileIndex !== -1 ? args[fileIndex + 1] : null;
  let connectionUrl = process.env.DATABASE_URL;

  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('postgres://') || args[i].startsWith('postgresql://')) {
      connectionUrl = args[i];
    }
    if ((args[i] === '-h' || args[i] === '--host') && args[i + 1]) {
      validateLocalHost(args[i + 1], 'CLI flag (-h/--host)');
    }
  }

  if (!connectionUrl) {
    console.error('[pg_dump] Error: No DATABASE_URL or connection string provided');
    process.exit(1);
  }
  if (!outputFile) {
    console.error('[pg_dump] Error: Output file (-f) required');
    process.exit(1);
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(connectionUrl);
  } catch (err) {
    console.error('[pg_dump] Error: Invalid DATABASE_URL or connection string:', err.message);
    process.exit(1);
  }

  // Strictly permit only localhost, 127.0.0.1 or ::1
  validateLocalHost(parsedUrl.hostname, 'DATABASE_URL host');

  const pool = new Pool({
    connectionString: connectionUrl,
    ssl: false
  });

  const client = await pool.connect();
  try {
    const tablesRes = await client.query(`
      SELECT tablename FROM pg_catalog.pg_tables
      WHERE schemaname = 'public' AND tablename != '_schema_migrations'
      ORDER BY tablename ASC
    `);

    const tableNames = ['_schema_migrations', ...tablesRes.rows.map(r => r.tablename)];
    let dump = `-- PostgreSQL database dump (pg_dump custom archive emulation)\n`;
    dump += `-- Archive created by pg_dump version 16.15\n`;
    dump += `SET statement_timeout = 0;\nSET lock_timeout = 0;\nSET client_encoding = 'UTF8';\n\n`;

    for (const table of tableNames) {
      const exists = await client.query(`SELECT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = $1)`, [table]);
      if (!exists.rows[0].exists) continue;

      const rowsRes = await client.query(`SELECT * FROM "${table}"`);
      dump += `--\n-- Data for Name: ${table}; Type: TABLE DATA; Schema: public; Owner: postgres\n--\n\n`;
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
              if (Buffer.isBuffer(v)) return `decode('${v.toString('hex')}', 'hex')`;
              return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
            }
            return `'${String(v).replace(/'/g, "''")}'`;
          });
          dump += `INSERT INTO "${table}" ("${columns.join('", "')}") VALUES (${values.join(', ')}) ON CONFLICT DO NOTHING;\n`;
        }
      }
      dump += `\n`;
    }

    const parentDir = path.dirname(path.resolve(outputFile));
    if (!fs.existsSync(parentDir)) fs.mkdirSync(parentDir, { recursive: true });
    fs.writeFileSync(outputFile, dump, 'utf8');
    process.exit(0);
  } catch (err) {
    console.error('[pg_dump] Dump error:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
