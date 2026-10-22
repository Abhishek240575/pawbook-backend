// routes/marketplace.js — PawBook Marketplace
const express = require('express');
const router  = express.Router();
const { pool } = require('../db');
const auth    = require('../middleware/auth');

function optionalAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.replace('Bearer ', '').trim();
  if (token) {
    try {
      const jwt = require('jsonwebtoken');
      req.user = jwt.verify(token, process.env.JWT_SECRET);
    } catch {}
  }
  next();
}

// ── LISTINGS ─────────────────────────────────────────────────────

// GET /api/v1/marketplace/listings
router.get('/listings', optionalAuth, async (req, res) => {
  try {
    const { category, brand, q, sort = 'popular', limit = 20, offset = 0 } = req.query;
    const conditions = ['l.is_active = TRUE'];
    const values     = [];
    let idx = 1;

    if (category) { conditions.push(`l.category = $${idx++}`);                              values.push(category); }
    if (brand)    { conditions.push(`l.brand ILIKE $${idx++}`);                             values.push(`%${brand}%`); }
    if (q)        { conditions.push(`(l.title ILIKE $${idx} OR l.description ILIKE $${idx})`); values.push(`%${q}%`); idx++; }

    const orderMap = {
      popular:    'l.sold_count DESC, l.view_count DESC',
      newest:     'l.created_at DESC',
      price_asc:  'l.price ASC',
      price_desc: 'l.price DESC',
      rating:     'l.rating DESC',
    };
    const orderBy = orderMap[sort] || orderMap.popular;
    const where   = 'WHERE ' + conditions.join(' AND ');

    values.push(Number(limit), Number(offset));
    const sql = `
      SELECT l.*, s.name AS store_name, s.city AS store_city
      FROM   marketplace_listings l
      LEFT JOIN marketplace_stores s ON s.id = l.store_id
      ${where}
      ORDER BY ${orderBy}
      LIMIT $${idx++} OFFSET $${idx++}
    `;
    const countSql = `SELECT COUNT(*) FROM marketplace_listings l ${where}`;

    const [{ rows }, { rows: countRow }] = await Promise.all([
      pool.query(sql, values),
      pool.query(countSql, values.slice(0, -2)),
    ]);

    res.json({ data: rows, meta: { total: Number(countRow[0].count), limit: Number(limit), offset: Number(offset) } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load listings' });
  }
});

// GET /api/v1/marketplace/listings/:id
router.get('/listings/:id', optionalAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT l.*, s.name AS store_name, s.logo_url AS store_logo,
              s.city AS store_city, s.rating AS store_rating
       FROM marketplace_listings l
       LEFT JOIN marketplace_stores s ON s.id = l.store_id
       WHERE l.id=$1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });

    await pool.query(
      'UPDATE marketplace_listings SET view_count = view_count + 1 WHERE id=$1',
      [req.params.id]
    );

    const { rows: reviews } = await pool.query(
      `SELECT r.*, u.username AS user_name FROM marketplace_reviews r
       LEFT JOIN users u ON u.user_id = r.user_id
       WHERE r.listing_id=$1 ORDER BY r.created_at DESC LIMIT 20`,
      [req.params.id]
    );
    res.json({ data: rows[0], reviews });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load listing' });
  }
});

// POST /api/v1/marketplace/listings
router.post('/listings', auth, async (req, res) => {
  try {
    const { title, description, category, price, compare_price, brand, image_urls, stock, unit, tags } = req.body;
    if (!title || !price || !category) return res.status(400).json({ error: 'title, price, category required' });

    let { rows: [store] } = await pool.query(
      'SELECT id FROM marketplace_stores WHERE user_id=$1', [req.user.id]
    );
    if (!store) {
      const r = await pool.query(
        'INSERT INTO marketplace_stores (user_id, name) VALUES ($1,$2) RETURNING id',
        [req.user.id, `${req.user.name || 'User'}'s Store`]
      );
      store = r.rows[0];
    }

    const { rows } = await pool.query(
      `INSERT INTO marketplace_listings
         (store_id, user_id, title, description, category, price, compare_price,
          brand, image_urls, stock, unit, tags)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [store.id, req.user.id, title, description, category, price,
       compare_price || null, brand || null,
       JSON.stringify(image_urls || []), stock || 0, unit || 'piece', tags || []]
    );
    res.status(201).json({ data: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create listing' });
  }
});

// PATCH /api/v1/marketplace/listings/:id
router.patch('/listings/:id', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM marketplace_listings WHERE id=$1', [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    if (rows[0].user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

    const fields  = ['title','description','category','price','compare_price','brand','image_urls','stock','unit','is_active'];
    const updates = [];
    const values  = [];
    fields.forEach(f => {
      if (req.body[f] !== undefined) {
        updates.push(`${f} = $${updates.length + 1}`);
        values.push(req.body[f]);
      }
    });
    if (!updates.length) return res.status(400).json({ error: 'Nothing to update' });
    updates.push('updated_at = NOW()');
    values.push(req.params.id);

    const { rows: updated } = await pool.query(
      `UPDATE marketplace_listings SET ${updates.join(', ')} WHERE id=$${values.length} RETURNING *`,
      values
    );
    res.json({ data: updated[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update listing' });
  }
});

// DELETE /api/v1/marketplace/listings/:id
router.delete('/listings/:id', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT user_id FROM marketplace_listings WHERE id=$1', [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    if (rows[0].user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    await pool.query('DELETE FROM marketplace_listings WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete listing' });
  }
});

// ── STORES ────────────────────────────────────────────────────────

router.get('/store/me', auth, async (req, res) => {
  try {
    const { rows: [store] } = await pool.query(
      'SELECT * FROM marketplace_stores WHERE user_id=$1', [req.user.id]
    );
    if (!store) return res.json({ data: null, listings: [] });

    const { rows: listings } = await pool.query(
      'SELECT * FROM marketplace_listings WHERE store_id=$1 ORDER BY created_at DESC',
      [store.id]
    );
    res.json({ data: store, listings });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load store' });
  }
});

router.post('/store', auth, async (req, res) => {
  const { name, description, banner_url, logo_url, phone, whatsapp, address, city, state, country } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });

  try {
    const { rows: [existing] } = await pool.query(
      'SELECT id FROM marketplace_stores WHERE user_id=$1', [req.user.id]
    );
    let row;
    if (existing) {
      const r = await pool.query(
        `UPDATE marketplace_stores SET name=$1,description=$2,banner_url=$3,logo_url=$4,
         phone=$5,whatsapp=$6,address=$7,city=$8,state=$9,country=$10,updated_at=NOW()
         WHERE user_id=$11 RETURNING *`,
        [name,description,banner_url,logo_url,phone,whatsapp,address,city,state,country||'India',req.user.id]
      );
      row = r.rows[0];
    } else {
      const r = await pool.query(
        `INSERT INTO marketplace_stores
           (user_id,name,description,banner_url,logo_url,phone,whatsapp,address,city,state,country)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [req.user.id,name,description,banner_url,logo_url,phone,whatsapp,address,city,state,country||'India']
      );
      row = r.rows[0];
    }
    res.json({ data: row });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save store' });
  }
});

// ── CART ──────────────────────────────────────────────────────────

router.get('/cart', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.*, l.title, l.price, l.currency, l.image_urls, l.stock, l.is_active
       FROM marketplace_cart c
       JOIN marketplace_listings l ON l.id = c.listing_id
       WHERE c.user_id=$1`,
      [req.user.id]
    );
    const total = rows.reduce((sum, r) => sum + (r.price * r.quantity), 0);
    res.json({ data: rows, total: total.toFixed(2), count: rows.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load cart' });
  }
});

router.post('/cart', auth, async (req, res) => {
  const { listing_id, quantity = 1 } = req.body;
  if (!listing_id) return res.status(400).json({ error: 'listing_id required' });
  try {
    const { rows: [listing] } = await pool.query(
      'SELECT id, stock, is_active FROM marketplace_listings WHERE id=$1', [listing_id]
    );
    if (!listing || !listing.is_active) return res.status(404).json({ error: 'Product not found or inactive' });

    const { rows } = await pool.query(
      `INSERT INTO marketplace_cart (user_id, listing_id, quantity)
       VALUES ($1,$2,$3)
       ON CONFLICT (user_id, listing_id) DO UPDATE SET quantity=EXCLUDED.quantity
       RETURNING *`,
      [req.user.id, listing_id, Math.max(1, quantity)]
    );
    res.json({ data: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update cart' });
  }
});

router.delete('/cart/:listing_id', auth, async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM marketplace_cart WHERE user_id=$1 AND listing_id=$2',
      [req.user.id, req.params.listing_id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to remove item' });
  }
});

router.delete('/cart', auth, async (req, res) => {
  try {
    await pool.query('DELETE FROM marketplace_cart WHERE user_id=$1', [req.user.id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to clear cart' });
  }
});

// ── ORDERS ────────────────────────────────────────────────────────

router.get('/orders', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT o.*, s.name AS store_name,
              json_agg(json_build_object(
                'id',oi.id,'title',oi.title,'price',oi.price,
                'quantity',oi.quantity,'image_url',oi.image_url)) AS items
       FROM marketplace_orders o
       LEFT JOIN marketplace_stores s ON s.id = o.store_id
       LEFT JOIN marketplace_order_items oi ON oi.order_id = o.id
       WHERE o.buyer_id=$1
       GROUP BY o.id, s.name
       ORDER BY o.placed_at DESC`,
      [req.user.id]
    );
    res.json({ data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load orders' });
  }
});

router.get('/orders/seller', auth, async (req, res) => {
  try {
    const { rows: [store] } = await pool.query(
      'SELECT id FROM marketplace_stores WHERE user_id=$1', [req.user.id]
    );
    if (!store) return res.json({ data: [] });

    const { rows } = await pool.query(
      `SELECT o.*,
              json_agg(json_build_object(
                'id',oi.id,'title',oi.title,'price',oi.price,'quantity',oi.quantity)) AS items
       FROM marketplace_orders o
       LEFT JOIN marketplace_order_items oi ON oi.order_id = o.id
       WHERE o.store_id=$1
       GROUP BY o.id
       ORDER BY o.placed_at DESC`,
      [store.id]
    );
    res.json({ data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load seller orders' });
  }
});

router.post('/orders', auth, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { shipping_name, shipping_phone, shipping_address, shipping_city, shipping_state, notes } = req.body;

    const { rows: cart } = await client.query(
      `SELECT c.*, l.title, l.price, l.image_urls, l.store_id, l.stock
       FROM marketplace_cart c
       JOIN marketplace_listings l ON l.id = c.listing_id
       WHERE c.user_id=$1`,
      [req.user.id]
    );
    if (!cart.length) return res.status(400).json({ error: 'Cart is empty' });

    const total   = cart.reduce((s, r) => s + r.price * r.quantity, 0);
    const storeId = cart[0].store_id;

    const { rows: [order] } = await client.query(
      `INSERT INTO marketplace_orders
         (buyer_id, store_id, total_amount, shipping_name, shipping_phone,
          shipping_address, shipping_city, shipping_state, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [req.user.id, storeId, total.toFixed(2),
       shipping_name, shipping_phone, shipping_address,
       shipping_city, shipping_state, notes]
    );

    for (const item of cart) {
      await client.query(
        `INSERT INTO marketplace_order_items (order_id, listing_id, title, price, quantity, image_url)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [order.id, item.listing_id, item.title, item.price, item.quantity, item.image_urls?.[0] || null]
      );
      await client.query(
        'UPDATE marketplace_listings SET stock=GREATEST(0,stock-$1), sold_count=sold_count+$1 WHERE id=$2',
        [item.quantity, item.listing_id]
      );
    }

    await client.query('DELETE FROM marketplace_cart WHERE user_id=$1', [req.user.id]);
    await client.query('COMMIT');
    res.status(201).json({ data: order });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Failed to place order' });
  } finally {
    client.release();
  }
});

router.patch('/orders/:id/status', auth, async (req, res) => {
  const valid = ['pending','confirmed','shipped','delivered','cancelled','refunded'];
  const { status } = req.body;
  if (!valid.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  try {
    const { rows: [order] } = await pool.query(
      `SELECT o.id FROM marketplace_orders o
       JOIN marketplace_stores s ON s.id = o.store_id
       WHERE o.id=$1 AND s.user_id=$2`,
      [req.params.id, req.user.id]
    );
    if (!order) return res.status(403).json({ error: 'Forbidden' });

    const { rows } = await pool.query(
      'UPDATE marketplace_orders SET status=$1, updated_at=NOW() WHERE id=$2 RETURNING *',
      [status, req.params.id]
    );
    res.json({ data: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update order status' });
  }
});

// ── REVIEWS (inline, also handles /api/v1/reviews compat) ────────

router.get('/reviews', async (req, res) => {
  const { listing_id } = req.query;
  if (!listing_id) return res.status(400).json({ error: 'listing_id required' });
  try {
    const { rows } = await pool.query(
      `SELECT r.*, u.username AS user_name FROM marketplace_reviews r
       LEFT JOIN users u ON u.user_id = r.user_id
       WHERE r.listing_id=$1 ORDER BY r.created_at DESC`,
      [listing_id]
    );
    res.json({ data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load reviews' });
  }
});

router.post('/reviews', auth, async (req, res) => {
  const { listing_id, product_id, rating, title, body } = req.body;
  const lid = listing_id || product_id;
  if (!lid || !rating) return res.status(400).json({ error: 'listing_id and rating required' });
  if (rating < 1 || rating > 5) return res.status(400).json({ error: 'rating must be 1–5' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO marketplace_reviews (listing_id, user_id, rating, title, body)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (listing_id, user_id) DO UPDATE
         SET rating=$3, title=$4, body=$5, created_at=NOW()
       RETURNING *`,
      [lid, req.user.id, rating, title || null, body || null]
    );
    res.status(201).json({ data: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to submit review' });
  }
});

module.exports = router;
