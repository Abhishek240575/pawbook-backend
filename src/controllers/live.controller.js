'use strict';
const { query } = require('../config/db');
const R = require('../utils/response');
const crypto = require('crypto');
const uid = () => crypto.randomBytes(8).toString('hex');

// Agora token generation — requires agora-access-token package
// npm install agora-access-token
let RtcTokenBuilder, RtcRole;
try {
  const agora = require('agora-access-token');
  RtcTokenBuilder = agora.RtcTokenBuilder;
  RtcRole = agora.RtcRole;
} catch(e) { /* package not installed — tokens disabled */ }

const AGORA_APP_ID  = process.env.AGORA_APP_ID  || '';
const AGORA_APP_CERT = process.env.AGORA_APP_CERT || '';
const CHAN_PREFIX = 'pb_live_';

function generateAgoraToken(channel, uid) {
  if (!RtcTokenBuilder || !AGORA_APP_ID || !AGORA_APP_CERT) return null;
  const expireAt = Math.floor(Date.now() / 1000) + 3600; // 1 hour
  return RtcTokenBuilder.buildTokenWithUid(AGORA_APP_ID, AGORA_APP_CERT, channel, uid, RtcRole.PUBLISHER, expireAt);
}

// ── LIST active streams ───────────────────────────────────────────────────────
exports.listStreams = async (req, res) => {
  try {
    const { limit = 20, offset = 0 } = req.query;
    const { rows } = await query(
      `SELECT s.*, u.name AS host_name, u.avatar_url
       FROM live_streams s LEFT JOIN users u ON u.user_id = s.host_id
       WHERE s.status = 'live' ORDER BY s.viewer_count DESC LIMIT $1 OFFSET $2`,
      [Number(limit), Number(offset)]);
    return R.ok(res, { streams: rows });
  } catch(e) { console.error('[Live] listStreams:', e.message); return R.serverError(res); }
};

// ── CREATE stream (go live) ────────────────────────────────────────────────────
exports.createStream = async (req, res) => {
  try {
    const { title, category } = req.body;
    if (!title) return R.badRequest(res, 'title required');
    const streamId = 'stream_' + uid();
    const channel  = CHAN_PREFIX + streamId;

    await query(
      `INSERT INTO live_streams (stream_id, host_id, title, category, status)
       VALUES ($1, $2, $3, $4, 'live')`,
      [streamId, req.user.userId, title, category || 'general']);

    const agoraToken = generateAgoraToken(channel, req.user.userId);
    return R.created(res, {
      stream_id: streamId,
      channel,
      agora_app_id: AGORA_APP_ID || null,
      agora_token: agoraToken,
    });
  } catch(e) { console.error('[Live] createStream:', e.message); return R.serverError(res); }
};

// ── GET viewer token ──────────────────────────────────────────────────────────
exports.getToken = async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM live_streams WHERE stream_id=$1', [req.params.stream_id]);
    if (!rows.length) return R.notFound(res, 'Stream not found');
    const s = rows[0];
    const channel = CHAN_PREFIX + s.stream_id;
    const agoraToken = generateAgoraToken(channel, req.user.userId);
    return R.ok(res, { stream_id: s.stream_id, channel, agora_app_id: AGORA_APP_ID || null, agora_token: agoraToken });
  } catch(e) { return R.serverError(res); }
};

// ── END stream ────────────────────────────────────────────────────────────────
exports.endStream = async (req, res) => {
  try {
    await query(
      `UPDATE live_streams SET status='ended', ended_at=NOW()
       WHERE stream_id=$1 AND host_id=$2`,
      [req.params.stream_id, req.user.userId]);
    // Notify via socket (server-side emit if io accessible)
    const io = req.app.get('io');
    if (io) io.to('live:' + req.params.stream_id).emit('live:ended', { stream_id: req.params.stream_id });
    return R.ok(res, { ended: true });
  } catch(e) { return R.serverError(res); }
};

// ── COMMENT ────────────────────────────────────────────────────────────────────
exports.addComment = async (req, res) => {
  try {
    const { content } = req.body;
    if (!content) return R.badRequest(res, 'content required');
    const user = req.user;
    const { rows: [stream] } = await query('SELECT host_id FROM live_streams WHERE stream_id=$1', [req.params.stream_id]);
    if (!stream) return R.notFound(res, 'Stream not found');

    const cid = 'lc_' + uid();
    await query(
      'INSERT INTO live_comments (comment_id, stream_id, user_id, content) VALUES ($1,$2,$3,$4)',
      [cid, req.params.stream_id, user.userId, content]);

    const io = req.app.get('io');
    if (io) {
      io.to('live:' + req.params.stream_id).emit('live:comment', {
        stream_id: req.params.stream_id,
        author: user.name || user.username,
        text: content,
      });
    }
    return R.created(res, { comment_id: cid });
  } catch(e) { return R.serverError(res); }
};

// ── VIEWER COUNT (socket updates this, REST is fallback) ─────────────────────
exports.updateViewerCount = async (req, res) => {
  try {
    const { delta = 1 } = req.body; // +1 join / -1 leave
    await query(
      'UPDATE live_streams SET viewer_count = GREATEST(viewer_count + $1, 0) WHERE stream_id=$2',
      [delta, req.params.stream_id]);
    return R.ok(res, { updated: true });
  } catch(e) { return R.serverError(res); }
};
