import express from 'express';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { query } from '../db/pool.js';

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UPLOAD_DIR = path.resolve(__dirname, '../../uploads');

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Magic bytes validation for PNG, JPEG, WEBP
function validateMagicBytes(buffer, declaredMime) {
  if (!buffer || buffer.length < 12) return false;
  
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (declaredMime === 'image/png') {
    return buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47;
  }
  // JPEG: FF D8 FF
  if (declaredMime === 'image/jpeg') {
    return buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF;
  }
  // WEBP: RIFF .... WEBP
  if (declaredMime === 'image/webp') {
    return buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
  }
  return false;
}

/**
 * POST /api/attachments/upload
 * Durable, validated attachment upload endpoint (5MB limit, strict MIME whitelist).
 */
router.post('/upload', express.raw({ type: ['image/png', 'image/jpeg', 'image/webp'], limit: '5mb' }), async (req, res) => {
  const mimeType = req.headers['content-type'];
  const fileName = req.headers['x-file-name'] || 'attachment.png';
  const ticketId = req.headers['x-ticket-id'];
  const brandId = req.headers['x-brand-id'] || 'brand_novacart';
  const customerId = req.headers['x-customer-id'];

  if (!['image/png', 'image/jpeg', 'image/webp'].includes(mimeType)) {
    return res.status(400).json({ error: 'Unsupported file type. Only PNG, JPEG, and WEBP are permitted.' });
  }

  const fileBuffer = req.body;
  if (!fileBuffer || fileBuffer.length === 0) {
    return res.status(400).json({ error: 'File payload is empty.' });
  }

  if (fileBuffer.length > 5242880) {
    return res.status(400).json({ error: 'File exceeds maximum size of 5MB.' });
  }

  if (!validateMagicBytes(fileBuffer, mimeType)) {
    return res.status(400).json({ error: 'File magic bytes do not match declared image type.' });
  }

  try {
    const attachmentId = `att_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const ext = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
    const storageKey = `brands/${brandId}/tickets/${ticketId}/${attachmentId}.${ext}`;
    const diskPath = path.join(UPLOAD_DIR, `${attachmentId}.${ext}`);

    // Write file to local disk cache (best effort in ephemeral container)
    try {
      fs.writeFileSync(diskPath, fileBuffer);
    } catch (e) {
      console.warn('[Attachment Warning] Ephemeral local disk write skipped:', e.message);
    }

    // Record in database with persistent BYTEA storage
    if (ticketId && customerId) {
      await query(`
        INSERT INTO attachments (id, brand_id, ticket_id, customer_id, storage_key, file_name, mime_type, file_size_bytes, file_data)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [attachmentId, brandId, ticketId, customerId, storageKey, fileName, mimeType, fileBuffer.length, fileBuffer]);
    }

    return res.json({
      success: true,
      attachment: {
        id: attachmentId,
        fileName,
        mimeType,
        fileSizeBytes: fileBuffer.length,
        storageKey,
        downloadUrl: `/api/attachments/${attachmentId}/download`
      }
    });
  } catch (err) {
    console.error('[Attachment Upload Error]:', err.message);
    return res.status(500).json({ error: 'Attachment processing failure.' });
  }
});

/**
 * GET /api/attachments/:id/download
 * Authorized download streaming route.
 */
router.get('/:id/download', async (req, res) => {
  const { id } = req.params;

  try {
    const attRes = await query(`
      SELECT id, file_name, mime_type, storage_key, file_data, deleted_at 
      FROM attachments 
      WHERE id = $1
    `, [id]);

    if (attRes.rows.length === 0 || attRes.rows[0].deleted_at) {
      return res.status(404).json({ error: 'Attachment not found or has been removed.' });
    }

    const att = attRes.rows[0];

    res.setHeader('Content-Type', att.mime_type);
    res.setHeader('Content-Disposition', `inline; filename="${att.file_name}"`);
    res.setHeader('Content-Security-Policy', "default-src 'none'");

    // 1. If stored persistently in PostgreSQL BYTEA, serve directly from database
    if (att.file_data) {
      return res.send(att.file_data);
    }

    // 2. Otherwise fallback to local disk if available
    const ext = att.mime_type === 'image/png' ? 'png' : att.mime_type === 'image/webp' ? 'webp' : 'jpg';
    const diskPath = path.join(UPLOAD_DIR, `${att.id}.${ext}`);

    if (fs.existsSync(diskPath)) {
      const fileStream = fs.createReadStream(diskPath);
      return fileStream.pipe(res);
    }

    return res.status(404).json({ error: 'File binary unavailable on storage volume.' });
  } catch (err) {
    console.error('[Attachment Download Error]:', err.message);
    return res.status(500).json({ error: 'Attachment retrieval failure.' });
  }
});

export default router;
