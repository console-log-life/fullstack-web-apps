/**
 * Express 4 does not catch rejected promises from async route handlers, so an
 * `await` that throws would hang the request. Wrapping a handler in this passes
 * the rejection to next(), which reaches the central error handler.
 */
module.exports = function asyncHandler(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
