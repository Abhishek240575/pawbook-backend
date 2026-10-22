// routes/search.js — Global search across users, pets, posts
// users: user_id(uuid), username, avatar_url, bio
// posts: id(int), user_id(int) — join via users.user_no
// Pet: id, "userId"(uuid), name, species, breed, avatar
const express = require('express');
const router  = express.Router();
const { pool } = require('../db');
const auth    = require('../middleware/auth');

// GET /api/v1/search?q=&type=all|users|pets|posts&limit=10
router.get('/', auth, async (req, res) => {
  const q     = (req.query.q || '').trim();
  const type  = req.query.type || 'all';
  const limit = Math.min(parseInt(req.query.limit) || 10, 50);

  if (!q) return res.status(400).json({ error: 'q is required' });

  const pattern = `%${q}%`;
  const results = {};

  try {
    const queries = [];

    if (type === 'all' || type === 'users') {
      queries.push(
        pool.query(
          `SELECT user_id AS id, username AS name, avatar_url AS avatar, bio,
                  (SELECT COUNT(*)::int FROM follows WHERE following_id=u.user_id) AS followers
           FROM users u
           WHERE username ILIKE $1 OR bio ILIKE $1
           LIMIT $2`,
          [pattern, limit]
        ).then(r => { results.users = r.rows; })
        .catch(() => { results.users = []; })
      );
    }

    if (type === 'all' || type === 'pets') {
      queries.push(
        pool.query(
          `SELECT p.id, p.name, p.species, p.breed, p.avatar,
                  u.user_id AS owner_id, u.username AS owner_name, u.avatar_url AS owner_avatar
           FROM "Pet" p
           JOIN users u ON u.user_id = p."userId"
           WHERE p.name ILIKE $1 OR p.breed ILIKE $1 OR p.species ILIKE $1
           LIMIT $2`,
          [pattern, limit]
        ).then(r => { results.pets = r.rows; })
        .catch(() => { results.pets = []; })
      );
    }

    if (type === 'all' || type === 'posts') {
      queries.push(
        pool.query(
          `SELECT p.id, p.content, p.media_urls, p.created_at,
                  u.user_id AS author_id, u.username AS author_name, u.avatar_url AS author_avatar,
                  p.comment_count, p.like_count
           FROM posts p
           JOIN users u ON u.user_no = p.user_id
           WHERE p.content ILIKE $1
           ORDER BY p.created_at DESC
           LIMIT $2`,
          [pattern, limit]
        ).then(r => { results.posts = r.rows; })
        .catch(() => { results.posts = []; })
      );
    }

    await Promise.all(queries);
    res.json(results);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Search failed' });
  }
});

// GET /api/v1/search/hashtag/:tag
router.get('/hashtag/:tag', auth, async (req, res) => {
  const tag    = req.params.tag.replace(/^#/, '');
  const limit  = Math.min(parseInt(req.query.limit) || 20, 50);
  const offset = parseInt(req.query.offset) || 0;

  try {
    const { rows } = await pool.query(
      `SELECT p.id, p.content, p.media_urls, p.created_at,
              u.user_id AS author_id, u.username AS author_name, u.avatar_url AS author_avatar,
              p.comment_count, p.like_count
       FROM posts p
       JOIN users u ON u.user_no = p.user_id
       WHERE p.content ILIKE $1
       ORDER BY p.created_at DESC
       LIMIT $2 OFFSET $3`,
      [`%#${tag}%`, limit, offset]
    );
    res.json({ tag, posts: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Search failed' });
  }
});

module.exports = router;
