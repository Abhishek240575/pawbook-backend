// routes/groups.js — Pet Owner Groups & Memberships
const express = require('express');
const router  = express.Router();
const { pool } = require('../db');
const auth    = require('../middleware/auth');

// GET /api/v1/groups — list all public groups (+ user's own/joined)
router.get('/', auth, async (req, res) => {
  const { category, search } = req.query;
  let query = `
    SELECT g.*, u.username AS owner_name,
           (SELECT 1 FROM "GroupMember" gm
            WHERE gm."groupId"=g.id AND gm."userId"=$1) AS is_member
    FROM "Group" g
    JOIN users u ON g."ownerId" = u.id
    WHERE (g.privacy='public' OR g."ownerId"=$1
           OR EXISTS (SELECT 1 FROM "GroupMember"
                      WHERE "groupId"=g.id AND "userId"=$1))
  `;
  const params = [req.user.id];
  if (category) { params.push(category);       query += ` AND g.category=$${params.length}`; }
  if (search)   { params.push(`%${search}%`);  query += ` AND g.name ILIKE $${params.length}`; }
  query += ` ORDER BY g."memberCount" DESC LIMIT 50`;

  try {
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load groups' });
  }
});

// GET /api/v1/groups/:id — group detail
router.get('/:id', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT g.*, u.username AS owner_name,
              (SELECT role FROM "GroupMember"
               WHERE "groupId"=g.id AND "userId"=$2) AS my_role
       FROM "Group" g
       JOIN users u ON g."ownerId" = u.id
       WHERE g.id=$1`,
      [req.params.id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Group not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load group' });
  }
});

// POST /api/v1/groups — create a new group
router.post('/', auth, async (req, res) => {
  const { name, description, cover_img, privacy, category } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [group] } = await client.query(
      `INSERT INTO "Group" (name, description, "coverImg", privacy, category, "ownerId")
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [name, description || null, cover_img || null,
       privacy || 'public', category || null, req.user.id]
    );

    // Auto-join creator as admin
    await client.query(
      `INSERT INTO "GroupMember" ("groupId", "userId", role)
       VALUES ($1,$2,'admin')`,
      [group.id, req.user.id]
    );

    await client.query('COMMIT');
    res.status(201).json(group);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Failed to create group' });
  } finally {
    client.release();
  }
});

// POST /api/v1/groups/:id/join
router.post('/:id/join', auth, async (req, res) => {
  try {
    const { rows: [group] } = await pool.query(
      `SELECT id, privacy FROM "Group" WHERE id=$1`,
      [req.params.id]
    );
    if (!group) return res.status(404).json({ error: 'Group not found' });
    if (group.privacy === 'private') {
      return res.status(403).json({ error: 'This group is private' });
    }

    await pool.query(
      `INSERT INTO "GroupMember" ("groupId", "userId", role)
       VALUES ($1,$2,'member')
       ON CONFLICT ("groupId", "userId") DO NOTHING`,
      [req.params.id, req.user.id]
    );
    await pool.query(
      `UPDATE "Group" SET "memberCount" = "memberCount" + 1 WHERE id=$1`,
      [req.params.id]
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
      `DELETE FROM "GroupMember" WHERE "groupId"=$1 AND "userId"=$2`,
      [req.params.id, req.user.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Not a member' });

    await pool.query(
      `UPDATE "Group" SET "memberCount" = GREATEST("memberCount" - 1, 0) WHERE id=$1`,
      [req.params.id]
    );
    res.json({ left: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to leave group' });
  }
});

// GET /api/v1/groups/:id/members
router.get('/:id/members', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT gm.role, gm."joinedAt", u.user_id, u.username, u.avatar_url
       FROM "GroupMember" gm
       JOIN users u ON gm."userId" = u.id
       WHERE gm."groupId"=$1
       ORDER BY gm.role DESC, gm."joinedAt" ASC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load members' });
  }
});

module.exports = router;
