// routes/groups.js
const express = require('express');
const router  = express.Router();
const { query, getClient } = require('../config/db');
const { authenticate } = require('../middleware');

async function getUserNo(userUuid) {
  const { rows } = await query(`SELECT user_no FROM users WHERE user_id=$1`, [userUuid]);
  return rows.length ? rows[0].user_no : null;
}

router.get('/', authenticate, async (req, res) => {
  const { category, search } = req.query;
  try {
    const userNo = await getUserNo(req.user.user_id);
    if (!userNo) return res.status(401).json({ error: 'User not found' });

    let sql = `
      SELECT g.*, u.username AS owner_name, u.avatar_url AS owner_avatar,
             (SELECT 1 FROM group_memberships gm WHERE gm.group_id=g.id AND gm.user_id=$1) AS is_member
      FROM groups g
      JOIN users u ON g.owner_id = u.user_no
      WHERE (g.privacy='public' OR g.owner_id=$1
             OR EXISTS (SELECT 1 FROM group_memberships WHERE group_id=g.id AND user_id=$1))
    `;
    const params = [userNo];
    if (category) { params.push(category); sql += ` AND g.category=$${params.length}`; }
    if (search)   { params.push(`%${search}%`); sql += ` AND g.name ILIKE $${params.length}`; }
    sql += ` ORDER BY g.member_count DESC LIMIT 50`;

    const { rows } = await query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load groups' });
  }
});

router.get('/:id', authenticate, async (req, res) => {
  try {
    const userNo = await getUserNo(req.user.user_id);
    if (!userNo) return res.status(401).json({ error: 'User not found' });

    const { rows } = await query(
      `SELECT g.*, u.username AS owner_name,
              (SELECT role FROM group_memberships WHERE group_id=g.id AND user_id=$2) AS my_role
       FROM groups g
       JOIN users u ON g.owner_id = u.user_no
       WHERE g.id=$1`,
      [req.params.id, userNo]
    );
    if (!rows.length) return res.status(404).json({ error: 'Group not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load group' });
  }
});

router.post('/', authenticate, async (req, res) => {
  const { name, description, cover_img, privacy, category } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const client = await getClient();
  try {
    const { rows: u } = await client.query(`SELECT user_no FROM users WHERE user_id=$1`, [req.user.user_id]);
    if (!u.length) { client.release(); return res.status(401).json({ error: 'User not found' }); }
    const userNo = u[0].user_no;

    await client.query('BEGIN');
    const { rows: [group] } = await client.query(
      `INSERT INTO groups (name, description, cover_img, privacy, category, owner_id)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [name, description || null, cover_img || null, privacy || 'public', category || null, userNo]
    );
    await client.query(
      `INSERT INTO group_memberships (group_id, user_id, role) VALUES ($1,$2,'admin')`,
      [group.id, userNo]
    );
    await client.query('COMMIT');
    res.status(201).json(group);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Failed to create group' });
  } finally { client.release(); }
});

router.post('/:id/join', authenticate, async (req, res) => {
  try {
    const userNo = await getUserNo(req.user.user_id);
    if (!userNo) return res.status(401).json({ error: 'User not found' });

    const { rows: [group] } = await query(`SELECT id, privacy FROM groups WHERE id=$1`, [req.params.id]);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    if (group.privacy === 'private') return res.status(403).json({ error: 'This group is private' });

    await query(
      `INSERT INTO group_memberships (group_id, user_id, role) VALUES ($1,$2,'member')
       ON CONFLICT (group_id, user_id) DO NOTHING`,
      [req.params.id, userNo]
    );
    await query(`UPDATE groups SET member_count = member_count + 1 WHERE id=$1`, [req.params.id]);
    res.json({ joined: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to join group' });
  }
});

router.delete('/:id/leave', authenticate, async (req, res) => {
  try {
    const userNo = await getUserNo(req.user.user_id);
    if (!userNo) return res.status(401).json({ error: 'User not found' });

    const { rowCount } = await query(
      `DELETE FROM group_memberships WHERE group_id=$1 AND user_id=$2`,
      [req.params.id, userNo]
    );
    if (!rowCount) return res.status(404).json({ error: 'Not a member' });
    await query(`UPDATE groups SET member_count = GREATEST(member_count - 1, 0) WHERE id=$1`, [req.params.id]);
    res.json({ left: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to leave group' });
  }
});

router.get('/:id/members', authenticate, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT gm.role, gm.joined_at, u.user_no AS id, u.username AS name, u.avatar_url AS avatar
       FROM group_memberships gm
       JOIN users u ON gm.user_id = u.user_no
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
