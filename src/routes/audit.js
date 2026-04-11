import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { parsePagination, paginate } from '../utils/paginationUtils.js';
import * as auditRepository from '../repositories/auditRepository.js';

const router = Router();

/**
 * GET /api/audit/me
 * Get paginated audit log entries for the authenticated user.
 * This is a convenience alias for GET /api/passport/me/audit.
 */
router.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    const { page, pageSize, offset } = parsePagination(req.query);
    const { rows, total } = await auditRepository.findByActor(req.user.id, {
      limit: pageSize,
      offset,
    });
    res.json(paginate(rows, total, page, pageSize));
  })
);

export default router;
