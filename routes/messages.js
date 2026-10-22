// routes/messages.js — Direct Messages & Conversations
// users: user_id(uuid), username, avatar_url
// conversations: user1_id UUID, user2_id UUID
const express = require('express');
const router  = express.Router();
const { pool } = require('../db');
const auth    = require('../middleware/auth');

// GET /api/v1/messages/conversations
router.get('/conversations', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.*,
              CASE WHEN c.user1_id=$1 THEN c.user2_id ELSE c.user1_id END AS other_user_id,
              u.username AS other_name, u.avatar_url AS other_avatar,
              (SELECT body FROM messages
               WHERE conversation_id=c.id ORDER BY created_at DESC LIMIT 1) AS last_message,
              (SELECT created_at FROM messages
               WHERE conversation_id=c.id ORDER BY created_at DESC LIMIT 1) AS last_message_at,
              (SELECT COUNT(*)::int FROM messages
               WHERE conversation_id=c.id AND sender_id!=$1 AND is_read=FALSE) AS unread_count
       FROM conversations c
       JOIN users u ON u.user_id = CASE WHEN c.user1_id=$1 THEN c.user2_id ELSE c.user1_id END
       WHERE c.user1_id=$1 OR c.user2_id=$1
       ORDER BY last_message_at DESC NULLS LAST`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load conversations' });
  }
});

// GET /api/v1/messages/users — users the current user has conversations with
router.get('/users', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT u.user_id AS id, u.username AS name, u.avatar_url AS avatar
       FROM conversations c
       JOIN users u ON u.user_id = CASE WHEN c.user1_id=$1 THEN c.user2_id ELSE c.user1_id END
       WHERE c.user1_id=$1 OR c.user2_id=$1
       ORDER BY u.username`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load users' });
  }
});

// GET /api/v1/messages/search-users?q=
router.get('/search-users', auth, async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json([]);
  try {
    const { rows } = await pool.query(
      `SELECT user_id AS id, username AS name, avatar_url AS avatar
       FROM users
       WHERE username ILIKE $1 AND user_id != $2
       LIMIT 10`,
      [`%${q}%`, req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Search failed' });
  }
});

// POST /api/v1/messages/conversations — start or get conversation
router.post('/conversations', auth, async (req, res) => {
  const { other_user_id } = req.body;
  if (!other_user_id) return res.status(400).json({ error: 'other_user_id required' });
  if (other_user_id === req.user.id) return res.status(400).json({ error: 'Cannot message yourself' });

  // Deterministic ordering so UNIQUE(user1_id, user2_id) always matches
  const [user1, user2] = [req.user.id, other_user_id].sort();

  try {
    const { rows } = await pool.query(
      `INSERT INTO conversations (user1_id, user2_id)
       VALUES ($1,$2)
       ON CONFLICT (user1_id, user2_id) DO UPDATE SET updated_at=NOW()
       RETURNING *`,
      [user1, user2]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to start conversation' });
  }
});

// GET /api/v1/messages/conversations/:id — messages in a conversation
router.get('/conversations/:id', auth, async (req, res) => {
  const limit  = parseInt(req.query.limit) || 50;
  const before = req.query.before || null;

  try {
    const { rows: [conv] } = await pool.query(
      `SELECT id FROM conversations WHERE id=$1 AND (user1_id=$2 OR user2_id=$2)`,
      [req.params.id, req.user.id]
    );
    if (!conv) return res.status(403).json({ error: 'Not your conversation' });

    let query = `
      SELECT m.*, u.username AS sender_name, u.avatar_url AS sender_avatar
      FROM messages m
      JOIN users u ON u.user_id = m.sender_id
      WHERE m.conversation_id=$1
    `;
    const params = [req.params.id];
    if (before) { params.push(before); query += ` AND m.created_at < $${params.length}`; }
    params.push(limit);
    query += ` ORDER BY m.created_at DESC LIMIT $${params.length}`;

    const { rows } = await pool.query(query, params);

    await pool.query(
      `UPDATE messages SET is_read=TRUE
       WHERE conversation_id=$1 AND sender_id!=$2 AND is_read=FALSE`,
      [req.params.id, req.user.id]
    );

    res.json(rows.reverse());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load messages' });
  }
});

// POST /api/v1/messages/conversations/:id — send a message
router.post('/conversations/:id', auth, async (req, res) => {
  const { body, media_url } = req.body;
  if (!body && !media_url) return res.status(400).json({ error: 'body or media_url required' });

  try {
    const { rows: [conv] } = await pool.query(
      `SELECT id FROM conversations WHERE id=$1 AND (user1_id=$2 OR user2_id=$2)`,
      [req.params.id, req.user.id]
    );
    if (!conv) return res.status(403).json({ error: 'Not your conversation' });

    const { rows } = await pool.query(
      `INSERT INTO messages (conversation_id, sender_id, body, media_url)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [req.params.id, req.user.id, body || null, media_url || null]
    );

    await pool.query(
      'UPDATE conversations SET updated_at=NOW() WHERE id=$1',
      [req.params.id]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// DELETE /api/v1/messages/:id
router.delete('/:id', auth, async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM messages WHERE id=$1 AND sender_id=$2',
      [req.params.id, req.user.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Message not found' });
    res.json({ deleted: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete message' });
  }
});

module.exports = router;
