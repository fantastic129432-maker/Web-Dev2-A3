/**
 * @file The single place where every failure becomes a predictable JSON response.
 *
 *   { success: false, error: { status, message, details? } }
 *
 * The client-side code relies on this shape, so an unexpected database error
 * and a deliberately thrown 404 look the same to the browser apart from the
 * status code and the message.
 *
 * Typing note
 *   `error` is deliberately typed as `any`: Express hands this middleware
 *   whatever was thrown (an HttpError, a mysql2 driver error, an
 *   AggregateError, a plain string), and the whole job of this function is to
 *   read the driver's own fields off it - exactly as it did in JavaScript.
 */
'use strict';

import type { NextFunction, Request, Response } from 'express';

import env = require('../config/env');
import type { DataRecord } from '../types';

/**
 * Answer 404 for any URL that no route matched.
 *
 * It is registered after every route, so reaching it means nothing claimed the
 * request. The reply names the method and the URL so a mistyped endpoint is
 * obvious from the response body alone, and the hint points at the endpoint
 * index rather than leaving the caller to guess.
 *
 * @param req - The request that matched no route; its method and URL are quoted in the message.
 * @param res - The response the 404 envelope is written to.
 * @param next - Accepted so Express recognises a four- or three-argument
 *   middleware, but never called: this handler always writes the response.
 */
export function notFound(req: Request, res: Response, next: NextFunction): void {
  res.status(404).json({
    success: false,
    error: {
      status: 404,
      message: `The endpoint ${req.method} ${req.originalUrl} does not exist on this API.`,
      hint: 'See GET /api for the list of available endpoints.',
    },
  });
}

/**
 * Read the driver error code out of whatever was thrown.
 *
 * mysql2 wraps some failures in an `AggregateError`, whose own `code` is
 * undefined, so the nested errors have to be searched as well; without this the
 * most common setup mistakes would fall through to a faceless 500.
 *
 * @param error - The value thrown by a handler, in any shape.
 * @returns The first driver code found, or `undefined` when the error carries none.
 */
function underlyingCode(error: any): string | undefined {
  if (!error) return undefined;
  if (error.code) return error.code;
  const nested = (error.errors || []).find((item: any) => item && item.code);
  return nested ? nested.code : undefined;
}

/**
 * Convert anything thrown into the API's single error envelope.
 *
 * It must keep four arguments for Express to treat it as an error handler, so
 * `next` is declared but unused even though the chain ends here. The status is
 * taken from the thrown value when it looks like an HTTP status and otherwise
 * becomes 500, and unexpected failures are logged with their full stack while
 * the client receives only the message, so internal details are not leaked.
 *
 * WHY THERE IS NO 500 FACTORY ON `HttpError`
 *   `HttpError` used to carry a `serverError()` builder beside `badRequest()`,
 *   `notFound()`, `conflict()` and `tooManyRequests()`, and nothing ever threw
 *   it: no service, repository, validator or middleware called it, so the 500
 *   below was the only path a server-side failure could take. The builder was
 *   therefore removed rather than kept as a factory with no caller, and the one
 *   decision it documented - that in production the message of any 500 is
 *   REPLACED rather than passed through, so internals are never leaked - is
 *   recorded here, at the branch that actually reads `IS_PRODUCTION`.
 *
 * @param error - The thrown value: an HttpError, a mysql2 driver error, or anything else.
 * @param req - The request being answered, used for the log line and to know whether the response is still open.
 * @param res - The response the error envelope is written to.
 * @param next - Required so Express registers this as an error handler; never called.
 */
export function errorHandler(
  error: any,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const status = error.status && error.status >= 400 ? error.status : 500;
  const code = underlyingCode(error);

  // Unexpected problems are logged with the full stack; the client only ever
  // receives the message, so internal details are not leaked in production.
  if (status >= 500) {
    console.error(`[error] ${req.method} ${req.originalUrl}`, error);
  }

  /** The envelope's error object; its optional members are added below. */
  const errorBody: DataRecord = {
    status,
    message:
      status >= 500 && env.IS_PRODUCTION
        ? 'The server could not complete the request.'
        : error.message || 'Unexpected server error.',
  };

  const payload: DataRecord = { success: false, error: errorBody };

  if (error.details) errorBody.details = error.details;

  // A missing database or table is the most likely setup mistake, so the
  // response says exactly how to fix it.
  if (code === 'ER_NO_SUCH_TABLE' || code === 'ER_BAD_DB_ERROR') {
    errorBody.message =
      'The database is not set up yet. Run database/charityevents_db.sql in MySQL Workbench.';
    errorBody.details = { code, sqlMessage: error.sqlMessage };
  }

  if (code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'ENOTFOUND') {
    errorBody.message =
      'The API could not reach the MySQL server. Check that MySQL is running and that the DB_* settings in api/.env are correct.';
    errorBody.details = { code };
    errorBody.hint =
      'Start MySQL, run database/charityevents_db.sql, copy api/.env.example to api/.env and set DB_PASSWORD. To run without MySQL, set DATA_SOURCE=local in api/.env.';
  }

  if (!env.IS_PRODUCTION && status >= 500) {
    errorBody.stack = error.stack;
  }

  res.status(status).json(payload);
}
