# Resolve AI — Intelligent Customer Support Workspace

> **From customer confusion to resolution, in one conversation.**  
> *Built for the Nexconn Build Challenge — Marketplace & Support Track*  
> **Brand Palette:** Jet Black (`#090909`), Pure White (`#FFFFFF`), Neon Fluorescent Lime Green (`#7CFF00`)

---

> [!WARNING]
> ### 🚨 30-Day Cloud Database Expiry & Permanent Migration Notice
> **Temporary Environment:** Render Free Managed PostgreSQL (`resolve-ai-db`, Singapore `singapore`)  
> **Database Creation Timestamp:** `2026-11-10T18:52:00+05:30`  
> **Render Hard Deletion Timestamp:** **`2026-12-10T18:52:00+05:30`** (Day 30 auto-termination)  
> **Emergency Cutoff Deadline:** **`2026-12-05T18:52:00+05:30`** (Day 25 zero-traffic transition)  
> **Mandatory Review Checkpoint:** **`2026-11-30T18:52:00+05:30`** (Day 20 off-site export & test restore)  
> **Permanent Target Host:** Oracle Cloud Always Free (Home Region: India West - Mumbai / `ap-mumbai-1`)  
> **Migration Runbook:** Follow [`docs/ORACLE_CLOUD_MIGRATION_GUIDE.md`](docs/ORACLE_CLOUD_MIGRATION_GUIDE.md) for full-stack migration procedures.

---

## 🌟 Overview

**Resolve AI** is an intelligent, full-stack customer support workspace engineered to solve modern retail & marketplace support bottlenecks:
- Customers experience delayed responses and lack of real-time transparency.
- Support agents lack immediate context and cross-system policy references.
- Escalations between AI bots and human agents are clumsy and context-losing.
- Small support teams need automated drafting without risking hallucinations.

Resolve AI combines **genuine Nexconn Chat SDK DirectChannel real-time messaging** with **Gemini AI Copilot intelligence** (with automated multi-model failover) to deliver end-to-end resolution in one unified, high-performance workspace.

---

## 🏗️ Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Resolve AI Client (SPA)                         │
│            React 18 + Vite + Tailwind CSS + Lucide Icons               │
├──────────────────────────┬─────────────────────────────────────────────┤
│     Customer Portal      │           Support Agent Dashboard           │
│        (/customer)       │                   (/agent)                  │
│  - Multi-Customer Switch │   - Multi-Channel Priority Inbox            │
│  - Real-Time Chat Stream │   - Active Conversation Workspace           │
│  - "Request Human" Button│   - AI Copilot Panel (Approval Gate)        │
│  - Order Tracking Drawer │   - NovaCart Policy Citations               │
│  - Live Status Banner    │   - Takeover & Resolution Actions           │
└────────────┬─────────────┴──────────────────────┬──────────────────────┘
             │                                    │
             │       Nexconn Direct Channels      │
             └──────────────────┬─────────────────┘
                                ▼
         ┌──────────────────────────────────────────────┐
         │          Nexconn Real-Time Network           │
         │     (@nexconn/engine & @nexconn/chat)        │
         │  - Live 1:1 DirectChannel WebSocket Engine   │
         │  - Isolated Order-Scoped Channels            │
         │  - In-Flight Double-Submission Protection    │
         └──────────────────────┬───────────────────────┘
                                │
               ┌────────────────┴────────────────┐
               ▼                                 ▼
┌─────────────────────────────┐   ┌─────────────────────────────┐
│    Resolve AI Backend API   │   │      Gemini AI Copilot      │
│     (Node.js + Express)     │   │     (@google/generative-ai) │
│ - Token Minting (HMAC SHA1) │   │ - Real-Time Classification  │
│ - Atomic Disk Persistence   │   │ - Structured 4-Part Summary │
│   (server/data/tickets.json)│   │ - Policy-Enforced Suggestions│
│ - Input Whitelist Validation│   │ - Multi-Model Failover      │
│ - Protected Demo Reset      │   │   (flash -> flash-lite)     │
└─────────────────────────────┘   └─────────────────────────────┘
```

---

## 🚀 Quick Start Instructions (Windows PowerShell & CMD)

### Prerequisites
- **Node.js**: v18.0.0 or higher (v24+ verified)
- **npm**: v9.0.0 or higher
- **Google Chrome**: For running browser-based live E2E tests

### 1. Clone & Setup Environment
```powershell
cd ResolveAI_Nexconn

# Copy environment template
Copy-Item .env.example server\.env
```
*(Ensure `NEXCONN_APP_KEY`, `NEXCONN_APP_SECRET`, and `GEMINI_API_KEY` are provided in `server\.env`)*

### 2. Install Dependencies
```powershell
npm install
npm install --prefix server
npm install --prefix client
```

### 3. Launch Development Servers
```powershell
# Option A: Run both servers concurrently
npm run dev

# Option B: Run in separate terminals
# Terminal 1 (Backend API on port 5000):
npm run server

# Terminal 2 (Frontend Client on port 5173):
npm run dev --prefix client
```

- **Customer Portal**: `http://localhost:5173/customer`
- **Agent Dashboard**: `http://localhost:5173/agent`
- **Split-Screen Demo**: `http://localhost:5173/split`
- **Backend Health Check**: `http://localhost:5000/api/health`

---

## 🎬 Recommended Demonstration Sequence

Follow this scripted sequence to demonstrate Resolve AI's capabilities to judges:

### Phase 1: Dual-Pane Synchronization (`/split`)
1. Open `http://localhost:5173/split`.
2. Notice the side-by-side synchronized interface:
   - **Left**: Customer Experience (Aarav Sharma — Order `#NC1021`).
   - **Right**: Support Specialist Workspace (Sarah Lin).
3. Type an inquiry in the Customer pane:
   ```
   "Where is my package? The tracking hasn't updated in 2 days."
   ```
4. Observe the message arrive instantly in the Agent pane via the live Nexconn WebSocket connection.

### Phase 2: AI Copilot Assistance & Human Approval Gate
1. On the Agent side, open the **AI Copilot** panel on the right.
2. Observe real-time classification:
   - **Category**: `Delivery Delay`
   - **Priority**: `High`
   - **Sentiment**: `Frustrated`
3. View the structured 4-part summary:
   - *What happened* | *What the customer needs* | *What was discussed* | *Pending action*
4. Inspect the suggested response. Notice policy citations from NovaCart business rules (standard 4–6 business days delivery).
5. Click **"Approve & Send"** (with built-in double-click lock).
6. Verify the customer pane receives exactly one approved message.

### Phase 3: Seamless Human Handoff
1. Switch to **Priya Mehta** (Order `#NC1022` — Smartwatch Return).
2. Notice initial status is `Status: AI Handling`.
3. Click **"Request Human Support"**.
4. Observe instant status change to Crimson Red: `Human Requested`.
5. In the Agent pane, notice the alert banner and green **"Take Over"** button appear.
6. Agent clicks **"Take Over"**.
7. Observe customer status immediately update to `Sarah Lin Active`.
8. AI autonomous messaging is suppressed—Sarah communicates directly with Priya.

### Phase 4: Resolution & Persistence
1. Agent clicks **"Resolve"** in the top action bar.
2. Both agent and customer screens update to `Resolved`.
3. Press `F5` on both panes to reload the page.
4. Confirm that conversation history, active channels, and the `Resolved` state persist completely from the file-backed store.

---

## 🧪 Comprehensive Automated Test Suites

Resolve AI features 4 automated test suites covering security, unit messaging isolation, live API integrations, and headless browser end-to-end workflows:

```powershell
# 1. Messaging Isolation & Deduplication Unit Suite (24/24 PASS)
node client/test/messagingIsolation.test.js

# 2. Server E2E & Live Gemini Failover Suite (11/11 PASS)
node server/test/runE2ESuite.js

# 3. Milestone 3 Complete Workflow Verification (24/24 PASS)
node server/test/milestone3WorkflowVerification.js

# 4. Milestone 4 Full 3-Customer Hardening Suite (37/37 PASS)
node server/test/fullThreeCustomerE2E.js

# 5. Production Bundle Build (0 errors)
npm run build --prefix client
```

---

## 🔒 Security Audit & Safeguards

| Security Requirement | Status | Implementation Detail |
| :--- | :---: | :--- |
| **Server-Side Secrets** | **VERIFIED** | `NEXCONN_APP_SECRET` and `GEMINI_API_KEY` are only read in Node.js server routes. They are never exposed in Vite bundles or client responses. |
| **Git Exclusion** | **VERIFIED** | `.env`, `.env.local`, and data files are excluded in `.gitignore`. Zero secrets in git history. |
| **Input Whitelist Validation** | **VERIFIED** | `PATCH /api/tickets/:id` strictly validates status against `['AI Handling', 'Human Requested', 'Human Agent Active', 'Resolved']` and priority against `['Critical', 'High', 'Medium', 'Low']`. |
| **Cross-Customer Authorization** | **VERIFIED** | `GET /api/tickets/:id?customerId=...` returns HTTP 403 Forbidden if a customer attempts to query another customer's ticket. |
| **DoS Payload Limiting** | **VERIFIED** | Large message payloads are bounded to 50 items and 2000 chars per message; Express payload limits return HTTP 413. |
| **Protected Reset Endpoint** | **VERIFIED** | `POST /api/tickets/reset` is disabled in `NODE_ENV=production` unless `ALLOW_DEMO_RESET=true` is explicitly enabled. |

---

## 💾 Persistence Architecture & Limitations

### Architecture
- **Disk Persistence**: `server/data/tickets.json` acts as the primary data store.
- **Atomic Writes**: Writes utilize asynchronous temp-file creation (`tickets.tmp.<timestamp>.<rand>`) followed by atomic rename (`fs.promises.rename`), serialized via a mutex Promise queue to prevent file corruption and race conditions during concurrent requests.
- **Client Fallback**: Local browser storage (`resolve_ai_ticket_statuses` & `resolve_ai_channel_history`) enables instant page hydration on reload, with timestamp-aware reconcilers ensuring newer backend records always take precedence over stale cache.

### Known Limitations & Trade-offs
1. **Single-Node Storage**: File-backed storage is designed for single-instance deployments (such as demo servers and containerized hackathon instances). Horizontal multi-node scaling would require migrating to PostgreSQL/Supabase.
2. **Nexconn Broker Offline Message History**: Nexconn Singapore cloud brokers persist DirectChannel messages across sessions. Resolve AI incorporates client-side timestamp filtering (<30s window) to ensure historical broker messages do not regress fresh ticket states.
3. **Gemini Free-Tier Rate Limits**: Free tier keys are subject to 20 RPM / 20 RPD limits. The server includes automatic failover (`gemini-3.5-flash` ➔ `gemini-3.5-flash-lite`) and rule-based fallback generation to ensure 100% demo continuity even when upstream rate limits are encountered.

---

## 👥 Demo Personas & Dataset

| Customer | Persona | Order ID | Product | Issue Category | Seed Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Aarav Sharma** | Frustrated shopper | `#NC1021` | NovaSprint Pro Shoes ($119.99) | Delivery Delay | `AI Handling` |
| **Priya Mehta** | Return inquirer | `#NC1022` | NovaPulse Smartwatch ($249.50) | Refund Request | `AI Handling` |
| **Kabir Verma** | Wrong item recipient | `#NC1023` | NovaBass ANC Headphones ($89.00) | Wrong Product | `AI Handling` |
| **Sarah Lin** | Support Specialist | *All* | NovaCart Customer Care | Agent Operations | `Agent Workspace` |

### One-Click Reset Procedure
To reset all demo tickets and conversation states to their clean baseline at any time:
```powershell
# Send HTTP POST to the protected reset endpoint
node -e "fetch('http://127.0.0.1:5000/api/tickets/reset', { method: 'POST' }).then(r => r.json()).then(console.log)"
```
Or simply click the reset button in test scripts.
