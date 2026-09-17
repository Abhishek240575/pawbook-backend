const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Test connection on startup and show exact error
pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ DB CONNECTION FAILED');
    console.error('Error code:', err.code);
    console.error('Error message:', err.message);
    console.error('Full error:', err);
  } else {
    console.log('✅ Connected to Neon PostgreSQL');
    release();
  }
});

pool.on('error', (err) => {
  console.error('❌ PostgreSQL pool error:', err.message);
});

const query = (text, params) => pool.query(text, params);
const getClient = () => pool.connect();

module.exports = { query, getClient, pool };