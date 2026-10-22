// routes/media.js — Gallery, Albums, Highlights, Tagged media
// posts.user_id is integer; users.user_no is integer — join via user_no
const express = require('express');
const router  = express.Router();
const { pool } = require('../db');
const auth    = require('../middleware/auth');

// GET /api/v1/media/gallery — all media for current user
router.get('/gallery', auth, async (req, res) => {
  const { pet_id, type, limit = 40, offset = 0 } = req.query;
  const conditions = ['pm.user_id=$1'];
  const params = [req.user.id];
  let idx = 2;

  if (pet_id) { conditions.push(`pm.pet_id=$${idx++}`); params.push(pet_id); }
  if (type)   { conditions.push(`pm.type=$${idx++}`);   params.push(type); }

  params.push(Number(limit), Number(offset));

  try {
    const { rows } = await pool.query(
      `SELECT pm.*, p.name AS pet_name
       FROM pet_media pm
       LEFT JOIN "Pet" p ON p.id = pm.pet_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY pm.created_at DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
      params
    );
    res.json({ data: rows });
  } catch (err) {
    res.json({ data: [] });
  }
});

// GET /api/v1/media/:userId — media for a specific user (public)
router.get('/:userId', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT pm.*, p.name AS pet_name
       FROM pet_media pm
       LEFT JOIN "Pet" p ON p.id = pm.pet_id
       WHERE pm.user_id=$1 AND pm.is_public=TRUE
       ORDER BY pm.created_at DESC
       LIMIT 60`,
      [req.params.userId]
    );
    res.json({ data: rows });
  } catch (err) {
    res.json({ data: [] });
  }
});

// GET /api/v1/media/albums — list albums for current user
router.get('/albums', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT a.*,
              (SELECT COUNT(*)::int FROM album_items WHERE album_id=a.id) AS item_count,
              (SELECT pm.media_url FROM album_items ai
               JOIN pet_media pm ON pm.id = ai.media_id
               WHERE ai.album_id=a.id ORDER BY ai.created_at LIMIT 1) AS cover_url
       FROM albums a
       WHERE a.user_id=$1
       ORDER BY a.created_at DESC`,
      [req.user.id]
    );
    res.json({ data: rows });
  } catch (err) {
    res.json({ data: [] });
  }
});

// GET /api/v1/media/albums/:id
router.get('/albums/:id', auth, async (req, res) => {
  try {
    const [albumRes, itemsRes] = await Promise.all([
      pool.query('SELECT * FROM albums WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]),
      pool.query(
        `SELECT ai.*, pm.media_url, pm.type, pm.caption
         FROM album_items ai
         JOIN pet_media pm ON pm.id = ai.media_id
         WHERE ai.album_id=$1
         ORDER BY ai.created_at DESC`,
        [req.params.id]
      )
    ]);
    if (!albumRes.rows.length) return res.status(404).json({ error: 'Album not found' });
    res.json({ data: albumRes.rows[0], items: itemsRes.rows });
  } catch (err) {
    res.json({ data: null, items: [] });
  }
});

// POST /api/v1/media/albums — create album
router.post('/albums', auth, async (req, res) => {
  const { name, description, pet_id } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO albums (user_id, name, description, pet_id)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [req.user.id, name, description || null, pet_id || null]
    );
    res.status(201).json({ data: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create album' });
  }
});

// POST /api/v1/media/upload — save media metadata after upload
router.post('/upload', auth, async (req, res) => {
  const { media_url, type, caption, pet_id, album_id, is_public } = req.body;
  if (!media_url) return res.status(400).json({ error: 'media_url is required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO pet_media (user_id, media_url, type, caption, pet_id, is_public)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.user.id, media_url, type || 'image',
       caption || null, pet_id || null, is_public !== false]
    );
    if (album_id) {
      await pool.query(
        'INSERT INTO album_items (album_id, media_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [album_id, rows[0].id]
      ).catch(() => {});
    }
    res.status(201).json({ data: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save media' });
  }
});

// GET /api/v1/media/highlights
router.get('/highlights', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM story_highlights WHERE user_id=$1 ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.json({ data: rows });
  } catch (err) {
    res.json({ data: [] });
  }
});

// GET /api/v1/media/tagged — posts the current user is tagged in
// posts.user_id is integer, users.user_no is integer
router.get('/tagged', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.*, u.username AS author_name, u.avatar_url AS author_avatar
       FROM post_tags pt
       JOIN posts p ON p.id = pt.post_id
       JOIN users u ON u.user_no = p.user_id
       WHERE pt.tagged_user_id=$1
       ORDER BY p.created_at DESC
       LIMIT 40`,
      [req.user.id]
    );
    res.json({ data: rows });
  } catch (err) {
    res.json({ data: [] });
  }
});

module.exports = router;
