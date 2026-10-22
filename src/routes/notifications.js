// routes/notifications.js
const express = require('express');
const router  = express.Router();
const { query } = require('../config/db');
const { authenticate } = require('../middleware');

router.get('/', authenticate, async (req, res) => {
  const limit  = parseInt(req.query.limit)  || 30;
  const offset = parseInt(req.query.offset) || 0;
  try {
    const [{ rows: notifs }, { rows: unread }] = await Promise.all([
      query(
        `SELECT n.*, u.username AS actor_name, u.avatar_url AS actor_avatar
         FROM notifications n
         LEFT JOIN users u ON n.sender_id = u.user_id
         WHERE n.recipient_id = $1
         ORDER BY n.created_at DESC
         LIMIT $2 OFFSET $3`,
        [req.user.user_id, limit, offset]
      ),
      query(
        `SELECT COUNT(*)::int AS count FROM notifications WHERE recipient_id=$1 AND is_read=FALSE`,
        [req.user.user_id]
      )
    ]);
    res.json({ notifications: notifs, unread_count: unread[0].count });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load notifications' });
  }
});

router.patch('/:id/read', authenticate, async (req, res) => {
  try {
    const { rows } = await query(
      `UPDATE notifications SET is_read=TRUE, read_at=NOW() WHERE id=$1 AND recipient_id=$2 RETURNING id`,
      [req.params.id, req.user.user_id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Notification not found' });
    res.json({ marked_read: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to mark read' });
  }
});

router.patch('/read-all', authenticate, async (req, res) => {
  try {
    const { rowCount } = await query(
      `UPDATE notifications SET is_read=TRUE, read_at=NOW() WHERE recipient_id=$1 AND is_read=FALSE`,
      [req.user.user_id]
    );
    res.json({ marked_read: rowCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to mark all read' });
  }
});

router.delete('/:id', authenticate, async (req, res) => {
  try {
    const { rowCount } = await query(
      `DELETE FROM notifications WHERE id=$1 AND recipient_id=$2`,
      [req.params.id, req.user.user_id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Notification not found' });
    res.json({ deleted: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete notification' });
  }
});

module.exports = router;
