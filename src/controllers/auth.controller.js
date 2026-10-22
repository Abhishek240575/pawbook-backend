const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const { query, getClient } = require('../config/db');
const R      = require('../utils/response');
const logger = require('../utils/logger');

// Ã¢â€â‚¬Ã¢â€â‚¬ helpers Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
const signToken = (user_id, role) =>
  jwt.sign({ user_id, role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d'
  });

const signRefresh = (user_id) =>
  jwt.sign({ user_id, type: 'refresh' }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d'
  });

// Ã¢â€â‚¬Ã¢â€â‚¬ REGISTER Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
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

    const { rows } = await client.query(
      `INSERT INTO users
         (username, email, password_hash, full_name, role, phone, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending_verify')
       RETURNING user_id, user_no, username, email, full_name, role, status, created_at`,
      [username.toLowerCase(), email.toLowerCase(), hash, full_name,
       role, phone || null]
    );

    await client.query('COMMIT');

    const user = rows[0];
    const token   = signToken(user.user_id, user.role);
    const refresh = signRefresh(user.user_id);

    logger.info('User registered', { user_id: user.user_id, role: user.role });

    return R.created(res, { user, token, refresh }, 'Account created successfully');
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};

// Ã¢â€â‚¬Ã¢â€â‚¬ LOGIN Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
const login = async (req, res, next) => {
  const { email, password } = req.body;
  try {
    const { rows } = await query(
      `SELECT user_id, username, email, full_name, password_hash,
              role, status, is_verified, avatar_url, last_login_at
         FROM users
        WHERE email = $1 AND deleted_at IS NULL`,
      [email.toLowerCase()]
    );

    if (!rows.length)
      return R.unauthorized(res, 'Invalid email or password');

    const user = rows[0];

    if (user.status === 'suspended')
      return R.forbidden(res, 'Account suspended. Contact support.');
    if (user.status === 'deactivated')
      return R.forbidden(res, 'Account deactivated.');

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid)
      return R.unauthorized(res, 'Invalid email or password');

    // Update last_login
    await query(
      `UPDATE users
          SET last_login_at = NOW(), last_login_ip = $2, updated_at = NOW()
        WHERE user_id = $1`,
      [user.user_id, req.ip]
    );

    // Audit log â€” non-fatal if table doesn't exist
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

// Ã¢â€â‚¬Ã¢â€â‚¬ REFRESH TOKEN Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
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

// Ã¢â€â‚¬Ã¢â€â‚¬ ME (get current user) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
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

// Ã¢â€â‚¬Ã¢â€â‚¬ CHANGE PASSWORD Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
const changePassword = async (req, res, next) => {
  const { current_password, new_password } = req.body;
  try {
    const { rows } = await query(
      `SELECT password_hash FROM users WHERE user_id = $1`,
      [req.user.user_id]
    );
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

module.exports = { register, login, refresh, me, changePassword };


