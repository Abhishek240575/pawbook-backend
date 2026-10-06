// routes/training.js — Pet Training Sessions
const express = require('express');
const router  = express.Router();
const { pool } = require('../config/db');
const { authenticate } = require('../middleware');

// GET /api/training?pet_id=X — list training sessions
router.get('/', authenticate, async (req, res) => {
  const { pet_id, completed } = req.query;
  let query = `
    SELECT t.*, p.name AS pet_name
    FROM training_sessions t
    LEFT JOIN pets p ON t.pet_id = p.id
    WHERE t.user_id=$1
  `;
  const params = [req.user.id];
  if (pet_id) { params.push(pet_id); query += ` AND t.pet_id=$${params.length}`; }
  if (completed !== undefined) {
    params.push(completed === 'true');
    query += ` AND t.completed=$${params.length}`;
  }
  query += ` ORDER BY t.session_date DESC NULLS LAST, t.created_at DESC`;

  try {
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load training sessions' });
  }
});

// POST /api/training — log a training session
router.post('/', authenticate, async (req, res) => {
  const {
    pet_id, trainer_name, skill,
    session_date, duration_min, notes, completed
  } = req.body;

  if (!skill) return res.status(400).json({ error: 'skill is required' });

  try {
    if (pet_id) {
      const { rows } = await pool.query(
        `SELECT id FROM pets WHERE id=$1 AND user_id=$2`,
        [pet_id, req.user.id]
      );
      if (!rows.length) return res.status(403).json({ error: 'Not your pet' });
    }

    const { rows } = await pool.query(
      `INSERT INTO training_sessions
         (user_id, pet_id, trainer_name, skill,
          session_date, duration_min, notes, completed)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [req.user.id, pet_id || null, trainer_name || null, skill,
       session_date || null, duration_min || 30,
       notes || null, completed === true || completed === 'true']
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to log training session' });
  }
});

// PATCH /api/training/:id/complete — mark a session complete
router.patch('/:id/complete', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE training_sessions SET completed=TRUE
       WHERE id=$1 AND user_id=$2
       RETURNING *`,
      [req.params.id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Session not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update session' });
  }
});

// PUT /api/training/:id — update a session
router.put('/:id', authenticate, async (req, res) => {
  const { trainer_name, skill, session_date, duration_min, notes, completed } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE training_sessions
       SET trainer_name=$1, skill=COALESCE($2,skill),
           session_date=$3, duration_min=COALESCE($4,duration_min),
           notes=$5, completed=COALESCE($6,completed)
       WHERE id=$7 AND user_id=$8
       RETURNING *`,
      [trainer_name || null, skill, session_date || null,
       duration_min, notes || null,
       completed !== undefined ? (completed === true || completed === 'true') : null,
       req.params.id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Session not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update session' });
  }
});

// DELETE /api/training/:id
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM training_sessions WHERE id=$1 AND user_id=$2`,
      [req.params.id, req.user.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Session not found' });
    res.json({ deleted: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete session' });
  }
});

module.exports = router;
