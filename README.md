# Resolve AI — Intelligent Customer Support Workspace

> **From customer confusion to resolution, in one conversation.**
> 
> *Built for the Nexconn Build Challenge — Marketplace & Support Track*

---

## 🌟 Overview

**Resolve AI** is an intelligent, full-stack customer support platform engineered to solve the most painful challenges faced by modern e-commerce and retail businesses:
- Repetitive inquiries and delayed response times.
- Context switching between fragmented systems and chat streams.
- Escalation bottlenecks and inaccurate agent replies.

Combining **Nexconn Chat SDK** for high-speed, direct 1-to-1 real-time messaging with **Gemini AI Copilot** intelligence, Resolve AI bridges the gap between automated customer intelligence and human oversight.

---

## 🏗️ Architecture

```
┌────────────────────────────────────────────────────────┐
│                   Resolve AI Client                    │
│   (React 18 + Vite + Tailwind CSS + Lucide React)      │
├──────────────────────────┬─────────────────────────────┤
│     Customer Portal      │   Support Agent Dashboard   │
│  - Demo Customer Switch  │   - Real-time Inbox         │
│  - Direct Message Stream │   - Live Chat Window        │
│  - Request Human Handoff │   - AI Copilot Panel        │
│  - Order Context Card    │   - Policy Reference Modal  │
└────────────┬─────────────┴──────────────┬──────────────┘
             │                            │
             │   Nexconn Direct Channel   │
             └─────────────┬──────────────┘
                           ▼
          ┌──────────────────────────────────┐
          │   Nexconn Chat Real-Time SDK     │
          │  (@nexconn/engine & @nexconn/chat)
          └────────────────┬─────────────────┘
                           │
             ┌─────────────┴──────────────┐
             ▼                            ▼
┌───────────────────────────┐ ┌──────────────────────────┐
│   Resolve AI API Server   │ │   Gemini AI Copilot      │
│   (Node.js + Express)     │ │   - Issue Classification │
│  - Token Minting (/v4)    │ │   - 4-Part Summary       │
│  - Ticket State Mgmt      │ │   - Policy-Aware Suggest │
│  - Retail Policies Engine │ └──────────────────────────┘
└───────────────────────────┘
```

---

## ✨ Core Product Capabilities

### 1. Customer Support Portal (`/customer` or `/`)
- **Demo Customer Switcher:** Seamlessly switch between 3 seeded customer personas:
  - **Aarav Sharma:** Order `#NC1021` (NovaSprint Running Shoes) — Delivery Delay
  - **Priya Mehta:** Order `#NC1022` (NovaPulse Smartwatch) — Refund Request
  - **Kabir Verma:** Order `#NC1023` (NovaBass Wireless Headphones) — Wrong Product Received
- **Order Context Banner:** Instant visibility into order ID, product name, price, carrier, and live tracking status.
- **Request Human Assistance Action:** Direct escalation button notifying the agent queue with high priority.
- **Quick Inquiries:** Pre-configured suggestion chips to accelerate customer inquiry submission.

### 2. Support Agent Dashboard (`/agent`)
- **Operations Header:** Live agent status (Agent Sarah Lin), queue totals, urgent count, and handoff counter.
- **Priority-Based Conversation Inbox:** Filters for *All*, *High Priority*, *Human Requested*, and *Resolved* with search functionality.
- **Real-Time Chat Workspace:** Live incoming message feed, customer vs. agent message bubbles, timestamps, and order detail drawer.
- **Human Handoff & Resolution Workflow:** Action buttons to take over tickets (*In Progress*) or conclude cases (*Mark Resolved*).

### 3. AI Copilot Panel
- **Issue Classification:** Category (*Delivery Delay*, *Refund Request*, *Wrong Product*, etc.), Priority (*Critical*, *High*, *Medium*, *Low*), and Customer Sentiment (*Positive*, *Neutral*, *Frustrated*, *Negative*).
- **Structured 4-Part Summary:**
  1. *What happened*
  2. *What the customer needs*
  3. *What has already been discussed*
  4. *What action is still pending*
- **Policy-Aware Suggested Reply:** AI drafts contextual replies strictly adhering to NovaCart retail business rules (standard 4–6 day delivery window, 7-day return policy, photo verification for damaged/wrong items).
- **Approve and Send:** Support agent reviews, optionally edits, and approves the reply to be dispatched directly through the chat stream.

### 4. Split Demo Mode (`/split`)
- Side-by-side view featuring the Customer Portal on the left and Agent Dashboard on the right for immediate live demonstration and testing.

---

## 🚀 Getting Started

### Prerequisites
- **Node.js:** v18.0.0 or higher (v24+ recommended)
- **npm:** v9.0.0 or higher

### Quick Start (Development Mode)

1. **Clone or enter the project directory:**
   ```bash
   cd ResolveAI_Nexconn
   ```

2. **Configure Environment Variables:**
   Copy the example environment file:
   ```bash
   cp .env.example server/.env
   ```
   *(Optionally populate your `NEXCONN_APP_KEY`, `NEXCONN_APP_SECRET`, and `GEMINI_API_KEY` in `server/.env`).*

3. **Install Dependencies:**
   - Root:
     ```bash
     npm install
     ```
   - Server:
     ```bash
     cd server && npm install && cd ..
     ```
   - Client:
     ```bash
     cd client && npm install && cd ..
     ```

4. **Launch the Application:**
   Run both server and client concurrently:
   ```bash
   npm run dev
   ```
   - **Frontend:** http://localhost:5173
   - **Backend API:** http://localhost:5000
   - **API Health Check:** http://localhost:5000/api/health

---

## 🧪 Verification & Testing

To run the automated backend test suite:
```bash
cd server
npm test
```
The test suite validates:
- API health and environment readiness.
- Knowledge base and policy serving.
- Ticket querying and priority filtering.
- Human handoff escalation state transitions.
- AI conversation classification, summarization, and suggested reply generation.
- Nexconn authentication token issuance.

---

## 🔒 Security & Environment Variables

| Variable | Description | Where to Obtain |
|---|---|---|
| `NEXCONN_APP_KEY` | Public client identifier for Nexconn Chat Engine | [Nexconn Console](https://nexconn.ai) |
| `NEXCONN_APP_SECRET` | Private secret for server-side token signing | [Nexconn Console](https://nexconn.ai) |
| `GEMINI_API_KEY` | LLM API key for AI Copilot features | [Google AI Studio](https://aistudio.google.com) |
| `PORT` | Backend server port (Default: `5000`) | Server configuration |
| `VITE_API_URL` | Backend API URL for frontend client | Frontend configuration |

*Note: All secret keys (`NEXCONN_APP_SECRET`, `GEMINI_API_KEY`) remain strictly on the backend server and are never exposed to the client bundle.*
