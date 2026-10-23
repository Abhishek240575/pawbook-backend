'use strict';
const { query } = require('../config/db');
const R = require('../utils/response');
const crypto = require('crypto');
const uid = () => crypto.randomBytes(8).toString('hex');

// ── PRODUCTS ─────────────────────────────────────────────────────────────────
exports.getProducts = async (req, res) => {
  try {
    const { category, q, limit = 20, offset = 0 } = req.query;
    let sql = `SELECT p.*, u.full_name AS seller_name,
               COALESCE(AVG(r.rating),0) AS avg_rating,
               COUNT(r.*) AS review_count
               FROM marketplace_products p
               LEFT JOIN users u ON u.user_id = p.seller_id
               LEFT JOIN marketplace_reviews r ON r.product_id = p.product_id
               WHERE p.is_active = TRUE`;
    const params = [];
    if (category) { params.push(category); sql += ` AND p.category = $${params.length}`; }
    if (q) { params.push('%'+q+'%'); sql += ` AND (p.name ILIKE $${params.length} OR p.description ILIKE $${params.length})`; }
    sql += ` GROUP BY p.product_id, u.full_name ORDER BY p.created_at DESC LIMIT $${params.length+1} OFFSET $${params.length+2}`;
    params.push(Number(limit), Number(offset));
    const { rows } = await query(sql, params);
    return R.ok(res, { products: rows, limit: Number(limit), offset: Number(offset) });
  } catch(e) { console.error('[Market] getProducts:', e.message); return R.serverError(res); }
};

exports.getProduct = async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT p.*, u.full_name AS seller_name,
       COALESCE(AVG(r.rating),0) AS avg_rating, COUNT(r.*) AS review_count
       FROM marketplace_products p
       LEFT JOIN users u ON u.user_id = p.seller_id
       LEFT JOIN marketplace_reviews r ON r.product_id = p.product_id
       WHERE p.product_id = $1 GROUP BY p.product_id, u.full_name`, [req.params.listing_id || req.params.product_id || req.params.id]);
    if (!rows.length) return R.notFound(res, 'Product not found');
    return R.ok(res, rows[0]);
  } catch(e) { console.error('[Market] getProduct:', e.message); return R.serverError(res); }
};

exports.getListings = exports.getProducts;
exports.getListing  = exports.getProduct;

exports.createListing = async (req, res) => {
  try {
    const { name, description, price, category, images, stock, unit, compare_price } = req.body;
    if (!name || price == null) return R.badRequest(res, 'name and price required');
    const pid = 'prod_' + uid();
    await query(
      `INSERT INTO marketplace_products (product_id,seller_id,name,description,price,compare_price,category,images,stock,unit)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [pid, req.user.user_id, name, description||'', Number(price),
       compare_price ? Number(compare_price) : null,
       category||'other', JSON.stringify(images||[]), Number(stock)||0, unit||'']);
    return R.created(res, { product_id: pid });
  } catch(e) { console.error('[Market] createListing:', e.message); return R.serverError(res); }
};

exports.updateListing = async (req, res) => {
  try {
    const fields = ['name','description','price','compare_price','category','images','stock','unit','is_active'];
    const sets = []; const params = [];
    fields.forEach(f => { if (req.body[f] !== undefined) { params.push(req.body[f]); sets.push(`${f}=$${params.length}`); } });
    if (!sets.length) return R.badRequest(res, 'Nothing to update');
    params.push(req.params.id, req.user.user_id);
    await query(`UPDATE marketplace_products SET ${sets.join(',')} WHERE product_id=$${params.length-1} AND seller_id=$${params.length}`, params);
    return R.ok(res, { updated: true });
  } catch(e) { console.error('[Market] updateListing:', e.message); return R.serverError(res); }
};

exports.deleteListing = async (req, res) => {
  try {
    await query('UPDATE marketplace_products SET is_active=FALSE WHERE product_id=$1 AND seller_id=$2', [req.params.id, req.user.user_id]);
    return R.ok(res, { deleted: true });
  } catch(e) { console.error('[Market] deleteListing:', e.message); return R.serverError(res); }
};

// ── STORES ───────────────────────────────────────────────────────────────────
exports.createStore  = async (req, res) => R.ok(res, { message: 'Store setup not required for MVP' });
exports.getMyStore   = async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM marketplace_products WHERE seller_id=$1 AND is_active=TRUE ORDER BY created_at DESC', [req.user.user_id]);
    return R.ok(res, { products: rows });
  } catch(e) { return R.serverError(res); }
};
exports.updateMyStore = async (req, res) => R.ok(res, { updated: true });

// ── CART ─────────────────────────────────────────────────────────────────────
exports.getCart = async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT c.*, p.name, p.price, p.images, p.stock FROM marketplace_cart c
       JOIN marketplace_products p ON p.product_id = c.product_id
       WHERE c.user_id = $1`, [req.user.user_id]);
    const subtotal = rows.reduce((s, r) => s + r.price * r.quantity, 0);
    return R.ok(res, { items: rows, subtotal });
  } catch(e) { console.error('[Market] getCart:', e.message); return R.serverError(res); }
};

exports.addToCart = async (req, res) => {
  try {
    const { product_id, quantity = 1 } = req.body;
    if (!product_id) return R.badRequest(res, 'product_id required');
    await query(
      `INSERT INTO marketplace_cart (user_id, product_id, quantity)
       VALUES ($1,$2,$3)
       ON CONFLICT (user_id, product_id) DO UPDATE SET quantity = marketplace_cart.quantity + $3`,
      [req.user.user_id, product_id, Number(quantity)]);
    return R.ok(res, { added: true });
  } catch(e) { console.error('[Market] addToCart:', e.message); return R.serverError(res); }
};

exports.updateCartItem = async (req, res) => {
  try {
    const { quantity } = req.body;
    const pid = req.params.cart_id;
    if (!quantity || quantity < 1) {
      await query('DELETE FROM marketplace_cart WHERE user_id=$1 AND product_id=$2', [req.user.user_id, pid]);
    } else {
      await query('UPDATE marketplace_cart SET quantity=$1 WHERE user_id=$2 AND product_id=$3', [quantity, req.user.user_id, pid]);
    }
    return R.ok(res, { updated: true });
  } catch(e) { return R.serverError(res); }
};

exports.removeFromCart = async (req, res) => {
  try {
    await query('DELETE FROM marketplace_cart WHERE user_id=$1 AND product_id=$2', [req.user.user_id, req.params.cart_id || req.params.product_id]);
    return R.ok(res, { removed: true });
  } catch(e) { return R.serverError(res); }
};

// ── ORDERS ───────────────────────────────────────────────────────────────────
exports.placeOrder = async (req, res) => {
  try {
    const { items, delivery_address } = req.body;
    if (!items || !items.length) return R.badRequest(res, 'items required');
    const subtotal = items.reduce((s, it) => s + (it.price||0) * (it.quantity||1), 0);
    const delivery_fee = subtotal >= 499 ? 0 : 49;
    const total = subtotal + delivery_fee;
    const oid = 'ord_' + uid();
    const orderNum = 'PB-' + new Date().getFullYear() + '-' + String(Math.floor(Math.random()*99999)).padStart(5,'0');
    const estDelivery = new Date(Date.now() + 5 * 86400000).toISOString().slice(0,10);
    await query(
      `INSERT INTO marketplace_orders (order_id,order_number,buyer_id,subtotal,delivery_fee,total,delivery_address,estimated_delivery)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [oid, orderNum, req.user.user_id, subtotal, delivery_fee, total, JSON.stringify(delivery_address||{}), estDelivery]);
    for (const it of items) {
      await query(
        `INSERT INTO marketplace_order_items (item_id,order_id,product_id,name,image_url,price,quantity)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        ['oi_'+uid(), oid, it.product_id||null, it.name||'Product', it.image_url||null, it.price||0, it.quantity||1]);
      if (it.product_id) {
        await query('UPDATE marketplace_products SET stock = GREATEST(stock - $1, 0) WHERE product_id=$2', [it.quantity||1, it.product_id]);
      }
    }
    // Clear cart after order
    await query('DELETE FROM marketplace_cart WHERE user_id=$1', [req.user.user_id]);
    return R.created(res, { order_id: oid, order_number: orderNum, total, estimated_delivery: estDelivery });
  } catch(e) { console.error('[Market] placeOrder:', e.message); return R.serverError(res); }
};

exports.getMyOrders = async (req, res) => {
  try {
    const { rows } = await query(
      'SELECT * FROM marketplace_orders WHERE buyer_id=$1 ORDER BY created_at DESC', [req.user.user_id]);
    return R.ok(res, { orders: rows });
  } catch(e) { return R.serverError(res); }
};

exports.getOrder = async (req, res) => {
  try {
    const { rows } = await query(
      'SELECT * FROM marketplace_orders WHERE order_id=$1', [req.params.order_id]);
    if (!rows.length) return R.notFound(res, 'Order not found');
    const order = rows[0];
    // Attach if buyer or seller of any item
    if (order.buyer_id !== req.user.user_id) {
      const { rows: srows } = await query(
        `SELECT oi.* FROM marketplace_order_items oi
         JOIN marketplace_products p ON p.product_id = oi.product_id
         WHERE oi.order_id=$1 AND p.seller_id=$2`, [req.params.order_id, req.user.user_id]);
      if (!srows.length) return R.forbidden ? R.forbidden(res) : res.status(403).json({ success:false, message:'Forbidden' });
    }
    const { rows: items } = await query(
      `SELECT oi.*, p.images AS product_images FROM marketplace_order_items oi
       LEFT JOIN marketplace_products p ON p.product_id = oi.product_id
       WHERE oi.order_id=$1`, [req.params.order_id]);
    order.items = items;
    return R.ok(res, order);
  } catch(e) { console.error('[Market] getOrder:', e.message); return R.serverError(res); }
};

exports.getSellerOrders = async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT o.*, oi.name AS item_name, oi.quantity, oi.price FROM marketplace_orders o
       JOIN marketplace_order_items oi ON oi.order_id = o.order_id
       JOIN marketplace_products p ON p.product_id = oi.product_id
       WHERE p.seller_id=$1 ORDER BY o.created_at DESC`, [req.user.user_id]);
    return R.ok(res, { orders: rows });
  } catch(e) { return R.serverError(res); }
};

exports.updateOrderStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const valid = ['confirmed','processing','shipped','out_for_delivery','delivered','cancelled'];
    if (!valid.includes(status)) return R.badRequest(res, 'Invalid status');
    await query('UPDATE marketplace_orders SET status=$1 WHERE order_id=$2', [status, req.params.order_id]);
    return R.ok(res, { updated: true });
  } catch(e) { return R.serverError(res); }
};

// ── REVIEWS ──────────────────────────────────────────────────────────────────
exports.addReview = async (req, res) => {
  try {
    const { rating, comment } = req.body;
    if (!rating) return R.badRequest(res, 'rating required');
    await query(
      `INSERT INTO marketplace_reviews (review_id,product_id,user_id,rating,comment)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (product_id,user_id) DO UPDATE SET rating=$4, comment=$5`,
      ['rev_'+uid(), req.params.listing_id, req.user.user_id, Number(rating), comment||'']);
    return R.created(res, { reviewed: true });
  } catch(e) { return R.serverError(res); }
};

exports.getReviews = async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT r.*, u.full_name AS user_name, u.avatar_url FROM marketplace_reviews r
       LEFT JOIN users u ON u.user_id = r.user_id
       WHERE r.product_id=$1 ORDER BY r.created_at DESC`, [req.params.listing_id]);
    return R.ok(res, { reviews: rows });
  } catch(e) { return R.serverError(res); }
};
