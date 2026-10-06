// routes/notifications.js — User Notifications
const express = require('express');
const router  = express.Router();
const { pool } = require('../db');
const auth    = require('../middleware/auth');

// GET /api/notifications — get notifications for current user
router.get('/', auth, async (req, res) => {
  const limit  = parseInt(req.query.limit)  || 30;
  const offset = parseInt(req.query.offset) || 0;

  try {
    const [{ rows: notifs }, { rows: unread }] = await Promise.all([
      pool.query(
        `SELECT n.*, u.name AS actor_name, u.avatar AS actor_avatar
         FROM notifications n
         LEFT JOIN users u ON n.actor_id = u.id
         WHERE n.user_id=$1
         ORDER BY n.created_at DESC
         LIMIT $2 OFFSET $3`,
        [req.user.id, limit, offset]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS count
         FROM notifications
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

// PATCH /api/notifications/:id/read — mark single notification read
router.patch('/:id/read', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE notifications SET is_read=TRUE
       WHERE id=$1 AND user_id=$2
       RETURNING id`,
      [req.params.id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Notification not found' });
    res.json({ marked_read: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to mark read' });
  }
});

// PATCH /api/notifications/read-all — mark all notifications read
router.patch('/read-all', auth, async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      `UPDATE notifications SET is_read=TRUE
       WHERE user_id=$1 AND is_read=FALSE`,
      [req.user.id]
    );
    res.json({ marked_read: rowCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to mark all read' });
  }
});

// DELETE /api/notifications/:id — delete a notification
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

// Internal helper (used by other routes): create a notification
// Usage: require('./notifications').create(pool, { user_id, type, title, body, actor_id, ref_type, ref_id })
async function createNotification(pool, data) {
  const { user_id, type, title, body, actor_id, ref_type, ref_id } = data;
  try {
    await pool.query(
      `INSERT INTO notifications (user_id, type, title, body, actor_id, ref_type, ref_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [user_id, type, title || null, body || null,
       actor_id || null, ref_type || null, ref_id || null]
    );
  } catch (err) {
    console.error('Notification insert failed:', err.message);
  }
}

module.exports = router;
module.exports.createNotification = createNotification;
