const { query, getClient } = require('../config/db');
const R = require('../utils/response');

// ── GET PUBLIC PROFILE ────────────────────────────────────────
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

// ── UPDATE MY PROFILE ─────────────────────────────────────────
const updateProfile = async (req, res, next) => {
  const {
    full_name, bio, city, state, country,
    website, avatar_url, cover_url
  } = req.body;
  try {
    const { rows } = await query(
      `UPDATE "User"
          SET full_name   = COALESCE($1, full_name),
              bio         = COALESCE($2, bio),
              city        = COALESCE($3, city),
              state       = COALESCE($4, state),
              country     = COALESCE($5, country),
              website     = COALESCE($6, website),
              avatar_url  = COALESCE($7, avatar_url),
              cover_url   = COALESCE($8, cover_url),
              updated_at  = NOW()
        WHERE user_id = $9
        RETURNING user_id, username, full_name, bio, city, state,
                  country, website, avatar_url, cover_url, updated_at`,
      [full_name, bio, city, state, country,
       website, avatar_url, cover_url, req.user.user_id]
    );
    return R.ok(res, rows[0], 'Profile updated');
  } catch (err) { next(err); }
};

// ── UPDATE PREFERENCES ────────────────────────────────────────
const updatePreferences = async (req, res, next) => {
  const { notification_prefs, privacy_settings, theme, language } = req.body;
  try {
    const { rows } = await query(
      `UPDATE "Profile"
          SET notification_prefs = COALESCE($1, notification_prefs),
              privacy_settings   = COALESCE($2, privacy_settings),
              theme              = COALESCE($3, theme),
              language           = COALESCE($4, language),
              updated_at         = NOW()
        WHERE user_id = $5
        RETURNING *`,
      [notification_prefs ? JSON.stringify(notification_prefs) : null,
       privacy_settings   ? JSON.stringify(privacy_settings)   : null,
       theme, language, req.user.user_id]
    );
    return R.ok(res, rows[0], 'Preferences updated');
  } catch (err) { next(err); }
};

// ── FOLLOW / UNFOLLOW ─────────────────────────────────────────
const follow = async (req, res, next) => {
  const { user_id: followee_id } = req.params;
  const follower_id = req.user.user_id;

  if (follower_id === followee_id)
    return R.badRequest(res, 'Cannot follow yourself');
  try {
    // Check target exists
    const target = await query(
      `SELECT user_id FROM "User" WHERE user_id = $1 AND deleted_at IS NULL`,
      [followee_id]
    );
    if (!target.rows.length) return R.notFound(res, 'User not found');

    // Toggle: insert or delete
    const existing = await query(
      `SELECT * FROM "Follower"
        WHERE follower_id = $1 AND followee_id = $2`,
      [follower_id, followee_id]
    );

    if (existing.rows.length) {
      await query(
        `DELETE FROM "Follower"
          WHERE follower_id = $1 AND followee_id = $2`,
        [follower_id, followee_id]
      );
      return R.ok(res, { following: false }, 'Unfollowed');
    } else {
      await query(
        `INSERT INTO "Follower" (follower_id, followee_id, status)
         VALUES ($1, $2, 'accepted')`,
        [follower_id, followee_id]
      );
      return R.ok(res, { following: true }, 'Followed');
    }
  } catch (err) { next(err); }
};

// ── FOLLOWERS LIST ────────────────────────────────────────────
const getFollowers = async (req, res, next) => {
  const { user_id } = req.params;
  const { page, limit, offset } = req.pagination;
  try {
    const { rows: data } = await query(
      `SELECT u.user_id, u.username, u.full_name, u.avatar_url,
              u.is_verified, f.created_at AS followed_at
         FROM "Follower" f
         JOIN "User" u ON u.user_id = f.follower_id
        WHERE f.followee_id = $1 AND f.status = 'accepted'
          AND u.deleted_at IS NULL
        ORDER BY f.created_at DESC
        LIMIT $2 OFFSET $3`,
      [user_id, limit, offset]
    );
    const { rows: [{ total }] } = await query(
      `SELECT COUNT(*) AS total FROM "Follower"
        WHERE followee_id = $1 AND status = 'accepted'`,
      [user_id]
    );
    return R.paginated(res, data, { page, limit, total: parseInt(total) });
  } catch (err) { next(err); }
};

// ── FOLLOWING LIST ────────────────────────────────────────────
const getFollowing = async (req, res, next) => {
  const { user_id } = req.params;
  const { page, limit, offset } = req.pagination;
  try {
    const { rows: data } = await query(
      `SELECT u.user_id, u.username, u.full_name, u.avatar_url,
              u.is_verified, f.created_at AS followed_at
         FROM "Follower" f
         JOIN "User" u ON u.user_id = f.followee_id
        WHERE f.follower_id = $1 AND f.status = 'accepted'
          AND u.deleted_at IS NULL
        ORDER BY f.created_at DESC
        LIMIT $2 OFFSET $3`,
      [user_id, limit, offset]
    );
    const { rows: [{ total }] } = await query(
      `SELECT COUNT(*) AS total FROM "Follower"
        WHERE follower_id = $1 AND status = 'accepted'`,
      [user_id]
    );
    return R.paginated(res, data, { page, limit, total: parseInt(total) });
  } catch (err) { next(err); }
};

// ── BLOCK / UNBLOCK ───────────────────────────────────────────
const block = async (req, res, next) => {
  const { user_id: blocked_id } = req.params;
  const blocker_id = req.user.user_id;
  if (blocker_id === blocked_id)
    return R.badRequest(res, 'Cannot block yourself');
  try {
    const existing = await query(
      `SELECT 1 FROM "BlockedUser"
        WHERE blocker_id = $1 AND blocked_id = $2`,
      [blocker_id, blocked_id]
    );
    if (existing.rows.length) {
      await query(
        `DELETE FROM "BlockedUser"
          WHERE blocker_id = $1 AND blocked_id = $2`,
        [blocker_id, blocked_id]
      );
      return R.ok(res, { blocked: false }, 'User unblocked');
    } else {
      await query(
        `INSERT INTO "BlockedUser" (blocker_id, blocked_id, reason)
         VALUES ($1, $2, $3)`,
        [blocker_id, blocked_id, req.body.reason || null]
      );
      // Also remove any follow relationship
      await query(
        `DELETE FROM "Follower"
          WHERE (follower_id = $1 AND followee_id = $2)
             OR (follower_id = $2 AND followee_id = $1)`,
        [blocker_id, blocked_id]
      );
      return R.ok(res, { blocked: true }, 'User blocked');
    }
  } catch (err) { next(err); }
};

// ── DEACTIVATE ACCOUNT ────────────────────────────────────────
const deactivate = async (req, res, next) => {
  try {
    await query(
      `UPDATE "User"
          SET status     = 'deactivated',
              deleted_at = NOW(),
              updated_at = NOW()
        WHERE user_id = $1`,
      [req.user.user_id]
    );
    await query(
      `INSERT INTO "AuditTrail" (actor_id, action)
       VALUES ($1, 'user.deactivated')`,
      [req.user.user_id]
    );
    return R.ok(res, null, 'Account deactivated');
  } catch (err) { next(err); }
};

// ── SEARCH USERS ──────────────────────────────────────────────
const searchUsers = async (req, res, next) => {
  const { q } = req.query;
  const { page, limit, offset } = req.pagination;
  if (!q || q.trim().length < 2)
    return R.badRequest(res, 'Query must be at least 2 characters');
  try {
    const { rows: data } = await query(
      `SELECT user_id, username, full_name, avatar_url, role, is_verified, city
         FROM "User"
        WHERE deleted_at IS NULL
          AND (
            username  ILIKE $1
            OR full_name ILIKE $1
          )
        ORDER BY is_verified DESC, username ASC
        LIMIT $2 OFFSET $3`,
      [`%${q}%`, limit, offset]
    );
    const { rows: [{ total }] } = await query(
      `SELECT COUNT(*) AS total FROM "User"
        WHERE deleted_at IS NULL
          AND (username ILIKE $1 OR full_name ILIKE $1)`,
      [`%${q}%`]
    );
    // Log search history
    if (req.user) {
      await query(
        `INSERT INTO "SearchHistory"
           (user_id, query, category, result_count)
         VALUES ($1, $2, 'user', $3)`,
        [req.user.user_id, q, parseInt(total)]
      );
    }
    return R.paginated(res, data, { page, limit, total: parseInt(total) });
  } catch (err) { next(err); }
};

module.exports = {
  getProfile, updateProfile, updatePreferences,
  follow, getFollowers, getFollowing,
  block, deactivate, searchUsers
};
