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
  document_url: Joi.string().uri({ scheme: ['http', 'https'] }).optional(),
  document_key: Joi.string().optional(),
})
  .or('issuer_id', 'issuer_name')
  .messages({ 'object.missing': 'Please provide who issued this credential' });

// Editing is only offered for self-reported credentials (see PATCH /:id),
// so unlike create there's no issuer requirement here — a holder fixing a
// typo in the title shouldn't be forced to also re-supply the issuer.
const updateCredentialSchema = Joi.object({
  type: Joi.string().min(2).max(100),
  title: Joi.string().min(2).max(255),
  description: Joi.string().max(2000).allow(null, ''),
  issued_at: Joi.string().isoDate(),
  expires_at: Joi.string().isoDate().allow(null, ''),
  jurisdiction_id: Joi.string().allow(null, ''),
  issuer_id: Joi.string().allow(null, ''),
  issuer_name: Joi.string().min(2).max(255).allow(null, ''),
  document_url: Joi.string().uri({ scheme: ['http', 'https'] }).allow(null, ''),
}).min(1);

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
 * PATCH /api/credentials/:id
 * Edit a self-reported credential's fields. Only the owning holder, and
 * only while proof_value === 'self-reported' — a real signed VC's fields
 * can't be edited without desyncing them from the cryptographic vc_json,
 * so those must be revoked (or deleted) rather than edited.
 */
router.patch(
  '/:id',
  authenticate,
  validate(updateCredentialSchema),
  asyncHandler(async (req, res) => {
    const credential = await credentialRepository.findCredentialById(req.params.id);
    if (!credential) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Credential not found', requestId: req.id });
    }
    if (String(credential.holder_id) !== String(req.user.id)) {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'Not your credential', requestId: req.id });
    }
    if (credential.proof_value !== 'self-reported') {
      return res.status(403).json({
        error: 'FORBIDDEN',
        message: 'This credential was issued by a verified organisation and cannot be edited',
        requestId: req.id,
      });
    }

    const updates = { ...req.body };
    if (!updates.issuer_id && !updates.issuer_name &&
        !credential.issuer_id && !credential.issuer_name) {
      return res.status(422).json({
        error: 'VALIDATION_ERROR',
        message: 'Please provide who issued this credential',
        requestId: req.id,
      });
    }

    const updated = await credentialRepository.updateCredential(req.params.id, updates);
    res.json({ data: updated });
  })
);

/**
 * DELETE /api/credentials/:id
 * Permanently remove a credential. Always allowed for the owning holder —
 * unlike editing, deleting a verified/signed credential doesn't risk
 * desyncing displayed fields from anything, it's the holder removing an
 * entry from their own profile (same reasoning already applied to
 * verified Education/WorkExperience entries).
 */
router.delete(
  '/:id',
  authenticate,
  asyncHandler(async (req, res) => {
    const credential = await credentialRepository.findCredentialById(req.params.id);
    if (!credential) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Credential not found', requestId: req.id });
    }
    if (String(credential.holder_id) !== String(req.user.id)) {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'Not your credential', requestId: req.id });
    }
    await credentialRepository.deleteCredential(req.params.id);
    res.status(204).end();
  })
);

/**
 * POST /api/credentials/:id/request-verification
 * Holder-triggered: flag this credential for admin review. Does not verify
 * it immediately — a platform_admin still has to confirm it via the admin
 * verification queue.
 */
router.post(
  '/:id/request-verification',
  authenticate,
  asyncHandler(async (req, res) => {
    const credential = await credentialRepository.findCredentialById(req.params.id);
    if (!credential) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Credential not found', requestId: req.id });
    }
    if (String(credential.holder_id) !== String(req.user.id)) {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'Not your credential', requestId: req.id });
    }
    if (credential.verified) {
      return res.status(422).json({ error: 'VALIDATION_ERROR', message: 'This credential is already verified', requestId: req.id });
    }
    const updated = await credentialRepository.requestVerification(req.params.id);
    res.json({ data: updated });
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
