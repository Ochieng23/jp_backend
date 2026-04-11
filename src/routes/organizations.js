import { Router } from 'express';
import Joi from 'joi';
import { v4 as uuidv4 } from 'uuid';
import { validate } from '../middleware/validate.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { parsePagination, paginate } from '../utils/paginationUtils.js';
import * as organizationRepository from '../repositories/organizationRepository.js';
import * as auditRepository from '../repositories/auditRepository.js';
import * as credentialService from '../services/credentialService.js';

const router = Router();

// ─── Validation schemas ───────────────────────────────────────────────────────

const createOrgSchema = Joi.object({
  name: Joi.string().min(2).max(255).required(),
  type: Joi.string()
    .valid('vocational', 'ngo', 'government', 'employer', 'academic')
    .required(),
  did: Joi.string().min(5).max(300).required(),
  public_key_jwk: Joi.object().required(),
  jurisdiction_id: Joi.string().uuid().optional(),
});

const issueCredentialSchema = Joi.object({
  holder_id: Joi.string().uuid().required(),
  type: Joi.string().min(2).max(100).required(),
  title: Joi.string().min(2).max(255).required(),
  description: Joi.string().max(2000).optional(),
  credential_subject: Joi.object().default({}),
  expires_at: Joi.string().isoDate().optional(),
  jurisdiction_id: Joi.string().uuid().optional(),
});

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /api/organizations
 * List all organisations. Public (no auth required).
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { page, pageSize, offset } = parsePagination(req.query);
    const filters = {
      type: req.query.type,
      verified: req.query.verified !== undefined ? req.query.verified === 'true' : undefined,
      jurisdiction_id: req.query.jurisdiction_id,
      limit: pageSize,
      offset,
    };
    const { rows, total } = await organizationRepository.findAll(filters);
    res.json(paginate(rows, total, page, pageSize));
  })
);

/**
 * GET /api/organizations/:id
 * Get a single organisation. Public.
 */
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const org = await organizationRepository.findById(req.params.id);
    if (!org) {
      return res.status(404).json({
        error: 'NOT_FOUND',
        message: 'Organisation not found',
        requestId: req.id,
      });
    }
    res.json({ data: org });
  })
);

/**
 * POST /api/organizations
 * Create a new organisation (starts as unverified).
 * Requires authentication.
 */
router.post(
  '/',
  authenticate,
  validate(createOrgSchema),
  asyncHandler(async (req, res) => {
    const orgId = uuidv4();
    const org = await organizationRepository.createOrg({
      id: orgId,
      ...req.body,
    });

    await auditRepository.logAction({
      id: uuidv4(),
      actor_id: req.user.id,
      actor_type: req.user.role === 'platform_admin' ? 'admin' : 'holder',
      action: 'organization.created',
      resource_type: 'issuing_organization',
      resource_id: orgId,
      metadata: { name: req.body.name, type: req.body.type },
      ip_address: req.ip,
    });

    res.status(201).json({ data: org });
  })
);

/**
 * POST /api/organizations/:id/issue-credential
 * Issue a VC from this organisation to a holder.
 * Requires org_admin or platform_admin role.
 */
router.post(
  '/:id/issue-credential',
  authenticate,
  requireRole('org_admin', 'platform_admin'),
  validate(issueCredentialSchema),
  asyncHandler(async (req, res) => {
    const org = await organizationRepository.findById(req.params.id);
    if (!org) {
      return res.status(404).json({
        error: 'NOT_FOUND',
        message: 'Organisation not found',
        requestId: req.id,
      });
    }

    const credential = await credentialService.issueCredential(
      req.params.id,
      req.body.holder_id,
      req.body
    );

    res.status(201).json({ data: credential });
  })
);

/**
 * PATCH /api/organizations/:id/verify
 * Mark an organisation as verified.
 * Requires platform_admin role.
 */
router.patch(
  '/:id/verify',
  authenticate,
  requireRole('platform_admin'),
  asyncHandler(async (req, res) => {
    const org = await organizationRepository.findById(req.params.id);
    if (!org) {
      return res.status(404).json({
        error: 'NOT_FOUND',
        message: 'Organisation not found',
        requestId: req.id,
      });
    }

    const verified = await organizationRepository.verifyOrg(req.params.id);

    await auditRepository.logAction({
      id: uuidv4(),
      actor_id: req.user.id,
      actor_type: 'admin',
      action: 'organization.verified',
      resource_type: 'issuing_organization',
      resource_id: req.params.id,
      metadata: { name: org.name },
      ip_address: req.ip,
    });

    res.json({ data: verified });
  })
);

export default router;
