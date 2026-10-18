/**
 * Project 1 (ShopLite) - demo data seeder (`npm run seed`).
 *
 * Loads the four demo users and a 16-product catalogue, plus a cart
 * and one past order for `demo` so every page has something to show.
 *
 * Re-running it is safe: it clears this task's tables and re-inserts them, so
 * you always get the same predictable starting state for a demo.
 */
require('dotenv').config();

const bcrypt = require('bcryptjs');
const { db, migrate, DB_PATH } = require('./index');

migrate();

const PASSWORD = 'password123';

// The same four accounts in every task, so one set of credentials works
// everywhere in the submission.
const USERS = [
  { username: 'demo', email: 'demo@example.com' },
  { username: 'alice', email: 'alice@example.com' },
  { username: 'bob', email: 'bob@example.com' },
  { username: 'carol', email: 'carol@example.com' },
];

const PRODUCTS = [
  ['Mechanical Keyboard', 'Hot-swappable 75% keyboard with tactile brown switches and PBT keycaps.', 8999, 'electronics', 42],
  ['Wireless Mouse', 'Lightweight 58g wireless mouse with a 26K optical sensor.', 4599, 'electronics', 60],
  ['27" 4K Monitor', '27-inch IPS display, 144Hz, 99% sRGB, USB-C power delivery.', 32999, 'electronics', 12],
  ['Noise Cancelling Headphones', 'Over-ear ANC headphones with 40-hour battery life.', 19999, 'electronics', 25],
  ['USB-C Hub', '7-in-1 hub: HDMI, 2x USB-A, SD, microSD, 100W passthrough.', 3499, 'electronics', 80],
  ['Laptop Stand', 'Aluminium stand with adjustable height and cable routing.', 2999, 'accessories', 55],
  ['Desk Mat', 'Large stitched-edge felt desk mat, 90x40cm.', 1999, 'accessories', 100],
  ['Webcam 1080p', 'Full HD webcam with autofocus and a dual noise-cancelling mic.', 5499, 'accessories', 33],
  ['Clean Code', 'Robert C. Martin on writing software that other people can read.', 2799, 'books', 48],
  ['Eloquent JavaScript', 'A modern introduction to programming with JavaScript.', 2299, 'books', 52],
  ['Designing Data-Intensive Applications', 'The reliability, scalability and maintainability of data systems.', 3899, 'books', 30],
  ['Refactoring UI', 'Practical visual design tactics for developers.', 3299, 'books', 18],
  ['Cold Brew Coffee Beans', 'Dark roast beans ground coarse for overnight cold brew. 1kg.', 1699, 'home', 75],
  ['Ceramic Mug 400ml', 'Matte-glazed stoneware mug, microwave and dishwasher safe.', 1299, 'home', 120],
  ['Desk Lamp', 'LED desk lamp with five brightness levels and a USB charging port.', 4199, 'home', 40],
  ['Mini Succulent Set', 'Three potted succulents that survive a developer schedule.', 2499, 'home', 64],
];

function run() {
  const passwordHash = bcrypt.hashSync(PASSWORD, 10);

  // Wrapped in a transaction: either the whole demo dataset lands or none of
  // it does, so a failure halfway through cannot leave a half-seeded database.
  const seedAll = db.transaction(() => {
    // Children first is only for readability; ON DELETE CASCADE handles it.
    for (const table of ['order_items', 'orders', 'cart_items', 'products', 'users']) {
      db.prepare(`DELETE FROM ${table}`).run();
    }
    // Restart AUTOINCREMENT so seeded ids are stable between runs.
    db.prepare("DELETE FROM sqlite_sequence WHERE name NOT IN ('')").run();

    // --- users -------------------------------------------------------
    const insertUser = db.prepare(
      'INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)'
    );
    const id = {}; // username -> id
    for (const user of USERS) {
      id[user.username] = Number(insertUser.run(user.username, user.email, passwordHash).lastInsertRowid);
    }

    // --- products ----------------------------------------------------
    const insertProduct = db.prepare(
      `INSERT INTO products (name, description, price_cents, category, stock, image_url)
       VALUES (?, ?, ?, ?, ?, '')`
    );
    for (const [name, description, price, category, stock] of PRODUCTS) {
      insertProduct.run(name, description, price, category, stock);
    }

    // Put two items in demo's cart so the cart page is not empty on first look.
    const insertCart = db.prepare(
      'INSERT INTO cart_items (user_id, product_id, quantity) VALUES (?, ?, ?)'
    );
    insertCart.run(id.demo, 1, 1);
    insertCart.run(id.demo, 9, 2);

    // One past order, so the order history page has a row with a status.
    const orderInfo = db
      .prepare(
        `INSERT INTO orders (user_id, total_cents, status, shipping_name, address)
         VALUES (?, ?, 'shipped', 'Demo User', '12 Example Street, Gwalior, MP 474011')`
      )
      .run(id.demo, 4599 + 2299);
    const insertOrderItem = db.prepare(
      `INSERT INTO order_items (order_id, product_id, product_name, unit_price_cents, quantity)
       VALUES (?, ?, ?, ?, ?)`
    );
    const orderId = Number(orderInfo.lastInsertRowid);
    insertOrderItem.run(orderId, 2, 'Wireless Mouse', 4599, 1);
    insertOrderItem.run(orderId, 10, 'Eloquent JavaScript', 2299, 1);

    return id;
  });

  seedAll();

  console.log('\n  Seed complete.');
  console.log(`  Database : ${DB_PATH}`);
  console.log(`  Users    : ${USERS.map((u) => u.username).join(', ')}`);
  console.log(`  Password : ${PASSWORD}  (same for every demo user)`);
  console.log(`  Products : ${PRODUCTS.length}`);
  console.log('  Cart     : 2 items for demo');
  console.log('  Orders   : 1 past order for demo (status: shipped)');
  console.log(`  Log in as "demo" / "${PASSWORD}" to start.\n`);
}

run();
