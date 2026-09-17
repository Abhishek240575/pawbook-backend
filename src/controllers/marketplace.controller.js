const { query, getClient } = require('../config/db');
const R = require('../utils/response');

// ── PRODUCTS (MarketplaceItem) ────────────────────────────────────────────────
const getProducts = async (req, res, next) => {
  const { page, limit, offset } = req.pagination;
  const { category, brand, min_price, max_price, q, sort = 'popular' } = req.query;
  try {
    let where = `WHERE p.is_active = TRUE`;
    const params = [];
    let i = 1;
    if (category)  { where += ` AND p.category = $${i++}`;                        params.push(category); }
    if (brand)     { where += ` AND p.brand ILIKE $${i++}`;                       params.push(`%${brand}%`); }
    if (min_price) { where += ` AND p.price_inr >= $${i++}`;                      params.push(parseFloat(min_price)); }
    if (max_price) { where += ` AND p.price_inr <= $${i++}`;                      params.push(parseFloat(max_price)); }
    if (q)         { where += ` AND (p.title ILIKE $${i++} OR p.description ILIKE $${i-1})`; params.push(`%${q}%`); }

    const orderBy = sort === 'price_asc'  ? 'p.price_inr ASC'
                  : sort === 'price_desc' ? 'p.price_inr DESC'
                  : sort === 'newest'     ? 'p.created_at DESC'
                  :                        'p.sold_count DESC NULLS LAST, p.avg_rating DESC NULLS LAST';

    const { rows: data } = await query(
      `SELECT p.item_id AS product_id, p.title AS name, p.description, p.category, p.brand,
              p.price_inr,
              ROUND(p.price_inr / (1 - LEAST(p.discount_pct,99)/100.0), 2) AS compare_price_inr,
              p.stock_qty, p.avg_rating AS rating, p.review_count AS total_reviews,
              p.sold_count AS total_sold, p.images AS image_urls, p.species_tags AS tags,
              p.is_featured, p.discount_pct AS cashback_pct, p.created_at
         FROM "MarketplaceItem" p
        ${where}
        ORDER BY ${orderBy}
        LIMIT $${i++} OFFSET $${i}`,
      [...params, limit, offset]
    );
    const { rows: [{ total }] } = await query(
      `SELECT COUNT(*) AS total FROM "MarketplaceItem" p ${where}`, params
    );
    return R.paginated(res, data, { page, limit, total: parseInt(total) });
  } catch (err) { next(err); }
};

const getProduct = async (req, res, next) => {
  const { product_id } = req.params;
  try {
    const { rows } = await query(
      `SELECT item_id AS product_id, title AS name, description, category, brand,
              price_inr, stock_qty, avg_rating AS rating, review_count AS total_reviews,
              sold_count AS total_sold, images AS image_urls, species_tags AS tags,
              is_featured, discount_pct AS cashback_pct, created_at
         FROM "MarketplaceItem"
        WHERE item_id = $1 AND is_active = TRUE`,
      [product_id]
    );
    if (!rows.length) return R.notFound(res, 'Product not found');
    return R.ok(res, rows[0]);
  } catch (err) { next(err); }
};

// ── CART (uses item_id referencing MarketplaceItem) ───────────────────────────
const getCart = async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT c.cart_id, c.quantity, c.added_at,
              p.item_id AS product_id, p.title AS name, p.price_inr,
              ROUND(p.price_inr / (1 - LEAST(p.discount_pct,99)/100.0), 2) AS compare_price_inr,
              p.images AS image_urls, p.brand, p.stock_qty, p.discount_pct AS cashback_pct
         FROM "Cart" c
         JOIN "MarketplaceItem" p ON p.item_id = c.item_id
        WHERE c.user_id = $1
        ORDER BY c.added_at DESC`,
      [req.user.user_id]
    );
    const subtotal = rows.reduce((sum, item) => sum + (item.price_inr * item.quantity), 0);
    const savings  = rows.reduce((sum, item) => {
      const orig = item.compare_price_inr || item.price_inr;
      return sum + (orig - item.price_inr) * item.quantity;
    }, 0);
    return R.ok(res, { items: rows, subtotal, savings, item_count: rows.length });
  } catch (err) { next(err); }
};

const addToCart = async (req, res, next) => {
  const { product_id, quantity = 1 } = req.body;
  try {
    const prod = await query(
      `SELECT item_id, stock_qty FROM "MarketplaceItem" WHERE item_id = $1 AND is_active = TRUE`,
      [product_id]
    );
    if (!prod.rows.length) return R.notFound(res, 'Product not found');
    if (prod.rows[0].stock_qty < quantity) return R.badRequest(res, 'Insufficient stock');

    const { rows } = await query(
      `INSERT INTO "Cart" (user_id, item_id, quantity)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, item_id) DO UPDATE SET quantity = "Cart".quantity + $3
       RETURNING *`,
      [req.user.user_id, product_id, quantity]
    );
    return R.ok(res, rows[0], 'Added to cart');
  } catch (err) { next(err); }
};

const updateCartItem = async (req, res, next) => {
  const { cart_id } = req.params;
  const { quantity } = req.body;
  if (!quantity || quantity < 1) return R.badRequest(res, 'Quantity must be at least 1');
  try {
    const { rows } = await query(
      `UPDATE "Cart" SET quantity = $1 WHERE cart_id = $2 AND user_id = $3 RETURNING *`,
      [quantity, cart_id, req.user.user_id]
    );
    if (!rows.length) return R.notFound(res, 'Cart item not found');
    return R.ok(res, rows[0], 'Cart updated');
  } catch (err) { next(err); }
};

const removeFromCart = async (req, res, next) => {
  const { cart_id } = req.params;
  try {
    const { rows } = await query(
      `DELETE FROM "Cart" WHERE cart_id = $1 AND user_id = $2 RETURNING cart_id`,
      [cart_id, req.user.user_id]
    );
    if (!rows.length) return R.notFound(res, 'Cart item not found');
    return R.ok(res, null, 'Removed from cart');
  } catch (err) { next(err); }
};

// ── ORDERS (buyer_id, no OrderItem table found) ───────────────────────────────
const placeOrder = async (req, res, next) => {
  const { delivery_address, delivery_city, delivery_state, delivery_pincode, payment_method = 'cod' } = req.body;
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const { rows: cartItems } = await client.query(
      `SELECT c.cart_id, c.item_id, c.quantity, p.price_inr, p.title, p.stock_qty
         FROM "Cart" c
         JOIN "MarketplaceItem" p ON p.item_id = c.item_id
        WHERE c.user_id = $1`,
      [req.user.user_id]
    );
    if (!cartItems.length) return R.badRequest(res, 'Cart is empty');

    for (const item of cartItems) {
      if (item.stock_qty < item.quantity)
        return R.badRequest(res, `Insufficient stock for ${item.title}`);
    }

    const total = cartItems.reduce((s, i) => s + i.price_inr * i.quantity, 0);

    // Generate order number
    const order_no = 'PB' + Date.now().toString().slice(-8);

    const { rows: [order] } = await client.query(
      `INSERT INTO "Order" (order_no, buyer_id, status)
       VALUES ($1, $2, 'confirmed')
       RETURNING *`,
      [order_no, req.user.user_id]
    );

    // Create payment record
    await client.query(
      `INSERT INTO "Payment" (payer_id, amount_inr, method, status, ref_table, ref_id)
       VALUES ($1, $2, $3, $4, 'Order', $5)`,
      [req.user.user_id, total, payment_method, payment_method === 'cod' ? 'pending' : 'paid', order.order_id]
    );

    // Deduct stock
    for (const item of cartItems) {
      await client.query(
        `UPDATE "MarketplaceItem" SET stock_qty = stock_qty - $1, sold_count = sold_count + $1 WHERE item_id = $2`,
        [item.quantity, item.item_id]
      );
    }

    await client.query(`DELETE FROM "Cart" WHERE user_id = $1`, [req.user.user_id]);
    await client.query('COMMIT');

    return R.created(res, { ...order, total_inr: total, delivery_address }, 'Order placed successfully');
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally { client.release(); }
};

const getMyOrders = async (req, res, next) => {
  const { page, limit, offset } = req.pagination;
  try {
    const { rows: data } = await query(
      `SELECT o.order_id, o.order_no, o.status, o.created_at,
              p.amount_inr AS total_inr, p.method AS payment_method, p.status AS payment_status
         FROM "Order" o
         LEFT JOIN "Payment" p ON p.ref_table = 'Order' AND p.ref_id = o.order_id
        WHERE o.buyer_id = $1
        ORDER BY o.created_at DESC
        LIMIT $2 OFFSET $3`,
      [req.user.user_id, limit, offset]
    );
    const { rows: [{ total }] } = await query(
      `SELECT COUNT(*) AS total FROM "Order" WHERE buyer_id = $1`, [req.user.user_id]
    );
    return R.paginated(res, data, { page, limit, total: parseInt(total) });
  } catch (err) { next(err); }
};

const getOrder = async (req, res, next) => {
  const { order_id } = req.params;
  try {
    const { rows } = await query(
      `SELECT o.*, p.amount_inr AS total_inr, p.method AS payment_method, p.status AS payment_status
         FROM "Order" o
         LEFT JOIN "Payment" p ON p.ref_table = 'Order' AND p.ref_id = o.order_id
        WHERE o.order_id = $1 AND o.buyer_id = $2`,
      [order_id, req.user.user_id]
    );
    if (!rows.length) return R.notFound(res, 'Order not found');
    return R.ok(res, rows[0]);
  } catch (err) { next(err); }
};

module.exports = {
  getProducts, getProduct,
  getCart, addToCart, updateCartItem, removeFromCart,
  placeOrder, getMyOrders, getOrder
};
