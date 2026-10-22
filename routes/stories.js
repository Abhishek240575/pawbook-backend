// routes/stories.js — Pet Stories (24-hour ephemeral posts)
const express = require('express');
const router  = express.Router();
const { pool } = require('../db');
const auth    = require('../middleware/auth');

// GET /api/v1/stories — stories from users the current user follows (+ own)
router.get('/', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT s.*, u.username AS author_name, u.avatar_url AS author_avatar
       FROM stories s
       JOIN users u ON u.user_id = s.user_id
       WHERE s.expires_at > NOW()
         AND (s.user_id = $1
              OR s.user_id IN (
                SELECT following_id FROM follows WHERE follower_id=$1
              ))
       ORDER BY s.created_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load stories' });
  }
});

// GET /api/v1/stories/mine — current user's own stories
router.get('/mine', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM stories WHERE user_id=$1 ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load your stories' });
  }
});

// GET /api/v1/stories/user/:userId — stories by a specific user
router.get('/user/:userId', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT s.*, u.username AS author_name, u.avatar_url AS author_avatar
       FROM stories s
       JOIN users u ON u.user_id = s.user_id
       WHERE s.user_id=$1 AND s.expires_at > NOW()
       ORDER BY s.created_at DESC`,
      [req.params.userId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load stories' });
  }
});

// POST /api/v1/stories — create a story (expires in 24h)
router.post('/', auth, async (req, res) => {
  const { media_url, media_type, caption, pet_id } = req.body;
  if (!media_url) return res.status(400).json({ error: 'media_url is required' });

  try {
    const { rows } = await pool.query(
      `INSERT INTO stories (user_id, media_url, media_type, caption, pet_id, expires_at)
       VALUES ($1,$2,$3,$4,$5, NOW() + INTERVAL '24 hours')
       RETURNING *`,
      [req.user.id, media_url, media_type || 'image', caption || null, pet_id || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create story' });
  }
});

// DELETE /api/v1/stories/:id — delete own story
router.delete('/:id', auth, async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM stories WHERE id=$1 AND user_id=$2',
      [req.params.id, req.user.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Story not found' });
    res.json({ deleted: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete story' });
  }
});

module.exports = router;
