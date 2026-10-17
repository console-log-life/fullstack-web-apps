/**
 * Demo data seeder - `npm run seed`.
 *
 * Gives every module something to show on first run: demo users, a product
 * catalogue, social posts with likes/comments/follows, a project with a
 * populated Kanban board, and a meeting room.
 *
 * Re-running it is safe: it clears the demo tables first and re-inserts, so
 * you always get the same predictable starting state for a demo video.
 */
require('dotenv').config();

const bcrypt = require('bcryptjs');
const { db, migrate, DB_PATH } = require('./index');

migrate();

const PASSWORD = 'password123';

const USERS = [
  { username: 'demo', email: 'demo@example.com', bio: 'Full stack intern at CodeAlpha. Building four apps in one repo.' },
  { username: 'alice', email: 'alice@example.com', bio: 'Frontend developer. CSS is a love language.' },
  { username: 'bob', email: 'bob@example.com', bio: 'Backend developer. I speak SQL in my sleep.' },
  { username: 'carol', email: 'carol@example.com', bio: 'Designer turned developer. Pixels and prototypes.' },
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

const POSTS = [
  ['demo', 'Shipped the shared auth layer today: bcrypt hashing, JWT in an httpOnly cookie, and one middleware guarding all four apps. One login, four products.'],
  ['alice', 'Spent the morning on the responsive navbar. Mobile breakpoints are 80% of frontend work and nobody warns you.'],
  ['bob', 'Reminder that every query in this project is parameterized. String-concatenated SQL is how you end up in a post-mortem.'],
  ['carol', 'Picked a single set of design tokens for all four apps. Consistency reads as polish even when the apps do very different things.'],
  ['demo', 'The Kanban board now syncs over Socket.io. Drag a card in one tab and it moves in the other instantly. Very satisfying to demo.'],
  ['alice', 'TIL native HTML5 drag and drop needs dataTransfer.setData in dragstart or the drop event never fires. Two hours of my life.'],
  ['bob', 'Storing prices in cents as integers instead of floats. 0.1 + 0.2 should never come near a checkout total.'],
  ['demo', 'Chat and file sharing in the meeting room are end-to-end encrypted with AES-GCM. The server stores ciphertext and never sees the passphrase.'],
  ['carol', 'Empty states matter. "No posts yet" with a nudge beats a blank page every single time.'],
  ['bob', 'WebRTC in a mesh means every participant holds a connection to every other one. Fine for small rooms, rough past five or six people.'],
];

const TASKS = [
  ['Set up Express server and SQLite schema', 'Boot the server, run migrations on startup, add the health endpoint.', 'done', 'demo', -8],
  ['Shared auth: register, login, logout, me', 'bcrypt hashing plus JWT in an httpOnly cookie, with middleware protecting private routes.', 'done', 'demo', -6],
  ['Product listing with search and filters', 'Grid layout, text search, category dropdown, stock badges.', 'done', 'alice', -4],
  ['Cart and checkout flow', 'Persist the cart per user, create orders, reduce stock inside a transaction.', 'in_progress', 'bob', 2],
  ['Social feed and follow system', 'Home feed from followed users, explore page, likes and comments.', 'in_progress', 'alice', 3],
  ['Kanban drag and drop', 'Native HTML5 drag and drop that rewrites card positions on the server.', 'in_progress', 'carol', 4],
  ['WebRTC mesh signalling', 'Offer/answer/ICE relay over a Socket.io namespace with Google STUN.', 'todo', 'bob', 6],
  ['End-to-end encrypted chat', 'PBKDF2 key from the room passphrase, AES-GCM per message.', 'todo', 'demo', 7],
  ['Collaborative whiteboard', 'Canvas strokes broadcast over Socket.io, with pen, colours, eraser and clear.', 'todo', 'carol', 9],
  ['Write the README and record the demo', 'Setup steps, feature checklist per task, screenshots, demo script.', 'todo', 'demo', 11],
];

/** Returns a YYYY-MM-DD date `offset` days from today. */
function dateOffset(offset) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
}

function run() {
  const passwordHash = bcrypt.hashSync(PASSWORD, 10);

  // Wrapped in a transaction: either the whole demo dataset lands or none of
  // it does, so a failure halfway through cannot leave a half-seeded database.
  const seedAll = db.transaction(() => {
    // --- reset -------------------------------------------------------
    // Order matters only for readability; ON DELETE CASCADE handles children.
    for (const table of [
      'room_messages', 'room_files', 'rooms',
      'notifications', 'task_comments', 'tasks', 'project_members', 'projects',
      'follows', 'likes', 'comments', 'posts', 'profiles',
      'order_items', 'orders', 'cart_items', 'products',
      'users',
    ]) {
      db.prepare(`DELETE FROM ${table}`).run();
    }
    // Restart AUTOINCREMENT so seeded ids are stable between runs.
    db.prepare("DELETE FROM sqlite_sequence WHERE name NOT IN ('')").run();

    // --- users + profiles -------------------------------------------
    const insertUser = db.prepare(
      'INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)'
    );
    const insertProfile = db.prepare(
      'INSERT INTO profiles (user_id, display_name, bio) VALUES (?, ?, ?)'
    );

    const id = {}; // username -> id
    for (const user of USERS) {
      const info = insertUser.run(user.username, user.email, passwordHash);
      id[user.username] = Number(info.lastInsertRowid);
      const displayName = user.username.charAt(0).toUpperCase() + user.username.slice(1);
      insertProfile.run(id[user.username], displayName, user.bio);
    }

    // --- Task 1: products -------------------------------------------
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
    const orderTotal = 8999 + 2 * 2799;
    const orderInfo = db
      .prepare(
        `INSERT INTO orders (user_id, total_cents, status, shipping_name, address)
         VALUES (?, ?, 'shipped', 'Demo User', '12 Example Street, Gwalior, MP 474011')`
      )
      .run(id.demo, orderTotal);
    const insertOrderItem = db.prepare(
      `INSERT INTO order_items (order_id, product_id, product_name, unit_price_cents, quantity)
       VALUES (?, ?, ?, ?, ?)`
    );
    insertOrderItem.run(Number(orderInfo.lastInsertRowid), 2, 'Wireless Mouse', 4599, 1);
    insertOrderItem.run(Number(orderInfo.lastInsertRowid), 10, 'Eloquent JavaScript', 2299, 1);
    db.prepare('UPDATE orders SET total_cents = ? WHERE id = ?')
      .run(4599 + 2299, Number(orderInfo.lastInsertRowid));

    // --- Task 2: posts, comments, likes, follows --------------------
    const insertPost = db.prepare('INSERT INTO posts (user_id, content) VALUES (?, ?)');
    const postIds = [];
    for (const [author, content] of POSTS) {
      postIds.push(Number(insertPost.run(id[author], content).lastInsertRowid));
    }

    const insertComment = db.prepare(
      'INSERT INTO comments (post_id, user_id, content) VALUES (?, ?, ?)'
    );
    insertComment.run(postIds[0], id.alice, 'httpOnly is the right call here. localStorage tokens are an XSS away from disaster.');
    insertComment.run(postIds[0], id.bob, 'Did you add rate limiting on the login route?');
    insertComment.run(postIds[1], id.carol, 'Mobile-first saves so much rework. Start narrow, widen later.');
    insertComment.run(postIds[4], id.alice, 'Open two tabs side by side for the video, it demos really well.');
    insertComment.run(postIds[7], id.bob, 'So the server genuinely cannot read the chat? That is a strong feature.');

    const insertLike = db.prepare('INSERT INTO likes (post_id, user_id) VALUES (?, ?)');
    const likePairs = [
      [0, 'alice'], [0, 'bob'], [0, 'carol'],
      [1, 'demo'], [1, 'carol'],
      [2, 'demo'], [2, 'alice'],
      [3, 'demo'], [3, 'bob'],
      [4, 'alice'], [4, 'bob'], [4, 'carol'],
      [5, 'demo'],
      [6, 'demo'], [6, 'carol'],
      [7, 'alice'], [7, 'bob'], [7, 'carol'],
      [8, 'demo'], [8, 'alice'],
      [9, 'demo'],
    ];
    for (const [postIndex, username] of likePairs) {
      insertLike.run(postIds[postIndex], id[username]);
    }

    // demo follows everyone, and everyone follows demo back, so both the home
    // feed and the follower counts have data.
    const insertFollow = db.prepare(
      'INSERT INTO follows (follower_id, following_id) VALUES (?, ?)'
    );
    for (const username of ['alice', 'bob', 'carol']) {
      insertFollow.run(id.demo, id[username]);
      insertFollow.run(id[username], id.demo);
    }
    insertFollow.run(id.alice, id.carol);
    insertFollow.run(id.bob, id.alice);

    // --- Task 3: project, members, board, comments ------------------
    const projectInfo = db
      .prepare('INSERT INTO projects (name, description, owner_id) VALUES (?, ?, ?)')
      .run(
        'CodeAlpha Internship Submission',
        'Ship all four full stack tasks in one repository: store, social app, project board and meeting room.',
        id.demo
      );
    const projectId = Number(projectInfo.lastInsertRowid);

    const insertMember = db.prepare(
      'INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, ?)'
    );
    insertMember.run(projectId, id.demo, 'owner');
    for (const username of ['alice', 'bob', 'carol']) {
      insertMember.run(projectId, id[username], 'member');
    }

    const insertTask = db.prepare(
      `INSERT INTO tasks (project_id, title, description, status, assignee_id, due_date, position, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const positions = { todo: 0, in_progress: 0, done: 0 };
    const taskIds = [];
    for (const [title, description, status, assignee, dueOffset] of TASKS) {
      const info = insertTask.run(
        projectId, title, description, status,
        id[assignee], dateOffset(dueOffset),
        positions[status]++, id.demo
      );
      taskIds.push(Number(info.lastInsertRowid));
    }

    const insertTaskComment = db.prepare(
      'INSERT INTO task_comments (task_id, user_id, content) VALUES (?, ?, ?)'
    );
    insertTaskComment.run(taskIds[3], id.demo, 'Reduce stock in the same transaction as the order insert, otherwise two buyers can oversell the last unit.');
    insertTaskComment.run(taskIds[3], id.bob, 'Agreed. better-sqlite3 transactions are synchronous so this is straightforward.');
    insertTaskComment.run(taskIds[5], id.alice, 'Remember preventDefault on dragover or the browser refuses the drop.');
    insertTaskComment.run(taskIds[6], id.bob, 'Two STUN servers configured as a fallback in case one is unreachable.');

    // A couple of unread notifications so the bell shows a badge immediately.
    const insertNotification = db.prepare(
      `INSERT INTO notifications (user_id, project_id, task_id, type, message, is_read)
       VALUES (?, ?, ?, ?, ?, 0)`
    );
    insertNotification.run(
      id.demo, projectId, taskIds[3], 'comment_added',
      'bob commented on "Cart and checkout flow"'
    );
    insertNotification.run(
      id.demo, projectId, taskIds[7], 'task_assigned',
      'alice assigned you "End-to-end encrypted chat"'
    );

    // --- Task 4: a meeting room -------------------------------------
    db.prepare('INSERT INTO rooms (code, name, owner_id) VALUES (?, ?, ?)')
      .run('DEMO01', 'CodeAlpha Demo Room', id.demo);

    return id;
  });

  const ids = seedAll();

  console.log('\n  Seed complete.');
  console.log(`  Database : ${DB_PATH}`);
  console.log(`  Users    : ${USERS.map((u) => u.username).join(', ')}`);
  console.log(`  Password : ${PASSWORD}  (same for every demo user)`);
  console.log(`  Products : ${PRODUCTS.length}`);
  console.log(`  Posts    : ${POSTS.length}`);
  console.log(`  Board    : 1 project, ${TASKS.length} tasks, 4 members`);
  console.log(`  Room code: DEMO01   (passphrase for the demo: codealpha)`);
  console.log(`  Log in as "demo" / "${PASSWORD}" and open any module.\n`);
  return ids;
}

run();
