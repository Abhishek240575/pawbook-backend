const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/index');
const {
  listBusinesses,
  registerBusiness,
  moderateBusiness,
  listPending
} = require('../controllers/business.controller');

// Public â€” anyone can view approved listings
router.get('/', listBusinesses);

// Auth required â€” logged-in user registers their business
router.post('/', authenticate, registerBusiness);

// Admin routes
router.get('/pending', authenticate, listPending);
router.patch('/:business_id/moderate', authenticate, moderateBusiness);

module.exports = router;

