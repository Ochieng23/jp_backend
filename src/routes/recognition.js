import { Router } from 'express';
import Joi from 'joi';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import * as recognitionService from '../services/recognitionService.js';
import * as recognitionRepository from '../repositories/recognitionRepository.js';

const router = Router();

const evaluateSchema = Joi.object({
  holder_id: Joi.string().required(),
  target_jurisdiction_id: Joi.string().required(),
});

/**
 * GET /api/recognition
 * Get the recognition matrix for a holder.
 */
router.get(
  '/',
  authenticate,
  asyncHandler(async (req, res) => {
    const holderId =
      req.query.holder_id && req.user.role === 'platform_admin'
        ? req.query.holder_id
        : req.user.id;

    const matrix = await recognitionService.getRecognitionMatrix(holderId);
    res.json({ data: matrix, total: matrix.length });
  })
);

/**
 * POST /api/recognition/evaluate
 * Synchronously evaluate credentials against a target jurisdiction.
 * Returns a pseudo job_id for frontend polling compatibility.
 */
router.post(
  '/evaluate',
  authenticate,
  validate(evaluateSchema),
  asyncHandler(async (req, res) => {
    const { holder_id, target_jurisdiction_id } = req.body;

    if (req.user.role === 'holder' && holder_id !== req.user.id) {
      return res.status(403).json({
        error: 'FORBIDDEN',
        message: 'Holders may only trigger evaluation for their own credentials',
        requestId: req.id,
      });
    }

    // Run synchronously — generate a pseudo job_id so frontend polling works
    const jobId = `sync-${Date.now()}`;
    await recognitionService.triggerBulkEvaluation(holder_id, target_jurisdiction_id);

    res.json({ job_id: jobId, status: 'completed' });
  })
);

/**
 * GET /api/recognition/jobs/:id
 * Return job status. Since evaluation is synchronous, always return completed.
 */
router.get(
  '/jobs/:id',
  authenticate,
  asyncHandler(async (req, res) => {
    // Evaluation is synchronous — if the job ID exists, it completed already
    res.json({ job_id: req.params.id, status: 'completed' });
  })
);

export default router;
