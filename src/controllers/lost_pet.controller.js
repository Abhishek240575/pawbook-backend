const { query, getClient } = require('../config/db');
const R = require('../utils/response');

// ── REPORT LOST PET ───────────────────────────────────────────
const reportLostPet = async (req, res, next) => {
  const {
    pet_name, species, breed, age, color, collar,
    description, area, date_last_seen, time_last_seen,
    alert_radius, lat, lng,
    contact_name, contact_phone, contact_email,
    photos = []
  } = req.body;

  try {
    if (!pet_name || !species || !contact_phone)
      return R.badRequest(res, 'pet_name, species, contact_phone are required');

    const { rows } = await query(
      `INSERT INTO lost_pet_reports
         (user_id, pet_name, species, breed, age, color, collar,
          description, area, date_last_seen, time_last_seen,
          alert_radius, lat, lng,
          contact_name, contact_phone, contact_email, photos, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'active')
       RETURNING *`,
      [req.user.user_id, pet_name, species, breed || null,
       age || null, color || null, collar || null,
       description || null, area || null,
       date_last_seen || null, time_last_seen || null,
       alert_radius || null, lat || null, lng || null,
       contact_name || null, contact_phone, contact_email || null,
       photos.length ? photos : null]
    );
    return R.created(res, rows[0], 'Lost pet alert created');
  } catch (err) { next(err); }
};

// ── LIST ALERTS ───────────────────────────────────────────────
const getAlerts = async (req, res, next) => {
  const { status = 'active', species, limit = 20, offset = 0 } = req.query;
  try {
    let where = `WHERE a.status = $1`;
    const params = [status];
    let i = 2;

    if (species) { where += ` AND LOWER(a.species) = LOWER($${i++})`; params.push(species); }

    params.push(parseInt(limit), parseInt(offset));

    const { rows } = await query(
      `SELECT a.*,
              u.username AS reporter_username, u.avatar_url AS reporter_avatar
         FROM lost_pet_reports a
         JOIN users u ON u.user_id = a.user_id
        ${where}
        ORDER BY a.created_at DESC
        LIMIT $${i++} OFFSET $${i}`,
      params
    );

    const { rows: [{ total }] } = await query(
      `SELECT COUNT(*) AS total FROM lost_pet_reports a ${where}`,
      params.slice(0, params.length - 2)
    );

    return R.ok(res, { alerts: rows, total: parseInt(total), limit: parseInt(limit), offset: parseInt(offset) });
  } catch (err) { next(err); }
};

// ── ALERT DETAIL ──────────────────────────────────────────────
const getAlert = async (req, res, next) => {
  const { alert_id } = req.params;
  try {
    const { rows } = await query(
      `SELECT a.*,
              u.username AS reporter_username, u.full_name AS reporter_name,
              u.avatar_url AS reporter_avatar
         FROM lost_pet_reports a
         JOIN users u ON u.user_id = a.user_id
        WHERE a.id = $1`,
      [alert_id]
    );
    if (!rows.length) return R.notFound(res, 'Alert not found');
    return R.ok(res, rows[0]);
  } catch (err) { next(err); }
};

// ── UPDATE ALERT STATUS ───────────────────────────────────────
const updateAlert = async (req, res, next) => {
  const { alert_id } = req.params;
  const { status } = req.body;
  const VALID = ['active', 'found', 'closed'];
  if (!VALID.includes(status))
    return R.badRequest(res, `status must be one of: ${VALID.join(', ')}`);
  try {
    const { rows } = await query(
      `UPDATE lost_pet_reports
          SET status = $1, updated_at = NOW()
        WHERE id = $2 AND user_id = $3
        RETURNING *`,
      [status, alert_id, req.user.user_id]
    );
    if (!rows.length) return R.notFound(res, 'Alert not found or not yours');
    return R.ok(res, rows[0], 'Alert updated');
  } catch (err) { next(err); }
};

// ── MY ALERTS ─────────────────────────────────────────────────
const getMyAlerts = async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT * FROM lost_pet_reports
        WHERE user_id = $1
        ORDER BY created_at DESC`,
      [req.user.user_id]
    );
    return R.ok(res, rows);
  } catch (err) { next(err); }
};

// stubs removed — reportSighting not supported by current schema
const reportSighting = async (req, res) =>
  R.badRequest(res, 'Sighting reporting not available yet');

module.exports = { reportLostPet, getAlerts, getAlert, reportSighting, updateAlert, getMyAlerts };
