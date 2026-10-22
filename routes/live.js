// routes/live.js — Live streaming sessions
const express = require('express');
const router  = express.Router();
const { pool } = require('../db');
const auth    = require('../middleware/auth');

// GET /api/v1/live — active streams
router.get('/', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT l.*, u.name AS streamer_name, u.avatar AS streamer_avatar
       FROM live_streams l
       JOIN users u ON u.id = l.user_id
       WHERE l.status='live'
       ORDER BY l.viewer_count DESC, l.started_at DESC
       LIMIT 20`
    );
    res.json({ data: rows });
  } catch (err) {
    res.json({ data: [] });
  }
});

// POST /api/v1/live — start a stream
router.post('/', auth, async (req, res) => {
  const { title, thumbnail_url, stream_key } = req.body;
  if (!title) return res.status(400).json({ error: 'title is required' });
  try {
    // End any existing active stream for this user
    await pool.query(
      `UPDATE live_streams SET status='ended', ended_at=NOW()
       WHERE user_id=$1 AND status='live'`,
      [req.user.id]
    ).catch(() => {});

    const { rows } = await pool.query(
      `INSERT INTO live_streams (user_id, title, thumbnail_url, stream_key, status)
       VALUES ($1,$2,$3,$4,'live') RETURNING *`,
      [req.user.id, title, thumbnail_url || null, stream_key || null]
    );
    res.status(201).json({ data: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to start stream' });
  }
});

// GET /api/v1/live/:id — stream detail + recent comments
router.get('/:id', auth, async (req, res) => {
  try {
    const [streamRes, commentsRes] = await Promise.all([
      pool.query(
        `SELECT l.*, u.name AS streamer_name, u.avatar AS streamer_avatar
         FROM live_streams l
         JOIN users u ON u.id = l.user_id
         WHERE l.id=$1`,
        [req.params.id]
      ),
      pool.query(
        `SELECT lc.*, u.name, u.avatar
         FROM live_comments lc
         JOIN users u ON u.id = lc.user_id
         WHERE lc.stream_id=$1
         ORDER BY lc.created_at DESC LIMIT 50`,
        [req.params.id]
      ).catch(() => ({ rows: [] }))
    ]);
    if (!streamRes.rows.length) return res.status(404).json({ error: 'Stream not found' });
    res.json({ data: streamRes.rows[0], comments: commentsRes.rows.reverse() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load stream' });
  }
});

// POST /api/v1/live/:id/comments — send a comment
router.post('/:id/comments', auth, async (req, res) => {
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: 'content is required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO live_comments (stream_id, user_id, content)
       VALUES ($1,$2,$3) RETURNING *`,
      [req.params.id, req.user.id, content]
    );
    res.status(201).json({ data: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to send comment' });
  }
});

// PATCH /api/v1/live/:id/end — end a stream
router.patch('/:id/end', auth, async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      `UPDATE live_streams SET status='ended', ended_at=NOW()
       WHERE id=$1 AND user_id=$2`,
      [req.params.id, req.user.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Stream not found' });
    res.json({ ended: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to end stream' });
  }
});

// POST /api/v1/live/:id/view — increment viewer count
router.post('/:id/view', auth, async (req, res) => {
  try {
    await pool.query(
      'UPDATE live_streams SET viewer_count = viewer_count + 1 WHERE id=$1',
      [req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.json({ ok: true });
  }
});

module.exports = router;
