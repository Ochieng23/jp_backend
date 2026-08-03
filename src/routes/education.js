import { Router } from 'express';
import Joi from 'joi';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import * as educationRepository from '../repositories/educationRepository.js';

const router = Router();

const createEducationSchema = Joi.object({
  institution_name: Joi.string().min(2).max(255).required(),
  qualification: Joi.string().min(2).max(255).required(),
  start_date: Joi.string().isoDate().required(),
  end_date: Joi.string().isoDate().optional().allow(null, ''),
  is_current: Joi.boolean().default(false),
  location: Joi.string().max(255).optional().allow(null, ''),
  jurisdiction_id: Joi.string().optional().allow(null, ''),
  description: Joi.string().max(2000).optional().allow(null, ''),
  document_url: Joi.string().uri({ scheme: ['http', 'https'] }).optional().allow(null, ''),
});

const updateEducationSchema = Joi.object({
  institution_name: Joi.string().min(2).max(255),
  qualification: Joi.string().min(2).max(255),
  start_date: Joi.string().isoDate(),
  end_date: Joi.string().isoDate().allow(null, ''),
  is_current: Joi.boolean(),
  location: Joi.string().max(255).allow(null, ''),
  jurisdiction_id: Joi.string().allow(null, ''),
  description: Joi.string().max(2000).allow(null, ''),
  document_url: Joi.string().uri({ scheme: ['http', 'https'] }).allow(null, ''),
}).min(1);

/**
 * GET /api/education
 */
router.get(
  '/',
  authenticate,
  asyncHandler(async (req, res) => {
    const entries = await educationRepository.findByHolder(req.user.id);
    res.json({ data: entries, total: entries.length });
  })
);

/**
 * POST /api/education
 */
router.post(
  '/',
  authenticate,
  validate(createEducationSchema),
  asyncHandler(async (req, res) => {
    const payload = { holder_id: req.user.id, ...req.body };
    if (payload.is_current) payload.end_date = null;
    const entry = await educationRepository.createEntry(payload);
    res.status(201).json({ data: entry });
  })
);

/**
 * PATCH /api/education/:id
 */
router.patch(
  '/:id',
  authenticate,
  validate(updateEducationSchema),
  asyncHandler(async (req, res) => {
    const entry = await educationRepository.findById(req.params.id);
    if (!entry) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Entry not found', requestId: req.id });
    }
    if (String(entry.holder_id) !== String(req.user.id) && req.user.role !== 'platform_admin') {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'Not your entry', requestId: req.id });
    }
    if (entry.verified && req.user.role !== 'platform_admin') {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'This entry has been verified and can no longer be edited', requestId: req.id });
    }
    const updates = { ...req.body };
    if (updates.is_current) updates.end_date = null;
    const updated = await educationRepository.updateEntry(req.params.id, updates, {
      bypassVerifiedLock: req.user.role === 'platform_admin',
    });
    res.json({ data: updated });
  })
);

/**
 * DELETE /api/education/:id
 */
router.delete(
  '/:id',
  authenticate,
  asyncHandler(async (req, res) => {
    const entry = await educationRepository.findById(req.params.id);
    if (!entry) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Entry not found', requestId: req.id });
    }
    if (String(entry.holder_id) !== String(req.user.id) && req.user.role !== 'platform_admin') {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'Not your entry', requestId: req.id });
    }
    await educationRepository.softDelete(req.params.id);
    res.status(204).end();
  })
);

/**
 * POST /api/education/:id/request-verification
 * Holder-triggered: flag this entry for admin review. Does not verify it
 * immediately — a platform_admin still has to confirm it via the admin
 * verification queue.
 */
router.post(
  '/:id/request-verification',
  authenticate,
  asyncHandler(async (req, res) => {
    const entry = await educationRepository.findById(req.params.id);
    if (!entry) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Entry not found', requestId: req.id });
    }
    if (String(entry.holder_id) !== String(req.user.id) && req.user.role !== 'platform_admin') {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'Not your entry', requestId: req.id });
    }
    if (entry.verified) {
      return res.status(422).json({ error: 'VALIDATION_ERROR', message: 'This entry is already verified', requestId: req.id });
    }
    const updated = await educationRepository.requestVerification(req.params.id);
    res.json({ data: updated });
  })
);

export default router;
