/**
 * @file The security measures the brief asks us to think about.
 *
 * They are implemented without pulling in extra dependencies:
 *
 *   1. Security response headers (clickjacking, MIME sniffing, referrer leak).
 *   2. A restrictive CORS policy driven by CORS_ORIGIN in .env.
 *   3. A small in-memory rate limiter so the public endpoints cannot be
 *      hammered - a real deployment would put this behind a reverse proxy.
 *   4. A JSON body size cap (defence in depth for Assessment 3, which adds
 *      POST/PUT/DELETE).
 *
 * A3 change
 *   A2 allowed only GET and OPTIONS, because A2 had no write endpoints. A3
 *   adds the full C.R.U.D. cycle, so POST, PUT and DELETE are now allowed too.
 *   Only the methods the API actually implements are advertised: the browser
 *   refuses a PATCH because it is not in the list below.
 */
'use strict';

import type { NextFunction, Request, RequestHandler, Response } from 'express';

import env = require('../config/env');
import { HttpError } from '../utils/errors';

/** The HTTP methods this API implements. */
const ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'];

/** Headers a browser is allowed to send with a cross-origin request. */
const ALLOWED_HEADERS = ['Content-Type', 'Accept'];

/** Response headers the client websites are allowed to read. */
const EXPOSED_HEADERS = [
  'X-RateLimit-Limit',
  'X-RateLimit-Remaining',
  'X-RateLimit-Reset',
  'Location',
  'X-Deleted-Event-Id',
  'X-Deleted-Event-Name',
  'X-Deleted-Registration-Id',
];

/**
 * The rate limiter is a RequestHandler, and nothing more than one.
 *
 * It used to declare a `stop()` that cleared its pruning interval, on the
 * reasoning that an interval would keep a test runner or a shutting-down
 * process alive with no way to silence it between cases. That reasoning was
 * solved at the source instead: the interval is `unref()`'d (see
 * `createRateLimiter` below), so it never holds the process open and there is
 * nothing left to stop. No test, tool or caller in the repository ever used
 * the method, so it was removed here rather than left as a promise the type
 * made and the implementation could drop at any time.
 */
export interface RateLimiter extends RequestHandler {}

/**
 * Set the security headers that suit a JSON API.
 *
 * `X-Content-Type-Options: nosniff` stops a browser from reinterpreting a JSON
 * body as HTML, `X-Frame-Options: DENY` blocks clickjacking through an embedded
 * frame, and the referrer policy stops URLs (which carry ids) leaking to third
 * parties. The resource policy is `cross-origin` rather than `same-origin`
 * because the two Angular sites are served from a different port to the API in
 * development.
 *
 * @param req - The incoming request; unused, but part of the middleware contract.
 * @param res - The response whose headers are stamped.
 * @param next - Passes control to the next middleware in the chain.
 */
export function securityHeaders(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.removeHeader('X-Powered-By');
  next();
}

/**
 * Build the CORS middleware from the configured origin list.
 *
 * `CORS_ORIGIN` is a comma separated list, and `*` means any caller, which is
 * the development default. When an explicit list is configured the matching
 * origin is echoed back instead, together with `Vary: Origin`: without that
 * header a shared cache could hand one site's response to another. The exposed
 * header list is what lets the Angular client read the `Location` of a freshly
 * created resource, and the ten-minute preflight cache keeps the update and
 * delete forms from paying for an extra round trip on every click.
 *
 * @returns The CORS middleware, which answers a preflight with 204 and a bare body.
 */
export function createCors(): RequestHandler {
  const allowed = env.CORS_ORIGIN.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  const allowAny = allowed.includes('*');

  /** Stamp the CORS headers, and end a preflight request without a body. */
  return function cors(req: Request, res: Response, next: NextFunction): void {
    const requestOrigin = req.headers.origin;

    if (allowAny) {
      res.setHeader('Access-Control-Allow-Origin', '*');
    } else if (requestOrigin && allowed.includes(requestOrigin)) {
      res.setHeader('Access-Control-Allow-Origin', requestOrigin);
      res.setHeader('Vary', 'Origin');
    }

    // A3: the write methods are now part of the API surface.
    res.setHeader('Access-Control-Allow-Methods', ALLOWED_METHODS.join(','));
    res.setHeader('Access-Control-Allow-Headers', ALLOWED_HEADERS.join(', '));
    // Without this the browser hides the headers from the page, which would
    // stop the client reading the Location of a freshly created resource.
    res.setHeader('Access-Control-Expose-Headers', EXPOSED_HEADERS.join(', '));
    // A preflight answer may be cached for 10 minutes, so the delete and update
    // forms do not pay for an extra round trip on every click.
    res.setHeader('Access-Control-Max-Age', '600');

    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  };
}

/**
 * Build the fixed-window rate limiter keyed by client IP.
 *
 * A window is chosen over a dependency so the marker can read and understand
 * the logic; the counter resets on a timer rather than on a rolling basis, which
 * is the trade-off a small API can afford. The limiter keys on `req.ip`, which
 * is why server.ts trusts exactly one proxy hop and no more - trusting every hop
 * would let a caller forge `X-Forwarded-For` and never be limited. Over the
 * limit the failure is raised as an `HttpError`, so it leaves through the same
 * error middleware as every other failure. A `RATE_LIMIT_MAX` of zero or less
 * disables the limiter entirely, which the test suite and local demos rely on.
 *
 * @returns The limiter itself, ready to mount on the app with `app.use()`.
 */
export function createRateLimiter(): RateLimiter {
  /** One fixed window per client IP. */
  const hits = new Map<string, { count: number; resetAt: number }>();
  const windowMs = env.RATE_LIMIT_WINDOW_MS;
  const max = env.RATE_LIMIT_MAX;

  /**
   * Drop expired windows on a timer so the map cannot grow forever.
   *
   * `unref()` lets the process exit even while this interval is pending, and
   * that single call is what makes the timer safe to leave running: it cannot
   * keep a test runner or a shutting-down process alive, so there is no need
   * to silence it between cases. An earlier revision also exposed a `stop()`
   * that cleared this interval; once the interval was unreferenced the method
   * had nothing to do and no caller, so it was removed. The reasoning lives
   * here, at the timer that does the work.
   */
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(key);
    }
  }, windowMs).unref();

  /** Count the request against its window and report the remaining allowance. */
  const rateLimiter = function rateLimiter(
    req: Request,
    res: Response,
    next: NextFunction
  ): void {
    if (max <= 0) return next();

    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const entry = hits.get(key);

    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      res.setHeader('X-RateLimit-Limit', max);
      res.setHeader('X-RateLimit-Remaining', max - 1);
      // The reset time is known the moment the window is created, and this header is
      // advertised in the CORS `Access-Control-Expose-Headers` list above, so leaving
      // it out of a window's FIRST response made the header's presence depend on which
      // request a client happened to look at: request 1 of a fresh window carried
      // Limit and Remaining but no Reset, request 2 onwards carried all three. A
      // client reading Reset to decide how long to wait saw `undefined` exactly once
      // per window - the response it is most likely to read, because it is the one
      // that reports the largest remaining allowance.
      res.setHeader('X-RateLimit-Reset', Math.ceil((now + windowMs) / 1000));
      return next();
    }

    entry.count += 1;
    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', Math.max(max - entry.count, 0));
    res.setHeader('X-RateLimit-Reset', Math.ceil(entry.resetAt / 1000));

    if (entry.count > max) {
      return next(
        HttpError.tooManyRequests(
          `Rate limit exceeded: ${max} requests per ${windowMs / 1000} seconds.`,
          { retryAfterSeconds: Math.ceil((entry.resetAt - now) / 1000) }
        )
      );
    }

    return next();
  } as RateLimiter;

  return rateLimiter;
}
