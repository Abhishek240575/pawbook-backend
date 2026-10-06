// routes/travel.js — Pet Travel Plans
const express = require('express');
const router  = express.Router();
const { pool } = require('../db');
const auth    = require('../middleware/auth');

// GET /api/travel — list travel plans for current user
router.get('/', auth, async (req, res) => {
  const { status } = req.query;
  let query = `
    SELECT t.*, p.name AS pet_name
    FROM travel_plans t
    LEFT JOIN pets p ON t.pet_id = p.id
    WHERE t.user_id=$1
  `;
  const params = [req.user.id];
  if (status) { params.push(status); query += ` AND t.status=$${params.length}`; }
  query += ` ORDER BY t.travel_date ASC NULLS LAST, t.created_at DESC`;

  try {
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load travel plans' });
  }
});

// POST /api/travel — create a travel plan
router.post('/', auth, async (req, res) => {
  const {
    pet_id, destination, travel_date, return_date,
    transport, accommodation, notes
  } = req.body;

  if (!destination) return res.status(400).json({ error: 'destination is required' });

  try {
    if (pet_id) {
      const { rows } = await pool.query(
        `SELECT id FROM pets WHERE id=$1 AND user_id=$2`,
        [pet_id, req.user.id]
      );
      if (!rows.length) return res.status(403).json({ error: 'Not your pet' });
    }

    const { rows } = await pool.query(
      `INSERT INTO travel_plans
         (user_id, pet_id, destination, travel_date, return_date,
          transport, accommodation, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [req.user.id, pet_id || null, destination,
       travel_date || null, return_date || null,
       transport || 'car', accommodation || null, notes || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create travel plan' });
  }
});

// PUT /api/travel/:id — update a travel plan
router.put('/:id', auth, async (req, res) => {
  const {
    destination, travel_date, return_date,
    transport, accommodation, notes, status
  } = req.body;

  try {
    const { rows } = await pool.query(
      `UPDATE travel_plans
       SET destination=COALESCE($1,destination),
           travel_date=$2,
           return_date=$3,
           transport=COALESCE($4,transport),
           accommodation=$5,
           notes=$6,
           status=COALESCE($7,status)
       WHERE id=$8 AND user_id=$9
       RETURNING *`,
      [destination, travel_date || null, return_date || null,
       transport, accommodation || null, notes || null,
       status, req.params.id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Travel plan not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update travel plan' });
  }
});

// PATCH /api/travel/:id/status — update status (planned|ongoing|completed)
router.patch('/:id/status', auth, async (req, res) => {
  const { status } = req.body;
  if (!['planned','ongoing','completed'].includes(status)) {
    return res.status(400).json({ error: 'status must be planned|ongoing|completed' });
  }
  try {
    const { rows } = await pool.query(
      `UPDATE travel_plans SET status=$1 WHERE id=$2 AND user_id=$3 RETURNING *`,
      [status, req.params.id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Travel plan not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update status' });
  }
});

// DELETE /api/travel/:id
router.delete('/:id', auth, async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM travel_plans WHERE id=$1 AND user_id=$2`,
      [req.params.id, req.user.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Travel plan not found' });
    res.json({ deleted: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete travel plan' });
  }
});

module.exports = router;
