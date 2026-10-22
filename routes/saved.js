// routes/saved.js — Saved posts, memories, activity, birthdays, fundraising
const express = require('express');
const router  = express.Router();
const { pool } = require('../db');
const auth    = require('../middleware/auth');

// GET /api/v1/saved — saved posts
// posts.user_id is integer, users.user_no is integer — join via user_no
router.get('/', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.*, u.username AS author_name, u.avatar_url AS author_avatar,
              s.saved_at
       FROM saved_posts s
       JOIN posts p ON p.id = s.post_id
       JOIN users u ON u.user_no = p.user_id
       WHERE s.user_id=$1
       ORDER BY s.saved_at DESC
       LIMIT 50`,
      [req.user.id]
    );
    res.json({ data: rows });
  } catch (err) {
    res.json({ data: [] });
  }
});

// POST /api/v1/saved — save a post
router.post('/', auth, async (req, res) => {
  const { post_id } = req.body;
  if (!post_id) return res.status(400).json({ error: 'post_id required' });
  try {
    await pool.query(
      `INSERT INTO saved_posts (user_id, post_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [req.user.id, post_id]
    );
    res.json({ saved: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save post' });
  }
});

// DELETE /api/v1/saved/:post_id
router.delete('/:post_id', auth, async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM saved_posts WHERE user_id=$1 AND post_id=$2',
      [req.user.id, req.params.post_id]
    );
    res.json({ unsaved: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to unsave post' });
  }
});

// GET /api/v1/memories — posts from this day in past years
router.get('/memories', auth, async (req, res) => {
  try {
    // Get user_no for integer join with posts
    const { rows: [me] } = await pool.query(
      'SELECT user_no FROM users WHERE user_id=$1', [req.user.id]
    );
    if (!me) return res.json({ data: [] });
    const { rows } = await pool.query(
      `SELECT p.*, u.username AS author_name, u.avatar_url AS author_avatar
       FROM posts p
       JOIN users u ON u.user_no = p.user_id
       WHERE p.user_id = $1
         AND EXTRACT(MONTH FROM p.created_at) = EXTRACT(MONTH FROM CURRENT_DATE)
         AND EXTRACT(DAY   FROM p.created_at) = EXTRACT(DAY   FROM CURRENT_DATE)
         AND EXTRACT(YEAR  FROM p.created_at) < EXTRACT(YEAR  FROM CURRENT_DATE)
       ORDER BY p.created_at DESC
       LIMIT 20`,
      [me.user_no]
    );
    res.json({ data: rows });
  } catch (err) {
    res.json({ data: [] });
  }
});

// GET /api/v1/activity — recent notifications as activity feed
// notifications has: id, user_id(uuid), type, title, body, link_url, is_read, created_at
// No actor_id column — return notifications directly
router.get('/activity', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, type, title, body AS message, link_url, is_read, created_at
       FROM notifications
       WHERE user_id=$1
       ORDER BY created_at DESC
       LIMIT 30`,
      [req.user.id]
    );
    res.json({ data: rows });
  } catch (err) {
    res.json({ data: [] });
  }
});

// GET /api/v1/birthdays — pet birthdays among followed users
router.get('/birthdays', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.id, p.name, p.species, p.breed, p.avatar, p.dob,
              u.user_id AS owner_id, u.username AS owner_name, u.avatar_url AS owner_avatar
       FROM "Pet" p
       JOIN users u ON u.user_id = p."userId"
       WHERE p.dob IS NOT NULL
         AND (
           u.user_id = $1
           OR u.user_id IN (
             SELECT following_id FROM follows WHERE follower_id=$1
           )
         )
         AND (
           EXTRACT(MONTH FROM p.dob) = EXTRACT(MONTH FROM CURRENT_DATE)
           AND EXTRACT(DAY FROM p.dob) BETWEEN EXTRACT(DAY FROM CURRENT_DATE)
                                           AND EXTRACT(DAY FROM CURRENT_DATE) + 14
         )
       ORDER BY EXTRACT(MONTH FROM p.dob), EXTRACT(DAY FROM p.dob)
       LIMIT 20`,
      [req.user.id]
    );
    res.json({ data: rows });
  } catch (err) {
    res.json({ data: [] });
  }
});

// GET /api/v1/fundraising
router.get('/fundraising', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT f.*, u.username AS organizer_name, u.avatar_url AS organizer_avatar
       FROM fundraising f
       JOIN users u ON u.user_id = f.user_id
       WHERE f.is_active = TRUE
         AND (f.ends_at IS NULL OR f.ends_at > NOW())
       ORDER BY f.created_at DESC
       LIMIT 20`
    );
    res.json({ data: rows });
  } catch (err) {
    res.json({ data: [] });
  }
});

// GET /api/v1/fundraising/:id
router.get('/fundraising/:id', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT f.*, u.username AS organizer_name, u.avatar_url AS organizer_avatar
       FROM fundraising f
       JOIN users u ON u.user_id = f.user_id
       WHERE f.id=$1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Campaign not found' });
    res.json({ data: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load campaign' });
  }
});

// POST /api/v1/fundraising/:id/donate
router.post('/fundraising/:id/donate', auth, async (req, res) => {
  const { amount } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Valid amount required' });
  try {
    await pool.query(
      `UPDATE fundraising SET raised = raised + $1 WHERE id=$2`,
      [amount, req.params.id]
    );
    await pool.query(
      `INSERT INTO fundraising_donations (campaign_id, user_id, amount) VALUES ($1,$2,$3)`,
      [req.params.id, req.user.id, amount]
    ).catch(() => {});
    res.json({ donated: true, amount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to process donation' });
  }
});

module.exports = router;
