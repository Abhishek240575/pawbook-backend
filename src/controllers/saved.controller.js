const pool = require('../config/db');
const R = require('../utils/response');

// GET /api/v1/saved — get all saved post IDs for current user
async function getSaved(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT sp.post_id, p.content, p.image_url, p.created_at,
              u.full_name as author_name, u.avatar_url as author_avatar
       FROM saved_posts sp
       JOIN posts p ON sp.post_id = p.post_id
       JOIN users u ON p.user_id = u.user_id
       WHERE sp.user_id = $1
       ORDER BY sp.saved_at DESC`,
      [req.user.user_id]
    );
    return R.ok(res, rows);
  } catch (err) { return R.serverError(res, err.message); }
}

// POST /api/v1/saved/:postId — save a post
async function savePost(req, res) {
  try {
    const { postId } = req.params;
    await pool.query(
      `INSERT INTO saved_posts (user_id, post_id) VALUES ($1, $2)
       ON CONFLICT (user_id, post_id) DO NOTHING`,
      [req.user.user_id, postId]
    );
    return R.ok(res, null, 'Post saved');
  } catch (err) { return R.serverError(res, err.message); }
}

// DELETE /api/v1/saved/:postId — unsave a post
async function unsavePost(req, res) {
  try {
    const { postId } = req.params;
    await pool.query(
      `DELETE FROM saved_posts WHERE user_id = $1 AND post_id = $2`,
      [req.user.user_id, postId]
    );
    return R.ok(res, null, 'Post removed from saved');
  } catch (err) { return R.serverError(res, err.message); }
}

module.exports = { getSaved, savePost, unsavePost };
