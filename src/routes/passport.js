import { Router } from 'express';
import jwt from 'jsonwebtoken';
import Joi from 'joi';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { parsePagination, paginate } from '../utils/paginationUtils.js';
import * as holderRepository from '../repositories/holderRepository.js';
import * as auditRepository from '../repositories/auditRepository.js';
import ShareLink from '../models/ShareLink.js';
import Credential from '../models/Credential.js';
import WorkExperience from '../models/WorkExperience.js';

// ── Short slug helper (8-char base62) ─────────────────────────────────────────
const SLUG_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
function generateSlug(len = 8) {
  let s = '';
  for (let i = 0; i < len; i++) s += SLUG_CHARS[Math.floor(Math.random() * SLUG_CHARS.length)];
  return s;
}

// ── Build the public holder view (shared helper) ───────────────────────────────
async function buildPublicView(holderId) {
  const holder = await holderRepository.getHolderWithCredentialSummary(holderId);
  if (!holder) return null;

  // Remove truly private fields; keep avatar_key and bio for the profile
  const { email, phone, unhcr_id, password_hash, ...publicHolder } = holder;

  const credentials = await Credential.find({ holder_id: holder._id, status: 'active' })
    .sort({ issued_at: -1 })
    .lean();

  const workExperiences = await WorkExperience.find({ holder_id: holder._id })
    .sort({ start_date: -1 })
    .lean();

  return { holder: publicHolder, credentials, workExperiences };
}

const router = Router();

const updateMeSchema = Joi.object({
  full_name: Joi.string().min(2).max(120),
  phone: Joi.string().min(5).max(30).allow(null, ''),
  nationality: Joi.string().min(2).max(80),
  date_of_birth: Joi.string().isoDate(),
  bio: Joi.string().max(600).allow(null, ''),
  avatar_key: Joi.string().max(2_000_000).allow(null, ''), // URL or base64 data URI
  intro_video_url: Joi.string().uri().max(2000).allow(null, ''),
}).min(1);

// ── Parse expires_in like "1h", "7d", "30d" into seconds ──────────────────────
function parseExpiresIn(str) {
  if (!str) return 24 * 3600; // default 24h
  const n = parseInt(str, 10);
  if (isNaN(n)) return 24 * 3600;
  if (str.endsWith('d')) return n * 24 * 3600;
  if (str.endsWith('h')) return n * 3600;
  if (str.endsWith('m')) return n * 60;
  return n; // assume seconds
}

/**
 * GET /api/passport/me
 */
router.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    const holder = await holderRepository.getHolderWithCredentialSummary(req.user.id);
    if (!holder) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Holder not found', requestId: req.id });
    }
    res.json({ data: holder });
  })
);

/**
 * PATCH /api/passport/me
 */
router.patch(
  '/me',
  authenticate,
  validate(updateMeSchema),
  asyncHandler(async (req, res) => {
    const updated = await holderRepository.updateHolder(req.user.id, req.body);
    if (!updated) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Holder not found', requestId: req.id });
    }
    res.json({ data: updated });
  })
);

/**
 * GET /api/passport/me/avatar/download
 * Streams the holder's profile photo as a file download. Handles both
 * Azure blob URLs and base64 data-URI avatars (the no-storage fallback),
 * so the browser never needs CORS access to the storage account.
 */
const AVATAR_EXT_BY_TYPE = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

router.get(
  '/me/avatar/download',
  authenticate,
  asyncHandler(async (req, res) => {
    const holder = await holderRepository.findHolderById(req.user.id);
    if (!holder?.avatar_key) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'No profile photo set', requestId: req.id });
    }

    if (holder.avatar_key.startsWith('data:')) {
      const match = holder.avatar_key.match(/^data:([^;]+);base64,(.+)$/);
      if (!match) {
        return res.status(422).json({ error: 'UNPROCESSABLE', message: 'Stored photo is not downloadable', requestId: req.id });
      }
      const [, contentType, b64] = match;
      const ext = AVATAR_EXT_BY_TYPE[contentType] || 'img';
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="profile-photo.${ext}"`);
      return res.send(Buffer.from(b64, 'base64'));
    }

    // Remote URL — only proxy our own storage account, never arbitrary
    // hosts (avatar_key is holder-settable, so an open proxy here would
    // be an SSRF vector).
    let parsed;
    try {
      parsed = new URL(holder.avatar_key);
    } catch {
      return res.status(422).json({ error: 'UNPROCESSABLE', message: 'Stored photo is not downloadable', requestId: req.id });
    }
    if (!parsed.hostname.endsWith('.blob.core.windows.net')) {
      return res.status(422).json({ error: 'UNPROCESSABLE', message: 'Stored photo is not downloadable', requestId: req.id });
    }

    const upstream = await fetch(holder.avatar_key);
    if (!upstream.ok) {
      return res.status(502).json({ error: 'BAD_GATEWAY', message: 'Could not fetch the stored photo', requestId: req.id });
    }
    const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
    const ext = AVATAR_EXT_BY_TYPE[contentType] || 'img';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="profile-photo.${ext}"`);
    return res.send(Buffer.from(await upstream.arrayBuffer()));
  })
);

/**
 * POST /api/passport/share-link
 * Generate a time-limited share token and persist it.
 */
router.post(
  '/share-link',
  authenticate,
  asyncHandler(async (req, res) => {
    const expiresInSeconds = parseExpiresIn(req.body?.expires_in);
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);

    const token = jwt.sign(
      { type: 'share', holderId: req.user.id, sub: req.user.id },
      process.env.JWT_ACCESS_SECRET,
      { expiresIn: expiresInSeconds }
    );

    // Generate a unique 8-char slug; retry on the rare collision
    let slug;
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = generateSlug();
      const exists = await ShareLink.exists({ slug: candidate });
      if (!exists) { slug = candidate; break; }
    }
    if (!slug) slug = generateSlug(12); // extremely unlikely fallback

    const link = await ShareLink.create({
      holder_id: req.user.id,
      token,
      slug,
      expires_at: expiresAt,
    });

    res.json({ _id: link._id, token, slug, expires_at: expiresAt.toISOString() });
  })
);

/**
 * GET /api/passport/share-links
 * List all share links for the authenticated holder.
 */
router.get(
  '/share-links',
  authenticate,
  asyncHandler(async (req, res) => {
    const links = await ShareLink.find({ holder_id: req.user.id })
      .sort({ created_at: -1 })
      .lean();
    res.json({ links });
  })
);

/**
 * DELETE /api/passport/share-links/:id
 * Revoke (delete) a share link.
 */
router.delete(
  '/share-links/:id',
  authenticate,
  asyncHandler(async (req, res) => {
    const link = await ShareLink.findOneAndDelete({
      _id: req.params.id,
      holder_id: req.user.id,
    });
    if (!link) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Share link not found', requestId: req.id });
    }
    res.status(204).end();
  })
);

/**
 * GET /api/passport/s/:slug
 * Resolve a short slug to a public passport view (no auth required).
 */
router.get(
  '/s/:slug',
  asyncHandler(async (req, res) => {
    const link = await ShareLink.findOne({ slug: req.params.slug }).lean();

    if (!link) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Share link not found', requestId: req.id });
    }
    if (new Date() > link.expires_at) {
      return res.status(410).json({ error: 'GONE', message: 'Share link has expired', requestId: req.id });
    }

    const view = await buildPublicView(String(link.holder_id));
    if (!view) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Holder not found', requestId: req.id });
    }

    res.json({ data: view, expires_at: link.expires_at });
  })
);

/**
 * GET /api/passport/:id/public
 * Legacy: view a holder's passport using a JWT share token in query string.
 */
router.get(
  '/:id/public',
  asyncHandler(async (req, res) => {
    const { token } = req.query;

    if (!token) {
      return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Share token is required', requestId: req.id });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    } catch (err) {
      return res.status(401).json({
        error: 'UNAUTHORIZED',
        message: err.name === 'TokenExpiredError' ? 'Share link has expired' : 'Invalid share token',
        requestId: req.id,
      });
    }

    if (decoded.type !== 'share' || decoded.holderId !== req.params.id) {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'Token not valid for this holder', requestId: req.id });
    }

    const view = await buildPublicView(decoded.holderId);
    if (!view) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Holder not found', requestId: req.id });
    }

    res.json({ data: view });
  })
);

/**
 * GET /api/passport/me/audit
 */
router.get(
  '/me/audit',
  authenticate,
  asyncHandler(async (req, res) => {
    const { page, pageSize, offset } = parsePagination(req.query);
    const { rows, total } = await auditRepository.findByActor(req.user.id, { limit: pageSize, offset });
    res.json(paginate(rows, total, page, pageSize));
  })
);

export default router;
