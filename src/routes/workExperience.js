import { Router } from 'express';
import Joi from 'joi';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import * as workExperienceRepository from '../repositories/workExperienceRepository.js';

const router = Router();

const createWorkExpSchema = Joi.object({
  employer_name: Joi.string().min(2).max(255).required(),
  job_title: Joi.string().min(2).max(255).required(),
  start_date: Joi.string().isoDate().required(),
  end_date: Joi.string().isoDate().optional().allow(null, ''),
  is_current: Joi.boolean().default(false),
  location: Joi.string().max(255).optional().allow(null, ''),
  jurisdiction_id: Joi.string().optional().allow(null, ''),
  description: Joi.string().max(2000).optional().allow(null, ''),
});

const updateWorkExpSchema = Joi.object({
  employer_name: Joi.string().min(2).max(255),
  job_title: Joi.string().min(2).max(255),
  start_date: Joi.string().isoDate(),
  end_date: Joi.string().isoDate().allow(null, ''),
  is_current: Joi.boolean(),
  location: Joi.string().max(255).allow(null, ''),
  jurisdiction_id: Joi.string().allow(null, ''),
  description: Joi.string().max(2000).allow(null, ''),
}).min(1);

/**
 * GET /api/work-experience
 */
router.get(
  '/',
  authenticate,
  asyncHandler(async (req, res) => {
    const entries = await workExperienceRepository.findByHolder(req.user.id);
    res.json({ data: entries, total: entries.length });
  })
);

/**
 * POST /api/work-experience
 */
router.post(
  '/',
  authenticate,
  validate(createWorkExpSchema),
  asyncHandler(async (req, res) => {
    const payload = { holder_id: req.user.id, ...req.body };
    // If is_current, clear end_date
    if (payload.is_current) payload.end_date = null;
    const entry = await workExperienceRepository.createEntry(payload);
    res.status(201).json({ data: entry });
  })
);

/**
 * PATCH /api/work-experience/:id
 */
router.patch(
  '/:id',
  authenticate,
  validate(updateWorkExpSchema),
  asyncHandler(async (req, res) => {
    const entry = await workExperienceRepository.findById(req.params.id);
    if (!entry) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Entry not found', requestId: req.id });
    }
    if (String(entry.holder_id) !== String(req.user.id)) {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'Not your entry', requestId: req.id });
    }
    const updates = { ...req.body };
    if (updates.is_current) updates.end_date = null;
    const updated = await workExperienceRepository.updateEntry(req.params.id, updates);
    res.json({ data: updated });
  })
);

/**
 * DELETE /api/work-experience/:id
 */
router.delete(
  '/:id',
  authenticate,
  asyncHandler(async (req, res) => {
    const entry = await workExperienceRepository.findById(req.params.id);
    if (!entry) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Entry not found', requestId: req.id });
    }
    if (String(entry.holder_id) !== String(req.user.id)) {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'Not your entry', requestId: req.id });
    }
    await workExperienceRepository.softDelete(req.params.id);
    res.status(204).end();
  })
);

export default router;
