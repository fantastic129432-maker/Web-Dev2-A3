/**
 * @file Express async-handler wrapper.
 *
 * A rejected promise reaches the error middleware.
 *
 * Express 4 does not forward errors thrown inside an async handler to the
 * error middleware, which would leave a request hanging. This wrapper catches
 * the rejected promise and calls next(error) so every failure ends up in the
 * single error handler and produces a consistent JSON response.
 *
 * The generic parameter is what keeps Express's own request typing: the handler
 * still receives a fully typed `Request`, so `req.params.id` and `req.query` are
 * checked at the call site in every route file, while the returned value is a
 * plain `RequestHandler` that `router.get()` accepts directly.
 */
'use strict';

import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * An async route handler: it may return a promise, or nothing at all.
 *
 * The union with `unknown` is deliberate: a route that never awaits anything is
 * still a valid handler, so both shapes are accepted and no caller has to mark a
 * handler `async` purely to satisfy the type. `Req` and `Res` default to
 * Express's own `Request` and `Response`, and are narrowed only where a route
 * needs a typed body or query.
 */
export type AsyncRequestHandler<
  Req extends Request = Request,
  Res extends Response = Response
> = (req: Req, res: Res, next: NextFunction) => Promise<unknown> | unknown;

/**
 * Wrap an async route handler so its rejection reaches the error middleware.
 *
 * `Promise.resolve(...)` is applied to the handler's result rather than
 * `await`-ing it inside a `try`/`catch`, so a handler that returns a plain value
 * costs nothing extra, and a handler that returns a promise has its rejection
 * routed to `next` on the microtask queue - which is what stops Express from
 * treating the request as still in flight.
 *
 * @param handler - The route handler to wrap; it may return a promise or a plain value.
 * @returns A `RequestHandler` that never rejects, so it can be passed straight
 *   to `router.get()` and friends.
 */
export function asyncHandler<Req extends Request = Request>(
  handler: AsyncRequestHandler<Req>
): RequestHandler {
  /** The value Express actually calls: run the handler and route any rejection to `next`. */
  return function wrapped(req, res, next): void {
    Promise.resolve(handler(req as Req, res, next)).catch(next);
  };
}
