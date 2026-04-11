import { Router } from 'express';
import Joi from 'joi';
import { v4 as uuidv4 } from 'uuid';
import { validate } from '../middleware/validate.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import * as jurisdictionRepository from '../repositories/jurisdictionRepository.js';

const router = Router();

// ─── Validation schemas ───────────────────────────────────────────────────────

const createJurisdictionSchema = Joi.object({
  country_code: Joi.string().length(3).uppercase().required(),
  country_name: Joi.string().min(2).max(100).required(),
  recognition_rules: Joi.object().default({}),
});

const updateJurisdictionSchema = Joi.object({
  country_code: Joi.string().length(3).uppercase(),
  country_name: Joi.string().min(2).max(100),
  recognition_rules: Joi.object(),
}).min(1);

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /api/jurisdictions
 * List all jurisdictions. Public.
 */
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const jurisdictions = await jurisdictionRepository.findAll();
    res.json({ data: jurisdictions, total: jurisdictions.length });
  })
);

/**
 * GET /api/jurisdictions/:id
 * Get a single jurisdiction. Public.
 */
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const jurisdiction = await jurisdictionRepository.findById(req.params.id);
    if (!jurisdiction) {
      return res.status(404).json({
        error: 'NOT_FOUND',
        message: 'Jurisdiction not found',
        requestId: req.id,
      });
    }
    res.json({ data: jurisdiction });
  })
);

/**
 * POST /api/jurisdictions
 * Create a new jurisdiction. Requires platform_admin role.
 */
router.post(
  '/',
  authenticate,
  requireRole('platform_admin'),
  validate(createJurisdictionSchema),
  asyncHandler(async (req, res) => {
    const jurisdiction = await jurisdictionRepository.createJurisdiction({
      id: uuidv4(),
      ...req.body,
    });
    res.status(201).json({ data: jurisdiction });
  })
);

/**
 * PATCH /api/jurisdictions/:id
 * Update an existing jurisdiction. Requires platform_admin role.
 */
router.patch(
  '/:id',
  authenticate,
  requireRole('platform_admin'),
  validate(updateJurisdictionSchema),
  asyncHandler(async (req, res) => {
    const existing = await jurisdictionRepository.findById(req.params.id);
    if (!existing) {
      return res.status(404).json({
        error: 'NOT_FOUND',
        message: 'Jurisdiction not found',
        requestId: req.id,
      });
    }

    const updated = await jurisdictionRepository.updateJurisdiction(req.params.id, req.body);
    res.json({ data: updated });
  })
);

export default router;
