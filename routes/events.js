// routes/events.js — Pet Community Events
// Matches actual Neon schema: events.event_id (UUID), events.user_id (UUID)
const express = require('express');
const router  = express.Router();
const { pool } = require('../db');
const auth    = require('../middleware/auth');

// GET /api/v1/events
router.get('/', auth, async (req, res) => {
  const { limit = 20, offset = 0 } = req.query;
  try {
    const { rows } = await pool.query(
      `SELECT e.*,
              u.username AS organizer_name, u.avatar_url AS organizer_avatar,
              (SELECT COUNT(*)::int FROM event_rsvps
               WHERE event_id=e.event_id AND status='going') AS going_count,
              (SELECT status FROM event_rsvps
               WHERE event_id=e.event_id AND user_id=$1) AS my_rsvp
       FROM events e
       JOIN users u ON u.user_id = e.user_id
       WHERE e.event_date >= CURRENT_DATE
         AND (e.status IS NULL OR e.status != 'cancelled')
       ORDER BY e.event_date ASC
       LIMIT $2 OFFSET $3`,
      [req.user.id, Number(limit), Number(offset)]
    );
    res.json({ data: rows });
  } catch (err) {
    console.error(err);
    res.json({ data: [] });
  }
});

// GET /api/v1/events/:id
router.get('/:id', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT e.*,
              u.username AS organizer_name, u.avatar_url AS organizer_avatar,
              (SELECT COUNT(*)::int FROM event_rsvps
               WHERE event_id=e.event_id AND status='going') AS going_count,
              (SELECT status FROM event_rsvps
               WHERE event_id=e.event_id AND user_id=$2) AS my_rsvp
       FROM events e
       JOIN users u ON u.user_id = e.user_id
       WHERE e.event_id=$1`,
      [req.params.id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Event not found' });
    res.json({ data: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load event' });
  }
});

// POST /api/v1/events — create event
router.post('/', auth, async (req, res) => {
  const { title, description, event_date, location,
          event_type, cover_image, max_attendees, entry_fee } = req.body;
  if (!title || !event_date) {
    return res.status(400).json({ error: 'title and event_date are required' });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO events
         (user_id, title, description, event_date, location,
          event_type, cover_image, max_attendees, entry_fee, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active') RETURNING *`,
      [req.user.id, title, description || null, event_date,
       location || null, event_type || 'general',
       cover_image || null, max_attendees || null, entry_fee || null]
    );
    // Auto-RSVP organizer
    await pool.query(
      `INSERT INTO event_rsvps (event_id, user_id, status)
       VALUES ($1,$2,'going') ON CONFLICT DO NOTHING`,
      [rows[0].event_id, req.user.id]
    ).catch(() => {});
    res.status(201).json({ data: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create event' });
  }
});

// POST /api/v1/events/:id/rsvp
router.post('/:id/rsvp', auth, async (req, res) => {
  const { status } = req.body;
  if (!['going', 'interested', 'none'].includes(status)) {
    return res.status(400).json({ error: 'status must be going|interested|none' });
  }
  try {
    if (status === 'none') {
      await pool.query(
        'DELETE FROM event_rsvps WHERE event_id=$1 AND user_id=$2',
        [req.params.id, req.user.id]
      );
    } else {
      await pool.query(
        `INSERT INTO event_rsvps (event_id, user_id, status)
         VALUES ($1,$2,$3)
         ON CONFLICT (event_id, user_id) DO UPDATE SET status=$3`,
        [req.params.id, req.user.id, status]
      );
    }
    res.json({ status });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update RSVP' });
  }
});

module.exports = router;
