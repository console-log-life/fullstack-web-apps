/**
 * TASK 1 - E-commerce store API.
 *
 *   GET    /api/shop/products            list with search + category filter
 *   GET    /api/shop/categories          category names for the filter dropdown
 *   GET    /api/shop/products/:id        product details
 *   GET    /api/shop/cart                the signed-in user's cart
 *   POST   /api/shop/cart                add a product (or bump its quantity)
 *   PATCH  /api/shop/cart/:productId     set an exact quantity
 *   DELETE /api/shop/cart/:productId     remove one line
 *   DELETE /api/shop/cart                empty the cart
 *   POST   /api/shop/checkout            turn the cart into an order
 *   GET    /api/shop/orders              order history
 *   GET    /api/shop/orders/:id          one order with its lines
 *
 * Browsing is public; everything touching a cart or an order requires login.
 */
const express = require('express');

const { db } = require('../db');
const asyncHandler = require('../utils/asyncHandler');
const { authRequired } = require('../middleware/auth');
const {
  ApiError,
  requireString,
  optionalString,
  requireInt,
} = require('../utils/validate');

const router = express.Router();

const MAX_QTY = 99; // per line, so one order cannot drain the whole stock

/* --------------------------------------------------------------------
   Catalogue (public)
   ------------------------------------------------------------------ */

// GET /api/shop/products?search=&category=&sort=
router.get(
  '/products',
  asyncHandler(async (req, res) => {
    const search = (req.query.search || '').toString().trim();
    const category = (req.query.category || '').toString().trim();
    const sort = (req.query.sort || 'newest').toString();

    // Filters are built as a list of conditions with bound parameters, never
    // by splicing user text into the SQL string.
    const where = [];
    const params = [];

    if (search) {
      where.push('(name LIKE ? OR description LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }
    if (category && category !== 'all') {
      where.push('category = ?');
      params.push(category);
    }

    // ORDER BY cannot be a bound parameter, so the choice is mapped through a
    // fixed whitelist instead of being interpolated.
    const orderBy = {
      newest: 'created_at DESC, id DESC',
      price_asc: 'price_cents ASC',
      price_desc: 'price_cents DESC',
      name: 'name COLLATE NOCASE ASC',
    }[sort] || 'created_at DESC, id DESC';

    const sql = `
      SELECT id, name, description, price_cents, category, image_url, stock, created_at
      FROM products
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY ${orderBy}
    `;

    res.json({ products: db.prepare(sql).all(...params) });
  })
);

// GET /api/shop/categories
router.get(
  '/categories',
  asyncHandler(async (_req, res) => {
    const rows = db
      .prepare('SELECT category, COUNT(*) AS count FROM products GROUP BY category ORDER BY category')
      .all();
    res.json({ categories: rows });
  })
);

// GET /api/shop/products/:id
router.get(
  '/products/:id',
  asyncHandler(async (req, res) => {
    const id = requireInt(req.params.id, 'Product id', { min: 1 });
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
    if (!product) throw new ApiError(404, 'That product does not exist.');

    // A few others from the same category for the details page.
    const related = db
      .prepare(
        `SELECT id, name, price_cents, image_url, stock FROM products
          WHERE category = ? AND id <> ? ORDER BY RANDOM() LIMIT 4`
      )
      .all(product.category, product.id);

    res.json({ product, related });
  })
);

/* --------------------------------------------------------------------
   Cart (login required, persisted in the database per user)
   ------------------------------------------------------------------ */

/** Reads a user's cart and totals it in one place, so every cart reply matches. */
function readCart(userId) {
  const items = db
    .prepare(
      `SELECT c.product_id, c.quantity,
              p.name, p.price_cents, p.image_url, p.stock, p.category
         FROM cart_items c
         JOIN products p ON p.id = c.product_id
        WHERE c.user_id = ?
        ORDER BY c.created_at, c.id`
    )
    .all(userId);

  const lines = items.map((item) => ({
    ...item,
    line_total_cents: item.price_cents * item.quantity,
    // Flagged rather than auto-corrected, so the UI can explain the problem.
    over_stock: item.quantity > item.stock,
  }));

  return {
    items: lines,
    count: lines.reduce((sum, l) => sum + l.quantity, 0),
    subtotal_cents: lines.reduce((sum, l) => sum + l.line_total_cents, 0),
  };
}

// GET /api/shop/cart
router.get(
  '/cart',
  authRequired,
  asyncHandler(async (req, res) => {
    res.json({ cart: readCart(req.user.id) });
  })
);

// POST /api/shop/cart  { product_id, quantity }
router.post(
  '/cart',
  authRequired,
  asyncHandler(async (req, res) => {
    const productId = requireInt(req.body.product_id, 'Product id', { min: 1 });
    const quantity = requireInt(req.body.quantity ?? 1, 'Quantity', { min: 1, max: MAX_QTY });

    const product = db.prepare('SELECT id, name, stock FROM products WHERE id = ?').get(productId);
    if (!product) throw new ApiError(404, 'That product does not exist.');
    if (product.stock < 1) throw new ApiError(409, `${product.name} is out of stock.`);

    const existing = db
      .prepare('SELECT quantity FROM cart_items WHERE user_id = ? AND product_id = ?')
      .get(req.user.id, productId);

    // Adding an item already in the cart raises its quantity instead of
    // creating a second line, capped at the stock on hand.
    const wanted = (existing?.quantity || 0) + quantity;
    if (wanted > product.stock) {
      throw new ApiError(
        409,
        `Only ${product.stock} of ${product.name} left${existing ? ` and you already have ${existing.quantity} in your cart` : ''}.`
      );
    }

    db.prepare(
      `INSERT INTO cart_items (user_id, product_id, quantity) VALUES (?, ?, ?)
       ON CONFLICT (user_id, product_id) DO UPDATE SET quantity = ?`
    ).run(req.user.id, productId, wanted, wanted);

    res.status(201).json({ cart: readCart(req.user.id), message: `${product.name} added to your cart.` });
  })
);

// PATCH /api/shop/cart/:productId  { quantity }  (0 removes the line)
router.patch(
  '/cart/:productId',
  authRequired,
  asyncHandler(async (req, res) => {
    const productId = requireInt(req.params.productId, 'Product id', { min: 1 });
    const quantity = requireInt(req.body.quantity, 'Quantity', { min: 0, max: MAX_QTY });

    const line = db
      .prepare('SELECT product_id FROM cart_items WHERE user_id = ? AND product_id = ?')
      .get(req.user.id, productId);
    if (!line) throw new ApiError(404, 'That item is not in your cart.');

    if (quantity === 0) {
      db.prepare('DELETE FROM cart_items WHERE user_id = ? AND product_id = ?')
        .run(req.user.id, productId);
      return res.json({ cart: readCart(req.user.id), message: 'Item removed.' });
    }

    const product = db.prepare('SELECT name, stock FROM products WHERE id = ?').get(productId);
    if (quantity > product.stock) {
      throw new ApiError(409, `Only ${product.stock} of ${product.name} left in stock.`);
    }

    db.prepare('UPDATE cart_items SET quantity = ? WHERE user_id = ? AND product_id = ?')
      .run(quantity, req.user.id, productId);

    res.json({ cart: readCart(req.user.id), message: 'Quantity updated.' });
  })
);

// DELETE /api/shop/cart/:productId
router.delete(
  '/cart/:productId',
  authRequired,
  asyncHandler(async (req, res) => {
    const productId = requireInt(req.params.productId, 'Product id', { min: 1 });
    const info = db
      .prepare('DELETE FROM cart_items WHERE user_id = ? AND product_id = ?')
      .run(req.user.id, productId);
    if (info.changes === 0) throw new ApiError(404, 'That item is not in your cart.');
    res.json({ cart: readCart(req.user.id), message: 'Item removed.' });
  })
);

// DELETE /api/shop/cart
router.delete(
  '/cart',
  authRequired,
  asyncHandler(async (req, res) => {
    db.prepare('DELETE FROM cart_items WHERE user_id = ?').run(req.user.id);
    res.json({ cart: readCart(req.user.id), message: 'Cart emptied.' });
  })
);

/* --------------------------------------------------------------------
   Checkout and orders (login required)
   ------------------------------------------------------------------ */

// POST /api/shop/checkout  { shipping_name, address }
router.post(
  '/checkout',
  authRequired,
  asyncHandler(async (req, res) => {
    const shippingName = requireString(req.body.shipping_name, 'Full name', { min: 2, max: 120 });
    const address = requireString(req.body.address, 'Delivery address', { min: 8, max: 400 });

    const userId = req.user.id;

    /**
     * The whole checkout runs in one transaction: read the cart, re-check
     * stock, insert the order and its lines, decrement stock, clear the cart.
     * If any step throws, better-sqlite3 rolls the lot back, so stock can
     * never be reduced for an order that was not created.
     */
    const placeOrder = db.transaction(() => {
      const items = db
        .prepare(
          `SELECT c.product_id, c.quantity, p.name, p.price_cents, p.stock
             FROM cart_items c
             JOIN products p ON p.id = c.product_id
            WHERE c.user_id = ?`
        )
        .all(userId);

      if (items.length === 0) {
        throw new ApiError(400, 'Your cart is empty.');
      }

      // Stock is verified again here, not just when the item was added: it may
      // have sold out while the cart sat open.
      for (const item of items) {
        if (item.quantity > item.stock) {
          throw new ApiError(
            409,
            `${item.name} only has ${item.stock} left (your cart has ${item.quantity}). Please adjust your cart.`
          );
        }
      }

      const total = items.reduce((sum, i) => sum + i.price_cents * i.quantity, 0);

      const orderInfo = db
        .prepare(
          `INSERT INTO orders (user_id, total_cents, status, shipping_name, address)
           VALUES (?, ?, 'paid', ?, ?)`
        )
        .run(userId, total, shippingName, address);
      const orderId = Number(orderInfo.lastInsertRowid);

      const insertLine = db.prepare(
        `INSERT INTO order_items (order_id, product_id, product_name, unit_price_cents, quantity)
         VALUES (?, ?, ?, ?, ?)`
      );
      const reduceStock = db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?');

      for (const item of items) {
        insertLine.run(orderId, item.product_id, item.name, item.price_cents, item.quantity);
        reduceStock.run(item.quantity, item.product_id);
      }

      db.prepare('DELETE FROM cart_items WHERE user_id = ?').run(userId);

      return { orderId, total, lineCount: items.length };
    });

    const result = placeOrder();

    res.status(201).json({
      order_id: result.orderId,
      total_cents: result.total,
      message: `Order #${result.orderId} placed. ${result.lineCount} item type(s), ${(result.total / 100).toFixed(2)} charged.`,
    });
  })
);

// GET /api/shop/orders
router.get(
  '/orders',
  authRequired,
  asyncHandler(async (req, res) => {
    const orders = db
      .prepare(
        `SELECT o.*,
                (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id)            AS line_count,
                (SELECT COALESCE(SUM(oi.quantity),0) FROM order_items oi WHERE oi.order_id = o.id) AS item_count
           FROM orders o
          WHERE o.user_id = ?
          ORDER BY o.created_at DESC, o.id DESC`
      )
      .all(req.user.id);

    // Attach the lines so the history page can expand an order without a second call.
    const lines = db.prepare('SELECT * FROM order_items WHERE order_id = ?');
    for (const order of orders) {
      order.items = lines.all(order.id);
    }

    res.json({ orders });
  })
);

// GET /api/shop/orders/:id
router.get(
  '/orders/:id',
  authRequired,
  asyncHandler(async (req, res) => {
    const id = requireInt(req.params.id, 'Order id', { min: 1 });
    // The user_id condition is the authorization check: you cannot read
    // somebody else's order by guessing its id.
    const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(id, req.user.id);
    if (!order) throw new ApiError(404, 'Order not found.');
    order.items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
    res.json({ order });
  })
);

// PATCH /api/shop/orders/:id/cancel - a pending or paid order can be cancelled.
router.patch(
  '/orders/:id/cancel',
  authRequired,
  asyncHandler(async (req, res) => {
    const id = requireInt(req.params.id, 'Order id', { min: 1 });

    // Cancelling returns the stock, so it is also a transaction.
    const cancel = db.transaction(() => {
      const order = db
        .prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?')
        .get(id, req.user.id);
      if (!order) throw new ApiError(404, 'Order not found.');
      if (!['pending', 'paid'].includes(order.status)) {
        throw new ApiError(409, `An order that is already ${order.status} cannot be cancelled.`);
      }

      const items = db.prepare('SELECT product_id, quantity FROM order_items WHERE order_id = ?').all(id);
      const restock = db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?');
      for (const item of items) {
        if (item.product_id) restock.run(item.quantity, item.product_id);
      }

      db.prepare("UPDATE orders SET status = 'cancelled' WHERE id = ?").run(id);
    });

    cancel();
    res.json({ message: `Order #${id} cancelled and stock returned.` });
  })
);

module.exports = router;
