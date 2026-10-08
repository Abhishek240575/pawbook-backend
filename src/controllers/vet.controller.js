const pool = require('../config/db');
const R = require('../utils/response');

// ── GET /api/v1/vets ──────────────────────────────────────────────────────────
async function listVets(req, res) {
  try {
    const { city, specialty, type, minRating, maxFee, q, limit = 20, offset = 0 } = req.query;
    const params = ['active'];
    let where = `WHERE v.status = $1`;

    if (city)      { params.push(`%${city}%`);      where += ` AND v.city ILIKE $${params.length}`; }
    if (specialty) { params.push(`%${specialty}%`); where += ` AND (v.primary_specialty ILIKE $${params.length} OR $${params.length} = ANY(v.specialties))`; }
    if (type)      { params.push(type);              where += ` AND $${params.length} = ANY(v.consult_types)`; }
    if (minRating) { params.push(minRating);         where += ` AND v.rating >= $${params.length}`; }
    if (maxFee)    { params.push(maxFee);            where += ` AND v.consultation_fee <= $${params.length}`; }
    if (q)         { params.push(`%${q}%`);          where += ` AND (v.first_name ILIKE $${params.length} OR v.last_name ILIKE $${params.length} OR v.clinic_name ILIKE $${params.length})`; }

    params.push(limit, offset);
    const { rows } = await pool.query(
      `SELECT v.vet_id, v.first_name, v.last_name, v.city, v.clinic_name,
              v.primary_specialty, v.specialties, v.animals_treated, v.consult_types,
              v.consultation_fee, v.experience_years, v.rating, v.review_count,
              v.available_days, v.available_from, v.available_until,
              v.bio, v.avatar_url, v.languages
       FROM vets v
       ${where}
       ORDER BY v.rating DESC, v.review_count DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return R.ok(res, { items: rows, total: rows.length });
  } catch (err) { return R.serverError(res, err.message); }
}

// ── GET /api/v1/vets/:id ──────────────────────────────────────────────────────
async function getVet(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT v.*,
              COALESCE(json_agg(r ORDER BY r.created_at DESC) FILTER (WHERE r.review_id IS NOT NULL), '[]') as reviews
       FROM vets v
       LEFT JOIN vet_reviews r ON r.vet_id = v.vet_id
       WHERE v.vet_id = $1 AND v.status = 'active'
       GROUP BY v.vet_id`,
      [req.params.id]
    );
    if (!rows.length) return R.notFound(res, 'Vet not found');
    return R.ok(res, rows[0]);
  } catch (err) { return R.serverError(res, err.message); }
}

// ── GET /api/v1/vets/:id/slots ────────────────────────────────────────────────
async function getVetSlots(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT slot_id, slot_date, slot_time, duration
       FROM vet_availability
       WHERE vet_id = $1 AND is_booked = FALSE AND slot_date >= CURRENT_DATE
             AND slot_date <= CURRENT_DATE + INTERVAL '14 days'
       ORDER BY slot_date, slot_time`,
      [req.params.id]
    );
    return R.ok(res, rows);
  } catch (err) { return R.serverError(res, err.message); }
}

// ── POST /api/v1/appointments ─────────────────────────────────────────────────
// Uses vet_appointments table (separate from the existing appointments table)
async function bookAppointment(req, res) {
  const client = await pool.connect();
  try {
    const { vet_id, pet_id, slot_id, appt_date, appt_time,
            consult_type, reason } = req.body;
    if (!vet_id || !appt_date || !appt_time || !consult_type)
      return R.badRequest(res, 'vet_id, appt_date, appt_time, consult_type are required');

    await client.query('BEGIN');

    const { rows: vetRows } = await client.query(
      `SELECT vet_id, consultation_fee FROM vets WHERE vet_id = $1 AND status = 'active'`,
      [vet_id]
    );
    if (!vetRows.length) { await client.query('ROLLBACK'); return R.badRequest(res, 'Vet not found or inactive'); }

    if (slot_id) {
      const { rows: slotRows } = await client.query(
        `UPDATE vet_availability SET is_booked = TRUE
         WHERE slot_id = $1 AND vet_id = $2 AND is_booked = FALSE
         RETURNING slot_id`,
        [slot_id, vet_id]
      );
      if (!slotRows.length) { await client.query('ROLLBACK'); return R.conflict(res, 'Slot is no longer available'); }
    }

    const meet_link = consult_type === 'Video'
      ? `https://meet.pawbook.app/room/${Math.random().toString(36).slice(2, 10)}`
      : null;

    const { rows } = await client.query(
      `INSERT INTO vet_appointments
         (user_id, vet_id, pet_id, slot_id, appt_date, appt_time,
          consult_type, reason, fee_paid, meet_link)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [req.user.user_id, vet_id, pet_id || null, slot_id || null,
       appt_date, appt_time, consult_type, reason || null,
       vetRows[0].consultation_fee, meet_link]
    );

    await client.query('COMMIT');
    return R.created(res, rows[0], 'Appointment booked');
  } catch (err) {
    await client.query('ROLLBACK');
    return R.serverError(res, err.message);
  } finally { client.release(); }
}

// ── GET /api/v1/appointments ──────────────────────────────────────────────────
async function getAppointments(req, res) {
  try {
    const { status } = req.query;
    const params = [req.user.user_id];
    let filter = '';
    if (status) { params.push(status); filter = `AND a.status = $${params.length}`; }

    const { rows } = await pool.query(
      `SELECT a.*,
              v.first_name || ' ' || v.last_name AS vet_name,
              v.primary_specialty, v.avatar_url AS vet_avatar,
              v.clinic_name,
              p.name AS pet_name, p.species AS pet_species
       FROM vet_appointments a
       JOIN vets v ON a.vet_id = v.vet_id
       LEFT JOIN pets p ON a.pet_id = p.id
       WHERE a.user_id = $1 ${filter}
       ORDER BY a.appt_date DESC, a.appt_time DESC`,
      params
    );
    return R.ok(res, rows);
  } catch (err) { return R.serverError(res, err.message); }
}

// ── GET /api/v1/appointments/:id ──────────────────────────────────────────────
async function getAppointment(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT a.*,
              v.first_name || ' ' || v.last_name AS vet_name,
              v.primary_specialty, v.avatar_url AS vet_avatar,
              v.phone AS vet_phone, v.clinic_name, v.clinic_address,
              p.name AS pet_name, p.species AS pet_species, p.avatar AS pet_avatar
       FROM vet_appointments a
       JOIN vets v ON a.vet_id = v.vet_id
       LEFT JOIN pets p ON a.pet_id = p.id
       WHERE a.appointment_id = $1 AND a.user_id = $2`,
      [req.params.id, req.user.user_id]
    );
    if (!rows.length) return R.notFound(res, 'Appointment not found');
    return R.ok(res, rows[0]);
  } catch (err) { return R.serverError(res, err.message); }
}

// ── PATCH /api/v1/appointments/:id ───────────────────────────────────────────
async function updateAppointment(req, res) {
  try {
    const { status, appt_date, appt_time, reason } = req.body;
    const { rows } = await pool.query(
      `UPDATE vet_appointments SET
         status     = COALESCE($1, status),
         appt_date  = COALESCE($2, appt_date),
         appt_time  = COALESCE($3, appt_time),
         reason     = COALESCE($4, reason),
         updated_at = NOW()
       WHERE appointment_id = $5 AND user_id = $6
         AND status = 'upcoming'
       RETURNING *`,
      [status || null, appt_date || null, appt_time || null, reason || null,
       req.params.id, req.user.user_id]
    );
    if (!rows.length) return R.notFound(res, 'Appointment not found or already completed/cancelled');
    if (status === 'cancelled' && rows[0].slot_id) {
      await pool.query(`UPDATE vet_availability SET is_booked = FALSE WHERE slot_id = $1`, [rows[0].slot_id]);
    }
    return R.ok(res, rows[0], 'Appointment updated');
  } catch (err) { return R.serverError(res, err.message); }
}

// ── GET /api/v1/prescriptions ────────────────────────────────────────────────
async function getPrescriptions(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT pr.*,
              v.first_name || ' ' || v.last_name AS vet_name,
              v.primary_specialty,
              p.name AS pet_name
       FROM prescriptions pr
       JOIN vets v ON pr.vet_id = v.vet_id
       LEFT JOIN pets p ON pr.pet_id = p.id
       WHERE pr.user_id = $1
       ORDER BY pr.created_at DESC`,
      [req.user.user_id]
    );
    return R.ok(res, rows);
  } catch (err) { return R.serverError(res, err.message); }
}

// ── GET /api/v1/prescriptions/:id ────────────────────────────────────────────
async function getPrescription(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT pr.*,
              v.first_name || ' ' || v.last_name AS vet_name,
              v.primary_specialty, v.avatar_url AS vet_avatar,
              v.clinic_name,
              p.name AS pet_name, p.species AS pet_species
       FROM prescriptions pr
       JOIN vets v ON pr.vet_id = v.vet_id
       LEFT JOIN pets p ON pr.pet_id = p.id
       WHERE pr.prescription_id = $1 AND pr.user_id = $2`,
      [req.params.id, req.user.user_id]
    );
    if (!rows.length) return R.notFound(res, 'Prescription not found');
    return R.ok(res, rows[0]);
  } catch (err) { return R.serverError(res, err.message); }
}

// ── POST /api/v1/vets/register ────────────────────────────────────────────────
async function registerVet(req, res) {
  try {
    const {
      first_name, last_name, email, phone, city, clinic_name, clinic_address,
      degree, university, passing_year, vci_number, state_council,
      primary_specialty, specialties, animals_treated, languages,
      experience_years, consultation_fee, available_days, available_from,
      available_until, consult_types, bio,
      doc_degree_url, doc_vci_url, doc_govid_url, doc_ppa_url, avatar_url
    } = req.body;

    if (!first_name || !last_name || !email || !vci_number || !primary_specialty)
      return R.badRequest(res, 'first_name, last_name, email, vci_number, primary_specialty are required');

    const { rows } = await pool.query(
      `INSERT INTO vets (
         first_name, last_name, email, phone, city, clinic_name, clinic_address,
         degree, university, passing_year, vci_number, state_council,
         primary_specialty, specialties, animals_treated, languages,
         experience_years, consultation_fee, available_days, available_from,
         available_until, consult_types, bio,
         doc_degree_url, doc_vci_url, doc_govid_url, doc_ppa_url, avatar_url,
         user_id, status
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
         $17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,'pending'
       ) RETURNING vet_id, first_name, last_name, email, status`,
      [
        first_name, last_name, email, phone || null, city || null,
        clinic_name || null, clinic_address || null,
        degree || null, university || null, passing_year || null,
        vci_number, state_council || null, primary_specialty,
        specialties || null, animals_treated || null, languages || null,
        experience_years || null, consultation_fee || 499,
        available_days || null, available_from || '09:00',
        available_until || '18:00', consult_types || null, bio || null,
        doc_degree_url || null, doc_vci_url || null,
        doc_govid_url || null, doc_ppa_url || null, avatar_url || null,
        req.user.user_id
      ]
    );
    return R.created(res, rows[0], 'Registration submitted. Verification takes 2-3 business days.');
  } catch (err) {
    if (err.code === '23505') return R.conflict(res, 'Email or VCI number already registered');
    return R.serverError(res, err.message);
  }
}

// ── POST /api/v1/vets/:id/review ─────────────────────────────────────────────
async function reviewVet(req, res) {
  try {
    const { rating, comment, appointment_id } = req.body;
    if (!rating || rating < 1 || rating > 5) return R.badRequest(res, 'rating must be 1–5');

    const { rows } = await pool.query(
      `INSERT INTO vet_reviews (vet_id, user_id, appointment_id, rating, comment)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (vet_id, user_id, appointment_id) DO UPDATE
         SET rating = EXCLUDED.rating, comment = EXCLUDED.comment
       RETURNING *`,
      [req.params.id, req.user.user_id, appointment_id || null, rating, comment || null]
    );
    await pool.query(
      `UPDATE vets SET
         rating = (SELECT ROUND(AVG(rating)::numeric, 2) FROM vet_reviews WHERE vet_id = $1),
         review_count = (SELECT COUNT(*) FROM vet_reviews WHERE vet_id = $1),
         updated_at = NOW()
       WHERE vet_id = $1`,
      [req.params.id]
    );
    return R.created(res, rows[0], 'Review submitted');
  } catch (err) { return R.serverError(res, err.message); }
}

// ── GET /api/v1/vets/chats ───────────────────────────────────────────────────
async function getVetChats(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT ON (v.vet_id)
              v.vet_id, v.first_name || ' ' || v.last_name AS vet_name,
              v.primary_specialty, v.avatar_url,
              a.appt_date, a.appt_time, a.status AS appt_status,
              a.appointment_id
       FROM vet_appointments a
       JOIN vets v ON a.vet_id = v.vet_id
       WHERE a.user_id = $1
       ORDER BY v.vet_id, a.appt_date DESC`,
      [req.user.user_id]
    );
    return R.ok(res, rows);
  } catch (err) { return R.serverError(res, err.message); }
}

module.exports = {
  listVets, getVet, getVetSlots,
  bookAppointment, getAppointments, getAppointment, updateAppointment,
  getPrescriptions, getPrescription,
  registerVet, reviewVet, getVetChats
};
