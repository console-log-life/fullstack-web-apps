-- =====================================================================
-- CodeAlpha Task 2: Social Media Platform
--
-- This task's own schema. It holds `users` (the shared account table every
-- CodeAlpha task needs) plus only the tables this task uses, so the folder
-- runs standalone.
--
-- Timestamps use strftime('%Y-%m-%d %H:%M:%f') rather than datetime(), which
-- only resolves to whole seconds. Milliseconds keep ordering stable for rows
-- created in the same second, and let an edit be told apart from the original
-- write (the UI uses that to show an "edited" marker).
-- =====================================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------
-- SHARED: one account per person
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL UNIQUE,
  email         TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,          -- bcrypt hash, never the raw password
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f','now'))
);

-- ---------------------------------------------------------------------
-- TASK 2 TABLES
-- ---------------------------------------------------------------------
-- Social-only extras for an account; one row per user.
CREATE TABLE IF NOT EXISTS profiles (
  user_id      INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL DEFAULT '',
  bio          TEXT NOT NULL DEFAULT '',
  avatar_url   TEXT NOT NULL DEFAULT '',
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f','now'))
);

CREATE TABLE IF NOT EXISTS posts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content    TEXT    NOT NULL,
  image_url  TEXT    NOT NULL DEFAULT '',
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f','now')),
  updated_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f','now'))
);
CREATE INDEX IF NOT EXISTS idx_posts_user ON posts(user_id);
CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at DESC);

CREATE TABLE IF NOT EXISTS comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content    TEXT    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f','now'))
);
CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id);

-- The UNIQUE pair makes liking idempotent: one user can like a post once.
CREATE TABLE IF NOT EXISTS likes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f','now')),
  UNIQUE (post_id, user_id)
);

-- follower_id follows following_id. The CHECK blocks self-follows.
CREATE TABLE IF NOT EXISTS follows (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  follower_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  following_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f','now')),
  UNIQUE (follower_id, following_id),
  CHECK (follower_id <> following_id)
);

-- ---------------------------------------------------------------------
--
