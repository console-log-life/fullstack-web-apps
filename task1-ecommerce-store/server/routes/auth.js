/**
 * Shared auth routes: register, login, logout, me.
 * These four endpoints back the login screen of all four apps.
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');

const { db } = require('../db');
const asyncHandler = require('../utils/asyncHandler');
const { issueToken, clearToken, authRequired } = require('../middleware/auth');
const {
  ApiError,
  requireUsername,
  requireEmail,
  requirePassword,
  requireString,
} = require('../utils/validate');

const router = express.Router();

// Rate limit the credential endpoints so passwords cannot be brute-forced.
// Defaults to 20 attempts per IP per 15 minutes; both numbers are
// configurable so a test run or a shared-IP deployment can tune them without
// editing code.
const authLimiter = rateLimit({
  windowMs: (Number(process.env.AUTH_RATE_LIMIT_WINDOW_MIN) || 15) * 60 * 1000,
  max: Number(process.env.AUTH_RATE_LIMIT_MAX) || 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please wait a few minutes and try again.' },
});

const BCRYPT_ROUNDS = 10;

/** Shape of the user object sent to the browser (never includes the hash). */
function publicUser(user) {
  return { id: user.id, username: user.username, email: user.email };
}

// POST /api/auth/register - create an account and log straight in.
router.post(
  '/register',
  authLimiter,
  asyncHandler(async (req, res) => {
    const username = requireUsername(req.body.username);
    const email = requireEmail(req.body.email);
    const password = requirePassword(req.body.password);

    // Check both fields up front to give a specific message rather than a
    // generic UNIQUE constraint error.
    const clash = db
      .prepare('SELECT username, email FROM users WHERE username = ? OR email = ?')
      .get(username, email);
    if (clash) {
      throw new ApiError(
        409,
        clash.username === username
          ? 'That username is already taken.'
          : 'An account with that email already exists.'
      );
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const info = db
      .prepare('INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)')
      .run(username, email, passwordHash);

    const user = { id: Number(info.lastInsertRowid), username, email };

    issueToken(res, user);
    res.status(201).json({ user: publicUser(user) });
  })
);

// POST /api/auth/login
router.post(
  '/login',
  authLimiter,
  asyncHandler(async (req, res) => {
    // Accept either a username or an email in one field, like most apps do.
    const identifier = requireString(req.body.identifier ?? req.body.username, 'Username or email', { max: 160 })
      .toLowerCase();
    const password = requireString(req.body.password, 'Password', { max: 200 });

    const user = db
      .prepare('SELECT * FROM users WHERE username = ? OR email = ?')
      .get(identifier, identifier);

    // Same message whether the user or the password is wrong: revealing which
    // one would let an attacker enumerate valid accounts.
    const ok = user && (await bcrypt.compare(password, user.password_hash));
    if (!ok) {
      throw new ApiError(401, 'Incorrect username or password.');
    }

    issueToken(res, user);
    res.json({ user: publicUser(user) });
  })
);

// POST /api/auth/logout - drop the cookie; the token simply stops being sent.
router.post('/logout', (req, res) => {
  clearToken(res);
  res.json({ ok: true });
});

// GET /api/auth/me - who am I? Used by every page to decide what to render.
router.get('/me', (req, res) => {
  if (!req.user) return res.json({ user: null });
  res.json({ user: publicUser(req.user) });
});

// GET /api/auth/users - usernames for member pickers (project invites etc).
router.get(
  '/users',
  authRequired,
  asyncHandler(async (req, res) => {
    const q = (req.query.q || '').toString().trim().toLowerCase();
    // The search term is bound as a parameter, so the LIKE wildcards cannot
    // become SQL - only part of the pattern string.
    const rows = q
      ? db
          .prepare(
            `SELECT id, username FROM users
              WHERE username LIKE ? AND id <> ?
              ORDER BY username LIMIT 20`
          )
          .all(`%${q}%`, req.user.id)
      : db
          .prepare('SELECT id, username FROM users WHERE id <> ? ORDER BY username LIMIT 20')
          .all(req.user.id);
    res.json({ users: rows });
  })
);

module.exports = router;
