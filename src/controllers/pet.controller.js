const { query, getClient } = require('../config/db');
const R = require('../utils/response');

// ── CREATE PET ────────────────────────────────────────────────
const createPet = async (req, res, next) => {
  const {
    name, species, breed, mixed_breed, gender,
    date_of_birth, weight_kg, size, color,
    microchip_id, bio, avatar_url
  } = req.body;
  try {
    const { rows } = await query(
      `INSERT INTO "Pet"
         (owner_id, name, species, breed, mixed_breed, gender,
          date_of_birth, weight_kg, size, color, microchip_id, bio, avatar_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [req.user.user_id, name, species, breed || null,
       mixed_breed || false, gender || 'unknown',
       date_of_birth || null, weight_kg || null,
       size || null, color || null,
       microchip_id || null, bio || null, avatar_url || null]
    );
    return R.created(res, rows[0], 'Pet profile created');
  } catch (err) { next(err); }
};

// ── GET MY PETS ───────────────────────────────────────────────
const getMyPets = async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT * FROM v_pet_full
        WHERE owner_id = $1
        ORDER BY created_at DESC`,
      [req.user.user_id]
    );
    return R.ok(res, rows);
  } catch (err) { next(err); }
};

// ── GET PET BY ID ─────────────────────────────────────────────
const getPet = async (req, res, next) => {
  const { pet_id } = req.params;
  try {
    const { rows } = await query(
      `SELECT * FROM v_pet_full WHERE pet_id = $1`,
      [pet_id]
    );
    if (!rows.length) return R.notFound(res, 'Pet not found');
    return R.ok(res, rows[0]);
  } catch (err) { next(err); }
};

// ── UPDATE PET ────────────────────────────────────────────────
const updatePet = async (req, res, next) => {
  const { pet_id } = req.params;
  const {
    name, breed, gender, date_of_birth, weight_kg,
    size, color, bio, avatar_url, cover_url
  } = req.body;
  try {
    // Ownership check
    const own = await query(
      `SELECT owner_id FROM "Pet" WHERE pet_id = $1 AND deleted_at IS NULL`,
      [pet_id]
    );
    if (!own.rows.length) return R.notFound(res, 'Pet not found');
    if (own.rows[0].owner_id !== req.user.user_id
        && req.user.role !== 'admin')
      return R.forbidden(res, 'Not your pet');

    const { rows } = await query(
      `UPDATE "Pet"
          SET name         = COALESCE($1, name),
              breed        = COALESCE($2, breed),
              gender       = COALESCE($3::gender_type, gender),
              date_of_birth= COALESCE($4, date_of_birth),
              weight_kg    = COALESCE($5, weight_kg),
              size         = COALESCE($6::pet_size, size),
              color        = COALESCE($7, color),
              bio          = COALESCE($8, bio),
              avatar_url   = COALESCE($9, avatar_url),
              cover_url    = COALESCE($10, cover_url),
              updated_at   = NOW()
        WHERE pet_id = $11
        RETURNING *`,
      [name, breed, gender, date_of_birth, weight_kg,
       size, color, bio, avatar_url, cover_url, pet_id]
    );
    return R.ok(res, rows[0], 'Pet updated');
  } catch (err) { next(err); }
};

// ── DELETE PET (soft) ─────────────────────────────────────────
const deletePet = async (req, res, next) => {
  const { pet_id } = req.params;
  try {
    const own = await query(
      `SELECT owner_id FROM "Pet" WHERE pet_id = $1 AND deleted_at IS NULL`,
      [pet_id]
    );
    if (!own.rows.length) return R.notFound(res, 'Pet not found');
    if (own.rows[0].owner_id !== req.user.user_id
        && req.user.role !== 'admin')
      return R.forbidden(res, 'Not your pet');

    await query(
      `UPDATE "Pet" SET deleted_at = NOW() WHERE pet_id = $1`,
      [pet_id]
    );
    return R.ok(res, null, 'Pet removed');
  } catch (err) { next(err); }
};

// ── PET HEALTH TIMELINE ───────────────────────────────────────
const getHealthTimeline = async (req, res, next) => {
  const { pet_id } = req.params;
  try {
    const [vaccinations, medical, appointments] = await Promise.all([
      query(
        `SELECT 'vaccination' AS type, vaccine_name AS title,
                administered_at AS date, next_due_at,
                clinic_name, verified_by_vet
           FROM "VaccinationRecord"
          WHERE pet_id = $1
          ORDER BY administered_at DESC`,
        [pet_id]
      ),
      query(
        `SELECT 'medical' AS type, title, record_type,
                diagnosed_at AS date, severity, is_ongoing
           FROM "MedicalHistory"
          WHERE pet_id = $1
          ORDER BY diagnosed_at DESC NULLS LAST`,
        [pet_id]
      ),
      query(
        `SELECT 'appointment' AS type,
                appointment_type AS title, scheduled_at AS date,
                status, vet_notes, diagnosis
           FROM "VetAppointment"
          WHERE pet_id = $1
          ORDER BY scheduled_at DESC`,
        [pet_id]
      )
    ]);

    return R.ok(res, {
      vaccinations: vaccinations.rows,
      medical:      medical.rows,
      appointments: appointments.rows
    });
  } catch (err) { next(err); }
};

// ── ADD VACCINATION RECORD ────────────────────────────────────
const addVaccination = async (req, res, next) => {
  const { pet_id } = req.params;
  const {
    vaccine_name, vaccine_brand, batch_number,
    dose_number, dose_ml, administered_at, next_due_at,
    clinic_name, clinic_city, certificate_url, notes
  } = req.body;
  try {
    const { rows } = await query(
      `INSERT INTO "VaccinationRecord"
         (pet_id, administered_by, vaccine_name, vaccine_brand,
          batch_number, dose_number, dose_ml, administered_at,
          next_due_at, clinic_name, clinic_city, certificate_url, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [pet_id,
       req.user.role === 'vet' ? req.user.user_id : null,
       vaccine_name, vaccine_brand || null, batch_number || null,
       dose_number || 1, dose_ml || null, administered_at,
       next_due_at || null, clinic_name || null, clinic_city || null,
       certificate_url || null, notes || null]
    );
    // Trigger fn_auto_vacc_reminder fires automatically in DB
    return R.created(res, rows[0], 'Vaccination recorded');
  } catch (err) { next(err); }
};

// ── UPCOMING VACCINATION DUES ─────────────────────────────────
const getVaccinationsDue = async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT * FROM v_vaccination_due
        WHERE owner_id = $1
        ORDER BY next_due_at ASC
        LIMIT 20`,
      [req.user.user_id]
    );
    return R.ok(res, rows);
  } catch (err) { next(err); }
};

module.exports = {
  createPet, getMyPets, getPet, updatePet, deletePet,
  getHealthTimeline, addVaccination, getVaccinationsDue
};
