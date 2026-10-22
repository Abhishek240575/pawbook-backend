const { query, getClient } = require('../config/db');
const R = require('../utils/response');

// -- GET PUBLIC PROFILE
const getProfile = async (req, res, next) => {
  const { username } = req.params;
  try {
    const { rows } = await query(
      `SELECT * FROM v_user_public WHERE username = $1`,
      [username.toLowerCase()]
    );
    if (!rows.length) return R.notFound(res, 'User not found');
    return R.ok(res, rows[0]);
  } catch (err) { next(err); }
};

// -- UPDATE MY PROFILE
const updateProfile = async (req, res, next) => {
  const { full_name, bio, city, state, country, website, avatar_url, cover_url } = req.body;
  try {
    const { rows } = await query(
      `UPDATE users
          SET full_name   = COALESCE($1, full_name),
              bio         = COALESCE($2, bio),
              city        = COALESCE($3, city),
              state       = COALESCE($4, state),
              country     = COALESCE($5, country),
              avatar_url  = COALESCE($6, avatar_url),
              cover_url   = COALESCE($7, cover_url),
              updated_at  = NOW()
        WHERE user_id = $8
        RETURNING user_id, username, full_name, bio, city, state,
                  country, avatar_url, cover_url, updated_at`,
      [full_name, bio, city, state, country, avatar_url, cover_url, req.user.user_id]
    );
    return R.ok(res, rows[0], 'Profile updated');
  } catch (err) { next(err); }
};

// -- UPDATE PREFERENCES (stored in users table as JSON columns if they exist, else stub)
const updatePreferences = async (req, res, next) => {
  return R.ok(res, null, 'Preferences update not supported yet');
};

// -- FOLLOW / UNFOLLOW
const follow = async (req, res, next) => {
  const { user_id: followee_uuid } = req.params;
  const follower_uuid = req.user.user_id;
  if (follower_uuid === followee_uuid)
    return R.badRequest(res, 'Cannot follow yourself');
  try {
    // Resolve both UUIDs to user_no (follows table uses integers)
    const followerRow = await query(`SELECT user_no FROM users WHERE user_id=$1`, [follower_uuid]);
    const followeeRow = await query(`SELECT user_no FROM users WHERE user_id=$1`, [followee_uuid]);
    if (!followerRow.rows.length || !followeeRow.rows.length)
      return R.notFound(res, 'User not found');
    const follower_id = followerRow.rows[0].user_no;
    const following_id = followeeRow.rows[0].user_no;

    const existing = await query(
      `SELECT id FROM follows WHERE follower_id=$1 AND following_id=$2`,
      [follower_id, following_id]
    );
    if (existing.rows.length) {
      await query(`DELETE FROM follows WHERE follower_id=$1 AND following_id=$2`, [follower_id, following_id]);
      return R.ok(res, { following: false }, 'Unfollowed');
    } else {
      await query(
        `INSERT INTO follows (follower_id, following_id) VALUES ($1,$2)`,
        [follower_id, following_id]
      );
      return R.ok(res, { following: true }, 'Followed');
    }
  } catch (err) { next(err); }
};

// -- FOLLOWERS LIST
const getFollowers = async (req, res, next) => {
  const { user_id } = req.params;
  const { page, limit, offset } = req.pagination;
  try {
    // user_id param may be UUID — resolve to user_no
    const target = await query(`SELECT user_no FROM users WHERE user_id=$1`, [user_id]);
    if (!target.rows.length) return R.notFound(res, 'User not found');
    const target_no = target.rows[0].user_no;

    const { rows: data } = await query(
      `SELECT u.user_id, u.username, u.full_name, u.avatar_url,
              u.is_verified, f.created_at AS followed_at
         FROM follows f
         JOIN users u ON u.user_no = f.follower_id
        WHERE f.following_id = $1
        ORDER BY f.created_at DESC
        LIMIT $2 OFFSET $3`,
      [target_no, limit, offset]
    );
    const { rows: [{ total }] } = await query(
      `SELECT COUNT(*) AS total FROM follows WHERE following_id=$1`,
      [target_no]
    );
    return R.paginated(res, data, { page, limit, total: parseInt(total) });
  } catch (err) { next(err); }
};

// -- FOLLOWING LIST
const getFollowing = async (req, res, next) => {
  const { user_id } = req.params;
  const { page, limit, offset } = req.pagination;
  try {
    const target = await query(`SELECT user_no FROM users WHERE user_id=$1`, [user_id]);
    if (!target.rows.length) return R.notFound(res, 'User not found');
    const target_no = target.rows[0].user_no;

    const { rows: data } = await query(
      `SELECT u.user_id, u.username, u.full_name, u.avatar_url,
              u.is_verified, f.created_at AS followed_at
         FROM follows f
         JOIN users u ON u.user_no = f.following_id
        WHERE f.follower_id = $1
        ORDER BY f.created_at DESC
        LIMIT $2 OFFSET $3`,
      [target_no, limit, offset]
    );
    const { rows: [{ total }] } = await query(
      `SELECT COUNT(*) AS total FROM follows WHERE follower_id=$1`,
      [target_no]
    );
    return R.paginated(res, data, { page, limit, total: parseInt(total) });
  } catch (err) { next(err); }
};

// -- BLOCK / UNBLOCK (stubbed - no blocked_users table)
const block = async (req, res, next) => {
  return R.ok(res, null, 'Block feature not available yet');
};

// -- DEACTIVATE ACCOUNT
const deactivate = async (req, res, next) => {
  try {
    await query(
      `UPDATE users
          SET status     = 'deactivated',
              updated_at = NOW()
        WHERE user_id = $1`,
      [req.user.user_id]
    );
    return R.ok(res, null, 'Account deactivated');
  } catch (err) { next(err); }
};

// -- SEARCH USERS
const searchUsers = async (req, res, next) => {
  const { q } = req.query;
  const { page, limit, offset } = req.pagination;
  if (!q || q.trim().length < 2)
    return R.badRequest(res, 'Query must be at least 2 characters');
  try {
    const { rows: data } = await query(
      `SELECT user_id, username, full_name, avatar_url, role, is_verified, city
         FROM users
        WHERE (username ILIKE $1 OR full_name ILIKE $1)
        ORDER BY is_verified DESC, username ASC
        LIMIT $2 OFFSET $3`,
      [`%${q}%`, limit, offset]
    );
    const { rows: [{ total }] } = await query(
      `SELECT COUNT(*) AS total FROM users
        WHERE (username ILIKE $1 OR full_name ILIKE $1)`,
      [`%${q}%`]
    );
    return R.paginated(res, data, { page, limit, total: parseInt(total) });
  } catch (err) { next(err); }
};

module.exports = {
  getProfile, updateProfile, updatePreferences,
  follow, getFollowers, getFollowing,
  block, deactivate, searchUsers
};
