// routes/groups.js — Pet Owner Groups & Memberships
const express = require('express');
const router  = express.Router();
const { pool } = require('../db');
const auth    = require('../middleware/auth');

// GET /api/groups — list all public groups (+ user's private ones)
router.get('/', auth, async (req, res) => {
  const { category, search } = req.query;
  let query = `
    SELECT g.*, u.name AS owner_name,
           (SELECT 1 FROM group_memberships gm
            WHERE gm.group_id=g.id AND gm.user_id=$1) AS is_member
    FROM groups g
    JOIN users u ON g.owner_id = u.id
    WHERE (g.privacy='public' OR g.owner_id=$1
           OR EXISTS (SELECT 1 FROM group_memberships
                      WHERE group_id=g.id AND user_id=$1))
  `;
  const params = [req.user.id];
  if (category) { params.push(category); query += ` AND g.category=$${params.length}`; }
  if (search)   { params.push(`%${search}%`); query += ` AND g.name ILIKE $${params.length}`; }
  query += ` ORDER BY g.member_count DESC LIMIT 50`;

  try {
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load groups' });
  }
});

// GET /api/groups/:id — group detail with membership status
router.get('/:id', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT g.*, u.name AS owner_name,
              (SELECT role FROM group_memberships
               WHERE group_id=g.id AND user_id=$2) AS my_role
       FROM groups g
       JOIN users u ON g.owner_id = u.id
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

// POST /api/groups — create a new group
router.post('/', auth, async (req, res) => {
  const { name, description, cover_img, privacy, category } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [group] } = await client.query(
      `INSERT INTO groups (name, description, cover_img, privacy, category, owner_id)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [name, description || null, cover_img || null,
       privacy || 'public', category || null, req.user.id]
    );

    // Auto-join creator as admin
    await client.query(
      `INSERT INTO group_memberships (group_id, user_id, role)
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

// POST /api/groups/:id/join — join a group
router.post('/:id/join', auth, async (req, res) => {
  try {
    // Check group exists & is public (or user was invited)
    const { rows: [group] } = await pool.query(
      `SELECT id, privacy, member_count FROM groups WHERE id=$1`,
      [req.params.id]
    );
    if (!group) return res.status(404).json({ error: 'Group not found' });
    if (group.privacy === 'private') {
      return res.status(403).json({ error: 'This group is private' });
    }

    await pool.query(
      `INSERT INTO group_memberships (group_id, user_id, role)
       VALUES ($1,$2,'member')
       ON CONFLICT (group_id, user_id) DO NOTHING`,
      [req.params.id, req.user.id]
    );

    await pool.query(
      `UPDATE groups SET member_count = member_count + 1 WHERE id=$1`,
      [req.params.id]
    );

    res.json({ joined: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to join group' });
  }
});

// DELETE /api/groups/:id/leave — leave a group
router.delete('/:id/leave', auth, async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM group_memberships WHERE group_id=$1 AND user_id=$2`,
      [req.params.id, req.user.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Not a member' });

    await pool.query(
      `UPDATE groups SET member_count = GREATEST(member_count - 1, 0) WHERE id=$1`,
      [req.params.id]
    );

    res.json({ left: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to leave group' });
  }
});

// GET /api/groups/:id/members — list group members
router.get('/:id/members', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT gm.role, gm.joined_at, u.id, u.name, u.avatar
       FROM group_memberships gm
       JOIN users u ON gm.user_id = u.id
       WHERE gm.group_id=$1
       ORDER BY gm.role DESC, gm.joined_at ASC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load members' });
  }
});

module.exports = router;
