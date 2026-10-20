/**
 * src/controllers/insurance.controller.js
 */
const db = require('../config/db');

/* GET /insurance/plans — list all active plans */
exports.getPlans = async (req, res) => {
  try {
    const { coverage_type } = req.query;
    let q = `SELECT * FROM insurance_plans WHERE is_active = TRUE`;
    const params = [];
    if (coverage_type) { params.push(coverage_type); q += ` AND coverage_type = $${params.length}`; }
    q += ` ORDER BY monthly_price ASC`;
    const { rows } = await db.query(q, params);
    res.json({ success: true, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

/* GET /insurance/my — user's active subscriptions */
exports.getMy = async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT ui.*, ip.name, ip.provider, ip.coverage_type, ip.monthly_price, ip.covers
       FROM user_insurance ui
       JOIN insurance_plans ip ON ui.plan_id = ip.plan_id
       WHERE ui.user_id = $1 ORDER BY ui.created_at DESC`,
      [req.user.user_id]
    );
    res.json({ success: true, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

/* POST /insurance/subscribe — subscribe to a plan */
exports.subscribe = async (req, res) => {
  try {
    const { plan_id, pet_id } = req.body;
    if (!plan_id) return res.status(400).json({ success: false, message: 'plan_id is required' });
    const policy_no = 'PB-' + Date.now().toString(36).toUpperCase();
    const { rows } = await db.query(
      `INSERT INTO user_insurance (user_id, pet_id, plan_id, policy_no)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.user.user_id, pet_id || null, plan_id, policy_no]
    );
    res.status(201).json({ success: true, data: rows[0] });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

/* DELETE /insurance/:id — cancel subscription */
exports.cancel = async (req, res) => {
  try {
    await db.query(
      `UPDATE user_insurance SET status = 'cancelled' WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.user_id]
    );
    res.json({ success: true, message: 'Insurance cancelled' });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};
