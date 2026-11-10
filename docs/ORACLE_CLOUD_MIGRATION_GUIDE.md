# Resolve AI — 30-Day Permanent Cloud Migration Guide: Oracle Cloud Always Free (Mumbai / ap-mumbai-1)

**Document Version:** 1.0.0  
**Current Temporary Host:** Render Free Tier (Singapore `sin` / `singapore`)  
**Permanent Destination:** Oracle Cloud Infrastructure (OCI) Always Free  
**Confirmed Home Region:** India West (Mumbai / `ap-mumbai-1`)  
**Target Architecture:** Co-located Full Application & Database Migration  
**Render Database Creation Date:** 2026-11-10  
**Render Hard Termination Date:** 2026-12-10 (Day 30)  
**Mandatory Migration Checkpoint:** 2026-11-30 (Day 20)  

---

## 1. Critical Architectural Policy & Tenancy Constraints

### 1.1 OCI Always Free Home Region Pinning
In Oracle Cloud Infrastructure (OCI), Always Free resources (including VM.Standard.A1.Flex Ampere instances with up to 4 OCPUs and 24 GB RAM, and VM.Standard.E2.1.Micro instances) are **strictly restricted to the tenancy's registered Home Region**.
- If your OCI tenancy was created in **India West (Mumbai / `ap-mumbai-1`)**, all Always Free compute and persistent storage MUST be provisioned in **Mumbai**.
- Subscribed secondary regions (such as Singapore) do NOT qualify for Always Free tier quotas and will incur billable commercial charges if provisioned.

### 1.2 Co-located Full Application Migration (No Split-Stack)
> [!WARNING]
> Do NOT migrate only the PostgreSQL database to Mumbai while leaving the Render web service in Singapore. 
> Trans-oceanic network latency between Singapore and Mumbai is approximately 55–80ms round-trip. Because complex operations (ticket creation, customer handoff, and audit logging) execute 3 to 6 SQL queries per request, an inter-region split would degrade API response times by 200–500ms.
> 
> **Resolve AI must be migrated as a complete, co-located unit: both the Node.js 24 Web Service and PostgreSQL 16 database residing within the same OCI Virtual Cloud Network (VCN) in Mumbai.**

---

## 2. 30-Day Timeline & Milestones

```
2026-11-10                    2026-11-30                    2026-12-05                    2026-12-10
    │                             │                             │                             │
    ▼                             ▼                             ▼                             ▼
[Creation] ───────────────► [Day 20 Checkpoint] ─────────► [Day 25 Cutoff] ────────► [Day 30 Expiry]
Render Free DB            • Full external backup         • DNS cutover to OCI          Render deletes
provisioned (1GB limit)   • Provision OCI Mumbai         • Validate live messaging     un-migrated DB
                          • Restore test database        • Zero traffic to Render      permanently!
```

- **Day 0 (2026-11-10)**: Render Free PostgreSQL initialized with 17 canonical tables and demo data.
- **Day 20 (2026-11-30)**: Mandatory migration checkpoint. Execute external `pg_dump` backup. Provision OCI Always Free instance in Mumbai.
- **Day 25 (2026-12-05)**: Final cutover date. Cut over DNS, re-register Nexconn production webhook, and verify zero data loss.
- **Day 30 (2026-12-10)**: Render database hard termination. Zero downtime impact because traffic is 100% on OCI Mumbai.

---

## 3. Step-by-Step Migration Runbook

### Step 1: External Database Backup (Outside Render)
Run the backup from an operator machine or external server connecting to Render's external database URL:
```bash
# Set external database URL from Render Dashboard (dpg-xxxxxx.singapore-postgres.render.com)
export DATABASE_URL="postgresql://user:password@dpg-xxxxxx.singapore-postgres.render.com/resolve_ai"
export EXTERNAL_BACKUP_DIR="$HOME/.resolve_ai_backups"

# Run the verified exterior backup utility
node server/scripts/backupAndRestore.js
```
*Verification Check:* Confirm backup is written to `$HOME/.resolve_ai_backups/resolve_ai_external_backup_<timestamp>.sql` and that it contains all 17 tables, records, constraints, and attachment BYTEA blobs.

### Step 2: Provision OCI Always Free Instance in Mumbai (`ap-mumbai-1`)
1. Log in to the Oracle Cloud Console. Confirm region in top-right is **India West (Mumbai)**.
2. Navigate to **Compute > Instances > Create Instance**.
   - **Image**: Ubuntu 24.04 LTS (or Oracle Linux 9).
   - **Shape**: `VM.Standard.A1.Flex` (Ampere 2 OCPUs, 12 GB RAM) — *Always Free Eligible*.
3. Networking: Create or select Public VCN with Ingress Rules:
   - Port 22 (SSH)
   - Port 80 (HTTP)
   - Port 443 (HTTPS)
   *(Port 5432 should NOT be exposed to the public internet; keep PostgreSQL bound to localhost `127.0.0.1`)*.

### Step 3: Install & Configure PostgreSQL 16 on OCI Instance
```bash
# Update and install PostgreSQL 16
sudo apt update && sudo apt install -y postgresql-16 postgresql-contrib

# Create resolve_ai database and user
sudo -u postgres psql -c "CREATE USER resolve_ai_user WITH PASSWORD 'secure_production_password';"
sudo -u postgres psql -c "CREATE DATABASE resolve_ai OWNER resolve_ai_user;"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE resolve_ai TO resolve_ai_user;"
```

### Step 4: Restore Backup on OCI Instance
Copy the exterior backup file to the OCI server via secure copy:
```bash
scp ~/.resolve_ai_backups/resolve_ai_external_backup_*.sql ubuntu@<oci-instance-ip>:~/backup.sql
```
Restore the database:
```bash
# On OCI server
export DATABASE_URL="postgresql://resolve_ai_user:secure_production_password@127.0.0.1:5432/resolve_ai"
node server/scripts/backupAndRestore.js --restore ~/backup.sql
```
*Verification Check:* Query row counts:
```sql
SELECT 
  (SELECT COUNT(*) FROM brands) as brands,
  (SELECT COUNT(*) FROM users) as users,
  (SELECT COUNT(*) FROM customers) as customers,
  (SELECT COUNT(*) FROM orders) as orders,
  (SELECT COUNT(*) FROM tickets) as tickets,
  (SELECT COUNT(*) FROM attachments) as attachments;
-- Expect: 1 brand, 1 user, 3 customers, 3 orders, 3 tickets, verified attachments
```

### Step 5: Deploy Resolve AI Application on OCI Instance
```bash
# Install Node.js 24 and PM2
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2

# Clone verified feature branch
git clone -b feature/checkpoint-c-storefront-widget <repo-url> /opt/resolve-ai
cd /opt/resolve-ai

# Build client and install server dependencies
npm --prefix server install
npm --prefix client install
npm --prefix client run build

# Configure production environment (.env)
cat << 'EOF' > server/.env
NODE_ENV=production
PORT=5000
DATABASE_URL=postgresql://resolve_ai_user:secure_production_password@127.0.0.1:5432/resolve_ai
NEXCONN_APP_KEY=3a39e88b86d649ae8c5c7bb781e64e9a
NEXCONN_APP_SECRET=<rotated_secret>
NEXCONN_API_URL=https://api.sg-light-api.com
GEMINI_API_KEY=<gemini_api_key>
GEMINI_MODEL=gemini-3.8-flash
SESSION_SECRET=<generated_secret>
CLIENT_URL=https://resolve-ai.novacart.com
ALLOWED_ORIGINS=https://resolve-ai.novacart.com
EOF

# Start application via PM2
pm2 start server/src/server.js --name resolve-ai
pm2 save
pm2 startup
```

### Step 6: Configure Reverse Proxy & SSL (Caddy or Nginx)
Configure Caddy for automatic Let's Encrypt SSL:
```Caddyfile
resolve-ai.novacart.com {
    reverse_proxy 127.0.0.1:5000
}
```

### Step 7: Update Nexconn Production Webhook
Log into Nexconn Developer Console:
- Update Webhook Callback URL to: `https://resolve-ai.novacart.com/api/webhooks/nexconn`.
- Verify signature validation and test live message round-trip.

---

## 4. Verification & Rollback Procedures
- **Rollback Condition**: If OCI provisioning encounters unexpected delays prior to Day 25, the application remains safely operational on Render Free.
- **Zero-Data Loss Guarantee**: The database export utility captures all 17 tables and BYTEA attachments directly from PostgreSQL, independent of Render's filesystem.
