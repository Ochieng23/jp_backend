import { Router } from 'express';
import Joi from 'joi';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { parsePagination, paginate } from '../utils/paginationUtils.js';
import * as credentialRepository from '../repositories/credentialRepository.js';
import * as credentialService from '../services/credentialService.js';

const router = Router();

// ─── Validation schemas ───────────────────────────────────────────────────────

const createCredentialSchema = Joi.object({
  type: Joi.string().min(2).max(100).required(),
  title: Joi.string().min(2).max(255).required(),
  description: Joi.string().max(2000).optional(),
  issued_at: Joi.string().isoDate().required(),
  expires_at: Joi.string().isoDate().optional(),
  jurisdiction_id: Joi.string().optional().allow(null, ''),
  issuer_id: Joi.string().optional().allow(null, ''),
  issuer_name: Joi.string().min(2).max(255).optional().allow(null, ''),
  document_url: Joi.string().uri().optional(),
  document_key: Joi.string().optional(),
})
  .or('issuer_id', 'issuer_name')
  .messages({ 'object.missing': 'Please provide who issued this credential' });

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /api/credentials
 * List credentials for the authenticated holder with optional filters.
 */
router.get(
  '/',
  authenticate,
  asyncHandler(async (req, res) => {
    const { page, pageSize, offset } = parsePagination(req.query);
    const filters = {
      type: req.query.type,
      status: req.query.status,
      jurisdiction_id: req.query.jurisdiction_id,
      limit: pageSize,
      offset,
    };

    const { rows, total } = await credentialRepository.findCredentialsByHolder(
      req.user.id,
      filters
    );
    res.json(paginate(rows, total, page, pageSize));
  })
);

/**
 * GET /api/credentials/:id
 * Get a single credential with issuer details.
 * Holder may only access their own credentials (unless admin).
 */
router.get(
  '/:id',
  authenticate,
  asyncHandler(async (req, res) => {
    const credential = await credentialRepository.getCredentialWithIssuer(req.params.id);

    if (!credential) {
      return res.status(404).json({
        error: 'NOT_FOUND',
        message: 'Credential not found',
        requestId: req.id,
      });
    }

    // Access control: holders can only see their own credentials
    if (
      req.user.role === 'holder' &&
      String(credential.holder_id) !== String(req.user.id)
    ) {
      return res.status(403).json({
        error: 'FORBIDDEN',
        message: 'You do not have access to this credential',
        requestId: req.id,
      });
    }

    res.json({ data: credential });
  })
);

/**
 * POST /api/credentials
 * Self-report a credential.
 */
router.post(
  '/',
  authenticate,
  validate(createCredentialSchema),
  asyncHandler(async (req, res) => {
    const credential = await credentialService.selfReportCredential(req.user.id, req.body);
    res.status(201).json({ data: credential });
  })
);

/**
 * PATCH /api/credentials/:id/revoke
 * Revoke a credential. Only issuer (org_admin) or platform_admin.
 */
router.patch(
  '/:id/revoke',
  authenticate,
  asyncHandler(async (req, res) => {
    const credential = await credentialService.revokeCredential(
      req.params.id,
      req.user.id,
      req.user.role
    );
    res.json({ data: credential });
  })
);

/**
 * GET /api/credentials/:id/verify
 * Publicly verify a credential's cryptographic proof and status.
 * No authentication required.
 */
router.get(
  '/:id/verify',
  asyncHandler(async (req, res) => {
    const result = await credentialService.verifyCredential(req.params.id);
    res.json({ data: result });
  })
);

export default router;
