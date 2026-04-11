import rateLimit from 'express-rate-limit';

/**
 * Rate limiter for authentication endpoints.
 * 100 requests per 15 minutes per IP (in-memory store).
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'RATE_LIMIT_EXCEEDED',
    message: 'Too many authentication attempts. Please try again later.',
  },
});

/**
 * Rate limiter for general API endpoints.
 * 500 requests per 15 minutes per IP (in-memory store).
 */
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'RATE_LIMIT_EXCEEDED',
    message: 'Too many requests. Please slow down.',
  },
});
