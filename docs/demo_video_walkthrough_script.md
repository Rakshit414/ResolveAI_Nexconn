# Resolve AI — 3-Minute Demo Video Walkthrough Script

**Track:** Marketplace & Support  
**Project:** Resolve AI (Nexconn Build Challenge 2026)  
**Presenter:** Resolve AI Team  
**Duration:** 3 minutes (180 seconds)  

---

## Video Outline & Timing Breakdown

| Timestamp | Section | Visual Focus | Key Narrative |
|---|---|---|---|
| **0:00 - 0:30** | Introduction & The Problem | Slide / Title Animation & Split Screen | Fragmented support channels cost e-commerce brands customers. Introducing Resolve AI. |
| **0:30 - 1:15** | NovaCart Storefront & Embeddable Widget | NovaCart Storefront (`/store`) & Floating Widget | Seamless shopping experience, 1-click support launcher, multilingual chat in English/Hindi. |
| **1:15 - 2:05** | Split-View Agent Cockpit & Gemini Copilot | Agent Dashboard (`/agent` or `/split`) | Agent Sarah Lin receives ticket, inspects verified order items, generates AI copilot draft. |
| **2:05 - 2:35** | Real-Time Nexconn Delivery & Synchronization | Side-by-side Customer & Agent messaging | DirectChannel peer-to-peer delivery, live typing, instant SDK receipt, CSAT rating. |
| **2:35 - 3:00** | Architectural Hardening & Wrap-Up | Architecture Diagram & Singapore Cloud | 17 PostgreSQL tables, exact origin security, Singapore co-location, production readiness. |

---

## Detailed Script & Visual Cues

### Scene 1: Introduction & The Problem (0:00 – 0:30)
- **Visual Cue:** Screen displays the Resolve AI title banner with the subtitle: *"Enterprise Omnichannel Support & Copilot Suite Powered by Nexconn Chat SDK & Gemini AI"*. Quick cut to a frustrated customer with multiple browser tabs open.
- **Presenter (Voiceover):**  
  > *"Modern e-commerce brands lose millions when customer support is slow, disconnected, and lacks order context. Customers want instant answers in their native language, while human agents struggle across fragmented tools.  
  > Welcome to **Resolve AI**—a unified customer communication platform built for the Nexconn Build Challenge 2026. Resolve AI brings together real-time Nexconn chat, Gemini AI intelligence, and enterprise PostgreSQL isolation to deliver effortless, high-trust resolution."*

---

### Scene 2: NovaCart Storefront & Embeddable Widget (0:30 – 1:15)
- **Visual Cue:** Browser opens to `https://resolve-ai-novacart.onrender.com/store`. Highlighting the modern NovaCart electronics store, featuring premium headphones and smart gear. Cursor hovers over the floating Resolve AI launcher badge in the bottom-right corner.
- **Presenter (Voiceover):**  
  > *"Here is **NovaCart**, a premier consumer electronics brand. Embedded right into the storefront is the Resolve AI floating support launcher—loaded with zero styling conflicts via an isolated, sandboxed frame.  
  > Customer Aarav Sharma opens the widget. Resolve AI automatically recognizes his session and active order for the Nova Wireless Headphones.  
  > Aarav types a question in Hindi: 'नमस्ते, मेरी डिलीवरी कब तक आएगी?' (Hello, when will my delivery arrive?).  
  > Notice the instant connection to Nexconn's Singapore gateway. The AI copilot immediately responds in fluent Hindi with Aarav's exact tracking status and expected delivery window."*

---

### Scene 3: Split-View Agent Cockpit & Gemini Copilot (1:15 – 2:05)
- **Visual Cue:** Transition smoothly to the **Split-View Agent Workspace** (`/split` or `/agent`). On the left, Aarav's live customer chat; on the right, Agent Sarah Lin's omnichannel cockpit with customer metadata, order item breakdown, ticket priority, and knowledge base rules.
- **Presenter (Voiceover):**  
  > *"When Aarav requests to speak with a human specialist, Resolve AI routes the ticket seamlessly to Agent Sarah Lin.  
  > Look at Sarah's unified workspace: she doesn't have to scramble between CRM windows. She sees Aarav's verified order `NC-1021`, shipping address, and ticket history right in front of her.  
  > With a single click on **Generate AI Suggestion**, Gemini 1.5 Flash crafts an empathetic, policy-compliant response referencing Aarav's specific package. Sarah can review, refine, or approve the message in seconds."*

---

### Scene 4: Real-Time Nexconn Delivery & Synchronization (2:05 – 2:35)
- **Visual Cue:** Side-by-side browser panes showing Customer Aarav and Agent Sarah in real time. Agent clicks Send; the message appears on Aarav's screen with sub-second latency. Nexconn message ID and delivery status tick to delivered.
- **Presenter (Voiceover):**  
  > *"Watch the real-time interaction powered by Nexconn's `@nexconn/chat` SDK. When Sarah sends her reply, it is transmitted over a secure `DirectChannel` to Nexconn's Singapore edge.  
  > In less than 100 milliseconds, Aarav receives the message on his device.  
  > Aarav replies, thanks Sarah, and submits a 5-star CSAT rating directly through the widget. The ticket status updates automatically to Resolved."*

---

### Scene 5: Architectural Hardening & Wrap-Up (2:35 – 3:00)
- **Visual Cue:** Quick showcase of the system architecture slide: 17 relational PostgreSQL tables, composite key customer-order ownership, fail-closed health endpoint, and Singapore cloud co-location.
- **Presenter (Voiceover):**  
  > *"Under the hood, Resolve AI is engineered for production:  
  > A 17-table relational schema enforces strict customer-order ownership, preventing any cross-tenant data leaks.  
  > In production, the backend fails closed if the database connection is absent, eliminating insecure in-memory mock leaks.  
  > And both our web service and managed database are co-located in Render's Singapore region, delivering maximum speed and reliability.  
  > Resolve AI: Transforming customer support into a competitive advantage. Thank you!"*
