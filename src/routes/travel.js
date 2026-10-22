// routes/travel.js
const express = require('express');
const router  = express.Router();
const { query } = require('../config/db');
const { authenticate } = require('../middleware');

async function getUserNo(userUuid) {
  const { rows } = await query(`SELECT user_no FROM users WHERE user_id=$1`, [userUuid]);
  return rows.length ? rows[0].user_no : null;
}

router.get('/', authenticate, async (req, res) => {
  const { status } = req.query;
  try {
    const userNo = await getUserNo(req.user.user_id);
    if (!userNo) return res.status(401).json({ error: 'User not found' });
    let sql = `SELECT t.*, p.name AS pet_name FROM travel_plans t LEFT JOIN pets p ON t.pet_id = p.id WHERE t.user_id=$1`;
    const params = [userNo];
    if (status) { params.push(status); sql += ` AND t.status=$${params.length}`; }
    sql += ` ORDER BY t.travel_date ASC NULLS LAST, t.created_at DESC`;
    const { rows } = await query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load travel plans' });
  }
});

router.post('/', authenticate, async (req, res) => {
  const { pet_id, destination, travel_date, return_date, transport, accommodation, notes } = req.body;
  if (!destination) return res.status(400).json({ error: 'destination is required' });
  try {
    const userNo = await getUserNo(req.user.user_id);
    if (!userNo) return res.status(401).json({ error: 'User not found' });
    if (pet_id) {
      const { rows } = await query(`SELECT id FROM pets WHERE id=$1 AND user_id=$2`, [pet_id, userNo]);
      if (!rows.length) return res.status(403).json({ error: 'Not your pet' });
    }
    const { rows } = await query(
      `INSERT INTO travel_plans (user_id, pet_id, destination, travel_date, return_date, transport, accommodation, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [userNo, pet_id || null, destination, travel_date || null, return_date || null,
       transport || 'car', accommodation || null, notes || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create travel plan' });
  }
});

router.put('/:id', authenticate, async (req, res) => {
  const { destination, travel_date, return_date, transport, accommodation, notes, status } = req.body;
  try {
    const userNo = await getUserNo(req.user.user_id);
    if (!userNo) return res.status(401).json({ error: 'User not found' });
    const { rows } = await query(
      `UPDATE travel_plans SET destination=COALESCE($1,destination), travel_date=$2, return_date=$3,
          transport=COALESCE($4,transport), accommodation=$5, notes=$6, status=COALESCE($7,status)
       WHERE id=$8 AND user_id=$9 RETURNING *`,
      [destination, travel_date || null, return_date || null,
       transport, accommodation || null, notes || null, status, req.params.id, userNo]
    );
    if (!rows.length) return res.status(404).json({ error: 'Travel plan not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update travel plan' });
  }
});

router.patch('/:id/status', authenticate, async (req, res) => {
  const { status } = req.body;
  if (!['planned','ongoing','completed'].includes(status)) {
    return res.status(400).json({ error: 'status must be planned|ongoing|completed' });
  }
  try {
    const userNo = await getUserNo(req.user.user_id);
    if (!userNo) return res.status(401).json({ error: 'User not found' });
    const { rows } = await query(
      `UPDATE travel_plans SET status=$1 WHERE id=$2 AND user_id=$3 RETURNING *`,
      [status, req.params.id, userNo]
    );
    if (!rows.length) return res.status(404).json({ error: 'Travel plan not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update status' });
  }
});

router.delete('/:id', authenticate, async (req, res) => {
  try {
    const userNo = await getUserNo(req.user.user_id);
    if (!userNo) return res.status(401).json({ error: 'User not found' });
    const { rowCount } = await query(
      `DELETE FROM travel_plans WHERE id=$1 AND user_id=$2`,
      [req.params.id, userNo]
    );
    if (!rowCount) return res.status(404).json({ error: 'Travel plan not found' });
    res.json({ deleted: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete travel plan' });
  }
});

module.exports = router;
