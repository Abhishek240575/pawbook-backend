// server.js — PawBook API
require('dotenv').config();

const express     = require('express');
const cors        = require('cors');
const helmet      = require('helmet');
const rateLimit   = require('express-rate-limit');

const app  = express();
const PORT = process.env.PORT || 3001;

// ── Security ─────────────────────────────────────────────────────────────────
const helmetConfig = {
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
};
app.use(helmet(helmetConfig));

// ── CORS ─────────────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean);
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
      cb(null, true);
    } else {
      cb(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));

// ── Body parsing ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Rate limiting ─────────────────────────────────────────────────────────────
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/v1/auth', authLimiter);
app.use('/api/v1/',     generalLimiter);

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/v1/auth',          require('./routes/auth'));
app.use('/api/v1/users',         require('./routes/users'));
app.use('/api/v1/pets',          require('./routes/pets'));
app.use('/api/v1/posts',         require('./routes/posts'));
app.use('/api/v1/appointments',  require('./routes/appointments'));
app.use('/api/v1/pawmatch',      require('./routes/pawmatch'));
app.use('/api/v1/vaccinations',  require('./routes/vaccinations'));
app.use('/api/v1/notifications', require('./routes/notifications'));
app.use('/api/v1/groups',        require('./routes/groups'));
app.use('/api/v1/insurance',     require('./routes/insurance'));
app.use('/api/v1/training',      require('./routes/training'));
app.use('/api/v1/analytics',     require('./routes/analytics'));
app.use('/api/v1/nutrition',     require('./routes/nutrition'));
app.use('/api/v1/discover',      require('./routes/discover'));
app.use('/api/v1/travel',        require('./routes/travel'));
app.use('/api/v1/lost-pets',     require('./routes/lostPets'));
app.use('/api/v1/marketplace',   require('./routes/marketplace'));
app.use('/api/v1/reviews',       require('./routes/reviews'));
app.use('/api/v1/messages',      require('./routes/messages'));
app.use('/api/v1/stories',       require('./routes/stories'));
app.use('/api/v1/search',        require('./routes/search'));
app.use('/api/v1/adoptions',     require('./routes/adoptions'));
app.use('/api/v1/emergency',     require('./routes/emergency'));
app.use('/api/v1/reels',         require('./routes/reels'));
app.use('/api/v1/events',        require('./routes/events'));
app.use('/api/v1/live',          require('./routes/live'));
// Saved, memories, activity, birthdays, fundraising all served from saved.js
app.use('/api/v1/saved',         require('./routes/saved'));
app.use('/api/v1/memories',      require('./routes/saved'));
app.use('/api/v1/activity',      require('./routes/saved'));
app.use('/api/v1/birthdays',     require('./routes/saved'));
app.use('/api/v1/fundraising',   require('./routes/saved'));
// Media / gallery
app.use('/api/v1/media',         require('./routes/media'));

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error(err.stack || err.message || err);
  res.status(err.status || 500).json({ error: err.message || 'Server error' });
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => console.log(`PawBook API running on port ${PORT}`));
