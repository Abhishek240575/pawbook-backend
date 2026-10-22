// routes/analytics.js — User Analytics Dashboard
const express = require('express');
const router  = express.Router();
const { pool } = require('../db');
const auth    = require('../middleware/auth');

// GET /api/v1/analytics/me — personal stats for the logged-in user
router.get('/me', auth, async (req, res) => {
  const userId = req.user.id;
  try {
    const [posts, pets, followers, following, likes, comments, appts] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS count FROM posts WHERE user_id=$1`, [userId]),
      pool.query(`SELECT COUNT(*)::int AS count FROM pets  WHERE user_id=$1`, [userId]),
      pool.query(`SELECT COUNT(*)::int AS count FROM follows WHERE following_id=$1`, [userId]),
      pool.query(`SELECT COUNT(*)::int AS count FROM follows WHERE follower_id=$1`,  [userId]),
      pool.query(
        `SELECT COALESCE(SUM(likes_count),0)::int AS total FROM posts WHERE user_id=$1`,
        [userId]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS count FROM comments c
         JOIN posts p ON c.post_id = p.id
         WHERE p.user_id=$1`,
        [userId]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS count FROM appointments WHERE user_id=$1`,
        [userId]
      ),
    ]);

    // Posts over last 30 days (daily breakdown)
    const { rows: trend } = await pool.query(
      `SELECT DATE(created_at) AS day, COUNT(*)::int AS posts
       FROM posts
       WHERE user_id=$1 AND created_at >= NOW() - INTERVAL '30 days'
       GROUP BY day ORDER BY day`,
      [userId]
    );

    res.json({
      posts:               posts.rows[0].count,
      pets:                pets.rows[0].count,
      followers:           followers.rows[0].count,
      following:           following.rows[0].count,
      total_likes:         likes.rows[0].total,
      comments_received:   comments.rows[0].count,
      appointments:        appts.rows[0].count,
      post_trend:          trend,   // [{day, posts}]
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load analytics' });
  }
});

module.exports = router;
