/**
 * src/utils/asyncHandler.js
 * ---------------------------------------------------------------------------
 * Express 4 does not forward errors thrown inside an async handler to the
 * error middleware, which would leave a request hanging. This wrapper catches
 * the rejected promise and calls next(error) so every failure ends up in the
 * single error handler and produces a consistent JSON response.
 */
'use strict';

function asyncHandler(handler) {
  return function wrapped(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

module.exports = { asyncHandler };
