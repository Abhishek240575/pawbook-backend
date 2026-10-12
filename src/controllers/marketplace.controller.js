'use strict';
/**
 * marketplace.controller.js
 * Full marketplace — buyers + sellers.
 * Drop into: src/controllers/marketplace.controller.js
 */

const { query: dbQuery } = require('../config/db');
const R = require('../utils/response');

/* ─────────────────────────────────────────────────────────────
   HELPERS
───────────────────────────────────────────────────────────── */
function pg(req) {
  const limit  = Math.min(parseInt(req.query.limit)  || 24, 100);
  const offset = Math.max(parseInt(req.query.offset) || 0,  0);
  return { limit, offset };
}

/* ─────────────────────────────────────────────────────────────
   STORE (seller)
   Each user can own one store.
───────────────────────────────────────────────────────────── */

/** POST /api/marketplace/store  — create store */
exports.createStore = async (req, res, next) => {
  try {
    const uid = req.user.user_id;
    const { name, description, city, phone, category } = req.body;

    // idempotent: return existing store if already registered
    const exists = await dbQuery(
      `SELECT * FROM "MarketStore" WHERE owner_id = $1 LIMIT 1`, [uid]
    );
    if (exists.rows.length) {
      return res.json({ success: true, store: exists.rows[0] });
    }

    const { rows } = await dbQuery(
      `INSERT INTO "MarketStore" (owner_id, name, description, city, phone, category)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING *`,
      [uid, name, description || '', city || '', phone || '', category || 'pet-products']
    );
    return res.status(201).json({ success: true, store: rows[0] });
  } catch (err) { next(err); }
};

/** GET /api/marketplace/store/me — get own store */
exports.getMyStore = async (req, res, next) => {
  try {
    const { rows } = await dbQuery(
      `SELECT * FROM "MarketStore" WHERE owner_id = $1 LIMIT 1`,
      [req.user.user_id]
    );
    if (!rows.length) return res.json({ success: true, store: null });
    return res.json({ success: true, store: rows[0] });
  } catch (err) { next(err); }
};

/** PATCH /api/marketplace/store/me — update own store */
exports.updateMyStore = async (req, res, next) => {
  try {
    const uid = req.user.user_id;
    const { name, description, city, phone, category } = req.body;
    const { rows } = await dbQuery(
      `UPDATE "MarketStore"
          SET name        = COALESCE($2, name),
              description = COALESCE($3, description),
              city        = COALESCE($4, city),
              phone       = COALESCE($5, phone),
              category    = COALESCE($6, category),
              updated_at  = NOW()
        WHERE owner_id = $1
        RETURNING *`,
      [uid, name, description, city, phone, category]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Store not found' });
    return res.json({ success: true, store: rows[0] });
  } catch (err) { next(err); }
};

/* ─────────────────────────────────────────────────────────────
   LISTINGS  (seller-managed products)
───────────────────────────────────────────────────────────── */

/** GET /api/marketplace/listings — browse all OR own listings */
exports.getListings = async (req, res, next) => {
  try {
    const { limit, offset } = pg(req);
    const { q, category, mine } = req.query;
    const uid = req.user?.user_id;

    let where = [`l.is_active = TRUE`];
    const params = [];
    let idx = 1;

    if (mine === 'true' && uid) {
      where = [`s.owner_id = $${idx}`]; params.push(uid); idx++;
    }
    if (category) { where.push(`l.category = $${idx}`); params.push(category); idx++; }
    if (q)        { where.push(`(l.title ILIKE $${idx} OR l.brand ILIKE $${idx})`); params.push(`%${q}%`); idx++; }

    const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const { rows: listings } = await dbQuery(
      `SELECT l.*, s.name AS store_name, s.city AS store_city
         FROM "MarketListing" l
         JOIN "MarketStore"   s ON s.id = l.store_id
        ${whereClause}
        ORDER BY l.created_at DESC
        LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    );

    const { rows: [{ total }] } = await dbQuery(
      `SELECT COUNT(*) AS total
         FROM "MarketListing" l
         JOIN "MarketStore"   s ON s.id = l.store_id
        ${whereClause}`,
      params
    );

    return res.json({ success: true, listings, total: parseInt(total), limit, offset });
  } catch (err) { next(err); }
};

/** GET /api/marketplace/listings/:id */
exports.getListing = async (req, res, next) => {
  try {
    const { rows } = await dbQuery(
      `SELECT l.*, s.name AS store_name, s.city AS store_city, s.phone AS store_phone
         FROM "MarketListing" l
         JOIN "MarketStore"   s ON s.id = l.store_id
        WHERE l.id = $1`,
      [req.params.listing_id]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Not found' });
    return res.json({ success: true, listing: rows[0] });
  } catch (err) { next(err); }
};

/** POST /api/marketplace/listings — create listing */
exports.createListing = async (req, res, next) => {
  try {
    const uid = req.user.user_id;
    // must have a store
    const storeRes = await dbQuery(
      `SELECT id FROM "MarketStore" WHERE owner_id = $1 LIMIT 1`, [uid]
    );
    if (!storeRes.rows.length) {
      return res.status(400).json({ success: false, message: 'Register a store first' });
    }
    const store_id = storeRes.rows[0].id;
    const { title, description, price, compare_price, category, brand, image_urls, stock_qty } = req.body;

    const { rows } = await dbQuery(
      `INSERT INTO "MarketListing"
         (store_id, title, description, price, compare_price, category, brand, image_urls, stock_qty)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [store_id, title, description || '', price, compare_price || null,
       category || 'pet-products', brand || '', JSON.stringify(image_urls || []), stock_qty || 0]
    );
    return res.status(201).json({ success: true, listing: rows[0] });
  } catch (err) { next(err); }
};

/** PATCH /api/marketplace/listings/:listing_id — update own listing */
exports.updateListing = async (req, res, next) => {
  try {
    const uid = req.user.user_id;
    const { listing_id } = req.params;
    const { title, description, price, compare_price, category, brand, image_urls, stock_qty, is_active } = req.body;

    const { rows } = await dbQuery(
      `UPDATE "MarketListing" l
          SET title         = COALESCE($3, l.title),
              description   = COALESCE($4, l.description),
              price         = COALESCE($5, l.price),
              compare_price = COALESCE($6, l.compare_price),
              category      = COALESCE($7, l.category),
              brand         = COALESCE($8, l.brand),
              image_urls    = COALESCE($9, l.image_urls),
              stock_qty     = COALESCE($10, l.stock_qty),
              is_active     = COALESCE($11, l.is_active),
              updated_at    = NOW()
         FROM "MarketStore" s
        WHERE l.id = $1 AND l.store_id = s.id AND s.owner_id = $2
        RETURNING l.*`,
      [listing_id, uid, title, description, price, compare_price, category, brand,
       image_urls ? JSON.stringify(image_urls) : null, stock_qty, is_active]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Listing not found or not yours' });
    return res.json({ success: true, listing: rows[0] });
  } catch (err) { next(err); }
};

/** DELETE /api/marketplace/listings/:listing_id */
exports.deleteListing = async (req, res, next) => {
  try {
    const uid = req.user.user_id;
    await dbQuery(
      `UPDATE "MarketListing" l SET is_active = FALSE
         FROM "MarketStore" s
        WHERE l.id = $1 AND l.store_id = s.id AND s.owner_id = $2`,
      [req.params.listing_id, uid]
    );
    return res.json({ success: true });
  } catch (err) { next(err); }
};

/* ─────────────────────────────────────────────────────────────
   PRODUCTS  (public read — same as listings, kept for api.js compat)
───────────────────────────────────────────────────────────── */

/** GET /api/marketplace/products */
exports.getProducts = async (req, res, next) => {
  // delegate to getListings logic directly
  req.query.mine = undefined;
  return exports.getListings(req, res, next);
};

/** GET /api/marketplace/products/:product_id */
exports.getProduct = async (req, res, next) => {
  req.params.listing_id = req.params.product_id;
  return exports.getListing(req, res, next);
};

/* ─────────────────────────────────────────────────────────────
   CART
───────────────────────────────────────────────────────────── */

/** GET /api/marketplace/cart */
exports.getCart = async (req, res, next) => {
  try {
    const { rows } = await dbQuery(
      `SELECT c.id AS cart_id, c.quantity,
              l.id AS listing_id, l.title, l.price, l.compare_price,
              l.image_urls, l.brand, l.category, l.stock_qty
         FROM "MarketCart"    c
         JOIN "MarketListing" l ON l.id = c.listing_id
        WHERE c.user_id = $1 AND l.is_active = TRUE
        ORDER BY c.created_at DESC`,
      [req.user.user_id]
    );
    const total = rows.reduce((s, r) => s + r.price * r.quantity, 0);
    return res.json({ success: true, cart: rows, total });
  } catch (err) { next(err); }
};

/** POST /api/marketplace/cart */
exports.addToCart = async (req, res, next) => {
  try {
    const uid = req.user.user_id;
    const { product_id, listing_id, quantity = 1 } = req.body;
    const lid = listing_id || product_id;   // accept both names

    // upsert
    const { rows } = await dbQuery(
      `INSERT INTO "MarketCart" (user_id, listing_id, quantity)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, listing_id)
       DO UPDATE SET quantity = "MarketCart".quantity + EXCLUDED.quantity,
                     updated_at = NOW()
       RETURNING *`,
      [uid, lid, quantity]
    );
    return res.status(201).json({ success: true, cart_item: rows[0] });
  } catch (err) { next(err); }
};

/** PATCH /api/marketplace/cart/:cart_id */
exports.updateCartItem = async (req, res, next) => {
  try {
    const { quantity } = req.body;
    const { rows } = await dbQuery(
      `UPDATE "MarketCart" SET quantity = $1, updated_at = NOW()
        WHERE id = $2 AND user_id = $3
        RETURNING *`,
      [quantity, req.params.cart_id, req.user.user_id]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Cart item not found' });
    return res.json({ success: true, cart_item: rows[0] });
  } catch (err) { next(err); }
};

/** DELETE /api/marketplace/cart/:cart_id */
exports.removeFromCart = async (req, res, next) => {
  try {
    await dbQuery(
      `DELETE FROM "MarketCart" WHERE id = $1 AND user_id = $2`,
      [req.params.cart_id, req.user.user_id]
    );
    return res.json({ success: true });
  } catch (err) { next(err); }
};

/* ─────────────────────────────────────────────────────────────
   ORDERS  (buyer)
───────────────────────────────────────────────────────────── */

/** POST /api/marketplace/orders — place order from cart */
exports.placeOrder = async (req, res, next) => {
  try {
    const uid = req.user.user_id;
    const { delivery_address, shipping_name, shipping_phone, shipping_city,
            shipping_state, shipping_pincode, payment_method = 'cod' } = req.body;

    // get cart
    const { rows: cartItems } = await dbQuery(
      `SELECT c.quantity, l.price, l.id AS listing_id, l.title, l.store_id
         FROM "MarketCart"    c
         JOIN "MarketListing" l ON l.id = c.listing_id
        WHERE c.user_id = $1 AND l.is_active = TRUE`,
      [uid]
    );
    if (!cartItems.length) {
      return res.status(400).json({ success: false, message: 'Cart is empty' });
    }

    const total = cartItems.reduce((s, r) => s + r.price * r.quantity, 0);

    // create order
    const { rows: [order] } = await dbQuery(
      `INSERT INTO "MarketOrder"
         (buyer_id, total_amount, status, payment_method,
          shipping_address, shipping_name, shipping_phone,
          shipping_city, shipping_state, shipping_pincode)
       VALUES ($1,$2,'pending',$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [uid, total, payment_method, delivery_address || '',
       shipping_name || '', shipping_phone || '',
       shipping_city || '', shipping_state || '', shipping_pincode || '']
    );

    // create order items
    for (const item of cartItems) {
      await dbQuery(
        `INSERT INTO "MarketOrderItem" (order_id, listing_id, store_id, quantity, price_at_order)
         VALUES ($1,$2,$3,$4,$5)`,
        [order.id, item.listing_id, item.store_id, item.quantity, item.price]
      );
    }

    // clear cart
    await dbQuery(`DELETE FROM "MarketCart" WHERE user_id = $1`, [uid]);

    return res.status(201).json({ success: true, order });
  } catch (err) { next(err); }
};

/** GET /api/marketplace/orders — my orders as buyer */
exports.getMyOrders = async (req, res, next) => {
  try {
    const { limit, offset } = pg(req);
    const { rows } = await dbQuery(
      `SELECT o.*,
              json_agg(json_build_object(
                'listing_id', oi.listing_id,
                'title',      l.title,
                'brand',      l.brand,
                'image_urls', l.image_urls,
                'quantity',   oi.quantity,
                'price',      oi.price_at_order
              )) AS items
         FROM "MarketOrder"     o
         JOIN "MarketOrderItem" oi ON oi.order_id = o.id
         JOIN "MarketListing"   l  ON l.id = oi.listing_id
        WHERE o.buyer_id = $1
        GROUP BY o.id
        ORDER BY o.created_at DESC
        LIMIT $2 OFFSET $3`,
      [req.user.user_id, limit, offset]
    );
    return res.json({ success: true, orders: rows });
  } catch (err) { next(err); }
};

/** GET /api/marketplace/orders/:order_id */
exports.getOrder = async (req, res, next) => {
  try {
    const { rows } = await dbQuery(
      `SELECT o.*,
              json_agg(json_build_object(
                'listing_id', oi.listing_id,
                'title',      l.title,
                'brand',      l.brand,
                'image_urls', l.image_urls,
                'quantity',   oi.quantity,
                'price',      oi.price_at_order
              )) AS items
         FROM "MarketOrder"     o
         JOIN "MarketOrderItem" oi ON oi.order_id = o.id
         JOIN "MarketListing"   l  ON l.id = oi.listing_id
        WHERE o.id = $1 AND o.buyer_id = $2
        GROUP BY o.id`,
      [req.params.order_id, req.user.user_id]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Order not found' });
    return res.json({ success: true, order: rows[0] });
  } catch (err) { next(err); }
};

/* ─────────────────────────────────────────────────────────────
   SELLER ORDERS
───────────────────────────────────────────────────────────── */

/** GET /api/marketplace/orders/seller — orders for seller's store */
exports.getSellerOrders = async (req, res, next) => {
  try {
    const uid = req.user.user_id;
    const { limit, offset } = pg(req);

    const { rows } = await dbQuery(
      `SELECT DISTINCT o.*,
              u.full_name AS buyer_name, u.username AS buyer_username,
              json_agg(json_build_object(
                'listing_id', oi.listing_id,
                'title',      l.title,
                'quantity',   oi.quantity,
                'price',      oi.price_at_order
              )) AS items
         FROM "MarketOrder"     o
         JOIN "MarketOrderItem" oi ON oi.order_id = o.id
         JOIN "MarketListing"   l  ON l.id = oi.listing_id
         JOIN "MarketStore"     s  ON s.id = l.store_id
         JOIN "User"            u  ON u.user_id = o.buyer_id
        WHERE s.owner_id = $1
        GROUP BY o.id, u.full_name, u.username
        ORDER BY o.created_at DESC
        LIMIT $2 OFFSET $3`,
      [uid, limit, offset]
    );
    return res.json({ success: true, orders: rows });
  } catch (err) { next(err); }
};

/** PATCH /api/marketplace/orders/:order_id/status — seller updates status */
exports.updateOrderStatus = async (req, res, next) => {
  try {
    const uid = req.user.user_id;
    const { order_id } = req.params;
    const { status } = req.body;

    // verify seller owns a listing in this order
    const check = await dbQuery(
      `SELECT 1 FROM "MarketOrderItem" oi
         JOIN "MarketListing" l ON l.id = oi.listing_id
         JOIN "MarketStore"   s ON s.id = l.store_id
        WHERE oi.order_id = $1 AND s.owner_id = $2
        LIMIT 1`,
      [order_id, uid]
    );
    if (!check.rows.length) {
      return res.status(403).json({ success: false, message: 'Not your order' });
    }

    const { rows } = await dbQuery(
      `UPDATE "MarketOrder" SET status = $1, updated_at = NOW()
        WHERE id = $2 RETURNING *`,
      [status, order_id]
    );
    return res.json({ success: true, order: rows[0] });
  } catch (err) { next(err); }
};

/* ─────────────────────────────────────────────────────────────
   REVIEWS
───────────────────────────────────────────────────────────── */

/** POST /api/marketplace/listings/:listing_id/reviews */
exports.addReview = async (req, res, next) => {
  try {
    const { listing_id } = req.params;
    const { rating, body: reviewBody } = req.body;
    const { rows } = await dbQuery(
      `INSERT INTO "MarketReview" (listing_id, user_id, rating, body)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (listing_id, user_id)
       DO UPDATE SET rating = EXCLUDED.rating, body = EXCLUDED.body, updated_at = NOW()
       RETURNING *`,
      [listing_id, req.user.user_id, rating, reviewBody || '']
    );
    // update avg rating on listing
    await dbQuery(
      `UPDATE "MarketListing"
          SET avg_rating   = (SELECT AVG(rating) FROM "MarketReview" WHERE listing_id = $1),
              review_count = (SELECT COUNT(*)    FROM "MarketReview" WHERE listing_id = $1)
        WHERE id = $1`,
      [listing_id]
    );
    return res.status(201).json({ success: true, review: rows[0] });
  } catch (err) { next(err); }
};

/** GET /api/marketplace/listings/:listing_id/reviews */
exports.getReviews = async (req, res, next) => {
  try {
    const { rows } = await dbQuery(
      `SELECT r.*, u.username, u.full_name, u.avatar_url
         FROM "MarketReview" r
         JOIN "User"          u ON u.user_id = r.user_id
        WHERE r.listing_id = $1
        ORDER BY r.created_at DESC`,
      [req.params.listing_id]
    );
    return res.json({ success: true, reviews: rows });
  } catch (err) { next(err); }
};
