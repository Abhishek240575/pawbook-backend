require('dotenv').config();

const express     = require('express');
const helmet      = require('helmet');
const cors        = require('cors');
const compression = require('compression');
const morgan      = require('morgan');

const routes      = require('./routes');
const { helmetConfig, generalLimiter, authLimiter, postLimiter } = require('./middleware/security');
const {
  errorHandler,
  requestLogger,
} = require('./middleware');
const logger      = require('./utils/logger');

const app  = express();
const PORT = process.env.PORT || 10000;

// ── SECURITY ──────────────────────────────────────────────────
app.use(helmetConfig);          // replaces plain helmet() — same protection + our config
app.set('trust proxy', 1);

// ── CORS ──────────────────────────────────────────────────────
const ALLOWED_ORIGINS = [
  'https://pawbook.deemona.com',   // production (update when domain is live)
  'http://localhost:5500',          // VS Code Live Server
  'http://127.0.0.1:5500',
  'http://localhost:3000',
  'null',                           // file:// local open
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);          // curl, Postman, mobile apps
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods:     ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ── COMPRESSION + PARSING ─────────────────────────────────────
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── LOGGING ───────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('dev'));
}
app.use(requestLogger);

// ── RATE LIMITING ─────────────────────────────────────────────
app.use('/api/v1/auth',  authLimiter);    // 10 req / 15 min  — login, register
app.use('/api/v1/posts', postLimiter);    // 20 req / hour    — post creation
app.use('/api/v1',       generalLimiter); // 100 req / 15 min — everything else

// ── ROUTES ────────────────────────────────────────────────────
app.use('/api/v1', routes);
app.use('/api/vaccinations', require('./routes/vaccinations'));

// ── 404 ───────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.originalUrl} not found`
  });
});

// ── GLOBAL ERROR HANDLER ──────────────────────────────────────
app.use(function (err, req, res, next) {
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ success: false, message: 'CORS: origin not allowed' });
  }
  errorHandler(err, req, res, next);
});

// ── START ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  logger.info(`🐾 PawBook API running on port ${PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`Health check: http://localhost:${PORT}/api/v1/health`);
});

module.exports = app; // for tests
