/**
 * The single authentication system shared by all four apps.
 *
 * Flow: login signs a JWT holding { id, username } and sends it back in an
 * httpOnly cookie. httpOnly means page JavaScript cannot read the token, so an
 * XSS bug cannot steal the session. Every later request carries the cookie
 * automatically, and `authRequired` verifies it before the route runs.
 */
const jwt = require('jsonwebtoken');
const { db } = require('../db');
const { ApiError } = require('../utils/validate');

const COOKIE_NAME = 'ca_token';

function jwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    // Failing loudly beats signing tokens with a guessable fallback.
    throw new Error('JWT_SECRET is not set. Copy .env.example to .env.');
  }
  return secret;
}

/** Signs a token for a user and attaches it to the response as a cookie. */
function issueToken(res, user) {
  const token = jwt.sign(
    { id: user.id, username: user.username },
    jwtSecret(),
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );

  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,                                  // not readable from JS
    sameSite: 'lax',                                 // blocks cross-site form POSTs
    secure: process.env.NODE_ENV === 'production',   // HTTPS-only once deployed
    maxAge: 7 * 24 * 60 * 60 * 1000,                 // 7 days
    path: '/',
  });
  return token;
}

function clearToken(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

/** Verifies a raw token string and returns the fresh user row, or null. */
function userFromToken(token) {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, jwtSecret());
    // Re-read the user so a deleted account cannot keep using a valid token.
    const user = db
      .prepare('SELECT id, username, email, created_at FROM users WHERE id = ?')
      .get(payload.id);
    return user || null;
  } catch {
    return null; // expired or tampered token
  }
}

/** Populates req.user when a valid cookie is present; never blocks. */
function attachUser(req, _res, next) {
  req.user = userFromToken(req.cookies?.[COOKIE_NAME]);
  next();
}

/** Blocks the request with 401 unless a valid session exists. */
function authRequired(req, _res, next) {
  if (!req.user) {
    return next(new ApiError(401, 'Please log in to continue.'));
  }
  next();
}

module.exports = {
  COOKIE_NAME,
  issueToken,
  clearToken,
  attachUser,
  authRequired,
  userFromToken,
};
