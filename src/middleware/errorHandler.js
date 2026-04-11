import logger from '../utils/logger.js';

/**
 * Centralised Express error handler.
 * Must be registered last with app.use().
 * Returns structured JSON error responses.
 *
 * @param {Error} err
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} _next
 */
function errorHandler(err, req, res, _next) {
  // Always log the full error
  logger.error(`[${req.id}] ${err.stack || err.message}`);

  const requestId = req.id;

  // ─── JWT errors ─────────────────────────────────────────────────────────────
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'Invalid token',
      requestId,
    });
  }
  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'Token expired',
      requestId,
    });
  }

  // ─── PostgreSQL unique-violation ─────────────────────────────────────────────
  if (err.code === '23505') {
    return res.status(409).json({
      error: 'CONFLICT',
      message: 'A resource with this identifier already exists',
      details: err.detail || undefined,
      requestId,
    });
  }

  // ─── PostgreSQL foreign-key violation ────────────────────────────────────────
  if (err.code === '23503') {
    return res.status(422).json({
      error: 'VALIDATION_ERROR',
      message: 'Referenced resource does not exist',
      details: err.detail || undefined,
      requestId,
    });
  }

  // ─── Application-level errors with an explicit status ────────────────────────
  if (err.statusCode || err.status) {
    const status = err.statusCode || err.status;
    const codeMap = {
      400: 'BAD_REQUEST',
      401: 'UNAUTHORIZED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
      422: 'VALIDATION_ERROR',
    };
    return res.status(status).json({
      error: err.code || codeMap[status] || 'ERROR',
      message: err.message || 'An error occurred',
      details: err.details || undefined,
      requestId,
    });
  }

  // ─── Default 500 ─────────────────────────────────────────────────────────────
  res.status(500).json({
    error: 'INTERNAL_SERVER_ERROR',
    message:
      process.env.NODE_ENV === 'production'
        ? 'An unexpected error occurred'
        : err.message,
    requestId,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
}

export default errorHandler;
