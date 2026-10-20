/**
 * src/controllers/analytics.controller.js
 * Real SQL aggregations for the analytics dashboard
 */
const db = require('../config/db');

/* GET /analytics/me — full dashboard stats for logged-in user */
exports.getMyAnalytics = async (req, res) => {
  try {
    const uid = req.user.user_id;

    const [postsStats, engagementByDay, topPosts, followerGrowth, petsStats] = await Promise.all([

      // Total posts, likes received, comments received
      db.query(`
        SELECT
          COUNT(p.post_id)::int                    AS total_posts,
          COALESCE(SUM(p.likes_count), 0)::int     AS total_likes,
          COALESCE(SUM(p.comments_count), 0)::int  AS total_comments,
          COALESCE(SUM(p.shares_count), 0)::int    AS total_shares
        FROM posts p WHERE p.user_id = $1 AND p.deleted_at IS NULL
      `, [uid]),

      // Engagement per day (last 30 days)
      db.query(`
        SELECT
          DATE(p.created_at)::text                 AS day,
          COUNT(p.post_id)::int                    AS posts,
          COALESCE(SUM(p.likes_count), 0)::int     AS likes,
          COALESCE(SUM(p.comments_count), 0)::int  AS comments
        FROM posts p
        WHERE p.user_id = $1
          AND p.created_at >= NOW() - INTERVAL '30 days'
          AND p.deleted_at IS NULL
        GROUP BY DATE(p.created_at)
        ORDER BY day ASC
      `, [uid]),

      // Top 5 posts by likes
      db.query(`
        SELECT post_id, content, likes_count, comments_count, shares_count, created_at
        FROM posts
        WHERE user_id = $1 AND deleted_at IS NULL
        ORDER BY likes_count DESC
        LIMIT 5
      `, [uid]),

      // Follower count + following count
      db.query(`
        SELECT
          (SELECT COUNT(*) FROM follows WHERE following_id = $1)::int AS followers,
          (SELECT COUNT(*) FROM follows WHERE follower_id  = $1)::int AS following
      `, [uid]),

      // Pets count
      db.query(`SELECT COUNT(*)::int AS pet_count FROM pets WHERE owner_id = $1`, [uid]),
    ]);

    res.json({
      success: true,
      data: {
        summary: {
          ...postsStats.rows[0],
          followers: followerGrowth.rows[0]?.followers || 0,
          following: followerGrowth.rows[0]?.following || 0,
          pet_count: petsStats.rows[0]?.pet_count || 0,
        },
        engagement_by_day: engagementByDay.rows,
        top_posts: topPosts.rows,
      }
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};
