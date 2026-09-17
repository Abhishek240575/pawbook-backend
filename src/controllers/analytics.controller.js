const { query } = require('../config/db');
const R = require('../utils/response');

// ── USER ANALYTICS DASHBOARD ─────────────────────────────────────────────────
const getMyAnalytics = async (req, res, next) => {
  const user_id = req.user.user_id;
  try {
    const [profileStats, petStats, postStats, vetStats, weeklyPosts] = await Promise.all([
      // Followers / following / pets
      query(
        `SELECT
           COUNT(DISTINCT f_in.follower_id)  AS followers,
           COUNT(DISTINCT f_out.followee_id) AS following,
           COUNT(DISTINCT p.pet_id)          AS pets
         FROM "User" u
         LEFT JOIN "Follower" f_in  ON f_in.followee_id  = u.user_id AND f_in.status  = 'accepted'
         LEFT JOIN "Follower" f_out ON f_out.follower_id = u.user_id AND f_out.status = 'accepted'
         LEFT JOIN "Pet" p          ON p.owner_id        = u.user_id AND p.deleted_at IS NULL
        WHERE u.user_id = $1`,
        [user_id]
      ),
      // Pet health
      query(
        `SELECT
           COUNT(DISTINCT vr.record_id) AS total_vaccinations,
           COUNT(DISTINCT CASE WHEN vr.next_due_at < NOW() THEN vr.record_id END) AS overdue_vaccinations,
           COUNT(DISTINCT va.appointment_id) AS total_vet_visits
         FROM "Pet" p
         LEFT JOIN "VaccinationRecord" vr ON vr.pet_id = p.pet_id
         LEFT JOIN "VetAppointment" va    ON va.pet_id = p.pet_id AND va.status = 'completed'
        WHERE p.owner_id = $1 AND p.deleted_at IS NULL`,
        [user_id]
      ),
      // Post engagement last 30 days
      query(
        `SELECT
           COUNT(DISTINCT po.post_id)              AS total_posts,
           COALESCE(SUM(po.reaction_count), 0)     AS total_reactions,
           COALESCE(SUM(po.comment_count), 0)      AS total_comments,
           COALESCE(SUM(po.view_count), 0)         AS total_views
         FROM "Post" po
        WHERE po.author_id = $1
          AND po.deleted_at IS NULL
          AND po.created_at >= NOW() - INTERVAL '30 days'`,
        [user_id]
      ),
      // Upcoming vet appointments
      query(
        `SELECT va.appointment_id, va.appointment_type, va.scheduled_at, va.status,
                p.name AS pet_name, p.species,
                u.full_name AS vet_name
           FROM "VetAppointment" va
           JOIN "Pet" p  ON p.pet_id  = va.pet_id
           JOIN "User" u ON u.user_id = va.vet_id
          WHERE va.owner_id = $1
            AND va.status IN ('scheduled','confirmed')
            AND va.scheduled_at >= NOW()
          ORDER BY va.scheduled_at ASC LIMIT 5`,
        [user_id]
      ),
      // Weekly posts last 7 days
      query(
        `SELECT
           TO_CHAR(gs::date, 'Dy') AS day,
           COUNT(po.post_id) AS posts,
           COALESCE(SUM(po.reaction_count), 0) AS reactions
         FROM generate_series(NOW() - INTERVAL '6 days', NOW(), '1 day'::interval) gs
         LEFT JOIN "Post" po
                ON po.created_at::date = gs::date
               AND po.author_id = $1
               AND po.deleted_at IS NULL
         GROUP BY gs ORDER BY gs`,
        [user_id]
      )
    ]);

    // Recent activity
    const { rows: recentActivity } = await query(
      `SELECT activity_type, ref_table, created_at
         FROM "ActivityLog"
        WHERE user_id = $1
        ORDER BY created_at DESC LIMIT 20`,
      [user_id]
    ).catch(() => ({ rows: [] }));

    return R.ok(res, {
      profile:         profileStats.rows[0],
      health:          petStats.rows[0],
      engagement:      postStats.rows[0],
      upcoming_apts:   vetStats.rows,
      recent_activity: recentActivity,
      weekly_posts:    weeklyPosts.rows
    });
  } catch (err) { next(err); }
};

// ── INSURANCE ─────────────────────────────────────────────────────────────────
const enrollInsurance = async (req, res, next) => {
  const { pet_id, plan_type, plan_name, premium_inr } = req.body;
  try {
    const pet = await query(
      `SELECT pet_id FROM "Pet" WHERE pet_id = $1 AND owner_id = $2 AND deleted_at IS NULL`,
      [pet_id, req.user.user_id]
    );
    if (!pet.rows.length) return R.forbidden(res, 'Pet not found or not yours');

    const { rows } = await query(
      `INSERT INTO "InsurancePlan"
         (user_id, pet_id, plan_type, plan_name, premium_inr, status, start_date)
       VALUES ($1,$2,$3,$4,$5,'active',NOW())
       ON CONFLICT (pet_id) DO UPDATE
          SET plan_type=$3, plan_name=$4, premium_inr=$5, updated_at=NOW()
       RETURNING *`,
      [req.user.user_id, pet_id, plan_type, plan_name, premium_inr]
    );
    return R.created(res, rows[0], 'Insurance enrolled');
  } catch (err) { next(err); }
};

const getMyInsurance = async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT ip.*, p.name AS pet_name, p.species, p.avatar_url AS pet_avatar
         FROM "InsurancePlan" ip
         JOIN "Pet" p ON p.pet_id = ip.pet_id
        WHERE ip.user_id = $1 ORDER BY ip.created_at DESC`,
      [req.user.user_id]
    );
    return R.ok(res, rows);
  } catch (err) { next(err); }
};

// ── TRAINING ─────────────────────────────────────────────────────────────────
const bookTrainingSession = async (req, res, next) => {
  const { pet_id, trainer_id, session_type, scheduled_at, notes } = req.body;
  try {
    const pet = await query(
      `SELECT pet_id FROM "Pet" WHERE pet_id=$1 AND owner_id=$2 AND deleted_at IS NULL`,
      [pet_id, req.user.user_id]
    );
    if (!pet.rows.length) return R.forbidden(res, 'Pet not found or not yours');
    const { rows } = await query(
      `INSERT INTO "TrainingSession"
         (pet_id, owner_id, trainer_id, session_type, scheduled_at, notes, status)
       VALUES ($1,$2,$3,$4,$5,$6,'scheduled') RETURNING *`,
      [pet_id, req.user.user_id, trainer_id||null, session_type||'basic_obedience', scheduled_at, notes||null]
    );
    return R.created(res, rows[0], 'Session booked');
  } catch (err) { next(err); }
};

const getMyTrainingSessions = async (req, res, next) => {
  const { page, limit, offset } = req.pagination;
  try {
    const { rows: data } = await query(
      `SELECT ts.*, p.name AS pet_name, p.species, p.avatar_url AS pet_avatar
         FROM "TrainingSession" ts JOIN "Pet" p ON p.pet_id=ts.pet_id
        WHERE ts.owner_id=$1 ORDER BY ts.scheduled_at DESC LIMIT $2 OFFSET $3`,
      [req.user.user_id, limit, offset]
    );
    const { rows:[{total}] } = await query(
      `SELECT COUNT(*) AS total FROM "TrainingSession" WHERE owner_id=$1`, [req.user.user_id]
    );
    return R.paginated(res, data, { page, limit, total: parseInt(total) });
  } catch (err) { next(err); }
};

const updateTrainingProgress = async (req, res, next) => {
  const { session_id } = req.params;
  const { status, progress_notes, skills_achieved } = req.body;
  try {
    const { rows } = await query(
      `UPDATE "TrainingSession"
          SET status         = COALESCE($1, status),
              progress_notes = COALESCE($2, progress_notes),
              skills_achieved= COALESCE($3, skills_achieved),
              updated_at     = NOW()
        WHERE session_id=$4 AND (owner_id=$5 OR trainer_id=$5)
        RETURNING *`,
      [status, progress_notes, skills_achieved, session_id, req.user.user_id]
    );
    if (!rows.length) return R.notFound(res, 'Session not found');
    return R.ok(res, rows[0], 'Progress updated');
  } catch (err) { next(err); }
};

module.exports = {
  getMyAnalytics,
  enrollInsurance, getMyInsurance,
  bookTrainingSession, getMyTrainingSessions, updateTrainingProgress
};
