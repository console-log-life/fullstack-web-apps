/**
 * Small hand-rolled validation helpers.
 *
 * Each one throws an ApiError(400, ...) that the central error handler turns
 * into a JSON message the frontend can show directly. Keeping validation in one
 * place means every route rejects bad input the same way.
 */

/** An error carrying an HTTP status, so handlers can just `throw`. */
class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Trims a value and fails if it is empty or too long. */
function requireString(value, field, { min = 1, max = 5000 } = {}) {
  if (typeof value !== 'string') {
    throw new ApiError(400, `${field} is required.`);
  }
  const trimmed = value.trim();
  if (trimmed.length < min) {
    throw new ApiError(400, `${field} must be at least ${min} character(s).`);
  }
  if (trimmed.length > max) {
    throw new ApiError(400, `${field} must be at most ${max} characters.`);
  }
  return trimmed;
}

/** Same as requireString but an empty value is allowed and returns ''. */
function optionalString(value, field, { max = 5000 } = {}) {
  if (value === undefined || value === null || value === '') return '';
  return requireString(value, field, { min: 1, max });
}

/** Parses a positive integer from a string or number (query params are strings). */
function requireInt(value, field, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  const n = Number(value);
  if (!Number.isInteger(n)) {
    throw new ApiError(400, `${field} must be a whole number.`);
  }
  if (n < min || n > max) {
    throw new ApiError(400, `${field} must be between ${min} and ${max}.`);
  }
  return n;
}

/** Usernames become profile URLs, so keep them to a safe character set. */
function requireUsername(value) {
  const username = requireString(value, 'Username', { min: 3, max: 30 });
  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    throw new ApiError(400, 'Username may only contain letters, numbers and underscores.');
  }
  return username.toLowerCase();
}

function requireEmail(value) {
  const email = requireString(value, 'Email', { min: 5, max: 160 });
  // Deliberately permissive: catches typos without rejecting valid odd addresses.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ApiError(400, 'Please enter a valid email address.');
  }
  return email.toLowerCase();
}

function requirePassword(value) {
  if (typeof value !== 'string' || value.length < 6) {
    throw new ApiError(400, 'Password must be at least 6 characters.');
  }
  if (value.length > 200) {
    throw new ApiError(400, 'Password must be at most 200 characters.');
  }
  return value;
}

/** Fails unless the value is one of the allowed strings. */
function requireOneOf(value, field, allowed) {
  if (!allowed.includes(value)) {
    throw new ApiError(400, `${field} must be one of: ${allowed.join(', ')}.`);
  }
  return value;
}

/** Accepts an empty value or a YYYY-MM-DD date. */
function optionalDate(value, field) {
  if (!value) return null;
  const str = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str) || Number.isNaN(Date.parse(str))) {
    throw new ApiError(400, `${field} must be a valid date (YYYY-MM-DD).`);
  }
  return str;
}

module.exports = {
  ApiError,
  requireString,
  optionalString,
  requireInt,
  requireUsername,
  requireEmail,
  requirePassword,
  requireOneOf,
  optionalDate,
};
