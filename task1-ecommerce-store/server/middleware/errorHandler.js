/**
 * Central error handling.
 *
 * Routes throw (or call next with) an ApiError; everything lands here and comes
 * out as `{ error: "message" }`. The frontend helper in /shared/api.js reads
 * that single field, so every failure shows a readable message instead of a
 * blank screen. Unexpected errors are logged server-side but reported to the
 * client generically, so internals are never leaked.
 */
const { ApiError } = require('../utils/validate');

/** 404 for unmatched /api routes. Mounted after all route modules. */
function notFound(req, _res, next) {
  next(new ApiError(404, `Route not found: ${req.method} ${req.originalUrl}`));
}

function errorHandler(err, req, res, _next) {
  let status = err.status || err.statusCode || 500;
  let message = err.message || 'Something went wrong.';

  // Turn SQLite constraint failures into messages a user can act on.
  if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
    status = 409;
    message = 'That value is already taken.';
  } else if (typeof err.code === 'string' && err.code.startsWith('SQLITE_CONSTRAINT')) {
    status = 400;
    message = 'That action breaks a data rule and was rejected.';
  } else if (err.code === 'LIMIT_FILE_SIZE') {
    // multer rejects oversized uploads with this code.
    status = 413;
    message = 'That file is too large.';
  }

  if (status >= 500) {
    console.error(`[error] ${req.method} ${req.originalUrl}`, err);
    if (!(err instanceof ApiError)) {
      message = 'Internal server error. Please try again.';
    }
  }

  res.status(status).json({ error: message });
}

module.exports = { notFound, errorHandler };
