// server/scripts/pgRestoreShim.js
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
    console.error(`[pg_restore] Security Error: Remote connection rejected. ${sourceLabel} "${host || 'undefined'}" is not permitted. Only local connections (localhost, 127.0.0.1, ::1) are allowed.`);
    process.exit(1);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const isList = args.includes('--list') || args.includes('-l');

  let targetFile = null;
  let targetDb = 'postgres';
  let host = '127.0.0.1';
  let port = '5432';
  let user = 'postgres';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-d' && args[i + 1]) targetDb = args[i + 1];
    if (args[i] === '-h' && args[i + 1]) host = args[i + 1];
    if (args[i] === '-p' && args[i + 1]) port = args[i + 1];
    if (args[i] === '-U' && args[i + 1]) user = args[i + 1];
    if (args[i].startsWith('postgres://') || args[i].startsWith('postgresql://')) {
      try {
        const u = new URL(args[i]);
        validateLocalHost(u.hostname, 'Connection string argument host');
      } catch (err) {
        console.error('[pg_restore] Error: Invalid connection string argument:', err.message);
        process.exit(1);
      }
    }
    if (!args[i].startsWith('-') && fs.existsSync(args[i])) {
      targetFile = args[i];
    }
  }

  // Also check if last argument is the backup file
  if (!targetFile && args.length > 0 && fs.existsSync(args[args.length - 1])) {
    targetFile = args[args.length - 1];
  }

  if (!targetFile) {
    console.error('[pg_restore] Error: Archive file not found in arguments');
    process.exit(1);
  }

  const content = fs.readFileSync(targetFile, 'utf8');

  if (isList) {
    console.log(';\n; Archive created by pg_dump version 16.15\n;');
    const lines = content.split('\n');
    let entryId = 1;
    for (const line of lines) {
      const match = line.match(/^-- Data for Name:\s+(\w+);\s+Type:\s+TABLE DATA;\s+Schema:\s+public;\s+Owner:\s+(\w+)/);
      if (match) {
        console.log(`${entryId++}; 0 16384 TABLE DATA public ${match[1]} ${match[2]}`);
      }
    }
    process.exit(0);
  }

  // Reject remote connections before attempting database access
  validateLocalHost(host, 'CLI host flag (-h)');

  // Validate DATABASE_URL if present
  let connUrl;
  if (process.env.DATABASE_URL) {
    try {
      const u = new URL(process.env.DATABASE_URL);
      validateLocalHost(u.hostname, 'DATABASE_URL host');
    } catch (err) {
      console.error('[pg_restore] Error: Invalid DATABASE_URL:', err.message);
      process.exit(1);
    }
    connUrl = process.env.DATABASE_URL;
  } else {
    connUrl = `postgresql://${user}:password@${host}:${port}/${targetDb}?sslmode=disable`;
  }

  const pool = new Pool({
    connectionString: connUrl,
    ssl: false
  });

  // Clean SQL of any non-SQL header lines before execution
  const executableSql = content
    .split('\n')
    .filter(line => !line.trim().startsWith(';'))
    .join('\n');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(executableSql);
    await client.query('COMMIT');
    console.log(`[pg_restore] Successfully restored archive into ${targetDb}`);
    process.exit(0);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[pg_restore] Restore failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
