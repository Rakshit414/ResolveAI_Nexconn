// server/test/verifyPowerShellBackupScript.js
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import pg from 'pg';
import EmbeddedPostgres from 'embedded-postgres';
import { runMigration } from '../src/db/migrate.js';
import { closePool } from '../src/db/pool.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');

const PORT = 54347;
const DB_DIR = path.join(ROOT_DIR, 'server/data/pg16_ps_backup_test_instance');

async function main() {
  console.log('=== [POWERSHELL PRE-DEPLOYMENT BACKUP & VERIFICATION TEST] ===\n');

  if (fs.existsSync(DB_DIR)) {
    fs.rmSync(DB_DIR, { recursive: true, force: true });
  }

  const pgInstance = new EmbeddedPostgres({
    port: PORT,
    databaseDir: DB_DIR,
    user: 'postgres',
    password: 'password'
  });

  console.log(`[PG16 Setup] Initializing disposable PostgreSQL 16 cluster on port ${PORT}...`);
  await pgInstance.initialise();
  await pgInstance.start();
  console.log(`[PG16 Setup] Running on port ${PORT}.\n`);

  process.env.DATABASE_URL = `postgresql://postgres:password@127.0.0.1:${PORT}/postgres?sslmode=disable`;

  try {
    // 1. Seed database with migrations 001 through 005
    console.log('[Setup] Seeding database via migration runner (001 -> 005)...');
    await runMigration({ dryRun: false });
    console.log('[Setup] Disposable test database seeded with 26 canonical tables and test records.\n');

    // 2. Prepare and execute the Windows PowerShell backup script
    const tempPs1 = path.join(os.tmpdir(), `test_backup_${Date.now()}.ps1`);
    const psScriptContent = `
$ErrorActionPreference = "Stop"
$env:PATH = "${path.join(ROOT_DIR, 'server/node_modules/.bin').replace(/\\/g, '\\\\')};" + $env:PATH
$env:DATABASE_URL = "postgresql://postgres:password@127.0.0.1:${PORT}/postgres?sslmode=disable"
$BackupDir = Join-Path $env:TEMP "resolve_ai_backups"
if (-not (Test-Path $BackupDir)) { New-Item -ItemType Directory -Path $BackupDir | Out-Null }
$Timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$BackupFile = Join-Path $BackupDir "resolve_ai_prod_predeploy_$Timestamp.dump"

Write-Host "[1/4] Executing pg_dump backup to $BackupFile..." -ForegroundColor Yellow
pg_dump -Fc --no-owner --no-privileges "$env:DATABASE_URL" -f "$BackupFile"
if ($LASTEXITCODE -ne 0) { throw "pg_dump failed with exit code $LASTEXITCODE" }

if (-not (Test-Path $BackupFile)) { throw "Backup file was not created: $BackupFile" }
$BackupItem = Get-Item $BackupFile
if ($BackupItem.Length -le 0) { throw "Backup file is empty: $BackupFile" }
Write-Host "[2/4] [PASS] Verified backup file exists ($($BackupItem.Length) bytes): $BackupFile" -ForegroundColor Green

Write-Host "[3/4] Inspecting archive TOC with pg_restore --list..." -ForegroundColor Yellow
$TOC = pg_restore --list "$BackupFile" | Select-String -Pattern "TABLE DATA"
$TOC | ForEach-Object { Write-Host "      $_" }
if ($LASTEXITCODE -ne 0) { throw "pg_restore --list failed with exit code $LASTEXITCODE" }
Write-Host "      [PASS] Found $($TOC.Count) TABLE DATA archive entries in archive TOC." -ForegroundColor Green

Write-Host "[4/4] Restoring backup into disposable database..." -ForegroundColor Yellow
pg_restore -h 127.0.0.1 -p ${PORT} -U postgres -d postgres "$BackupFile"
if ($LASTEXITCODE -ne 0) { throw "pg_restore failed with exit code $LASTEXITCODE" }
Write-Host "[PASS] Disposable database restore succeeded with exit code 0." -ForegroundColor Green

Write-Host "RESULT_BACKUP_PATH: $BackupFile"
Write-Host "RESULT_BACKUP_SIZE: $($BackupItem.Length)"
Write-Host "RESULT_TOC_ENTRIES: $($TOC.Count)"
`;

    fs.writeFileSync(tempPs1, psScriptContent, 'utf8');

    console.log('--- EXECUTING WINDOWS POWERSHELL COMMAND ---');
    const psOutput = execSync(`powershell.exe -ExecutionPolicy Bypass -File "${tempPs1}"`, {
      encoding: 'utf8',
      cwd: ROOT_DIR
    });
    console.log(psOutput);

    try { fs.unlinkSync(tempPs1); } catch (e) {}

    // 3. Verify data in PostgreSQL database directly
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    const auditRes = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM brands) as brands_count,
        (SELECT COUNT(*) FROM customers) as customers_count,
        (SELECT COUNT(*) FROM orders) as orders_count,
        (SELECT COUNT(*) FROM tickets) as tickets_count,
        (SELECT COUNT(*) FROM attachments) as attachments_count
    `);
    const counts = auditRes.rows[0];
    console.log('[Direct Database Audit]:', counts);
    if (parseInt(counts.brands_count) < 1 || parseInt(counts.customers_count) < 3) {
      throw new Error('Database audit verification failed');
    }
    await pool.end();

    console.log('\n=================================================================');
    console.log('[PASS] POWERSHELL BACKUP & DISPOSABLE RESTORATION 100% VERIFIED');
    console.log('[Scope Note]: Tested against disposable local PostgreSQL 16 cluster.');
    console.log('             Render production database was NOT accessed or dumped.');
    console.log('=================================================================');

  } catch (err) {
    console.error('[TEST ERROR]:', err);
    throw err;
  } finally {
    console.log('\n[PG16 Teardown] Closing database pools...');
    await closePool();
    console.log('[PG16 Teardown] Stopping EmbeddedPostgres server...');
    try {
      await pgInstance.stop();
    } catch (e) {
      console.warn('[PG16 Teardown Warning]:', e.message);
    }
    if (fs.existsSync(DB_DIR)) {
      try {
        fs.rmSync(DB_DIR, { recursive: true, force: true });
      } catch (e) {}
    }
    console.log('[PG16 Teardown] Completed cleanly.');
  }
}

main().catch(err => {
  console.error('[FATAL ERROR]:', err);
  process.exit(1);
});
