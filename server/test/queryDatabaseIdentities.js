import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import EmbeddedPostgres from 'embedded-postgres';
import { runMigration } from '../src/db/migrate.js';
import { closePool } from '../src/db/pool.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');
const PG16_DATA_DIR = path.resolve(ROOT_DIR, 'server/data/pg16_identity_check');
const TEST_PORT = 54329;
const TEST_DB_URL = `postgresql://postgres:postgres@127.0.0.1:${TEST_PORT}/postgres`;

async function main() {
  if (fs.existsSync(PG16_DATA_DIR)) {
    fs.rmSync(PG16_DATA_DIR, { recursive: true, force: true });
  }

  const pgServer = new EmbeddedPostgres({
    port: TEST_PORT,
    databaseDir: PG16_DATA_DIR,
    user: 'postgres',
    password: 'postgres'
  });

  await pgServer.initialise();
  await pgServer.start();

  process.env.DATABASE_URL = TEST_DB_URL;
  await closePool();
  await runMigration({ dryRun: false });

  const { Pool } = pg;
  const pool = new Pool({ connectionString: TEST_DB_URL });

  try {
    console.log('\n=== [ACTUAL POSTGRESQL IDENTITIES QUERY OUTPUT] ===');

    console.log('\n--- 1. BRANDS (Tenant & Support Identity) ---');
    const brandsRes = await pool.query('SELECT id, name, slug, support_identity, allowed_origins FROM brands');
    console.table(brandsRes.rows);

    console.log('\n--- 2. USERS & BRAND MEMBERSHIPS (Agent Identities) ---');
    const membersRes = await pool.query(`
      SELECT bm.id as membership_id, bm.brand_id, bm.user_id, u.name as user_name, u.email, bm.role, bm.deactivated_at
      FROM brand_memberships bm
      JOIN users u ON bm.user_id = u.id
    `);
    console.table(membersRes.rows);

    console.log('\n--- 3. CUSTOMERS (Persona & Nexconn Identities) ---');
    const custRes = await pool.query('SELECT id, brand_id, name, email, nexconn_user_id, is_guest FROM customers ORDER BY id');
    console.table(custRes.rows);

    console.log('\n--- 4. CONVERSATION MAPPINGS (Bridge Between Tickets & DirectChannel) ---');
    const convRes = await pool.query(`
      SELECT id, ticket_id, customer_id, customer_user_id, support_identity, conversation_key 
      FROM conversation_mappings ORDER BY id
    `);
    console.table(convRes.rows);

    console.log('\n=== [JSON FORMAT FOR REPORT EVIDENCE] ===');
    console.log(JSON.stringify({
      brands: brandsRes.rows,
      memberships: membersRes.rows,
      customers: custRes.rows,
      conversations: convRes.rows
    }, null, 2));

  } finally {
    await pool.end();
    await closePool();
    await pgServer.stop();
    fs.rmSync(PG16_DATA_DIR, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
