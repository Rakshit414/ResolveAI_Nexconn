# Resolve AI — Nexconn Build Challenge 2026 Submission

**Track:** Marketplace & Support  
**Project Name:** Resolve AI  
**Tagline:** Enterprise Omnichannel Customer Support & Copilot Suite Powered by Nexconn Chat SDK & Gemini AI  
**Repository Branch:** `feature/checkpoint-c-storefront-widget` (Head Commit: `927719c`+)  
**Target Cloud Environment:** Render (Singapore Region `sin`)  
**Target Managed Database:** Render PostgreSQL 16 (Singapore Region `sin`)  

---

## 1. Executive Summary

E-commerce marketplaces and direct-to-consumer brands face unprecedented volumes of customer inquiries spanning order tracking, return requests, payment confirmations, and technical inquiries. Traditional support tools suffer from fragmented channel communication, slow agent ramp-up times, and brittle rule-based bots that lack customer context.

**Resolve AI** transforms modern customer support by pairing **Nexconn's high-performance real-time Chat SDK (`@nexconn/chat v26.2.1`)** with **Gemini AI contextual intelligence** and a **hardened, enterprise-grade multi-tenant PostgreSQL 16 foundation**. 

Resolve AI delivers:
1. **NovaCart Flagship Storefront**: A realistic e-commerce shopping experience demonstrating frictionless support initiation.
2. **Embeddable Zero-Conflict Widget**: A lightweight, sandboxed floating launcher and frame that drops into any brand's web store via a single `<script>` tag.
3. **Split-View Agent Workspace**: A unified real-time cockpit providing human agents with ticket history, order data, customer metadata, and 1-click AI copilot draft generation.
4. **Culturally Grounded Multilingual Support**: Seamless tri-lingual conversation flow in English, Hindi, and Marathi with localized tone and terminology.
5. **Deterministic Data Integrity**: Strict composite key relational isolation `(brand_id, customer_id, order_id)` that mathematically prevents cross-brand or cross-customer data leakage.

---

## 2. Core Architecture & Infrastructure

Resolve AI follows a hardened multi-tenant, cloud-native architecture deployed to Render's Singapore region (`sin`) for co-located, ultra-low latency (<10ms) connectivity to Nexconn's Singapore cloud gateway (`api.sg-light-api.com`).

```
┌────────────────────────────────────────────────────────────────────────┐
│                        RESOLVE AI ARCHITECTURE                         │
├────────────────────────────────┬───────────────────────────────────────┤
│    CLIENT LAYER (React 18)     │         CORE BACKEND (Node.js)        │
│                                │                                       │
│  ┌──────────────────────────┐  │  ┌─────────────────────────────────┐  │
│  │   NovaCart Storefront    │  │  │   Express 4 API Server          │  │
│  │   /store /customer       │  │  │   - Rate limiting & CSRF guards │  │
│  └─────────────┬────────────┘  │  │   - Exact Origin Verification   │  │
│                │               │  └───────────────┬─────────────────┘  │
│  ┌─────────────┴────────────┐  │                  │                    │
│  │ Embeddable Widget Frame  │  │  ┌───────────────┴─────────────────┐  │
│  │ Sandboxed PostMessage    │  │  │   PostgreSQL 16 Engine          │  │
│  └─────────────┬────────────┘  │  │   - 17 Canonical Tables         │  │
│                │               │  │   - Composite Key Isolation     │  │
│  ┌─────────────┴────────────┐  │  │   - Guaranteed Outbox Pattern   │  │
│  │ Agent Split-View Cockpit │  │  └───────────────┬─────────────────┘  │
│  │ Real-time Co-pilot & CRM │  │                  │                    │
│  └─────────────┬────────────┘  │                  │                    │
└────────────────┼───────────────┴──────────────────┼────────────────────┘
                 │                                  │
                 ▼                                  ▼
      ┌─────────────────────┐            ┌─────────────────────┐
      │  Nexconn Chat SDK   │            │   Gemini 1.5 AI     │
      │  @nexconn/chat      │            │   Contextual LLM    │
      │  Singapore Gateway  │            │   Copilot Reasoning │
      └─────────────────────┘            └─────────────────────┘
```

### 2.1 The 17 Canonical Database Tables
Resolve AI features a fully normalized relational schema executed via idempotent forward migrations:
1. `brands`: Multi-brand tenant definitions (e.g. NovaCart).
2. `brand_domains`: Authorized origin domains for embeddable widgets.
3. `users`: System users and support agents (e.g. Sarah Lin).
4. `brand_memberships`: Role-based access control with foreign key constraints.
5. `agent_sessions`: Active agent presence and brand association.
6. `customers`: End-user customer identities mapped to canonical Nexconn IDs.
7. `orders`: Order entity with composite customer ownership constraint.
8. `order_items`: Line items, quantities, and USD unit prices.
9. `knowledge_docs`: Brand-specific policy documents and refund rules.
10. `tickets`: Support tickets with composite foreign key referencing `orders(brand_id, id, customer_id)`.
11. `ticket_events`: Audit log of lifecycle transitions, assignments, and tags.
12. `ticket_feedback`: Post-resolution customer CSAT ratings and comments.
13. `widget_sessions`: Ephemeral and authenticated widget interaction sessions.
14. `outbox_messages`: Transactional outbox for guaranteed message delivery.
15. `message_archive`: Persistent, deduplicated chat history with official Nexconn message IDs.
16. `webhook_receipts`: Deduplicated incoming webhook tracking.
17. `idempotency_keys`: Request-level idempotency protection with SHA-256 payload hashing.

---

## 3. Nexconn Chat SDK Deep Integration

Resolve AI leverages the official `@nexconn/chat v26.2.1` JavaScript SDK on both the customer and agent sides:

1. **Authentication & Session Issuance**:
   - Customer and agent clients request short-lived session tokens from `/api/nexconn/token`.
   - The server validates credentials and signs the authentication request using `NEXCONN_APP_KEY` and HMAC-SHA256 signatures, keeping the `NEXCONN_APP_SECRET` strictly on the backend.
2. **DirectChannel Peer-to-Peer Routing**:
   - Conversations utilize Nexconn's native `DirectChannel` protocol.
   - Channels are created directly between registered user IDs (e.g. `cust_aarav` <-> `novacart_support` / `agent_sarah`), eliminating intermediary channel key leaks.
3. **Bidirectional Message Synchronization**:
   - Messages dispatched via `SendTextMessageParams` emit optimistic local IDs (`msg_channel_...`).
   - Server receipts and incoming real-time events map the authoritative Nexconn message ID (`D1OH-...`), guaranteeing deduplication across reloads.
4. **Reliable Webhook Ingestion**:
   - Server listens on `/api/webhooks/nexconn`.
   - Incoming payloads are cryptographically validated, deduplicated via `webhook_receipts`, and persisted to `message_archive`.

---

## 4. AI Copilot & Customer Experience

Resolve AI integrates stable Gemini 3.8 / 3.5 Flash via `@google/generative-ai` with structured JSON mode (`responseMimeType: 'application/json'`) and automatic high-demand failover:

1. **Contextual Order Grounding**:
   - When a customer asks about a delayed delivery or defective item, the AI inspects the customer's actual order items, tracking codes, and warranty status.
   - Responses cite exact order numbers (e.g. `NC-1021`) and item names without hallucinating false order data.
2. **Policy Compliance**:
   - The AI checks brand knowledge documents (return windows, courier policies) before recommending actions.
3. **Tri-Lingual Fluency**:
   - **English**: Clear, empathetic enterprise tone.
   - **Hindi (हिन्दी)**: Culturally natural phrasing, respectful honorifics (जी, नमस्ते), correct order details.
   - **Marathi (मराठी)**: Authentic Marathi dialect (नमस्कार, ऑर्डर, वितरण तपशील).
4. **Agent Copilot Assistance**:
   - Agents in the Split-View workspace can review AI-drafted responses, adjust tone, edit actions, and approve delivery in a single click.

---

## 5. Security & Isolation Architecture

- **Fail-Closed Production Posture**: When `NODE_ENV === 'production'`, the server requires a reachable `DATABASE_URL`. If missing, `/api/health` immediately fails closed with HTTP 503, preventing insecure fallback to in-memory mocks.
- **Cross-Customer Isolation**: Foreign key `FOREIGN KEY (brand_id, order_id, customer_id) REFERENCES orders (brand_id, id, customer_id)` ensures that Aarav cannot reference Priya's order, even within the same brand.
- **Exact Widget Origin Security**: Embeddable widget requests from unauthorized origins, subdomains, prefix attacks, or hyphenated domains are strictly blocked with HTTP 403 Forbidden.
- **Zero Secrets in Code**: Automated repository scan verifies zero exposed API keys, App Secrets, or private keys across all git-tracked files and compiled JavaScript bundles.

---

## 6. Official Submission Metadata

- **Track:** Marketplace & Support
- **Application Name:** Resolve AI
- **Nexconn App Key:** `3a39e88b86d649ae8c5c7bb781e64e9a`
- **Region:** Singapore (`sin` / `singapore`)
- **Repository Branch:** `feature/checkpoint-c-storefront-widget`
- **License:** MIT License
