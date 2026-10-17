/**
 * SQLite connection + migration runner.
 *
 * better-sqlite3 is synchronous, which keeps route handlers simple: a query
 * returns rows directly instead of a promise. The whole app shares this one
 * connection object.
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const ROOT = path.join(__dirname, '..', '..');
const DB_PATH = path.resolve(ROOT, process.env.DB_PATH || 'server/db/data/app.db');

// The data folder is gitignored, so create it on first run.
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

// WAL gives better concurrency for reads while a write is in flight.
db.pragma('journal_mode = WAL');
// Foreign keys are OFF by default in SQLite; our ON DELETE CASCADE rules need them.
db.pragma('foreign_keys = ON');

/**
 * Applies schema.sql. Every statement is CREATE ... IF NOT EXISTS, so running
 * this on each boot is the migration step: new tables and indexes appear and
 * existing data is untouched. `user_version` records which schema generation
 * the file is on.
 *
 * Note the limit of that approach: IF NOT EXISTS cannot change the columns of
 * a table that already exists. Altering an existing column means deleting
 * server/db/data/app.db and re-running `npm run seed`, which is cheap here
 * because the database is a single gitignored file rebuilt from the seed.
 */
function migrate() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);

  const SCHEMA_VERSION = 2;
  const current = db.pragma('user_version', { simple: true });
  if (current < SCHEMA_VERSION) {
    db.pragma(`user_version = ${SCHEMA_VERSION}`);
  }
  return { path: DB_PATH, version: SCHEMA_VERSION };
}

module.exports = { db, migrate, DB_PATH };
