'use strict';
/**
 * nutrition.controller.js
 * Drop into: src/controllers/nutrition.controller.js
 */

const { query: dbQuery } = require('../config/db');
const R = require('../utils/response');

/* ─────────────────────────────────────────────────────────────
   GET /api/v1/nutrition/plans
   Query: pet_type, goal, limit, offset
───────────────────────────────────────────────────────────── */
exports.getPlans = async (req, res, next) => {
  try {
    const { pet_type, goal } = req.query;
    const limit  = Math.min(parseInt(req.query.limit)  || 20, 100);
    const offset = Math.max(parseInt(req.query.offset) || 0,  0);

    const conditions = ['p.is_template = TRUE'];
    const params = [];
    if (pet_type) { params.push(pet_type); conditions.push(`p.pet_type = $${params.length}`); }
    if (goal)     { params.push(goal);     conditions.push(`p.goal = $${params.length}`); }

    const where = 'WHERE ' + conditions.join(' AND ');
    params.push(limit, offset);

    const { rows } = await dbQuery(
      `SELECT p.*,
              json_agg(
                json_build_object(
                  'id', m.id,
                  'meal_time', m.meal_time,
                  'time_label', m.time_label,
                  'items', (
                    SELECT json_agg(
                      json_build_object('name',i.name,'quantity_g',i.quantity_g,'unit',i.unit)
                      ORDER BY i.sort_order
                    )
                    FROM nutrition_meal_items i WHERE i.meal_id = m.id
                  )
                ) ORDER BY m.sort_order
              ) FILTER (WHERE m.id IS NOT NULL) AS meals
         FROM nutrition_plans p
         LEFT JOIN nutrition_meals m ON m.plan_id = p.id
         ${where}
         GROUP BY p.id
         ORDER BY p.id
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const { rows: [{ total }] } = await dbQuery(
      `SELECT COUNT(*) AS total FROM nutrition_plans WHERE is_template = TRUE`
    );

    return res.json({ success: true, data: rows, total: parseInt(total), limit, offset });
  } catch (err) { next(err); }
};

/* ─────────────────────────────────────────────────────────────
   GET /api/v1/nutrition/plans/:id
───────────────────────────────────────────────────────────── */
exports.getPlan = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { rows } = await dbQuery(
      `SELECT p.*,
              json_agg(
                json_build_object(
                  'id', m.id,
                  'meal_time', m.meal_time,
                  'time_label', m.time_label,
                  'items', (
                    SELECT json_agg(
                      json_build_object('name',i.name,'quantity_g',i.quantity_g,'unit',i.unit)
                      ORDER BY i.sort_order
                    )
                    FROM nutrition_meal_items i WHERE i.meal_id = m.id
                  )
                ) ORDER BY m.sort_order
              ) FILTER (WHERE m.id IS NOT NULL) AS meals
         FROM nutrition_plans p
         LEFT JOIN nutrition_meals m ON m.plan_id = p.id
         WHERE p.id = $1
         GROUP BY p.id`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Plan not found' });
    return res.json({ success: true, data: rows[0] });
  } catch (err) { next(err); }
};

/* ─────────────────────────────────────────────────────────────
   GET /api/v1/nutrition/foods
   Query: pet_type, is_recommended, is_avoid, limit, offset
───────────────────────────────────────────────────────────── */
exports.getFoods = async (req, res, next) => {
  try {
    const { pet_type, is_recommended, is_avoid } = req.query;
    const limit  = Math.min(parseInt(req.query.limit)  || 50, 100);
    const offset = Math.max(parseInt(req.query.offset) || 0,  0);

    const conditions = [];
    const params = [];

    if (pet_type) {
      params.push(pet_type);
      conditions.push(`$${params.length} = ANY(pet_types)`);
    }
    if (is_recommended !== undefined) {
      params.push(is_recommended === 'true');
      conditions.push(`is_recommended = $${params.length}`);
    }
    if (is_avoid !== undefined) {
      params.push(is_avoid === 'true');
      conditions.push(`is_avoid = $${params.length}`);
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    params.push(limit, offset);

    const { rows } = await dbQuery(
      `SELECT * FROM nutrition_foods
       ${where}
       ORDER BY rating DESC, name
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    return res.json({ success: true, data: rows, limit, offset });
  } catch (err) { next(err); }
};

/* ─────────────────────────────────────────────────────────────
   GET /api/v1/nutrition/my-plans   (auth required)
───────────────────────────────────────────────────────────── */
exports.getMyPlans = async (req, res, next) => {
  try {
    const uid = req.user.user_id;
    const { rows } = await dbQuery(
      `SELECT unp.*, p.title, p.pet_type, p.daily_kcal, p.protein_pct, p.fat_pct, p.carbs_pct
         FROM user_nutrition_plans unp
         LEFT JOIN nutrition_plans p ON p.id = unp.plan_id
         WHERE unp.user_id = $1 AND unp.is_active = TRUE
         ORDER BY unp.saved_at DESC`,
      [uid]
    );
    return res.json({ success: true, data: rows });
  } catch (err) { next(err); }
};

/* ─────────────────────────────────────────────────────────────
   POST /api/v1/nutrition/my-plans   (auth required)
───────────────────────────────────────────────────────────── */
exports.savePlan = async (req, res, next) => {
  try {
    const uid = req.user.user_id;
    const { plan_id, pet_id, custom_notes } = req.body;

    if (pet_id) {
      await dbQuery(
        `UPDATE user_nutrition_plans SET is_active = FALSE
          WHERE user_id = $1 AND pet_id = $2 AND is_active = TRUE`,
        [uid, pet_id]
      );
    }

    const { rows } = await dbQuery(
      `INSERT INTO user_nutrition_plans(user_id, pet_id, plan_id, custom_notes)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [uid, pet_id || null, plan_id || null, custom_notes || null]
    );
    return res.status(201).json({ success: true, data: rows[0] });
  } catch (err) { next(err); }
};

/* ─────────────────────────────────────────────────────────────
   DELETE /api/v1/nutrition/my-plans/:id   (auth required)
───────────────────────────────────────────────────────────── */
exports.removePlan = async (req, res, next) => {
  try {
    const uid = req.user.user_id;
    const { id } = req.params;
    await dbQuery(
      `UPDATE user_nutrition_plans SET is_active = FALSE
        WHERE id = $1 AND user_id = $2`,
      [id, uid]
    );
    return res.json({ success: true, message: 'Plan removed' });
  } catch (err) { next(err); }
};

/* ─────────────────────────────────────────────────────────────
   GET /api/v1/nutrition/recommend
   Query: pet_type, goal, activity
───────────────────────────────────────────────────────────── */
exports.recommend = async (req, res, next) => {
  try {
    const { pet_type = 'dog', goal = 'maintain', activity = 'moderate' } = req.query;
    const { rows } = await dbQuery(
      `SELECT * FROM nutrition_plans
        WHERE is_template = TRUE AND pet_type = $1 AND goal = $2 AND activity = $3
        ORDER BY id LIMIT 1`,
      [pet_type, goal, activity]
    );
    if (!rows.length) {
      const { rows: fallback } = await dbQuery(
        `SELECT * FROM nutrition_plans WHERE is_template=TRUE AND pet_type=$1 LIMIT 1`,
        [pet_type]
      );
      return res.json({ success: true, data: fallback[0] || null });
    }
    return res.json({ success: true, data: rows[0] });
  } catch (err) { next(err); }
};
