'use strict';
/**
 * training.controller.js
 * Drop into: src/controllers/training.controller.js
 */

const { query: dbQuery } = require('../config/db');

/* ─────────────────────────────────────────────────────────────
   GET /api/v1/training/sessions
   Query: level ('basic'|'advanced'|'all'), limit, offset
───────────────────────────────────────────────────────────── */
exports.getSessions = async (req, res, next) => {
  try {
    const { level } = req.query;
    const limit  = Math.min(parseInt(req.query.limit)  || 20, 50);
    const offset = Math.max(parseInt(req.query.offset) || 0,  0);

    const conditions = ['is_active = TRUE'];
    const params = [];
    if (level && level !== 'all') {
      params.push(level);
      conditions.push(`level = $${params.length}`);
    }

    params.push(limit, offset);
    const { rows } = await dbQuery(
      `SELECT * FROM training_sessions
        WHERE ${conditions.join(' AND ')}
        ORDER BY sort_order, id
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return res.json({ success: true, data: rows });
  } catch (err) { next(err); }
};

/* ─────────────────────────────────────────────────────────────
   GET /api/v1/training/trainers
───────────────────────────────────────────────────────────── */
exports.getTrainers = async (req, res, next) => {
  try {
    const { rows } = await dbQuery(
      `SELECT * FROM training_trainers WHERE is_active = TRUE ORDER BY sort_order, id`
    );
    return res.json({ success: true, data: rows });
  } catch (err) { next(err); }
};

/* ─────────────────────────────────────────────────────────────
   POST /api/v1/training/bookings   (auth required)
   Body: trainer_name, specialty, session_date, session_time,
         session_type, pet_name, price_inr
───────────────────────────────────────────────────────────── */
exports.createBooking = async (req, res, next) => {
  try {
    const uid = req.user.user_id;
    const { trainer_name, specialty, session_date, session_time, session_type, pet_name, price_inr } = req.body;

    const { rows } = await dbQuery(
      `INSERT INTO training_bookings(user_id, trainer_name, specialty, session_date, session_time, session_type, pet_name, price_inr)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [uid, trainer_name, specialty || null, session_date || null, session_time || null,
       session_type || 'video', pet_name || null, price_inr || null]
    );
    return res.status(201).json({ success: true, data: rows[0] });
  } catch (err) { next(err); }
};

/* ─────────────────────────────────────────────────────────────
   GET /api/v1/training/bookings   (auth required)
───────────────────────────────────────────────────────────── */
exports.getMyBookings = async (req, res, next) => {
  try {
    const uid = req.user.user_id;
    const { rows } = await dbQuery(
      `SELECT * FROM training_bookings
        WHERE user_id = $1
        ORDER BY booked_at DESC LIMIT 20`,
      [uid]
    );
    return res.json({ success: true, data: rows });
  } catch (err) { next(err); }
};

/* ─────────────────────────────────────────────────────────────
   POST /api/v1/training/progress   (auth required)
   Body: session_id (optional), session_title, duration_watched_sec
───────────────────────────────────────────────────────────── */
exports.saveProgress = async (req, res, next) => {
  try {
    const uid = req.user.user_id;
    const { session_id, session_title, duration_watched_sec } = req.body;

    const { rows } = await dbQuery(
      `INSERT INTO user_training_progress(user_id, session_id, session_title, duration_watched_sec)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [uid, session_id || null, session_title || null, duration_watched_sec || 0]
    );
    return res.status(201).json({ success: true, data: rows[0] });
  } catch (err) { next(err); }
};

/* ─────────────────────────────────────────────────────────────
   GET /api/v1/training/progress   (auth required)
───────────────────────────────────────────────────────────── */
exports.getMyProgress = async (req, res, next) => {
  try {
    const uid = req.user.user_id;
    const { rows } = await dbQuery(
      `SELECT session_title, COUNT(*) AS completions, MAX(completed_at) AS last_completed
         FROM user_training_progress
         WHERE user_id = $1
         GROUP BY session_title
         ORDER BY last_completed DESC`,
      [uid]
    );
    return res.json({ success: true, data: rows, total: rows.length });
  } catch (err) { next(err); }
};
