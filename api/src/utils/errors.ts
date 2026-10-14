/**
 * src/utils/errors.ts - HTTP aware error type.
 *
 * `details` is `unknown` on purpose: it is whatever machine readable extra
 * information the caller wants to attach, and it is passed straight through to
 * the JSON response by the error middleware (usually the per-field
 * `{ field, message }` array, sometimes a plain object). Narrowing it here
 * would only force casts at every throw site.
 */
'use strict';

export class HttpError extends Error {
  /** HTTP status code. */
  status: number;
  /** Extra machine readable information returned to the client. */
  details?: unknown;

  /**
   * @param status  HTTP status code
   * @param message human readable message returned to the client
   * @param details extra machine readable information
   */
  constructor(status: number, message: string, details: unknown = undefined) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    if (details) this.details = details;
    Error.captureStackTrace(this, HttpError);
  }

  static badRequest(
    message = 'Invalid request',
    details?: unknown
  ): HttpError {
    return new HttpError(400, message, details);
  }

  static notFound(
    message = 'Resource not found',
    details?: unknown
  ): HttpError {
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
  static conflict(
    message = 'The request conflicts with the current state of the data',
    details?: unknown
  ): HttpError {
    return new HttpError(409, message, details);
  }

  static tooManyRequests(
    message = 'Too many requests',
    details?: unknown
  ): HttpError {
    return new HttpError(429, message, details);
  }

  static serverError(
    message = 'Internal server error',
    details?: unknown
  ): HttpError {
    return new HttpError(500, message, details);
  }
}
