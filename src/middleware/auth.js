import jwt from 'jsonwebtoken';
import logger from '../utils/logger.js';

/**
 * Extract and verify the Bearer JWT from the Authorization header.
 * On success, attaches req.user = { id, email, role }.
 * On failure, responds 401.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'No token provided',
      requestId: req.id,
    });
  }

  const token = authHeader.slice(7);
  try {
    const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    req.user = {
      id: decoded.sub || decoded.id,
      email: decoded.email,
      role: decoded.role,
    };
    next();
  } catch (err) {
    logger.debug(`JWT verification failed: ${err.message}`);
    const message = err.name === 'TokenExpiredError' ? 'Token expired' : 'Invalid token';
    return res.status(401).json({
      error: 'UNAUTHORIZED',
      message,
      requestId: req.id,
    });
  }
}

/**
 * Like authenticate but does NOT fail if no token is present.
 * If a valid token is present, sets req.user; otherwise req.user remains undefined.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next();
  }

  const token = authHeader.slice(7);
  try {
    const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    req.user = {
      id: decoded.sub || decoded.id,
      email: decoded.email,
      role: decoded.role,
    };
  } catch (_err) {
    // Silently ignore invalid tokens for optional auth
  }
  next();
}

/**
 * Middleware factory — ensures the authenticated user has one of the allowed roles.
 * Must be used AFTER authenticate middleware.
 *
 * @param {...string} roles - Allowed role values ('holder', 'org_admin', 'platform_admin')
 * @returns {import('express').RequestHandler}
 *
 * @example
 * router.patch('/verify', authenticate, requireRole('platform_admin'), handler);
 */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'Authentication required',
        requestId: req.id,
      });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error: 'FORBIDDEN',
        message: `Role '${req.user.role}' is not permitted to perform this action`,
        requestId: req.id,
      });
    }
    next();
  };
}
