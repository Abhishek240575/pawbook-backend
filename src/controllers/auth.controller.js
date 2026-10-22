const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const { query, getClient } = require('../config/db');
const R      = require('../utils/response');
const logger = require('../utils/logger');
// ── EMAIL via Resend HTTP API (no SMTP — works on Render free tier) ───────────
async function sendVerificationEmail(email, username, token) {
  const link = `${process.env.API_URL || 'https://pawbook-api-cquc.onrender.com'}/api/v1/auth/verify-email?token=${token}`;
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto">
      <div style="background:#2563eb;padding:24px;border-radius:12px 12px 0 0;text-align:center">
        <h1 style="color:#fff;margin:0;font-size:24px">🐾 PawBook</h1>
      </div>
      <div style="background:#fff;padding:32px;border:1px solid #e2e8f0;border-radius:0 0 12px 12px">
        <h2 style="color:#1e293b;margin:0 0 12px">Hi ${username}! Welcome to PawBook 🎉</h2>
        <p style="color:#64748b;line-height:1.6">Please verify your email address to activate your account.</p>
        <a href="${link}" style="display:inline-block;margin:24px 0;padding:14px 32px;
          background:#2563eb;color:#fff;border-radius:8px;text-decoration:none;
          font-weight:700;font-size:16px">Verify Email Address</a>
        <p style="color:#94a3b8;font-size:13px">This link expires in 24 hours.<br>
        If you didn't sign up, you can safely ignore this email.</p>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0">
        <p style="color:#94a3b8;font-size:12px;text-align:center">
          Deemona Global Solutions · New Delhi 110075, India
        </p>
      </div>
    </div>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: process.env.SMTP_FROM_EMAIL || 'PawBook <onboarding@resend.dev>',
      to:   [email],
      subject: 'Verify your PawBook account',
      html,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Resend API error ${res.status}: ${err}`);
  }
}

// ── IN-MEMORY RATE LIMITER ─────────────────────────────────────────────────────
// Tracks failed login attempts per IP: { ip: { count, firstAttempt } }
const loginAttempts = new Map();
const MAX_ATTEMPTS  = 5;       // max failures before lockout
const WINDOW_MS     = 15 * 60 * 1000; // 15-minute window
const LOCKOUT_MS    = 15 * 60 * 1000; // 15-minute lockout

function getRateLimitInfo(ip) {
  const now  = Date.now();
  const info = loginAttempts.get(ip);
  if (!info) return { blocked: false, remaining: MAX_ATTEMPTS };

  // Reset window if expired
  if (now - info.firstAttempt > WINDOW_MS) {
    loginAttempts.delete(ip);
    return { blocked: false, remaining: MAX_ATTEMPTS };
  }

  if (info.count >= MAX_ATTEMPTS) {
    const retryAfter = Math.ceil((info.firstAttempt + LOCKOUT_MS - now) / 1000);
    return { blocked: true, retryAfter };
  }

  return { blocked: false, remaining: MAX_ATTEMPTS - info.count };
}

function recordFailedAttempt(ip) {
  const now  = Date.now();
  const info = loginAttempts.get(ip) || { count: 0, firstAttempt: now };
  if (Date.now() - info.firstAttempt > WINDOW_MS) {
    loginAttempts.set(ip, { count: 1, firstAttempt: now });
  } else {
    info.count++;
    loginAttempts.set(ip, info);
  }
}

function clearAttempts(ip) {
  loginAttempts.delete(ip);
}

// Clean up old entries every 30 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, info] of loginAttempts.entries()) {
    if (now - info.firstAttempt > LOCKOUT_MS) loginAttempts.delete(ip);
  }
}, 30 * 60 * 1000);

// ── helpers ──────────────────────────────────────────────────────────────────
const signToken = (user_id, role) =>
  jwt.sign({ user_id, role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d'
  });

const signRefresh = (user_id) =>
  jwt.sign({ user_id, type: 'refresh' }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d'
  });

// ── REGISTER ──────────────────────────────────────────────────────────────────
const register = async (req, res, next) => {
  const { username, email, password, full_name, role = 'pet_owner', phone } = req.body;

  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Check duplicates
    const exists = await client.query(
      `SELECT user_id FROM users
        WHERE email = $1 OR username = $2 LIMIT 1`,
      [email.toLowerCase(), username.toLowerCase()]
    );
    if (exists.rows.length)
      return R.conflict(res, 'Email or username already taken');

    const hash = await bcrypt.hash(
      password,
      parseInt(process.env.BCRYPT_ROUNDS) || 12
    );

    // Generate email verification token (random hex, expires 24h)
    const verifyToken   = require('crypto').randomBytes(32).toString('hex');
    const verifyExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const { rows } = await client.query(
      `INSERT INTO users
         (username, email, password_hash, full_name, role, phone, status,
          email_verify_token, email_verify_expires)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending_verify', $7, $8)
       RETURNING user_id, user_no, username, email, full_name, role, status, created_at`,
      [username.toLowerCase(), email.toLowerCase(), hash, full_name,
       role, phone || null, verifyToken, verifyExpires]
    );

    await client.query('COMMIT');

    const user    = rows[0];
    const token   = signToken(user.user_id, user.role);
    const refresh = signRefresh(user.user_id);

    // Send verification email (non-fatal — don't block registration if email fails)
    try {
      await sendVerificationEmail(email, username, verifyToken);
    } catch (emailErr) {
      logger.warn('Verification email failed to send', { email, error: emailErr.message });
    }

    logger.info('User registered', { user_id: user.user_id, role: user.role });

    return R.created(res, {
      user, token, refresh,
      message: 'Account created! Please check your email to verify your account.'
    }, 'Account created successfully');
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};

// ── VERIFY EMAIL ──────────────────────────────────────────────────────────────
const verifyEmail = async (req, res, next) => {
  const { token } = req.query;
  if (!token) return R.badRequest(res, 'Verification token required');

  try {
    const { rows } = await query(
      `SELECT user_id, email_verify_expires, status
         FROM users
        WHERE email_verify_token = $1 AND deleted_at IS NULL`,
      [token]
    );

    if (!rows.length)
      return res.status(400).send(htmlPage('Invalid Link', '❌ This verification link is invalid or has already been used.'));

    if (new Date() > new Date(rows[0].email_verify_expires))
      return res.status(400).send(htmlPage('Link Expired', '⏰ This verification link has expired. Please register again or contact support.'));

    await query(
      `UPDATE users
          SET is_verified = true, status = 'active',
              email_verify_token = NULL, email_verify_expires = NULL,
              updated_at = NOW()
        WHERE user_id = $1`,
      [rows[0].user_id]
    );

    // Redirect to login with success
    return res.send(htmlPage('Email Verified!', '✅ Your email has been verified! You can now log in to PawBook.', true));
  } catch (err) {
    next(err);
  }
};

function htmlPage(title, message, success = false) {
  const frontendUrl = process.env.FRONTEND_URL || 'https://pawbook-frontend-cyxo.onrender.com';
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
    <title>${title} — PawBook</title>
    <style>body{font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;
    min-height:100vh;margin:0;background:#f1f5f9}
    .box{background:#fff;border-radius:16px;padding:40px;text-align:center;max-width:400px;
    box-shadow:0 4px 24px rgba(0,0,0,.1)}
    h1{color:#1e293b;font-size:22px} p{color:#64748b;line-height:1.6}
    a{display:inline-block;margin-top:20px;padding:12px 28px;background:#2563eb;
    color:#fff;border-radius:8px;text-decoration:none;font-weight:700}</style></head>
    <body><div class="box">
    <div style="font-size:48px;margin-bottom:16px">${success ? '🐾' : '⚠️'}</div>
    <h1>${title}</h1><p>${message}</p>
    <a href="${frontendUrl}/01_login.html">Go to Login</a>
    </div></body></html>`;
}

// ── RESEND VERIFICATION EMAIL ─────────────────────────────────────────────────
const resendVerification = async (req, res, next) => {
  const { email } = req.body;
  if (!email) return R.badRequest(res, 'Email required');

  try {
    const { rows } = await query(
      `SELECT user_id, username, email, is_verified, email_verify_expires
         FROM users WHERE email = $1 AND deleted_at IS NULL`,
      [email.toLowerCase()]
    );

    // Always return success to avoid email enumeration
    if (!rows.length || rows[0].is_verified)
      return R.ok(res, null, 'If that email exists and is unverified, a new link has been sent.');

    const verifyToken   = require('crypto').randomBytes(32).toString('hex');
    const verifyExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await query(
      `UPDATE users SET email_verify_token=$1, email_verify_expires=$2 WHERE user_id=$3`,
      [verifyToken, verifyExpires, rows[0].user_id]
    );

    await sendVerificationEmail(email, rows[0].username, verifyToken);
    return R.ok(res, null, 'Verification email sent.');
  } catch (err) {
    next(err);
  }
};

// ── LOGIN (with rate limiting) ────────────────────────────────────────────────
const login = async (req, res, next) => {
  const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
  const { email, password } = req.body;

  // Rate limit check
  const rl = getRateLimitInfo(ip);
  if (rl.blocked) {
    return res.status(429).json({
      success: false,
      message: `Too many failed login attempts. Try again in ${Math.ceil(rl.retryAfter / 60)} minutes.`,
      retry_after: rl.retryAfter,
    });
  }

  try {
    const { rows } = await query(
      `SELECT user_id, username, email, full_name, password_hash,
              role, status, is_verified, avatar_url, last_login_at
         FROM users
        WHERE email = $1 AND deleted_at IS NULL`,
      [email.toLowerCase()]
    );

    if (!rows.length) {
      recordFailedAttempt(ip);
      return R.unauthorized(res, 'Invalid email or password');
    }

    const user = rows[0];

    if (user.status === 'suspended')
      return R.forbidden(res, 'Account suspended. Contact support@deemona.com');
    if (user.status === 'deactivated')
      return R.forbidden(res, 'Account deactivated.');

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      recordFailedAttempt(ip);
      const remaining = getRateLimitInfo(ip).remaining;
      return res.status(401).json({
        success: false,
        message: `Invalid email or password. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.`,
      });
    }

    // Success — clear failed attempts
    clearAttempts(ip);

    // Update last_login
    await query(
      `UPDATE users
          SET last_login_at = NOW(), last_login_ip = $2, updated_at = NOW()
        WHERE user_id = $1`,
      [user.user_id, ip]
    );

    // Audit log — non-fatal
    try {
      await query(
        `INSERT INTO activity_log (user_id, activity_type)
         VALUES ($1, 'user.login')`,
        [user.user_id]
      );
    } catch (_) { /* non-fatal */ }

    const { password_hash: _, ...safeUser } = user;
    const token   = signToken(user.user_id, user.role);
    const refresh = signRefresh(user.user_id);

    logger.info('User logged in', { user_id: user.user_id });
    return R.ok(res, { user: safeUser, token, refresh }, 'Login successful');
  } catch (err) {
    next(err);
  }
};

// ── GOOGLE OAUTH ──────────────────────────────────────────────────────────────
const { OAuth2Client } = require('google-auth-library');
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const googleAuth = async (req, res, next) => {
  const { id_token } = req.body;
  if (!id_token) return R.badRequest(res, 'Google ID token required');

  try {
    // Verify the token Google sent from the frontend
    const ticket = await googleClient.verifyIdToken({
      idToken:  id_token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    const { sub: google_id, email, name, picture } = payload;

    if (!email) return R.badRequest(res, 'Could not retrieve email from Google');

    const client = await getClient();
    try {
      await client.query('BEGIN');

      // Check if user already exists (by email or google_id)
      let { rows } = await client.query(
        `SELECT user_id, username, email, full_name, role, status,
                is_verified, avatar_url
           FROM users
          WHERE (email = $1 OR google_id = $2) AND deleted_at IS NULL`,
        [email.toLowerCase(), google_id]
      );

      let user;
      if (rows.length) {
        // Existing user — update google_id and avatar if needed
        user = rows[0];
        await client.query(
          `UPDATE users
              SET google_id = $1, avatar_url = COALESCE(NULLIF(avatar_url,''), $2),
                  is_verified = true, status = CASE WHEN status='pending_verify' THEN 'active' ELSE status END,
                  last_login_at = NOW(), updated_at = NOW()
            WHERE user_id = $3`,
          [google_id, picture, user.user_id]
        );
      } else {
        // New user — auto-register via Google
        const username = await generateUniqueUsername(client, name);
        const result = await client.query(
          `INSERT INTO users
             (username, email, full_name, avatar_url, google_id,
              role, status, is_verified, password_hash)
           VALUES ($1, $2, $3, $4, $5, 'pet_owner', 'active', true, '')
           RETURNING user_id, user_no, username, email, full_name,
                     role, status, is_verified, avatar_url`,
          [username, email.toLowerCase(), name, picture || '', google_id]
        );
        user = result.rows[0];
        logger.info('New user via Google OAuth', { user_id: user.user_id });
      }

      await client.query('COMMIT');

      if (user.status === 'suspended')
        return R.forbidden(res, 'Account suspended. Contact support@deemona.com');

      const token   = signToken(user.user_id, user.role);
      const refresh = signRefresh(user.user_id);

      return R.ok(res, { user, token, refresh }, 'Google login successful');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    if (err.message && err.message.includes('Invalid token'))
      return R.unauthorized(res, 'Invalid Google token');
    next(err);
  }
};

async function generateUniqueUsername(client, fullName) {
  // Create base username from name, append random suffix if taken
  const base = fullName.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 20);
  for (let i = 0; i < 5; i++) {
    const candidate = i === 0 ? base : `${base}_${Math.floor(Math.random() * 9000) + 1000}`;
    const { rows } = await client.query(
      `SELECT 1 FROM users WHERE username = $1`, [candidate]
    );
    if (!rows.length) return candidate;
  }
  return `${base}_${Date.now()}`;
}

// ── REFRESH TOKEN ─────────────────────────────────────────────────────────────
const refresh = async (req, res, next) => {
  const { refresh_token } = req.body;
  if (!refresh_token)
    return R.badRequest(res, 'Refresh token required');
  try {
    const payload = jwt.verify(refresh_token, process.env.JWT_SECRET);
    if (payload.type !== 'refresh')
      return R.unauthorized(res, 'Invalid refresh token');

    const { rows } = await query(
      `SELECT user_id, role, status FROM users
        WHERE user_id = $1 AND deleted_at IS NULL`,
      [payload.user_id]
    );
    if (!rows.length || rows[0].status !== 'active')
      return R.unauthorized(res, 'User not found or inactive');

    const token      = signToken(rows[0].user_id, rows[0].role);
    const newRefresh = signRefresh(rows[0].user_id);
    return R.ok(res, { token, refresh: newRefresh }, 'Token refreshed');
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError')
      return R.unauthorized(res, 'Invalid or expired refresh token');
    next(err);
  }
};

// ── ME (get current user) ─────────────────────────────────────────────────────
const me = async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT u.user_id, u.user_no, u.username, u.email, u.full_name,
              u.role, u.status, u.is_verified, u.avatar_url, u.cover_url,
              u.bio, u.city, u.state, u.country, u.created_at,
              (SELECT COUNT(*) FROM follows f_in
                WHERE f_in.following_id = u.user_no)          AS follower_count,
              (SELECT COUNT(*) FROM follows f_out
                WHERE f_out.follower_id = u.user_no)         AS following_count,
              (SELECT COUNT(*) FROM pets pet
                WHERE pet.user_id = u.user_no)               AS pet_count,
              (SELECT COUNT(*) FROM posts pp
                WHERE pp.user_id = u.user_no)                AS post_count
         FROM users u
        WHERE u.user_id = $1`,
      [req.user.user_id]
    );
    if (!rows.length) return R.notFound(res, 'User not found');
    return R.ok(res, rows[0]);
  } catch (err) {
    next(err);
  }
};

// ── CHANGE PASSWORD ───────────────────────────────────────────────────────────
const changePassword = async (req, res, next) => {
  const { current_password, new_password } = req.body;
  try {
    const { rows } = await query(
      `SELECT password_hash FROM users WHERE user_id = $1`,
      [req.user.user_id]
    );
    // Google-only users have empty password_hash
    if (!rows[0].password_hash)
      return R.badRequest(res, 'This account uses Google login. Set a password via forgot password.');

    const valid = await bcrypt.compare(current_password, rows[0].password_hash);
    if (!valid) return R.badRequest(res, 'Current password incorrect');

    const hash = await bcrypt.hash(
      new_password,
      parseInt(process.env.BCRYPT_ROUNDS) || 12
    );
    await query(
      `UPDATE users SET password_hash = $1, updated_at = NOW()
        WHERE user_id = $2`,
      [hash, req.user.user_id]
    );

    try {
      await query(
        `INSERT INTO activity_log (user_id, activity_type)
         VALUES ($1, 'user.password_changed')`,
        [req.user.user_id]
      );
    } catch (_) { /* non-fatal */ }

    return R.ok(res, null, 'Password changed successfully');
  } catch (err) {
    next(err);
  }
};

module.exports = { register, login, refresh, me, changePassword, verifyEmail, resendVerification, googleAuth };
