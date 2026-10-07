// src/controllers/message.controller.js  (full replacement)
const { query } = require('../config/db');
const R = require('../utils/response');

// ══════════════════════════════════════════════════════════
// USERS DIRECTORY
// ══════════════════════════════════════════════════════════

// GET /messages/users — all active users (paginated)
exports.getAllUsers = async (req, res, next) => {
  try {
    const me = req.user.user_id;
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 20);
    const offset = (page - 1) * limit;
    const q = req.query.q?.trim() || '';

    const where = q
      ? `AND (full_name ILIKE $3 OR username ILIKE $3)`
      : '';
    const params = q ? [me, limit, `%${q}%`] : [me, limit];

    const { rows } = await query(
      `SELECT user_id, full_name, username, avatar_url,
              role, last_active_at,
              (last_active_at > NOW() - INTERVAL '10 minutes') AS is_online
         FROM users
        WHERE user_id != $1
          AND deleted_at IS NULL
          ${where}
        ORDER BY is_online DESC NULLS LAST, full_name ASC
        LIMIT $2 OFFSET ${offset}`,
      params
    );
    return R.success(res, rows);
  } catch (err) { next(err); }
};

// ══════════════════════════════════════════════════════════
// 1-to-1 CONVERSATIONS
// ══════════════════════════════════════════════════════════

exports.getConversations = async (req, res, next) => {
  try {
    const me = req.user.user_id;
    const { rows } = await query(
      `SELECT
         c.conversation_id,
         c.last_message,
         c.last_message_at,
         c.created_at,
         CASE WHEN c.user1_id = $1 THEN c.user2_id ELSE c.user1_id END AS other_user_id,
         CASE WHEN c.user1_id = $1 THEN u2.full_name  ELSE u1.full_name  END AS other_name,
         CASE WHEN c.user1_id = $1 THEN u2.username   ELSE u1.username   END AS other_username,
         CASE WHEN c.user1_id = $1 THEN u2.avatar_url ELSE u1.avatar_url END AS other_avatar,
         (SELECT COUNT(*) FROM messages m
           WHERE m.conversation_id = c.conversation_id
             AND m.sender_id != $1
             AND m.is_read = FALSE
             AND m.is_deleted = FALSE) AS unread_count
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

exports.startConversation = async (req, res, next) => {
  try {
    const me = req.user.user_id;
    const { other_user_id } = req.body;
    if (other_user_id === me) return R.error(res, 400, 'Cannot message yourself');
    const [u1, u2] = [me, other_user_id].sort();
    const { rows } = await query(
      `INSERT INTO conversations (user1_id, user2_id)
       VALUES ($1, $2)
       ON CONFLICT (user1_id, user2_id) DO UPDATE SET user1_id = EXCLUDED.user1_id
       RETURNING *`,
      [u1, u2]
    );
    const { rows: enriched } = await query(
      `SELECT c.conversation_id, c.last_message, c.last_message_at, c.created_at,
              CASE WHEN c.user1_id=$2 THEN c.user2_id   ELSE c.user1_id   END AS other_user_id,
              CASE WHEN c.user1_id=$2 THEN u2.full_name  ELSE u1.full_name  END AS other_name,
              CASE WHEN c.user1_id=$2 THEN u2.username   ELSE u1.username   END AS other_username,
              CASE WHEN c.user1_id=$2 THEN u2.avatar_url ELSE u1.avatar_url END AS other_avatar
         FROM conversations c
         JOIN users u1 ON u1.user_id = c.user1_id
         JOIN users u2 ON u2.user_id = c.user2_id
        WHERE c.conversation_id = $1`,
      [rows[0].conversation_id, me]
    );
    return R.success(res, enriched[0], 201);
  } catch (err) { next(err); }
};

exports.getMessages = async (req, res, next) => {
  try {
    const me = req.user.user_id;
    const { id } = req.params;
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 40);
    const offset = (page - 1) * limit;
    const { rows: conv } = await query(
      `SELECT * FROM conversations WHERE conversation_id=$1 AND (user1_id=$2 OR user2_id=$2)`,
      [id, me]
    );
    if (!conv.length) return R.error(res, 404, 'Conversation not found');
    const { rows } = await query(
      `SELECT m.message_id, m.sender_id, m.is_read, m.created_at,
              m.edited_at, m.is_revoked, m.is_deleted,
              CASE WHEN m.is_deleted THEN '[Message deleted]'
                   WHEN m.is_revoked THEN '[Message revoked]'
                   ELSE m.content END AS content,
              u.full_name AS sender_name, u.username AS sender_username, u.avatar_url AS sender_avatar
         FROM messages m
         JOIN users u ON u.user_id = m.sender_id
        WHERE m.conversation_id = $1
        ORDER BY m.created_at ASC
        LIMIT $2 OFFSET $3`,
      [id, limit, offset]
    );
    await query(
      `UPDATE messages SET is_read=TRUE
        WHERE conversation_id=$1 AND sender_id!=$2 AND is_read=FALSE`,
      [id, me]
    );
    return R.success(res, rows);
  } catch (err) { next(err); }
};

exports.sendMessage = async (req, res, next) => {
  try {
    const me = req.user.user_id;
    const { id } = req.params;
    const { content } = req.body;
    if (!content?.trim()) return R.error(res, 400, 'Content required');
    const { rows: conv } = await query(
      `SELECT * FROM conversations WHERE conversation_id=$1 AND (user1_id=$2 OR user2_id=$2)`,
      [id, me]
    );
    if (!conv.length) return R.error(res, 404, 'Conversation not found');
    const { rows } = await query(
      `INSERT INTO messages (conversation_id, sender_id, content) VALUES ($1,$2,$3) RETURNING *`,
      [id, me, content.trim()]
    );
    const { rows: enriched } = await query(
      `SELECT m.message_id, m.content, m.sender_id, m.is_read, m.created_at, m.edited_at,
              u.full_name AS sender_name, u.username AS sender_username, u.avatar_url AS sender_avatar
         FROM messages m JOIN users u ON u.user_id=m.sender_id WHERE m.message_id=$1`,
      [rows[0].message_id]
    );
    return R.success(res, enriched[0], 201);
  } catch (err) { next(err); }
};

// PATCH /conversations/:id/messages/:msg_id — edit
exports.editMessage = async (req, res, next) => {
  try {
    const me = req.user.user_id;
    const { id, msg_id } = req.params;
    const { content } = req.body;
    if (!content?.trim()) return R.error(res, 400, 'Content required');
    const { rows } = await query(
      `UPDATE messages
          SET original_content = COALESCE(original_content, content),
              content = $1,
              edited_at = NOW()
        WHERE message_id=$2 AND sender_id=$3
          AND conversation_id=$4 AND is_deleted=FALSE AND is_revoked=FALSE
        RETURNING *`,
      [content.trim(), msg_id, me, id]
    );
    if (!rows.length) return R.error(res, 403, 'Not allowed');
    return R.success(res, rows[0]);
  } catch (err) { next(err); }
};

// DELETE /conversations/:id/messages/:msg_id — delete for me (soft)
exports.deleteMessage = async (req, res, next) => {
  try {
    const me = req.user.user_id;
    const { msg_id, id } = req.params;
    const { rows } = await query(
      `UPDATE messages SET is_deleted=TRUE, deleted_at=NOW()
        WHERE message_id=$1 AND sender_id=$2 AND conversation_id=$3
        RETURNING *`,
      [msg_id, me, id]
    );
    if (!rows.length) return R.error(res, 403, 'Not allowed');
    return R.success(res, { deleted: true });
  } catch (err) { next(err); }
};

// POST /conversations/:id/messages/:msg_id/revoke — revoke for everyone
exports.revokeMessage = async (req, res, next) => {
  try {
    const me = req.user.user_id;
    const { msg_id, id } = req.params;
    // 15-minute window
    const { rows } = await query(
      `UPDATE messages SET is_revoked=TRUE, revoked_at=NOW()
        WHERE message_id=$1 AND sender_id=$2 AND conversation_id=$3
          AND created_at > NOW() - INTERVAL '15 minutes'
        RETURNING *`,
      [msg_id, me, id]
    );
    if (!rows.length) return R.error(res, 403, 'Cannot revoke — only within 15 minutes of sending');
    return R.success(res, { revoked: true });
  } catch (err) { next(err); }
};

exports.markRead = async (req, res, next) => {
  try {
    const me = req.user.user_id;
    const { id } = req.params;
    await query(`UPDATE messages SET is_read=TRUE WHERE conversation_id=$1 AND sender_id!=$2 AND is_read=FALSE`, [id, me]);
    return R.success(res, { marked: true });
  } catch (err) { next(err); }
};

exports.searchUsers = async (req, res, next) => {
  try {
    const me = req.user.user_id;
    const { q } = req.query;
    if (!q?.trim()) return R.success(res, []);
    const { rows } = await query(
      `SELECT user_id, full_name, username, avatar_url
         FROM users WHERE user_id!=$1 AND (full_name ILIKE $2 OR username ILIKE $2) AND deleted_at IS NULL LIMIT 10`,
      [me, `%${q.trim()}%`]
    );
    return R.success(res, rows);
  } catch (err) { next(err); }
};

// ══════════════════════════════════════════════════════════
// GROUP CONVERSATIONS
// ══════════════════════════════════════════════════════════

exports.getGroupConversations = async (req, res, next) => {
  try {
    const me = req.user.user_id;
    const { rows } = await query(
      `SELECT gc.group_conv_id, gc.name, gc.avatar_url, gc.last_message, gc.last_message_at,
              gc.created_by, gc.created_at,
              gcm.role AS my_role,
              (SELECT COUNT(*) FROM group_conv_members WHERE group_conv_id=gc.group_conv_id) AS member_count,
              (SELECT COUNT(*) FROM group_messages gm
                WHERE gm.group_conv_id=gc.group_conv_id AND gm.sender_id!=$1
                  AND gm.is_read=FALSE AND gm.is_deleted=FALSE) AS unread_count
         FROM group_conversations gc
         JOIN group_conv_members gcm ON gcm.group_conv_id=gc.group_conv_id AND gcm.user_id=$1
        ORDER BY gc.last_message_at DESC NULLS LAST, gc.created_at DESC`,
      [me]
    );
    return R.success(res, rows);
  } catch (err) { next(err); }
};

exports.createGroupConversation = async (req, res, next) => {
  try {
    const me = req.user.user_id;
    const { name, description, member_ids = [] } = req.body;
    if (!name?.trim()) return R.error(res, 400, 'Group name required');
    const { rows } = await query(
      `INSERT INTO group_conversations (name, description, created_by) VALUES ($1,$2,$3) RETURNING *`,
      [name.trim(), description?.trim() || null, me]
    );
    const gc = rows[0];
    // Add creator as admin
    await query(
      `INSERT INTO group_conv_members (group_conv_id, user_id, role) VALUES ($1,$2,'admin')`,
      [gc.group_conv_id, me]
    );
    // Add other members
    const unique = [...new Set(member_ids)].filter(id => id !== me);
    for (const uid of unique) {
      await query(
        `INSERT INTO group_conv_members (group_conv_id, user_id, role) VALUES ($1,$2,'member') ON CONFLICT DO NOTHING`,
        [gc.group_conv_id, uid]
      );
    }
    return R.success(res, gc, 201);
  } catch (err) { next(err); }
};

exports.addGroupMembers = async (req, res, next) => {
  try {
    const me = req.user.user_id;
    const { group_conv_id } = req.params;
    const { member_ids = [] } = req.body;
    const { rows: adminCheck } = await query(
      `SELECT role FROM group_conv_members WHERE group_conv_id=$1 AND user_id=$2`,
      [group_conv_id, me]
    );
    if (!adminCheck.length || adminCheck[0].role !== 'admin') return R.error(res, 403, 'Only admins can add members');
    for (const uid of member_ids) {
      await query(
        `INSERT INTO group_conv_members (group_conv_id, user_id, role) VALUES ($1,$2,'member') ON CONFLICT DO NOTHING`,
        [group_conv_id, uid]
      );
    }
    return R.success(res, { added: member_ids.length });
  } catch (err) { next(err); }
};

exports.getGroupMessages = async (req, res, next) => {
  try {
    const me = req.user.user_id;
    const { group_conv_id } = req.params;
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 40);
    const offset = (page - 1) * limit;
    const { rows: mem } = await query(
      `SELECT 1 FROM group_conv_members WHERE group_conv_id=$1 AND user_id=$2`,
      [group_conv_id, me]
    );
    if (!mem.length) return R.error(res, 403, 'Not a member');
    const { rows } = await query(
      `SELECT gm.group_msg_id, gm.sender_id, gm.is_read, gm.created_at, gm.edited_at,
              gm.is_revoked, gm.is_deleted,
              CASE WHEN gm.is_deleted THEN '[Message deleted]'
                   WHEN gm.is_revoked THEN '[Message revoked]'
                   ELSE gm.content END AS content,
              u.full_name AS sender_name, u.username AS sender_username, u.avatar_url AS sender_avatar
         FROM group_messages gm
         JOIN users u ON u.user_id=gm.sender_id
        WHERE gm.group_conv_id=$1
        ORDER BY gm.created_at ASC
        LIMIT $2 OFFSET $3`,
      [group_conv_id, limit, offset]
    );
    await query(
      `UPDATE group_messages SET is_read=TRUE WHERE group_conv_id=$1 AND sender_id!=$2 AND is_read=FALSE`,
      [group_conv_id, me]
    );
    return R.success(res, rows);
  } catch (err) { next(err); }
};

exports.sendGroupMessage = async (req, res, next) => {
  try {
    const me = req.user.user_id;
    const { group_conv_id } = req.params;
    const { content } = req.body;
    if (!content?.trim()) return R.error(res, 400, 'Content required');
    const { rows: mem } = await query(
      `SELECT 1 FROM group_conv_members WHERE group_conv_id=$1 AND user_id=$2`,
      [group_conv_id, me]
    );
    if (!mem.length) return R.error(res, 403, 'Not a member');
    const { rows } = await query(
      `INSERT INTO group_messages (group_conv_id, sender_id, content) VALUES ($1,$2,$3) RETURNING *`,
      [group_conv_id, me, content.trim()]
    );
    const { rows: enriched } = await query(
      `SELECT gm.group_msg_id, gm.content, gm.sender_id, gm.created_at,
              u.full_name AS sender_name, u.username AS sender_username, u.avatar_url AS sender_avatar
         FROM group_messages gm JOIN users u ON u.user_id=gm.sender_id WHERE gm.group_msg_id=$1`,
      [rows[0].group_msg_id]
    );
    return R.success(res, enriched[0], 201);
  } catch (err) { next(err); }
};

exports.editGroupMessage = async (req, res, next) => {
  try {
    const me = req.user.user_id;
    const { group_conv_id, msg_id } = req.params;
    const { content } = req.body;
    if (!content?.trim()) return R.error(res, 400, 'Content required');
    const { rows } = await query(
      `UPDATE group_messages
          SET original_content=COALESCE(original_content,content), content=$1, edited_at=NOW()
        WHERE group_msg_id=$2 AND sender_id=$3 AND group_conv_id=$4
          AND is_deleted=FALSE AND is_revoked=FALSE
        RETURNING *`,
      [content.trim(), msg_id, me, group_conv_id]
    );
    if (!rows.length) return R.error(res, 403, 'Not allowed');
    return R.success(res, rows[0]);
  } catch (err) { next(err); }
};

exports.deleteGroupMessage = async (req, res, next) => {
  try {
    const me = req.user.user_id;
    const { group_conv_id, msg_id } = req.params;
    const { rows } = await query(
      `UPDATE group_messages SET is_deleted=TRUE, deleted_at=NOW()
        WHERE group_msg_id=$1 AND sender_id=$2 AND group_conv_id=$3 RETURNING *`,
      [msg_id, me, group_conv_id]
    );
    if (!rows.length) return R.error(res, 403, 'Not allowed');
    return R.success(res, { deleted: true });
  } catch (err) { next(err); }
};

exports.revokeGroupMessage = async (req, res, next) => {
  try {
    const me = req.user.user_id;
    const { group_conv_id, msg_id } = req.params;
    const { rows } = await query(
      `UPDATE group_messages SET is_revoked=TRUE, revoked_at=NOW()
        WHERE group_msg_id=$1 AND sender_id=$2 AND group_conv_id=$3
          AND created_at > NOW() - INTERVAL '15 minutes'
        RETURNING *`,
      [msg_id, me, group_conv_id]
    );
    if (!rows.length) return R.error(res, 403, 'Cannot revoke — only within 15 minutes');
    return R.success(res, { revoked: true });
  } catch (err) { next(err); }
};

// ══════════════════════════════════════════════════════════
// BROADCAST
// ══════════════════════════════════════════════════════════

exports.sendBroadcast = async (req, res, next) => {
  try {
    const me = req.user.user_id;
    const { content } = req.body;
    if (!content?.trim()) return R.error(res, 400, 'Content required');
    const { rows } = await query(
      `INSERT INTO broadcasts (sender_id, content) VALUES ($1,$2) RETURNING *`,
      [me, content.trim()]
    );
    return R.success(res, rows[0], 201);
  } catch (err) { next(err); }
};

exports.getBroadcasts = async (req, res, next) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 20);
    const offset = (page - 1) * limit;
    const { rows } = await query(
      `SELECT b.broadcast_id, b.created_at, b.edited_at, b.is_revoked,
              CASE WHEN b.is_revoked THEN '[Broadcast revoked]' ELSE b.content END AS content,
              u.user_id AS sender_id, u.full_name AS sender_name,
              u.username AS sender_username, u.avatar_url AS sender_avatar
         FROM broadcasts b
         JOIN users u ON u.user_id=b.sender_id
        WHERE b.is_revoked=FALSE OR b.is_revoked=TRUE
        ORDER BY b.created_at DESC
        LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    return R.success(res, rows);
  } catch (err) { next(err); }
};

exports.editBroadcast = async (req, res, next) => {
  try {
    const me = req.user.user_id;
    const { broadcast_id } = req.params;
    const { content } = req.body;
    if (!content?.trim()) return R.error(res, 400, 'Content required');
    const { rows } = await query(
      `UPDATE broadcasts
          SET original_content=COALESCE(original_content,content), content=$1, edited_at=NOW()
        WHERE broadcast_id=$2 AND sender_id=$3 AND is_revoked=FALSE
        RETURNING *`,
      [content.trim(), broadcast_id, me]
    );
    if (!rows.length) return R.error(res, 403, 'Not allowed');
    return R.success(res, rows[0]);
  } catch (err) { next(err); }
};

exports.revokeBroadcast = async (req, res, next) => {
  try {
    const me = req.user.user_id;
    const { broadcast_id } = req.params;
    const { rows } = await query(
      `UPDATE broadcasts SET is_revoked=TRUE, revoked_at=NOW()
        WHERE broadcast_id=$1 AND sender_id=$2 RETURNING *`,
      [broadcast_id, me]
    );
    if (!rows.length) return R.error(res, 403, 'Not allowed');
    return R.success(res, { revoked: true });
  } catch (err) { next(err); }
};
