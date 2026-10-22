'use strict';
/**
 * marketplace.controller.js
 * Marketplace tables (market_stores, market_listings, etc.) are not yet
 * provisioned in the database. All endpoints return a 503 stub so the
 * app starts cleanly and routes don't 500-crash on missing tables.
 */

const R = require('../utils/response');

const stub = (res) =>
  res.status(503).json({ success: false, message: 'Marketplace feature coming soon' });

exports.createStore       = (req, res) => stub(res);
exports.getMyStore        = (req, res) => stub(res);
exports.updateMyStore     = (req, res) => stub(res);

exports.getListings       = (req, res) => stub(res);
exports.getListing        = (req, res) => stub(res);
exports.createListing     = (req, res) => stub(res);
exports.updateListing     = (req, res) => stub(res);
exports.deleteListing     = (req, res) => stub(res);

exports.getProducts       = (req, res) => stub(res);
exports.getProduct        = (req, res) => stub(res);

exports.getCart           = (req, res) => stub(res);
exports.addToCart         = (req, res) => stub(res);
exports.updateCartItem    = (req, res) => stub(res);
exports.removeFromCart    = (req, res) => stub(res);

exports.placeOrder        = (req, res) => stub(res);
exports.getMyOrders       = (req, res) => stub(res);
exports.getOrder          = (req, res) => stub(res);
exports.getSellerOrders   = (req, res) => stub(res);
exports.updateOrderStatus = (req, res) => stub(res);

exports.addReview         = (req, res) => stub(res);
exports.getReviews        = (req, res) => stub(res);
