// src/controllers/message.controller.js
const { query } = require('../config/db');
const R = require('../utils/response');

// ── GET /conversations  — list my conversations ───────────────────────────
exports.getConversations = async (req, res, next) => {
  try {
    const me = req.user.user_id;
    const { rows } = await query(
      `SELECT
         c.conversation_id,
         c.last_message,
         c.last_message_at,
         c.created_at,
         -- the OTHER person
         CASE WHEN c.user1_id = $1 THEN c.user2_id ELSE c.user1_id END AS other_user_id,
         CASE WHEN c.user1_id = $1 THEN u2.full_name ELSE u1.full_name END AS other_name,
         CASE WHEN c.user1_id = $1 THEN u2.username ELSE u1.username END AS other_username,
         CASE WHEN c.user1_id = $1 THEN u2.avatar_url ELSE u1.avatar_url END AS other_avatar,
         -- unread count (messages sent by other person that I haven't read)
         (SELECT COUNT(*) FROM messages m
           WHERE m.conversation_id = c.conversation_id
             AND m.sender_id != $1
             AND m.is_read = FALSE) AS unread_count
       FROM conversations c
       JOIN users u1 ON u1.user_id = c.user1_id
       JOIN users u2 ON u2.user_id = c.user2_id
      WHERE c.user1_id = $1 OR c.user2_id = $1
      ORDER BY c.last_message_at DESC NULLS LAST, c.created_at DESC`,
      [me]
    );
    return R.success(res, rows);
  } catch (err) { next(err); }
};

// ── POST /conversations  — start or get existing conversation ─────────────
exports.startConversation = async (req, res, next) => {
  try {
    const me = req.user.user_id;
    const { other_user_id } = req.body;

    if (other_user_id === me) {
      return R.error(res, 400, 'Cannot message yourself');
    }

    // Enforce canonical order (smaller UUID first) to satisfy UNIQUE constraint
    const [u1, u2] = [me, other_user_id].sort();

    const { rows } = await query(
      `INSERT INTO conversations (user1_id, user2_id)
       VALUES ($1, $2)
       ON CONFLICT (user1_id, user2_id) DO UPDATE SET user1_id = EXCLUDED.user1_id
       RETURNING *`,
      [u1, u2]
    );

    // Fetch enriched version
    const { rows: enriched } = await query(
      `SELECT
         c.conversation_id,
         c.last_message,
         c.last_message_at,
         c.created_at,
         CASE WHEN c.user1_id = $2 THEN c.user2_id ELSE c.user1_id END AS other_user_id,
         CASE WHEN c.user1_id = $2 THEN u2.full_name ELSE u1.full_name END AS other_name,
         CASE WHEN c.user1_id = $2 THEN u2.username ELSE u1.username END AS other_username,
         CASE WHEN c.user1_id = $2 THEN u2.avatar_url ELSE u1.avatar_url END AS other_avatar
       FROM conversations c
       JOIN users u1 ON u1.user_id = c.user1_id
       JOIN users u2 ON u2.user_id = c.user2_id
      WHERE c.conversation_id = $1`,
      [rows[0].conversation_id, me]
    );

    return R.success(res, enriched[0], 201);
  } catch (err) { next(err); }
};

// ── GET /conversations/:id/messages ──────────────────────────────────────
exports.getMessages = async (req, res, next) => {
  try {
    const me = req.user.user_id;
    const { id } = req.params;
    const { page = 1, limit = 40 } = req.query;
    const offset = (page - 1) * limit;

    // Verify participant
    const { rows: conv } = await query(
      `SELECT * FROM conversations WHERE conversation_id = $1 AND (user1_id=$2 OR user2_id=$2)`,
      [id, me]
    );
    if (!conv.length) return R.error(res, 404, 'Conversation not found');

    const { rows } = await query(
      `SELECT m.message_id, m.content, m.sender_id, m.is_read, m.created_at,
              u.full_name AS sender_name, u.username AS sender_username, u.avatar_url AS sender_avatar
         FROM messages m
         JOIN users u ON u.user_id = m.sender_id
        WHERE m.conversation_id = $1
        ORDER BY m.created_at ASC
        LIMIT $2 OFFSET $3`,
      [id, limit, offset]
    );

    // Mark messages from other person as read
    await query(
      `UPDATE messages SET is_read = TRUE
        WHERE conversation_id = $1 AND sender_id != $2 AND is_read = FALSE`,
      [id, me]
    );

    return R.success(res, rows);
  } catch (err) { next(err); }
};

// ── POST /conversations/:id/messages ─────────────────────────────────────
exports.sendMessage = async (req, res, next) => {
  try {
    const me = req.user.user_id;
    const { id } = req.params;
    const { content } = req.body;

    if (!content?.trim()) return R.error(res, 400, 'Message content required');

    // Verify participant
    const { rows: conv } = await query(
      `SELECT * FROM conversations WHERE conversation_id = $1 AND (user1_id=$2 OR user2_id=$2)`,
      [id, me]
    );
    if (!conv.length) return R.error(res, 404, 'Conversation not found');

    const { rows } = await query(
      `INSERT INTO messages (conversation_id, sender_id, content)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [id, me, content.trim()]
    );

    // Fetch enriched message
    const { rows: enriched } = await query(
      `SELECT m.message_id, m.content, m.sender_id, m.is_read, m.created_at,
              u.full_name AS sender_name, u.username AS sender_username, u.avatar_url AS sender_avatar
         FROM messages m
         JOIN users u ON u.user_id = m.sender_id
        WHERE m.message_id = $1`,
      [rows[0].message_id]
    );

    return R.success(res, enriched[0], 201);
  } catch (err) { next(err); }
};

// ── PATCH /conversations/:id/read ────────────────────────────────────────
exports.markRead = async (req, res, next) => {
  try {
    const me = req.user.user_id;
    const { id } = req.params;
    await query(
      `UPDATE messages SET is_read = TRUE
        WHERE conversation_id = $1 AND sender_id != $2 AND is_read = FALSE`,
      [id, me]
    );
    return R.success(res, { marked: true });
  } catch (err) { next(err); }
};

// ── GET /messages/search-users  — find users to message ──────────────────
exports.searchUsers = async (req, res, next) => {
  try {
    const me = req.user.user_id;
    const { q } = req.query;
    if (!q?.trim()) return R.success(res, []);

    const { rows } = await query(
      `SELECT user_id, full_name, username, avatar_url
         FROM users
        WHERE user_id != $1
          AND (full_name ILIKE $2 OR username ILIKE $2)
          AND deleted_at IS NULL
        LIMIT 10`,
      [me, `%${q.trim()}%`]
    );
    return R.success(res, rows);
  } catch (err) { next(err); }
};
