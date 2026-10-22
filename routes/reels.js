// routes/reels.js — Short video reels
const express = require('express');
const router  = express.Router();
const { pool } = require('../db');
const auth    = require('../middleware/auth');

// GET /api/v1/reels — feed of reels
router.get('/', auth, async (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit) || 20, 50);
  const offset = parseInt(req.query.offset) || 0;
  try {
    const { rows } = await pool.query(
      `SELECT r.id, r.video_url, r.thumbnail_url, r.caption, r.duration,
              r.view_count, r.like_count, r.comment_count, r.created_at,
              u.user_id AS author_id, u.username AS author_name, u.avatar_url AS author_avatar,
              p.id AS pet_id, p.name AS pet_name
       FROM reels r
       JOIN users u ON u.user_id = r.user_id
       LEFT JOIN "Pet" p ON p.id = r.pet_id
       WHERE r.is_active = TRUE
       ORDER BY r.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    res.json({ data: rows });
  } catch (err) {
    // Table may not exist — return empty gracefully
    res.json({ data: [] });
  }
});

// POST /api/v1/reels — upload a reel
router.post('/', auth, async (req, res) => {
  const { video_url, thumbnail_url, caption, duration, pet_id } = req.body;
  if (!video_url) return res.status(400).json({ error: 'video_url is required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO reels (user_id, video_url, thumbnail_url, caption, duration, pet_id)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.user.id, video_url, thumbnail_url || null,
       caption || null, duration || null, pet_id || null]
    );
    res.status(201).json({ data: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to upload reel' });
  }
});

// POST /api/v1/reels/:id/like
router.post('/:id/like', auth, async (req, res) => {
  try {
    await pool.query(
      `UPDATE reels SET like_count = like_count + 1 WHERE id=$1`,
      [req.params.id]
    );
    res.json({ liked: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to like reel' });
  }
});

// POST /api/v1/reels/:id/view
router.post('/:id/view', auth, async (req, res) => {
  try {
    await pool.query(
      'UPDATE reels SET view_count = view_count + 1 WHERE id=$1',
      [req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.json({ ok: true }); // non-critical
  }
});

// DELETE /api/v1/reels/:id
router.delete('/:id', auth, async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM reels WHERE id=$1 AND user_id=$2',
      [req.params.id, req.user.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Reel not found' });
    res.json({ deleted: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete reel' });
  }
});

module.exports = router;
