// routes/nutrition.js — Nutrition Plans & Food Lookup
const express = require('express');
const router  = express.Router();
const { pool } = require('../db');
const auth    = require('../middleware/auth');

// GET /api/v1/nutrition/plans?pet_id=X — list nutrition plans
router.get('/plans', auth, async (req, res) => {
  const { pet_id } = req.query;
  const params = [req.user.id];
  let q = `SELECT n.*, p.name AS pet_name
           FROM nutrition_plans n
           LEFT JOIN pets p ON n.pet_id = p.id
           WHERE n.user_id=$1`;
  if (pet_id) { params.push(pet_id); q += ` AND n.pet_id=$${params.length}`; }
  q += ` ORDER BY n.created_at DESC`;
  try {
    const { rows } = await pool.query(q, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load plans' });
  }
});

// POST /api/v1/nutrition/plans — create a plan
router.post('/plans', auth, async (req, res) => {
  const { pet_id, plan_name, daily_calories, notes } = req.body;
  if (!plan_name) return res.status(400).json({ error: 'plan_name required' });
  try {
    if (pet_id) {
      const { rows } = await pool.query(
        `SELECT id FROM pets WHERE id=$1 AND user_id=$2`,
        [pet_id, req.user.id]
      );
      if (!rows.length) return res.status(403).json({ error: 'Not your pet' });
    }
    const { rows } = await pool.query(
      `INSERT INTO nutrition_plans (user_id, pet_id, plan_name, daily_calories, notes)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.user.id, pet_id || null, plan_name, daily_calories || null, notes || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create plan' });
  }
});

// PUT /api/v1/nutrition/plans/:id — update a plan
router.put('/plans/:id', auth, async (req, res) => {
  const { plan_name, daily_calories, notes } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE nutrition_plans
       SET plan_name=COALESCE($1,plan_name),
           daily_calories=$2,
           notes=$3
       WHERE id=$4 AND user_id=$5
       RETURNING *`,
      [plan_name, daily_calories || null, notes || null, req.params.id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Plan not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update plan' });
  }
});

// DELETE /api/v1/nutrition/plans/:id
router.delete('/plans/:id', auth, async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM nutrition_plans WHERE id=$1 AND user_id=$2`,
      [req.params.id, req.user.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Plan not found' });
    res.json({ deleted: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete plan' });
  }
});

// GET /api/v1/nutrition/foods?q=chicken — search food database
router.get('/foods', auth, async (req, res) => {
  const search = (req.query.q || '').trim();
  try {
    if (search.length < 2) {
      const { rows } = await pool.query(
        `SELECT * FROM pet_foods ORDER BY name ASC LIMIT 50`
      );
      return res.json(rows);
    }
    const { rows } = await pool.query(
      `SELECT * FROM pet_foods
       WHERE name ILIKE $1 OR category ILIKE $1
       ORDER BY name ASC LIMIT 30`,
      [`%${search}%`]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to search foods' });
  }
});

module.exports = router;
