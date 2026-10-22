// routes/discover.js — Local Pet Business Discovery
const express = require('express');
const router  = express.Router();
const auth    = require('../middleware/auth');

// POST /api/v1/discover/businesses — search nearby businesses
// Body: { category, lat, lng, radius }
// Placeholder — wire up Google Places API or a businesses table when ready
router.post('/businesses', auth, (req, res) => {
  const { category } = req.body;
  res.json({
    category:    category || 'all',
    businesses:  [],
    message:     'Live business data coming soon. Enable location to discover nearby pet services.',
  });
});

// GET /api/v1/discover/categories — list available categories
router.get('/categories', (req, res) => {
  res.json([
    'vets', 'groomers', 'pet_stores', 'parks',
    'trainers', 'boarders', 'pharmacies',
  ]);
});

module.exports = router;
