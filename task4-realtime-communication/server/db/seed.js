/**
 * Project 4 (Meet) - demo data seeder (`npm run seed`).
 *
 * Loads the four demo users and one meeting room, code DEMO01.
 *
 * No chat messages or files are seeded on purpose: they are encrypted in the
 * browser with a key derived from the room passphrase, and the seeder has no
 * passphrase, so any row it wrote would be undecryptable noise.
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

function run() {
  const passwordHash = bcrypt.hashSync(PASSWORD, 10);

  // Wrapped in a transaction: either the whole demo dataset lands or none of
  // it does, so a failure halfway through cannot leave a half-seeded database.
  const seedAll = db.transaction(() => {
    // Children first is only for readability; ON DELETE CASCADE handles it.
    for (const table of ['room_messages', 'room_files', 'rooms', 'users']) {
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

    // --- meeting room ------------------------------------------------
    db.prepare('INSERT INTO rooms (code, name, owner_id) VALUES (?, ?, ?)')
      .run('DEMO01', 'Demo Room', id.demo);

    return id;
  });

  seedAll();

  console.log('\n  Seed complete.');
  console.log(`  Database : ${DB_PATH}`);
  console.log(`  Users    : ${USERS.map((u) => u.username).join(', ')}`);
  console.log(`  Password : ${PASSWORD}  (same for every demo user)`);
  console.log('  Room     : DEMO01  "Demo Room" (owner: demo)');
  console.log('  Passphrase for the demo room: codealpha');
  console.log(`  Log in as "demo" / "${PASSWORD}" to start.\n`);
}

run();
