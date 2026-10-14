/**
 * src/utils/asyncHandler.ts
 * ---------------------------------------------------------------------------
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

/** An async route handler: it may return a promise, or nothing at all. */
export type AsyncRequestHandler<
  Req extends Request = Request,
  Res extends Response = Response
> = (req: Req, res: Res, next: NextFunction) => Promise<unknown> | unknown;

export function asyncHandler<Req extends Request = Request>(
  handler: AsyncRequestHandler<Req>
): RequestHandler {
  return function wrapped(req, res, next): void {
    Promise.resolve(handler(req as Req, res, next)).catch(next);
  };
}
