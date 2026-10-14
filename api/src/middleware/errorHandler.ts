/**
 * src/middleware/errorHandler.ts
 * ---------------------------------------------------------------------------
 * One place where every failure becomes a predictable JSON response:
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

/** 404 for any URL that no route matched. */
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

/** The underlying code, including when mysql2 wraps failures in AggregateError. */
function underlyingCode(error: any): string | undefined {
  if (!error) return undefined;
  if (error.code) return error.code;
  const nested = (error.errors || []).find((item: any) => item && item.code);
  return nested ? nested.code : undefined;
}

/** Central error handler - must keep four arguments for Express to use it. */
// eslint-disable-next-line no-unused-vars
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
