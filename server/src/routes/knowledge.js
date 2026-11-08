import express from 'express';
import { BUSINESS_INFO } from '../data/demoData.js';

const router = express.Router();

// GET /api/knowledge - Retrieve business knowledge base and policies
router.get('/', (req, res) => {
  res.json({
    success: true,
    data: BUSINESS_INFO,
  });
});

export default router;
