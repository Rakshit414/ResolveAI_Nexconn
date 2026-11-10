-- ============================================================================
-- MIGRATION 003: PERSISTENT ATTACHMENT BLOB STORAGE
-- Purpose: Ensures attachments survive ephemeral filesystem recycles on Render Free tier
-- ============================================================================

ALTER TABLE attachments 
ADD COLUMN IF NOT EXISTS file_data BYTEA;
