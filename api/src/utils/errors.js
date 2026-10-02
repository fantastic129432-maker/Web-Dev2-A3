/**
 * src/utils/errors.js - HTTP aware error type.
 */
'use strict';

class HttpError extends Error {
  /**
   * @param {number} status  HTTP status code
   * @param {string} message human readable message returned to the client
   * @param {object} [details] extra machine readable information
   */
  constructor(status, message, details = undefined) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    if (details) this.details = details;
    Error.captureStackTrace(this, HttpError);
  }

  static badRequest(message = 'Invalid request', details) {
    return new HttpError(400, message, details);
  }

  static notFound(message = 'Resource not found', details) {
    return new HttpError(404, message, details);
  }

  /**
   * 409 Conflict.                                                        A3
   *
   * Added for the delete rule in Part 2: the request is well formed and the
   * event exists, but the current state of the data (it already has
   * registrations) means it cannot be carried out. 409 says exactly that,
   * where 400 would suggest the client sent something malformed.
   */
  static conflict(message = 'The request conflicts with the current state of the data', details) {
    return new HttpError(409, message, details);
  }

  static tooManyRequests(message = 'Too many requests', details) {
    return new HttpError(429, message, details);
  }

  static serverError(message = 'Internal server error', details) {
    return new HttpError(500, message, details);
  }
}

module.exports = { HttpError };
