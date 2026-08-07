import { Router } from 'express';
import Joi from 'joi';
import { v4 as uuidv4 } from 'uuid';
import { validate } from '../middleware/validate.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { parsePagination, paginate } from '../utils/paginationUtils.js';
import * as auditRepository from '../repositories/auditRepository.js';
import * as educationRepository from '../repositories/educationRepository.js';
import * as workExperienceRepository from '../repositories/workExperienceRepository.js';
import * as credentialRepository from '../repositories/credentialRepository.js';
import * as holderRepository from '../repositories/holderRepository.js';
import * as talentClassifierService from '../services/talentClassifierService.js';
import { INDUSTRIES } from '../constants/industries.js';
import logger from '../utils/logger.js';

const router = Router();

// All admin routes require platform_admin role
router.use(authenticate, requireRole('platform_admin'));

const MAX_BULK_CLASSIFY = 30;

const updateRoleSchema = Joi.object({
  role: Joi.string().valid('holder', 'org_admin', 'platform_admin').required(),
});

const bulkClassifySchema = Joi.object({
  holder_ids: Joi.array().items(Joi.string()).max(MAX_BULK_CLASSIFY),
  all_unclassified: Joi.boolean(),
}).or('holder_ids', 'all_unclassified');

const updateHolderSchema = Joi.object({
  full_name: Joi.string().min(2).max(120),
  phone: Joi.string().min(5).max(30).allow(null, ''),
  nationality: Joi.string().min(2).max(80),
  date_of_birth: Joi.string().isoDate(),
  bio: Joi.string().max(600).allow(null, ''),
  industries: Joi.array().items(Joi.string().valid(...INDUSTRIES)).max(INDUSTRIES.length),
  open_to_any_industry: Joi.boolean(),
}).min(1);

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
 * Get aggregate platform statistics: counts by actor type, action, and
 * resource type from the audit log, plus platform-wide totals and
 * pending-verification counts for the admin dashboard.
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

/**
 * GET /api/admin/holders
 * List/search all holders, paginated. Optionally filtered by AI-derived
 * talent classification (industry, expertise_area, seniority_level,
 * classified=true|false).
 */
router.get(
  '/holders',
  asyncHandler(async (req, res) => {
    const { page, pageSize, offset } = parsePagination(req.query);
    const { rows, total } = await holderRepository.findAll({
      search: req.query.search,
      industry: req.query.industry,
      expertise_area: req.query.expertise_area,
      seniority_level: req.query.seniority_level,
      classified: req.query.classified,
      limit: pageSize,
      offset,
    });
    res.json(paginate(rows, total, page, pageSize));
  })
);

/**
 * PATCH /api/admin/holders/:id/role
 * Change a holder's role (holder/org_admin/platform_admin).
 */
router.patch(
  '/holders/:id/role',
  validate(updateRoleSchema),
  asyncHandler(async (req, res) => {
    const holder = await holderRepository.findHolderById(req.params.id);
    if (!holder) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Holder not found', requestId: req.id });
    }

    // Guardrail: an admin can't demote their own account. This doesn't
    // fully prevent a platform ending up with zero platform_admins (another
    // admin could still demote this account), but blocks the most common
    // way to accidentally lock yourself out.
    if (String(req.user.id) === String(req.params.id) && req.body.role !== 'platform_admin') {
      return res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'You cannot change your own role',
        requestId: req.id,
      });
    }

    const updated = await holderRepository.updateRole(req.params.id, req.body.role);

    await auditRepository.logAction({
      id: uuidv4(),
      actor_id: req.user.id,
      actor_type: 'admin',
      action: 'holder.role_changed',
      resource_type: 'holder',
      resource_id: req.params.id,
      metadata: { from: holder.role, to: req.body.role },
      ip_address: req.ip,
    });

    res.json({ data: updated });
  })
);

/**
 * GET /api/admin/holders/:id
 * Full holder profile plus every credential, education, and work
 * experience record — no status/verified/deleted filtering, so the admin
 * sees everything (revoked credentials, soft-deleted entries included).
 */
router.get(
  '/holders/:id',
  asyncHandler(async (req, res) => {
    const profile = await holderRepository.getFullProfile(req.params.id);
    if (!profile) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Holder not found', requestId: req.id });
    }
    res.json({ data: profile });
  })
);

/**
 * PATCH /api/admin/holders/:id
 * Edit a holder's profile fields on their behalf.
 */
router.patch(
  '/holders/:id',
  validate(updateHolderSchema),
  asyncHandler(async (req, res) => {
    const holder = await holderRepository.findHolderById(req.params.id);
    if (!holder) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Holder not found', requestId: req.id });
    }

    const updated = await holderRepository.updateHolder(req.params.id, req.body);

    await auditRepository.logAction({
      id: uuidv4(),
      actor_id: req.user.id,
      actor_type: 'admin',
      action: 'holder.profile_edited',
      resource_type: 'holder',
      resource_id: req.params.id,
      metadata: { fields: Object.keys(req.body) },
      ip_address: req.ip,
    });

    res.json({ data: updated });
  })
);

/**
 * DELETE /api/admin/holders/:id
 * Permanently delete a holder and every record that belongs to them
 * (credentials, education, work experience, share links). Irreversible.
 */
router.delete(
  '/holders/:id',
  asyncHandler(async (req, res) => {
    const holder = await holderRepository.findHolderById(req.params.id);
    if (!holder) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Holder not found', requestId: req.id });
    }

    if (String(req.user.id) === String(req.params.id)) {
      return res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'You cannot delete your own account',
        requestId: req.id,
      });
    }

    await holderRepository.deleteHolder(req.params.id);

    await auditRepository.logAction({
      id: uuidv4(),
      actor_id: req.user.id,
      actor_type: 'admin',
      action: 'holder.deleted',
      resource_type: 'holder',
      resource_id: req.params.id,
      metadata: { full_name: holder.full_name, email: holder.email },
      ip_address: req.ip,
    });

    res.status(204).end();
  })
);

/**
 * GET /api/admin/talent-pool
 * Aggregate breakdown of the talent pool by AI-derived industry, seniority
 * level, and top expertise tags, for the Talent Pool analytics page.
 */
router.get(
  '/talent-pool',
  asyncHandler(async (_req, res) => {
    const stats = await holderRepository.getTalentPoolStats();
    res.json({ data: stats });
  })
);

/**
 * Runs the classification agent for one holder and persists the result.
 * Shared by the single and bulk classify routes.
 */
async function classifyAndSave(holderId, actorId, req) {
  const profile = await holderRepository.getFullProfile(holderId);
  if (!profile) {
    const err = new Error('Holder not found');
    err.statusCode = 404;
    throw err;
  }

  const classification = await talentClassifierService.classifyHolder(profile.holder, {
    education: profile.education,
    workExperience: profile.work_experience,
    credentials: profile.credentials,
  });

  const updated = await holderRepository.saveTalentClassification(holderId, classification);

  await auditRepository.logAction({
    id: uuidv4(),
    actor_id: actorId,
    actor_type: 'admin',
    action: 'holder.classified',
    resource_type: 'holder',
    resource_id: holderId,
    metadata: {
      primary_industry: classification.primary_industry,
      seniority_level: classification.seniority_level,
      confidence: classification.confidence,
    },
    ip_address: req.ip,
  });

  return updated;
}

/**
 * POST /api/admin/holders/:id/classify
 * Run the AI talent-classification agent for one holder and persist the
 * result. Safe to re-run (e.g. after the holder's profile changes) —
 * overwrites any previous classification.
 */
router.post(
  '/holders/:id/classify',
  asyncHandler(async (req, res) => {
    const updated = await classifyAndSave(req.params.id, req.user.id, req);
    res.json({ data: updated });
  })
);

/**
 * POST /api/admin/holders/classify-bulk
 * Classify up to MAX_BULK_CLASSIFY holders in one call, either an explicit
 * holder_ids list or every currently-unclassified holder. Runs sequentially
 * (the underlying Claude deployment has a per-minute request ceiling) and
 * keeps going past individual failures so one bad profile doesn't block the
 * rest of the batch.
 */
router.post(
  '/holders/classify-bulk',
  validate(bulkClassifySchema),
  asyncHandler(async (req, res) => {
    let ids = req.body.holder_ids;
    if (req.body.all_unclassified) {
      // Jobseekers only — admin/org accounts aren't part of the talent pool.
      const { rows } = await holderRepository.findAll({ role: 'holder', classified: false, limit: MAX_BULK_CLASSIFY });
      ids = rows.map((h) => String(h._id || h.id));
    }
    if (!ids?.length) {
      return res.json({ data: { classified: [], failed: [] } });
    }
    if (ids.length > MAX_BULK_CLASSIFY) {
      return res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: `Cannot classify more than ${MAX_BULK_CLASSIFY} holders in one request`,
        requestId: req.id,
      });
    }

    const classified = [];
    const failed = [];
    for (const id of ids) {
      try {
        const updated = await classifyAndSave(id, req.user.id, req);
        classified.push({ id, primary_industry: updated.talent_classification?.primary_industry });
      } catch (err) {
        logger.warn(`Bulk classify failed for holder ${id}: ${err.message}`);
        failed.push({ id, error: err.message });
      }
    }

    res.json({ data: { classified, failed } });
  })
);

export default router;
