const { query, getClient } = require('../config/db');
const R = require('../utils/response');

// ── REPORT LOST PET ──────────────────────────────────────────────────────────
const reportLostPet = async (req, res, next) => {
  const {
    pet_id, last_seen_at, last_seen_address,
    last_seen_lat, last_seen_lng, description,
    reward_inr, contact_phone, contact_email,
    photo_urls = []
  } = req.body;

  const client = await getClient();
  try {
    await client.query('BEGIN');
    // Verify pet belongs to user
    const pet = await client.query(
      `SELECT pet_id, name FROM "Pet" WHERE pet_id = $1 AND owner_id = $2 AND deleted_at IS NULL`,
      [pet_id, req.user.user_id]
    );
    if (!pet.rows.length) return R.forbidden(res, 'Pet not found or not yours');

    const { rows } = await client.query(
      `INSERT INTO "LostPetAlert"
         (pet_id, reporter_id, last_seen_at, last_seen_address,
          last_seen_lat, last_seen_lng, description, reward_inr,
          contact_phone, contact_email, status, photo_urls)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'active',$11)
       RETURNING *`,
      [pet_id, req.user.user_id,
       last_seen_at || new Date().toISOString(),
       last_seen_address || null,
       last_seen_lat || null, last_seen_lng || null,
       description || null, reward_inr || null,
       contact_phone || null, contact_email || null,
       photo_urls.length ? `{${photo_urls.map(u=>`"${u}"`).join(',')}}` : null]
    );

    // Notify followers
    await client.query(
      `INSERT INTO "Notification" (recipient_id, sender_id, type, title, body, ref_table, ref_id)
       SELECT f.follower_id, $1, 'lost_pet_alert',
              'Lost pet alert!',
              'Your follower reported their pet missing. Please help!',
              'LostPetAlert', $2
         FROM "Follower" f
        WHERE f.followee_id = $1 AND f.status = 'accepted'`,
      [req.user.user_id, rows[0].alert_id]
    );

    await client.query('COMMIT');
    return R.created(res, rows[0], 'Lost pet alert created');
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};

// ── LIST ALERTS ──────────────────────────────────────────────────────────────
const getAlerts = async (req, res, next) => {
  const { page, limit, offset } = req.pagination;
  const { lat, lng, km = 50, status = 'active', species } = req.query;
  try {
    let where = `WHERE a.status = $1`;
    const params = [status];
    let i = 2;

    if (species) {
      where += ` AND p.species = $${i++}`;
      params.push(species);
    }

    const { rows: data } = await query(
      `SELECT a.*, p.name AS pet_name, p.species, p.breed, p.avatar_url AS pet_avatar,
              p.gender, p.color,
              u.username AS reporter_username, u.avatar_url AS reporter_avatar,
              COUNT(s.sighting_id) AS sighting_count
         FROM "LostPetAlert" a
         JOIN "Pet" p ON p.pet_id = a.pet_id
         JOIN "User" u ON u.user_id = a.reporter_id
         LEFT JOIN "LostPetSighting" s ON s.alert_id = a.alert_id
        ${where}
        GROUP BY a.alert_id, p.pet_id, u.user_id
        ORDER BY a.created_at DESC
        LIMIT $${i++} OFFSET $${i}`,
      [...params, limit, offset]
    );
    const { rows: [{ total }] } = await query(
      `SELECT COUNT(DISTINCT a.alert_id) AS total
         FROM "LostPetAlert" a
         JOIN "Pet" p ON p.pet_id = a.pet_id
        ${where}`,
      params
    );
    return R.paginated(res, data, { page, limit, total: parseInt(total) });
  } catch (err) { next(err); }
};

// ── ALERT DETAIL ─────────────────────────────────────────────────────────────
const getAlert = async (req, res, next) => {
  const { alert_id } = req.params;
  try {
    const { rows } = await query(
      `SELECT a.*, p.name AS pet_name, p.species, p.breed, p.gender,
              p.color, p.avatar_url AS pet_avatar, p.weight_kg, p.date_of_birth,
              u.username AS reporter_username, u.full_name AS reporter_name,
              u.avatar_url AS reporter_avatar, u.phone AS reporter_phone
         FROM "LostPetAlert" a
         JOIN "Pet" p ON p.pet_id = a.pet_id
         JOIN "User" u ON u.user_id = a.reporter_id
        WHERE a.alert_id = $1`,
      [alert_id]
    );
    if (!rows.length) return R.notFound(res, 'Alert not found');

    const { rows: sightings } = await query(
      `SELECT s.*, u.username, u.avatar_url
         FROM "LostPetSighting" s
         JOIN "User" u ON u.user_id = s.reporter_id
        WHERE s.alert_id = $1
        ORDER BY s.seen_at DESC`,
      [alert_id]
    );

    return R.ok(res, { ...rows[0], sightings });
  } catch (err) { next(err); }
};

// ── REPORT SIGHTING ──────────────────────────────────────────────────────────
const reportSighting = async (req, res, next) => {
  const { alert_id } = req.params;
  const { seen_at, address, lat, lng, description, photo_url } = req.body;
  try {
    const alert = await query(
      `SELECT reporter_id FROM "LostPetAlert" WHERE alert_id = $1 AND status = 'active'`,
      [alert_id]
    );
    if (!alert.rows.length) return R.notFound(res, 'Alert not found or already resolved');

    const { rows } = await query(
      `INSERT INTO "LostPetSighting"
         (alert_id, reporter_id, seen_at, address, lat, lng, description, photo_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [alert_id, req.user.user_id,
       seen_at || new Date().toISOString(),
       address || null, lat || null, lng || null,
       description || null, photo_url || null]
    );

    // Notify pet owner
    await query(
      `INSERT INTO "Notification" (recipient_id, sender_id, type, title, body, ref_table, ref_id)
       VALUES ($1, $2, 'pet_sighting', 'Someone spotted your pet!',
               'A new sighting has been reported near ' || $3,
               'LostPetSighting', $4)`,
      [alert.rows[0].reporter_id, req.user.user_id,
       address || 'an unknown location', rows[0].sighting_id]
    );

    return R.created(res, rows[0], 'Sighting reported');
  } catch (err) { next(err); }
};

// ── UPDATE ALERT STATUS ───────────────────────────────────────────────────────
const updateAlert = async (req, res, next) => {
  const { alert_id } = req.params;
  const { status } = req.body;
  const VALID = ['active', 'found', 'closed'];
  if (!VALID.includes(status)) return R.badRequest(res, `status must be one of: ${VALID.join(', ')}`);
  try {
    const { rows } = await query(
      `UPDATE "LostPetAlert"
          SET status = $1, updated_at = NOW()
        WHERE alert_id = $2 AND reporter_id = $3
        RETURNING *`,
      [status, alert_id, req.user.user_id]
    );
    if (!rows.length) return R.notFound(res, 'Alert not found or not yours');
    return R.ok(res, rows[0], 'Alert updated');
  } catch (err) { next(err); }
};

module.exports = { reportLostPet, getAlerts, getAlert, reportSighting, updateAlert };
