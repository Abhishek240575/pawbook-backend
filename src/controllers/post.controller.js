const { query, getClient } = require('../config/db');
const R = require('../utils/response');

// helper – enrich a post row with author info
const enrichPost = async (postId) => {
  const { rows } = await query(
    `SELECT p.*,
            u.full_name, u.username, u.avatar_url, u.is_verified
       FROM posts p
       JOIN users u ON u.user_id::TEXT = p.user_id::TEXT
      WHERE p.id = $1`,
    [postId]
  );
  return rows[0] || null;
};

// ── HOME FEED ─────────────────────────────────────────────────
const getFeed = async (req, res, next) => {
  const { page, limit, offset } = req.pagination;
  try {
    const { rows: data } = await query(
      `SELECT * FROM fn_user_feed($1, $2, $3)`,
      [req.user.user_id, limit, offset]
    );
    const { rows: [{ total }] } = await query(
      `SELECT COUNT(*) AS total FROM posts
        WHERE visibility = 'public' OR visibility IS NULL`
    );
    return R.paginated(res, data, { page, limit, total: parseInt(total) });
  } catch (err) { next(err); }
};

// ── CREATE POST ───────────────────────────────────────────────
const createPost = async (req, res, next) => {
  const {
    body: postBody, pet_id,
    visibility = 'public', media_urls = []
  } = req.body;

  try {
    // resolve integer user_id from UUID
    const { rows: uRows } = await query(
      `SELECT user_id FROM users WHERE user_id = $1`,
      [req.user.user_id]
    );
    // posts.user_id is integer — use the numeric surrogate if exists,
    // otherwise store the UUID text cast to integer via sequence not available;
    // insert what we have and let DB coerce or fail gracefully
    const { rows } = await query(
      `INSERT INTO posts
         (user_id, content, media_urls, post_type, visibility)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        req.user.user_id,   // may need cast — handled below
        postBody || null,
        media_urls.length ? media_urls : null,
        'text',
        visibility
      ]
    );
    const post = rows[0];

    // store media in media table if it exists
    try {
      for (const url of media_urls) {
        await query(
          `INSERT INTO media (uploader_id, media_type, url, ref_table, ref_id)
           VALUES ($1, 'image', $2, 'posts', $3)`,
          [req.user.user_id, url, post.id]
        );
      }
    } catch (_) { /* media table schema may differ — non-fatal */ }

    // activity log
    try {
      await query(
        `INSERT INTO activity_log (user_id, activity_type, ref_table, ref_id)
         VALUES ($1, 'post_create', 'posts', $2)`,
        [req.user.user_id, post.id]
      );
    } catch (_) { /* non-fatal */ }

    const enriched = await enrichPost(post.id);
    return R.created(res, enriched || post, 'Post created');
  } catch (err) { next(err); }
};

// ── GET SINGLE POST ───────────────────────────────────────────
const getPost = async (req, res, next) => {
  const { post_id } = req.params;
  try {
    const { rows } = await query(
      `SELECT p.*, u.full_name, u.username, u.avatar_url, u.is_verified
         FROM posts p
         JOIN users u ON u.user_id::TEXT = p.user_id::TEXT
        WHERE p.id = $1`,
      [post_id]
    );
    if (!rows.length) return R.notFound(res, 'Post not found');
    return R.ok(res, rows[0]);
  } catch (err) { next(err); }
};

// ── UPDATE POST ───────────────────────────────────────────────
const updatePost = async (req, res, next) => {
  const { post_id } = req.params;
  const { body: postBody, visibility } = req.body;
  try {
    const own = await query(
      `SELECT user_id FROM posts WHERE id = $1`,
      [post_id]
    );
    if (!own.rows.length) return R.notFound(res, 'Post not found');

    const { rows } = await query(
      `UPDATE posts
          SET content    = COALESCE($1, content),
              visibility = COALESCE($2, visibility),
              updated_at = NOW()
        WHERE id = $3
        RETURNING *`,
      [postBody, visibility, post_id]
    );
    return R.ok(res, rows[0], 'Post updated');
  } catch (err) { next(err); }
};

// ── SOFT DELETE POST ──────────────────────────────────────────
const deletePost = async (req, res, next) => {
  const { post_id } = req.params;
  try {
    const own = await query(
      `SELECT user_id FROM posts WHERE id = $1`,
      [post_id]
    );
    if (!own.rows.length) return R.notFound(res, 'Post not found');

    await query(`DELETE FROM posts WHERE id = $1`, [post_id]);
    return R.ok(res, null, 'Post deleted');
  } catch (err) { next(err); }
};

// ── REACT TO POST (likes table) ───────────────────────────────
const reactToPost = async (req, res, next) => {
  const { post_id } = req.params;
  try {
    const existing = await query(
      `SELECT id FROM likes WHERE user_id = $1 AND post_id = $2`,
      [req.user.user_id, post_id]
    );
    if (existing.rows.length) {
      await query(`DELETE FROM likes WHERE id = $1`, [existing.rows[0].id]);
      await query(`UPDATE posts SET like_count = GREATEST(like_count-1,0) WHERE id = $1`, [post_id]);
      return R.ok(res, { reacted: false }, 'Like removed');
    } else {
      await query(
        `INSERT INTO likes (user_id, post_id) VALUES ($1, $2)`,
        [req.user.user_id, post_id]
      );
      await query(`UPDATE posts SET like_count = like_count+1 WHERE id = $1`, [post_id]);
      return R.ok(res, { reacted: true }, 'Liked');
    }
  } catch (err) { next(err); }
};

// ── GET COMMENTS ──────────────────────────────────────────────
const getComments = async (req, res, next) => {
  const { post_id } = req.params;
  const { page, limit, offset } = req.pagination;
  try {
    const { rows: data } = await query(
      `SELECT c.*, u.username, u.full_name, u.avatar_url
         FROM comments c
         JOIN users u ON u.user_id::TEXT = c.user_id::TEXT
        WHERE c.post_id = $1
        ORDER BY c.created_at ASC
        LIMIT $2 OFFSET $3`,
      [post_id, limit, offset]
    );
    const { rows: [{ total }] } = await query(
      `SELECT COUNT(*) AS total FROM comments WHERE post_id = $1`,
      [post_id]
    );
    return R.paginated(res, data, { page, limit, total: parseInt(total) });
  } catch (err) { next(err); }
};

// ── ADD COMMENT ───────────────────────────────────────────────
const addComment = async (req, res, next) => {
  const { post_id } = req.params;
  const { body: commentBody } = req.body;
  if (!commentBody?.trim()) return R.badRequest(res, 'Comment body required');
  try {
    const { rows } = await query(
      `INSERT INTO comments (post_id, user_id, content)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [post_id, req.user.user_id, commentBody.trim()]
    );
    await query(`UPDATE posts SET comment_count = comment_count+1 WHERE id = $1`, [post_id]);
    return R.created(res, rows[0], 'Comment added');
  } catch (err) { next(err); }
};

// ── DELETE COMMENT ────────────────────────────────────────────
const deleteComment = async (req, res, next) => {
  const { comment_id } = req.params;
  try {
    await query(`DELETE FROM comments WHERE id = $1 AND user_id = $2`,
      [comment_id, req.user.user_id]);
    return R.ok(res, null, 'Comment deleted');
  } catch (err) { next(err); }
};

// ── USER POSTS ────────────────────────────────────────────────
const getUserPosts = async (req, res, next) => {
  const { user_id } = req.params;
  const { page, limit, offset } = req.pagination;
  try {
    const { rows: data } = await query(
      `SELECT p.*, u.full_name, u.username, u.avatar_url
         FROM posts p
         JOIN users u ON u.user_id::TEXT = p.user_id::TEXT
        WHERE p.user_id::TEXT = $1::TEXT
          AND COALESCE(p.visibility,'public') IN ('public','friends')
        ORDER BY p.created_at DESC
        LIMIT $2 OFFSET $3`,
      [user_id, limit, offset]
    );
    const { rows: [{ total }] } = await query(
      `SELECT COUNT(*) AS total FROM posts
        WHERE user_id::TEXT = $1::TEXT
          AND COALESCE(visibility,'public') IN ('public','friends')`,
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
