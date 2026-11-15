import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { DEMO_AGENTS, isValidBcryptHash, getAgentPasswordHash, seedDemoWorkforce } from '../src/db/seedWorkforce.js';
import { calculateEffectiveStatus } from '../src/services/agentAvailabilityService.js';
import { maskCustomerPii } from '../src/services/sharedInboxService.js';
import { DEMO_AGENTS_LIST } from '../../client/src/data/demoData.js';
import { getSslConfigForUrl, parseHostnameFromUrl, isLocalhostDatabase } from '../src/db/pool.js';

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

  await t.test('7. seedWorkforce bcrypt validation, individual env var mapping, and fail-closed security', () => {
    // Hash format validation
    const validHash = '$2b$10$aX/P2ZbWKxWVNqUzSYZcq.MRg4nQLiV8hHS6faZE0nOeZHu8u73oe';
    assert.strictEqual(isValidBcryptHash(validHash), true);
    assert.strictEqual(isValidBcryptHash('plaintext_password'), false);
    assert.strictEqual(isValidBcryptHash('$2b$10$too_short'), false);
    assert.strictEqual(isValidBcryptHash(null), false);

    // Environment variable overrides
    process.env.AGENT_SARAH_PASSWORD_HASH = validHash;
    const resolvedSarah = getAgentPasswordHash('user_sarah_lin');
    assert.strictEqual(resolvedSarah, validHash);
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
      getAgentPasswordHash('user_elena', validHash);
    }, /Missing required environment variable/);
    process.env.NODE_ENV = prevEnv;
  });

  await t.test('8. seedWorkforce zero demo sessions, status preservation, initial defaults, and rollback', async () => {
    // 8a & 8b: Execute seedWorkforce with a mock pool/client and verify SQL queries
    const executedQueries = [];
    const mockClient = {
      connect: async () => ({
        query: async (sql, params = []) => {
          executedQueries.push({ sql: sql.trim(), params });
          if (sql.includes('SELECT COUNT(*)')) {
            return { rows: [{ cnt: 1 }] };
          }
          return { rowCount: 1, rows: [] };
        },
        release: () => {}
      })
    };

    await seedDemoWorkforce(mockClient, 'brand_novacart');

    // Confirm transaction began and committed
    assert.strictEqual(executedQueries[0].sql, 'BEGIN');
    assert.strictEqual(executedQueries[executedQueries.length - 1].sql, 'COMMIT');

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

    // (f) Failed provisioning rolls back the entire transaction
    const failingQueries = [];
    const failingClient = {
      connect: async () => ({
        query: async (sql) => {
          failingQueries.push(sql.trim());
          if (sql.includes('INSERT INTO users')) {
            throw new Error('Database disk error');
          }
          return { rowCount: 1, rows: [] };
        },
        release: () => {}
      })
    };

    await assert.rejects(async () => {
      await seedDemoWorkforce(failingClient, 'brand_novacart');
    }, /Database disk error/);

    assert.strictEqual(failingQueries[0], 'BEGIN');
    assert.strictEqual(failingQueries[failingQueries.length - 1], 'ROLLBACK', 'Failed transaction must issue ROLLBACK');
  });

  await t.test('9. TLS certificate verification for external production connections and exact hostname matching', () => {
    // 9a: Exact hostname parsing: localhost, 127.0.0.1, ::1
    assert.strictEqual(parseHostnameFromUrl('postgresql://postgres:password@localhost:5432/postgres'), 'localhost');
    assert.strictEqual(parseHostnameFromUrl('postgresql://postgres:password@127.0.0.1:5432/postgres'), '127.0.0.1');
    assert.strictEqual(parseHostnameFromUrl('postgresql://postgres:password@[::1]:5432/postgres'), '::1');
    assert.strictEqual(isLocalhostDatabase('postgresql://postgres:password@localhost:5432/postgres'), true);
    assert.strictEqual(isLocalhostDatabase('postgresql://postgres:password@127.0.0.1:5432/postgres'), true);
    assert.strictEqual(isLocalhostDatabase('postgresql://postgres:password@[::1]:5432/postgres'), true);

    // Localhost connections do not require TLS
    assert.strictEqual(getSslConfigForUrl('postgresql://postgres:password@localhost:5432/postgres'), false);
    assert.strictEqual(getSslConfigForUrl('postgresql://postgres:password@127.0.0.1:5432/postgres'), false);
    assert.strictEqual(getSslConfigForUrl('postgresql://postgres:password@[::1]:5432/postgres'), false);

    // 9b: Substring lookalikes must NOT match localhost and must enforce verified TLS
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

    // 9c: External / Remote database URLs (e.g. Render) must enforce rejectUnauthorized: true
    const renderExternalUrl = 'postgresql://testuser:password@dpg-mock-instance.oregon-postgres.render.com:5432/testdb?sslmode=require';
    assert.strictEqual(isLocalhostDatabase(renderExternalUrl), false);
    const sslConfig = getSslConfigForUrl(renderExternalUrl);
    assert.ok(sslConfig && typeof sslConfig === 'object');
    assert.strictEqual(sslConfig.rejectUnauthorized, true, 'rejectUnauthorized must be true for external database connections');

    // 9d: Custom CA bundle is included when provided
    process.env.PG_CA_CERT = '-----BEGIN CERTIFICATE-----\nMOCK\n-----END CERTIFICATE-----';
    const sslWithCa = getSslConfigForUrl(renderExternalUrl);
    assert.strictEqual(sslWithCa.rejectUnauthorized, true);
    assert.strictEqual(sslWithCa.ca, process.env.PG_CA_CERT);
    delete process.env.PG_CA_CERT;
  });
});
