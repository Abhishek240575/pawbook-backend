const { query, getClient } = require('../config/db');
const R = require('../utils/response');

// ── HOME FEED ─────────────────────────────────────────────────
const getFeed = async (req, res, next) => {
  const { page, limit, offset } = req.pagination;
  try {
    const { rows: data } = await query(
      `SELECT * FROM fn_user_feed($1, $2, $3)`,
      [req.user.user_id, limit, offset]
    );
    // Total count for pagination
    const { rows: [{ total }] } = await query(
      `SELECT COUNT(*) AS total
         FROM v_feed_post vf
        WHERE vf.author_id = $1
           OR vf.visibility = 'public'
           OR EXISTS (
               SELECT 1 FROM "Follower" f
                WHERE f.follower_id = $1
                  AND f.followee_id = vf.author_id
                  AND f.status = 'accepted'
           )`,
      [req.user.user_id]
    );
    return R.paginated(res, data, { page, limit, total: parseInt(total) });
  } catch (err) { next(err); }
};

// ── CREATE POST ───────────────────────────────────────────────
const createPost = async (req, res, next) => {
  const {
    body: postBody, pet_id, group_id, hashtags,
    tags, location_name, latitude, longitude,
    visibility = 'public', media_urls = []
  } = req.body;

  const client = await getClient();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `INSERT INTO "Post"
         (author_id, pet_id, group_id, body, hashtags, tags,
          location_name, latitude, longitude, visibility)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [req.user.user_id,
       pet_id || null, group_id || null,
       postBody || null,
       hashtags ? `{${hashtags.map(h => `"${h}"`).join(',')}}` : null,
       tags     ? `{${tags.map(t => `"${t}"`).join(',')}}` : null,
       location_name || null, latitude || null, longitude || null,
       visibility]
    );
    const post = rows[0];

    // Insert associated media
    for (const url of media_urls) {
      await client.query(
        `INSERT INTO "Media"
           (uploader_id, media_type, url, ref_table, ref_id)
         VALUES ($1, 'image', $2, 'Post', $3)`,
        [req.user.user_id, url, post.post_id]
      );
    }

    // Log activity
    await client.query(
      `INSERT INTO "ActivityLog"
         (user_id, activity_type, ref_table, ref_id)
       VALUES ($1, 'post_create', 'Post', $2)`,
      [req.user.user_id, post.post_id]
    );

    await client.query('COMMIT');

    // Return enriched post
    const { rows: enriched } = await query(
      `SELECT * FROM v_feed_post WHERE post_id = $1`,
      [post.post_id]
    );
    return R.created(res, enriched[0], 'Post created');
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};

// ── GET SINGLE POST ───────────────────────────────────────────
const getPost = async (req, res, next) => {
  const { post_id } = req.params;
  try {
    const { rows } = await query(
      `SELECT * FROM v_feed_post WHERE post_id = $1`,
      [post_id]
    );
    if (!rows.length) return R.notFound(res, 'Post not found');

    // Increment view count
    await query(
      `UPDATE "Post"
          SET view_count = view_count + 1
        WHERE post_id = $1`,
      [post_id]
    );
    return R.ok(res, rows[0]);
  } catch (err) { next(err); }
};

// ── UPDATE POST ───────────────────────────────────────────────
const updatePost = async (req, res, next) => {
  const { post_id } = req.params;
  const { body: postBody, hashtags, tags, visibility } = req.body;
  try {
    const own = await query(
      `SELECT author_id FROM "Post"
        WHERE post_id = $1 AND deleted_at IS NULL`,
      [post_id]
    );
    if (!own.rows.length) return R.notFound(res, 'Post not found');
    if (own.rows[0].author_id !== req.user.user_id
        && req.user.role !== 'admin')
      return R.forbidden(res, 'Not your post');

    const { rows } = await query(
      `UPDATE "Post"
          SET body       = COALESCE($1, body),
              hashtags   = COALESCE($2, hashtags),
              tags       = COALESCE($3, tags),
              visibility = COALESCE($4, visibility),
              is_edited  = TRUE,
              updated_at = NOW()
        WHERE post_id = $5
        RETURNING *`,
      [postBody,
       hashtags ? `{${hashtags.map(h=>`"${h}"`).join(',')}}` : null,
       tags     ? `{${tags.map(t=>`"${t}"`).join(',')}}` : null,
       visibility, post_id]
    );
    return R.ok(res, rows[0], 'Post updated');
  } catch (err) { next(err); }
};

// ── SOFT DELETE POST ──────────────────────────────────────────
const deletePost = async (req, res, next) => {
  const { post_id } = req.params;
  try {
    const own = await query(
      `SELECT author_id FROM "Post"
        WHERE post_id = $1 AND deleted_at IS NULL`,
      [post_id]
    );
    if (!own.rows.length) return R.notFound(res, 'Post not found');
    if (own.rows[0].author_id !== req.user.user_id
        && !['admin','moderator'].includes(req.user.role))
      return R.forbidden(res, 'Not your post');

    await query(
      `UPDATE "Post" SET deleted_at = NOW() WHERE post_id = $1`,
      [post_id]
    );
    return R.ok(res, null, 'Post deleted');
  } catch (err) { next(err); }
};

// ── REACT TO POST ─────────────────────────────────────────────
const reactToPost = async (req, res, next) => {
  const { post_id } = req.params;
  const { reaction_type = 'love' } = req.body;
  const VALID = ['love','haha','wow','sad','angry','care','paw'];
  if (!VALID.includes(reaction_type))
    return R.badRequest(res, `reaction_type must be one of: ${VALID.join(', ')}`);
  try {
    const existing = await query(
      `SELECT reaction_id, reaction_type FROM "Reaction"
        WHERE user_id = $1 AND ref_table = 'Post' AND ref_id = $2`,
      [req.user.user_id, post_id]
    );

    if (existing.rows.length) {
      if (existing.rows[0].reaction_type === reaction_type) {
        // Same reaction — remove it (toggle off)
        await query(
          `DELETE FROM "Reaction" WHERE reaction_id = $1`,
          [existing.rows[0].reaction_id]
        );
        return R.ok(res, { reacted: false }, 'Reaction removed');
      } else {
        // Different reaction — update
        await query(
          `UPDATE "Reaction" SET reaction_type = $1
            WHERE reaction_id = $2`,
          [reaction_type, existing.rows[0].reaction_id]
        );
        return R.ok(res, { reacted: true, reaction_type }, 'Reaction updated');
      }
    } else {
      await query(
        `INSERT INTO "Reaction"
           (user_id, reaction_type, ref_table, ref_id)
         VALUES ($1, $2, 'Post', $3)`,
        [req.user.user_id, reaction_type, post_id]
      );
      return R.ok(res, { reacted: true, reaction_type }, 'Reacted');
    }
  } catch (err) { next(err); }
};

// ── GET COMMENTS ──────────────────────────────────────────────
const getComments = async (req, res, next) => {
  const { post_id } = req.params;
  const { page, limit, offset } = req.pagination;
  try {
    const { rows: data } = await query(
      `SELECT c.comment_id, c.body, c.parent_id,
              c.is_vet_reply, c.reaction_count,
              c.is_edited, c.created_at,
              u.user_id AS author_id, u.username,
              u.full_name, u.avatar_url, u.role, u.is_verified
         FROM "Comment" c
         JOIN "User" u ON u.user_id = c.author_id
        WHERE c.post_id = $1
          AND c.deleted_at IS NULL
          AND c.parent_id IS NULL
        ORDER BY c.created_at ASC
        LIMIT $2 OFFSET $3`,
      [post_id, limit, offset]
    );
    const { rows: [{ total }] } = await query(
      `SELECT COUNT(*) AS total FROM "Comment"
        WHERE post_id = $1 AND deleted_at IS NULL AND parent_id IS NULL`,
      [post_id]
    );
    return R.paginated(res, data, { page, limit, total: parseInt(total) });
  } catch (err) { next(err); }
};

// ── ADD COMMENT ───────────────────────────────────────────────
const addComment = async (req, res, next) => {
  const { post_id } = req.params;
  const { body: commentBody, parent_id } = req.body;
  if (!commentBody?.trim())
    return R.badRequest(res, 'Comment body required');
  try {
    const { rows } = await query(
      `INSERT INTO "Comment"
         (post_id, author_id, parent_id, body, is_vet_reply)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING comment_id, body, created_at`,
      [post_id, req.user.user_id,
       parent_id || null, commentBody.trim(),
       req.user.role === 'vet']
    );
    return R.created(res, rows[0], 'Comment added');
  } catch (err) { next(err); }
};

// ── DELETE COMMENT ────────────────────────────────────────────
const deleteComment = async (req, res, next) => {
  const { comment_id } = req.params;
  try {
    const own = await query(
      `SELECT author_id FROM "Comment"
        WHERE comment_id = $1 AND deleted_at IS NULL`,
      [comment_id]
    );
    if (!own.rows.length) return R.notFound(res, 'Comment not found');
    if (own.rows[0].author_id !== req.user.user_id
        && !['admin','moderator'].includes(req.user.role))
      return R.forbidden(res, 'Not your comment');

    await query(
      `UPDATE "Comment" SET deleted_at = NOW() WHERE comment_id = $1`,
      [comment_id]
    );
    return R.ok(res, null, 'Comment deleted');
  } catch (err) { next(err); }
};

// ── USER POSTS ────────────────────────────────────────────────
const getUserPosts = async (req, res, next) => {
  const { user_id } = req.params;
  const { page, limit, offset } = req.pagination;
  try {
    const { rows: data } = await query(
      `SELECT * FROM v_feed_post
        WHERE author_id = $1
          AND visibility IN ('public','followers')
        ORDER BY created_at DESC
        LIMIT $2 OFFSET $3`,
      [user_id, limit, offset]
    );
    const { rows: [{ total }] } = await query(
      `SELECT COUNT(*) AS total FROM "Post"
        WHERE author_id = $1
          AND deleted_at IS NULL
          AND visibility IN ('public','followers')`,
      [user_id]
    );
    return R.paginated(res, data, { page, limit, total: parseInt(total) });
  } catch (err) { next(err); }
};

module.exports = {
  getFeed, createPost, getPost, updatePost, deletePost,
  reactToPost, getComments, addComment, deleteComment,
  getUserPosts
};
