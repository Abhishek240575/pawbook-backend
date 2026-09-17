const jwt            = require('jsonwebtoken');
const rateLimit      = require('express-rate-limit');
const { validationResult } = require('express-validator');
const { query }      = require('../config/db');
const R              = require('../utils/response');
const logger         = require('../utils/logger');

// ── AUTH ──────────────────────────────────────────────────────
/**
 * Verifies JWT from Authorization: Bearer <token>
 * Attaches req.user = { user_id, username, role, is_verified }
 */
const authenticate = async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer '))
    return R.unauthorized(res, 'No token provided');

  const token = header.split(' ')[1];
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    // Verify user still exists and is active
    const { rows } = await query(
      `SELECT user_id, username, role, status, is_verified
         FROM "User"
        WHERE user_id = $1 AND deleted_at IS NULL`,
      [payload.user_id]
    );
    if (!rows.length)
      return R.unauthorized(res, 'User not found');
    if (rows[0].status === 'suspended')
      return R.forbidden(res, 'Account suspended');
    if (rows[0].status === 'deactivated')
      return R.forbidden(res, 'Account deactivated');

    req.user = rows[0];
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError')
      return R.unauthorized(res, 'Token expired');
    return R.unauthorized(res, 'Invalid token');
  }
};

/**
 * Role guard — use after authenticate
 * e.g. requireRole('vet', 'admin')
 */
const requireRole = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role))
    return R.forbidden(res, `Requires role: ${roles.join(' or ')}`);
  next();
};

/**
 * Verified-only guard — use after authenticate
 */
const requireVerified = (req, res, next) => {
  if (!req.user.is_verified)
    return R.forbidden(res, 'Account verification required');
  next();
};

// ── VALIDATION ────────────────────────────────────────────────
/**
 * Reads express-validator errors and returns 400 if any exist.
 * Place after your validator chain:
 *   router.post('/route', [...validators], validate, controller)
 */
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty())
    return R.badRequest(res, 'Validation failed', errors.array());
  next();
};

// ── RATE LIMITING ─────────────────────────────────────────────
const defaultLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max:      parseInt(process.env.RATE_LIMIT_MAX) || 100,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { success: false, message: 'Too many requests, slow down' }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 min
  max:      10,               // 10 login attempts per window
  message: { success: false, message: 'Too many auth attempts' }
});

const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,  // 1 min
  max:      10,
  message: { success: false, message: 'Too many uploads' }
});

// ── ERROR HANDLER ─────────────────────────────────────────────
const errorHandler = (err, req, res, next) => {
  logger.error(err.message, {
    stack:  err.stack,
    url:    req.originalUrl,
    method: req.method,
    user:   req.user?.user_id
  });

  // PostgreSQL error codes
  if (err.code === '23505') // unique_violation
    return R.conflict(res, 'Resource already exists');
  if (err.code === '23503') // foreign_key_violation
    return R.badRequest(res, 'Referenced resource does not exist');
  if (err.code === '23514') // check_violation
    return R.badRequest(res, 'Data failed validation check');

  R.serverError(res, process.env.NODE_ENV === 'production'
    ? 'Something went wrong'
    : err.message);
};

// ── REQUEST LOGGER ────────────────────────────────────────────
const requestLogger = (req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    logger.info(`${req.method} ${req.originalUrl}`, {
      status:   res.statusCode,
      duration: `${Date.now() - start}ms`,
      user:     req.user?.user_id || 'anon'
    });
  });
  next();
};

// ── PAGINATION PARSER ─────────────────────────────────────────
/**
 * Parses ?page=1&limit=20 from query string.
 * Attaches req.pagination = { page, limit, offset }
 */
const parsePagination = (req, res, next) => {
  const page  = Math.max(parseInt(req.query.page)  || 1, 1);
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  req.pagination = { page, limit, offset: (page - 1) * limit };
  next();
};

module.exports = {
  authenticate,
  requireRole,
  requireVerified,
  validate,
  defaultLimiter,
  authLimiter,
  uploadLimiter,
  errorHandler,
  requestLogger,
  parsePagination
};
