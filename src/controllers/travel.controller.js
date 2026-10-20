/**
 * src/controllers/travel.controller.js
 */
const db = require('../config/db');

/* GET /travel/destinations */
exports.getDestinations = async (req, res) => {
  try {
    const { category, state, search } = req.query;
    let q = `SELECT * FROM travel_destinations WHERE is_active = TRUE AND pet_friendly = TRUE`;
    const params = [];
    if (category) { params.push(category); q += ` AND category = $${params.length}`; }
    if (state)    { params.push(state);    q += ` AND state ILIKE $${params.length}`; }
    if (search)   { params.push('%' + search + '%'); q += ` AND (name ILIKE $${params.length} OR city ILIKE $${params.length} OR description ILIKE $${params.length})`; }
    q += ` ORDER BY rating DESC`;
    const { rows } = await db.query(q, params);
    res.json({ success: true, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

/* GET /travel/destinations/:id */
exports.getDestination = async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT * FROM travel_destinations WHERE dest_id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Destination not found' });
    res.json({ success: true, data: rows[0] });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

/* GET /travel/saved — user's saved destinations */
exports.getMySaved = async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT uts.*, td.name, td.city, td.state, td.category, td.rating, td.image_url, td.description
       FROM user_travel_saves uts
       JOIN travel_destinations td ON uts.dest_id = td.dest_id
       WHERE uts.user_id = $1 ORDER BY uts.created_at DESC`,
      [req.user.user_id]
    );
    res.json({ success: true, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

/* POST /travel/save */
exports.saveDestination = async (req, res) => {
  try {
    const { dest_id, type, notes, visited_at } = req.body;
    if (!dest_id) return res.status(400).json({ success: false, message: 'dest_id is required' });
    const { rows } = await db.query(
      `INSERT INTO user_travel_saves (user_id, dest_id, type, notes, visited_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, dest_id) DO UPDATE
       SET type = $3, notes = COALESCE($4, user_travel_saves.notes), visited_at = $5
       RETURNING *`,
      [req.user.user_id, dest_id, type || 'saved', notes || null, visited_at || null]
    );
    res.status(201).json({ success: true, data: rows[0] });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

/* DELETE /travel/save/:dest_id */
exports.unsaveDestination = async (req, res) => {
  try {
    await db.query(
      `DELETE FROM user_travel_saves WHERE user_id = $1 AND dest_id = $2`,
      [req.user.user_id, req.params.dest_id]
    );
    res.json({ success: true, message: 'Removed from saved' });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};
