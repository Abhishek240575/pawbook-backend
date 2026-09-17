const { query, getClient } = require('../config/db');
const R = require('../utils/response');

const getGroups = async (req, res, next) => {
  const { page, limit, offset } = req.pagination;
  const { category, city, q } = req.query;
  try {
    let where = `WHERE g.deleted_at IS NULL`;
    const params = [];
    let i = 1;
    if (category) { where += ` AND g.category = $${i++}`; params.push(category); }
    if (city)     { where += ` AND g.city ILIKE $${i++}`; params.push(`%${city}%`); }
    if (q)        { where += ` AND (g.name ILIKE $${i++} OR g.description ILIKE $${i-1})`; params.push(`%${q}%`); }

    const { rows: data } = await query(
      `SELECT g.group_id, g.name, g.description, g.category, g.city,
              g.cover_url, g.avatar_url, g.privacy, g.is_private, g.member_count,
              g.post_count, g.created_at,
              u.username AS creator_username, u.avatar_url AS creator_avatar,
              EXISTS(
                SELECT 1 FROM "Membership" m
                WHERE m.group_id = g.group_id AND m.user_id = $${i++} AND m.status = 'active'
              ) AS is_member
         FROM "Group" g
         JOIN "User" u ON u.user_id = g.creator_id
        ${where}
        ORDER BY g.member_count DESC, g.created_at DESC
        LIMIT $${i++} OFFSET $${i}`,
      [...params, req.user?.user_id || null, limit, offset]
    );
    const { rows: [{ total }] } = await query(
      `SELECT COUNT(*) AS total FROM "Group" g ${where}`, params
    );
    return R.paginated(res, data, { page, limit, total: parseInt(total) });
  } catch (err) { next(err); }
};

const createGroup = async (req, res, next) => {
  const { name, description, category, city, is_private = false, avatar_url, cover_url } = req.body;
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const slug = name.toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'');
    const { rows } = await client.query(
      `INSERT INTO "Group" (creator_id, name, slug, description, category, city, is_private, privacy, avatar_url, cover_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [req.user.user_id, name, slug, description||null, category||null, city||null,
       is_private, is_private?'private':'public', avatar_url||null, cover_url||null]
    );
    const group = rows[0];
    await client.query(
      `INSERT INTO "Membership" (group_id, user_id, role, status) VALUES ($1,$2,'admin','active')`,
      [group.group_id, req.user.user_id]
    );
    await client.query('COMMIT');
    return R.created(res, group, 'Group created');
  } catch (err) { await client.query('ROLLBACK'); next(err); }
  finally { client.release(); }
};

const getGroup = async (req, res, next) => {
  const { group_id } = req.params;
  try {
    const { rows } = await query(
      `SELECT g.*, u.username AS creator_username, u.avatar_url AS creator_avatar,
              EXISTS(SELECT 1 FROM "Membership" m WHERE m.group_id=g.group_id AND m.user_id=$2 AND m.status='active') AS is_member,
              (SELECT role FROM "Membership" WHERE group_id=g.group_id AND user_id=$2) AS my_role
         FROM "Group" g JOIN "User" u ON u.user_id=g.creator_id
        WHERE g.group_id=$1 AND g.deleted_at IS NULL`,
      [group_id, req.user?.user_id||null]
    );
    if (!rows.length) return R.notFound(res, 'Group not found');
    return R.ok(res, rows[0]);
  } catch (err) { next(err); }
};

const joinGroup = async (req, res, next) => {
  const { group_id } = req.params;
  const user_id = req.user.user_id;
  try {
    const existing = await query(
      `SELECT status FROM "Membership" WHERE group_id=$1 AND user_id=$2`, [group_id, user_id]
    );
    if (existing.rows.length && existing.rows[0].status === 'active') {
      await query(`DELETE FROM "Membership" WHERE group_id=$1 AND user_id=$2`, [group_id, user_id]);
      await query(`UPDATE "Group" SET member_count=GREATEST(0,member_count-1) WHERE group_id=$1`, [group_id]);
      return R.ok(res, { joined: false }, 'Left group');
    }
    const grp = await query(`SELECT privacy FROM "Group" WHERE group_id=$1 AND deleted_at IS NULL`, [group_id]);
    if (!grp.rows.length) return R.notFound(res, 'Group not found');
    const status = grp.rows[0].privacy === 'private' ? 'pending' : 'active';
    await query(
      `INSERT INTO "Membership" (group_id, user_id, role, status) VALUES ($1,$2,'member',$3)
       ON CONFLICT (group_id, user_id) DO UPDATE SET status=$3`,
      [group_id, user_id, status]
    );
    if (status === 'active') {
      await query(`UPDATE "Group" SET member_count=member_count+1 WHERE group_id=$1`, [group_id]);
    }
    return R.ok(res, { joined: true, status }, status==='pending'?'Request sent':'Joined group');
  } catch (err) { next(err); }
};

const getGroupFeed = async (req, res, next) => {
  const { group_id } = req.params;
  const { page, limit, offset } = req.pagination;
  try {
    const { rows: data } = await query(
      `SELECT p.*, u.username AS author_username, u.full_name AS author_name, u.avatar_url AS author_avatar
         FROM "Post" p JOIN "User" u ON u.user_id=p.author_id
        WHERE p.group_id=$1 AND p.deleted_at IS NULL
        ORDER BY p.created_at DESC LIMIT $2 OFFSET $3`,
      [group_id, limit, offset]
    );
    const { rows:[{total}] } = await query(
      `SELECT COUNT(*) AS total FROM "Post" WHERE group_id=$1 AND deleted_at IS NULL`, [group_id]
    );
    return R.paginated(res, data, { page, limit, total: parseInt(total) });
  } catch (err) { next(err); }
};

const postInGroup = async (req, res, next) => {
  const { group_id } = req.params;
  const { body: postBody } = req.body;
  try {
    const member = await query(
      `SELECT 1 FROM "Membership" WHERE group_id=$1 AND user_id=$2 AND status='active'`,
      [group_id, req.user.user_id]
    );
    if (!member.rows.length) return R.forbidden(res, 'You must be a member to post');
    const client = await getClient();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO "Post" (author_id, group_id, body, visibility) VALUES ($1,$2,$3,'group') RETURNING *`,
        [req.user.user_id, group_id, postBody||null]
      );
      await client.query(`UPDATE "Group" SET post_count=post_count+1 WHERE group_id=$1`, [group_id]);
      await client.query('COMMIT');
      return R.created(res, rows[0], 'Post created');
    } catch(err) { await client.query('ROLLBACK'); throw err; }
    finally { client.release(); }
  } catch (err) { next(err); }
};

const getGroupMembers = async (req, res, next) => {
  const { group_id } = req.params;
  const { page, limit, offset } = req.pagination;
  try {
    const { rows: data } = await query(
      `SELECT u.user_id, u.username, u.full_name, u.avatar_url, u.is_verified, m.role, m.joined_at
         FROM "Membership" m JOIN "User" u ON u.user_id=m.user_id
        WHERE m.group_id=$1 AND m.status='active'
        ORDER BY CASE m.role WHEN 'admin' THEN 1 WHEN 'moderator' THEN 2 ELSE 3 END, m.joined_at ASC
        LIMIT $2 OFFSET $3`,
      [group_id, limit, offset]
    );
    const { rows:[{total}] } = await query(
      `SELECT COUNT(*) AS total FROM "Membership" WHERE group_id=$1 AND status='active'`, [group_id]
    );
    return R.paginated(res, data, { page, limit, total: parseInt(total) });
  } catch (err) { next(err); }
};

module.exports = { getGroups, createGroup, getGroup, joinGroup, getGroupFeed, postInGroup, getGroupMembers };
