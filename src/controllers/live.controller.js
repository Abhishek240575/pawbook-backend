'use strict';
const { query } = require('../config/db');
const R = require('../utils/response');

// Agora token generation — optional, graceful fallback if package missing
let RtcTokenBuilder, RtcRole;
try {
  const agora = require('agora-access-token');
  RtcTokenBuilder = agora.RtcTokenBuilder;
  RtcRole = agora.RtcRole;
} catch(e) { /* agora-access-token not installed — tokens disabled */ }

const AGORA_APP_ID   = process.env.AGORA_APP_ID  || '';
const AGORA_APP_CERT = process.env.AGORA_APP_CERT || '';
const CHAN_PREFIX     = 'pb_live_';

function generateAgoraToken(channel, uid) {
  if (!RtcTokenBuilder || !AGORA_APP_ID || !AGORA_APP_CERT) return null;
  const expireAt = Math.floor(Date.now() / 1000) + 3600;
  return RtcTokenBuilder.buildTokenWithUid(
    AGORA_APP_ID, AGORA_APP_CERT, channel, uid, RtcRole.PUBLISHER, expireAt
  );
}

// ── LIST active streams ───────────────────────────────────────────────────────
// live_streams columns: id(int PK), user_id(uuid), title, thumbnail_url,
//   stream_key, status, viewer_count, started_at, ended_at
exports.listStreams = async (req, res) => {
  try {
    const { limit = 20, offset = 0 } = req.query;
    const { rows } = await query(
      `SELECT s.id AS stream_id, s.title, s.thumbnail_url, s.status,
              s.viewer_count, s.started_at,
              u.username AS host_username, u.full_name AS host_name, u.avatar_url
         FROM live_streams s
         LEFT JOIN users u ON u.user_id = s.user_id
        WHERE s.status = 'live'
        ORDER BY s.viewer_count DESC NULLS LAST
        LIMIT $1 OFFSET $2`,
      [Number(limit), Number(offset)]
    );
    return R.ok(res, { streams: rows });
  } catch(e) { console.error('[Live] listStreams:', e.message); return R.serverError(res); }
};

// ── CREATE stream (go live) ────────────────────────────────────────────────────
exports.createStream = async (req, res) => {
  try {
    const { title, category } = req.body;
    if (!title) return R.badRequest(res, 'title required');

    const { rows } = await query(
      `INSERT INTO live_streams (user_id, title, status, started_at)
       VALUES ($1, $2, 'live', NOW())
       RETURNING id AS stream_id, title, status, started_at`,
      [req.user.user_id, title]
    );
    const stream = rows[0];
    const channel = CHAN_PREFIX + stream.stream_id;
    const agoraToken = generateAgoraToken(channel, req.user.user_id);

    return R.created(res, {
      stream_id:    stream.stream_id,
      channel,
      agora_app_id: AGORA_APP_ID || null,
      agora_token:  agoraToken,
    });
  } catch(e) { console.error('[Live] createStream:', e.message); return R.serverError(res); }
};

// ── GET viewer token ──────────────────────────────────────────────────────────
exports.getToken = async (req, res) => {
  try {
    const { rows } = await query(
      'SELECT id AS stream_id FROM live_streams WHERE id = $1',
      [Number(req.params.stream_id)]
    );
    if (!rows.length) return R.notFound(res, 'Stream not found');
    const channel = CHAN_PREFIX + rows[0].stream_id;
    const agoraToken = generateAgoraToken(channel, req.user.user_id);
    return R.ok(res, {
      stream_id:    rows[0].stream_id,
      channel,
      agora_app_id: AGORA_APP_ID || null,
      agora_token:  agoraToken,
    });
  } catch(e) { console.error('[Live] getToken:', e.message); return R.serverError(res); }
};

// ── END stream ────────────────────────────────────────────────────────────────
exports.endStream = async (req, res) => {
  try {
    await query(
      `UPDATE live_streams SET status='ended', ended_at=NOW()
        WHERE id = $1 AND user_id = $2`,
      [Number(req.params.stream_id), req.user.user_id]
    );
    const io = req.app.get('io');
    if (io) io.to('live:' + req.params.stream_id).emit('live:ended', { stream_id: req.params.stream_id });
    return R.ok(res, { ended: true });
  } catch(e) { console.error('[Live] endStream:', e.message); return R.serverError(res); }
};

// ── ADD COMMENT ────────────────────────────────────────────────────────────────
// live_comments columns: id(int PK), stream_id(int FK), user_id(uuid), content, created_at
exports.addComment = async (req, res) => {
  try {
    const text = req.body.text || req.body.content;
    if (!text) return R.badRequest(res, 'text required');

    const { rows } = await query(
      `INSERT INTO live_comments (stream_id, user_id, content)
       VALUES ($1, $2, $3) RETURNING id`,
      [Number(req.params.stream_id), req.user.user_id, text]
    );
    const io = req.app.get('io');
    if (io) {
      io.to('live:' + req.params.stream_id).emit('live:comment', {
        stream_id: req.params.stream_id,
        author:    req.user.username || req.user.full_name,
        text,
      });
    }
    return R.created(res, { comment_id: rows[0].id });
  } catch(e) { console.error('[Live] addComment:', e.message); return R.serverError(res); }
};

// ── VIEWER COUNT (REST fallback — socket is primary) ─────────────────────────
exports.updateViewerCount = async (req, res) => {
  try {
    const delta = Number(req.body.delta ?? 1);
    await query(
      `UPDATE live_streams
          SET viewer_count = GREATEST(COALESCE(viewer_count,0) + $1, 0)
        WHERE id = $2`,
      [delta, Number(req.params.stream_id)]
    );
    return R.ok(res, { updated: true });
  } catch(e) { console.error('[Live] updateViewerCount:', e.message); return R.serverError(res); }
};
