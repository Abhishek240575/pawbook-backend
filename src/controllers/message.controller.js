const { query } = require('../config/db');
const R = require('../utils/response');

// ── PEOPLE ────────────────────────────────────────────────────
exports.getUsers = async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT user_id, full_name, username, avatar_url, role,
              (last_login_at > NOW() - INTERVAL '5 minutes') AS is_online
         FROM users
        WHERE user_id != $1 AND status = 'active' AND deleted_at IS NULL
        ORDER BY full_name
        LIMIT 100`,
      [req.user.user_id]
    );
    return R.ok(res, rows);
  } catch (err) { next(err); }
};

exports.searchUsers = async (req, res, next) => {
  const q = (req.query.q || '').trim();
  if (!q) return R.badRequest(res, 'Query required');
  try {
    const { rows } = await query(
      `SELECT user_id, full_name, username, avatar_url, role
         FROM users
        WHERE user_id != $1
          AND status = 'active'
          AND deleted_at IS NULL
          AND (full_name ILIKE $2 OR username ILIKE $2)
        ORDER BY full_name
        LIMIT 20`,
      [req.user.user_id, `%${q}%`]
    );
    return R.ok(res, rows);
  } catch (err) { next(err); }
};

// ── DM CONVERSATIONS ──────────────────────────────────────────
exports.getConversations = async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT c.conversation_id,
              CASE WHEN c.user1_id=$1 THEN u2.full_name  ELSE u1.full_name  END AS other_name,
              CASE WHEN c.user1_id=$1 THEN u2.username   ELSE u1.username   END AS other_username,
              CASE WHEN c.user1_id=$1 THEN u2.avatar_url ELSE u1.avatar_url END AS other_avatar,
              CASE WHEN c.user1_id=$1 THEN c.user2_id    ELSE c.user1_id    END AS other_user_id,
              c.last_message,
              c.last_message_at,
              (SELECT COUNT(*) FROM messages
                WHERE conversation_id=c.conversation_id
                  AND sender_id!=$1 AND is_read=FALSE AND is_deleted=FALSE) AS unread_count
         FROM conversations c
         JOIN users u1 ON u1.user_id=c.user1_id
         JOIN users u2 ON u2.user_id=c.user2_id
        WHERE c.user1_id=$1 OR c.user2_id=$1
        ORDER BY COALESCE(c.last_message_at, c.created_at) DESC`,
      [req.user.user_id]
    );
    return R.ok(res, rows);
  } catch (err) { next(err); }
};

exports.getOrCreateConversation = async (req, res, next) => {
  const { other_user_id } = req.body;
  const me = req.user.user_id;
  const [u1, u2] = [me, other_user_id].sort();
  try {
    let { rows } = await query(
      `SELECT conversation_id FROM conversations WHERE user1_id=$1 AND user2_id=$2`,
      [u1, u2]
    );
    if (!rows.length) {
      const ins = await query(
        `INSERT INTO conversations (user1_id, user2_id) VALUES ($1,$2) RETURNING conversation_id`,
        [u1, u2]
      );
      rows = ins.rows;
    }
    return R.ok(res, rows[0]);
  } catch (err) { next(err); }
};

exports.getDMMessages = async (req, res, next) => {
  const { conversation_id } = req.params;
  try {
    const { rows } = await query(
      `SELECT m.message_id, m.sender_id, m.content, m.is_revoked,
              m.created_at, m.edited_at,
              (m.edited_at IS NOT NULL) AS is_edited,
              u.full_name AS sender_name, u.avatar_url AS sender_avatar
         FROM messages m
         JOIN users u ON u.user_id=m.sender_id
        WHERE m.conversation_id=$1 AND m.is_deleted=FALSE
        ORDER BY m.created_at ASC
        LIMIT 100`,
      [conversation_id]
    );
    await query(
      `UPDATE messages SET is_read=TRUE
        WHERE conversation_id=$1 AND sender_id!=$2 AND is_read=FALSE`,
      [conversation_id, req.user.user_id]
    );
    return R.ok(res, rows);
  } catch (err) { next(err); }
};

exports.sendDM = async (req, res, next) => {
  const { conversation_id } = req.params;
  const { content } = req.body;
  try {
    const { rows } = await query(
      `INSERT INTO messages (conversation_id, sender_id, content)
       VALUES ($1,$2,$3)
       RETURNING message_id, sender_id, content, created_at`,
      [conversation_id, req.user.user_id, content]
    );
    await query(
      `UPDATE conversations SET last_message=$1, last_message_at=NOW()
        WHERE conversation_id=$2`,
      [content, conversation_id]
    );
    return R.created(res, rows[0]);
  } catch (err) { next(err); }
};

exports.editDM = async (req, res, next) => {
  const { conversation_id, message_id } = req.params;
  const { content } = req.body;
  try {
    const { rows } = await query(
      `UPDATE messages
          SET original_content=COALESCE(original_content,content),
              content=$1, edited_at=NOW()
        WHERE message_id=$2 AND conversation_id=$3 AND sender_id=$4
          AND is_revoked=FALSE AND is_deleted=FALSE
       RETURNING message_id`,
      [content, message_id, conversation_id, req.user.user_id]
    );
    if (!rows.length) return R.forbidden(res, 'Cannot edit this message');
    return R.ok(res, rows[0]);
  } catch (err) { next(err); }
};

exports.deleteDM = async (req, res, next) => {
  const { conversation_id, message_id } = req.params;
  try {
    const { rows } = await query(
      `UPDATE messages SET is_deleted=TRUE, deleted_at=NOW()
        WHERE message_id=$1 AND conversation_id=$2 AND sender_id=$3
       RETURNING message_id`,
      [message_id, conversation_id, req.user.user_id]
    );
    if (!rows.length) return R.forbidden(res, 'Cannot delete this message');
    return R.ok(res, { deleted: true });
  } catch (err) { next(err); }
};

exports.revokeDM = async (req, res, next) => {
  const { conversation_id, message_id } = req.params;
  try {
    const { rows } = await query(
      `UPDATE messages SET is_revoked=TRUE, revoked_at=NOW()
        WHERE message_id=$1 AND conversation_id=$2 AND sender_id=$3
          AND created_at > NOW() - INTERVAL '15 minutes'
       RETURNING message_id`,
      [message_id, conversation_id, req.user.user_id]
    );
    if (!rows.length) return R.forbidden(res, 'Cannot revoke — too old or not yours');
    return R.ok(res, { revoked: true });
  } catch (err) { next(err); }
};

// ── GROUP CONVERSATIONS ───────────────────────────────────────
exports.getGroupConvs = async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT gc.group_conv_id, gc.name, gc.created_at,
              gc.last_message, gc.last_message_at,
              (SELECT COUNT(*) FROM group_messages
                WHERE group_conv_id=gc.group_conv_id
                  AND sender_id!=$1 AND is_read=FALSE AND is_deleted=FALSE) AS unread_count
         FROM group_conversations gc
         JOIN group_conv_members gcm ON gcm.group_conv_id=gc.group_conv_id AND gcm.user_id=$1
        ORDER BY COALESCE(gc.last_message_at, gc.created_at) DESC`,
      [req.user.user_id]
    );
    return R.ok(res, rows);
  } catch (err) { next(err); }
};

exports.createGroupConv = async (req, res, next) => {
  const { name, member_ids } = req.body;
  const me = req.user.user_id;
  try {
    const { rows } = await query(
      `INSERT INTO group_conversations (name, created_by) VALUES ($1,$2) RETURNING group_conv_id`,
      [name, me]
    );
    const gcId = rows[0].group_conv_id;
    const allMembers = [...new Set([me, ...member_ids])];
    for (const uid of allMembers) {
      await query(
        `INSERT INTO group_conv_members (group_conv_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [gcId, uid]
      );
    }
    return R.created(res, rows[0]);
  } catch (err) { next(err); }
};

exports.getGroupMessages = async (req, res, next) => {
  const { group_conv_id } = req.params;
  try {
    const { rows } = await query(
      `SELECT gm.group_msg_id AS message_id, gm.sender_id, gm.content,
              gm.is_revoked, gm.created_at, gm.edited_at,
              (gm.edited_at IS NOT NULL) AS is_edited,
              u.full_name AS sender_name, u.avatar_url AS sender_avatar
         FROM group_messages gm
         JOIN users u ON u.user_id=gm.sender_id
        WHERE gm.group_conv_id=$1 AND gm.is_deleted=FALSE
        ORDER BY gm.created_at ASC
        LIMIT 100`,
      [group_conv_id]
    );
    await query(
      `UPDATE group_messages SET is_read=TRUE
        WHERE group_conv_id=$1 AND sender_id!=$2 AND is_read=FALSE`,
      [group_conv_id, req.user.user_id]
    );
    return R.ok(res, rows);
  } catch (err) { next(err); }
};

exports.sendGroupMessage = async (req, res, next) => {
  const { group_conv_id } = req.params;
  const { content } = req.body;
  try {
    const { rows } = await query(
      `INSERT INTO group_messages (group_conv_id, sender_id, content)
       VALUES ($1,$2,$3)
       RETURNING group_msg_id AS message_id, sender_id, content, created_at`,
      [group_conv_id, req.user.user_id, content]
    );
    await query(
      `UPDATE group_conversations SET last_message=$1, last_message_at=NOW()
        WHERE group_conv_id=$2`,
      [content, group_conv_id]
    );
    return R.created(res, rows[0]);
  } catch (err) { next(err); }
};

exports.editGroupMessage = async (req, res, next) => {
  const { group_conv_id, message_id } = req.params;
  const { content } = req.body;
  try {
    const { rows } = await query(
      `UPDATE group_messages
          SET original_content=COALESCE(original_content,content),
              content=$1, edited_at=NOW()
        WHERE group_msg_id=$2 AND group_conv_id=$3 AND sender_id=$4
          AND is_revoked=FALSE AND is_deleted=FALSE
       RETURNING group_msg_id`,
      [content, message_id, group_conv_id, req.user.user_id]
    );
    if (!rows.length) return R.forbidden(res, 'Cannot edit this message');
    return R.ok(res, rows[0]);
  } catch (err) { next(err); }
};

exports.deleteGroupMessage = async (req, res, next) => {
  const { group_conv_id, message_id } = req.params;
  try {
    const { rows } = await query(
      `UPDATE group_messages SET is_deleted=TRUE, deleted_at=NOW()
        WHERE group_msg_id=$1 AND group_conv_id=$2 AND sender_id=$3
       RETURNING group_msg_id`,
      [message_id, group_conv_id, req.user.user_id]
    );
    if (!rows.length) return R.forbidden(res, 'Cannot delete this message');
    return R.ok(res, { deleted: true });
  } catch (err) { next(err); }
};

exports.revokeGroupMessage = async (req, res, next) => {
  const { group_conv_id, message_id } = req.params;
  try {
    const { rows } = await query(
      `UPDATE group_messages SET is_revoked=TRUE, revoked_at=NOW()
        WHERE group_msg_id=$1 AND group_conv_id=$2 AND sender_id=$3
          AND created_at > NOW() - INTERVAL '15 minutes'
       RETURNING group_msg_id`,
      [message_id, group_conv_id, req.user.user_id]
    );
    if (!rows.length) return R.forbidden(res, 'Cannot revoke — too old or not yours');
    return R.ok(res, { revoked: true });
  } catch (err) { next(err); }
};

exports.addGroupMembers = async (req, res, next) => {
  const { group_conv_id } = req.params;
  const { member_ids } = req.body;
  let added = 0;
  try {
    for (const uid of member_ids) {
      const r = await query(
        `INSERT INTO group_conv_members (group_conv_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [group_conv_id, uid]
      );
      added += r.rowCount;
    }
    return R.ok(res, { added });
  } catch (err) { next(err); }
};

// ── BROADCASTS ────────────────────────────────────────────────
exports.getBroadcasts = async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT b.broadcast_id, b.sender_id, b.content, b.is_revoked,
              b.created_at, b.edited_at,
              (b.edited_at IS NOT NULL) AS is_edited,
              u.full_name AS sender_name, u.avatar_url AS sender_avatar
         FROM broadcasts b
         JOIN users u ON u.user_id=b.sender_id
        ORDER BY b.created_at DESC
        LIMIT 50`
    );
    return R.ok(res, rows);
  } catch (err) { next(err); }
};

exports.sendBroadcast = async (req, res, next) => {
  const { content } = req.body;
  try {
    const { rows } = await query(
      `INSERT INTO broadcasts (sender_id, content) VALUES ($1,$2)
       RETURNING broadcast_id, sender_id, content, created_at`,
      [req.user.user_id, content]
    );
    return R.created(res, rows[0]);
  } catch (err) { next(err); }
};

exports.editBroadcast = async (req, res, next) => {
  const { broadcast_id } = req.params;
  const { content } = req.body;
  try {
    const { rows } = await query(
      `UPDATE broadcasts
          SET original_content=COALESCE(original_content,content),
              content=$1, edited_at=NOW()
        WHERE broadcast_id=$2 AND sender_id=$3 AND is_revoked=FALSE
       RETURNING broadcast_id`,
      [content, broadcast_id, req.user.user_id]
    );
    if (!rows.length) return R.forbidden(res, 'Cannot edit this broadcast');
    return R.ok(res, rows[0]);
  } catch (err) { next(err); }
};

exports.revokeBroadcast = async (req, res, next) => {
  const { broadcast_id } = req.params;
  try {
    const { rows } = await query(
      `UPDATE broadcasts SET is_revoked=TRUE
        WHERE broadcast_id=$1 AND sender_id=$2
       RETURNING broadcast_id`,
      [broadcast_id, req.user.user_id]
    );
    if (!rows.length) return R.forbidden(res, 'Cannot revoke this broadcast');
    return R.ok(res, { revoked: true });
  } catch (err) { next(err); }
};