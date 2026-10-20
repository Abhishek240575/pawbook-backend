/**
 * src/controllers/training.controller.js
 */
const db = require('../config/db');

/* GET /training/programs */
exports.getPrograms = async (req, res) => {
  try {
    const { category, difficulty } = req.query;
    let q = `SELECT * FROM training_programs WHERE is_active = TRUE`;
    const params = [];
    if (category)   { params.push(category);   q += ` AND category = $${params.length}`; }
    if (difficulty) { params.push(difficulty); q += ` AND difficulty = $${params.length}`; }
    q += ` ORDER BY difficulty, duration_weeks`;
    const { rows } = await db.query(q, params);
    res.json({ success: true, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

/* GET /training/programs/:id/lessons */
exports.getLessons = async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT * FROM training_lessons WHERE program_id = $1 ORDER BY lesson_order`,
      [req.params.id]
    );
    res.json({ success: true, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

/* GET /training/my — user's enrolled programs */
exports.getMy = async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT utp.*, tp.title, tp.category, tp.difficulty, tp.duration_weeks, tp.thumbnail_url
       FROM user_training_progress utp
       JOIN training_programs tp ON utp.program_id = tp.program_id
       WHERE utp.user_id = $1 ORDER BY utp.enrolled_at DESC`,
      [req.user.user_id]
    );
    res.json({ success: true, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

/* POST /training/enroll */
exports.enroll = async (req, res) => {
  try {
    const { program_id, pet_id } = req.body;
    if (!program_id) return res.status(400).json({ success: false, message: 'program_id is required' });
    const existing = await db.query(
      `SELECT id FROM user_training_progress WHERE user_id = $1 AND program_id = $2`,
      [req.user.user_id, program_id]
    );
    if (existing.rows.length) return res.status(409).json({ success: false, message: 'Already enrolled' });
    const { rows } = await db.query(
      `INSERT INTO user_training_progress (user_id, pet_id, program_id, status)
       VALUES ($1, $2, $3, 'enrolled') RETURNING *`,
      [req.user.user_id, pet_id || null, program_id]
    );
    res.status(201).json({ success: true, data: rows[0] });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

/* PATCH /training/progress/:id — update lesson progress */
exports.updateProgress = async (req, res) => {
  try {
    const { lesson_id, progress_pct, status } = req.body;
    const { rows } = await db.query(
      `UPDATE user_training_progress
       SET lesson_id = COALESCE($1, lesson_id),
           progress_pct = COALESCE($2, progress_pct),
           status = COALESCE($3, status),
           completed_at = CASE WHEN $3 = 'completed' THEN NOW() ELSE completed_at END
       WHERE id = $4 AND user_id = $5 RETURNING *`,
      [lesson_id || null, progress_pct || null, status || null, req.params.id, req.user.user_id]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Progress record not found' });
    res.json({ success: true, data: rows[0] });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};
