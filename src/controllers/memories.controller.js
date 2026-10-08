const pool = require('../config/db');
const R = require('../utils/response');

// GET /api/v1/memories — "On This Day" posts from past years
async function getMemories(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT p.post_id, p.content, p.image_url, p.created_at,
              u.full_name as author_name, u.avatar_url as author_avatar,
              EXTRACT(YEAR FROM AGE(p.created_at)) as years_ago
       FROM posts p
       JOIN users u ON p.user_id = u.user_id
       WHERE p.user_id = $1
         AND TO_CHAR(p.created_at, 'MM-DD') = TO_CHAR(NOW(), 'MM-DD')
         AND EXTRACT(YEAR FROM p.created_at) < EXTRACT(YEAR FROM NOW())
       ORDER BY p.created_at DESC
       LIMIT 10`,
      [req.user.user_id]
    );
    return R.ok(res, rows);
  } catch (err) { return R.serverError(res, err.message); }
}

// GET /api/v1/birthdays — upcoming pet birthdays from people the user follows
async function getBirthdays(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT p.pet_id, p.name as pet_name, p.breed, p.species, p.avatar_url,
              p.date_of_birth,
              u.user_id as owner_id, u.full_name as owner_name, u.avatar_url as owner_avatar,
              DATE_PART('year', AGE(
                DATE(TO_CHAR(NOW(),'YYYY') || '-' || TO_CHAR(p.date_of_birth,'MM-DD'))
              )) as turning_age,
              (DATE(TO_CHAR(NOW(),'YYYY') || '-' || TO_CHAR(p.date_of_birth,'MM-DD'))
               - CURRENT_DATE) as days_until
       FROM pets p
       JOIN users u ON p.user_id = u.user_id
       JOIN follows f ON f.following_id = u.user_id
       WHERE f.follower_id = $1
         AND p.date_of_birth IS NOT NULL
         AND (
           DATE(TO_CHAR(NOW(),'YYYY') || '-' || TO_CHAR(p.date_of_birth,'MM-DD'))
           BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'
         )
       ORDER BY days_until ASC
       LIMIT 20`,
      [req.user.user_id]
    );

    // Also get the user's own pets birthdays
    const { rows: ownPets } = await pool.query(
      `SELECT p.pet_id, p.name as pet_name, p.breed, p.species, p.avatar_url,
              p.date_of_birth, NULL as owner_id, 'You' as owner_name, NULL as owner_avatar,
              DATE_PART('year', AGE(
                DATE(TO_CHAR(NOW(),'YYYY') || '-' || TO_CHAR(p.date_of_birth,'MM-DD'))
              )) as turning_age,
              (DATE(TO_CHAR(NOW(),'YYYY') || '-' || TO_CHAR(p.date_of_birth,'MM-DD'))
               - CURRENT_DATE) as days_until
       FROM pets p
       WHERE p.user_id = $1
         AND p.date_of_birth IS NOT NULL
         AND (
           DATE(TO_CHAR(NOW(),'YYYY') || '-' || TO_CHAR(p.date_of_birth,'MM-DD'))
           BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'
         )
       ORDER BY days_until ASC`,
      [req.user.user_id]
    );

    const all = [...ownPets, ...rows].sort((a, b) => a.days_until - b.days_until);
    return R.ok(res, all);
  } catch (err) { return R.serverError(res, err.message); }
}

module.exports = { getMemories, getBirthdays };
