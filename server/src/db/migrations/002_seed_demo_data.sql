-- ============================================================================
-- RESOLVE AI SEED DEMO DATA (IMMUTABLE CANONICAL RECORDS)
-- ============================================================================

-- 1. Brand: NovaCart
INSERT INTO brands (id, name, slug, support_identity, allowed_origins, api_key_hash)
VALUES (
    'brand_novacart',
    'NovaCart',
    'novacart',
    'novacart_support',
    ARRAY['http://localhost:5173', 'http://localhost:5000', 'https://resolve-ai-novacart.onrender.com'],
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
)
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    support_identity = EXCLUDED.support_identity,
    allowed_origins = EXCLUDED.allowed_origins;

-- 2. Principal: Sarah Lin (Demo Support Specialist)
INSERT INTO users (id, email, password_hash, name, avatar_url)
VALUES (
    'user_sarah_lin',
    'sarah.lin@novacart.com',
    '$2b$10$aX/P2ZbWKxWVNqUzSYZcq.MRg4nQLiV8hHS6faZE0nOeZHu8u73oe',
    'Sarah Lin',
    'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=150&q=80'
)
ON CONFLICT (id) DO NOTHING;

-- 3. Membership: Sarah Lin @ NovaCart
INSERT INTO brand_memberships (id, brand_id, user_id, role)
VALUES (
    'mem_sarah_novacart',
    'brand_novacart',
    'user_sarah_lin',
    'agent'
)
ON CONFLICT (brand_id, user_id) DO NOTHING;

-- 4. Demo Customers (Preserving Exact Personas)
INSERT INTO customers (id, brand_id, name, email, avatar_url, nexconn_user_id, is_guest)
VALUES 
    ('cust_aarav', 'brand_novacart', 'Aarav Sharma', 'aarav.sharma@example.com', 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&q=80', 'cust_aarav', false),
    ('cust_priya', 'brand_novacart', 'Priya Mehta', 'priya.mehta@example.com', 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=150&q=80', 'cust_priya', false),
    ('cust_kabir', 'brand_novacart', 'Kabir Verma', 'kabir.verma@example.com', 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?auto=format&fit=crop&w=150&q=80', 'cust_kabir', false)
ON CONFLICT (brand_id, email) DO UPDATE SET
    name = EXCLUDED.name,
    avatar_url = EXCLUDED.avatar_url;

-- 5. Demo Orders (Preserving Approved Carriers, Tracking, & USD Currency)
INSERT INTO orders (id, brand_id, customer_id, order_number, product_name, product_image, price, currency, status, purchase_date, carrier, tracking_number, tracking_status)
VALUES 
    (
        'ord_1021', 'brand_novacart', 'cust_aarav', 'NC1021',
        'Running Shoes (NovaSprint Pro - Blue/Grey)',
        'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=150&q=80',
        119.99, 'USD', 'Delayed', '2026-11-02T00:00:00Z',
        'FedEx Express', 'TRK-NC-882910',
        'Package held at regional logistics hub due to customs clearance check'
    ),
    (
        'ord_1022', 'brand_novacart', 'cust_priya', 'NC1022',
        'Smartwatch (NovaPulse Smartwatch - Obsidian)',
        'https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=150&q=80',
        249.50, 'USD', 'Delivered', '2026-10-28T00:00:00Z',
        'UPS Next Day', 'TRK-NC-773821',
        'Delivered to customer doorstep'
    ),
    (
        'ord_1023', 'brand_novacart', 'cust_kabir', 'NC1023',
        'Wireless Headphones (NovaBass ANC - Matte Black)',
        'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=150&q=80',
        89.00, 'USD', 'Delivered', '2026-11-03T00:00:00Z',
        'DHL Express', 'TRK-NC-449102',
        'Delivered to receptionist'
    )
ON CONFLICT (brand_id, order_number) DO NOTHING;

-- 6. Demo Tickets (Preserving Approved Status, Priority, Summary, Suggested Replies)
INSERT INTO tickets (id, brand_id, customer_id, order_id, category, priority, sentiment, status, human_requested, summary, suggested_reply, pending_action, assigned_agent_id)
VALUES 
    (
        'tkt_1021', 'brand_novacart', 'cust_aarav', 'ord_1021',
        'Delivery Delay', 'High', 'Frustrated', 'AI Handling', false,
        'Customer ordered NovaSprint Pro Running Shoes (NC1021) on Nov 2. Package is delayed at the regional logistics hub. Customer is frustrated about missing the Nov 5 delivery target.',
        'Hello Aarav, I sincerely apologize for the delay with your NovaSprint Pro shoes (Order #NC1021). I just checked our courier dispatch system: your package is currently at the regional distribution center undergoing a transit scan. Standard delivery takes 4–6 business days, and while your order was delayed by unexpected hub congestion, I have flagged it for priority movement. I will monitor this shipment and update you within 24 hours.',
        'Agent needs to coordinate with courier hub and confirm priority tracking dispatch.',
        NULL
    ),
    (
        'tkt_1022', 'brand_novacart', 'cust_priya', 'ord_1022',
        'Refund Request', 'Medium', 'Neutral', 'AI Handling', false,
        'Customer received the NovaPulse Smartwatch (NC1022) on Nov 6 (2 days ago, within our 7-day refund window). Wants to return for a full refund due to ergonomic fit.',
        'Hello Priya! Thank you for reaching out to NovaCart Support. Since your order #NC1022 was delivered on Nov 6, you are well within our 7-day hassle-free return window. I can initiate your return label immediately. The refund of $249.50 will be credited back to your original payment method once the package is scanned by our return courier.',
        'Agent to generate prepaid return shipping label and confirm pickup schedule.',
        NULL
    ),
    (
        'tkt_1023', 'brand_novacart', 'cust_kabir', 'ord_1023',
        'Wrong Product', 'Critical', 'Angry', 'AI Handling', false,
        'Wrong item delivered for order NC1023. Customer ordered NovaBass ANC Wireless Headphones ($89.00) but received wired earphones. Highly dissatisfied, demanding instant resolution.',
        'Hello Kabir, I am very sorry for this fulfillment mistake. Receiving the wrong item is completely unacceptable. I have expedited a replacement pair of NovaBass ANC Wireless Headphones to ship today via DHL Priority at no charge, and scheduled a reverse pickup for the incorrect wired earphones.',
        'Agent needs to escalate fulfillment mismatch with warehouse manager and authorize replacement unit dispatch.',
        NULL
    )
ON CONFLICT (brand_id, id) DO NOTHING;

-- 7. Conversation Mappings
INSERT INTO conversation_mappings (id, brand_id, ticket_id, customer_id, customer_user_id, conversation_key, support_identity)
VALUES 
    ('map_1021', 'brand_novacart', 'tkt_1021', 'cust_aarav', 'cust_aarav', 'conv_novacart_NC1021', 'novacart_support'),
    ('map_1022', 'brand_novacart', 'tkt_1022', 'cust_priya', 'cust_priya', 'conv_novacart_NC1022', 'novacart_support'),
    ('map_1023', 'brand_novacart', 'tkt_1023', 'cust_kabir', 'cust_kabir', 'conv_novacart_NC1023', 'novacart_support')
ON CONFLICT (brand_id, ticket_id) DO NOTHING;

-- 8. Seed Initial Conversation Messages in Message Archive
INSERT INTO message_archive (id, brand_id, ticket_id, nexconn_message_id, sender_user_id, target_user_id, sender_role, sender_name, message_type, message_text, content_payload)
VALUES 
    (
        'arch_msg_1021', 'brand_novacart', 'tkt_1021', 'msg_seed_cust_aarav_NC1021',
        'cust_aarav', 'novacart_support', 'customer', 'Aarav Sharma', 'RC:TxtMsg',
        'Hi, I ordered the NovaSprint Pro shoes 6 days ago (Order NC1021) and the tracking hasn''t moved since yesterday. It was supposed to be here Nov 5th! Can you check what''s going on?',
        '{"content":"Hi, I ordered the NovaSprint Pro shoes 6 days ago (Order NC1021) and the tracking hasn''t moved since yesterday. It was supposed to be here Nov 5th! Can you check what''s going on?","extra":"{\"ticketId\":\"tkt_1021\",\"brandId\":\"brand_novacart\"}"}'::jsonb
    ),
    (
        'arch_msg_1022', 'brand_novacart', 'tkt_1022', 'msg_seed_cust_priya_NC1022',
        'cust_priya', 'novacart_support', 'customer', 'Priya Mehta', 'RC:TxtMsg',
        'Hello, I received the NovaPulse Smartwatch (Order NC1022) two days ago. It is too bulky for my wrist and doesn''t track my heart rate properly. I''d like to return it and get a refund please.',
        '{"content":"Hello, I received the NovaPulse Smartwatch (Order NC1022) two days ago. It is too bulky for my wrist and doesn''t track my heart rate properly. I''d like to return it and get a refund please.","extra":"{\"ticketId\":\"tkt_1022\",\"brandId\":\"brand_novacart\"}"}'::jsonb
    ),
    (
        'arch_msg_1023', 'brand_novacart', 'tkt_1023', 'msg_seed_cust_kabir_NC1023',
        'cust_kabir', 'novacart_support', 'customer', 'Kabir Verma', 'RC:TxtMsg',
        'I am really annoyed. I ordered the NovaBass Wireless ANC Headphones (NC1023) and today I opened the box to find cheap wired earbuds! I need this sorted immediately or I''m doing a chargeback.',
        '{"content":"I am really annoyed. I ordered the NovaBass Wireless ANC Headphones (NC1023) and today I opened the box to find cheap wired earbuds! I need this sorted immediately or I''m doing a chargeback.","extra":"{\"ticketId\":\"tkt_1023\",\"brandId\":\"brand_novacart\"}"}'::jsonb
    )
ON CONFLICT (nexconn_message_id) DO NOTHING;

-- 9. Knowledge Base Policies
INSERT INTO brand_policies (id, brand_id, topic, rule, action_guideline, priority_order)
VALUES 
    (
        'pol_1', 'brand_novacart', 'Delivery Timeframe',
        'Standard delivery takes 4–6 business days from the dispatch date.',
        'Check warehouse dispatch logs before confirming or promising revised delivery times.',
        1
    ),
    (
        'pol_2', 'brand_novacart', 'Refund Window',
        'Customers can request a return and refund within 7 days of confirmed delivery.',
        'Calculate days since delivery. If within 7 days, guide customer through return portal.',
        2
    ),
    (
        'pol_3', 'brand_novacart', 'Damaged or Wrong Product',
        'Immediate replacement or full refund on damaged/incorrect items with photo proof.',
        'Prioritize replacement dispatch; request clear package label and product photos.',
        3
    ),
    (
        'pol_4', 'brand_novacart', 'Order Cancellation',
        'Orders can be cancelled before warehouse processing begins (typically within 2 hours of placement).',
        'Verify order status in OMS. If status is "Processing" or later, advise customer to initiate return upon arrival.',
        4
    )
ON CONFLICT (brand_id, topic) DO NOTHING;
