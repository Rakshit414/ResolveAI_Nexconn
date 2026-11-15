import pg from 'pg';
import dotenv from 'dotenv';
import { createRequire } from 'module';

dotenv.config();

const require = createRequire(import.meta.url);
const { Pool } = pg;
const { parse: parseConnectionString } = require('pg-connection-string');

let pool = null;
let inMemoryDb = null;

export function parseHostnameFromUrl(databaseUrl) {
  if (!databaseUrl || typeof databaseUrl !== 'string') return null;
  try {
    const parsed = new URL(databaseUrl);
    return parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  } catch {
    try {
      const parsed = parseConnectionString(databaseUrl);
      return (parsed.host || '').replace(/^\[|\]$/g, '').toLowerCase() || null;
    } catch {
      const match = databaseUrl.match(/@([^/?#:]+)/);
      if (match && match[1]) {
        return match[1].replace(/^\[|\]$/g, '').toLowerCase();
      }
      return null;
    }
  }
}

export function isLocalhostDatabase(databaseUrl) {
  const hostname = parseHostnameFromUrl(databaseUrl);
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

export function getSslConfigForUrl(databaseUrl) {
  if (!databaseUrl) return false;
  if (isLocalhostDatabase(databaseUrl)) return false;

  const caCert = process.env.PG_CA_CERT || process.env.DATABASE_CA_CERT;
  return {
    rejectUnauthorized: true,
    ...(caCert ? { ca: caCert } : {})
  };
}

export function getPool() {
  if (pool) return pool;

  const databaseUrl = process.env.DATABASE_URL;

  if (databaseUrl) {
    // Dedicated PostgreSQL Pool with verified TLS for remote hosts
    const sslConfig = getSslConfigForUrl(databaseUrl);

    let poolConfig = {
      ssl: sslConfig,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    };

    try {
      const parsedConfig = parseConnectionString(databaseUrl);
      delete parsedConfig.ssl;
      poolConfig = {
        ...parsedConfig,
        ...poolConfig,
      };
    } catch {
      poolConfig.connectionString = databaseUrl;
    }

    pool = new Pool(poolConfig);

    pool.on('error', (err) => {
      console.error('[DB Pool] Unexpected error on idle client:', err.message);
    });

    return pool;
  }

  // Fail-closed in production if DATABASE_URL is missing
  if (process.env.NODE_ENV === 'production') {
    throw new Error('[DB Pool Fatal Error] DATABASE_URL is missing in production environment. Fallback to in-memory/JSON storage is strictly prohibited.');
  }

  // Development / Test in-memory PostgreSQL emulator
  try {
    const { newDb } = require('pg-mem');
    inMemoryDb = newDb();
    
    // Bind now() function
    inMemoryDb.public.registerFunction({
      name: 'now',
      implementation: () => new Date(),
    });

    const pgAdapter = inMemoryDb.adapters.createPg();
    pool = new pgAdapter.Pool();
    console.log('[DB Pool] Initialized local PostgreSQL engine (in-memory mode)');
    return pool;
  } catch (err) {
    console.warn('[DB Pool] pg-mem initialization warning:', err.message);
    pool = new Pool();
    return pool;
  }
}

export async function query(text, params) {
  const p = getPool();
  return p.query(text, params);
}

export async function healthCheck() {
  if (process.env.NODE_ENV === 'production' && !process.env.DATABASE_URL) {
    return {
      healthy: false,
      mode: 'unconfigured',
      error: 'DATABASE_URL is missing in production environment. In-memory or JSON storage fallback is strictly prohibited.'
    };
  }
  try {
    const p = getPool();
    const res = await p.query('SELECT 1 as healthy');
    return { healthy: res.rows?.[0]?.healthy === 1 || res.rows?.[0]?.healthy === '1', mode: process.env.DATABASE_URL ? 'postgresql' : 'in-memory' };
  } catch (err) {
    return { healthy: false, mode: process.env.DATABASE_URL ? 'postgresql' : 'in-memory', error: err.message };
  }
}

export async function closePool() {
  if (pool && typeof pool.end === 'function') {
    await pool.end();
    pool = null;
  }
}

export default {
  parseHostnameFromUrl,
  isLocalhostDatabase,
  getSslConfigForUrl,
  getPool,
  query,
  healthCheck,
  closePool
};
