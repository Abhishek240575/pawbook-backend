const { query, getClient } = require('../config/db');
const R = require('../utils/response');

// ── VET DIRECTORY ─────────────────────────────────────────────
const getVets = async (req, res, next) => {
  const { page, limit, offset } = req.pagination;
  const { city, verified, online } = req.query;
  try {
    let where = `WHERE 1=1`;
    const params = [];
    let i = 1;

    if (city) {
      where += ` AND city ILIKE $${i++}`;
      params.push(`%${city}%`);
    }
    if (verified === 'true') {
      where += ` AND is_verified = TRUE`;
    }
    if (online === 'true') {
      where += ` AND is_online = TRUE`;
    }

    const { rows: data } = await query(
      `SELECT * FROM v_vet_directory ${where}
        ORDER BY avg_rating DESC NULLS LAST,
                 total_consultations DESC
        LIMIT $${i++} OFFSET $${i}`,
      [...params, limit, offset]
    );
    const { rows: [{ total }] } = await query(
      `SELECT COUNT(*) AS total FROM v_vet_directory ${where}`,
      params
    );
    return R.paginated(res, data, { page, limit, total: parseInt(total) });
  } catch (err) { next(err); }
};

// ── NEARBY VETS ───────────────────────────────────────────────
const getNearbyVets = async (req, res, next) => {
  const { lat, lng, km = 10 } = req.query;
  if (!lat || !lng)
    return R.badRequest(res, 'lat and lng are required');
  try {
    const { rows } = await query(
      `SELECT * FROM fn_nearby_vets($1, $2, $3)`,
      [parseFloat(lat), parseFloat(lng), parseFloat(km)]
    );
    return R.ok(res, rows);
  } catch (err) { next(err); }
};

// ── VET PROFILE ───────────────────────────────────────────────
const getVetProfile = async (req, res, next) => {
  const { user_id } = req.params;
  try {
    const { rows } = await query(
      `SELECT * FROM v_vet_directory WHERE user_id = $1`,
      [user_id]
    );
    if (!rows.length) return R.notFound(res, 'Vet not found');
    return R.ok(res, rows[0]);
  } catch (err) { next(err); }
};

// ── BOOK APPOINTMENT ─────────────────────────────────────────
const bookAppointment = async (req, res, next) => {
  const {
    vet_id, pet_id, appointment_type = 'teleconsult',
    scheduled_at, chief_complaint, fee_inr
  } = req.body;

  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Verify vet exists and is active
    const vet = await client.query(
      `SELECT user_id FROM "User"
        WHERE user_id = $1 AND role = 'vet'
          AND status = 'active' AND deleted_at IS NULL`,
      [vet_id]
    );
    if (!vet.rows.length)
      return R.notFound(res, 'Vet not found or unavailable');

    // Verify pet belongs to current user
    const pet = await client.query(
      `SELECT pet_id FROM "Pet"
        WHERE pet_id = $1 AND owner_id = $2 AND deleted_at IS NULL`,
      [pet_id, req.user.user_id]
    );
    if (!pet.rows.length)
      return R.forbidden(res, 'Pet not found or not yours');

    // Check for double-booking in same 30-min slot
    const conflict = await client.query(
      `SELECT appointment_id FROM "VetAppointment"
        WHERE vet_id = $1
          AND status IN ('scheduled','confirmed')
          AND scheduled_at BETWEEN $2::TIMESTAMPTZ - INTERVAL '30 min'
                               AND $2::TIMESTAMPTZ + INTERVAL '30 min'`,
      [vet_id, scheduled_at]
    );
    if (conflict.rows.length)
      return R.conflict(res, 'Vet is not available at that time');

    const { rows } = await client.query(
      `INSERT INTO "VetAppointment"
         (pet_id, owner_id, vet_id, appointment_type,
          scheduled_at, chief_complaint, fee_inr)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [pet_id, req.user.user_id, vet_id, appointment_type,
       scheduled_at, chief_complaint || null, fee_inr]
    );

    // Notify vet
    await client.query(
      `INSERT INTO "Notification"
         (recipient_id, sender_id, type, title, body,
          ref_table, ref_id)
       VALUES ($1,$2,'appointment_request',
               'New appointment request',
               'A pet owner has booked a consultation with you.',
               'VetAppointment',$3)`,
      [vet_id, req.user.user_id, rows[0].appointment_id]
    );

    await client.query('COMMIT');
    return R.created(res, rows[0], 'Appointment booked');
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};

// ── MY APPOINTMENTS (owner) ───────────────────────────────────
const getMyAppointments = async (req, res, next) => {
  const { page, limit, offset } = req.pagination;
  const { status } = req.query;
  try {
    const params = [req.user.user_id, limit, offset];
    const statusFilter = status ? `AND a.status = '${status}'` : '';

    const { rows: data } = await query(
      `SELECT a.*,
              p.name      AS pet_name,   p.species,  p.avatar_url AS pet_avatar,
              v.full_name AS vet_name,   v.avatar_url AS vet_avatar,
              v.username  AS vet_username
         FROM "VetAppointment" a
         JOIN "Pet"  p ON p.pet_id   = a.pet_id
         JOIN "User" v ON v.user_id  = a.vet_id
        WHERE a.owner_id = $1 ${statusFilter}
        ORDER BY a.scheduled_at DESC
        LIMIT $2 OFFSET $3`,
      params
    );
    const { rows: [{ total }] } = await query(
      `SELECT COUNT(*) AS total FROM "VetAppointment"
        WHERE owner_id = $1 ${statusFilter}`,
      [req.user.user_id]
    );
    return R.paginated(res, data, { page, limit, total: parseInt(total) });
  } catch (err) { next(err); }
};

// ── VET'S APPOINTMENTS ────────────────────────────────────────
const getVetAppointments = async (req, res, next) => {
  const { page, limit, offset } = req.pagination;
  const { status, date } = req.query;
  try {
    let where = `WHERE a.vet_id = $1`;
    const params = [req.user.user_id];
    let i = 2;

    if (status) { where += ` AND a.status = $${i++}`; params.push(status); }
    if (date)   {
      where += ` AND a.scheduled_at::DATE = $${i++}`;
      params.push(date);
    }

    const { rows: data } = await query(
      `SELECT a.*,
              p.name     AS pet_name,  p.species, p.avatar_url AS pet_avatar,
              o.full_name AS owner_name, o.avatar_url AS owner_avatar,
              o.phone    AS owner_phone
         FROM "VetAppointment" a
         JOIN "Pet"  p ON p.pet_id  = a.pet_id
         JOIN "User" o ON o.user_id = a.owner_id
        ${where}
        ORDER BY a.scheduled_at ASC
        LIMIT $${i++} OFFSET $${i}`,
      [...params, limit, offset]
    );
    const { rows: [{ total }] } = await query(
      `SELECT COUNT(*) AS total FROM "VetAppointment" ${where}`,
      params
    );
    return R.paginated(res, data, { page, limit, total: parseInt(total) });
  } catch (err) { next(err); }
};

// ── UPDATE APPOINTMENT STATUS ─────────────────────────────────
const updateAppointment = async (req, res, next) => {
  const { appointment_id } = req.params;
  const { status, vet_notes, diagnosis, follow_up_date } = req.body;
  const VALID = ['confirmed','in_progress','completed','cancelled','no_show'];
  if (!VALID.includes(status))
    return R.badRequest(res, `status must be one of: ${VALID.join(', ')}`);
  try {
    const appt = await query(
      `SELECT vet_id, owner_id, status AS current_status
         FROM "VetAppointment"
        WHERE appointment_id = $1`,
      [appointment_id]
    );
    if (!appt.rows.length)
      return R.notFound(res, 'Appointment not found');

    const a = appt.rows[0];
    // Only vet or owner (cancel only) can update
    if (req.user.user_id !== a.vet_id) {
      if (req.user.user_id !== a.owner_id)
        return R.forbidden(res, 'Not your appointment');
      if (status !== 'cancelled')
        return R.forbidden(res, 'Owners can only cancel appointments');
    }

    const { rows } = await query(
      `UPDATE "VetAppointment"
          SET status         = $1,
              vet_notes      = COALESCE($2, vet_notes),
              diagnosis      = COALESCE($3, diagnosis),
              follow_up_date = COALESCE($4, follow_up_date),
              updated_at     = NOW()
        WHERE appointment_id = $5
        RETURNING *`,
      [status, vet_notes, diagnosis, follow_up_date, appointment_id]
    );

    // Notify owner of status change
    await query(
      `INSERT INTO "Notification"
         (recipient_id, sender_id, type, title, ref_table, ref_id)
       VALUES ($1,$2,'appointment_update',
               'Appointment status: ' || $3,
               'VetAppointment', $4)`,
      [a.owner_id, req.user.user_id, status, appointment_id]
    );

    return R.ok(res, rows[0], 'Appointment updated');
  } catch (err) { next(err); }
};

// ── RATE APPOINTMENT ──────────────────────────────────────────
const rateAppointment = async (req, res, next) => {
  const { appointment_id } = req.params;
  const { rating, review } = req.body;
  if (!rating || rating < 1 || rating > 5)
    return R.badRequest(res, 'Rating must be between 1 and 5');
  try {
    const { rows } = await query(
      `UPDATE "VetAppointment"
          SET rating = $1, review = $2, updated_at = NOW()
        WHERE appointment_id = $3
          AND owner_id = $4
          AND status = 'completed'
        RETURNING appointment_id, rating`,
      [rating, review || null, appointment_id, req.user.user_id]
    );
    if (!rows.length)
      return R.notFound(res, 'Appointment not found or not completed');
    return R.ok(res, rows[0], 'Rating submitted');
  } catch (err) { next(err); }
};

module.exports = {
  getVets, getNearbyVets, getVetProfile,
  bookAppointment, getMyAppointments,
  getVetAppointments, updateAppointment, rateAppointment
};
