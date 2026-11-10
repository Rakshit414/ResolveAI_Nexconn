-- ============================================================================
-- MIGRATION 004: SEED SAMPLE ATTACHMENT FOR CANONICAL DEMO CONVERSATION
-- Purpose: Seeds authentic sample image attachment in PostgreSQL BYTEA for
--          order NC1023 (Kabir Verma - Wrong Product Received) so that
--          the Agent Dashboard and Customer Portal display an initial
--          downloadable attachment out of the box.
-- ============================================================================

INSERT INTO attachments (
    id,
    brand_id,
    ticket_id,
    customer_id,
    storage_key,
    file_name,
    mime_type,
    file_size_bytes,
    file_data
) VALUES (
    'att_seed_sample_nc1023',
    'brand_novacart',
    'tkt_1023',
    'cust_kabir',
    'brands/brand_novacart/tickets/tkt_1023/wrong_wired_earphones_nc1023.png',
    'wrong_wired_earphones_nc1023.png',
    'image/png',
    68,
    decode('89504e470d0a1a0a0000000d4948445200000010000000100802000000909168360000001b49444154789c6360000300002400013915bc550000000049454e44ae426082', 'hex')
)
ON CONFLICT (id) DO UPDATE SET
    file_name = EXCLUDED.file_name,
    mime_type = EXCLUDED.mime_type,
    file_size_bytes = EXCLUDED.file_size_bytes,
    file_data = EXCLUDED.file_data,
    deleted_at = NULL;

-- Link sample attachment to initial seeded customer message in message archive
UPDATE message_archive 
SET attachment_id = 'att_seed_sample_nc1023',
    content_payload = jsonb_set(
        content_payload,
        '{attachment}',
        '{"id":"att_seed_sample_nc1023","name":"wrong_wired_earphones_nc1023.png","size":68,"mimeType":"image/png","downloadUrl":"/api/attachments/att_seed_sample_nc1023/download"}'::jsonb
    )
WHERE id = 'arch_msg_1023';
