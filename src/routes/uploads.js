import { Router } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { uploadBuffer, isAzureConfigured } from '../config/azure.js';
import { optionalAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import logger from '../utils/logger.js';

const router = Router();

const ALLOWED_TYPES = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter(_req, file, cb) {
    if (ALLOWED_TYPES[file.mimetype]) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF, JPEG, PNG, and WEBP files are allowed'));
    }
  },
});

// POST /api/uploads
router.post(
  '/',
  optionalAuth,
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!isAzureConfigured()) {
      return res.status(501).json({
        error: 'NOT_CONFIGURED',
        message: 'File uploads are not configured on this server',
      });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'BAD_REQUEST', message: 'No file uploaded' });
    }

    const ext = ALLOWED_TYPES[req.file.mimetype];
    const blobName = `credentials/${req.user?.id || 'guest'}/${uuidv4()}.${ext}`;

    const url = await uploadBuffer(blobName, req.file.buffer, req.file.mimetype);

    logger.info(`File uploaded: ${blobName}${req.user ? ` by holder ${req.user.id}` : ' (guest)'}`);

    res.status(201).json({
      url,
      blobName,
      originalName: req.file.originalname,
      size: req.file.size,
      contentType: req.file.mimetype,
    });
  })
);

// Handle multer errors (file too large, wrong type) as 400 instead of 500
router.use((err, _req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({
      error: 'BAD_REQUEST',
      message: err.code === 'LIMIT_FILE_SIZE' ? 'File exceeds the 10MB size limit' : err.message,
    });
  }
  if (err && err.message && err.message.startsWith('Only PDF')) {
    return res.status(400).json({ error: 'BAD_REQUEST', message: err.message });
  }
  next(err);
});

export default router;
