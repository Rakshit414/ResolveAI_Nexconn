// server/src/db/seedWorkforce.js
import pg from 'pg';
import { getPool, closePool } from './pool.js';

export function isDirectPostgresClient(clientOrPool) {
  if (!clientOrPool || typeof clientOrPool.query !== 'function') {
    return false;
  }

  // 1. Native pg class instances
  if (pg?.Client && clientOrPool instanceof pg.Client) {
    return true;
  }
  if (pg?.Pool && clientOrPool instanceof pg.Pool) {
    return false;
  }

  // 2. Explicit caller hints
  if (clientOrPool.isDirectClient === true) {
    return true;
  }
  if (clientOrPool.isPool === true) {
    return false;
  }

  // 3. Pool structural signatures (pg-pool exposes pool counters and client array)
  if (
    typeof clientOrPool.totalCount === 'number' ||
    typeof clientOrPool.idleCount === 'number' ||
    typeof clientOrPool.waitingCount === 'number' ||
    Array.isArray(clientOrPool._clients)
  ) {
    return false;
  }

  // 4. Client structural signatures (native pg.Client properties and methods)
  if (
    typeof clientOrPool.escapeLiteral === 'function' ||
    typeof clientOrPool.escapeIdentifier === 'function' ||
    clientOrPool.connectionParameters !== undefined ||
    typeof clientOrPool._queryable === 'boolean'
  ) {
    return true;
  }

  // 5. Duck-typing for mocks: if it lacks connect(), it must be a direct client
  if (typeof clientOrPool.connect !== 'function') {
    return true;
  }

  // Fallback: has connect() and no client signatures -> treat as Pool
  return false;
}

export function sanitizeDiagnosticText(text) {
  if (typeof text !== 'string') return text;
  return text
    .replace(/(postgres(?:ql)?:\/\/[^:]+:)([^@]+)(@)/gi, '$1***$3')
    .replace(/\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}/g, '[REDACTED_HASH]');
}

export function isValidBcryptHash(hash) {
  return typeof hash === 'string' && /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(hash);
}

export function getAgentPasswordHash(userId, fallbackHash = null, isProduction = (process.env.NODE_ENV === 'production')) {
  const envMap = {
    'user_sarah_lin': process.env.AGENT_SARAH_PASSWORD_HASH,
    'user_carlos': process.env.AGENT_CARLOS_PASSWORD_HASH,
    'user_elena': process.env.AGENT_ELENA_PASSWORD_HASH,
  };

  const envHash = envMap[userId];
  if (envHash) {
    if (!isValidBcryptHash(envHash)) {
      throw new Error(`[seedWorkforce] Invalid bcrypt hash format provided for ${userId}`);
    }
    return envHash;
  }

  // In production, missing environment variables must fail explicitly
  if (isProduction) {
    throw new Error(`[seedWorkforce] Missing required environment variable for ${userId}. Password hashes must be explicitly supplied in production.`);
  }

  // In non-production test/development environments only, permit valid fallback
  if (fallbackHash && isValidBcryptHash(fallbackHash)) {
    return fallbackHash;
  }

  throw new Error(`[seedWorkforce] Missing valid password hash for ${userId}`);
}

/**
 * Resolves and validates password hashes for all demo agents before any database operations.
 * - Validates format of each hash using isValidBcryptHash.
 * - In production, rejects if any hash is missing or invalid.
 * - In production (or when individual hashes are supplied), rejects if any two hashes are identical.
 * - Preserves development fallback when environment variables are not supplied in non-production.
 * - Never prints or logs credential values or hashes.
 */
export function resolveAndValidateWorkforceHashes(isProduction = (process.env.NODE_ENV === 'production')) {
  const resolvedHashes = {};
  let anyUsedFallback = false;

  const envMap = {
    'user_sarah_lin': process.env.AGENT_SARAH_PASSWORD_HASH,
    'user_carlos': process.env.AGENT_CARLOS_PASSWORD_HASH,
    'user_elena': process.env.AGENT_ELENA_PASSWORD_HASH,
  };

  for (const agent of DEMO_AGENTS) {
    if (!envMap[agent.userId] && !isProduction) {
      anyUsedFallback = true;
    }

    const fallback = isProduction ? null : agent.passwordHash;
    const hash = getAgentPasswordHash(agent.userId, fallback, isProduction);
    if (!hash || !isValidBcryptHash(hash)) {
      throw new Error(`[seedWorkforce] Missing or invalid bcrypt hash for ${agent.userId}`);
    }
    resolvedHashes[agent.userId] = hash;
  }

  // Reject provisioning if any two hashes are identical (in production or when individual hashes are supplied)
  if (isProduction || !anyUsedFallback) {
    const hashList = Object.values(resolvedHashes);
    const uniqueHashes = new Set(hashList);
    if (uniqueHashes.size !== hashList.length) {
      throw new Error('[seedWorkforce] Duplicate password hashes detected. All three demo agents must have distinct credentials in production.');
    }
  }

  return resolvedHashes;
}

export const DEMO_AGENTS = [
  {
    userId: 'user_sarah_lin',
    nexconnUserId: 'agent_sarah',
    email: 'sarah.lin@novacart.com',
    name: 'Sarah Lin',
    role: 'support_lead',
    configuredStatus: 'Offline',
    primaryLanguage: 'en-US',
    supportedLanguages: ['en-US', 'hi-IN', 'mr-IN', 'es-ES'],
    skills: ['general_inquiry', 'returns', 'logistics', 'damages'],
    maxConcurrentTickets: 3,
    avatarUrl: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=150&q=80',
    passwordHash: '$2b$10$aX/P2ZbWKxWVNqUzSYZcq.MRg4nQLiV8hHS6faZE0nOeZHu8u73oe'
  },
  {
    userId: 'user_carlos',
    nexconnUserId: 'agent_carlos',
    email: 'carlos.gomez@novacart.com',
    name: 'Carlos Gomez',
    role: 'agent',
    configuredStatus: 'Offline',
    primaryLanguage: 'es-ES',
    supportedLanguages: ['es-ES', 'en-US', 'pt-BR'],
    skills: ['returns', 'billing', 'logistics'],
    maxConcurrentTickets: 3,
    avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=150&q=80',
    passwordHash: '$2b$10$aX/P2ZbWKxWVNqUzSYZcq.MRg4nQLiV8hHS6faZE0nOeZHu8u73oe'
  },
  {
    userId: 'user_elena',
    nexconnUserId: 'agent_elena',
    email: 'elena.rodriguez@novacart.com',
    name: 'Elena Rodriguez',
    role: 'agent',
    configuredStatus: 'Offline',
    primaryLanguage: 'en-US',
    supportedLanguages: ['en-US', 'de-DE', 'fr-FR'],
    skills: ['general_inquiry', 'damages', 'escalations'],
    maxConcurrentTickets: 3,
    avatarUrl: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=150&q=80',
    passwordHash: '$2b$10$aX/P2ZbWKxWVNqUzSYZcq.MRg4nQLiV8hHS6faZE0nOeZHu8u73oe'
  }
];

/**
 * Idempotently and transactionally seeds the demo multi-agent workforce.
 * Updates password hashes on existing users when valid hashes are supplied.
 * Never leaves partially provisioned agents if any step fails.
 */
export async function seedDemoWorkforce(clientOrPool = null, brandId = 'brand_novacart') {
  // 1. Resolve and validate all three credentials before executing queries or acquiring connections
  const resolvedHashes = resolveAndValidateWorkforceHashes();

  const pool = clientOrPool || getPool();
  if (!pool) return;

  const isDirectClient = isDirectPostgresClient(clientOrPool);
  const shouldManageTx = !isDirectClient;
  let client = null;
  let txError = null;

  try {
    client = isDirectClient ? clientOrPool : await pool.connect();

    if (shouldManageTx) await client.query('BEGIN');

    for (const agent of DEMO_AGENTS) {
      const resolvedHash = resolvedHashes[agent.userId];

      // 1. Idempotently upsert user, ensuring password_hash is updated if changed
      await client.query(`
        INSERT INTO users (id, email, password_hash, name, avatar_url)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (id) DO UPDATE SET
          password_hash = EXCLUDED.password_hash,
          name = EXCLUDED.name,
          avatar_url = EXCLUDED.avatar_url,
          email = EXCLUDED.email
      `, [agent.userId, agent.email, resolvedHash, agent.name, agent.avatarUrl]);

      // 2. Idempotently upsert brand membership with authorized role
      const memId = `mem_${agent.userId.replace('user_', '')}_novacart`;
      await client.query(`
        INSERT INTO brand_memberships (id, brand_id, user_id, role)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (brand_id, user_id) DO UPDATE SET
          role = EXCLUDED.role,
          deactivated_at = NULL
      `, [memId, brandId, agent.userId, agent.role]);

      // 3. Idempotently upsert agent profile
      const countRes = await client.query(`
        SELECT COUNT(*)::INTEGER AS cnt
        FROM tickets
        WHERE brand_id = $1 AND assigned_agent_id = $2 AND status IN ('Human Agent Active', 'Human Requested')
      `, [brandId, agent.userId]);
      const activeCount = countRes.rows[0]?.cnt || 0;

      await client.query(`
        INSERT INTO agent_profiles (
          brand_id, user_id, nexconn_user_id, display_name, avatar_url,
          configured_status, status_reason, primary_language, supported_languages,
          skills, max_concurrent_tickets, active_ticket_count, last_heartbeat_at
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6, 'Initial workforce provisioning', $7, $8,
          $9, $10, $11,
          NULL
        )
        ON CONFLICT (brand_id, user_id) DO UPDATE SET
          nexconn_user_id = EXCLUDED.nexconn_user_id,
          display_name = EXCLUDED.display_name,
          avatar_url = EXCLUDED.avatar_url,
          primary_language = EXCLUDED.primary_language,
          supported_languages = EXCLUDED.supported_languages,
          skills = EXCLUDED.skills,
          max_concurrent_tickets = EXCLUDED.max_concurrent_tickets,
          active_ticket_count = EXCLUDED.active_ticket_count
      `, [
        brandId,
        agent.userId,
        agent.nexconnUserId,
        agent.name,
        agent.avatarUrl,
        agent.configuredStatus || 'Offline',
        agent.primaryLanguage,
        agent.supportedLanguages,
        agent.skills,
        agent.maxConcurrentTickets,
        activeCount
      ]);
    }

    if (shouldManageTx) await client.query('COMMIT');
    console.log(`[seedDemoWorkforce] Verified ${DEMO_AGENTS.length} agents seeded transactionally for brand: ${brandId}`);
  } catch (err) {
    txError = err;
    if (client && shouldManageTx) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        // Rollback failure must not hide or replace the original transaction error
      }
    }
    throw err;
  } finally {
    if (client && shouldManageTx && typeof client.release === 'function') {
      if (txError) {
        client.release(txError);
      } else {
        client.release();
      }
    }
  }
}

export async function runWorkforceSeedCli(clientOrPool = null) {
  let exitCode = 0;
  try {
    await seedDemoWorkforce(clientOrPool);
    console.log('[CLI] Demo workforce seeded successfully.');
  } catch (err) {
    exitCode = 1;
    process.exitCode = 1;
    const sanitizedMsg = sanitizeDiagnosticText(err?.message || String(err));
    const sanitizedStack = sanitizeDiagnosticText(err?.stack || '');
    console.error('[CLI] Demo workforce seeding failed:', sanitizedMsg);
    if (sanitizedStack) {
      console.error(sanitizedStack);
    }
  } finally {
    try {
      await closePool();
    } catch (closeErr) {
      exitCode = 1;
      process.exitCode = 1;
      const sanitizedCloseMsg = sanitizeDiagnosticText(closeErr?.message || String(closeErr));
      console.error('[CLI] Error closing connection pool:', sanitizedCloseMsg);
    }
  }
  return exitCode;
}

export default {
  isValidBcryptHash,
  getAgentPasswordHash,
  resolveAndValidateWorkforceHashes,
  DEMO_AGENTS,
  seedDemoWorkforce,
  isDirectPostgresClient,
  sanitizeDiagnosticText,
  runWorkforceSeedCli
};

if (process.argv[1] && (process.argv[1].endsWith('seedWorkforce.js') || process.argv[1].endsWith('seedWorkforce.mjs'))) {
  runWorkforceSeedCli();
}
