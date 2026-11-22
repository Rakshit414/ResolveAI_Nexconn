# Resolve AI — Enterprise Multi-Agent Customer Support & Global Localization Platform

Resolve AI is an omnichannel customer support and real-time conversation platform built on top of the **Nexconn Chat SDK** and **Gemini AI** for enterprise e-commerce merchants.

The platform links an interactive consumer storefront (NovaCart) with a multi-tier human agent workforce, providing live bidirectional messaging, automatic ticket assignment, capacity-managed handoffs, and 12-language real-time translation with native Arabic RTL support.

---

## System Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                      NovaCart E-Commerce Frontends                     │
│  - Consumer Storefront & Shopping Cart (/store)                        │
│  - Customer Support Portal (/customer)                                 │
│  - Floating Embeddable Support Widget (Iframe Isolated)                │
└──────────────────────────┬─────────────────────────────────────────────┘
                           │
                           ▼
          Nexconn Real-Time Gateway (@nexconn/chat)
          - 1:1 DirectChannel Messaging
          - Connection Status Monitoring
          - Automatic Transcript Hydration
                           │
                           ▼
┌────────────────────────────────────────────────────────────────────────┐
│                   Resolve AI Multi-Agent Cockpit                       │
│  - Collaborative Shared Inbox (/agent)                                 │
│  - Role-Based Agent Personas (Sarah Lin, Carlos Gomez, Elena Rodriguez)│
│  - Dynamic Availability & Capacity Accounting                          │
│  - AI Copilot Assistance & Grounded Policy Citations                   │
└──────────────────────────┬─────────────────────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────────────────────┐
│                   Backend & Data Safety Services                       │
│  - Node.js & Express REST Endpoints                                    │
│  - Transactional Outbox Worker with Signed Dispatch                    │
│  - PostgreSQL 16 ACID Storage (Row-level Locking)                      │
│  - Zero-Leak Customer PII Masking on Unassigned Queues                 │
└────────────────────────────────────────────────────────────────────────┘
```

---

## Core Capabilities

### 1. Real-Time Nexconn Chat Integration
- **Direct Channels**: Secure 1:1 conversation channels between customer identities and registered merchant support endpoints (`novacart_support`).
- **Event-Driven Messaging**: Sub-100ms latency via `SendTextMessageParams` and `MessageHandler`.
- **Signed Dispatch Engine**: Outbox service issues server-to-server HTTP dispatches with SHA-1 signatures (`AppSecret + Nonce + Timestamp`) to guarantee delivery.

### 2. Multi-Agent Collaborative Workforce
- **Authenticated Personas**: Support Lead (Sarah Lin) and Support Specialists (Carlos Gomez, Elena Rodriguez).
- **Atomic Handoffs**: Tickets transfer with row locks (`SELECT ... FOR UPDATE`), preserving audit notes while reallocating workload capacity in real time.
- **Shared Inboxes**: Real-time filtering across active assignments, unassigned queues, and resolved tickets.

### 3. 12-Language Localization Engine
- **Supported Languages**: English, Hindi, Marathi, Bengali, Tamil, Telugu, Gujarati, Kannada, Malayalam, Punjabi, Arabic, and Simplified Chinese.
- **Bidirectional UI Support**: Full right-to-left layout rendering for Arabic and clean rendering for Asian scripts.
- **Fail-Safe Translation**: Circuit breaker mechanism prevents service degradation during upstream network issues.

### 4. AI Copilot & Grounded Policy Hub
- **Contextual Draft Generation**: Gemini-powered recommendations based on active ticket context and customer sentiment.
- **Human Approval Gate**: Support specialists review, edit, or approve AI-generated suggestions before dispatch.
- **Policy Enforcement**: Automatic citations for shipping, returns, and refund thresholds.

---

## Tech Stack

| Layer | Technologies |
| :--- | :--- |
| **Messaging** | Nexconn Chat SDK (`@nexconn/chat`, `@nexconn/engine`) |
| **Frontend** | React 18, Vite, Tailwind CSS, Lucide Icons |
| **Backend** | Node.js, Express, Axios, BCrypt |
| **Database** | PostgreSQL 16 (Native & Render Managed) |
| **AI / LLM** | Google Gemini API (`@google/generative-ai`) |
| **Testing** | Node.js Native Test Runner, Embedded PostgreSQL 16 |

---

## Directory Structure

```
ResolveAI_Nexconn/
├── client/                     # Frontend Application
│   ├── src/
│   │   ├── components/         # Agent Dashboard, Chat Window, Widget, Storefront
│   │   ├── data/               # Product catalogs, business rules, agent rosters
│   │   ├── services/           # Nexconn SDK manager, API client, translation helpers
│   │   └── App.jsx             # Router and application layout
│   ├── package.json
│   └── vite.config.js
├── server/                     # Backend API Service
│   ├── src/
│   │   ├── db/                 # Connection pooling, migrations (001–005), seeding
│   │   ├── middleware/         # Session authentication, CSRF, security headers
│   │   ├── routes/             # Inbox, auth, agent availability, customer APIs
│   │   ├── services/           # Outbox worker, capacity manager, conversation router
│   │   └── server.js           # Server initialization and routes
│   └── test/                   # Verification test suites
├── docs/                       # Project documentation and submission artifacts
├── screenshots/                # Comprehensive UI screenshots and captures
└── README.md
```

---

## Local Setup & Quick Start

### Prerequisites
- Node.js (v18.0.0 or higher)
- npm (v9.0.0 or higher)
- PostgreSQL 16 (or local testing via embedded instance)

### 1. Installation
Clone the repository and install all dependencies:
```bash
git clone https://github.com/Rakshit414/ResolveAI_Nexconn.git
cd ResolveAI_Nexconn
npm install
npm run build
```

### 2. Environment Variables
Create a `.env` file in the `server` directory:
```env
PORT=5000
DATABASE_URL=postgresql://user:password@localhost:5432/resolve_ai
NEXCONN_APP_KEY=your_nexconn_app_key
NEXCONN_APP_SECRET=your_nexconn_app_secret
GEMINI_API_KEY=your_gemini_api_key
AGENT_JWT_SECRET=your_secure_jwt_secret
```

### 3. Database Migration
Apply database schema migrations:
```bash
npm run db:migrate
```

### 4. Running the Development Server
```bash
npm run dev
```
- Storefront & Widget: `http://localhost:5173/store`
- Customer Portal: `http://localhost:5173/customer`
- Agent Dashboard: `http://localhost:5173/agent`
- Split-Screen Testing: `http://localhost:5173/split`

---

## Test Verification Suites

Resolve AI includes comprehensive test suites across unit, integration, localization, and security boundaries:

```bash
# 1. Multi-Agent Workflow Integration (20 Verification Scenarios)
node server/test/multiAgentWorkflow.test.js

# 2. Multi-Agent System Core Architecture & Invariants (11 Unit Tests)
node server/test/multiAgentUnit.test.js

# 3. 12-Language Multilingual Localization & RTL Verification
node server/test/twelveLanguageLocalization.test.js

# 4. Storefront Cart Localization & Invariance Tests
node server/test/storefrontLocalization.test.js

# 5. PostgreSQL Local Security Audit
node server/test/pgShimsLocalSecurity.test.js

# 6. Repository-Wide Security & Secrets Audit
node server/test/securityAndSecretsScan.js
```

---

## Security & Operational Compliance

- **Authentication Precedence**: Bearer tokens are strictly evaluated before ambient cookies to prevent session confusion during agent switching.
- **Row-Level Transaction Safety**: Database transfers derive ticket ownership from locked rows (`FOR UPDATE`) to prevent race conditions.
- **Zero Hardcoded Secrets**: Client production assets and repository code are verified clean of credentials and private keys.
