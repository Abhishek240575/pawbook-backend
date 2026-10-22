// routes/vaccinations.js
const express = require('express');
const router  = express.Router();
const { query } = require('../config/db');
const { authenticate } = require('../middleware');

// GET /api/vaccinations?pet_id=X
router.get('/', authenticate, async (req, res) => {
  const { pet_id } = req.query;
  if (!pet_id) return res.status(400).json({ error: 'pet_id required' });
  try {
    // resolve user_no from user_id (UUID)
    const { rows: u } = await query(`SELECT user_no FROM users WHERE user_id=$1`, [req.user.user_id]);
    if (!u.length) return res.status(401).json({ error: 'User not found' });
    const userNo = u[0].user_no;

    const { rows } = await query(
      `SELECT v.* FROM pet_vaccinations v
       JOIN pets p ON v.pet_id = p.id
       WHERE v.pet_id=$1 AND p.user_id=$2
       ORDER BY v.administered_at DESC`,
      [pet_id, userNo]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load vaccinations' });
  }
});

// POST /api/vaccinations
router.post('/', authenticate, async (req, res) => {
  const { pet_id, vaccine_name, administered_at, next_due_date, notes } = req.body;
  if (!pet_id || !vaccine_name || !administered_at) {
    return res.status(400).json({ error: 'pet_id, vaccine_name, administered_at required' });
  }
  try {
    const { rows: u } = await query(`SELECT user_no FROM users WHERE user_id=$1`, [req.user.user_id]);
    if (!u.length) return res.status(401).json({ error: 'User not found' });
    const userNo = u[0].user_no;

    const { rows: pet } = await query(`SELECT id FROM pets WHERE id=$1 AND user_id=$2`, [pet_id, userNo]);
    if (!pet.length) return res.status(403).json({ error: 'Not your pet' });

    const { rows } = await query(
      `INSERT INTO pet_vaccinations (pet_id, vaccine_name, administered_at, next_due_date, notes)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [pet_id, vaccine_name, administered_at, next_due_date || null, notes || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to add vaccination' });
  }
});

// PUT /api/vaccinations/:id
router.put('/:id', authenticate, async (req, res) => {
  const { vaccine_name, administered_at, next_due_date, notes } = req.body;
  try {
    const { rows: u } = await query(`SELECT user_no FROM users WHERE user_id=$1`, [req.user.user_id]);
    if (!u.length) return res.status(401).json({ error: 'User not found' });
    const userNo = u[0].user_no;

    const { rows } = await query(
      `UPDATE pet_vaccinations v SET
         vaccine_name=COALESCE($1,v.vaccine_name),
         administered_at=COALESCE($2,v.administered_at),
         next_due_date=$3, notes=$4
       FROM pets p
       WHERE v.id=$5 AND v.pet_id=p.id AND p.user_id=$6
       RETURNING v.*`,
      [vaccine_name, administered_at, next_due_date || null, notes || null, req.params.id, userNo]
    );
    if (!rows.length) return res.status(404).json({ error: 'Record not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update vaccination' });
  }
});

// DELETE /api/vaccinations/:id
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const { rows: u } = await query(`SELECT user_no FROM users WHERE user_id=$1`, [req.user.user_id]);
    if (!u.length) return res.status(401).json({ error: 'User not found' });
    const userNo = u[0].user_no;

    const { rowCount } = await query(
      `DELETE FROM pet_vaccinations v USING pets p
       WHERE v.id=$1 AND v.pet_id=p.id AND p.user_id=$2`,
      [req.params.id, userNo]
    );
    if (!rowCount) return res.status(404).json({ error: 'Record not found' });
    res.json({ deleted: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete vaccination' });
  }
});

module.exports = router;
