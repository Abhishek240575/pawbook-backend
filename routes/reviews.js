// routes/reviews.js — Marketplace Product Reviews
const express = require('express');
const router  = express.Router();
const { pool } = require('../db');
const auth    = require('../middleware/auth');

// GET /api/reviews?product_id=X — list reviews + aggregated rating
router.get('/', async (req, res) => {
  const { product_id } = req.query;
  if (!product_id) return res.status(400).json({ error: 'product_id required' });

  try {
    const [{ rows: reviews }, { rows: agg }] = await Promise.all([
      pool.query(
        `SELECT r.*, u.username AS reviewer_name, u.avatar_url AS reviewer_avatar
         FROM marketplace_reviews r
         JOIN users u ON r.user_id = u.id
         WHERE r.product_id=$1
         ORDER BY r.created_at DESC`,
        [product_id]
      ),
      pool.query(
        `SELECT
           COUNT(*)::int           AS total,
           ROUND(AVG(rating),1)    AS avg_rating,
           COUNT(*) FILTER (WHERE rating=5) AS five_star,
           COUNT(*) FILTER (WHERE rating=4) AS four_star,
           COUNT(*) FILTER (WHERE rating=3) AS three_star,
           COUNT(*) FILTER (WHERE rating=2) AS two_star,
           COUNT(*) FILTER (WHERE rating=1) AS one_star
         FROM marketplace_reviews
         WHERE product_id=$1`,
        [product_id]
      )
    ]);

    res.json({ reviews, summary: agg[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load reviews' });
  }
});

// POST /api/reviews — submit a review (one per user per product)
router.post('/', auth, async (req, res) => {
  const { product_id, rating, title, body } = req.body;
  if (!product_id || !rating) {
    return res.status(400).json({ error: 'product_id and rating required' });
  }
  if (rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'rating must be 1–5' });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO marketplace_reviews (product_id, user_id, rating, title, body)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (product_id, user_id) DO UPDATE
         SET rating=$3, title=$4, body=$5
       RETURNING *`,
      [product_id, req.user.id, rating, title || null, body || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to submit review' });
  }
});

// PATCH /api/reviews/:id/helpful — increment helpful count
router.patch('/:id/helpful', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE marketplace_reviews
       SET helpful = helpful + 1
       WHERE id=$1
       RETURNING id, helpful`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Review not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update helpful count' });
  }
});

// DELETE /api/reviews/:id — delete own review
router.delete('/:id', auth, async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM marketplace_reviews WHERE id=$1 AND user_id=$2`,
      [req.params.id, req.user.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Review not found' });
    res.json({ deleted: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete review' });
  }
});

module.exports = router;
