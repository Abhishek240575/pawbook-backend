// routes/groups.js — Pet Groups / Communities
// "Group" table (Prisma PascalCase, double-quoted): id UUID, name, description, "ownerId" UUID, ...
// GroupMember table (real columns): member_id UUID, group_id UUID, user_id UUID, role, joined_at
// users: user_id UUID, username, avatar_url
const express = require('express');
const router  = express.Router();
const { pool } = require('../db');
const auth    = require('../middleware/auth');

// GET /api/v1/groups — list all groups
router.get('/', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT g.*, u.username AS owner_name, u.avatar_url AS owner_avatar,
              (SELECT COUNT(*)::int FROM "GroupMember" gm WHERE gm.group_id = g.id) AS member_count
       FROM "Group" g
       JOIN users u ON u.user_id = g."ownerId"
       ORDER BY g.created_at DESC
       LIMIT 50`
    );
    res.json({ data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load groups' });
  }
});

// GET /api/v1/groups/my — groups the current user belongs to
router.get('/my', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT g.*, u.username AS owner_name, u.avatar_url AS owner_avatar,
              gm.role AS my_role,
              (SELECT COUNT(*)::int FROM "GroupMember" gm2 WHERE gm2.group_id = g.id) AS member_count
       FROM "GroupMember" gm
       JOIN "Group" g ON g.id = gm.group_id
       JOIN users u ON u.user_id = g."ownerId"
       WHERE gm.user_id = $1
       ORDER BY gm.joined_at DESC`,
      [req.user.id]
    );
    res.json({ data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load your groups' });
  }
});

// GET /api/v1/groups/:id — single group
router.get('/:id', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT g.*, u.username AS owner_name, u.avatar_url AS owner_avatar,
              (SELECT COUNT(*)::int FROM "GroupMember" gm WHERE gm.group_id = g.id) AS member_count,
              (SELECT role FROM "GroupMember" WHERE group_id = g.id AND user_id = $2) AS my_role
       FROM "Group" g
       JOIN users u ON u.user_id = g."ownerId"
       WHERE g.id = $1`,
      [req.params.id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Group not found' });
    res.json({ data: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load group' });
  }
});

// POST /api/v1/groups — create group
router.post('/', auth, async (req, res) => {
  const { name, description, cover_image, is_private } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });

  try {
    const { rows: [group] } = await pool.query(
      `INSERT INTO "Group" (name, description, cover_image, is_private, "ownerId", created_at)
       VALUES ($1,$2,$3,$4,$5,NOW()) RETURNING *`,
      [name, description || null, cover_image || null, is_private || false, req.user.id]
    );
    // Auto-join as admin
    await pool.query(
      `INSERT INTO "GroupMember" (group_id, user_id, role, joined_at)
       VALUES ($1,$2,'admin',NOW())`,
      [group.id, req.user.id]
    );
    res.status(201).json({ data: group });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create group' });
  }
});

// PATCH /api/v1/groups/:id — update group (owner only)
router.patch('/:id', auth, async (req, res) => {
  const { name, description, cover_image, is_private } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE "Group"
       SET name=$1, description=$2, cover_image=$3, is_private=$4
       WHERE id=$5 AND "ownerId"=$6
       RETURNING *`,
      [name, description, cover_image, is_private, req.params.id, req.user.id]
    );
    if (!rows.length) return res.status(403).json({ error: 'Not allowed' });
    res.json({ data: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update group' });
  }
});

// DELETE /api/v1/groups/:id — delete group (owner only)
router.delete('/:id', auth, async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM "Group" WHERE id=$1 AND "ownerId"=$2`,
      [req.params.id, req.user.id]
    );
    if (!rowCount) return res.status(403).json({ error: 'Not allowed' });
    res.json({ deleted: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete group' });
  }
});

// GET /api/v1/groups/:id/members
router.get('/:id/members', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.user_id, u.username, u.avatar_url, gm.role, gm.joined_at
       FROM "GroupMember" gm
       JOIN users u ON u.user_id = gm.user_id
       WHERE gm.group_id = $1
       ORDER BY gm.joined_at ASC`,
      [req.params.id]
    );
    res.json({ data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load members' });
  }
});

// POST /api/v1/groups/:id/join
router.post('/:id/join', auth, async (req, res) => {
  try {
    await pool.query(
      `INSERT INTO "GroupMember" (group_id, user_id, role, joined_at)
       VALUES ($1,$2,'member',NOW())
       ON CONFLICT DO NOTHING`,
      [req.params.id, req.user.id]
    );
    res.json({ joined: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to join group' });
  }
});

// DELETE /api/v1/groups/:id/leave
router.delete('/:id/leave', auth, async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM "GroupMember" WHERE group_id=$1 AND user_id=$2`,
      [req.params.id, req.user.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Not a member' });
    res.json({ left: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to leave group' });
  }
});

// DELETE /api/v1/groups/:id/members/:userId — remove member (admin/owner only)
router.delete('/:id/members/:userId', auth, async (req, res) => {
  try {
    // Check caller is admin or owner
    const { rows: [me] } = await pool.query(
      `SELECT gm.role FROM "GroupMember" gm WHERE gm.group_id=$1 AND gm.user_id=$2`,
      [req.params.id, req.user.id]
    );
    const { rows: [grp] } = await pool.query(
      `SELECT "ownerId" FROM "Group" WHERE id=$1`, [req.params.id]
    );
    const isOwner = grp && grp.ownerId === req.user.id;
    const isAdmin = me && me.role === 'admin';
    if (!isOwner && !isAdmin) return res.status(403).json({ error: 'Not allowed' });

    await pool.query(
      `DELETE FROM "GroupMember" WHERE group_id=$1 AND user_id=$2`,
      [req.params.id, req.params.userId]
    );
    res.json({ removed: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to remove member' });
  }
});

module.exports = router;
