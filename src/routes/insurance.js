// routes/insurance.js — Pet Insurance Policies
const express = require('express');
const router  = express.Router();
const { pool } = require('../config/db');
const { authenticate } = require('../middleware');

// GET /api/insurance — list all policies for current user
router.get('/', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT i.*, p.name AS pet_name
       FROM insurance_policies i
       LEFT JOIN pets p ON i.pet_id = p.id
       WHERE i.user_id=$1
       ORDER BY i.created_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load insurance policies' });
  }
});

// POST /api/insurance — add a new policy
router.post('/', authenticate, async (req, res) => {
  const {
    pet_id, provider, plan_name, policy_number,
    premium, coverage, start_date, end_date
  } = req.body;

  if (!provider) return res.status(400).json({ error: 'provider is required' });

  try {
    if (pet_id) {
      const { rows } = await pool.query(
        `SELECT id FROM pets WHERE id=$1 AND user_id=$2`,
        [pet_id, req.user.id]
      );
      if (!rows.length) return res.status(403).json({ error: 'Not your pet' });
    }

    const { rows } = await pool.query(
      `INSERT INTO insurance_policies
         (user_id, pet_id, provider, plan_name, policy_number,
          premium, coverage, start_date, end_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [req.user.id, pet_id || null, provider,
       plan_name || null, policy_number || null,
       premium || null, coverage || null,
       start_date || null, end_date || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to add policy' });
  }
});

// PUT /api/insurance/:id — update a policy
router.put('/:id', authenticate, async (req, res) => {
  const {
    provider, plan_name, policy_number,
    premium, coverage, start_date, end_date, status
  } = req.body;

  try {
    const { rows } = await pool.query(
      `UPDATE insurance_policies
       SET provider=COALESCE($1,provider),
           plan_name=$2,
           policy_number=$3,
           premium=$4,
           coverage=$5,
           start_date=$6,
           end_date=$7,
           status=COALESCE($8,status)
       WHERE id=$9 AND user_id=$10
       RETURNING *`,
      [provider, plan_name || null, policy_number || null,
       premium || null, coverage || null,
       start_date || null, end_date || null,
       status || null, req.params.id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Policy not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update policy' });
  }
});

// DELETE /api/insurance/:id — delete a policy
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM insurance_policies WHERE id=$1 AND user_id=$2`,
      [req.params.id, req.user.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Policy not found' });
    res.json({ deleted: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete policy' });
  }
});

module.exports = router;
