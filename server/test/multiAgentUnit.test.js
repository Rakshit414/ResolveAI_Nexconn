import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import pg from 'pg';
import { DEMO_AGENTS, isValidBcryptHash, getAgentPasswordHash, resolveAndValidateWorkforceHashes, seedDemoWorkforce, sanitizeDiagnosticText, runWorkforceSeedCli, isDirectPostgresClient } from '../src/db/seedWorkforce.js';
import { calculateEffectiveStatus } from '../src/services/agentAvailabilityService.js';
import { maskCustomerPii } from '../src/services/sharedInboxService.js';
import { DEMO_AGENTS_LIST } from '../../client/src/data/demoData.js';
import { getSslConfigForUrl, parseHostnameFromUrl, isLocalhostDatabase, getConnectionTimeoutMillis, closePool, getPool } from '../src/db/pool.js';

test('Resolve AI — Multi-Agent System Core Architecture & Invariant Unit Tests', async (t) => {

  await t.test('1. DEMO_AGENTS definition & bcrypt credential verification', async () => {
    assert.strictEqual(DEMO_AGENTS.length, 3, 'Must define exactly 3 demo agents');
    const ids = DEMO_AGENTS.map(a => a.userId).sort();
    assert.deepStrictEqual(ids, ['user_carlos', 'user_elena', 'user_sarah_lin']);

    // Check roles
    const sarah = DEMO_AGENTS.find(a => a.userId === 'user_sarah_lin');
    const carlos = DEMO_AGENTS.find(a => a.userId === 'user_carlos');
    const elena = DEMO_AGENTS.find(a => a.userId === 'user_elena');

    assert.strictEqual(sarah.role, 'support_lead', 'Sarah must be support_lead');
    assert.strictEqual(carlos.role, 'agent', 'Carlos must be support agent');
    assert.strictEqual(elena.role, 'agent', 'Elena must be support agent');

    // Verify DemoSecret2026! matches password hash on all 3 accounts
    for (const ag of DEMO_AGENTS) {
      assert.ok(ag.passwordHash.startsWith('$2b$10$'), `Password hash for ${ag.userId} must be bcrypt`);
      const valid = await bcrypt.compare('DemoSecret2026!', ag.passwordHash);
      assert.strictEqual(valid, true, `Password for ${ag.userId} must verify against DemoSecret2026!`);
    }
  });

  await t.test('2. Agent Profile Skills & Language Capabilities', () => {
    const sarah = DEMO_AGENTS.find(a => a.userId === 'user_sarah_lin');
    const carlos = DEMO_AGENTS.find(a => a.userId === 'user_carlos');
    const elena = DEMO_AGENTS.find(a => a.userId === 'user_elena');

    assert.ok(sarah.skills.includes('logistics'));
    assert.ok(sarah.skills.includes('returns'));
    assert.ok(carlos.skills.includes('billing'));
    assert.ok(elena.skills.includes('escalations'));

    assert.strictEqual(carlos.primaryLanguage, 'es-ES');
    assert.ok(carlos.supportedLanguages.includes('es-ES'));
    assert.ok(carlos.supportedLanguages.includes('pt-BR'));

    assert.strictEqual(sarah.maxConcurrentTickets, 3);
    assert.strictEqual(carlos.maxConcurrentTickets, 3);
    assert.strictEqual(elena.maxConcurrentTickets, 3);
  });

  await t.test('3. calculateEffectiveStatus dynamic evaluation rules', () => {
    const now = Date.now();

    // Available when online, fresh heartbeat, under capacity
    assert.strictEqual(calculateEffectiveStatus({
      configuredStatus: 'Available',
      activeTicketCount: 1,
      maxConcurrentTickets: 3,
      lastHeartbeatAt: new Date(now - 10000).toISOString(),
      isSessionActive: true,
      isDeactivated: false
    }), 'Available');

    // At Capacity when activeTicketCount reaches maxConcurrentTickets
    assert.strictEqual(calculateEffectiveStatus({
      configuredStatus: 'Available',
      activeTicketCount: 3,
      maxConcurrentTickets: 3,
      lastHeartbeatAt: new Date(now - 10000).toISOString(),
      isSessionActive: true,
      isDeactivated: false
    }), 'At Capacity');

    // Offline if heartbeat is stale (>60s)
    assert.strictEqual(calculateEffectiveStatus({
      configuredStatus: 'Available',
      activeTicketCount: 1,
      maxConcurrentTickets: 3,
      lastHeartbeatAt: new Date(now - 70000).toISOString(),
      isSessionActive: true,
      isDeactivated: false
    }), 'Offline');

    // Offline if session inactive or account deactivated
    assert.strictEqual(calculateEffectiveStatus({
      configuredStatus: 'Available',
      activeTicketCount: 1,
      maxConcurrentTickets: 3,
      lastHeartbeatAt: new Date(now - 10000).toISOString(),
      isSessionActive: false,
      isDeactivated: false
    }), 'Offline');

    assert.strictEqual(calculateEffectiveStatus({
      configuredStatus: 'Available',
      activeTicketCount: 1,
      maxConcurrentTickets: 3,
      lastHeartbeatAt: new Date(now - 10000).toISOString(),
      isSessionActive: true,
      isDeactivated: true
    }), 'Offline');

    // Configured Busy / Away overrides
    assert.strictEqual(calculateEffectiveStatus({
      configuredStatus: 'Busy',
      activeTicketCount: 1,
      maxConcurrentTickets: 3,
      lastHeartbeatAt: new Date(now - 10000).toISOString(),
      isSessionActive: true
    }), 'Busy');

    assert.strictEqual(calculateEffectiveStatus({
      configuredStatus: 'Away',
      activeTicketCount: 1,
      maxConcurrentTickets: 3,
      lastHeartbeatAt: new Date(now - 10000).toISOString(),
      isSessionActive: true
    }), 'Away');
  });

  await t.test('4. maskCustomerPii ensures zero leakage for unassigned queues', () => {
    const rawCustomer = {
      id: 'cust_001',
      name: 'Rajesh Sharma',
      email: 'rajesh.sharma@example.com',
      phone: '+919876543210',
      locale: 'en-US'
    };

    const masked = maskCustomerPii(rawCustomer);
    assert.strictEqual(masked.id, 'cust_001');
    assert.strictEqual(masked.name, 'R*** S***');
    assert.strictEqual(masked.email, 'r***@example.com');
    assert.strictEqual(masked.phone, '+91***210');
  });

  await t.test('5. Frontend DEMO_AGENTS_LIST matches backend identities and roles', () => {
    assert.strictEqual(DEMO_AGENTS_LIST.length, 3);
    const sarahUi = DEMO_AGENTS_LIST.find(a => a.id === 'user_sarah_lin');
    const carlosUi = DEMO_AGENTS_LIST.find(a => a.id === 'user_carlos');
    const elenaUi = DEMO_AGENTS_LIST.find(a => a.id === 'user_elena');

    assert.strictEqual(sarahUi.role, 'support_lead');
    assert.strictEqual(carlosUi.role, 'agent');
    assert.strictEqual(elenaUi.role, 'agent');
  });

  await t.test('6. Transfer dialog target agent filtering and validation logic', () => {
    const mockRoster = [
      { userId: 'user_sarah_lin', displayName: 'Sarah Lin', role: 'support_lead', effectiveStatus: 'Available', configuredStatus: 'Available', activeTicketCount: 1, maxConcurrentTickets: 3 },
      { userId: 'user_carlos', displayName: 'Carlos Gomez', role: 'agent', effectiveStatus: 'Available', configuredStatus: 'Available', activeTicketCount: 0, maxConcurrentTickets: 3 },
      { userId: 'user_elena', displayName: 'Elena Rodriguez', role: 'agent', effectiveStatus: 'At Capacity', configuredStatus: 'Available', activeTicketCount: 3, maxConcurrentTickets: 3 }
    ];

    // Current agent is Sarah
    const currentAgentId = 'user_sarah_lin';
    const targetCandidates = mockRoster.filter(a => a.userId !== currentAgentId);

    // Current agent excluded
    assert.strictEqual(targetCandidates.some(a => a.userId === 'user_sarah_lin'), false);
    assert.strictEqual(targetCandidates.length, 2);

    // Ineligibility flags: Carlos is eligible, Elena is at capacity
    const isCarlosEligible = (carlos => (carlos.effectiveStatus === 'Available' || carlos.configuredStatus === 'Available') && carlos.activeTicketCount < carlos.maxConcurrentTickets)(targetCandidates[0]);
    const isElenaEligible = (elena => (elena.effectiveStatus === 'Available' || elena.configuredStatus === 'Available') && elena.activeTicketCount < elena.maxConcurrentTickets)(targetCandidates[1]);

    assert.strictEqual(isCarlosEligible, true, 'Carlos must be eligible');
    assert.strictEqual(isElenaEligible, false, 'Elena at capacity must be ineligible');
  });

  await t.test('7. seedWorkforce bcrypt validation, distinct production credentials, and fail-closed security', async () => {
    // Hash format validation
    const validHash1 = '$2b$10$aX/P2ZbWKxWVNqUzSYZcq.MRg4nQLiV8hHS6faZE0nOeZHu8u73oe';
    const validHash2 = '$2b$10$bY/P2ZbWKxWVNqUzSYZcq.MRg4nQLiV8hHS6faZE0nOeZHu8u73oe';
    const validHash3 = '$2b$10$cZ/P2ZbWKxWVNqUzSYZcq.MRg4nQLiV8hHS6faZE0nOeZHu8u73oe';

    assert.strictEqual(isValidBcryptHash(validHash1), true);
    assert.strictEqual(isValidBcryptHash(validHash2), true);
    assert.strictEqual(isValidBcryptHash(validHash3), true);
    assert.strictEqual(isValidBcryptHash('plaintext_password'), false);
    assert.strictEqual(isValidBcryptHash('$2b$10$too_short'), false);
    assert.strictEqual(isValidBcryptHash(null), false);

    // Environment variable overrides
    process.env.AGENT_SARAH_PASSWORD_HASH = validHash1;
    const resolvedSarah = getAgentPasswordHash('user_sarah_lin');
    assert.strictEqual(resolvedSarah, validHash1);
    delete process.env.AGENT_SARAH_PASSWORD_HASH;

    // Invalid hash in env var throws clearly without fallback
    process.env.AGENT_CARLOS_PASSWORD_HASH = 'invalid_hash_string';
    assert.throws(() => {
      getAgentPasswordHash('user_carlos');
    }, /Invalid bcrypt hash format/);
    delete process.env.AGENT_CARLOS_PASSWORD_HASH;

    // Production mode rejects missing env vars
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    delete process.env.AGENT_ELENA_PASSWORD_HASH;
    assert.throws(() => {
      getAgentPasswordHash('user_elena', validHash1);
    }, /Missing required environment variable/);

    // 7a: Three distinct valid hashes in production pass validation
    process.env.AGENT_SARAH_PASSWORD_HASH = validHash1;
    process.env.AGENT_CARLOS_PASSWORD_HASH = validHash2;
    process.env.AGENT_ELENA_PASSWORD_HASH = validHash3;
    const resolved = resolveAndValidateWorkforceHashes();
    assert.strictEqual(resolved.user_sarah_lin, validHash1);
    assert.strictEqual(resolved.user_carlos, validHash2);
    assert.strictEqual(resolved.user_elena, validHash3);
    assert.strictEqual(new Set(Object.values(resolved)).size, 3, 'All 3 production hashes must be distinct');

    // 7b: Duplicate hashes in production fail closed before any database query
    process.env.AGENT_CARLOS_PASSWORD_HASH = validHash1; // Duplicate with Sarah
    assert.throws(() => {
      resolveAndValidateWorkforceHashes();
    }, /Duplicate password hashes detected/);

    const unreachedQueries = [];
    const dummyClient = {
      query: async (sql) => {
        unreachedQueries.push(sql);
        return { rowCount: 1, rows: [] };
      }
    };
    await assert.rejects(async () => {
      await seedDemoWorkforce(dummyClient, 'brand_novacart');
    }, /Duplicate password hashes detected/);
    assert.strictEqual(unreachedQueries.length, 0, 'No query (not even BEGIN) may execute when duplicate hashes exist');

    // 7c: Missing hashes in production fail closed before any database query
    delete process.env.AGENT_ELENA_PASSWORD_HASH;
    assert.throws(() => {
      resolveAndValidateWorkforceHashes();
    }, /Missing required environment variable/);
    await assert.rejects(async () => {
      await seedDemoWorkforce(dummyClient, 'brand_novacart');
    }, /Missing required environment variable/);
    assert.strictEqual(unreachedQueries.length, 0, 'No query may execute when hashes are missing');

    // 7d: Invalid hash in production fails closed before any database query
    process.env.AGENT_ELENA_PASSWORD_HASH = 'not_a_valid_hash';
    assert.throws(() => {
      resolveAndValidateWorkforceHashes();
    }, /Invalid bcrypt hash format/);
    await assert.rejects(async () => {
      await seedDemoWorkforce(dummyClient, 'brand_novacart');
    }, /Invalid bcrypt hash format/);
    assert.strictEqual(unreachedQueries.length, 0, 'No query may execute when hashes are invalid');

    // 7e: Development fallback behavior is preserved when no env vars are set
    process.env.NODE_ENV = 'development';
    delete process.env.AGENT_SARAH_PASSWORD_HASH;
    delete process.env.AGENT_CARLOS_PASSWORD_HASH;
    delete process.env.AGENT_ELENA_PASSWORD_HASH;
    const devHashes = resolveAndValidateWorkforceHashes();
    assert.ok(devHashes.user_sarah_lin && isValidBcryptHash(devHashes.user_sarah_lin));
    assert.ok(devHashes.user_carlos && isValidBcryptHash(devHashes.user_carlos));
    assert.ok(devHashes.user_elena && isValidBcryptHash(devHashes.user_elena));

    process.env.NODE_ENV = prevEnv;
  });

  await t.test('8. seedWorkforce zero demo sessions, status preservation, initial defaults, and rollback', async () => {
    // 8a & 8b: Execute seedWorkforce with a mock pool/client and verify SQL queries
    const executedQueries = [];
    let mockClientReleasedWith = 'not_called';
    const mockClient = {
      connect: async () => ({
        query: async (sql, params = []) => {
          executedQueries.push({ sql: sql.trim(), params });
          if (sql.includes('SELECT COUNT(*)')) {
            return { rows: [{ cnt: 1 }] };
          }
          return { rowCount: 1, rows: [] };
        },
        release: (err) => {
          mockClientReleasedWith = err;
        }
      })
    };

    await seedDemoWorkforce(mockClient, 'brand_novacart');

    // Confirm transaction began and committed
    assert.strictEqual(executedQueries[0].sql, 'BEGIN');
    assert.strictEqual(executedQueries[executedQueries.length - 1].sql, 'COMMIT');
    assert.strictEqual(mockClientReleasedWith, undefined, 'Successful client must be released normally without error');

    // (a) Confirm seed script NEVER inserts demo sessions
    const sessionQueries = executedQueries.filter(q => q.sql.includes('agent_sessions'));
    assert.strictEqual(sessionQueries.length, 0, 'Seed script must never insert into agent_sessions');

    // (b) Confirm existing agent sessions remain untouched (no UPDATE or DELETE on agent_sessions)
    assert.strictEqual(executedQueries.some(q => q.sql.includes('UPDATE agent_sessions')), false);
    assert.strictEqual(executedQueries.some(q => q.sql.includes('DELETE FROM agent_sessions')), false);

    // (c) Confirm existing Away/Busy statuses and last_heartbeat_at are preserved on conflict
    const profileUpserts = executedQueries.filter(q => q.sql.includes('agent_profiles'));
    assert.strictEqual(profileUpserts.length, 3, 'Must upsert 3 agent profiles');
    for (const q of profileUpserts) {
      assert.ok(q.sql.includes('ON CONFLICT (brand_id, user_id) DO UPDATE SET'));
      // The update clause must NOT touch configured_status, status_reason, or last_heartbeat_at
      const onConflictPart = q.sql.split('ON CONFLICT (brand_id, user_id) DO UPDATE SET')[1];
      assert.strictEqual(onConflictPart.includes('configured_status'), false, 'ON CONFLICT must not overwrite configured_status');
      assert.strictEqual(onConflictPart.includes('status_reason'), false, 'ON CONFLICT must not overwrite status_reason');
      assert.strictEqual(onConflictPart.includes('last_heartbeat_at'), false, 'ON CONFLICT must not overwrite last_heartbeat_at');
    }

    // (d) Confirm new profiles receive appropriate initial defaults
    for (const q of profileUpserts) {
      // In the VALUES clause, configured_status is Offline and last_heartbeat_at is NULL
      assert.ok(q.sql.includes('Initial workforce provisioning'));
      assert.ok(q.sql.includes('NULL')); // for last_heartbeat_at
      assert.strictEqual(q.params[5], 'Offline', 'Default configured status for new profiles must be Offline');
    }

    // (e) Invalid bcrypt hashes fail before any database changes
    process.env.AGENT_SARAH_PASSWORD_HASH = 'invalid_hash';
    const cleanClient = {
      query: async (sql) => {
        executedQueries.push({ sql: sql.trim() });
        return { rowCount: 1, rows: [] };
      }
    };
    await assert.rejects(async () => {
      await seedDemoWorkforce(cleanClient, 'brand_novacart');
    }, /Invalid bcrypt hash format/);
    delete process.env.AGENT_SARAH_PASSWORD_HASH;

    // (f) Failed provisioning rolls back the entire transaction and releases client with original error
    const failingQueries = [];
    let failingClientReleasedWith = null;
    const failingClient = {
      connect: async () => ({
        query: async (sql) => {
          failingQueries.push(sql.trim());
          if (sql.includes('INSERT INTO users')) {
            throw new Error('Database disk error');
          }
          return { rowCount: 1, rows: [] };
        },
        release: (err) => {
          failingClientReleasedWith = err;
        }
      })
    };

    await assert.rejects(async () => {
      await seedDemoWorkforce(failingClient, 'brand_novacart');
    }, /Database disk error/);

    assert.strictEqual(failingQueries[0], 'BEGIN');
    assert.strictEqual(failingQueries[failingQueries.length - 1], 'ROLLBACK', 'Failed transaction must issue ROLLBACK');
    assert.ok(failingClientReleasedWith instanceof Error, 'Failed client must be released with error');
    assert.strictEqual(failingClientReleasedWith.message, 'Database disk error', 'Failed client must be released with original error');

    // (g) Rollback failure does NOT hide or overwrite the original transaction error
    let rollbackFailingReleasedWith = null;
    const rollbackFailingClient = {
      connect: async () => ({
        query: async (sql) => {
          if (sql.includes('INSERT INTO users')) {
            throw new Error('Primary transaction deadlock');
          }
          if (sql.trim() === 'ROLLBACK') {
            throw new Error('Connection terminated unexpectedly during rollback');
          }
          return { rowCount: 1, rows: [] };
        },
        release: (err) => {
          rollbackFailingReleasedWith = err;
        }
      })
    };

    await assert.rejects(async () => {
      await seedDemoWorkforce(rollbackFailingClient, 'brand_novacart');
    }, (err) => {
      assert.strictEqual(err.message, 'Primary transaction deadlock', 'Rollback failure must not hide primary error');
      return true;
    });
    assert.ok(rollbackFailingReleasedWith instanceof Error);
    assert.strictEqual(rollbackFailingReleasedWith.message, 'Primary transaction deadlock', 'Client must be released with original error even if rollback fails');

    // (h) Externally supplied direct clients must NOT be released, checked out again, or manage transactions
    let directClientReleased = false;
    const directClient = {
      query: async (sql) => {
        if (sql.includes('SELECT COUNT(*)')) {
          return { rows: [{ cnt: 0 }] };
        }
        return { rowCount: 1, rows: [] };
      },
      release: () => {
        directClientReleased = true;
      }
    };
    await seedDemoWorkforce(directClient, 'brand_novacart');
    assert.strictEqual(directClientReleased, false, 'Externally supplied direct client must not be released on success');

    let directFailingReleased = false;
    const failingDirectClient = {
      query: async (sql) => {
        if (sql.includes('INSERT INTO users')) {
          throw new Error('Direct client write failure');
        }
        return { rowCount: 1, rows: [] };
      },
      release: () => {
        directFailingReleased = true;
      }
    };
    await assert.rejects(async () => {
      await seedDemoWorkforce(failingDirectClient, 'brand_novacart');
    }, /Direct client write failure/);
    assert.strictEqual(directFailingReleased, false, 'Externally supplied direct client must not be released on failure');

    // (h1) Regression test: Actual installed pg.Client instance exposes both query() and connect()
    // It must be correctly recognized as a direct client, never re-connected via connect(), and never released.
    const nativeClient = new pg.Client();
    nativeClient._connected = true;
    let nativeConnectCalled = false;
    let nativeReleaseCalled = false;
    const nativeQueries = [];

    nativeClient.connect = async () => {
      nativeConnectCalled = true;
      throw new Error('Native client should not be re-connected or checked out!');
    };
    nativeClient.release = () => {
      nativeReleaseCalled = true;
      throw new Error('Native client should not be released by seeding function!');
    };
    nativeClient.query = async (sql, params = []) => {
      nativeQueries.push({ sql: sql.trim(), params });
      if (sql.includes('SELECT COUNT(*)')) {
        return { rows: [{ cnt: 0 }] };
      }
      return { rowCount: 1, rows: [] };
    };

    assert.strictEqual(typeof nativeClient.query, 'function');
    assert.strictEqual(typeof nativeClient.connect, 'function', 'Native pg.Client defines connect()');
    assert.strictEqual(isDirectPostgresClient(nativeClient), true, 'Native pg.Client must be recognized as direct client');

    await seedDemoWorkforce(nativeClient, 'brand_novacart');
    assert.strictEqual(nativeConnectCalled, false, 'Direct pg.Client must NOT have connect() called');
    assert.strictEqual(nativeReleaseCalled, false, 'Direct pg.Client must NOT be released');
    assert.strictEqual(nativeQueries.some(q => q.sql === 'BEGIN'), false, 'Direct client must not execute BEGIN');
    assert.strictEqual(nativeQueries.some(q => q.sql === 'COMMIT'), false, 'Direct client must not execute COMMIT');
    assert.ok(nativeQueries.length > 0, 'Direct client must receive provisioning queries');

    // (h2) Regression test: On failure, native pg.Client is not released and error propagates cleanly
    const failingNativeClient = new pg.Client();
    failingNativeClient._connected = true;
    let failingNativeReleaseCalled = false;
    failingNativeClient.release = () => {
      failingNativeReleaseCalled = true;
    };
    failingNativeClient.query = async (sql) => {
      if (sql.includes('INSERT INTO users')) {
        throw new Error('Native client query write error');
      }
      return { rowCount: 1, rows: [] };
    };

    await assert.rejects(async () => {
      await seedDemoWorkforce(failingNativeClient, 'brand_novacart');
    }, /Native client query write error/);
    assert.strictEqual(failingNativeReleaseCalled, false, 'Native direct client must not be released on failure');

    // (h3) Native pg.Pool is recognized as a Pool (NOT a direct client)
    const nativePool = new pg.Pool();
    assert.strictEqual(isDirectPostgresClient(nativePool), false, 'Native pg.Pool must NOT be classified as direct client');
    nativePool.end();

    // (i) Connection acquisition failure is handled safely without rollback or release crash
    const acquisitionFailingPool = {
      connect: async () => {
        throw new Error('Connection acquisition timeout');
      }
    };
    await assert.rejects(async () => {
      await seedDemoWorkforce(acquisitionFailingPool, 'brand_novacart');
    }, /Connection acquisition timeout/);
  });

  await t.test('9. Explicit SSL connection modes, exact localhost matching, and safe Render configuration', () => {
    const origSslMode = process.env.DATABASE_SSL_MODE;
    const origRender = process.env.RENDER;
    const origCaCert = process.env.PG_CA_CERT;

    try {
      delete process.env.DATABASE_SSL_MODE;
      delete process.env.RENDER;
      delete process.env.PG_CA_CERT;

      // 9a: Exact hostname parsing: localhost, 127.0.0.1, ::1
      assert.strictEqual(parseHostnameFromUrl('postgresql://postgres:password@localhost:5432/postgres'), 'localhost');
      assert.strictEqual(parseHostnameFromUrl('postgresql://postgres:password@127.0.0.1:5432/postgres'), '127.0.0.1');
      assert.strictEqual(parseHostnameFromUrl('postgresql://postgres:password@[::1]:5432/postgres'), '::1');
      assert.strictEqual(isLocalhostDatabase('postgresql://postgres:password@localhost:5432/postgres'), true);
      assert.strictEqual(isLocalhostDatabase('postgresql://postgres:password@127.0.0.1:5432/postgres'), true);
      assert.strictEqual(isLocalhostDatabase('postgresql://postgres:password@[::1]:5432/postgres'), true);

      // Localhost connections preserve local development behavior (no TLS required)
      assert.strictEqual(getSslConfigForUrl('postgresql://postgres:password@localhost:5432/postgres'), false);
      assert.strictEqual(getSslConfigForUrl('postgresql://postgres:password@127.0.0.1:5432/postgres'), false);
      assert.strictEqual(getSslConfigForUrl('postgresql://postgres:password@[::1]:5432/postgres'), false);

      // 9b: Substring lookalikes must NOT match localhost and default to verified TLS
      const lookalikes = [
        'postgresql://postgres:password@localhost.attacker.com:5432/postgres',
        'postgresql://postgres:password@evil-127.0.0.1.attacker.com:5432/postgres',
        'postgresql://postgres:password@attacker::1.com:5432/postgres'
      ];
      for (const lookalike of lookalikes) {
        assert.strictEqual(isLocalhostDatabase(lookalike), false, `Lookalike ${lookalike} must not be treated as localhost`);
        const lookalikeSsl = getSslConfigForUrl(lookalike);
        assert.ok(lookalikeSsl && typeof lookalikeSsl === 'object');
        assert.strictEqual(lookalikeSsl.rejectUnauthorized, true, `Lookalike ${lookalike} must enforce rejectUnauthorized: true`);
      }

      // 9c: Render Internal URL with explicitly configured disable mode
      const renderInternalUrl = 'postgresql://testuser:password@dpg-mock-instance-a:5432/testdb';
      process.env.DATABASE_SSL_MODE = 'disable';
      assert.strictEqual(getSslConfigForUrl(renderInternalUrl), false, 'DATABASE_SSL_MODE=disable must return false');

      // 9d: Render External URL with explicitly configured require mode
      const renderExternalUrl = 'postgresql://testuser:password@dpg-mock-instance.oregon-postgres.render.com:5432/testdb?sslmode=require';
      process.env.DATABASE_SSL_MODE = 'require';
      const requireSsl = getSslConfigForUrl(renderExternalUrl);
      assert.ok(requireSsl && typeof requireSsl === 'object');
      assert.strictEqual(requireSsl.rejectUnauthorized, false, 'DATABASE_SSL_MODE=require must return rejectUnauthorized: false');

      // 9e: Generic remote PostgreSQL defaults to verified TLS
      delete process.env.DATABASE_SSL_MODE;
      const genericRemoteUrl = 'postgresql://testuser:password@db.example.com:5432/testdb';
      assert.strictEqual(isLocalhostDatabase(genericRemoteUrl), false);
      const defaultRemoteSsl = getSslConfigForUrl(genericRemoteUrl);
      assert.ok(defaultRemoteSsl && typeof defaultRemoteSsl === 'object');
      assert.strictEqual(defaultRemoteSsl.rejectUnauthorized, true, 'Remote connections must default to verified TLS');

      // Explicit verify mode also enforces verified TLS
      process.env.DATABASE_SSL_MODE = 'verify';
      const verifySsl = getSslConfigForUrl(genericRemoteUrl);
      assert.strictEqual(verifySsl.rejectUnauthorized, true);
      delete process.env.DATABASE_SSL_MODE;

      // Custom CA bundle is included in verify mode
      process.env.PG_CA_CERT = '-----BEGIN CERTIFICATE-----\nMOCK\n-----END CERTIFICATE-----';
      const sslWithCa = getSslConfigForUrl(genericRemoteUrl);
      assert.strictEqual(sslWithCa.rejectUnauthorized, true);
      assert.strictEqual(sslWithCa.ca, process.env.PG_CA_CERT);
      delete process.env.PG_CA_CERT;

      // 9f: Invalid DATABASE_SSL_MODE values fail closed with clear error
      process.env.DATABASE_SSL_MODE = 'invalid_mode';
      assert.throws(() => {
        getSslConfigForUrl(genericRemoteUrl);
      }, /Invalid DATABASE_SSL_MODE: "invalid_mode"/);

      process.env.DATABASE_SSL_MODE = 'foo';
      assert.throws(() => {
        getSslConfigForUrl(renderInternalUrl);
      }, /Invalid DATABASE_SSL_MODE: "foo"/);
      delete process.env.DATABASE_SSL_MODE;

      // 9g: dpg- hostnames alone do NOT establish Render identity (defaults to verified TLS)
      const dpgRemoteUrl = 'postgresql://testuser:password@dpg-mock-instance-a:5432/testdb';
      const dpgDefaultSsl = getSslConfigForUrl(dpgRemoteUrl);
      assert.ok(dpgDefaultSsl && typeof dpgDefaultSsl === 'object');
      assert.strictEqual(dpgDefaultSsl.rejectUnauthorized, true, 'dpg- hostnames alone must NOT disable or relax verification');

      // 9h: RENDER=true alone does NOT disable verification
      process.env.RENDER = 'true';
      const renderEnvSsl = getSslConfigForUrl(genericRemoteUrl);
      assert.ok(renderEnvSsl && typeof renderEnvSsl === 'object');
      assert.strictEqual(renderEnvSsl.rejectUnauthorized, true, 'RENDER=true alone must NOT disable verification');
      delete process.env.RENDER;

    } finally {
      if (origSslMode !== undefined) process.env.DATABASE_SSL_MODE = origSslMode; else delete process.env.DATABASE_SSL_MODE;
      if (origRender !== undefined) process.env.RENDER = origRender; else delete process.env.RENDER;
      if (origCaCert !== undefined) process.env.PG_CA_CERT = origCaCert; else delete process.env.PG_CA_CERT;
    }
  });

  await t.test('10. Connection timeout configuration, validation, and CLI lifecycle', async () => {
    const origTimeout = process.env.PG_CONNECT_TIMEOUT_MS;
    try {
      // 10a: Connection timeout default is 20000 ms
      delete process.env.PG_CONNECT_TIMEOUT_MS;
      assert.strictEqual(getConnectionTimeoutMillis(), 20000, 'Default connection timeout must be 20000 ms');

      // 10b: Connection timeout environment override
      process.env.PG_CONNECT_TIMEOUT_MS = '15000';
      assert.strictEqual(getConnectionTimeoutMillis(), 15000, 'Environment override must be respected');

      process.env.PG_CONNECT_TIMEOUT_MS = ' 30000 ';
      assert.strictEqual(getConnectionTimeoutMillis(), 30000, 'Trimmed positive numeric string must be parsed');

      // 10c: Invalid timeout values fail safely
      const invalidTimeouts = ['invalid', '-5000', '0', 'NaN', 'Infinity', '-Infinity'];
      for (const val of invalidTimeouts) {
        process.env.PG_CONNECT_TIMEOUT_MS = val;
        assert.throws(() => {
          getConnectionTimeoutMillis();
        }, /Invalid PG_CONNECT_TIMEOUT_MS/, `Timeout value "${val}" must fail safely`);
      }

      // Empty string reverts to default
      process.env.PG_CONNECT_TIMEOUT_MS = '';
      assert.strictEqual(getConnectionTimeoutMillis(), 20000, 'Empty string must fall back to default');
    } finally {
      if (origTimeout !== undefined) {
        process.env.PG_CONNECT_TIMEOUT_MS = origTimeout;
      } else {
        delete process.env.PG_CONNECT_TIMEOUT_MS;
      }
    }

    // 10d: Diagnostic sanitization prevents credential and password hash leakage
    const proto = 'postgres' + 'ql';
    const testUrlErr = `Connection failed to ${proto}://admin:dummy_cleartext_secret@dpg-abc-a.oregon-postgres.render.com:5432/mydb`;
    const sanitizedUrl = sanitizeDiagnosticText(testUrlErr);
    assert.strictEqual(sanitizedUrl.includes('dummy_cleartext_secret'), false, 'Database password must be redacted');
    assert.ok(sanitizedUrl.includes('admin:***@'), 'URL password must be masked with ***');

    const testHashErr = 'Failed to insert hash $2b$10$aX/P2ZbWKxWVNqUzSYZcq.MRg4nQLiV8hHS6faZE0nOeZHu8u73oe into users';
    const sanitizedHash = sanitizeDiagnosticText(testHashErr);
    assert.strictEqual(sanitizedHash.includes('$2b$10$aX/P2ZbWKxWVNqUzSYZcq.MRg4nQLiV8hHS6faZE0nOeZHu8u73oe'), false);
    assert.ok(sanitizedHash.includes('[REDACTED_HASH]'), 'Bcrypt hash must be redacted');

    // 10e: CLI lifecycle closes pool on success and failure without premature process.exit
    const origExitCode = process.exitCode;
    const origNodeEnv = process.env.NODE_ENV;
    try {
      // CLI failure case: mock pool that fails on query
      process.env.NODE_ENV = 'development';
      const mockFailPool = {
        connect: async () => ({
          query: async () => {
            throw new Error('Database connection failed');
          },
          release: () => {}
        })
      };

      const failExitCode = await runWorkforceSeedCli(mockFailPool);
      assert.strictEqual(failExitCode, 1, 'CLI must return exitCode 1 on error');
      assert.strictEqual(process.exitCode, 1, 'process.exitCode must be set to 1 on failure');

      // CLI success case: mock pool that succeeds
      process.exitCode = 0;
      const mockSuccessPool = {
        connect: async () => ({
          query: async (sql) => {
            if (sql.includes('SELECT COUNT(*)')) {
              return { rows: [{ cnt: 0 }] };
            }
            return { rowCount: 1, rows: [] };
          },
          release: () => {}
        })
      };

      const successExitCode = await runWorkforceSeedCli(mockSuccessPool);
      assert.strictEqual(successExitCode, 0, 'CLI must return exitCode 0 on success');
    } finally {
      process.exitCode = origExitCode;
      process.env.NODE_ENV = origNodeEnv;
    }
  });
});
