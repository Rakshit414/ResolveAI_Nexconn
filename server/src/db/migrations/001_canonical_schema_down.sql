-- ============================================================================
-- RESOLVE AI CANONICAL SCHEMA ROLLBACK (DOWN MIGRATION)
-- ============================================================================

DROP TABLE IF EXISTS brand_policies CASCADE;
DROP TABLE IF EXISTS widget_sessions CASCADE;
DROP TABLE IF EXISTS agent_sessions CASCADE;
DROP TABLE IF EXISTS ticket_feedback CASCADE;
DROP TABLE IF EXISTS webhook_receipts CASCADE;
DROP TABLE IF EXISTS unrouted_messages CASCADE;
DROP TABLE IF EXISTS message_archive CASCADE;
DROP TABLE IF EXISTS outbox_messages CASCADE;
DROP TABLE IF EXISTS conversation_mappings CASCADE;
DROP TABLE IF EXISTS attachments CASCADE;
DROP TABLE IF EXISTS idempotency_keys CASCADE;
DROP TABLE IF EXISTS tickets CASCADE;
DROP TABLE IF EXISTS orders CASCADE;
DROP TABLE IF EXISTS customers CASCADE;
DROP TABLE IF EXISTS brand_memberships CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS brands CASCADE;
