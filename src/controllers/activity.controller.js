const pool = require('../config/db');
const R = require('../utils/response');

// GET /api/v1/activity — get current user's activity log
async function getActivity(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM activity_log
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [req.user.user_id]
    );
    return R.ok(res, rows);
  } catch (err) { return R.serverError(res, err.message); }
}

// POST /api/v1/activity — log an activity (called internally from other controllers)
// Also exposed as an endpoint so frontend can log custom events
async function logActivity(req, res) {
  try {
    const { action_type, target_id, target_type, target_label } = req.body;
    if (!action_type) return R.badRequest(res, 'action_type is required');
    const { rows } = await pool.query(
      `INSERT INTO activity_log (user_id, action_type, target_id, target_type, target_label)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.user.user_id, action_type, target_id || null, target_type || null, target_label || null]
    );
    return R.created(res, rows[0], 'Activity logged');
  } catch (err) { return R.serverError(res, err.message); }
}

// Helper — called from other controllers to log activities without HTTP overhead
async function log(userId, action_type, target_id, target_type, target_label) {
  try {
    await pool.query(
      `INSERT INTO activity_log (user_id, action_type, target_id, target_type, target_label)
       VALUES ($1,$2,$3,$4,$5)`,
      [userId, action_type, target_id || null, target_type || null, target_label || null]
    );
  } catch (_) { /* non-critical — don't crash parent request */ }
}

module.exports = { getActivity, logActivity, log };
