/**
 * CodeAlpha Task 2 - demo data seeder (`npm run seed`).
 *
 * Loads the four demo users with profiles and bios, ten posts, plus
 * comments, likes and a follow graph so the feed and explore pages have data.
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

const BIOS = {
  demo: 'Full stack intern at CodeAlpha. Building four apps in one submission.',
  alice: 'Frontend developer. CSS is a love language.',
  bob: 'Backend developer. I speak SQL in my sleep.',
  carol: 'Designer turned developer. Pixels and prototypes.',
};

const POSTS = [
  ['demo', 'Shipped the shared auth layer today: bcrypt hashing, JWT in an httpOnly cookie, and one middleware guarding every private route.'],
  ['alice', 'Spent the morning on the responsive navbar. Mobile breakpoints are 80% of frontend work and nobody warns you.'],
  ['bob', 'Reminder that every query in this project is parameterized. String-concatenated SQL is how you end up in a post-mortem.'],
  ['carol', 'Picked a single set of design tokens for the whole submission. Consistency reads as polish even when the apps do very different things.'],
  ['demo', 'The feed now shows posts from people you follow plus your own, ordered newest first. Small query, big difference.'],
  ['alice', 'TIL that rendering user text with textContent instead of innerHTML is the whole XSS defence on the client side.'],
  ['bob', 'Likes and follows are single toggle endpoints. One request either creates or removes the row, so a double click cannot desync the UI.'],
  ['demo', 'Avatar uploads go through multer with a MIME check and a random stored filename, so the original name never touches the filesystem path.'],
  ['carol', 'Empty states matter. "No posts yet" with a nudge beats a blank page every single time.'],
  ['bob', 'Storing timestamps with milliseconds, because datetime() only resolves to whole seconds and an edit in the same second looked unedited.'],
];

function run() {
  const passwordHash = bcrypt.hashSync(PASSWORD, 10);

  // Wrapped in a transaction: either the whole demo dataset lands or none of
  // it does, so a failure halfway through cannot leave a half-seeded database.
  const seedAll = db.transaction(() => {
    // Children first is only for readability; ON DELETE CASCADE handles it.
    for (const table of ['follows', 'likes', 'comments', 'posts', 'profiles', 'users']) {
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

    // --- profiles ----------------------------------------------------
    const insertProfile = db.prepare(
      'INSERT INTO profiles (user_id, display_name, bio) VALUES (?, ?, ?)'
    );
    for (const user of USERS) {
      const displayName = user.username.charAt(0).toUpperCase() + user.username.slice(1);
      insertProfile.run(id[user.username], displayName, BIOS[user.username] || '');
    }

    // --- posts -------------------------------------------------------
    const insertPost = db.prepare('INSERT INTO posts (user_id, content) VALUES (?, ?)');
    const postIds = [];
    for (const [author, content] of POSTS) {
      postIds.push(Number(insertPost.run(id[author], content).lastInsertRowid));
    }

    // --- comments ----------------------------------------------------
    const insertComment = db.prepare(
      'INSERT INTO comments (post_id, user_id, content) VALUES (?, ?, ?)'
    );
    insertComment.run(postIds[0], id.alice, 'httpOnly is the right call here. localStorage tokens are an XSS away from disaster.');
    insertComment.run(postIds[0], id.bob, 'Did you add rate limiting on the login route?');
    insertComment.run(postIds[1], id.carol, 'Mobile-first saves so much rework. Start narrow, widen later.');
    insertComment.run(postIds[4], id.alice, 'Does it fall back to explore when you follow nobody yet?');
    insertComment.run(postIds[7], id.bob, 'Random stored filenames are exactly how you avoid path traversal.');

    // --- likes -------------------------------------------------------
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

    // demo follows everyone and everyone follows demo back, so both the home
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

    return id;
  });

  seedAll();

  console.log('\n  Seed complete.');
  console.log(`  Database : ${DB_PATH}`);
  console.log(`  Users    : ${USERS.map((u) => u.username).join(', ')}`);
  console.log(`  Password : ${PASSWORD}  (same for every demo user)`);
  console.log(`  Posts    : ${POSTS.length}`);
  console.log('  Social   : 5 comments, 21 likes, 8 follow edges');
  console.log(`  Log in as "demo" / "${PASSWORD}" to start.\n`);
}

run();
