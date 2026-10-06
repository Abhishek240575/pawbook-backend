require('dotenv').config();

const express     = require('express');
const helmet      = require('helmet');
const cors        = require('cors');
const compression = require('compression');
const morgan      = require('morgan');

const routes      = require('./routes');
const {
  errorHandler,
  requestLogger,
  defaultLimiter
} = require('./middleware');
const logger      = require('./utils/logger');

const app  = express();
const PORT = process.env.PORT || 10000;

// ── SECURITY ──────────────────────────────────────────────────
app.use(helmet());
app.set('trust proxy', 1);

// ── CORS ──────────────────────────────────────────────────────
app.use(cors({
  origin:      '*',
  credentials: false,
  methods:     ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization']
}));

// ── COMPRESSION + PARSING ─────────────────────────────────────
app.use(compression());
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

// ── LOGGING ───────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('dev'));
}
app.use(requestLogger);

// ── RATE LIMITING ─────────────────────────────────────────────
app.use(defaultLimiter);

// ── ROUTES ────────────────────────────────────────────────────
app.use('/api/v1', routes);

// ── 404 ───────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.originalUrl} not found`
  });
});

// ── GLOBAL ERROR HANDLER ──────────────────────────────────────
app.use(errorHandler);

// ── START ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  logger.info(`🐾 PawBook API running on port ${PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`Health check: http://localhost:${PORT}/api/v1/health`);
});

module.exports = app; // for tests
