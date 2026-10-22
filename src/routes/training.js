// routes/training.js
const express = require('express');
const router  = express.Router();
const { query } = require('../config/db');
const { authenticate } = require('../middleware');

async function getUserNo(userUuid) {
  const { rows } = await query(`SELECT user_no FROM users WHERE user_id=$1`, [userUuid]);
  return rows.length ? rows[0].user_no : null;
}

router.get('/', authenticate, async (req, res) => {
  const { pet_id, completed } = req.query;
  try {
    const userNo = await getUserNo(req.user.user_id);
    if (!userNo) return res.status(401).json({ error: 'User not found' });
    let sql = `SELECT t.*, p.name AS pet_name FROM training_sessions t LEFT JOIN pets p ON t.pet_id = p.id WHERE t.user_id=$1`;
    const params = [userNo];
    if (pet_id) { params.push(pet_id); sql += ` AND t.pet_id=$${params.length}`; }
    if (completed !== undefined) { params.push(completed === 'true'); sql += ` AND t.completed=$${params.length}`; }
    sql += ` ORDER BY t.session_date DESC NULLS LAST, t.created_at DESC`;
    const { rows } = await query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load training sessions' });
  }
});

router.post('/', authenticate, async (req, res) => {
  const { pet_id, trainer_name, skill, session_date, duration_min, notes, completed } = req.body;
  if (!skill) return res.status(400).json({ error: 'skill is required' });
  try {
    const userNo = await getUserNo(req.user.user_id);
    if (!userNo) return res.status(401).json({ error: 'User not found' });
    if (pet_id) {
      const { rows } = await query(`SELECT id FROM pets WHERE id=$1 AND user_id=$2`, [pet_id, userNo]);
      if (!rows.length) return res.status(403).json({ error: 'Not your pet' });
    }
    const { rows } = await query(
      `INSERT INTO training_sessions (user_id, pet_id, trainer_name, skill, session_date, duration_min, notes, completed)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [userNo, pet_id || null, trainer_name || null, skill,
       session_date || null, duration_min || 30, notes || null,
       completed === true || completed === 'true']
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to log training session' });
  }
});

router.patch('/:id/complete', authenticate, async (req, res) => {
  try {
    const userNo = await getUserNo(req.user.user_id);
    if (!userNo) return res.status(401).json({ error: 'User not found' });
    const { rows } = await query(
      `UPDATE training_sessions SET completed=TRUE WHERE id=$1 AND user_id=$2 RETURNING *`,
      [req.params.id, userNo]
    );
    if (!rows.length) return res.status(404).json({ error: 'Session not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update session' });
  }
});

router.put('/:id', authenticate, async (req, res) => {
  const { trainer_name, skill, session_date, duration_min, notes, completed } = req.body;
  try {
    const userNo = await getUserNo(req.user.user_id);
    if (!userNo) return res.status(401).json({ error: 'User not found' });
    const { rows } = await query(
      `UPDATE training_sessions SET trainer_name=$1, skill=COALESCE($2,skill),
          session_date=$3, duration_min=COALESCE($4,duration_min),
          notes=$5, completed=COALESCE($6,completed)
       WHERE id=$7 AND user_id=$8 RETURNING *`,
      [trainer_name || null, skill, session_date || null, duration_min,
       notes || null, completed !== undefined ? (completed === true || completed === 'true') : null,
       req.params.id, userNo]
    );
    if (!rows.length) return res.status(404).json({ error: 'Session not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update session' });
  }
});

router.delete('/:id', authenticate, async (req, res) => {
  try {
    const userNo = await getUserNo(req.user.user_id);
    if (!userNo) return res.status(401).json({ error: 'User not found' });
    const { rowCount } = await query(
      `DELETE FROM training_sessions WHERE id=$1 AND user_id=$2`,
      [req.params.id, userNo]
    );
    if (!rowCount) return res.status(404).json({ error: 'Session not found' });
    res.json({ deleted: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete session' });
  }
});

module.exports = router;
