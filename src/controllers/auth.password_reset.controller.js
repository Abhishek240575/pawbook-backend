// controllers/auth.passwordReset.controller.js
// Handles: forgot-password, verify-otp, reset-password
// Email provider: Resend  (https://resend.com)

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { Resend } = require('resend');
const { query } = require('../config/db');           // your existing pg pool

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_EMAIL = 'onboarding@resend.dev';
const OTP_EXPIRY_MINUTES = 15;

// ── helpers ──────────────────────────────────────────────────────
function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// ── POST /auth/forgot-password ───────────────────────────────────
async function forgotPassword(req, res) {
  const { email } = req.body;

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ success: false, message: 'Valid email is required.' });
  }

  try {
    // Check if user exists — but always return success to prevent email enumeration
    const userResult = await query(
      'SELECT user_id FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (userResult.rows.length === 0) {
      // Return success anyway — security best practice
      return res.json({ success: true, message: 'If that email is registered, an OTP has been sent.' });
    }

    const userId = userResult.rows[0].user_id;

    // Invalidate any existing unused OTPs for this email
    await query(
      'UPDATE password_reset_otps SET used = TRUE WHERE email = $1 AND used = FALSE',
      [email.toLowerCase()]
    );

    const otp = generateOtp();
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

    await query(
      `INSERT INTO password_reset_otps (user_id, email, otp, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [userId, email.toLowerCase(), otp, expiresAt]
  // userId is UUID — matches users.user_id type
    );

    // Send email via Resend
    await resend.emails.send({
      from: `PawBook <${FROM_EMAIL}>`,
      to: email,
      subject: 'Your PawBook password reset OTP',
      html: `
        <!DOCTYPE html>
        <html>
        <head><meta charset="UTF-8"></head>
        <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f5f5;margin:0;padding:20px;">
          <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
            <!-- Header -->
            <div style="background:linear-gradient(135deg,#1877F2,#a259ff);padding:32px 24px;text-align:center;">
              <div style="font-size:40px;margin-bottom:8px;">🐾</div>
              <h1 style="color:#fff;margin:0;font-size:22px;font-weight:700;">PawBook</h1>
              <p style="color:rgba(255,255,255,0.85);margin:6px 0 0;font-size:14px;">Password Reset</p>
            </div>
            <!-- Body -->
            <div style="padding:32px 28px;">
              <p style="color:#333;font-size:15px;margin-bottom:8px;">Hi there 👋</p>
              <p style="color:#555;font-size:14px;line-height:1.6;margin-bottom:28px;">
                We received a request to reset your PawBook password. Use the OTP below to continue.
                This code expires in <strong>${OTP_EXPIRY_MINUTES} minutes</strong>.
              </p>
              <!-- OTP box -->
              <div style="background:#f0f4ff;border:1.5px dashed #1877F2;border-radius:12px;padding:20px;text-align:center;margin-bottom:28px;">
                <div style="font-size:38px;font-weight:800;letter-spacing:10px;color:#1877F2;">${otp}</div>
                <div style="font-size:12px;color:#888;margin-top:6px;">One-time password — do not share</div>
              </div>
              <p style="color:#888;font-size:13px;line-height:1.6;">
                If you didn't request this, you can safely ignore this email. Your password won't change.
              </p>
            </div>
            <!-- Footer -->
            <div style="background:#fafafa;padding:16px 28px;text-align:center;border-top:1px solid #f0f0f0;">
              <p style="color:#bbb;font-size:12px;margin:0;">© ${new Date().getFullYear()} PawBook by Deemona Technologies · India 🇮🇳</p>
            </div>
          </div>
        </body>
        </html>
      `,
    });

    return res.json({ success: true, message: 'If that email is registered, an OTP has been sent.' });

  } catch (err) {
    console.error('[forgot-password]', err);
    return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
}

// ── POST /auth/verify-otp ────────────────────────────────────────
async function verifyOtp(req, res) {
  const { email, otp } = req.body;

  if (!email || !otp) {
    return res.status(400).json({ success: false, message: 'Email and OTP are required.' });
  }

  try {
    const result = await query(
      `SELECT id FROM password_reset_otps
       WHERE email = $1 AND otp = $2 AND used = FALSE AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [email.toLowerCase(), otp.trim()]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ success: false, message: 'Invalid or expired OTP. Please try again.' });
    }

    const rowId = result.rows[0].id;
    const resetToken = generateToken();

    // Store reset token and mark OTP as used
    await query(
      `UPDATE password_reset_otps
       SET reset_token = $1, used = TRUE
       WHERE id = $2`,
      [resetToken, rowId]
    );

    // Give token a 10-minute window for password reset
    await query(
      `UPDATE password_reset_otps
       SET expires_at = NOW() + INTERVAL '10 minutes'
       WHERE id = $1`,
      [rowId]
    );

    return res.json({ success: true, reset_token: resetToken });

  } catch (err) {
    console.error('[verify-otp]', err);
    return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
}

// ── POST /auth/reset-password ────────────────────────────────────
async function resetPassword(req, res) {
  const { reset_token, new_password } = req.body;

  if (!reset_token || !new_password) {
    return res.status(400).json({ success: false, message: 'Reset token and new password are required.' });
  }

  if (new_password.length < 8) {
    return res.status(400).json({ success: false, message: 'Password must be at least 8 characters.' });
  }

  try {
    const result = await query(
      `SELECT user_id FROM password_reset_otps
       WHERE reset_token = $1 AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [reset_token]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ success: false, message: 'Invalid or expired reset token. Please start over.' });
    }

    const userId = result.rows[0].user_id;
    const hashedPassword = await bcrypt.hash(new_password, 12);

    // Update password
    await query(
      'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE user_id = $2',
      [hashedPassword, userId]
    );

    // Invalidate the token
    await query(
      'UPDATE password_reset_otps SET expires_at = NOW() WHERE reset_token = $1',
      [reset_token]
    );

    return res.json({ success: true, message: 'Password reset successfully.' });

  } catch (err) {
    console.error('[reset-password]', err);
    return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
}

module.exports = { forgotPassword, verifyOtp, resetPassword };
