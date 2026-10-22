// routes/emergency.js
const express = require('express');
const router  = express.Router();
const { pool } = require('../db');
const auth    = require('../middleware/auth');

// GET /api/v1/emergency/alerts
router.get('/alerts', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, type, title, message, area, severity, created_at
       FROM emergency_alerts
       WHERE is_active = TRUE
       ORDER BY created_at DESC
       LIMIT 20`
    );
    res.json({ data: rows });
  } catch (err) {
    // Table may not exist yet — return empty gracefully
    res.json({ data: [] });
  }
});

// POST /api/v1/emergency/alerts — report an emergency
router.post('/alerts', auth, async (req, res) => {
  const { type, title, message, area, severity, lat, lng } = req.body;
  if (!type || !title || !message) {
    return res.status(400).json({ error: 'type, title, and message are required' });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO emergency_alerts
         (user_id, type, title, message, area, severity, lat, lng)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.user.id, type, title, message, area || null,
       severity || 'medium', lat || null, lng || null]
    );
    res.status(201).json({ data: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create alert' });
  }
});

// GET /api/v1/emergency/vets — nearest emergency vets (static fallback)
router.get('/vets', auth, async (req, res) => {
  res.json({
    data: [],
    message: 'Connect to a vet directory service for live data'
  });
});

module.exports = router;
