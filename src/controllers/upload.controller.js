// src/controllers/upload.controller.js
// Works with middleware/upload.js (multer-storage-cloudinary)
// Files are already uploaded to Cloudinary by the time these run;
// req.file.path = secure_url, req.file.filename = public_id

const { deleteFromCloudinary } = require('../middleware/upload');
const R        = require('../utils/response');
const logger   = require('../utils/logger');
const { query } = require('../config/db');

// ── SINGLE FILE UPLOAD ────────────────────────────────────────────────────────
// POST /api/v1/media/upload
// Multipart form: file (image or video)
// Query param: ?type=avatar|cover|post|pet|vet|event  (default: post)
const uploadFile = async (req, res, next) => {
  try {
    if (!req.file) return R.badRequest(res, 'No file provided');

    const type       = req.query.type || 'post';
    const url        = req.file.path;       // Cloudinary secure_url
    const public_id  = req.file.filename;   // Cloudinary public_id
    const resource   = req.file.mimetype?.startsWith('video/') ? 'video' : 'image';

    // Update user avatar / cover URL directly
    if (type === 'avatar') {
      // Delete old avatar from Cloudinary (non-fatal)
      try {
        const { rows } = await query(
          `SELECT avatar_url FROM users WHERE user_id = $1`, [req.user.user_id]
        );
        if (rows[0]?.avatar_url) await deleteFromCloudinary(rows[0].avatar_url);
      } catch (_) {}

      await query(
        `UPDATE users SET avatar_url = $1, updated_at = NOW() WHERE user_id = $2`,
        [url, req.user.user_id]
      );

      return R.ok(res, { url, public_id, type: 'avatar' }, 'Avatar updated');
    }

    if (type === 'cover') {
      try {
        const { rows } = await query(
          `SELECT cover_url FROM users WHERE user_id = $1`, [req.user.user_id]
        );
        if (rows[0]?.cover_url) await deleteFromCloudinary(rows[0].cover_url);
      } catch (_) {}

      await query(
        `UPDATE users SET cover_url = $1, updated_at = NOW() WHERE user_id = $2`,
        [url, req.user.user_id]
      );

      return R.ok(res, { url, public_id, type: 'cover' }, 'Cover photo updated');
    }

    // For post / pet / vet / event — save to media table
    let mediaRow = null;
    try {
      const { rows } = await query(
        `INSERT INTO media
           (user_id, media_type, url, thumbnail_url, size_bytes, original_filename, public_id)
         VALUES ($1, $2, $3, $3, $4, $5, $6)
         RETURNING *`,
        [
          req.user.user_id,
          resource,
          url,
          req.file.size || null,
          req.file.originalname || null,
          public_id,
        ]
      );
      mediaRow = rows[0];
    } catch (_) { /* non-fatal if media table missing */ }

    logger.info('File uploaded', { user_id: req.user.user_id, type, public_id });

    return R.ok(res, {
      url,
      public_id,
      resource_type: resource,
      media_id: mediaRow?.media_id || null,
    }, 'Upload successful');

  } catch (err) {
    logger.error('Upload failed', { error: err.message });
    next(err);
  }
};

// ── MULTIPLE FILES UPLOAD ─────────────────────────────────────────────────────
// POST /api/v1/media/upload-multiple
// Multipart form: files[] (up to 5 images/videos)
const uploadMultiple = async (req, res, next) => {
  try {
    if (!req.files || !req.files.length) return R.badRequest(res, 'No files provided');

    const files = req.files.map(f => ({
      url:           f.path,
      public_id:     f.filename,
      resource_type: f.mimetype?.startsWith('video/') ? 'video' : 'image',
      original_name: f.originalname,
    }));

    // Save all to media table (non-fatal)
    const mediaIds = [];
    for (const f of files) {
      try {
        const { rows } = await query(
          `INSERT INTO media (user_id, media_type, url, thumbnail_url, original_filename, public_id)
           VALUES ($1, $2, $3, $3, $4, $5) RETURNING media_id`,
          [req.user.user_id, f.resource_type, f.url, f.original_name, f.public_id]
        );
        mediaIds.push(rows[0].media_id);
      } catch (_) {}
    }

    return R.ok(res, {
      files,
      media_ids: mediaIds,
      count: files.length,
    }, 'Files uploaded');

  } catch (err) {
    logger.error('Multiple upload failed', { error: err.message });
    next(err);
  }
};

module.exports = { uploadFile, uploadMultiple };
