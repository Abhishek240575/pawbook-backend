const crypto  = require('crypto');
const bcrypt   = require('bcryptjs');
const { query } = require('../config/db');
const R        = require('../utils/response');
const logger   = require('../utils/logger');

// ── OTP store (in-memory, survives restarts via DB) ───────────────────────────
// We store OTPs in the DB so they survive Render restarts.

async function sendOtpEmail(email, username, otp) {
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto">
      <div style="background:#2563eb;padding:24px;border-radius:12px 12px 0 0;text-align:center">
        <h1 style="color:#fff;margin:0;font-size:24px">🐾 PawBook</h1>
      </div>
      <div style="background:#fff;padding:32px;border:1px solid #e2e8f0;border-radius:0 0 12px 12px">
        <h2 style="color:#1e293b;margin:0 0 12px">Password Reset OTP</h2>
        <p style="color:#64748b;line-height:1.6">Hi <strong>${username}</strong>,<br>
        Use this 6-digit code to reset your PawBook password:</p>
        <div style="background:#f1f5f9;border-radius:12px;padding:24px;text-align:center;
          margin:24px 0;font-size:40px;font-weight:800;letter-spacing:12px;color:#1e293b">
          ${otp}
        </div>
        <p style="color:#94a3b8;font-size:13px">
          This code expires in <strong>10 minutes</strong>.<br>
          If you didn't request this, you can safely ignore this email.
        </p>
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
      from:    process.env.SMTP_FROM_EMAIL || 'PawBook <onboarding@resend.dev>',
      to:      [email],
      subject: 'Your PawBook password reset OTP',
      html,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Resend API error ${res.status}: ${err}`);
  }
}

// ── FORGOT PASSWORD ───────────────────────────────────────────────────────────
// POST /api/v1/auth/forgot-password
// Body: { email }
const forgotPassword = async (req, res, next) => {
  const { email } = req.body;
  if (!email) return R.badRequest(res, 'Email required');

  try {
    const { rows } = await query(
      `SELECT user_id, username, email, status FROM users
        WHERE email = $1 AND deleted_at IS NULL`,
      [email.toLowerCase()]
    );

    // Always return success to prevent email enumeration
    if (!rows.length || rows[0].status === 'suspended') {
      return R.ok(res, null, 'If that email is registered, an OTP has been sent.');
    }

    const user = rows[0];

    // Generate 6-digit OTP
    const otp     = String(Math.floor(100000 + Math.random() * 900000));
    const expires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Store hashed OTP in DB
    const otpHash = await bcrypt.hash(otp, 8);
    await query(
      `UPDATE users
          SET reset_otp_hash = $1, reset_otp_expires = $2, updated_at = NOW()
        WHERE user_id = $3`,
      [otpHash, expires, user.user_id]
    );

    // Send OTP email (non-fatal)
    try {
      await sendOtpEmail(email, user.username, otp);
      logger.info('Password reset OTP sent', { user_id: user.user_id });
    } catch (emailErr) {
      logger.warn('OTP email failed', { email, error: emailErr.message });
    }

    return R.ok(res, null, 'If that email is registered, an OTP has been sent.');
  } catch (err) {
    next(err);
  }
};

// ── VERIFY OTP ────────────────────────────────────────────────────────────────
// POST /api/v1/auth/verify-otp
// Body: { email, otp }
// Returns: { reset_token }
const verifyOtp = async (req, res, next) => {
  const { email, otp } = req.body;
  if (!email || !otp) return R.badRequest(res, 'Email and OTP required');

  try {
    const { rows } = await query(
      `SELECT user_id, reset_otp_hash, reset_otp_expires
         FROM users
        WHERE email = $1 AND deleted_at IS NULL`,
      [email.toLowerCase()]
    );

    if (!rows.length || !rows[0].reset_otp_hash) {
      return R.badRequest(res, 'Invalid or expired OTP');
    }

    const user = rows[0];

    // Check expiry
    if (new Date() > new Date(user.reset_otp_expires)) {
      return R.badRequest(res, 'OTP has expired. Please request a new one.');
    }

    // Check OTP
    const valid = await bcrypt.compare(String(otp), user.reset_otp_hash);
    if (!valid) {
      return R.badRequest(res, 'Invalid OTP. Please check and try again.');
    }

    // Generate a short-lived reset token (15 min)
    const resetToken        = crypto.randomBytes(32).toString('hex');
    const resetTokenExpires = new Date(Date.now() + 15 * 60 * 1000);

    await query(
      `UPDATE users
          SET reset_otp_hash = NULL, reset_otp_expires = NULL,
              reset_token = $1, reset_token_expires = $2,
              updated_at = NOW()
        WHERE user_id = $3`,
      [resetToken, resetTokenExpires, user.user_id]
    );

    return R.ok(res, { reset_token: resetToken }, 'OTP verified');
  } catch (err) {
    next(err);
  }
};

// ── RESET PASSWORD ────────────────────────────────────────────────────────────
// POST /api/v1/auth/reset-password
// Body: { reset_token, new_password }
const resetPassword = async (req, res, next) => {
  const { reset_token, new_password } = req.body;
  if (!reset_token || !new_password) {
    return R.badRequest(res, 'Reset token and new password required');
  }
  if (new_password.length < 8) {
    return R.badRequest(res, 'Password must be at least 8 characters');
  }

  try {
    const { rows } = await query(
      `SELECT user_id, reset_token_expires
         FROM users
        WHERE reset_token = $1 AND deleted_at IS NULL`,
      [reset_token]
    );

    if (!rows.length) {
      return R.badRequest(res, 'Invalid or expired reset token');
    }

    const user = rows[0];

    if (new Date() > new Date(user.reset_token_expires)) {
      return R.badRequest(res, 'Reset token has expired. Please start over.');
    }

    const hash = await bcrypt.hash(new_password, parseInt(process.env.BCRYPT_ROUNDS) || 12);

    await query(
      `UPDATE users
          SET password_hash = $1,
              reset_token = NULL, reset_token_expires = NULL,
              is_verified = true,
              status = CASE WHEN status = 'pending_verify' THEN 'active' ELSE status END,
              updated_at = NOW()
        WHERE user_id = $2`,
      [hash, user.user_id]
    );

    // Log activity
    try {
      await query(
        `INSERT INTO activity_log (user_id, activity_type)
         VALUES ($1, 'user.password_reset')`,
        [user.user_id]
      );
    } catch (_) { /* non-fatal */ }

    logger.info('Password reset successful', { user_id: user.user_id });
    return R.ok(res, null, 'Password reset successfully. You can now log in.');
  } catch (err) {
    next(err);
  }
};

module.exports = { forgotPassword, verifyOtp, resetPassword };
