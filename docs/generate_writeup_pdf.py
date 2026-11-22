import os
from reportlab.lib.pagesizes import letter
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors

pdf_path = os.path.abspath('Resolve_AI_Nexconn_Project_Writeup.pdf')
doc = SimpleDocTemplate(
    pdf_path,
    pagesize=letter,
    rightMargin=40,
    leftMargin=40,
    topMargin=36,
    bottomMargin=36
)

styles = getSampleStyleSheet()

primary_color = colors.HexColor('#0F172A')
accent_color = colors.HexColor('#2563EB')
dark_neutral = colors.HexColor('#1E293B')
light_bg = colors.HexColor('#F8FAFC')
border_color = colors.HexColor('#CBD5E1')

title_style = ParagraphStyle(
    'DocTitle',
    parent=styles['Normal'],
    fontName='Helvetica-Bold',
    fontSize=20,
    leading=24,
    textColor=primary_color,
    spaceAfter=4
)

subtitle_style = ParagraphStyle(
    'DocSubTitle',
    parent=styles['Normal'],
    fontName='Helvetica',
    fontSize=10,
    leading=14,
    textColor=colors.HexColor('#475569'),
    spaceAfter=10
)

h1_style = ParagraphStyle(
    'SectionH1',
    parent=styles['Normal'],
    fontName='Helvetica-Bold',
    fontSize=12,
    leading=16,
    textColor=accent_color,
    spaceBefore=8,
    spaceAfter=5
)

body_style = ParagraphStyle(
    'BodyTextCustom',
    parent=styles['Normal'],
    fontName='Helvetica',
    fontSize=8.5,
    leading=12.5,
    textColor=dark_neutral,
    spaceAfter=5
)

bullet_style = ParagraphStyle(
    'BulletCustom',
    parent=body_style,
    leftIndent=14,
    firstLineIndent=-10,
    spaceAfter=3
)

meta_label = ParagraphStyle(
    'MetaLabel',
    parent=styles['Normal'],
    fontName='Helvetica-Bold',
    fontSize=8.5,
    leading=11.5,
    textColor=colors.HexColor('#334155')
)

meta_val = ParagraphStyle(
    'MetaVal',
    parent=styles['Normal'],
    fontName='Helvetica',
    fontSize=8.5,
    leading=11.5,
    textColor=colors.HexColor('#0F172A')
)

story = []

# Title & Subtitle
story.append(Paragraph('Resolve AI — Project Write-Up & Nexconn Architecture', title_style))
story.append(Paragraph('Enterprise Omnichannel Support & Multi-Agent Localization Suite Powered by Nexconn Chat SDK', subtitle_style))
story.append(HRFlowable(width='100%', thickness=1.5, color=accent_color, spaceAfter=8))

# Metadata Card
meta_data = [
    [Paragraph('<b>Project Name:</b>', meta_label), Paragraph('Resolve AI (NovaCart E-Commerce)', meta_val),
     Paragraph('<b>Nexconn App Key:</b>', meta_label), Paragraph('<b><font color="#2563EB">z3v5yqkbzenj0</font></b>', meta_val)],
    [Paragraph('<b>Repository:</b>', meta_label), Paragraph('https://github.com/Rakshit414/ResolveAI_Nexconn', meta_val),
     Paragraph('<b>Live App:</b>', meta_label), Paragraph('https://resolve-ai-novacart.onrender.com', meta_val)],
    [Paragraph('<b>Nexconn Package:</b>', meta_label), Paragraph('@nexconn/chat v26.2.1 (Chat SDK)', meta_val),
     Paragraph('<b>Database & Stack:</b>', meta_label), Paragraph('PostgreSQL 16, Express, React 18, Vite', meta_val)]
]

meta_table = Table(meta_data, colWidths=[90, 185, 100, 155])
meta_table.setStyle(TableStyle([
    ('BACKGROUND', (0,0), (-1,-1), light_bg),
    ('BOX', (0,0), (-1,-1), 1, border_color),
    ('INNERGRID', (0,0), (-1,-1), 0.5, colors.HexColor('#E2E8F0')),
    ('TOPPADDING', (0,0), (-1,-1), 4),
    ('BOTTOMPADDING', (0,0), (-1,-1), 4),
    ('LEFTPADDING', (0,0), (-1,-1), 6),
    ('RIGHTPADDING', (0,0), (-1,-1), 6),
]))
story.append(meta_table)
story.append(Spacer(1, 8))

# Section 1
story.append(Paragraph('1. Why We Built Resolve AI & The Problem It Solves', h1_style))
story.append(Paragraph(
    'Modern e-commerce brands lose substantial revenue and customer trust due to fragmented, slow, and context-blind customer support. When online shoppers encounter delivery delays, damaged items, or return questions, they face generic bots or days-long email queues. Human agents, meanwhile, scramble between disconnected CRM systems without order history, customer verification, or localization capabilities.',
    body_style
))
story.append(Paragraph(
    '<b>Resolve AI</b> solves this by embedding an enterprise-grade, real-time communication platform directly into the e-commerce storefront (NovaCart). Powered by the <b>Nexconn Chat SDK</b>, an <b>intelligent Gemini AI Copilot</b>, and a <b>PostgreSQL 16 transactional engine</b>, Resolve AI bridges customers and support specialists effortlessly:',
    body_style
))
story.append(Paragraph('&bull; <b>Embedded Storefront Chat:</b> An iframe-isolated widget connects shoppers to support with instant order recognition (#NC1021) without disrupting shopping or cart checkout.', bullet_style))
story.append(Paragraph('&bull; <b>12-Language Real-Time Localization:</b> Live bidirectional translation across 12 languages with native Right-to-Left (RTL) Arabic layout and distortion-free Asian script formatting (Hindi, Marathi, Bengali, Tamil, Japanese, Chinese).', bullet_style))
story.append(Paragraph('&bull; <b>Enterprise Multi-Agent Cockpit:</b> A shared inbox with dynamic capacity limits, authenticated agent switching, and atomic ticket transfers with full context and private internal notes.', bullet_style))
story.append(Paragraph('&bull; <b>Privacy & Audit Invariance:</b> Zero-leak customer PII masking on unassigned ticket queues, signed outbox message delivery, and tamper-proof PostgreSQL audit records.', bullet_style))

# Section 2
story.append(Paragraph('2. Nexconn Chat SDK Features Used in Resolve AI', h1_style))
story.append(Paragraph(
    'Resolve AI is architected from the ground up on Nexconn\'s real-time messaging primitives, combining client-side SDK integration and authenticated server-to-server dispatching:',
    body_style
))

sdk_features = [
    [Paragraph('<b>SDK Feature</b>', meta_label), Paragraph('<b>Role in Resolve AI Architecture</b>', meta_label)],
    [Paragraph('<b>Direct Channels<br/>(1:1 Channels)</b>', body_style),
     Paragraph('Created between unique customer IDs (e.g. <code>cust_rajesh</code>) and the registered merchant support identity (<code>novacart_support</code>) via <code>DirectChannel</code> and <code>NCEngine</code>. Enforces strict channel isolation and conversation confidentiality.', body_style)],
    [Paragraph('<b>Real-Time Messaging & Event Handlers</b>', body_style),
     Paragraph('Employs <code>SendTextMessageParams</code>, <code>MessageHandler</code>, and <code>ConnectionStatusHandler</code> for sub-100ms message delivery, live connection health indicators, and single-channel subscriber event fan-out with deduplication.', body_style)],
    [Paragraph('<b>Persistent History & Session Continuity</b>', body_style),
     Paragraph('Synchronizes full conversation transcripts across customer browser reloads. When tickets are transferred between agents (e.g., Sarah Lin &rarr; Carlos Gomez), the original Nexconn conversation mapping is preserved without channel interruption.', body_style)],
    [Paragraph('<b>Signed Backend Dispatch API</b>', body_style),
     Paragraph('The Node.js/Express backend integrates directly with the Nexconn Direct-Channel REST API (<code>/v4/direct-channel/message/send</code>) using cryptographic SHA-1 request signatures (<code>AppSecret + Nonce + Timestamp</code>) for tamper-proof server-initiated dispatches.', body_style)],
    [Paragraph('<b>Custom Message Metadata & System Events</b>', body_style),
     Paragraph('Transmits structured metadata (order ID, ticket ID, language tags, and authorAgentId) inside messages to drive real-time agent takeover notices, resolution receipts, and internal routing.', body_style)]
]

sdk_table = Table(sdk_features, colWidths=[135, 395])
sdk_table.setStyle(TableStyle([
    ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#F1F5F9')),
    ('BOX', (0,0), (-1,-1), 1, border_color),
    ('INNERGRID', (0,0), (-1,-1), 0.5, colors.HexColor('#E2E8F0')),
    ('VALIGN', (0,0), (-1,-1), 'TOP'),
    ('TOPPADDING', (0,0), (-1,-1), 3.5),
    ('BOTTOMPADDING', (0,0), (-1,-1), 3.5),
    ('LEFTPADDING', (0,0), (-1,-1), 5),
    ('RIGHTPADDING', (0,0), (-1,-1), 5),
]))
story.append(sdk_table)
story.append(Spacer(1, 6))

# Section 3
story.append(Paragraph('3. Architecture & Operational Reliability', h1_style))
story.append(Paragraph(
    'Resolve AI is engineered for mission-critical reliability: a <b>Transactional Outbox Worker</b> guarantees at-least-once message delivery with exponential backoff and idempotency keys; <b>Row-Level PostgreSQL 16 Locks</b> (<code>SELECT ... FOR UPDATE</code>) ensure atomic ticket transfers and capacity accounting without race conditions; and <b>Automated Webhook Reconciliation</b> resolves delivery uncertainty across network blips.',
    body_style
))

doc.build(story)
print('PDF created successfully at:', pdf_path)
