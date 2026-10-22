// middleware/auth.js — JWT authentication for flat routes/
// Mirrors src/middleware/index.js but exposes req.user.id for route compatibility
const jwt  = require('jsonwebtoken');
const { pool } = require('../db');

module.exports = async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer '))
    return res.status(401).json({ error: 'No token provided' });

  const token = header.split(' ')[1];
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    const { rows } = await pool.query(
      `SELECT user_id, username, role, status, is_verified
       FROM users
       WHERE user_id = $1 AND deleted_at IS NULL`,
      [payload.user_id]
    );

    if (!rows.length)
      return res.status(401).json({ error: 'User not found' });
    if (rows[0].status === 'suspended')
      return res.status(403).json({ error: 'Account suspended' });
    if (rows[0].status === 'deactivated')
      return res.status(403).json({ error: 'Account deactivated' });

    // Expose both .id (UUID) and .user_id for compatibility
    req.user = {
      id:          rows[0].user_id,   // used by all our route files
      user_id:     rows[0].user_id,   // matches src/ convention
      username:    rows[0].username,
      role:        rows[0].role,
      is_verified: rows[0].is_verified,
    };
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError')
      return res.status(401).json({ error: 'Token expired' });
    return res.status(401).json({ error: 'Invalid token' });
  }
};
