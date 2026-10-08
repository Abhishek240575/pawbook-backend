const pool = require('../config/db');
const R = require('../utils/response');

// GET /api/v1/fundraising — list active campaigns
async function getCampaigns(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT fc.*, u.full_name as organizer_name, u.avatar_url as organizer_avatar,
              ROUND((fc.raised_amount / NULLIF(fc.goal_amount,0)) * 100) as percent,
              EXTRACT(DAY FROM (fc.deadline - NOW())) as days_left
       FROM fundraising_campaigns fc
       JOIN users u ON fc.user_id = u.user_id
       WHERE fc.status = 'active'
       ORDER BY fc.urgency DESC, fc.created_at DESC`
    );
    return R.ok(res, rows);
  } catch (err) { return R.serverError(res, err.message); }
}

// GET /api/v1/fundraising/:id — single campaign
async function getCampaign(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT fc.*, u.full_name as organizer_name, u.avatar_url as organizer_avatar,
              ROUND((fc.raised_amount / NULLIF(fc.goal_amount,0)) * 100) as percent,
              EXTRACT(DAY FROM (fc.deadline - NOW())) as days_left
       FROM fundraising_campaigns fc
       JOIN users u ON fc.user_id = u.user_id
       WHERE fc.campaign_id = $1`,
      [req.params.id]
    );
    if (!rows.length) return R.notFound(res, 'Campaign not found');
    return R.ok(res, rows[0]);
  } catch (err) { return R.serverError(res, err.message); }
}

// POST /api/v1/fundraising — create a campaign
async function createCampaign(req, res) {
  try {
    const { title, description, cover_image, goal_amount, deadline, urgency } = req.body;
    if (!title || !goal_amount) return R.badRequest(res, 'title and goal_amount are required');
    const { rows } = await pool.query(
      `INSERT INTO fundraising_campaigns
         (user_id, title, description, cover_image, goal_amount, deadline, urgency)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.user.user_id, title, description || '', cover_image || null,
       goal_amount, deadline || null, urgency || 'normal']
    );
    return R.created(res, rows[0], 'Campaign created');
  } catch (err) { return R.serverError(res, err.message); }
}

// POST /api/v1/fundraising/:id/donate — donate to a campaign
async function donate(req, res) {
  try {
    const { amount } = req.body;
    const { id } = req.params;
    if (!amount || isNaN(amount) || amount <= 0) return R.badRequest(res, 'Valid amount required');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO donations (campaign_id, user_id, amount) VALUES ($1,$2,$3)`,
        [id, req.user.user_id, amount]
      );
      await client.query(
        `UPDATE fundraising_campaigns
         SET raised_amount = raised_amount + $1, donor_count = donor_count + 1
         WHERE campaign_id = $2`,
        [amount, id]
      );
      // Log activity
      await client.query(
        `INSERT INTO activity_log (user_id, action_type, target_id, target_type, target_label)
         VALUES ($1, 'donated', $2, 'campaign', $3)`,
        [req.user.user_id, id, `Donated to campaign`]
      );
      await client.query('COMMIT');
      return R.ok(res, { amount }, 'Thank you for your donation!');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) { return R.serverError(res, err.message); }
}

module.exports = { getCampaigns, getCampaign, createCampaign, donate };
