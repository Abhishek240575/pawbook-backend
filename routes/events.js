// routes/events.js — Pet Community Events
const express = require('express');
const router  = express.Router();
const { pool } = require('../db');
const auth    = require('../middleware/auth');

// GET /api/v1/events
router.get('/', auth, async (req, res) => {
  const { city, category, limit = 20, offset = 0 } = req.query;
  const conditions = ['e.event_date >= CURRENT_DATE'];
  const params = [];
  let idx = 1;

  if (city)     { conditions.push(`e.city ILIKE $${idx++}`);     params.push(`%${city}%`); }
  if (category) { conditions.push(`e.category = $${idx++}`);     params.push(category); }

  const where = 'WHERE ' + conditions.join(' AND ');
  params.push(Number(limit), Number(offset));

  try {
    const { rows } = await pool.query(
      `SELECT e.*,
              u.name AS organizer_name, u.avatar AS organizer_avatar,
              (SELECT COUNT(*)::int FROM event_rsvps
               WHERE event_id=e.id AND status='going') AS going_count,
              (SELECT status FROM event_rsvps
               WHERE event_id=e.id AND user_id=$${idx}) AS my_rsvp
       FROM events e
       JOIN users u ON u.id = e.organizer_id
       ${where}
       ORDER BY e.event_date ASC
       LIMIT $${idx+1} OFFSET $${idx+2}`,
      [req.user.id, ...params]
    );
    res.json({ data: rows });
  } catch (err) {
    res.json({ data: [] }); // graceful if table missing
  }
});

// GET /api/v1/events/:id
router.get('/:id', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT e.*,
              u.name AS organizer_name, u.avatar AS organizer_avatar,
              (SELECT COUNT(*)::int FROM event_rsvps WHERE event_id=e.id AND status='going') AS going_count,
              (SELECT status FROM event_rsvps WHERE event_id=e.id AND user_id=$2) AS my_rsvp
       FROM events e
       JOIN users u ON u.id = e.organizer_id
       WHERE e.id=$1`,
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
  const { title, description, event_date, event_time, location, city,
          category, cover_image, max_attendees, is_online, meet_link } = req.body;
  if (!title || !event_date) {
    return res.status(400).json({ error: 'title and event_date are required' });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO events
         (organizer_id, title, description, event_date, event_time,
          location, city, category, cover_image, max_attendees, is_online, meet_link)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [req.user.id, title, description || null, event_date,
       event_time || null, location || null, city || null,
       category || 'general', cover_image || null,
       max_attendees || null, is_online || false, meet_link || null]
    );
    // Auto-RSVP organizer
    await pool.query(
      `INSERT INTO event_rsvps (event_id, user_id, status) VALUES ($1,$2,'going')
       ON CONFLICT DO NOTHING`,
      [rows[0].id, req.user.id]
    ).catch(() => {});
    res.status(201).json({ data: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create event' });
  }
});

// POST /api/v1/events/:id/rsvp
router.post('/:id/rsvp', auth, async (req, res) => {
  const { status } = req.body; // 'going' | 'interested' | 'none'
  if (!['going','interested','none'].includes(status)) {
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
