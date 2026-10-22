// routes/notifications.js — User Notifications
// Real schema: id(int), user_id(uuid), type, title, body, link_url, icon_emoji, is_read, created_at
// No actor_id column in notifications table
const express = require('express');
const router  = express.Router();
const { pool } = require('../db');
const auth    = require('../middleware/auth');

// GET /api/v1/notifications
router.get('/', auth, async (req, res) => {
  const limit  = parseInt(req.query.limit)  || 30;
  const offset = parseInt(req.query.offset) || 0;

  try {
    const [{ rows: notifs }, { rows: unread }] = await Promise.all([
      pool.query(
        `SELECT id, type, title, body, link_url, icon_emoji, is_read, created_at
         FROM notifications
         WHERE user_id=$1
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3`,
        [req.user.id, limit, offset]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS count FROM notifications
         WHERE user_id=$1 AND is_read=FALSE`,
        [req.user.id]
      )
    ]);
    res.json({ notifications: notifs, unread_count: unread[0].count });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load notifications' });
  }
});

// PATCH /api/v1/notifications/:id/read
router.patch('/:id/read', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE notifications SET is_read=TRUE WHERE id=$1 AND user_id=$2 RETURNING id`,
      [req.params.id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Notification not found' });
    res.json({ marked_read: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to mark read' });
  }
});

// PATCH /api/v1/notifications/read-all
router.patch('/read-all', auth, async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      `UPDATE notifications SET is_read=TRUE WHERE user_id=$1 AND is_read=FALSE`,
      [req.user.id]
    );
    res.json({ marked_read: rowCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to mark all read' });
  }
});

// DELETE /api/v1/notifications/:id
router.delete('/:id', auth, async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM notifications WHERE id=$1 AND user_id=$2`,
      [req.params.id, req.user.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Notification not found' });
    res.json({ deleted: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete notification' });
  }
});

module.exports = router;
