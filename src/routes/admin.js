import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authenticate, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { parsePagination, paginate } from '../utils/paginationUtils.js';
import * as auditRepository from '../repositories/auditRepository.js';
import * as educationRepository from '../repositories/educationRepository.js';
import * as workExperienceRepository from '../repositories/workExperienceRepository.js';
import * as credentialRepository from '../repositories/credentialRepository.js';

const router = Router();

// All admin routes require platform_admin role
router.use(authenticate, requireRole('platform_admin'));

/**
 * GET /api/admin/audit
 * Retrieve all audit log entries with optional filters and pagination.
 * Filters: actor_type, action, resource_type, from (ISO date), to (ISO date)
 */
router.get(
  '/audit',
  asyncHandler(async (req, res) => {
    const { page, pageSize, offset } = parsePagination(req.query);

    const filters = {
      actor_type: req.query.actor_type,
      action: req.query.action,
      resource_type: req.query.resource_type,
      from: req.query.from,
      to: req.query.to,
    };

    // Remove undefined filters
    for (const key of Object.keys(filters)) {
      if (filters[key] === undefined) {
        delete filters[key];
      }
    }

    const { rows, total } = await auditRepository.findAll(filters, {
      limit: pageSize,
      offset,
    });

    res.json(paginate(rows, total, page, pageSize));
  })
);

/**
 * GET /api/admin/stats
 * Get aggregate statistics from the audit log:
 * - counts by actor type, action, resource type
 * - daily activity for the past 30 days
 */
router.get(
  '/stats',
  asyncHandler(async (_req, res) => {
    const stats = await auditRepository.getStats();
    res.json({ data: stats });
  })
);

/**
 * GET /api/admin/education/pending
 * List unverified education entries across all holders, for admin review.
 */
router.get(
  '/education/pending',
  asyncHandler(async (req, res) => {
    const { page, pageSize, offset } = parsePagination(req.query);
    const { rows, total } = await educationRepository.findAllPending({
      limit: pageSize,
      offset,
    });
    res.json(paginate(rows, total, page, pageSize));
  })
);

/**
 * PATCH /api/admin/education/:id/verify
 * Mark an education entry as verified.
 */
router.patch(
  '/education/:id/verify',
  asyncHandler(async (req, res) => {
    const entry = await educationRepository.findById(req.params.id);
    if (!entry) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Entry not found', requestId: req.id });
    }

    const verified = await educationRepository.verifyEntry(req.params.id);

    await auditRepository.logAction({
      id: uuidv4(),
      actor_id: req.user.id,
      actor_type: 'admin',
      action: 'education.verified',
      resource_type: 'education',
      resource_id: req.params.id,
      metadata: { institution_name: entry.institution_name, qualification: entry.qualification },
      ip_address: req.ip,
    });

    res.json({ data: verified });
  })
);

/**
 * GET /api/admin/work-experience/pending
 * List unverified work experience entries across all holders, for admin review.
 */
router.get(
  '/work-experience/pending',
  asyncHandler(async (req, res) => {
    const { page, pageSize, offset } = parsePagination(req.query);
    const { rows, total } = await workExperienceRepository.findAllPending({
      limit: pageSize,
      offset,
    });
    res.json(paginate(rows, total, page, pageSize));
  })
);

/**
 * PATCH /api/admin/work-experience/:id/verify
 * Mark a work experience entry as verified.
 */
router.patch(
  '/work-experience/:id/verify',
  asyncHandler(async (req, res) => {
    const entry = await workExperienceRepository.findById(req.params.id);
    if (!entry) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Entry not found', requestId: req.id });
    }

    const verified = await workExperienceRepository.verifyEntry(req.params.id);

    await auditRepository.logAction({
      id: uuidv4(),
      actor_id: req.user.id,
      actor_type: 'admin',
      action: 'work_experience.verified',
      resource_type: 'work_experience',
      resource_id: req.params.id,
      metadata: { employer_name: entry.employer_name, job_title: entry.job_title },
      ip_address: req.ip,
    });

    res.json({ data: verified });
  })
);

/**
 * GET /api/admin/credentials/pending
 * List unverified credentials across all holders, for admin review.
 * Credentials the holder has explicitly requested verification for are
 * surfaced first (see findAllPending's sort order).
 */
router.get(
  '/credentials/pending',
  asyncHandler(async (req, res) => {
    const { page, pageSize, offset } = parsePagination(req.query);
    const { rows, total } = await credentialRepository.findAllPending({
      limit: pageSize,
      offset,
    });
    res.json(paginate(rows, total, page, pageSize));
  })
);

/**
 * PATCH /api/admin/credentials/:id/verify
 * Mark a credential as verified.
 */
router.patch(
  '/credentials/:id/verify',
  asyncHandler(async (req, res) => {
    const credential = await credentialRepository.findCredentialById(req.params.id);
    if (!credential) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Credential not found', requestId: req.id });
    }

    const verified = await credentialRepository.markVerified(req.params.id);

    await auditRepository.logAction({
      id: uuidv4(),
      actor_id: req.user.id,
      actor_type: 'admin',
      action: 'credential.verified',
      resource_type: 'credential',
      resource_id: req.params.id,
      metadata: { title: credential.title },
      ip_address: req.ip,
    });

    res.json({ data: verified });
  })
);

export default router;
