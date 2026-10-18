-- =====================================================================
-- Project 4: Real-Time Communication App
--
-- This app's own schema. It holds `users` (the shared account table every
-- app here needs) plus only the tables this app uses, so the folder runs
-- standalone.
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
-- TASK 4 TABLES
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rooms (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  code       TEXT    NOT NULL UNIQUE,   -- short code people type in to join
  name       TEXT    NOT NULL,
  owner_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f','now'))
);

-- Shared files. Only ciphertext is stored, so the IVs needed to decrypt are kept
-- alongside: the server never learns the room passphrase or the AES key.
CREATE TABLE IF NOT EXISTS room_files (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id       INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  original_name TEXT    NOT NULL,   -- encrypted file name (base64 ciphertext)
  stored_name   TEXT    NOT NULL,   -- random name of the ciphertext blob on disk
  size_bytes    INTEGER NOT NULL DEFAULT 0,
  iv            TEXT    NOT NULL DEFAULT '',  -- base64 AES-GCM IV for the bytes
  name_iv       TEXT    NOT NULL DEFAULT '',  -- base64 AES-GCM IV for the name
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f','now'))
);
CREATE INDEX IF NOT EXISTS idx_room_files_room ON room_files(room_id);

-- Chat history, also ciphertext-only (see README "End-to-end encryption").
CREATE TABLE IF NOT EXISTS room_messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id    INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ciphertext TEXT    NOT NULL,
  iv         TEXT    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f','now'))
);
CREATE INDEX IF NOT EXISTS idx_room_messages_room ON room_messages(room_id, id);
