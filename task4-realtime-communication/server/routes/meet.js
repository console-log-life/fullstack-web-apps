/**
 * TASK 4 - Real-time communication app API.
 *
 *   GET    /api/meet/rooms                 rooms I created
 *   POST   /api/meet/rooms                 create a room (returns its code)
 *   GET    /api/meet/rooms/:code           room info by join code
 *   DELETE /api/meet/rooms/:code           delete a room I own
 *   GET    /api/meet/rooms/:code/messages  encrypted chat history
 *   GET    /api/meet/rooms/:code/files     list the shared files
 *   POST   /api/meet/rooms/:code/files     upload an encrypted file
 *   GET    /api/meet/files/:id             download the ciphertext
 *   DELETE /api/meet/files/:id             delete a file I uploaded
 *
 * Everything here needs a login. Note what the server deliberately does NOT
 * know: chat messages and file contents arrive already encrypted by the
 * browser with a key derived from the room passphrase, which is never sent.
 * These routes therefore only ever move opaque ciphertext plus the IV needed
 * to decrypt it. See the README section "End-to-end encryption".
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');

const { db } = require('../db');
const asyncHandler = require('../utils/asyncHandler');
const { authRequired } = require('../middleware/auth');
const { uploadRoomFile, UPLOAD_ROOT } = require('../middleware/upload');
const {
  ApiError,
  requireString,
  requireInt,
} = require('../utils/validate');

const router = express.Router();

const ROOM_DIR = path.join(UPLOAD_ROOT, 'rooms');

/** Room codes are short, uppercase and unambiguous (no O/0 or I/1 mix-ups). */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateCode(length = 6) {
  // crypto.randomInt, not Math.random: a guessable room code would let anyone
  // walk into a meeting.
  let code = '';
  for (let i = 0; i < length; i++) {
    code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

function normaliseCode(raw) {
  const code = requireString(raw, 'Room code', { min: 4, max: 12 }).toUpperCase();
  if (!/^[A-Z0-9]+$/.test(code)) {
    throw new ApiError(400, 'A room code is letters and numbers only.');
  }
  return code;
}

function findRoom(code) {
  const room = db
    .prepare(
      `SELECT r.*, u.username AS owner_username
         FROM rooms r JOIN users u ON u.id = r.owner_id
        WHERE r.code = ?`
    )
    .get(code);
  if (!room) throw new ApiError(404, `No meeting room with the code ${code}.`);
  return room;
}

/* --------------------------------------------------------------------
   Rooms
   ------------------------------------------------------------------ */

// GET /api/meet/rooms - rooms I own, for the "my rooms" list.
router.get(
  '/rooms',
  authRequired,
  asyncHandler(async (req, res) => {
    const rooms = db
      .prepare(
        `SELECT r.*,
                (SELECT COUNT(*) FROM room_messages m WHERE m.room_id = r.id) AS message_count,
                (SELECT COUNT(*) FROM room_files f WHERE f.room_id = r.id)    AS file_count
           FROM rooms r
          WHERE r.owner_id = ?
          ORDER BY r.created_at DESC, r.id DESC`
      )
      .all(req.user.id);
    res.json({ rooms });
  })
);

// POST /api/meet/rooms  { name }
router.post(
  '/rooms',
  authRequired,
  asyncHandler(async (req, res) => {
    const name = requireString(req.body.name, 'Room name', { min: 2, max: 80 });

    // Retry on the (very unlikely) chance of a code collision.
    let code = null;
    for (let attempt = 0; attempt < 8 && !code; attempt++) {
      const candidate = generateCode();
      const taken = db.prepare('SELECT 1 FROM rooms WHERE code = ?').get(candidate);
      if (!taken) code = candidate;
    }
    if (!code) throw new ApiError(500, 'Could not allocate a room code. Please try again.');

    const info = db
      .prepare('INSERT INTO rooms (code, name, owner_id) VALUES (?, ?, ?)')
      .run(code, name, req.user.id);

    res.status(201).json({
      room: db.prepare('SELECT * FROM rooms WHERE id = ?').get(Number(info.lastInsertRowid)),
      message: `Room created. Share the code ${code} to invite people.`,
    });
  })
);

// GET /api/meet/rooms/:code
router.get(
  '/rooms/:code',
  authRequired,
  asyncHandler(async (req, res) => {
    const room = findRoom(normaliseCode(req.params.code));
    res.json({ room, is_owner: room.owner_id === req.user.id });
  })
);

// DELETE /api/meet/rooms/:code
router.delete(
  '/rooms/:code',
  authRequired,
  asyncHandler(async (req, res) => {
    const room = findRoom(normaliseCode(req.params.code));
    if (room.owner_id !== req.user.id) {
      throw new ApiError(403, 'Only the person who created the room can delete it.');
    }

    // Remove the ciphertext blobs from disk before the rows cascade away.
    const files = db.prepare('SELECT stored_name FROM room_files WHERE room_id = ?').all(room.id);
    for (const file of files) {
      fs.promises.unlink(path.join(ROOM_DIR, file.stored_name)).catch(() => {});
    }

    db.prepare('DELETE FROM rooms WHERE id = ?').run(room.id);
    res.json({ message: `Room ${room.code} deleted.` });
  })
);

/* --------------------------------------------------------------------
   Chat history (ciphertext only)
   ------------------------------------------------------------------ */

// GET /api/meet/rooms/:code/messages
// Returns what the server has: base64 ciphertext and its IV. Without the room
// passphrase these rows are meaningless, which is the point.
router.get(
  '/rooms/:code/messages',
  authRequired,
  asyncHandler(async (req, res) => {
    const room = findRoom(normaliseCode(req.params.code));
    const messages = db
      .prepare(
        `SELECT m.id, m.ciphertext, m.iv, m.created_at, m.user_id, u.username
           FROM room_messages m
           JOIN users u ON u.id = m.user_id
          WHERE m.room_id = ?
          ORDER BY m.id ASC
          LIMIT 300`
      )
      .all(room.id);
    res.json({ messages });
  })
);

/* --------------------------------------------------------------------
   Encrypted file sharing
   ------------------------------------------------------------------ */

// GET /api/meet/rooms/:code/files
router.get(
  '/rooms/:code/files',
  authRequired,
  asyncHandler(async (req, res) => {
    const room = findRoom(normaliseCode(req.params.code));
    const files = db
      .prepare(
        `SELECT f.id, f.original_name, f.size_bytes, f.iv, f.name_iv, f.created_at,
                f.user_id, u.username
           FROM room_files f
           JOIN users u ON u.id = f.user_id
          WHERE f.room_id = ?
          ORDER BY f.id DESC`
      )
      .all(room.id);
    res.json({ files });
  })
);

/**
 * POST /api/meet/rooms/:code/files
 *
 * The browser encrypts the bytes AND the filename before uploading, then
 * sends the two IVs alongside. `original_name` is therefore base64 ciphertext,
 * not a readable name - the server cannot tell you what the file is called.
 */
router.post(
  '/rooms/:code/files',
  authRequired,
  uploadRoomFile.single('file'),
  asyncHandler(async (req, res) => {
    const room = findRoom(normaliseCode(req.params.code));
    if (!req.file) throw new ApiError(400, 'No file was uploaded.');

    // Clean up the stored blob if validation of the metadata fails.
    const cleanup = () =>
      fs.promises.unlink(path.join(ROOM_DIR, req.file.filename)).catch(() => {});

    let encryptedName;
    let iv;
    let nameIv;
    try {
      encryptedName = requireString(req.body.encrypted_name, 'Encrypted file name', { max: 2000 });
      iv = requireString(req.body.iv, 'File IV', { min: 8, max: 64 });
      nameIv = requireString(req.body.name_iv, 'Name IV', { min: 8, max: 64 });
    } catch (err) {
      await cleanup();
      throw err;
    }

    const info = db
      .prepare(
        `INSERT INTO room_files (room_id, user_id, original_name, stored_name, size_bytes, iv, name_iv)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(room.id, req.user.id, encryptedName, req.file.filename, req.file.size, iv, nameIv);

    const file = db
      .prepare(
        `SELECT f.id, f.original_name, f.size_bytes, f.iv, f.name_iv, f.created_at,
                f.user_id, u.username
           FROM room_files f JOIN users u ON u.id = f.user_id
          WHERE f.id = ?`
      )
      .get(Number(info.lastInsertRowid));

    res.status(201).json({ file, message: 'Encrypted file shared.' });
  })
);

// GET /api/meet/files/:id - serves the raw ciphertext for the client to decrypt.
router.get(
  '/files/:id',
  authRequired,
  asyncHandler(async (req, res) => {
    const id = requireInt(req.params.id, 'File id', { min: 1 });
    const file = db.prepare('SELECT * FROM room_files WHERE id = ?').get(id);
    if (!file) throw new ApiError(404, 'That file is no longer available.');

    // stored_name was generated by the server, but confirm the resolved path
    // stays inside the rooms folder before reading it.
    const target = path.resolve(ROOM_DIR, file.stored_name);
    if (!target.startsWith(path.resolve(ROOM_DIR)) || !fs.existsSync(target)) {
      throw new ApiError(404, 'That file is no longer available.');
    }

    // Always octet-stream: the real type is only known once decrypted, and
    // serving attacker-chosen types from our origin would be a sniffing risk.
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.sendFile(target);
  })
);

// DELETE /api/meet/files/:id - the uploader, or the room owner.
router.delete(
  '/files/:id',
  authRequired,
  asyncHandler(async (req, res) => {
    const id = requireInt(req.params.id, 'File id', { min: 1 });
    const file = db
      .prepare(
        `SELECT f.*, r.owner_id AS room_owner, r.code
           FROM room_files f JOIN rooms r ON r.id = f.room_id
          WHERE f.id = ?`
      )
      .get(id);
    if (!file) throw new ApiError(404, 'That file is no longer available.');

    if (file.user_id !== req.user.id && file.room_owner !== req.user.id) {
      throw new ApiError(403, 'You can only delete files you shared.');
    }

    db.prepare('DELETE FROM room_files WHERE id = ?').run(id);
    fs.promises.unlink(path.join(ROOM_DIR, file.stored_name)).catch(() => {});

    res.json({ message: 'File removed.' });
  })
);

module.exports = router;
module.exports.findRoom = findRoom;
module.exports.normaliseCode = normaliseCode;
