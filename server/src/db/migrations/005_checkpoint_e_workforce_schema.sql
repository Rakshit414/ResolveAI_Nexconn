-- ============================================================================
-- RESOLVE AI — MIGRATION 005: CHECKPOINT E WORKFORCE & ROUTING SCHEMA
-- Forward-only, strictly idempotent, non-destructive, and fully transactional.
-- ============================================================================

-- STEP 1: Add allow_general_fallback setting to brands with exhaustive validation
DO $$
DECLARE
    v_col_type TEXT;
    v_nullable TEXT;
    v_default  TEXT;
BEGIN
    SELECT data_type, is_nullable, column_default
    INTO v_col_type, v_nullable, v_default
    FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'brands' AND column_name = 'allow_general_fallback';

    IF v_col_type IS NULL THEN
        ALTER TABLE brands ADD COLUMN allow_general_fallback BOOLEAN NOT NULL DEFAULT FALSE;
    ELSE
        IF v_col_type <> 'boolean' OR v_nullable <> 'NO' OR v_default NOT LIKE '%false%' THEN
            RAISE EXCEPTION 'Schema Incompatibility: brands.allow_general_fallback exists with incompatible definition (type=%, nullable=%, default=%)',
                v_col_type, v_nullable, v_default;
        END IF;
    END IF;
END $$;

-- STEP 2: Support 'Closed' in tickets_status_check constraint with exhaustive validation
DO $$
DECLARE
    v_contype CHAR(1);
    v_condef  TEXT;
    v_valid   BOOLEAN := FALSE;
    v_stripped TEXT;
    v_status_col_type TEXT;
    v_status_nullable TEXT;
BEGIN
    -- Validate tickets.status column definition
    SELECT data_type, is_nullable INTO v_status_col_type, v_status_nullable
    FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'tickets' AND column_name = 'status';

    IF v_status_col_type <> 'character varying' OR v_status_nullable <> 'NO' THEN
        RAISE EXCEPTION 'Schema Incompatibility: tickets.status column definition is incompatible (type=%, nullable=%)',
            v_status_col_type, v_status_nullable;
    END IF;

    SELECT c.contype, pg_get_constraintdef(c.oid)
    INTO v_contype, v_condef
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = current_schema() AND c.conname = 'tickets_status_check' AND c.conrelid = 'tickets'::regclass;

    IF v_condef IS NOT NULL THEN
        IF v_contype <> 'c' THEN
            RAISE EXCEPTION 'Schema Incompatibility: constraint tickets_status_check exists but is not a CHECK constraint (contype=%)', v_contype;
        END IF;

        -- Check if it contains unsupported extra states!
        v_stripped := replace(v_condef, '''AI Handling''', '');
        v_stripped := replace(v_stripped, '''Human Requested''', '');
        v_stripped := replace(v_stripped, '''Human Agent Active''', '');
        v_stripped := replace(v_stripped, '''Resolved''', '');
        v_stripped := replace(v_stripped, '''Closed''', '');

        IF v_stripped LIKE '%''%' THEN
            RAISE EXCEPTION 'Schema Incompatibility: tickets_status_check contains unsupported extra states: %', v_condef;
        END IF;

        -- Validate that all 5 canonical states exist in the check definition
        IF v_condef LIKE '%AI Handling%'
           AND v_condef LIKE '%Human Requested%'
           AND v_condef LIKE '%Human Agent Active%'
           AND v_condef LIKE '%Resolved%'
           AND v_condef LIKE '%Closed%' THEN
            v_valid := TRUE;
        END IF;
    END IF;

    IF NOT v_valid THEN
        IF v_condef IS NOT NULL THEN
            ALTER TABLE tickets DROP CONSTRAINT tickets_status_check;
        END IF;
        ALTER TABLE tickets ADD CONSTRAINT tickets_status_check
            CHECK (status IN ('AI Handling', 'Human Requested', 'Human Agent Active', 'Resolved', 'Closed'));
    END IF;

    -- Explicit post-validation: verify exact constraint definition
    SELECT c.contype, pg_get_constraintdef(c.oid)
    INTO v_contype, v_condef
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = current_schema() AND c.conname = 'tickets_status_check' AND c.conrelid = 'tickets'::regclass;

    v_stripped := replace(v_condef, '''AI Handling''', '');
    v_stripped := replace(v_stripped, '''Human Requested''', '');
    v_stripped := replace(v_stripped, '''Human Agent Active''', '');
    v_stripped := replace(v_stripped, '''Resolved''', '');
    v_stripped := replace(v_stripped, '''Closed''', '');

    IF v_condef IS NULL
       OR v_contype <> 'c'
       OR v_condef NOT LIKE '%AI Handling%'
       OR v_condef NOT LIKE '%Human Requested%'
       OR v_condef NOT LIKE '%Human Agent Active%'
       OR v_condef NOT LIKE '%Resolved%'
       OR v_condef NOT LIKE '%Closed%'
       OR v_stripped LIKE '%''%' THEN
        RAISE EXCEPTION 'Schema Incompatibility: tickets_status_check does not contain exactly the 5 canonical states: %', v_condef;
    END IF;
END $$;

-- STEP 3: Add Persisted Parent-Ticket Relationship to tickets Table
DO $$
DECLARE
    v_col_type TEXT;
    v_pk_condef TEXT;
    v_fk_contype CHAR(1);
    v_fk_condef  TEXT;
    v_idx_def    TEXT;
    v_idx_unique BOOLEAN;
BEGIN
    -- Verify composite primary/unique key on tickets(brand_id, id) exists
    SELECT pg_get_constraintdef(c.oid) INTO v_pk_condef
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = current_schema()
      AND c.conrelid = 'tickets'::regclass
      AND c.contype IN ('p', 'u')
      AND pg_get_constraintdef(c.oid) LIKE '%(brand_id, id)%';

    IF v_pk_condef IS NULL THEN
        RAISE EXCEPTION 'Schema Incompatibility: tickets table lacks composite key on (brand_id, id) required for parent-child relationship';
    END IF;

    -- Validate parent_ticket_id column
    SELECT data_type INTO v_col_type
    FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'tickets' AND column_name = 'parent_ticket_id';

    IF v_col_type IS NULL THEN
        ALTER TABLE tickets ADD COLUMN parent_ticket_id VARCHAR(64);
    ELSIF v_col_type <> 'character varying' THEN
        RAISE EXCEPTION 'Schema Incompatibility: tickets.parent_ticket_id exists with incompatible type %', v_col_type;
    END IF;

    -- Validate foreign key constraint fk_tickets_parent
    SELECT c.contype, pg_get_constraintdef(c.oid)
    INTO v_fk_contype, v_fk_condef
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = current_schema() AND c.conname = 'fk_tickets_parent' AND c.conrelid = 'tickets'::regclass;

    IF v_fk_condef IS NULL THEN
        ALTER TABLE tickets ADD CONSTRAINT fk_tickets_parent
            FOREIGN KEY (brand_id, parent_ticket_id) REFERENCES tickets(brand_id, id) ON DELETE RESTRICT;
    ELSIF v_fk_contype <> 'f'
       OR v_fk_condef NOT LIKE '%FOREIGN KEY (brand_id, parent_ticket_id) REFERENCES tickets(brand_id, id)%'
       OR v_fk_condef NOT LIKE '%ON DELETE RESTRICT%' THEN
        RAISE EXCEPTION 'Schema Incompatibility: constraint fk_tickets_parent exists with incompatible definition %', v_fk_condef;
    END IF;

    -- Validate parent-ticket index
    SELECT i.indisunique, pg_get_indexdef(i.indexrelid)
    INTO v_idx_unique, v_idx_def
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = current_schema() AND c.relname = 'idx_tickets_parent';

    IF v_idx_def IS NULL THEN
        CREATE INDEX idx_tickets_parent ON tickets(brand_id, parent_ticket_id);
    ELSE
        IF v_idx_unique THEN
            RAISE EXCEPTION 'Schema Incompatibility: idx_tickets_parent must not be unique';
        END IF;
        IF v_idx_def NOT LIKE '%(brand_id, parent_ticket_id)%' OR v_idx_def NOT LIKE '%ON %tickets%' THEN
            RAISE EXCEPTION 'Schema Incompatibility: index idx_tickets_parent exists with incompatible definition %', v_idx_def;
        END IF;
    END IF;
END $$;

-- STEP 4: Enable composite policy linking on brand_policies with soft deletion
DO $$
DECLARE
    v_contype CHAR(1);
    v_condef  TEXT;
    v_del_type TEXT;
BEGIN
    SELECT c.contype, pg_get_constraintdef(c.oid)
    INTO v_contype, v_condef
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = current_schema() AND c.conname = 'uq_brand_policies_brand_id' AND c.conrelid = 'brand_policies'::regclass;

    IF v_condef IS NULL THEN
        ALTER TABLE brand_policies ADD CONSTRAINT uq_brand_policies_brand_id UNIQUE (brand_id, id);
    ELSIF v_contype <> 'u' OR v_condef NOT LIKE '%(brand_id, id)%' THEN
        RAISE EXCEPTION 'Schema Incompatibility: constraint uq_brand_policies_brand_id exists with incompatible definition %', v_condef;
    END IF;

    SELECT data_type INTO v_del_type
    FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'brand_policies' AND column_name = 'deleted_at';

    IF v_del_type IS NULL THEN
        ALTER TABLE brand_policies ADD COLUMN deleted_at TIMESTAMPTZ;
    ELSIF v_del_type <> 'timestamp with time zone' THEN
        RAISE EXCEPTION 'Schema Incompatibility: brand_policies.deleted_at exists with incompatible type %', v_del_type;
    END IF;
END $$;

-- STEP 5: Composite Unique Constraint on Canonical message_archive
DO $$
DECLARE
    v_contype CHAR(1);
    v_condef  TEXT;
BEGIN
    SELECT c.contype, pg_get_constraintdef(c.oid)
    INTO v_contype, v_condef
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = current_schema() AND c.conname = 'uq_message_archive_brand_ticket_msg' AND c.conrelid = 'message_archive'::regclass;

    IF v_condef IS NULL THEN
        ALTER TABLE message_archive ADD CONSTRAINT uq_message_archive_brand_ticket_msg UNIQUE (brand_id, ticket_id, nexconn_message_id);
    ELSIF v_contype <> 'u' OR v_condef NOT LIKE '%(brand_id, ticket_id, nexconn_message_id)%' THEN
        RAISE EXCEPTION 'Schema Incompatibility: constraint uq_message_archive_brand_ticket_msg exists with incompatible definition %', v_condef;
    END IF;
END $$;

-- STEP 6: Agent Workforce Profiles & Availability State
CREATE TABLE IF NOT EXISTS agent_profiles (
    brand_id VARCHAR(64) NOT NULL,
    user_id VARCHAR(64) NOT NULL,
    nexconn_user_id VARCHAR(64) NOT NULL,
    display_name VARCHAR(255) NOT NULL,
    avatar_url TEXT,
    configured_status VARCHAR(32) NOT NULL DEFAULT 'Offline'
        CHECK (configured_status IN ('Available', 'Busy', 'Away', 'Offline')),
    status_reason TEXT,
    primary_language VARCHAR(16) NOT NULL DEFAULT 'en-US',
    supported_languages TEXT[] NOT NULL DEFAULT ARRAY['en-US'],
    skills TEXT[] NOT NULL DEFAULT ARRAY['general_inquiry'],
    max_concurrent_tickets INTEGER NOT NULL DEFAULT 3
        CHECK (max_concurrent_tickets >= 1 AND max_concurrent_tickets <= 10),
    active_ticket_count INTEGER NOT NULL DEFAULT 0
        CHECK (active_ticket_count >= 0),
    last_assigned_at TIMESTAMPTZ,
    last_heartbeat_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (brand_id, user_id),
    UNIQUE (nexconn_user_id),
    FOREIGN KEY (brand_id, user_id)
        REFERENCES brand_memberships(brand_id, user_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_agent_profiles_routing
    ON agent_profiles (brand_id, configured_status, active_ticket_count);

-- Exhaustive metadata validation on agent_profiles columns and constraints
DO $$
DECLARE
    v_skills_type TEXT;
    v_active_type TEXT;
    v_max_type TEXT;
    v_status_type TEXT;
    v_active_null TEXT;
    v_max_null TEXT;
    v_status_chk TEXT;
    v_max_chk TEXT;
    v_fk_condef TEXT;
    v_uq_condef TEXT;
BEGIN
    SELECT data_type INTO v_skills_type FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'agent_profiles' AND column_name = 'skills';
    SELECT data_type, is_nullable INTO v_active_type, v_active_null FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'agent_profiles' AND column_name = 'active_ticket_count';
    SELECT data_type, is_nullable INTO v_max_type, v_max_null FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'agent_profiles' AND column_name = 'max_concurrent_tickets';
    SELECT data_type INTO v_status_type FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'agent_profiles' AND column_name = 'configured_status';

    IF v_skills_type <> 'ARRAY' OR v_active_type <> 'integer' OR v_max_type <> 'integer' OR v_status_type <> 'character varying' THEN
        RAISE EXCEPTION 'Schema Incompatibility: agent_profiles columns incompatible (skills=%, active=%, max=%, status=%)',
            v_skills_type, v_active_type, v_max_type, v_status_type;
    END IF;

    IF v_active_null <> 'NO' OR v_max_null <> 'NO' THEN
        RAISE EXCEPTION 'Schema Incompatibility: agent_profiles columns must be NOT NULL (active=%, max=%)', v_active_null, v_max_null;
    END IF;

    -- Validate check constraint on configured_status
    SELECT pg_get_constraintdef(c.oid) INTO v_status_chk
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = current_schema()
      AND c.conrelid = 'agent_profiles'::regclass
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) LIKE '%configured_status%';

    IF v_status_chk IS NULL
       OR v_status_chk NOT LIKE '%Available%'
       OR v_status_chk NOT LIKE '%Busy%'
       OR v_status_chk NOT LIKE '%Away%'
       OR v_status_chk NOT LIKE '%Offline%' THEN
        RAISE EXCEPTION 'Schema Incompatibility: agent_profiles check constraint on configured_status is invalid: %', v_status_chk;
    END IF;

    -- Validate check constraint on max_concurrent_tickets
    SELECT pg_get_constraintdef(c.oid) INTO v_max_chk
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = current_schema()
      AND c.conrelid = 'agent_profiles'::regclass
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) LIKE '%max_concurrent_tickets%';

    IF v_max_chk IS NULL OR v_max_chk NOT LIKE '%1%' OR v_max_chk NOT LIKE '%10%' THEN
        RAISE EXCEPTION 'Schema Incompatibility: agent_profiles check constraint on max_concurrent_tickets is invalid: %', v_max_chk;
    END IF;

    -- Validate foreign key to brand_memberships (including ON DELETE RESTRICT)
    SELECT pg_get_constraintdef(c.oid) INTO v_fk_condef
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = current_schema()
      AND c.conrelid = 'agent_profiles'::regclass
      AND c.contype = 'f'
      AND pg_get_constraintdef(c.oid) LIKE '%REFERENCES brand_memberships(brand_id, user_id)%';

    IF v_fk_condef IS NULL OR v_fk_condef NOT LIKE '%ON DELETE RESTRICT%' THEN
        RAISE EXCEPTION 'Schema Incompatibility: agent_profiles missing foreign key to brand_memberships(brand_id, user_id) with ON DELETE RESTRICT: %', v_fk_condef;
    END IF;

    -- Validate unique constraint on nexconn_user_id
    SELECT pg_get_constraintdef(c.oid) INTO v_uq_condef
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = current_schema()
      AND c.conrelid = 'agent_profiles'::regclass
      AND c.contype = 'u'
      AND pg_get_constraintdef(c.oid) LIKE '%(nexconn_user_id)%';

    IF v_uq_condef IS NULL THEN
        RAISE EXCEPTION 'Schema Incompatibility: agent_profiles missing unique constraint on (nexconn_user_id)';
    END IF;

    -- Validate primary key on (brand_id, user_id)
    DECLARE
        v_pk_condef TEXT;
    BEGIN
        SELECT pg_get_constraintdef(c.oid) INTO v_pk_condef
        FROM pg_constraint c
        JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE n.nspname = current_schema()
          AND c.conrelid = 'agent_profiles'::regclass
          AND c.contype = 'p';

        IF v_pk_condef IS NULL OR v_pk_condef NOT LIKE '%(brand_id, user_id)%' THEN
            RAISE EXCEPTION 'Schema Incompatibility: agent_profiles primary key must be (brand_id, user_id): %', v_pk_condef;
        END IF;
    END;

    -- Validate check constraint on active_ticket_count
    DECLARE
        v_act_chk TEXT;
    BEGIN
        SELECT pg_get_constraintdef(c.oid) INTO v_act_chk
        FROM pg_constraint c
        JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE n.nspname = current_schema()
          AND c.conrelid = 'agent_profiles'::regclass
          AND c.contype = 'c'
          AND pg_get_constraintdef(c.oid) LIKE '%active_ticket_count%';

        IF v_act_chk IS NULL OR v_act_chk NOT LIKE '%0%' THEN
            RAISE EXCEPTION 'Schema Incompatibility: agent_profiles check constraint on active_ticket_count is invalid: %', v_act_chk;
        END IF;
    END;

    -- Validate index idx_agent_profiles_routing
    DECLARE
        v_idx_def TEXT;
    BEGIN
        SELECT pg_get_indexdef(i.indexrelid) INTO v_idx_def
        FROM pg_index i
        JOIN pg_class c ON c.oid = i.indexrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = current_schema() AND c.relname = 'idx_agent_profiles_routing';

        IF v_idx_def IS NULL OR v_idx_def NOT LIKE '%(brand_id, configured_status, active_ticket_count)%' THEN
            RAISE EXCEPTION 'Schema Incompatibility: agent_profiles missing index idx_agent_profiles_routing: %', v_idx_def;
        END IF;
    END;
END $$;

-- STEP 7: Agent Availability Audit History
CREATE TABLE IF NOT EXISTS agent_status_history (
    id VARCHAR(64) PRIMARY KEY,
    brand_id VARCHAR(64) NOT NULL,
    user_id VARCHAR(64) NOT NULL,
    previous_status VARCHAR(32) NOT NULL,
    new_status VARCHAR(32) NOT NULL,
    trigger_source VARCHAR(32) NOT NULL
        CHECK (trigger_source IN ('manual', 'timeout', 'concurrency_limit', 'system', 'reconciliation')),
    reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    FOREIGN KEY (brand_id, user_id)
        REFERENCES agent_profiles(brand_id, user_id) ON DELETE CASCADE
);

-- Exhaustive validation on agent_status_history
DO $$
DECLARE
    v_fk_condef TEXT;
    v_chk_condef TEXT;
    v_id_type TEXT;
BEGIN
    SELECT data_type INTO v_id_type
    FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'agent_status_history' AND column_name = 'id';

    IF v_id_type <> 'character varying' THEN
        RAISE EXCEPTION 'Schema Incompatibility: agent_status_history.id must be character varying, got %', v_id_type;
    END IF;

    SELECT pg_get_constraintdef(c.oid) INTO v_fk_condef
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = current_schema()
      AND c.conrelid = 'agent_status_history'::regclass
      AND c.contype = 'f'
      AND pg_get_constraintdef(c.oid) LIKE '%REFERENCES agent_profiles(brand_id, user_id)%';

    IF v_fk_condef IS NULL OR v_fk_condef NOT LIKE '%ON DELETE CASCADE%' THEN
        RAISE EXCEPTION 'Schema Incompatibility: agent_status_history foreign key to agent_profiles must specify ON DELETE CASCADE: %', v_fk_condef;
    END IF;

    SELECT pg_get_constraintdef(c.oid) INTO v_chk_condef
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = current_schema()
      AND c.conrelid = 'agent_status_history'::regclass
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) LIKE '%trigger_source%';

    IF v_chk_condef IS NULL
       OR v_chk_condef NOT LIKE '%manual%'
       OR v_chk_condef NOT LIKE '%timeout%'
       OR v_chk_condef NOT LIKE '%concurrency_limit%'
       OR v_chk_condef NOT LIKE '%system%'
       OR v_chk_condef NOT LIKE '%reconciliation%' THEN
        RAISE EXCEPTION 'Schema Incompatibility: agent_status_history check constraint on trigger_source is invalid: %', v_chk_condef;
    END IF;

    -- Validate primary key on (id)
    DECLARE
        v_pk_hist TEXT;
    BEGIN
        SELECT pg_get_constraintdef(c.oid) INTO v_pk_hist
        FROM pg_constraint c
        JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE n.nspname = current_schema()
          AND c.conrelid = 'agent_status_history'::regclass
          AND c.contype = 'p';

        IF v_pk_hist IS NULL OR v_pk_hist NOT LIKE '%(id)%' THEN
            RAISE EXCEPTION 'Schema Incompatibility: agent_status_history primary key must be (id): %', v_pk_hist;
        END IF;
    END;

    -- Validate trigger_source NOT NULL
    DECLARE
        v_null_trig TEXT;
    BEGIN
        SELECT is_nullable INTO v_null_trig FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'agent_status_history' AND column_name = 'trigger_source';

        IF v_null_trig <> 'NO' THEN
            RAISE EXCEPTION 'Schema Incompatibility: agent_status_history.trigger_source must be NOT NULL';
        END IF;
    END;
END $$;

-- STEP 8: Brand Routing State (Persisted Round-Robin Fairness)
CREATE TABLE IF NOT EXISTS brand_routing_state (
    brand_id VARCHAR(64) PRIMARY KEY REFERENCES brands(id) ON DELETE CASCADE,
    last_scheduled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    total_tickets_dispatched INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Exhaustive validation on brand_routing_state
DO $$
DECLARE
    v_fk_condef TEXT;
    v_disp_type TEXT;
    v_disp_null TEXT;
BEGIN
    SELECT pg_get_constraintdef(c.oid) INTO v_fk_condef
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = current_schema()
      AND c.conrelid = 'brand_routing_state'::regclass
      AND c.contype = 'f'
      AND pg_get_constraintdef(c.oid) LIKE '%REFERENCES brands(id)%';

    IF v_fk_condef IS NULL OR v_fk_condef NOT LIKE '%ON DELETE CASCADE%' THEN
        RAISE EXCEPTION 'Schema Incompatibility: brand_routing_state foreign key to brands must specify ON DELETE CASCADE: %', v_fk_condef;
    END IF;

    SELECT data_type, is_nullable INTO v_disp_type, v_disp_null
    FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'brand_routing_state' AND column_name = 'total_tickets_dispatched';

    IF v_disp_type <> 'integer' OR v_disp_null <> 'NO' THEN
        RAISE EXCEPTION 'Schema Incompatibility: brand_routing_state.total_tickets_dispatched must be integer NOT NULL, got % (nullable=%)', v_disp_type, v_disp_null;
    END IF;

    -- Validate primary key on (brand_id)
    DECLARE
        v_pk_rout TEXT;
    BEGIN
        SELECT pg_get_constraintdef(c.oid) INTO v_pk_rout
        FROM pg_constraint c
        JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE n.nspname = current_schema()
          AND c.conrelid = 'brand_routing_state'::regclass
          AND c.contype = 'p';

        IF v_pk_rout IS NULL OR v_pk_rout NOT LIKE '%(brand_id)%' THEN
            RAISE EXCEPTION 'Schema Incompatibility: brand_routing_state primary key must be (brand_id): %', v_pk_rout;
        END IF;
    END;

    -- Validate last_scheduled_at NOT NULL
    DECLARE
        v_sched_null TEXT;
    BEGIN
        SELECT is_nullable INTO v_sched_null FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'brand_routing_state' AND column_name = 'last_scheduled_at';

        IF v_sched_null <> 'NO' THEN
            RAISE EXCEPTION 'Schema Incompatibility: brand_routing_state.last_scheduled_at must be NOT NULL';
        END IF;
    END;
END $$;

-- STEP 9: Ticket Routing Queue (Strict NOT NULL Skills & Partial Unique Index)
CREATE TABLE IF NOT EXISTS ticket_routing_queue (
    id VARCHAR(64) PRIMARY KEY,
    brand_id VARCHAR(64) NOT NULL,
    ticket_id VARCHAR(64) NOT NULL,
    customer_id VARCHAR(64) NOT NULL,
    priority VARCHAR(32) NOT NULL DEFAULT 'Medium'
        CHECK (priority IN ('Critical', 'High', 'Medium', 'Low')),
    customer_language VARCHAR(16) NOT NULL DEFAULT 'en-US',
    required_skills TEXT[] NOT NULL DEFAULT ARRAY['general_inquiry']::TEXT[],
    status VARCHAR(32) NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'routing', 'assigned', 'closed', 'cancelled')),
    assigned_agent_id VARCHAR(64),
    routing_worker_id VARCHAR(64),
    routing_lease_token UUID,
    routing_attempts INTEGER DEFAULT 0,
    retry_count INTEGER DEFAULT 0,
    next_routing_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    routing_locked_at TIMESTAMPTZ,
    routing_lease_expires_at TIMESTAMPTZ,
    queued_at TIMESTAMPTZ DEFAULT NOW(),
    assigned_at TIMESTAMPTZ,
    closed_at TIMESTAMPTZ,
    FOREIGN KEY (brand_id, ticket_id) REFERENCES tickets(brand_id, id) ON DELETE CASCADE,
    FOREIGN KEY (brand_id, customer_id) REFERENCES customers(brand_id, id) ON DELETE CASCADE,
    FOREIGN KEY (brand_id, assigned_agent_id) REFERENCES brand_memberships(brand_id, user_id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_ticket_queue
    ON ticket_routing_queue (brand_id, ticket_id)
    WHERE status IN ('queued', 'routing', 'assigned');

CREATE INDEX IF NOT EXISTS idx_ticket_queue_poll
    ON ticket_routing_queue (brand_id, status, priority, next_routing_attempt_at, queued_at);

-- Validate partial unique index definition, uniqueness, columns, and complete predicate
DO $$
DECLARE
    v_is_unique BOOLEAN;
    v_indexdef  TEXT;
    v_fk_tkt    TEXT;
    v_fk_cust   TEXT;
    v_fk_agent  TEXT;
    v_status_chk TEXT;
    v_prio_chk  TEXT;
    v_skills_type TEXT;
BEGIN
    SELECT i.indisunique, pg_get_indexdef(i.indexrelid)
    INTO v_is_unique, v_indexdef
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = current_schema() AND c.relname = 'idx_unique_active_ticket_queue';

    IF v_indexdef IS NULL THEN
        RAISE EXCEPTION 'Schema Incompatibility: idx_unique_active_ticket_queue was not found';
    ELSIF NOT v_is_unique THEN
        RAISE EXCEPTION 'Schema Incompatibility: idx_unique_active_ticket_queue is not unique';
    ELSIF v_indexdef NOT LIKE '%(brand_id, ticket_id)%'
       OR v_indexdef NOT LIKE '%queued%'
       OR v_indexdef NOT LIKE '%routing%'
       OR v_indexdef NOT LIKE '%assigned%' THEN
        RAISE EXCEPTION 'Schema Incompatibility: idx_unique_active_ticket_queue has invalid columns or predicate: %', v_indexdef;
    END IF;

    -- Validate foreign keys on ticket_routing_queue (including ON DELETE CASCADE / RESTRICT)
    SELECT pg_get_constraintdef(c.oid) INTO v_fk_tkt
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = current_schema() AND c.conrelid = 'ticket_routing_queue'::regclass AND c.contype = 'f'
      AND pg_get_constraintdef(c.oid) LIKE '%REFERENCES tickets(brand_id, id)%';

    IF v_fk_tkt IS NULL OR v_fk_tkt NOT LIKE '%ON DELETE CASCADE%' THEN
        RAISE EXCEPTION 'Schema Incompatibility: ticket_routing_queue missing foreign key to tickets(brand_id, id) with ON DELETE CASCADE: %', v_fk_tkt;
    END IF;

    SELECT pg_get_constraintdef(c.oid) INTO v_fk_cust
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = current_schema() AND c.conrelid = 'ticket_routing_queue'::regclass AND c.contype = 'f'
      AND pg_get_constraintdef(c.oid) LIKE '%REFERENCES customers(brand_id, id)%';

    IF v_fk_cust IS NULL OR v_fk_cust NOT LIKE '%ON DELETE CASCADE%' THEN
        RAISE EXCEPTION 'Schema Incompatibility: ticket_routing_queue missing foreign key to customers(brand_id, id) with ON DELETE CASCADE: %', v_fk_cust;
    END IF;

    SELECT pg_get_constraintdef(c.oid) INTO v_fk_agent
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = current_schema() AND c.conrelid = 'ticket_routing_queue'::regclass AND c.contype = 'f'
      AND pg_get_constraintdef(c.oid) LIKE '%REFERENCES brand_memberships(brand_id, user_id)%';

    IF v_fk_agent IS NULL OR v_fk_agent NOT LIKE '%ON DELETE RESTRICT%' THEN
        RAISE EXCEPTION 'Schema Incompatibility: ticket_routing_queue missing foreign key to brand_memberships(brand_id, user_id) with ON DELETE RESTRICT: %', v_fk_agent;
    END IF;

    -- Validate check constraints on status and priority
    SELECT pg_get_constraintdef(c.oid) INTO v_status_chk
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = current_schema()
      AND c.conrelid = 'ticket_routing_queue'::regclass
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) LIKE '%status%';

    IF v_status_chk IS NULL
       OR v_status_chk NOT LIKE '%queued%'
       OR v_status_chk NOT LIKE '%routing%'
       OR v_status_chk NOT LIKE '%assigned%'
       OR v_status_chk NOT LIKE '%closed%'
       OR v_status_chk NOT LIKE '%cancelled%' THEN
        RAISE EXCEPTION 'Schema Incompatibility: ticket_routing_queue status check constraint invalid: %', v_status_chk;
    END IF;

    SELECT pg_get_constraintdef(c.oid) INTO v_prio_chk
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = current_schema()
      AND c.conrelid = 'ticket_routing_queue'::regclass
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) LIKE '%priority%';

    IF v_prio_chk IS NULL
       OR v_prio_chk NOT LIKE '%Critical%'
       OR v_prio_chk NOT LIKE '%High%'
       OR v_prio_chk NOT LIKE '%Medium%'
       OR v_prio_chk NOT LIKE '%Low%' THEN
        RAISE EXCEPTION 'Schema Incompatibility: ticket_routing_queue priority check constraint invalid: %', v_prio_chk;
    END IF;

    -- Validate skills column
    SELECT data_type INTO v_skills_type
    FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'ticket_routing_queue' AND column_name = 'required_skills';

    IF v_skills_type <> 'ARRAY' THEN
        RAISE EXCEPTION 'Schema Incompatibility: ticket_routing_queue.required_skills must be ARRAY, got %', v_skills_type;
    END IF;

    -- Validate primary key on (id)
    DECLARE
        v_pk_q TEXT;
    BEGIN
        SELECT pg_get_constraintdef(c.oid) INTO v_pk_q
        FROM pg_constraint c
        JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE n.nspname = current_schema()
          AND c.conrelid = 'ticket_routing_queue'::regclass
          AND c.contype = 'p';

        IF v_pk_q IS NULL OR v_pk_q NOT LIKE '%(id)%' THEN
            RAISE EXCEPTION 'Schema Incompatibility: ticket_routing_queue primary key must be (id): %', v_pk_q;
        END IF;
    END;

    -- Validate required_skills NOT NULL
    DECLARE
        v_null_skills TEXT;
    BEGIN
        SELECT is_nullable INTO v_null_skills FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'ticket_routing_queue' AND column_name = 'required_skills';

        IF v_null_skills <> 'NO' THEN
            RAISE EXCEPTION 'Schema Incompatibility: ticket_routing_queue.required_skills must be NOT NULL';
        END IF;
    END;

    -- Validate polling index idx_ticket_queue_poll
    DECLARE
        v_poll_def TEXT;
    BEGIN
        SELECT pg_get_indexdef(i.indexrelid) INTO v_poll_def
        FROM pg_index i
        JOIN pg_class c ON c.oid = i.indexrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = current_schema() AND c.relname = 'idx_ticket_queue_poll';

        IF v_poll_def IS NULL OR v_poll_def NOT LIKE '%(brand_id, status, priority, next_routing_attempt_at, queued_at)%' THEN
            RAISE EXCEPTION 'Schema Incompatibility: ticket_routing_queue missing index idx_ticket_queue_poll: %', v_poll_def;
        END IF;
    END;
END $$;

-- STEP 10: Conversation Translations (Composite Foreign Key to message_archive)
CREATE TABLE IF NOT EXISTS message_translations (
    id VARCHAR(64) PRIMARY KEY,
    brand_id VARCHAR(64) NOT NULL,
    ticket_id VARCHAR(64) NOT NULL,
    message_id VARCHAR(128) NOT NULL,
    target_locale VARCHAR(16) NOT NULL,
    source_locale VARCHAR(16) NOT NULL,
    original_text TEXT NOT NULL,
    translated_text TEXT NOT NULL,
    detected_language VARCHAR(16),
    confidence_score NUMERIC(4, 3),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (brand_id, message_id, target_locale),
    CONSTRAINT fk_msg_translations_archive FOREIGN KEY (brand_id, ticket_id, message_id)
        REFERENCES message_archive(brand_id, ticket_id, nexconn_message_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_msg_translations_lookup
    ON message_translations (brand_id, message_id, target_locale);

-- Exhaustive validation on message_translations
DO $$
DECLARE
    v_fk_condef TEXT;
    v_uq_condef TEXT;
BEGIN
    SELECT pg_get_constraintdef(c.oid) INTO v_fk_condef
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = current_schema()
      AND c.conname = 'fk_msg_translations_archive'
      AND c.conrelid = 'message_translations'::regclass;

    IF v_fk_condef IS NULL
       OR v_fk_condef NOT LIKE '%REFERENCES message_archive(brand_id, ticket_id, nexconn_message_id)%'
       OR v_fk_condef NOT LIKE '%ON DELETE CASCADE%' THEN
        RAISE EXCEPTION 'Schema Incompatibility: fk_msg_translations_archive is missing or invalid: %', v_fk_condef;
    END IF;

    SELECT pg_get_constraintdef(c.oid) INTO v_uq_condef
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = current_schema()
      AND c.conrelid = 'message_translations'::regclass
      AND c.contype = 'u'
      AND pg_get_constraintdef(c.oid) LIKE '%(brand_id, message_id, target_locale)%';

    IF v_uq_condef IS NULL THEN
        RAISE EXCEPTION 'Schema Incompatibility: message_translations missing unique constraint on (brand_id, message_id, target_locale)';
    END IF;

    -- Validate primary key on (id)
    DECLARE
        v_pk_trans TEXT;
    BEGIN
        SELECT pg_get_constraintdef(c.oid) INTO v_pk_trans
        FROM pg_constraint c
        JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE n.nspname = current_schema()
          AND c.conrelid = 'message_translations'::regclass
          AND c.contype = 'p';

        IF v_pk_trans IS NULL OR v_pk_trans NOT LIKE '%(id)%' THEN
            RAISE EXCEPTION 'Schema Incompatibility: message_translations primary key must be (id): %', v_pk_trans;
        END IF;
    END;

    -- Validate original_text and translated_text NOT NULL
    DECLARE
        v_null_orig TEXT;
        v_null_tran TEXT;
    BEGIN
        SELECT is_nullable INTO v_null_orig FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'message_translations' AND column_name = 'original_text';
        SELECT is_nullable INTO v_null_tran FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'message_translations' AND column_name = 'translated_text';

        IF v_null_orig <> 'NO' OR v_null_tran <> 'NO' THEN
            RAISE EXCEPTION 'Schema Incompatibility: message_translations original_text and translated_text must be NOT NULL';
        END IF;
    END;

    -- Validate index idx_msg_translations_lookup
    DECLARE
        v_lookup_def TEXT;
    BEGIN
        SELECT pg_get_indexdef(i.indexrelid) INTO v_lookup_def
        FROM pg_index i
        JOIN pg_class c ON c.oid = i.indexrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = current_schema() AND c.relname = 'idx_msg_translations_lookup';

        IF v_lookup_def IS NULL OR v_lookup_def NOT LIKE '%(brand_id, message_id, target_locale)%' THEN
            RAISE EXCEPTION 'Schema Incompatibility: message_translations missing index idx_msg_translations_lookup: %', v_lookup_def;
        END IF;
    END;
END $$;

-- STEP 11: Global UI Translation Cache (Approved Generic Interface Phrases Only)
CREATE TABLE IF NOT EXISTS global_ui_translation_cache (
    id VARCHAR(64) PRIMARY KEY,
    phrase_key VARCHAR(128) NOT NULL,
    source_locale VARCHAR(16) NOT NULL,
    target_locale VARCHAR(16) NOT NULL,
    source_text TEXT NOT NULL,
    translated_text TEXT NOT NULL,
    is_verified BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (phrase_key, target_locale)
);

-- Exhaustive validation on global_ui_translation_cache
DO $$
DECLARE
    v_uq_condef TEXT;
BEGIN
    SELECT pg_get_constraintdef(c.oid) INTO v_uq_condef
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = current_schema()
      AND c.conrelid = 'global_ui_translation_cache'::regclass
      AND c.contype = 'u'
      AND pg_get_constraintdef(c.oid) LIKE '%(phrase_key, target_locale)%';

    IF v_uq_condef IS NULL THEN
        RAISE EXCEPTION 'Schema Incompatibility: global_ui_translation_cache missing unique constraint on (phrase_key, target_locale)';
    END IF;

    -- Validate primary key on (id)
    DECLARE
        v_pk_cache TEXT;
    BEGIN
        SELECT pg_get_constraintdef(c.oid) INTO v_pk_cache
        FROM pg_constraint c
        JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE n.nspname = current_schema()
          AND c.conrelid = 'global_ui_translation_cache'::regclass
          AND c.contype = 'p';

        IF v_pk_cache IS NULL OR v_pk_cache NOT LIKE '%(id)%' THEN
            RAISE EXCEPTION 'Schema Incompatibility: global_ui_translation_cache primary key must be (id): %', v_pk_cache;
        END IF;
    END;

    -- Validate source_text and translated_text NOT NULL
    DECLARE
        v_null_stext TEXT;
        v_null_ttext TEXT;
    BEGIN
        SELECT is_nullable INTO v_null_stext FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'global_ui_translation_cache' AND column_name = 'source_text';
        SELECT is_nullable INTO v_null_ttext FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'global_ui_translation_cache' AND column_name = 'translated_text';

        IF v_null_stext <> 'NO' OR v_null_ttext <> 'NO' THEN
            RAISE EXCEPTION 'Schema Incompatibility: global_ui_translation_cache source_text and translated_text must be NOT NULL';
        END IF;
    END;

    -- Validate is_verified column
    DECLARE
        v_ver_type TEXT;
        v_ver_null TEXT;
    BEGIN
        SELECT data_type, is_nullable INTO v_ver_type, v_ver_null
        FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'global_ui_translation_cache' AND column_name = 'is_verified';

        IF v_ver_type <> 'boolean' OR v_ver_null <> 'NO' THEN
            RAISE EXCEPTION 'Schema Incompatibility: global_ui_translation_cache.is_verified must be boolean NOT NULL, got % (nullable=%)', v_ver_type, v_ver_null;
        END IF;
    END;
END $$;

-- STEP 12: Brand Knowledge Hub (Composite ON DELETE RESTRICT to brand_policies)
CREATE TABLE IF NOT EXISTS brand_knowledge_hub (
    id VARCHAR(64) PRIMARY KEY,
    brand_id VARCHAR(64) NOT NULL,
    policy_id VARCHAR(64),
    category VARCHAR(64) NOT NULL
        CHECK (category IN ('policy', 'faq', 'troubleshooting', 'canned_response', 'product_guide', 'resolved_case')),
    title VARCHAR(255) NOT NULL,
    slug VARCHAR(128) NOT NULL,
    content_markdown TEXT NOT NULL,
    tags TEXT[] DEFAULT ARRAY[]::TEXT[],
    supported_languages TEXT[] DEFAULT ARRAY['en-US']::TEXT[],
    version INTEGER NOT NULL DEFAULT 1,
    published_version INTEGER NOT NULL DEFAULT 1,
    is_published BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (brand_id, slug),
    FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE CASCADE,
    CONSTRAINT fk_knowledge_hub_policy FOREIGN KEY (brand_id, policy_id)
        REFERENCES brand_policies(brand_id, id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_knowledge_search
    ON brand_knowledge_hub (brand_id, category, is_published);

-- Exhaustive validation on brand_knowledge_hub
DO $$
DECLARE
    v_fk_policy TEXT;
    v_uq_slug   TEXT;
    v_chk_cat   TEXT;
BEGIN
    SELECT pg_get_constraintdef(c.oid) INTO v_fk_policy
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = current_schema()
      AND c.conname = 'fk_knowledge_hub_policy'
      AND c.conrelid = 'brand_knowledge_hub'::regclass;

    IF v_fk_policy IS NULL
       OR v_fk_policy NOT LIKE '%REFERENCES brand_policies(brand_id, id)%'
       OR v_fk_policy NOT LIKE '%ON DELETE RESTRICT%' THEN
        RAISE EXCEPTION 'Schema Incompatibility: fk_knowledge_hub_policy is missing or invalid: %', v_fk_policy;
    END IF;

    SELECT pg_get_constraintdef(c.oid) INTO v_uq_slug
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = current_schema()
      AND c.conrelid = 'brand_knowledge_hub'::regclass
      AND c.contype = 'u'
      AND pg_get_constraintdef(c.oid) LIKE '%(brand_id, slug)%';

    IF v_uq_slug IS NULL THEN
        RAISE EXCEPTION 'Schema Incompatibility: brand_knowledge_hub missing unique constraint on (brand_id, slug)';
    END IF;

    -- Validate primary key on (id)
    DECLARE
        v_pk_hub TEXT;
    BEGIN
        SELECT pg_get_constraintdef(c.oid) INTO v_pk_hub
        FROM pg_constraint c
        JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE n.nspname = current_schema()
          AND c.conrelid = 'brand_knowledge_hub'::regclass
          AND c.contype = 'p';

        IF v_pk_hub IS NULL OR v_pk_hub NOT LIKE '%(id)%' THEN
            RAISE EXCEPTION 'Schema Incompatibility: brand_knowledge_hub primary key must be (id): %', v_pk_hub;
        END IF;
    END;

    -- Validate category, title, slug, content_markdown NOT NULL
    DECLARE
        v_null_cat TEXT;
        v_null_title TEXT;
        v_null_slug TEXT;
        v_null_mark TEXT;
    BEGIN
        SELECT is_nullable INTO v_null_cat FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'brand_knowledge_hub' AND column_name = 'category';
        SELECT is_nullable INTO v_null_title FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'brand_knowledge_hub' AND column_name = 'title';
        SELECT is_nullable INTO v_null_slug FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'brand_knowledge_hub' AND column_name = 'slug';
        SELECT is_nullable INTO v_null_mark FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'brand_knowledge_hub' AND column_name = 'content_markdown';

        IF v_null_cat <> 'NO' OR v_null_title <> 'NO' OR v_null_slug <> 'NO' OR v_null_mark <> 'NO' THEN
            RAISE EXCEPTION 'Schema Incompatibility: brand_knowledge_hub required columns must be NOT NULL';
        END IF;
    END;

    SELECT pg_get_constraintdef(c.oid) INTO v_chk_cat
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = current_schema()
      AND c.conrelid = 'brand_knowledge_hub'::regclass
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) LIKE '%category%';

    IF v_chk_cat IS NULL OR v_chk_cat NOT LIKE '%canned_response%' THEN
        RAISE EXCEPTION 'Schema Incompatibility: brand_knowledge_hub category check constraint is invalid: %', v_chk_cat;
    END IF;

    -- Validate FK to brands with ON DELETE CASCADE and index idx_knowledge_search
    DECLARE
        v_fk_brand TEXT;
        v_search_def TEXT;
    BEGIN
        SELECT pg_get_constraintdef(c.oid) INTO v_fk_brand
        FROM pg_constraint c
        JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE n.nspname = current_schema()
          AND c.conrelid = 'brand_knowledge_hub'::regclass
          AND c.contype = 'f'
          AND pg_get_constraintdef(c.oid) LIKE '%REFERENCES brands(id)%';

        IF v_fk_brand IS NULL OR v_fk_brand NOT LIKE '%ON DELETE CASCADE%' THEN
            RAISE EXCEPTION 'Schema Incompatibility: brand_knowledge_hub missing foreign key to brands(id) with ON DELETE CASCADE: %', v_fk_brand;
        END IF;

        SELECT pg_get_indexdef(i.indexrelid) INTO v_search_def
        FROM pg_index i
        JOIN pg_class c ON c.oid = i.indexrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = current_schema() AND c.relname = 'idx_knowledge_search';

        IF v_search_def IS NULL OR v_search_def NOT LIKE '%(brand_id, category, is_published)%' THEN
            RAISE EXCEPTION 'Schema Incompatibility: brand_knowledge_hub missing index idx_knowledge_search: %', v_search_def;
        END IF;
    END;
END $$;

-- STEP 13: Ticket Handoff Summaries & Context Transfer
CREATE TABLE IF NOT EXISTS ticket_handoff_summaries (
    id VARCHAR(64) PRIMARY KEY,
    brand_id VARCHAR(64) NOT NULL,
    ticket_id VARCHAR(64) NOT NULL,
    from_agent_id VARCHAR(64) NOT NULL,
    to_agent_id VARCHAR(64) NOT NULL,
    ai_summary_json JSONB NOT NULL,
    internal_notes TEXT,
    attempted_resolutions TEXT,
    customer_commitments TEXT,
    pending_actions TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    FOREIGN KEY (brand_id, ticket_id)
        REFERENCES tickets(brand_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_handoff_from_agent FOREIGN KEY (brand_id, from_agent_id)
        REFERENCES brand_memberships(brand_id, user_id) ON DELETE RESTRICT,
    CONSTRAINT fk_handoff_to_agent FOREIGN KEY (brand_id, to_agent_id)
        REFERENCES brand_memberships(brand_id, user_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_handoff_ticket
    ON ticket_handoff_summaries (brand_id, ticket_id, created_at DESC);

-- Exhaustive validation on ticket_handoff_summaries
DO $$
DECLARE
    v_fk_tkt  TEXT;
    v_fk_from TEXT;
    v_fk_to   TEXT;
    v_json_type TEXT;
BEGIN
    SELECT pg_get_constraintdef(c.oid) INTO v_fk_tkt
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = current_schema() AND c.conrelid = 'ticket_handoff_summaries'::regclass AND c.contype = 'f'
      AND pg_get_constraintdef(c.oid) LIKE '%REFERENCES tickets(brand_id, id)%';

    SELECT pg_get_constraintdef(c.oid) INTO v_fk_from
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = current_schema() AND c.conname = 'fk_handoff_from_agent' AND c.conrelid = 'ticket_handoff_summaries'::regclass;

    SELECT pg_get_constraintdef(c.oid) INTO v_fk_to
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = current_schema() AND c.conname = 'fk_handoff_to_agent' AND c.conrelid = 'ticket_handoff_summaries'::regclass;

    IF v_fk_tkt IS NULL
       OR v_fk_from IS NULL OR v_fk_from NOT LIKE '%ON DELETE RESTRICT%'
       OR v_fk_to IS NULL OR v_fk_to NOT LIKE '%ON DELETE RESTRICT%' THEN
        RAISE EXCEPTION 'Schema Incompatibility: ticket_handoff_summaries foreign keys are missing or invalid (tkt=%, from=%, to=%)',
            v_fk_tkt, v_fk_from, v_fk_to;
    END IF;

    SELECT data_type INTO v_json_type
    FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'ticket_handoff_summaries' AND column_name = 'ai_summary_json';

    IF v_json_type <> 'jsonb' THEN
        RAISE EXCEPTION 'Schema Incompatibility: ticket_handoff_summaries.ai_summary_json must be jsonb, got %', v_json_type;
    END IF;

    -- Validate primary key on (id)
    DECLARE
        v_pk_hand TEXT;
    BEGIN
        SELECT pg_get_constraintdef(c.oid) INTO v_pk_hand
        FROM pg_constraint c
        JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE n.nspname = current_schema()
          AND c.conrelid = 'ticket_handoff_summaries'::regclass
          AND c.contype = 'p';

        IF v_pk_hand IS NULL OR v_pk_hand NOT LIKE '%(id)%' THEN
            RAISE EXCEPTION 'Schema Incompatibility: ticket_handoff_summaries primary key must be (id): %', v_pk_hand;
        END IF;
    END;

    -- Validate ai_summary_json NOT NULL
    DECLARE
        v_null_json TEXT;
    BEGIN
        SELECT is_nullable INTO v_null_json FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'ticket_handoff_summaries' AND column_name = 'ai_summary_json';

        IF v_null_json <> 'NO' THEN
            RAISE EXCEPTION 'Schema Incompatibility: ticket_handoff_summaries.ai_summary_json must be NOT NULL';
        END IF;
    END;

    -- Validate index idx_handoff_ticket
    DECLARE
        v_handoff_idx TEXT;
    BEGIN
        SELECT pg_get_indexdef(i.indexrelid) INTO v_handoff_idx
        FROM pg_index i
        JOIN pg_class c ON c.oid = i.indexrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = current_schema() AND c.relname = 'idx_handoff_ticket';

        IF v_handoff_idx IS NULL OR v_handoff_idx NOT LIKE '%(brand_id, ticket_id, created_at DESC)%' THEN
            RAISE EXCEPTION 'Schema Incompatibility: ticket_handoff_summaries missing index idx_handoff_ticket: %', v_handoff_idx;
        END IF;
    END;
END $$;

-- STEP 14: Idempotent Backfill for Sarah Lin (Offline by default, NULL heartbeat)
INSERT INTO agent_profiles (
    brand_id, user_id, nexconn_user_id, display_name, avatar_url,
    configured_status, status_reason, primary_language, supported_languages,
    skills, max_concurrent_tickets, active_ticket_count, last_heartbeat_at
) VALUES (
    'brand_novacart', 'user_sarah_lin', 'agent_sarah', 'Sarah Lin',
    'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=150&q=80',
    'Offline',
    'Initial deployment provisioning', 'en-US',
    ARRAY['en-US', 'hi-IN', 'mr-IN'],
    ARRAY['general_inquiry', 'returns', 'logistics', 'damages'],
    3,
    (SELECT COUNT(*) FROM tickets WHERE brand_id = 'brand_novacart' AND assigned_agent_id = 'user_sarah_lin' AND status IN ('Human Agent Active', 'Human Requested')),
    NULL
)
ON CONFLICT (brand_id, user_id) DO UPDATE SET
    nexconn_user_id = EXCLUDED.nexconn_user_id,
    display_name = EXCLUDED.display_name,
    avatar_url = EXCLUDED.avatar_url,
    supported_languages = EXCLUDED.supported_languages,
    skills = EXCLUDED.skills,
    max_concurrent_tickets = EXCLUDED.max_concurrent_tickets;

-- STEP 15: Outbox Reconciliation Audit (Append-Only Ledger & Immutability Trigger)
CREATE TABLE IF NOT EXISTS outbox_reconciliation_audit (
    id VARCHAR(64) PRIMARY KEY,
    outbox_id VARCHAR(64) NOT NULL,
    brand_id VARCHAR(64) NOT NULL,
    operator_id VARCHAR(64) NOT NULL,
    operator_role VARCHAR(64) NOT NULL,
    outcome VARCHAR(64) NOT NULL,
    evidence TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE RESTRICT,
    FOREIGN KEY (outbox_id) REFERENCES outbox_messages(id) ON DELETE RESTRICT
);

-- Index for operational lookup by brand and outbox message
CREATE INDEX IF NOT EXISTS idx_outbox_rec_audit_lookup ON outbox_reconciliation_audit(brand_id, outbox_id);

-- Immutability Function and Trigger
CREATE OR REPLACE FUNCTION prevent_outbox_audit_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'ImmutableAuditError: outbox_reconciliation_audit records are append-only and cannot be updated or deleted';
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'trg_outbox_audit_immutable'
    ) THEN
        CREATE TRIGGER trg_outbox_audit_immutable
        BEFORE UPDATE OR DELETE ON outbox_reconciliation_audit
        FOR EACH ROW
        EXECUTE FUNCTION prevent_outbox_audit_mutation();
    END IF;
END $$;

-- Exhaustive Validation for outbox_reconciliation_audit
DO $$
DECLARE
    v_col_type TEXT;
    v_is_null  TEXT;
    v_trg_name TEXT;
BEGIN
    -- Validate outbox_id column
    SELECT data_type, is_nullable INTO v_col_type, v_is_null
    FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'outbox_reconciliation_audit' AND column_name = 'outbox_id';

    IF v_col_type <> 'character varying' OR v_is_null <> 'NO' THEN
        RAISE EXCEPTION 'Schema Incompatibility: outbox_reconciliation_audit.outbox_id is invalid (type=%, null=%)', v_col_type, v_is_null;
    END IF;

    -- Validate operator_id column
    SELECT data_type, is_nullable INTO v_col_type, v_is_null
    FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'outbox_reconciliation_audit' AND column_name = 'operator_id';

    IF v_col_type <> 'character varying' OR v_is_null <> 'NO' THEN
        RAISE EXCEPTION 'Schema Incompatibility: outbox_reconciliation_audit.operator_id is invalid (type=%, null=%)', v_col_type, v_is_null;
    END IF;

    -- Validate outcome column
    SELECT data_type, is_nullable INTO v_col_type, v_is_null
    FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'outbox_reconciliation_audit' AND column_name = 'outcome';

    IF v_col_type <> 'character varying' OR v_is_null <> 'NO' THEN
        RAISE EXCEPTION 'Schema Incompatibility: outbox_reconciliation_audit.outcome is invalid (type=%, null=%)', v_col_type, v_is_null;
    END IF;

    -- Validate trigger existence
    SELECT tgname INTO v_trg_name
    FROM pg_trigger
    WHERE tgname = 'trg_outbox_audit_immutable';

    IF v_trg_name IS NULL THEN
        RAISE EXCEPTION 'Schema Incompatibility: outbox_reconciliation_audit missing immutability trigger trg_outbox_audit_immutable';
    END IF;
END $$;
