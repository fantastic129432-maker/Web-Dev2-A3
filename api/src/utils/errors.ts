/**
 * @file HTTP-aware error type.
 *
 * `details` is `unknown` on purpose: it is whatever machine readable extra
 * information the caller wants to attach, and it is passed straight through to
 * the JSON response by the error middleware (usually the per-field
 * `{ field, message }` array, sometimes a plain object). Narrowing it here
 * would only force casts at every throw site.
 */
'use strict';

/**
 * An error carrying the HTTP status the caller should send back.
 *
 * Extending `Error` rather than returning a result object is what lets the
 * service layer `throw` a 400 or a 409 and have it unwind through exactly the
 * same path as an unexpected database failure, so there is one response shape to
 * maintain. The middleware reads `status` and `details` off whatever it is
 * handed, so this class is the contract between the two layers.
 */
export class HttpError extends Error {
  /** The HTTP status code to answer with. */
  status: number;
  /** Extra machine readable information for the client, such as the per-field error list. */
  details?: unknown;

  /**
   * Build an error the error middleware can render as JSON.
   *
   * @param status - The HTTP status code to answer with.
   * @param message - The human readable message returned to the client.
   * @param details - Extra machine readable information, usually the per-field
   *   validation list. May be omitted, in which case the response carries no
   *   `details` member at all rather than an empty one.
   */
  constructor(status: number, message: string, details: unknown = undefined) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    if (details) this.details = details;
    Error.captureStackTrace(this, HttpError);
  }

  /**
   * Build a 400 for a request the client can correct.
   *
   * @param message - The message returned to the client. May be omitted, in
   *   which case a generic invalid-request message is used.
   * @param details - The per-field problem list collected by the validators.
   *   May be omitted when the request has no field-level detail to report.
   * @returns The error, ready to be thrown.
   */
  static badRequest(
    message = 'Invalid request',
    details?: unknown
  ): HttpError {
    return new HttpError(400, message, details);
  }

  /**
   * Build a 404 for a resource that does not exist.
   *
   * @param message - The message returned to the client. May be omitted, in
   *   which case a generic not-found message is used.
   * @param details - Extra machine readable information, such as the id that was
   *   searched for. May be omitted.
   * @returns The error, ready to be thrown.
   */
  static notFound(
    message = 'Resource not found',
    details?: unknown
  ): HttpError {
    return new HttpError(404, message, details);
  }

  /**
   * Build a 409 for a request that is well formed but cannot be carried out.
   *
   * Added for the delete rule in Part 2: the request is well formed and the
   * event exists, but the current state of the data (it already has
   * registrations) means it cannot be carried out. 409 says exactly that,
   * where 400 would suggest the client sent something malformed.
   *
   * @param message - The message returned to the client. May be omitted, in
   *   which case a generic conflict message is used.
   * @param details - Extra machine readable information, such as how many
   *   registrations block the delete. May be omitted.
   * @returns The error, ready to be thrown.
   */
  static conflict(
    message = 'The request conflicts with the current state of the data',
    details?: unknown
  ): HttpError {
    return new HttpError(409, message, details);
  }

  /**
   * Build a 429 for a client that has exceeded the rate limit.
   *
   * @param message - The message returned to the client. May be omitted, in
   *   which case a generic too-many-requests message is used.
   * @param details - Extra machine readable information, such as how many
   *   seconds to wait before retrying. May be omitted.
   * @returns The error, ready to be thrown.
   */
  static tooManyRequests(
    message = 'Too many requests',
    details?: unknown
  ): HttpError {
    return new HttpError(429, message, details);
  }
}
