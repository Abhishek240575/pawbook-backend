// PawBook API — server.js
require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const app     = express();
const { helmetConfig, generalLimiter, authLimiter } = require('./src/middleware/security');

app.use(helmetConfig);
app.use(cors());
app.use(express.json());
app.use('/api/v1', generalLimiter);
app.use('/api/v1/auth', authLimiter);

// ── Health check ─────────────────────────────────
app.get('/api/health', (req, res) => res.json({ ok: true }));

// ── Routes ────────────────────────────────────────
app.use('/api/v1/auth',         require('./routes/auth'));
app.use('/api/v1/users',        require('./routes/users'));
app.use('/api/v1/pets',         require('./routes/pets'));
app.use('/api/v1/posts',        require('./routes/posts'));
app.use('/api/v1/appointments', require('./routes/appointments'));
app.use('/api/v1/pawmatch',     require('./routes/pawmatch'));
app.use('/api/v1/vaccinations', require('./routes/vaccinations'));
app.use('/api/v1/notifications',require('./routes/notifications'));
app.use('/api/v1/groups',       require('./routes/groups'));
app.use('/api/v1/insurance',    require('./routes/insurance'));
app.use('/api/v1/training',     require('./routes/training'));
app.use('/api/v1/analytics',    require('./routes/analytics'));
app.use('/api/v1/nutrition',    require('./routes/nutrition'));
app.use('/api/v1/discover',     require('./routes/discover'));
app.use('/api/v1/travel',       require('./routes/travel'));
app.use('/api/v1/lost-pets',    require('./routes/lostPets'));
app.use('/api/v1/marketplace',  require('./routes/marketplace'));
app.use('/api/v1/reviews',      require('./routes/reviews'));

// ── 404 fallback ──────────────────────────────────
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// ── Start ─────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('PawBook API running on port ' + PORT));
