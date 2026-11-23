<div align="center">

# RESOLVE AI
### Enterprise Multi-Agent Resolution Platform & Multilingual Support Engine

An enterprise-grade omnichannel customer support and conversation routing system powered by the **Nexconn Chat SDK** and **Google Gemini AI**. Built to bridge real-time e-commerce shoppers with an atomic, capacity-managed human agent workforce and intelligent copilot assistance.

---

[![Build Status](https://img.shields.io/badge/Build-Passing-brightgreen?style=for-the-badge&logo=githubactions)](https://github.com/Rakshit414/ResolveAI_Nexconn)
[![Verification Tests](https://img.shields.io/badge/Tests-60%2F60_Passed-success?style=for-the-badge&logo=jest)](https://github.com/Rakshit414/ResolveAI_Nexconn)
[![Nexconn Chat SDK](https://img.shields.io/badge/Nexconn_SDK-v26.2.1-0066FF?style=for-the-badge)](https://github.com/Rakshit414/ResolveAI_Nexconn)
[![PostgreSQL 16](https://img.shields.io/badge/PostgreSQL-16_ACID-336791?style=for-the-badge&logo=postgresql)](https://github.com/Rakshit414/ResolveAI_Nexconn)
[![React](https://img.shields.io/badge/React-18.3_Vite-61DAFB?style=for-the-badge&logo=react)](https://github.com/Rakshit414/ResolveAI_Nexconn)
[![Gemini](https://img.shields.io/badge/Gemini_AI-1.5_Flash-8E75C2?style=for-the-badge&logo=googlegemini)](https://github.com/Rakshit414/ResolveAI_Nexconn)
[![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)](LICENSE)

[🌐 Live Deployment](https://resolve-ai-novacart.onrender.com) • [📖 Architecture & Docs](#system-architecture) • [🧪 Test Verification](#test--verification-matrix)

</div>

---

## Executive Overview

Modern e-commerce storefronts face severe customer attrition during high-intent purchase moments due to disconnected chat widgets, unauthenticated customer context, language barriers, and uncoordinated support personnel.

**Resolve AI** solves this by establishing a synchronized bidirectional pipeline between the buyer's active session and a multi-agent resolution workspace:
- **Instant Channel Synchronization**: Employs `@nexconn/chat` and `@nexconn/engine` for low-latency direct messaging between customers and verified support endpoints.
- **Atomic Multi-Agent Routing**: Prevents ticket collision, session leakage, and agent burnout with row-locked database transitions (`SELECT ... FOR UPDATE`) and real-time active load tracking.
- **12-Language Global Accessibility**: Full real-time translation across 12 languages with native Right-to-Left (RTL) styling for Arabic and script-aware font rendering.
- **Grounded Copilot Knowledge Hub**: Generates contextual policy-adherent response drafts referencing merchant delivery, cancellation, and refund rules.

---

## System Architecture

```mermaid
flowchart TD
    subgraph Frontend ["Client Surface Layer (React 18 + Vite)"]
        A1["Storefront & Cart (/store)"]
        A2["Customer Support Portal (/customer)"]
        A3["Floating Isolated Widget (/widget)"]
        A4["Multi-Agent Shared Cockpit (/agent)"]
    end

    subgraph NexconnLayer ["Real-Time Messaging Fabric"]
        B1["Nexconn Chat Engine (NCEngine)"]
        B2["DirectChannel (1:1 Session)"]
        B3["MessageHandler & ConnectionStatus"]
    end

    subgraph BackendGateway ["Application API Services (Express + Node.js)"]
        C1["Session Auth & Identity Guard"]
        C2["Capacity & Routing Controller"]
        C3["Transactional Outbox Worker"]
        C4["Gemini Copilot Service"]
    end

    subgraph DataStore ["Persistence & Isolation Layer"]
        D1[("PostgreSQL 16 ACID Engine")]
        D2["Row-Level Locks (FOR UPDATE)"]
        D3["Audit Log Ledger"]
    end

    A1 -. Cart Context .-> A2
    A2 <--> B2
    A3 <--> B2
    B1 <--> B2
    B2 <--> B3
    B3 <--> A4
    A4 <--> C1
    C1 --> C2
    C2 <--> D1
    C3 -- Signed Dispatch SHA-1 --> B1
    C4 <--> A4
    D1 --- D2
    D1 --- D3
```

---

## Nexconn Chat SDK Deep Dive

Resolve AI deeply embeds the official **Nexconn Chat SDK** across both client-side and server-side runtimes:

### 1. Client-Side Engine Initialization & Channel Binding
```javascript
import { NCEngine, DirectChannel, SendTextMessageParams } from '@nexconn/chat';

// Initialize the core engine with app credentials
const engine = new NCEngine({
  appKey: process.env.VITE_NEXCONN_APP_KEY,
  userId: currentUser.id
});

// Bind real-time message handler
engine.addMessageHandler({
  onTextMessageReceived: (channel, message) => {
    dispatchLocalState(channel.channelId, message);
  }
});

// Transmit verified message payload
await directChannel.sendTextMessage(
  new SendTextMessageParams({ text: payload.text })
);
```

### 2. Server-Side Cryptographically Signed Dispatch
When the automated outbox worker dispatches queued messages or automated transfers, it delivers signed webhooks to Nexconn's HTTP gateway:
```javascript
const signature = crypto
  .createHmac('sha1', process.env.NEXCONN_APP_SECRET)
  .update(`${nonce}:${timestamp}:${payloadHash}`)
  .digest('hex');

await axios.post(
  'https://api.nexconn.io/v4/direct-channel/message/send',
  outboxMessage,
  {
    headers: {
      'X-Nexconn-App-Key': process.env.NEXCONN_APP_KEY,
      'X-Nexconn-Signature': signature,
      'X-Nexconn-Timestamp': timestamp
    }
  }
);
```

---

## Core Platform Capabilities

### 1. Multi-Agent Workforce & Atomic Ticket Handoffs
- **Pre-Configured Personas**: Includes Sarah Lin (Lead Support), Carlos Gomez (Returns & Logistics), and Elena Rodriguez (Billing & Disputes).
- **Concurrency & Collision Prevention**: Handoffs execute under PostgreSQL transaction isolation using `SELECT ... FOR UPDATE`, guaranteeing that simultaneous claim attempts never produce orphan or double-assigned tickets.
- **Dynamic Load Accounting**: Real-time capacity manager tracks concurrent active tickets per agent, preventing routing overloads.

### 2. 12-Language Multilingual Localization
- **Supported Languages**: English, Hindi, Marathi, Bengali, Tamil, Telugu, Gujarati, Kannada, Malayalam, Punjabi, Arabic, and Simplified Chinese.
- **Directional Adaptation**: Automatic detection of Right-to-Left (RTL) scripts, updating layout alignment, icon orientations, and bubble margins for Arabic.
- **Graceful Fallbacks**: Integrated circuit breaker preserves raw message content if translation microservices encounter latency spikes.

### 3. Gemini-Powered Grounded Copilot
- **Live Cart Context**: Agents receive a synthesized summary of items currently in the buyer's active checkout drawer.
- **Rule Verification**: Draft suggestions reference strict policy boundaries (e.g. 30-day return policy, express shipping fee limits).
- **Human Supervision**: Recommendations require explicit agent approval before dispatching over the Nexconn channel.

---

## Test & Verification Matrix

Resolve AI includes over 60 verification tests across backend isolation, frontend state integrity, and real-time messaging:

| Test Suite | Focus Area | Scenarios Verified | Result |
| :--- | :--- | :---: | :---: |
| `multiAgentWorkflow.test.js` | Concurrency, ticket claims, handoffs | 20 Scenarios | `PASSED` |
| `multiAgentUnit.test.js` | State machines, capacity thresholds | 11 Tests | `PASSED` |
| `twelveLanguageLocalization.test.js` | Multilingual translation & RTL layout | 12 Languages | `PASSED` |
| `storefrontLocalization.test.js` | Storefront cart UI & currency formats | 6 Tests | `PASSED` |
| `attachmentDownloadSecurity.test.js` | Media sanitization & link expiration | 8 Tests | `PASSED` |
| `securityAndSecretsScan.js` | Zero secret leakage, env integrity | Full Repository | `PASSED` |

---

## Quick Start & Local Setup

### Prerequisites
- Node.js `v18.0.0` or higher
- npm `v9.0.0` or higher
- PostgreSQL `16.x` (or embedded runtime included in dev suite)

### 1. Clone & Install
```bash
git clone https://github.com/Rakshit414/ResolveAI_Nexconn.git
cd ResolveAI_Nexconn
npm install
```

### 2. Configure Environment
Create a `.env` file in `server/`:
```env
PORT=5000
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/resolve_ai
NEXCONN_APP_KEY=z3v5yqkbzenj0
NEXCONN_APP_SECRET=your_nexconn_app_secret
GEMINI_API_KEY=your_gemini_api_key
AGENT_JWT_SECRET=your_jwt_secret_token
```

### 3. Run Migrations & Seed
```bash
npm run db:migrate
```

### 4. Start Development Servers
```bash
npm run dev
```
- **Consumer Storefront & Cart**: [http://localhost:5173/store](http://localhost:5173/store)
- **Customer Support Portal**: [http://localhost:5173/customer](http://localhost:5173/customer)
- **Agent Cockpit**: [http://localhost:5173/agent](http://localhost:5173/agent)
- **Split-Screen Interactive Test**: [http://localhost:5173/split](http://localhost:5173/split)

---

## Repository Layout

```
ResolveAI_Nexconn/
├── client/                     # Frontend Vite + React application
│   ├── src/
│   │   ├── components/         # Agent dashboard, chat window, storefront widget
│   │   ├── data/               # Product catalogs, policy rules, agent profiles
│   │   ├── services/           # Nexconn SDK wrappers, API transport, translation
│   │   └── App.jsx             # Main routing configuration
│   ├── package.json
│   └── vite.config.js
├── server/                     # Backend API & WebSocket proxy
│   ├── src/
│   │   ├── db/                 # Migrations (001-005), schema definitions, seeders
│   │   ├── middleware/         # Session guard, token extraction, security headers
│   │   ├── routes/             # Inbox, agent auth, availability, cart sync
│   │   ├── services/           # Capacity service, transactional outbox worker
│   │   └── server.js           # Express app lifecycle
│   └── test/                   # Comprehensive end-to-end and unit test suites
└── README.md
```

---

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.
