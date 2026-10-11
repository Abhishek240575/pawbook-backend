// routes/lostPets.js — PawBook Lost Pet API
const express = require('express');
const router  = express.Router();
const pool    = require('../db');

// ── Auth middleware ──────────────────────────────────────────
function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const jwt = require('jsonwebtoken');
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// Optional auth — passes through even without token
function optionalAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.replace('Bearer ', '').trim();
  if (token) {
    try {
      const jwt = require('jsonwebtoken');
      req.user = jwt.verify(token, process.env.JWT_SECRET);
    } catch {}
  }
  next();
}

// ── GET /api/lost-pets ───────────────────────────────────────
// Public — list active lost pet alerts (newest first)
router.get('/', optionalAuth, async (req, res) => {
  try {
    const { area, species, limit = 20, offset = 0 } = req.query;
    let query = `
      SELECT id, pet_name, species, breed, age, color, collar, description,
             area, date_last_seen, time_last_seen, alert_radius,
             contact_name, contact_phone, contact_email,
             photos, status, created_at
      FROM lost_pet_reports
      WHERE status = 'lost'
    `;
    const params = [];
    if (area) {
      params.push(`%${area}%`);
      query += ` AND area ILIKE $${params.length}`;
    }
    if (species) {
      params.push(species);
      query += ` AND species = $${params.length}`;
    }
    params.push(parseInt(limit));
    params.push(parseInt(offset));
    query += ` ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`;

    const { rows } = await pool.query(query, params);
    res.json({ reports: rows });
  } catch (err) {
    console.error('GET /lost-pets error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/lost-pets/:id ───────────────────────────────────
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

    const { rows } = await pool.query(
      `SELECT * FROM lost_pet_reports WHERE id = $1`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Report not found' });
    res.json({ report: rows[0] });
  } catch (err) {
    console.error('GET /lost-pets/:id error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/lost-pets ──────────────────────────────────────
// Submit a new lost pet report (auth required)
router.post('/', auth, async (req, res) => {
  try {
    const {
      pet_name, species, breed, age, color, collar, description,
      area, date_last_seen, time_last_seen, alert_radius,
      contact_name, contact_phone, contact_email,
      photos, lat, lng
    } = req.body;

    if (!pet_name || !species || !area || !date_last_seen || !contact_name || !contact_phone) {
      return res.status(400).json({
        error: 'pet_name, species, area, date_last_seen, contact_name, and contact_phone are required'
      });
    }

    const userId = req.user.id || req.user.user_id || null;

    const { rows } = await pool.query(
      `INSERT INTO lost_pet_reports
         (user_id, pet_name, species, breed, age, color, collar, description,
          area, date_last_seen, time_last_seen, alert_radius,
          contact_name, contact_phone, contact_email,
          photos, lat, lng)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       RETURNING *`,
      [
        userId, pet_name, species,
        breed || null, age || null, color || null, collar || null, description || null,
        area, date_last_seen,
        time_last_seen || null, alert_radius || '2 km',
        contact_name, contact_phone, contact_email || null,
        JSON.stringify(photos || []),
        lat || null, lng || null
      ]
    );

    res.status(201).json({ success: true, report: rows[0] });
  } catch (err) {
    console.error('POST /lost-pets error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── PATCH /api/lost-pets/:id/status ─────────────────────────
// Mark as found or withdraw (owner only)
router.patch('/:id/status', auth, async (req, res) => {
  try {
    const id     = parseInt(req.params.id);
    const { status } = req.body;
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    if (!['lost','found','withdrawn'].includes(status)) {
      return res.status(400).json({ error: 'status must be lost, found, or withdrawn' });
    }

    const userId = req.user.id || req.user.user_id;
    const { rows } = await pool.query(
      `UPDATE lost_pet_reports
       SET status = $1, updated_at = NOW()
       WHERE id = $2 AND user_id = $3
       RETURNING *`,
      [status, id, userId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Report not found or not yours' });
    res.json({ success: true, report: rows[0] });
  } catch (err) {
    console.error('PATCH /lost-pets/:id/status error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── DELETE /api/lost-pets/:id ────────────────────────────────
// Hard delete (owner only)
router.delete('/:id', auth, async (req, res) => {
  try {
    const id     = parseInt(req.params.id);
    const userId = req.user.id || req.user.user_id;
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

    await pool.query(
      `DELETE FROM lost_pet_reports WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /lost-pets/:id error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
