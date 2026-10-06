// routes/vaccinations.js — Pet Vaccination Records
const express = require('express');
const router  = express.Router();
const { pool } = require('../db');
const auth    = require('../middleware/auth');

// GET /api/vaccinations?pet_id=X — list vaccinations for a pet
router.get('/', auth, async (req, res) => {
  const { pet_id } = req.query;
  if (!pet_id) return res.status(400).json({ error: 'pet_id required' });

  try {
    const { rows } = await pool.query(
      `SELECT v.* FROM vaccinations v
       WHERE v.pet_id=$1 AND v.user_id=$2
       ORDER BY v.given_date DESC`,
      [pet_id, req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load vaccinations' });
  }
});

// POST /api/vaccinations — add a vaccination record
router.post('/', auth, async (req, res) => {
  const {
    pet_id, vaccine_name, given_date, next_due_date,
    vet_name, clinic_name, batch_number, notes, doc_url
  } = req.body;

  if (!pet_id || !vaccine_name || !given_date) {
    return res.status(400).json({ error: 'pet_id, vaccine_name, given_date required' });
  }

  try {
    // Verify pet ownership
    const { rows: pet } = await pool.query(
      `SELECT id FROM pets WHERE id=$1 AND user_id=$2`,
      [pet_id, req.user.id]
    );
    if (!pet.length) return res.status(403).json({ error: 'Not your pet' });

    const { rows } = await pool.query(
      `INSERT INTO vaccinations
         (pet_id, user_id, vaccine_name, given_date, next_due_date,
          vet_name, clinic_name, batch_number, notes, doc_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [pet_id, req.user.id, vaccine_name, given_date,
       next_due_date || null, vet_name || null, clinic_name || null,
       batch_number || null, notes || null, doc_url || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to add vaccination' });
  }
});

// PUT /api/vaccinations/:id — update a vaccination record
router.put('/:id', auth, async (req, res) => {
  const {
    vaccine_name, given_date, next_due_date,
    vet_name, clinic_name, batch_number, notes, doc_url
  } = req.body;

  try {
    const { rows } = await pool.query(
      `UPDATE vaccinations
       SET vaccine_name=COALESCE($1,vaccine_name),
           given_date=COALESCE($2,given_date),
           next_due_date=$3,
           vet_name=$4,
           clinic_name=$5,
           batch_number=$6,
           notes=$7,
           doc_url=$8
       WHERE id=$9 AND user_id=$10
       RETURNING *`,
      [vaccine_name, given_date, next_due_date || null,
       vet_name || null, clinic_name || null,
       batch_number || null, notes || null, doc_url || null,
       req.params.id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Record not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update vaccination' });
  }
});

// DELETE /api/vaccinations/:id
router.delete('/:id', auth, async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM vaccinations WHERE id=$1 AND user_id=$2`,
      [req.params.id, req.user.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Record not found' });
    res.json({ deleted: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete vaccination' });
  }
});

module.exports = router;
