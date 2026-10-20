/**
 * src/middleware/security.js
 * Rate limiting + Helmet security headers for PawBook API
 * Install deps: npm install helmet express-rate-limit
 */

const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

/* ── Helmet: secure HTTP headers ── */
const helmetConfig = helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }, // allow frontend on different origin
  contentSecurityPolicy: false, // disable CSP for now (add later with proper directives)
  crossOriginEmbedderPolicy: false,
});

/* ── General API rate limit: 100 req/15min per IP ── */
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests. Please try again in 15 minutes.' }
});

/* ── Auth rate limit: 10 req/15min per IP (stricter for login/register) ── */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many login attempts. Please try again in 15 minutes.' }
});

/* ── Post creation rate limit: 20 posts/hour per IP ── */
const postLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Posting too fast. Please slow down.' }
});

module.exports = { helmetConfig, generalLimiter, authLimiter, postLimiter };
