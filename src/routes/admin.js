import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { parsePagination, paginate } from '../utils/paginationUtils.js';
import * as auditRepository from '../repositories/auditRepository.js';

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

export default router;
