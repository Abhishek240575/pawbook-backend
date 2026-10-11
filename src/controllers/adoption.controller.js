const { query } = require('../config/db');
const R = require('../utils/response');

// GET /api/v1/adoptions/pets
const getPets = async (req, res, next) => {
  try {
    const { species, country, state, city, urgency, limit = 20, offset = 0 } = req.query;

    let conditions = [`ap.status = 'available'`];
    let params = [];
    let idx = 1;

    if (species) { conditions.push(`LOWER(ap.species) = LOWER($${idx++})`); params.push(species); }
    if (country) { conditions.push(`LOWER(ap.location_country) = LOWER($${idx++})`); params.push(country); }
    if (state)   { conditions.push(`LOWER(ap.location_state) = LOWER($${idx++})`); params.push(state); }
    if (city)    { conditions.push(`LOWER(ap.location_city) = LOWER($${idx++})`); params.push(city); }
    if (urgency) { conditions.push(`ap.urgency = $${idx++}`); params.push(urgency); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    params.push(parseInt(limit));
    params.push(parseInt(offset));

    const { rows } = await query(
      `SELECT ap.*, s.name AS shelter_name, s.city AS shelter_city, s.is_verified
       FROM adoptable_pets ap
       LEFT JOIN shelters s ON s.shelter_id = ap.shelter_id
       ${where}
       ORDER BY ap.urgency DESC, ap.created_at DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
      params
    );

    const countResult = await query(
      `SELECT COUNT(*) FROM adoptable_pets ap ${where}`,
      params.slice(0, params.length - 2)
    );

    return R.ok(res, {
      pets: rows,
      total: parseInt(countResult.rows[0].count),
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (err) { next(err); }
};

// GET /api/v1/adoptions/pets/:id
const getPetById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { rows } = await query(
      `SELECT ap.*, s.name AS shelter_name, s.city AS shelter_city,
              s.phone AS shelter_phone, s.address AS shelter_address,
              s.is_verified, s.rating AS shelter_rating
       FROM adoptable_pets ap
       LEFT JOIN shelters s ON s.shelter_id = ap.shelter_id
       WHERE ap.id = $1`,
      [id]
    );
    if (!rows[0]) return R.notFound(res, 'Pet not found');
    return R.ok(res, rows[0]);
  } catch (err) { next(err); }
};

// GET /api/v1/adoptions/shelters
const getShelters = async (req, res, next) => {
  try {
    const { country, state, city } = req.query;

    let conditions = [];
    let params = [];
    let idx = 1;

    if (country) { conditions.push(`LOWER(country) = LOWER($${idx++})`); params.push(country); }
    if (state)   { conditions.push(`LOWER(state) = LOWER($${idx++})`); params.push(state); }
    if (city)    { conditions.push(`LOWER(city) = LOWER($${idx++})`); params.push(city); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const { rows } = await query(
      `SELECT s.*,
         COUNT(ap.id) FILTER (WHERE ap.status = 'available') AS available_pets
       FROM shelters s
       LEFT JOIN adoptable_pets ap ON ap.shelter_id = s.shelter_id
       ${where}
       GROUP BY s.shelter_id
       ORDER BY s.is_verified DESC, s.rating DESC`,
      params
    );

    return R.ok(res, rows);
  } catch (err) { next(err); }
};

// POST /api/v1/adoptions/inquire  (auth required)
const createInquiry = async (req, res, next) => {
  try {
    const { pet_id, message, applicant_name, applicant_email, applicant_phone } = req.body;
    const user_id = req.user.user_id;

    if (!pet_id) return R.badRequest(res, 'pet_id is required');

    // Get shelter_id from pet
    const petResult = await query(
      `SELECT id, shelter_id, name, status FROM adoptable_pets WHERE id = $1`,
      [pet_id]
    );
    if (!petResult.rows[0]) return R.notFound(res, 'Pet not found');
    if (petResult.rows[0].status !== 'available') return R.badRequest(res, 'Pet is no longer available');

    // Check for duplicate inquiry
    const existing = await query(
      `SELECT inquiry_id FROM adoption_inquiries WHERE user_id = $1 AND pet_id = $2`,
      [user_id, pet_id]
    );
    if (existing.rows[0]) return R.conflict(res, 'You have already submitted an inquiry for this pet');

    const { rows } = await query(
      `INSERT INTO adoption_inquiries
         (user_id, pet_id, shelter_id, message, applicant_name, applicant_email, applicant_phone)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [user_id, pet_id, petResult.rows[0].shelter_id, message, applicant_name, applicant_email, applicant_phone]
    );

    return R.created(res, { inquiry: rows[0], pet_name: petResult.rows[0].name });
  } catch (err) { next(err); }
};

// GET /api/v1/adoptions/my-inquiries  (auth required)
const getMyInquiries = async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT ai.*, ap.name AS pet_name, ap.breed, ap.species, ap.photo_url,
              s.name AS shelter_name, s.phone AS shelter_phone
       FROM adoption_inquiries ai
       JOIN adoptable_pets ap ON ap.id = ai.pet_id
       LEFT JOIN shelters s ON s.shelter_id = ai.shelter_id
       WHERE ai.user_id = $1
       ORDER BY ai.created_at DESC`,
      [req.user.user_id]
    );
    return R.ok(res, rows);
  } catch (err) { next(err); }
};

module.exports = { getPets, getPetById, getShelters, createInquiry, getMyInquiries };