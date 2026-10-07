// src/controllers/group.controller.js
const { query } = require('../config/db');
const R = require('../utils/response');

// ── LIST GROUPS ─────────────────────────────────────────────────────────────
exports.getGroups = async (req, res, next) => {
  const { page, limit, offset } = req.pagination;
  const { search, category, city } = req.query;
  try {
    let where = ['g.is_active = TRUE'];
    const params = [];

    if (search) {
      params.push(`%${search}%`);
      where.push(`(g.name ILIKE $${params.length} OR g.description ILIKE $${params.length})`);
    }
    if (category) {
      params.push(category);
      where.push(`g.category = $${params.length}`);
    }
    if (city) {
      params.push(`%${city}%`);
      where.push(`g.city ILIKE $${params.length}`);
    }

    const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';

    // Check membership for logged-in user
    const userJoin = req.user
      ? `LEFT JOIN "GroupMember" gm ON gm.group_id = g.group_id AND gm.user_id = '${req.user.user_id}'`
      : '';
    const memberField = req.user ? ', gm.role AS my_role' : ', NULL AS my_role';

    params.push(limit, offset);
    const { rows: data } = await query(
      `SELECT g.*, u.username AS creator_username, u.avatar_url AS creator_avatar
              ${memberField}
         FROM "Group" g
         JOIN "User" u ON u.user_id = g.creator_id
         ${userJoin}
         ${whereClause}
         ORDER BY g.member_count DESC, g.created_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const countParams = params.slice(0, params.length - 2);
    const { rows: [{ total }] } = await query(
      `SELECT COUNT(*) AS total FROM "Group" g ${whereClause}`,
      countParams
    );

    return R.paginated(res, data, { page, limit, total: parseInt(total) });
  } catch (err) { next(err); }
};

// ── GET SINGLE GROUP ─────────────────────────────────────────────────────────
exports.getGroup = async (req, res, next) => {
  const { group_id } = req.params;
  try {
    const { rows } = await query(
      `SELECT g.*, u.username AS creator_username, u.avatar_url AS creator_avatar,
              (SELECT role FROM "GroupMember" WHERE group_id = g.group_id AND user_id = $2) AS my_role,
              (SELECT status FROM "GroupJoinRequest" WHERE group_id = g.group_id AND user_id = $2 AND status = 'pending') AS my_request_status
         FROM "Group" g
         JOIN "User" u ON u.user_id = g.creator_id
        WHERE g.group_id = $1 AND g.is_active = TRUE`,
      [group_id, req.user.user_id]
    );
    if (!rows[0]) return R.notFound(res, 'Group not found');
    return R.success(res, rows[0]);
  } catch (err) { next(err); }
};

// ── CREATE GROUP ─────────────────────────────────────────────────────────────
exports.createGroup = async (req, res, next) => {
  const { name, description, group_type = 'public', category, city, cover_url } = req.body;
  const creator_id = req.user.user_id;
  try {
    const { rows: [group] } = await query(
      `INSERT INTO "Group" (name, description, group_type, category, city, cover_url, creator_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [name, description, group_type, category, city, cover_url, creator_id]
    );
    // Creator becomes admin member automatically
    await query(
      `INSERT INTO "GroupMember" (group_id, user_id, role) VALUES ($1,$2,'admin')`,
      [group.group_id, creator_id]
    );
    return R.created(res, group);
  } catch (err) { next(err); }
};

// ── JOIN GROUP ───────────────────────────────────────────────────────────────
exports.joinGroup = async (req, res, next) => {
  const { group_id } = req.params;
  const user_id = req.user.user_id;
  const { pet_name, pet_type, city, why_joining, years_as_owner } = req.body;
  try {
    // Check group exists
    const { rows: [group] } = await query(
      `SELECT * FROM "Group" WHERE group_id = $1 AND is_active = TRUE`,
      [group_id]
    );
    if (!group) return R.notFound(res, 'Group not found');

    // Already a member?
    const { rows: [existing] } = await query(
      `SELECT member_id FROM "GroupMember" WHERE group_id=$1 AND user_id=$2`,
      [group_id, user_id]
    );
    if (existing) return R.error(res, 'Already a member', 409);

    // Pending request?
    const { rows: [pending] } = await query(
      `SELECT request_id FROM "GroupJoinRequest" WHERE group_id=$1 AND user_id=$2 AND status='pending'`,
      [group_id, user_id]
    );
    if (pending) return R.error(res, 'Join request already pending', 409);

    if (group.group_type === 'public') {
      // Auto-approve: record the form data in join request (approved), then add member
      await query(
        `INSERT INTO "GroupJoinRequest"
           (group_id, user_id, pet_name, pet_type, city, why_joining, years_as_owner, status, reviewed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'approved',NOW())
         ON CONFLICT (group_id, user_id) DO NOTHING`,
        [group_id, user_id, pet_name, pet_type, city, why_joining, years_as_owner]
      );
      await query(
        `INSERT INTO "GroupMember" (group_id, user_id, role) VALUES ($1,$2,'member')
         ON CONFLICT DO NOTHING`,
        [group_id, user_id]
      );
      return R.success(res, { joined: true, message: 'Joined successfully!' });
    } else {
      // Private: create pending request
      await query(
        `INSERT INTO "GroupJoinRequest"
           (group_id, user_id, pet_name, pet_type, city, why_joining, years_as_owner)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (group_id, user_id) DO NOTHING`,
        [group_id, user_id, pet_name, pet_type, city, why_joining, years_as_owner]
      );
      // Notify group admins
      const { rows: admins } = await query(
        `SELECT user_id FROM "GroupMember" WHERE group_id=$1 AND role='admin'`,
        [group_id]
      );
      for (const admin of admins) {
        await query(
          `INSERT INTO "Notification" (recipient_id, sender_id, type, reference_id, message)
           VALUES ($1,$2,'group_join_request',$3,$4)`,
          [admin.user_id, user_id, group_id, `Someone requested to join your group "${group.name}"`]
        );
      }
      return R.success(res, { joined: false, message: 'Join request sent — awaiting admin approval.' });
    }
  } catch (err) { next(err); }
};

// ── GET GROUP FEED ────────────────────────────────────────────────────────────
exports.getGroupFeed = async (req, res, next) => {
  const { group_id } = req.params;
  const { page, limit, offset } = req.pagination;
  const user_id = req.user.user_id;
  try {
    // Must be a member
    const { rows: [member] } = await query(
      `SELECT role FROM "GroupMember" WHERE group_id=$1 AND user_id=$2`,
      [group_id, user_id]
    );
    if (!member) return R.forbidden(res, 'You must be a member to view this group\'s posts');

    const { rows: data } = await query(
      `SELECT p.*, u.username, u.avatar_url,
              (SELECT COUNT(*) FROM "Comment" WHERE post_id=p.post_id) AS comment_count,
              (SELECT COUNT(*) FROM "Reaction" WHERE post_id=p.post_id) AS reaction_count
         FROM "Post" p
         JOIN "User" u ON u.user_id = p.user_id
        WHERE p.group_id = $1
        ORDER BY p.created_at DESC
        LIMIT $2 OFFSET $3`,
      [group_id, limit, offset]
    );
    const { rows: [{ total }] } = await query(
      `SELECT COUNT(*) AS total FROM "Post" WHERE group_id=$1`,
      [group_id]
    );
    return R.paginated(res, data, { page, limit, total: parseInt(total) });
  } catch (err) { next(err); }
};

// ── POST IN GROUP ──────────────────────────────────────────────────────────────
exports.postInGroup = async (req, res, next) => {
  const { group_id } = req.params;
  const user_id = req.user.user_id;
  const { body: postBody, media_urls } = req.body;
  try {
    const { rows: [member] } = await query(
      `SELECT role FROM "GroupMember" WHERE group_id=$1 AND user_id=$2`,
      [group_id, user_id]
    );
    if (!member) return R.forbidden(res, 'You must be a member to post');

    const { rows: [post] } = await query(
      `INSERT INTO "Post" (user_id, body, visibility, group_id, media_urls)
       VALUES ($1,$2,'group',$3,$4) RETURNING *`,
      [user_id, postBody, group_id, media_urls || []]
    );
    return R.created(res, post);
  } catch (err) { next(err); }
};

// ── GET GROUP MEMBERS ──────────────────────────────────────────────────────────
exports.getGroupMembers = async (req, res, next) => {
  const { group_id } = req.params;
  const { page, limit, offset } = req.pagination;
  try {
    const { rows: data } = await query(
      `SELECT gm.role, gm.joined_at, u.user_id, u.username, u.full_name, u.avatar_url
         FROM "GroupMember" gm
         JOIN "User" u ON u.user_id = gm.user_id
        WHERE gm.group_id = $1
        ORDER BY CASE gm.role WHEN 'admin' THEN 1 WHEN 'moderator' THEN 2 ELSE 3 END, gm.joined_at
        LIMIT $2 OFFSET $3`,
      [group_id, limit, offset]
    );
    const { rows: [{ total }] } = await query(
      `SELECT COUNT(*) AS total FROM "GroupMember" WHERE group_id=$1`,
      [group_id]
    );
    return R.paginated(res, data, { page, limit, total: parseInt(total) });
  } catch (err) { next(err); }
};

// ── GET JOIN REQUESTS (admin only) ────────────────────────────────────────────
exports.getJoinRequests = async (req, res, next) => {
  const { group_id } = req.params;
  const user_id = req.user.user_id;
  const { page, limit, offset } = req.pagination;
  try {
    const { rows: [admin] } = await query(
      `SELECT role FROM "GroupMember" WHERE group_id=$1 AND user_id=$2 AND role IN ('admin','moderator')`,
      [group_id, user_id]
    );
    if (!admin) return R.forbidden(res, 'Admins only');

    const { rows: data } = await query(
      `SELECT jr.*, u.username, u.full_name, u.avatar_url
         FROM "GroupJoinRequest" jr
         JOIN "User" u ON u.user_id = jr.user_id
        WHERE jr.group_id=$1 AND jr.status='pending'
        ORDER BY jr.created_at
        LIMIT $2 OFFSET $3`,
      [group_id, limit, offset]
    );
    const { rows: [{ total }] } = await query(
      `SELECT COUNT(*) AS total FROM "GroupJoinRequest" WHERE group_id=$1 AND status='pending'`,
      [group_id]
    );
    return R.paginated(res, data, { page, limit, total: parseInt(total) });
  } catch (err) { next(err); }
};

// ── REVIEW JOIN REQUEST (admin approve/reject) ────────────────────────────────
exports.reviewJoinRequest = async (req, res, next) => {
  const { group_id, request_id } = req.params;
  const { action } = req.body; // 'approve' | 'reject'
  const reviewer_id = req.user.user_id;
  try {
    const { rows: [admin] } = await query(
      `SELECT role FROM "GroupMember" WHERE group_id=$1 AND user_id=$2 AND role IN ('admin','moderator')`,
      [group_id, reviewer_id]
    );
    if (!admin) return R.forbidden(res, 'Admins only');

    const status = action === 'approve' ? 'approved' : 'rejected';
    const { rows: [jr] } = await query(
      `UPDATE "GroupJoinRequest"
          SET status=$1, reviewed_by=$2, reviewed_at=NOW()
        WHERE request_id=$3 AND group_id=$4 AND status='pending'
       RETURNING *`,
      [status, reviewer_id, request_id, group_id]
    );
    if (!jr) return R.notFound(res, 'Request not found or already reviewed');

    if (status === 'approved') {
      await query(
        `INSERT INTO "GroupMember" (group_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [group_id, jr.user_id]
      );
    }

    // Notify requester
    const { rows: [grp] } = await query(`SELECT name FROM "Group" WHERE group_id=$1`, [group_id]);
    await query(
      `INSERT INTO "Notification" (recipient_id, sender_id, type, reference_id, message)
       VALUES ($1,$2,'group_request_reviewed',$3,$4)`,
      [jr.user_id, reviewer_id, group_id,
       status === 'approved'
         ? `Your request to join "${grp.name}" was approved!`
         : `Your request to join "${grp.name}" was declined.`]
    );

    return R.success(res, { status, message: `Request ${status}` });
  } catch (err) { next(err); }
};

// ── INVITE USER TO GROUP ──────────────────────────────────────────────────────
exports.inviteToGroup = async (req, res, next) => {
  const { group_id } = req.params;
  const inviter_id = req.user.user_id;
  const { invitee_id } = req.body;
  try {
    const { rows: [member] } = await query(
      `SELECT role FROM "GroupMember" WHERE group_id=$1 AND user_id=$2`,
      [group_id, inviter_id]
    );
    if (!member) return R.forbidden(res, 'You must be a member to invite');

    await query(
      `INSERT INTO "GroupInvite" (group_id, inviter_id, invitee_id)
       VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
      [group_id, inviter_id, invitee_id]
    );

    const { rows: [grp] } = await query(`SELECT name FROM "Group" WHERE group_id=$1`, [group_id]);
    await query(
      `INSERT INTO "Notification" (recipient_id, sender_id, type, reference_id, message)
       VALUES ($1,$2,'group_invite',$3,$4)`,
      [invitee_id, inviter_id, group_id, `You've been invited to join the group "${grp.name}"`]
    );

    return R.success(res, { message: 'Invitation sent' });
  } catch (err) { next(err); }
};

// ── ACCEPT / DECLINE INVITE ───────────────────────────────────────────────────
exports.respondToInvite = async (req, res, next) => {
  const { invite_id } = req.params;
  const { action } = req.body; // 'accept' | 'decline'
  const user_id = req.user.user_id;
  try {
    const status = action === 'accept' ? 'accepted' : 'declined';
    const { rows: [inv] } = await query(
      `UPDATE "GroupInvite" SET status=$1
        WHERE invite_id=$2 AND invitee_id=$3 AND status='pending'
       RETURNING *`,
      [status, invite_id, user_id]
    );
    if (!inv) return R.notFound(res, 'Invite not found');

    if (status === 'accepted') {
      await query(
        `INSERT INTO "GroupMember" (group_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [inv.group_id, user_id]
      );
    }
    return R.success(res, { message: `Invite ${status}` });
  } catch (err) { next(err); }
};

// ── LEAVE GROUP ────────────────────────────────────────────────────────────────
exports.leaveGroup = async (req, res, next) => {
  const { group_id } = req.params;
  const user_id = req.user.user_id;
  try {
    const { rows: [member] } = await query(
      `SELECT role FROM "GroupMember" WHERE group_id=$1 AND user_id=$2`,
      [group_id, user_id]
    );
    if (!member) return R.error(res, 'Not a member', 400);
    if (member.role === 'admin') {
      // Check if any other admins exist
      const { rows: otherAdmins } = await query(
        `SELECT user_id FROM "GroupMember" WHERE group_id=$1 AND role='admin' AND user_id!=$2`,
        [group_id, user_id]
      );
      if (!otherAdmins.length) return R.error(res, 'Assign another admin before leaving', 400);
    }
    await query(`DELETE FROM "GroupMember" WHERE group_id=$1 AND user_id=$2`, [group_id, user_id]);
    return R.success(res, { message: 'Left group successfully' });
  } catch (err) { next(err); }
};
