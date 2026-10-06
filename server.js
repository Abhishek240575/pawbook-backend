// PawBook API — server.js
require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const app     = express();

app.use(cors());
app.use(express.json());

// ── Health check ─────────────────────────────────
app.get('/api/health', (req, res) => res.json({ ok: true }));

// ── Existing routes (auth, users, pets, posts) ───
app.use('/api/auth',  require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/pets',  require('./routes/pets'));
app.use('/api/posts', require('./routes/posts'));

// ── New feature routes ────────────────────────────
app.use('/api/appointments',  require('./routes/appointments'));
app.use('/api/pawmatch',      require('./routes/pawmatch'));
app.use('/api/vaccinations',  require('./routes/vaccinations'));
app.use('/api/reviews',       require('./routes/reviews'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/groups',        require('./routes/groups'));
app.use('/api/insurance',     require('./routes/insurance'));
app.use('/api/training',      require('./routes/training'));
app.use('/api/travel',        require('./routes/travel'));

// ── 404 fallback ──────────────────────────────────
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// ── Start ─────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`PawBook API running on port ${PORT}`));
