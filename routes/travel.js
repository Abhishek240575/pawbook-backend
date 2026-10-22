// routes/travel.js — Pet-Friendly Travel Destinations + User Saves
const express = require('express');
const router  = express.Router();
const { pool } = require('../db');
const auth    = require('../middleware/auth');

// GET /api/v1/travel — browse destinations (public)
router.get('/', auth, async (req, res) => {
  const { country, pet_friendly, q, limit = 20, offset = 0 } = req.query;
  const params = [];
  const conditions = [];
  let idx = 1;

  if (country)      { conditions.push(`country ILIKE $${idx++}`);     params.push(`%${country}%`); }
  if (pet_friendly) { conditions.push(`pet_friendly = $${idx++}`);    params.push(pet_friendly === 'true'); }
  if (q)            { conditions.push(`(name ILIKE $${idx} OR description ILIKE $${idx})`); params.push(`%${q}%`); idx++; }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  params.push(Number(limit), Number(offset));

  try {
    const { rows } = await pool.query(
      `SELECT * FROM travel_destinations ${where}
       ORDER BY name ASC
       LIMIT $${idx++} OFFSET $${idx++}`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load destinations' });
  }
});

// GET /api/v1/travel/saved — destinations saved by current user
router.get('/saved', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT d.*, s.saved_at
       FROM user_travel_saves s
       JOIN travel_destinations d ON s.destination_id = d.id
       WHERE s.user_id=$1
       ORDER BY s.saved_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load saved destinations' });
  }
});

// POST /api/v1/travel/:id/save — save a destination
router.post('/:id/save', auth, async (req, res) => {
  try {
    await pool.query(
      `INSERT INTO user_travel_saves (user_id, destination_id)
       VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [req.user.id, req.params.id]
    );
    res.json({ saved: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save destination' });
  }
});

// DELETE /api/v1/travel/:id/save — unsave a destination
router.delete('/:id/save', auth, async (req, res) => {
  try {
    await pool.query(
      `DELETE FROM user_travel_saves WHERE user_id=$1 AND destination_id=$2`,
      [req.user.id, req.params.id]
    );
    res.json({ unsaved: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to unsave destination' });
  }
});

// GET /api/v1/travel/:id — single destination detail
router.get('/:id', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT d.*,
              (SELECT 1 FROM user_travel_saves
               WHERE user_id=$2 AND destination_id=d.id) AS is_saved
       FROM travel_destinations d
       WHERE d.id=$1`,
      [req.params.id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Destination not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load destination' });
  }
});

module.exports = router;
