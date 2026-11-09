-- ============================================================================
-- RESOLVE AI PRODUCTION SCHEMA (CANONICAL AUDITED DDL — EXACTLY 17 TABLES)
-- ============================================================================

-- TABLE 1: Brands / Tenants (Unique Support Identity per Brand)
CREATE TABLE IF NOT EXISTS brands (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    logo_url TEXT,
    support_identity VARCHAR(64) UNIQUE NOT NULL, -- Distinct Nexconn identity per brand
    allowed_origins TEXT[] NOT NULL DEFAULT '{}',
    api_key_hash VARCHAR(128) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (id, support_identity) -- Required for conversation mapping FK
);

-- TABLE 2: Authenticated Principals (Users: Human Agents & Admins)
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(64) PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    avatar_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- TABLE 3: Brand Memberships (Tenant-Scoped User Roles with Soft Deactivation)
CREATE TABLE IF NOT EXISTS brand_memberships (
    id VARCHAR(64) PRIMARY KEY,
    brand_id VARCHAR(64) NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(32) NOT NULL DEFAULT 'agent' CHECK (role IN ('admin', 'agent', 'support_lead')),
    deactivated_at TIMESTAMPTZ, -- Soft-deactivation preserves historical assignment integrity
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (brand_id, user_id)  -- Required for ticket agent assignment and session FKs
);
CREATE INDEX IF NOT EXISTS idx_memberships_user ON brand_memberships(user_id);

-- TABLE 4: Customers Table (Global Nexconn Uniqueness & Composite Integrity)
CREATE TABLE IF NOT EXISTS customers (
    id VARCHAR(64) NOT NULL,
    brand_id VARCHAR(64) NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255), -- Nullable for anonymous guest visitors
    avatar_url TEXT,
    nexconn_user_id VARCHAR(64) UNIQUE NOT NULL, -- Globally unique across the entire Nexconn App Key
    is_guest BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (brand_id, id),
    UNIQUE (brand_id, id, nexconn_user_id), -- Required for conversation mapping FK
    UNIQUE (brand_id, email)                -- Unique on non-null emails per brand
);
CREATE INDEX IF NOT EXISTS idx_customers_brand_nexconn ON customers(brand_id, nexconn_user_id);

-- TABLE 5: Orders Table (Enforces Customer-Order Ownership)
CREATE TABLE IF NOT EXISTS orders (
    id VARCHAR(64) NOT NULL,
    brand_id VARCHAR(64) NOT NULL,
    customer_id VARCHAR(64) NOT NULL,
    order_number VARCHAR(64) NOT NULL,
    product_name VARCHAR(255) NOT NULL,
    product_image TEXT,
    price NUMERIC(10, 2) NOT NULL CHECK (price >= 0),
    currency VARCHAR(3) NOT NULL DEFAULT 'USD' CHECK (currency IN ('USD', 'INR', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY')),
    status VARCHAR(64) NOT NULL,
    purchase_date TIMESTAMPTZ,
    delivered_date TIMESTAMPTZ,
    carrier VARCHAR(100),
    tracking_number VARCHAR(100),
    tracking_status TEXT,
    deleted_at TIMESTAMPTZ, -- Soft deletion support
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (brand_id, id),
    FOREIGN KEY (brand_id, customer_id) REFERENCES customers(brand_id, id) ON DELETE CASCADE,
    UNIQUE (brand_id, order_number),
    UNIQUE (brand_id, id, customer_id) -- Required for ticket customer-order ownership FK
);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(brand_id, customer_id);

-- TABLE 6: Tickets Table (Strict Customer-Order Ownership & Membership Integrity)
CREATE TABLE IF NOT EXISTS tickets (
    id VARCHAR(64) NOT NULL,
    brand_id VARCHAR(64) NOT NULL,
    customer_id VARCHAR(64) NOT NULL,
    order_id VARCHAR(64),
    category VARCHAR(64) NOT NULL,
    priority VARCHAR(32) NOT NULL DEFAULT 'Medium' 
        CHECK (priority IN ('Low', 'Medium', 'High', 'Critical')),
    sentiment VARCHAR(32) NOT NULL DEFAULT 'Neutral' 
        CHECK (sentiment IN ('Positive', 'Neutral', 'Frustrated', 'Angry')),
    status VARCHAR(64) NOT NULL DEFAULT 'AI Handling' 
        CHECK (status IN ('AI Handling', 'Human Requested', 'Human Agent Active', 'Resolved')),
    human_requested BOOLEAN DEFAULT FALSE,
    summary TEXT,
    suggested_reply TEXT,
    pending_action TEXT,
    assigned_agent_id VARCHAR(64),
    last_updated TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (brand_id, id),
    UNIQUE (brand_id, id, customer_id), -- Required for attachment and conversation mapping FKs
    FOREIGN KEY (brand_id, customer_id) REFERENCES customers(brand_id, id) ON DELETE CASCADE,
    -- Strictly prevents Aarav from opening a ticket against Priya's order:
    FOREIGN KEY (brand_id, order_id, customer_id) 
        REFERENCES orders(brand_id, id, customer_id) ON DELETE RESTRICT,
    -- Enforces assigned agent must be an active or historical member of the brand:
    FOREIGN KEY (brand_id, assigned_agent_id) 
        REFERENCES brand_memberships(brand_id, user_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_tickets_brand_status ON tickets(brand_id, status);
CREATE INDEX IF NOT EXISTS idx_tickets_brand_agent ON tickets(brand_id, assigned_agent_id);
CREATE INDEX IF NOT EXISTS idx_tickets_brand_customer ON tickets(brand_id, customer_id);

-- TABLE 7: Request-Level Idempotency Keys (With Payload Hash Protection)
CREATE TABLE IF NOT EXISTS idempotency_keys (
    brand_id VARCHAR(64) NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
    request_scope VARCHAR(64) NOT NULL DEFAULT 'ticket_creation',
    idempotency_key VARCHAR(128) NOT NULL,
    request_hash VARCHAR(64) NOT NULL, -- SHA-256 of canonical request payload
    ticket_id VARCHAR(64) NOT NULL,
    response_code INTEGER NOT NULL,
    response_body JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
    PRIMARY KEY (brand_id, request_scope, idempotency_key),
    FOREIGN KEY (brand_id, ticket_id) REFERENCES tickets(brand_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_idempotency_expiry ON idempotency_keys(expires_at);

-- TABLE 8: Attachments Table (Strict Customer & Ticket Ownership with Soft Deletion)
CREATE TABLE IF NOT EXISTS attachments (
    id VARCHAR(64) PRIMARY KEY,
    brand_id VARCHAR(64) NOT NULL,
    ticket_id VARCHAR(64) NOT NULL,
    customer_id VARCHAR(64) NOT NULL,
    storage_key VARCHAR(512) NOT NULL, -- Stable object key in private object store
    file_name VARCHAR(255) NOT NULL,
    mime_type VARCHAR(100) NOT NULL CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/webp')),
    file_size_bytes INTEGER NOT NULL CHECK (file_size_bytes > 0 AND file_size_bytes <= 5242880), -- > 0 and <= 5MB
    deleted_at TIMESTAMPTZ, -- Soft deletion support
    uploaded_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (brand_id, ticket_id, id), -- Required for message archive attachment FK
    -- Enforces attachment customer MUST match the ticket customer:
    FOREIGN KEY (brand_id, ticket_id, customer_id) 
        REFERENCES tickets(brand_id, id, customer_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_attachments_ticket ON attachments(brand_id, ticket_id);

-- TABLE 9: Conversation Mappings Table (Full Integrity Enforced)
CREATE TABLE IF NOT EXISTS conversation_mappings (
    id VARCHAR(64) PRIMARY KEY,
    brand_id VARCHAR(64) NOT NULL,
    ticket_id VARCHAR(64) NOT NULL,
    customer_id VARCHAR(64) NOT NULL,
    customer_user_id VARCHAR(64) NOT NULL,
    conversation_key VARCHAR(128) NOT NULL,
    support_identity VARCHAR(64) NOT NULL,
    last_message_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (brand_id, ticket_id, id), -- Required for outbox conversation link
    -- Enforces mapped customer is exactly the customer attached to the ticket:
    FOREIGN KEY (brand_id, ticket_id, customer_id) 
        REFERENCES tickets(brand_id, id, customer_id) ON DELETE CASCADE,
    -- Enforces Nexconn identity corresponds to that application customer:
    FOREIGN KEY (brand_id, customer_id, customer_user_id) 
        REFERENCES customers(brand_id, id, nexconn_user_id) ON DELETE CASCADE,
    -- Enforces support identity corresponds to that brand:
    FOREIGN KEY (brand_id, support_identity) 
        REFERENCES brands(id, support_identity) ON DELETE RESTRICT,
    UNIQUE (brand_id, conversation_key),
    UNIQUE (brand_id, ticket_id)
);
CREATE INDEX IF NOT EXISTS idx_conv_brand_customer ON conversation_mappings(brand_id, customer_user_id);

-- TABLE 10: Transactional Outbox for Server-Side Outbound Nexconn Messages
CREATE TABLE IF NOT EXISTS outbox_messages (
    id VARCHAR(64) PRIMARY KEY,
    brand_id VARCHAR(64) NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
    ticket_id VARCHAR(64) NOT NULL,
    conversation_mapping_id VARCHAR(64) NOT NULL,
    dedupe_key VARCHAR(128) UNIQUE NOT NULL, -- Stable idempotency/deduplication key
    target_user_id VARCHAR(64) NOT NULL,
    sender_user_id VARCHAR(64) NOT NULL,
    message_type VARCHAR(64) NOT NULL DEFAULT 'RC:TxtMsg',
    message_text TEXT NOT NULL,
    content_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    dispatch_status VARCHAR(32) NOT NULL DEFAULT 'pending' 
        CHECK (dispatch_status IN ('pending', 'dispatching', 'dispatched', 'uncertain', 'failed')),
    nexconn_message_id VARCHAR(128),
    worker_id VARCHAR(64),
    locked_at TIMESTAMPTZ,
    lease_expires_at TIMESTAMPTZ,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    attempt_count INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 5,
    last_error TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    dispatched_at TIMESTAMPTZ,
    FOREIGN KEY (brand_id, ticket_id) REFERENCES tickets(brand_id, id) ON DELETE CASCADE,
    -- Strictly links outbox to verified conversation mapping:
    FOREIGN KEY (brand_id, ticket_id, conversation_mapping_id) 
        REFERENCES conversation_mappings(brand_id, ticket_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_outbox_queue ON outbox_messages(dispatch_status, next_attempt_at) 
    WHERE dispatch_status IN ('pending', 'failed', 'uncertain');
CREATE INDEX IF NOT EXISTS idx_outbox_lease ON outbox_messages(dispatch_status, lease_expires_at) 
    WHERE dispatch_status = 'dispatching';

-- TABLE 11: Durable Message Archive (Text & Media Support)
CREATE TABLE IF NOT EXISTS message_archive (
    id VARCHAR(64) PRIMARY KEY,
    brand_id VARCHAR(64) NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
    ticket_id VARCHAR(64) NOT NULL,
    nexconn_message_id VARCHAR(128) UNIQUE NOT NULL,
    sender_user_id VARCHAR(64) NOT NULL,
    target_user_id VARCHAR(64) NOT NULL,
    sender_role VARCHAR(32) NOT NULL CHECK (sender_role IN ('customer', 'agent', 'system', 'ai')),
    sender_name VARCHAR(255) NOT NULL,
    message_type VARCHAR(64) NOT NULL DEFAULT 'RC:TxtMsg',
    message_text TEXT, -- Nullable for image/file messages without text caption
    content_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    attachment_id VARCHAR(64),
    sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (brand_id, ticket_id) REFERENCES tickets(brand_id, id) ON DELETE CASCADE,
    -- Composite RESTRICT FK prevents nullifying brand_id/ticket_id on attachment soft deletion:
    FOREIGN KEY (brand_id, ticket_id, attachment_id) 
        REFERENCES attachments(brand_id, ticket_id, id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_msg_archive_ticket ON message_archive(brand_id, ticket_id, sent_at);

-- TABLE 12: Unrouted / Ambiguous Messages Queue (Supports Global Quarantine)
CREATE TABLE IF NOT EXISTS unrouted_messages (
    id VARCHAR(64) PRIMARY KEY,
    brand_id VARCHAR(64) REFERENCES brands(id) ON DELETE CASCADE, -- NULLABLE for global quarantine of unrecognized brands!
    sender_user_id VARCHAR(64) NOT NULL,
    recipient_user_id VARCHAR(64) NOT NULL,
    nexconn_message_id VARCHAR(128) UNIQUE NOT NULL,
    message_type VARCHAR(64) NOT NULL,
    message_text TEXT,
    content_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    ambiguity_reason VARCHAR(64) NOT NULL 
        CHECK (ambiguity_reason IN ('MULTIPLE_ACTIVE_TICKETS', 'NO_ACTIVE_TICKET', 'UNKNOWN_SENDER', 'UNRECOGNIZED_BRAND')),
    candidate_ticket_ids TEXT[] NOT NULL DEFAULT '{}',
    resolution_status VARCHAR(32) NOT NULL DEFAULT 'pending' 
        CHECK (resolution_status IN ('pending', 'routed', 'dismissed')),
    resolved_ticket_id VARCHAR(64),
    resolved_by_user_id VARCHAR(64),
    resolved_at TIMESTAMPTZ,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Enforces resolved ticket belongs to the same brand:
    FOREIGN KEY (brand_id, resolved_ticket_id) 
        REFERENCES tickets(brand_id, id) ON DELETE SET NULL,
    -- Enforces resolving agent is a registered member of that brand:
    FOREIGN KEY (brand_id, resolved_by_user_id) 
        REFERENCES brand_memberships(brand_id, user_id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_unrouted_pending ON unrouted_messages(brand_id, resolution_status) 
    WHERE resolution_status = 'pending';

-- TABLE 13: Durable Webhook Receipts Ledger (Event Deduplication)
CREATE TABLE IF NOT EXISTS webhook_receipts (
    event_id VARCHAR(128) PRIMARY KEY, -- Nexconn msgUID / event ID
    event_type VARCHAR(64) NOT NULL,
    brand_id VARCHAR(64) REFERENCES brands(id) ON DELETE SET NULL,
    raw_payload JSONB NOT NULL,
    signature VARCHAR(128) NOT NULL,
    nonce VARCHAR(32) NOT NULL,
    timestamp_ms BIGINT NOT NULL,
    processing_status VARCHAR(32) NOT NULL DEFAULT 'received' 
        CHECK (processing_status IN ('received', 'processed', 'ignored', 'failed')),
    error_message TEXT,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_webhook_status ON webhook_receipts(processing_status) 
    WHERE processing_status = 'received';

-- TABLE 14: Ticket Feedback Table (Tenant-Enforced)
CREATE TABLE IF NOT EXISTS ticket_feedback (
    id VARCHAR(64) PRIMARY KEY,
    brand_id VARCHAR(64) NOT NULL,
    ticket_id VARCHAR(64) NOT NULL,
    resolved BOOLEAN NOT NULL,
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    comment TEXT,
    submitted_at TIMESTAMPTZ DEFAULT NOW(),
    FOREIGN KEY (brand_id, ticket_id) REFERENCES tickets(brand_id, id) ON DELETE CASCADE,
    UNIQUE (brand_id, ticket_id)
);

-- TABLE 15: Persistent Agent Sessions Table (Membership Enforced)
CREATE TABLE IF NOT EXISTS agent_sessions (
    id VARCHAR(64) PRIMARY KEY,
    brand_id VARCHAR(64) NOT NULL,
    user_id VARCHAR(64) NOT NULL,
    session_token_hash VARCHAR(64) UNIQUE NOT NULL, -- SHA-256 of opaque session token
    csrf_token VARCHAR(64) NOT NULL,
    ip_address VARCHAR(45),
    user_agent TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    -- Enforces agent cannot establish a session for a brand where they are not a member:
    FOREIGN KEY (brand_id, user_id) 
        REFERENCES brand_memberships (brand_id, user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_agent_session_lookup ON agent_sessions(session_token_hash) 
    WHERE revoked_at IS NULL;

-- TABLE 16: Secure Customer Widget Sessions Table
CREATE TABLE IF NOT EXISTS widget_sessions (
    id VARCHAR(64) PRIMARY KEY,
    brand_id VARCHAR(64) NOT NULL,
    customer_id VARCHAR(64) NOT NULL,
    session_token_hash VARCHAR(64) UNIQUE NOT NULL, -- SHA-256 of opaque widget token
    origin VARCHAR(255) NOT NULL,
    is_guest BOOLEAN DEFAULT FALSE,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    FOREIGN KEY (brand_id, customer_id) REFERENCES customers(brand_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sessions_lookup ON widget_sessions(session_token_hash) 
    WHERE revoked_at IS NULL;

-- TABLE 17: Brand Knowledge Base & Policies
CREATE TABLE IF NOT EXISTS brand_policies (
    id VARCHAR(64) PRIMARY KEY,
    brand_id VARCHAR(64) NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
    topic VARCHAR(128) NOT NULL,
    rule TEXT NOT NULL,
    action_guideline TEXT NOT NULL,
    priority_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (brand_id, topic)
);
