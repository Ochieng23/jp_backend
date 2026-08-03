import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import Joi from 'joi';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/auth.js';
import { authLimiter } from '../middleware/rateLimiter.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import * as holderRepository from '../repositories/holderRepository.js';
import logger from '../utils/logger.js';

const router = Router();

// ─── Validation schemas ───────────────────────────────────────────────────────

const registerSchema = Joi.object({
  // Minimal signup: name + email + password. Everything else is filled in
  // later while building out the profile (PATCH /passport/me).
  full_name: Joi.string().min(2).max(120).required(),
  email: Joi.string().email().lowercase().required(),
  password: Joi.string().min(8).max(128).required(),
  date_of_birth: Joi.string()
    .isoDate()
    .optional()
    .messages({ 'string.isoDate': 'date_of_birth must be an ISO 8601 date string' }),
  nationality: Joi.string().min(2).max(80).optional(),
  phone: Joi.string().min(5).max(30).optional(),
});

const loginSchema = Joi.object({
  email: Joi.string().email().lowercase().required(),
  password: Joi.string().required(),
});

const refreshSchema = Joi.object({
  refreshToken: Joi.string().required(),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function issueTokens(holderId, email, role = 'holder') {
  const accessToken = jwt.sign(
    { id: holderId, email, role },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: process.env.JWT_ACCESS_TTL || '15m', subject: holderId }
  );

  const refreshToken = jwt.sign(
    { id: holderId, email },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_TTL || '7d', subject: holderId }
  );

  return { accessToken, refreshToken };
}

function sanitizeHolder(holder) {
  // eslint-disable-next-line no-unused-vars
  const { password_hash, ...safe } = holder;
  return safe;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * POST /api/auth/register
 */
router.post(
  '/register',
  authLimiter,
  validate(registerSchema),
  asyncHandler(async (req, res) => {
    const { full_name, date_of_birth, nationality, email, password, phone } = req.body;

    const existing = await holderRepository.findHolderByEmail(email);
    if (existing) {
      return res.status(409).json({
        error: 'CONFLICT',
        message: 'An account with this email already exists',
        requestId: req.id,
      });
    }

    const password_hash = await bcrypt.hash(password, 12);

    const holder = await holderRepository.createHolder({
      full_name,
      date_of_birth,
      nationality,
      email,
      password_hash,
      phone,
    });

    const holderId = String(holder.id || holder._id);
    const { accessToken, refreshToken } = issueTokens(holderId, email);

    logger.info(`New holder registered: ${holderId} (${email})`);

    res.status(201).json({
      user: sanitizeHolder({ ...holder }),
      accessToken,
      refreshToken,
    });
  })
);

/**
 * POST /api/auth/login
 */
router.post(
  '/login',
  authLimiter,
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;

    const holder = await holderRepository.findHolderByEmail(email);
    if (!holder) {
      return res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'Invalid email or password',
        requestId: req.id,
      });
    }

    const passwordMatch = await bcrypt.compare(password, holder.password_hash);
    if (!passwordMatch) {
      return res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'Invalid email or password',
        requestId: req.id,
      });
    }

    const holderId = String(holder.id || holder._id);
    const { accessToken, refreshToken } = issueTokens(holderId, holder.email, holder.role);

    logger.info(`Holder logged in: ${holderId}`);

    res.json({
      user: sanitizeHolder({ ...holder }),
      accessToken,
      refreshToken,
    });
  })
);

/**
 * POST /api/auth/refresh
 * Stateless: verifies the refresh token signature and issues a new token pair.
 */
router.post(
  '/refresh',
  validate(refreshSchema),
  asyncHandler(async (req, res) => {
    const { refreshToken } = req.body;

    let decoded;
    try {
      decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    } catch (err) {
      return res.status(401).json({
        error: 'UNAUTHORIZED',
        message: err.name === 'TokenExpiredError' ? 'Refresh token expired' : 'Invalid refresh token',
        requestId: req.id,
      });
    }

    const { id: holderId, email } = decoded;
    const holder = await holderRepository.findHolderById(holderId);
    if (!holder) {
      return res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'Account no longer exists',
        requestId: req.id,
      });
    }
    const { accessToken: newAccessToken, refreshToken: newRefreshToken } = issueTokens(holderId, email, holder.role);

    res.json({
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
    });
  })
);

/**
 * POST /api/auth/logout
 * Stateless: client discards tokens. Returns 204.
 */
router.post(
  '/logout',
  authenticate,
  asyncHandler(async (req, res) => {
    logger.info(`Holder logged out: ${req.user.id}`);
    res.status(204).end();
  })
);

export default router;
