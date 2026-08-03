import { Router } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import Joi from 'joi';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/auth.js';
import { authLimiter } from '../middleware/rateLimiter.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import * as holderRepository from '../repositories/holderRepository.js';
import { sendEmail, verificationEmail, passwordResetEmail } from '../services/emailService.js';
import logger from '../utils/logger.js';

const router = Router();

const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000; // 1h

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Fire-and-forget: never let an email hiccup fail the request that
// triggered it (registration/forgot-password should still succeed even if
// ACS is briefly unavailable).
function sendEmailSafely(to, subject, html) {
  sendEmail(to, subject, html).catch((err) => {
    logger.error(`[auth] Failed to send email to ${to}: ${err.message}`);
  });
}

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

const forgotPasswordSchema = Joi.object({
  email: Joi.string().email().lowercase().required(),
});

const resetPasswordSchema = Joi.object({
  token: Joi.string().required(),
  password: Joi.string().min(8).max(128).required(),
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

    const verificationToken = generateToken();
    await holderRepository.setEmailVerificationToken(
      holderId,
      verificationToken,
      new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS)
    );
    const verifyUrl = `${process.env.FRONTEND_URL}/verify-email?token=${verificationToken}`;
    sendEmailSafely(email, 'Verify your Cazini Job Passport email', verificationEmail(full_name, verifyUrl));

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
 * GET /api/auth/verify-email?token=...
 */
router.get(
  '/verify-email',
  asyncHandler(async (req, res) => {
    const { token } = req.query;
    if (!token || typeof token !== 'string') {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Missing token', requestId: req.id });
    }

    const holder = await holderRepository.findHolderByVerificationToken(token);
    if (!holder) {
      return res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'This verification link is invalid or has expired',
        requestId: req.id,
      });
    }

    const holderId = String(holder.id || holder._id);
    await holderRepository.markEmailVerified(holderId);

    logger.info(`Holder verified email: ${holderId}`);
    res.json({ message: 'Email verified successfully' });
  })
);

/**
 * POST /api/auth/resend-verification
 */
router.post(
  '/resend-verification',
  authenticate,
  authLimiter,
  asyncHandler(async (req, res) => {
    const holder = await holderRepository.findHolderById(req.user.id);
    if (!holder) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Account not found', requestId: req.id });
    }
    if (holder.email_verified) {
      return res.json({ message: 'Your email is already verified' });
    }

    const verificationToken = generateToken();
    await holderRepository.setEmailVerificationToken(
      req.user.id,
      verificationToken,
      new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS)
    );
    const verifyUrl = `${process.env.FRONTEND_URL}/verify-email?token=${verificationToken}`;
    sendEmailSafely(holder.email, 'Verify your Cazini Job Passport email', verificationEmail(holder.full_name, verifyUrl));

    res.json({ message: 'Verification email sent' });
  })
);

/**
 * POST /api/auth/forgot-password
 * Always responds with the same generic message regardless of whether the
 * email exists, to avoid leaking which emails are registered.
 */
router.post(
  '/forgot-password',
  authLimiter,
  validate(forgotPasswordSchema),
  asyncHandler(async (req, res) => {
    const { email } = req.body;
    const genericMessage = "If an account exists for that email, we've sent a password reset link";

    const holder = await holderRepository.findHolderByEmail(email);
    if (holder) {
      const holderId = String(holder.id || holder._id);
      const resetToken = generateToken();
      await holderRepository.setPasswordResetToken(
        holderId,
        resetToken,
        new Date(Date.now() + PASSWORD_RESET_TTL_MS)
      );
      const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;
      sendEmailSafely(email, 'Reset your Cazini Job Passport password', passwordResetEmail(holder.full_name, resetUrl));
    }

    res.json({ message: genericMessage });
  })
);

/**
 * POST /api/auth/reset-password
 */
router.post(
  '/reset-password',
  authLimiter,
  validate(resetPasswordSchema),
  asyncHandler(async (req, res) => {
    const { token, password } = req.body;

    const holder = await holderRepository.findHolderByResetToken(token);
    if (!holder) {
      return res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'This password reset link is invalid or has expired',
        requestId: req.id,
      });
    }

    const holderId = String(holder.id || holder._id);
    const password_hash = await bcrypt.hash(password, 12);
    await holderRepository.resetPassword(holderId, password_hash);

    logger.info(`Holder reset password: ${holderId}`);
    res.json({ message: 'Password reset successfully' });
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
