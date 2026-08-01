import { Router } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { uploadBuffer, isAzureConfigured } from '../config/azure.js';
import { authenticate, optionalAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { moderateVideo } from '../services/videoModerationService.js';
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

// Craft-explainer video attached to a holder's profile — capped at 50MB
// (stored in Blob, never inline).
const ALLOWED_VIDEO_TYPES = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
};

const uploadVideo = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter(_req, file, cb) {
    if (ALLOWED_VIDEO_TYPES[file.mimetype]) {
      cb(null, true);
    } else {
      cb(new Error('Only MP4, WEBM, and MOV video files are allowed'));
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

// POST /api/uploads/video
// A holder's short craft-explainer video. Requires an account (it's a
// profile asset, not a one-off application attachment), unlike the generic
// upload route above which also serves guest applicants.
router.post(
  '/video',
  authenticate,
  uploadVideo.single('file'),
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

    const ext = ALLOWED_VIDEO_TYPES[req.file.mimetype];

    // Guardrail: screen for explicit/graphic content (Azure AI Content
    // Safety over sampled frames) before anything is stored.
    const verdict = await moderateVideo(req.file.buffer, ext);
    if (!verdict.allowed) {
      logger.warn(`Video upload rejected by moderation for holder ${req.user.id}`);
      return res.status(422).json({
        error: 'CONTENT_REJECTED',
        message: verdict.reason,
        requestId: req.id,
      });
    }

    const blobName = `videos/${req.user.id}/${uuidv4()}.${ext}`;

    const url = await uploadBuffer(blobName, req.file.buffer, req.file.mimetype);

    logger.info(`Video uploaded: ${blobName} by holder ${req.user.id}`);

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
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const limit = req.path === '/video' ? '50MB' : '10MB';
    return res.status(400).json({
      error: 'BAD_REQUEST',
      message: err.code === 'LIMIT_FILE_SIZE' ? `File exceeds the ${limit} size limit` : err.message,
    });
  }
  if (err && err.message && (err.message.startsWith('Only PDF') || err.message.startsWith('Only MP4'))) {
    return res.status(400).json({ error: 'BAD_REQUEST', message: err.message });
  }
  next(err);
});

export default router;
