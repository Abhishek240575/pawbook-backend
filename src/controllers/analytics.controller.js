'use strict';
/**
 * analytics.controller.js
 * Drop into: src/controllers/analytics.controller.js
 */

const { query: dbQuery } = require('../config/db');

/* ─────────────────────────────────────────────────────────────
   GET /api/v1/analytics/summary   (auth required)
   Returns aggregated stats for the logged-in user's dashboard
───────────────────────────────────────────────────────────── */
exports.getSummary = async (req, res, next) => {
  try {
    const uid = req.user.user_id;

    // Run all queries in parallel
    const [
      activityRows,
      socialRows,
      vetRows,
      trainingRows,
      vaccinationRows,
      walkChartRows,
      engagementRows,
    ] = await Promise.all([

      // Avg daily walk (last 7 days)
      dbQuery(
        `SELECT COALESCE(AVG(value_num),0) AS avg_walk,
                COALESCE(SUM(value_num),0) AS total_walk
         FROM pet_activity_logs
         WHERE user_id=$1 AND activity_type='walk'
           AND logged_at >= NOW() - INTERVAL '7 days'`,
        [uid]
      ),

      // Social stats: followers count, post count, reactions
      dbQuery(
        `SELECT
           (SELECT COUNT(*) FROM follows       WHERE following_id=$1)   AS followers,
           (SELECT COUNT(*) FROM posts         WHERE user_id=$1)        AS posts,
           (SELECT COALESCE(SUM(likes_count),0) FROM posts WHERE user_id=$1) AS reactions
        `,
        [uid]
      ),

      // Vet visits this year
      dbQuery(
        `SELECT COUNT(*) AS vet_visits
         FROM vet_appointments
         WHERE user_id=$1
           AND appointment_date >= date_trunc('year', NOW())`,
        [uid]
      ),

      // Training sessions completed
      dbQuery(
        `SELECT COUNT(*) AS sessions_done,
                MAX(completed_at) AS last_session
         FROM user_training_progress
         WHERE user_id=$1`,
        [uid]
      ),

      // Next upcoming vaccination
      dbQuery(
        `SELECT vaccine_name, next_due_date
         FROM vaccinations
         WHERE user_id=$1 AND next_due_date >= CURRENT_DATE
         ORDER BY next_due_date ASC LIMIT 1`,
        [uid]
      ),

      // Walk chart: last 7 days individually
      dbQuery(
        `SELECT TO_CHAR(logged_at,'Dy') AS day,
                ROUND(AVG(value_num)::numeric,1) AS km
         FROM pet_activity_logs
         WHERE user_id=$1 AND activity_type='walk'
           AND logged_at >= NOW() - INTERVAL '7 days'
         GROUP BY TO_CHAR(logged_at,'Dy'), DATE(logged_at)
         ORDER BY DATE(logged_at)`,
        [uid]
      ),

      // Post engagement: last 4 weeks grouped
      dbQuery(
        `SELECT
           'W'||CEIL(EXTRACT(DAY FROM (NOW()-created_at))/7.0)::int AS week,
           COALESCE(SUM(likes_count),0) AS reactions
         FROM posts
         WHERE user_id=$1 AND created_at >= NOW() - INTERVAL '28 days'
         GROUP BY week
         ORDER BY week`,
        [uid]
      ),
    ]);

    // Latest health indicators from activity logs
    const healthRows = await dbQuery(
      `SELECT DISTINCT ON (activity_type) activity_type, value_num, unit, logged_at
       FROM pet_activity_logs
       WHERE user_id=$1
       ORDER BY activity_type, logged_at DESC`,
      [uid]
    );

    // Recent activity feed (union of multiple event types)
    const recentRows = await dbQuery(
      `(SELECT 'walk' AS type, 'Morning walk' AS label,
               value_num::text||' km completed' AS detail,
               logged_at AS ts
          FROM pet_activity_logs
         WHERE user_id=$1 AND activity_type='walk'
         ORDER BY logged_at DESC LIMIT 2)
       UNION ALL
       (SELECT 'vet', 'Vet appointment', 'booked for '||TO_CHAR(appointment_date,'Mon DD'), booked_at
          FROM vet_appointments WHERE user_id=$1
          ORDER BY booked_at DESC LIMIT 2)
       UNION ALL
       (SELECT 'training', 'Training session', session_title||' completed', completed_at
          FROM user_training_progress WHERE user_id=$1
          ORDER BY completed_at DESC LIMIT 2)
       UNION ALL
       (SELECT 'post', 'Post', 'received '||likes_count::text||' reactions', created_at
          FROM posts WHERE user_id=$1 AND likes_count > 0
          ORDER BY created_at DESC LIMIT 2)
       ORDER BY ts DESC LIMIT 8`,
      [uid]
    );

    // Upcoming events
    const upcomingRows = await dbQuery(
      `(SELECT 'vaccination' AS type, vaccine_name AS label, next_due_date AS due
          FROM vaccinations WHERE user_id=$1 AND next_due_date >= CURRENT_DATE
          ORDER BY next_due_date LIMIT 2)
       UNION ALL
       (SELECT 'vet', 'Vet Appointment',
               appointment_date
          FROM vet_appointments
         WHERE user_id=$1 AND appointment_date >= CURRENT_DATE AND status='confirmed'
         ORDER BY appointment_date LIMIT 2)
       ORDER BY due LIMIT 4`,
      [uid]
    );

    const s = socialRows.rows[0] || {};
    const v = vetRows.rows[0] || {};
    const t = trainingRows.rows[0] || {};
    const a = activityRows.rows[0] || {};

    return res.json({
      success: true,
      data: {
        stats: {
          avg_daily_walk_km: parseFloat(a.avg_walk || 0).toFixed(1),
          followers:         parseInt(s.followers  || 0),
          posts:             parseInt(s.posts      || 0),
          reactions:         parseInt(s.reactions  || 0),
          vet_visits_ytd:    parseInt(v.vet_visits || 0),
          training_done:     parseInt(t.sessions_done || 0),
        },
        walk_chart:       walkChartRows.rows,
        engagement_chart: engagementRows.rows,
        health:           healthRows.rows,
        recent:           recentRows.rows,
        upcoming:         upcomingRows.rows,
      }
    });
  } catch (err) { next(err); }
};

/* ─────────────────────────────────────────────────────────────
   POST /api/v1/analytics/activity   (auth required)
   Log a pet activity (walk, sleep, weight, etc.)
   Body: pet_name, activity_type, value_num, unit, notes
───────────────────────────────────────────────────────────── */
exports.logActivity = async (req, res, next) => {
  try {
    const uid = req.user.user_id;
    const { pet_name, activity_type, value_num, unit, notes } = req.body;

    const { rows } = await dbQuery(
      `INSERT INTO pet_activity_logs(user_id,pet_name,activity_type,value_num,unit,notes)
       VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
      [uid, pet_name||null, activity_type, value_num||null, unit||null, notes||null]
    );
    return res.status(201).json({ success: true, data: rows[0] });
  } catch (err) { next(err); }
};
