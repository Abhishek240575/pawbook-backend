'use strict';
/**
 * notifications.controller.js
 * Drop into: src/controllers/notifications.controller.js
 */

const { query: dbQuery } = require('../config/db');

/* ─────────────────────────────────────────────────────────────
   GET /api/v1/notifications   (auth required)
   Query: limit (default 30), offset, unread_only=true
───────────────────────────────────────────────────────────── */
exports.getNotifications = async (req, res, next) => {
  try {
    const uid    = req.user.user_id;
    const limit  = Math.min(parseInt(req.query.limit)  || 30, 100);
    const offset = Math.max(parseInt(req.query.offset) || 0,  0);
    const unreadOnly = req.query.unread_only === 'true';

    const conditions = ['user_id = $1'];
    const params = [uid];
    if (unreadOnly) conditions.push('is_read = FALSE');

    params.push(limit, offset);
    const { rows } = await dbQuery(
      `SELECT * FROM notifications
        WHERE ${conditions.join(' AND ')}
        ORDER BY created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    // Unread count
    const { rows: countRows } = await dbQuery(
      `SELECT COUNT(*) AS unread_count FROM notifications
        WHERE user_id=$1 AND is_read=FALSE`,
      [uid]
    );

    return res.json({
      success: true,
      data: rows,
      unread_count: parseInt(countRows[0].unread_count),
      total: rows.length
    });
  } catch (err) { next(err); }
};

/* ─────────────────────────────────────────────────────────────
   PATCH /api/v1/notifications/:id/read   (auth required)
───────────────────────────────────────────────────────────── */
exports.markOneRead = async (req, res, next) => {
  try {
    const uid = req.user.user_id;
    const { id } = req.params;

    const { rows } = await dbQuery(
      `UPDATE notifications SET is_read=TRUE
        WHERE id=$1 AND user_id=$2 RETURNING *`,
      [id, uid]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Notification not found' });
    return res.json({ success: true, data: rows[0] });
  } catch (err) { next(err); }
};

/* ─────────────────────────────────────────────────────────────
   PATCH /api/v1/notifications/read-all   (auth required)
───────────────────────────────────────────────────────────── */
exports.markAllRead = async (req, res, next) => {
  try {
    const uid = req.user.user_id;
    const { rowCount } = await dbQuery(
      `UPDATE notifications SET is_read=TRUE WHERE user_id=$1 AND is_read=FALSE`,
      [uid]
    );
    return res.json({ success: true, updated: rowCount });
  } catch (err) { next(err); }
};

/* ─────────────────────────────────────────────────────────────
   POST /api/v1/notifications   (auth required — internal use)
   Create a notification for a user. Called by other controllers
   (vet booking confirmed, vaccination due, training complete, etc.)
   Body: user_id, type, title, body, link_url, icon_emoji
───────────────────────────────────────────────────────────── */
exports.createNotification = async (req, res, next) => {
  try {
    const { user_id, type, title, body, link_url, icon_emoji } = req.body;
    const { rows } = await dbQuery(
      `INSERT INTO notifications(user_id,type,title,body,link_url,icon_emoji)
       VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
      [user_id, type||'system', title, body||null, link_url||null, icon_emoji||'🔔']
    );
    return res.status(201).json({ success: true, data: rows[0] });
  } catch (err) { next(err); }
};

/* ─────────────────────────────────────────────────────────────
   DELETE /api/v1/notifications/:id   (auth required)
───────────────────────────────────────────────────────────── */
exports.deleteNotification = async (req, res, next) => {
  try {
    const uid = req.user.user_id;
    const { id } = req.params;
    await dbQuery(
      `DELETE FROM notifications WHERE id=$1 AND user_id=$2`,
      [id, uid]
    );
    return res.json({ success: true });
  } catch (err) { next(err); }
};
