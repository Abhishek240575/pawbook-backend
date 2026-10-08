const pool = require('../config/db');
const R = require('../utils/response');

// ── GET /api/v1/media/gallery ─────────────────────────────────────────────────
async function getGallery(req, res) {
  try {
    const { type, limit = 50, offset = 0 } = req.query;
    const uid = req.user.user_id;

    let mediaQ = `
      SELECT m.media_id as id, m.url, m.thumbnail_url, m.caption,
             m.media_type, m.is_highlight, m.created_at,
             ma.name as album_name, ma.album_id,
             'media' as source
      FROM media m
      LEFT JOIN media_albums ma ON m.album_id = ma.album_id
      WHERE m.user_id = $1
    `;
    const params = [uid];
    if (type) { mediaQ += ` AND m.media_type = $2`; params.push(type); }
    mediaQ += ` ORDER BY m.created_at DESC LIMIT $${params.length+1} OFFSET $${params.length+2}`;
    params.push(limit, offset);

    const { rows: mediaRows } = await pool.query(mediaQ, params);

    let postRows = [];
    if (Number(offset) === 0 && !type) {
      const { rows } = await pool.query(
        `SELECT post_id as id, image_url as url, image_url as thumbnail_url,
                content as caption, 'photo' as media_type, FALSE as is_highlight,
                created_at, NULL as album_name, NULL as album_id, 'post' as source
         FROM posts
         WHERE user_id = $1 AND image_url IS NOT NULL
         ORDER BY created_at DESC LIMIT 30`,
        [uid]
      );
      postRows = rows;
    }

    const seen = new Set();
    const all = [...mediaRows, ...postRows].filter(r => {
      if (seen.has(r.url)) return false;
      seen.add(r.url); return true;
    }).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    return R.ok(res, { items: all, total: all.length });
  } catch (err) { return R.serverError(res, err.message); }
}

// ── GET /api/v1/media/albums ──────────────────────────────────────────────────
async function getAlbums(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT a.album_id, a.name, a.description, a.cover_url, a.created_at,
              COUNT(m.media_id)::int as photo_count,
              MAX(m.created_at) as last_updated
       FROM media_albums a
       LEFT JOIN media m ON m.album_id = a.album_id
       WHERE a.user_id = $1
       GROUP BY a.album_id
       ORDER BY a.created_at DESC`,
      [req.user.user_id]
    );
    return R.ok(res, rows);
  } catch (err) { return R.serverError(res, err.message); }
}

// ── POST /api/v1/media/albums ─────────────────────────────────────────────────
async function createAlbum(req, res) {
  try {
    const { name, description } = req.body;
    if (!name?.trim()) return R.badRequest(res, 'Album name is required');
    const { rows } = await pool.query(
      `INSERT INTO media_albums (user_id, name, description)
       VALUES ($1, $2, $3) RETURNING *`,
      [req.user.user_id, name.trim(), description || null]
    );
    return R.created(res, rows[0], 'Album created');
  } catch (err) { return R.serverError(res, err.message); }
}

// ── GET /api/v1/media/albums/:id ─────────────────────────────────────────────
async function getAlbum(req, res) {
  try {
    const { id } = req.params;
    const { rows: album } = await pool.query(
      `SELECT * FROM media_albums WHERE album_id = $1 AND user_id = $2`,
      [id, req.user.user_id]
    );
    if (!album.length) return R.notFound(res, 'Album not found');

    const { rows: media } = await pool.query(
      `SELECT media_id as id, url, thumbnail_url, caption, media_type, is_highlight, created_at
       FROM media WHERE album_id = $1 ORDER BY created_at DESC`,
      [id]
    );
    return R.ok(res, { album: album[0], media });
  } catch (err) { return R.serverError(res, err.message); }
}

// ── PATCH /api/v1/media/albums/:id ───────────────────────────────────────────
async function updateAlbum(req, res) {
  try {
    const { id } = req.params;
    const { name, description, cover_url } = req.body;
    const { rows } = await pool.query(
      `UPDATE media_albums SET
         name = COALESCE($1, name),
         description = COALESCE($2, description),
         cover_url = COALESCE($3, cover_url),
         updated_at = NOW()
       WHERE album_id = $4 AND user_id = $5 RETURNING *`,
      [name || null, description || null, cover_url || null, id, req.user.user_id]
    );
    if (!rows.length) return R.notFound(res, 'Album not found');
    return R.ok(res, rows[0], 'Album updated');
  } catch (err) { return R.serverError(res, err.message); }
}

// ── DELETE /api/v1/media/albums/:id ──────────────────────────────────────────
async function deleteAlbum(req, res) {
  try {
    const { rows } = await pool.query(
      `DELETE FROM media_albums WHERE album_id = $1 AND user_id = $2 RETURNING album_id`,
      [req.params.id, req.user.user_id]
    );
    if (!rows.length) return R.notFound(res, 'Album not found');
    return R.ok(res, null, 'Album deleted');
  } catch (err) { return R.serverError(res, err.message); }
}

// ── POST /api/v1/media/upload ─────────────────────────────────────────────────
async function uploadMedia(req, res) {
  try {
    const { url, thumbnail_url, media_type = 'photo', caption, album_id,
            width, height, duration_sec, file_size } = req.body;
    if (!url) return R.badRequest(res, 'url is required');
    if (!['photo','video'].includes(media_type)) return R.badRequest(res, 'media_type must be photo or video');

    if (album_id) {
      const { rows } = await pool.query(
        `SELECT album_id FROM media_albums WHERE album_id = $1 AND user_id = $2`,
        [album_id, req.user.user_id]
      );
      if (!rows.length) return R.badRequest(res, 'Album not found or not yours');
    }

    const { rows } = await pool.query(
      `INSERT INTO media (user_id, album_id, media_type, url, thumbnail_url,
                          caption, width, height, duration_sec, file_size)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [req.user.user_id, album_id || null, media_type, url,
       thumbnail_url || url, caption || null,
       width || null, height || null, duration_sec || null, file_size || null]
    );

    if (album_id) {
      await pool.query(
        `UPDATE media_albums SET
           photo_count = (SELECT COUNT(*) FROM media WHERE album_id = $1),
           cover_url = COALESCE(cover_url, $2),
           updated_at = NOW()
         WHERE album_id = $1`,
        [album_id, url]
      );
    }

    return R.created(res, rows[0], 'Media uploaded');
  } catch (err) { return R.serverError(res, err.message); }
}

// ── PATCH /api/v1/media/:id ───────────────────────────────────────────────────
async function updateMedia(req, res) {
  try {
    const { id } = req.params;
    const { caption, album_id, is_highlight } = req.body;
    const { rows } = await pool.query(
      `UPDATE media SET
         caption = COALESCE($1, caption),
         album_id = COALESCE($2::uuid, album_id),
         is_highlight = COALESCE($3, is_highlight),
         updated_at = NOW()
       WHERE media_id = $4 AND user_id = $5 RETURNING *`,
      [caption ?? null, album_id ?? null, is_highlight ?? null, id, req.user.user_id]
    );
    if (!rows.length) return R.notFound(res, 'Media not found');
    return R.ok(res, rows[0], 'Updated');
  } catch (err) { return R.serverError(res, err.message); }
}

// ── DELETE /api/v1/media/:id ──────────────────────────────────────────────────
async function deleteMedia(req, res) {
  try {
    const { rows } = await pool.query(
      `DELETE FROM media WHERE media_id = $1 AND user_id = $2 RETURNING media_id, album_id`,
      [req.params.id, req.user.user_id]
    );
    if (!rows.length) return R.notFound(res, 'Media not found');
    if (rows[0].album_id) {
      await pool.query(
        `UPDATE media_albums SET photo_count = (SELECT COUNT(*) FROM media WHERE album_id = $1), updated_at = NOW() WHERE album_id = $1`,
        [rows[0].album_id]
      );
    }
    return R.ok(res, null, 'Deleted');
  } catch (err) { return R.serverError(res, err.message); }
}

// ── GET /api/v1/media/highlights ─────────────────────────────────────────────
async function getHighlights(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT media_id as id, url, thumbnail_url, caption, media_type, created_at
       FROM media WHERE user_id = $1 AND is_highlight = TRUE
       ORDER BY created_at DESC LIMIT 30`,
      [req.user.user_id]
    );
    return R.ok(res, rows);
  } catch (err) { return R.serverError(res, err.message); }
}

// ── GET /api/v1/media/tagged ──────────────────────────────────────────────────
async function getTagged(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT m.media_id as id, m.url, m.thumbnail_url, m.caption,
              m.media_type, m.created_at,
              u.full_name as uploaded_by,
              p.name as tagged_pet_name
       FROM media_tags mt
       JOIN media m ON mt.media_id = m.media_id
       JOIN users u ON m.user_id = u.user_id
       LEFT JOIN pets p ON mt.pet_id = p.id
       WHERE mt.user_id = $1
          OR mt.pet_id IN (SELECT id FROM pets WHERE user_id = $1)
       ORDER BY m.created_at DESC LIMIT 50`,
      [req.user.user_id]
    );
    return R.ok(res, rows);
  } catch (err) { return R.serverError(res, err.message); }
}

module.exports = {
  getGallery, getAlbums, createAlbum, getAlbum, updateAlbum, deleteAlbum,
  uploadMedia, updateMedia, deleteMedia, getHighlights, getTagged
};