/**
 * @file Application entry point.
 *
 * Startup order
 *   1. load configuration (config/env.ts reads api/.env)
 *   2. build the Express application
 *   3. mount security middleware, routes and error handling
 *   4. confirm the database connection (mysql mode) and start listening
 *   5. shut down cleanly on Ctrl+C / SIGTERM
 *
 * Run with:  npm start        (api folder, runs the compiled dist/server.js)
 * Build first: npm run build
 *
 * The compiled file is what runs, not this source: `tsc` writes api/dist so that
 * the layout mirrors the source (api/server.ts -> api/dist/server.js), which is
 * the entry point `npm start`, the automated test suite and the cPanel
 * deployment all use.
 */
'use strict';

import express = require('express');
import fs = require('fs');
import path = require('path');

import env = require('./src/config/env');
import apiRoutes = require('./src/routes/apiRoutes');
import { notFound, errorHandler } from './src/middleware/errorHandler';
import {
  securityHeaders,
  createCors,
  createRateLimiter,
} from './src/middleware/security';
import repository = require('./src/repositories');

/** The Express application, exported so a test can drive it without opening a port. */
const app = express();

// ---------------------------------------------------------------------------
// Mount point (Passenger / cPanel)
// ---------------------------------------------------------------------------
/**
 * Strip the Passenger mount point from the front of every request URL.
 *
 * Passenger tells the application where it was mounted through
 * PASSENGER_BASE_URI, and it passes the FULL url through to the application
 * rather than stripping the mount point.
 *
 * Concretely, on the SCU cPanel the application URL is
 *   https://24832481.it.scu.edu.au/charity-events-api
 * so a request for
 *   /charity-events-api/api/health
 * reaches this file with `req.url === '/charity-events-api/api/health'`.
 * The routes below are mounted at '/api', so without this strip nothing matches
 * and every single endpoint answers 404 - while the application itself looks
 * perfectly healthy, which makes it a confusing failure to debug.
 *
 * Stripping the prefix restores the local paths and needs no other change.
 * When the variable is absent (local development, tests) this is a no-op.
 */
const baseUri = (process.env.PASSENGER_BASE_URI || '').replace(/\/+$/, '');

if (baseUri) {
  app.use((req, res, next) => {
    if (req.url === baseUri) {
      // A request for exactly the mount point: treat it as the mount root.
      req.url = '/';
    } else if (req.url.startsWith(`${baseUri}/`)) {
      req.url = req.url.slice(baseUri.length);
    }
    next();
  });
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
/** Remove the framework fingerprint Express adds to every response. */
app.disable('x-powered-by');

/**
 * Trust exactly ONE proxy hop.
 *
 * Passenger sits in front of this app on the cPanel, and no more than one hop
 * may be trusted. `true` was wrong and quietly defeated the rate limiter: it
 * makes req.ip the LEFTMOST X-Forwarded-For value, and the limiter keys on
 * req.ip, so any caller could send a different `X-Forwarded-For` on every
 * request and never be limited (RATE_LIMIT_MAX is 300). Trusting one hop takes
 * the address Passenger appends, which the client cannot forge.
 */
app.set('trust proxy', 1);

app.use(securityHeaders);
app.use(createCors());
app.use(createRateLimiter());

/**
 * Cap the size of the JSON and form bodies the write endpoints accept.
 *
 * The API only needs JSON in Assessment 2, but the parser is capped so that the
 * POST/PUT/DELETE endpoints added in Assessment 3 cannot be abused by a very
 * large body.
 */
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));

/**
 * Log one line per request, so the demo video can show the API being called.
 *
 * The line is written when the response finishes rather than when it starts, so
 * it can report the status code and the time taken; the test runs silence it by
 * setting NODE_ENV=test.
 */
app.use((req, res, next) => {
  const startedAt = Date.now();
  res.on('finish', () => {
    if (env.NODE_ENV !== 'test') {
      console.log(
        `${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - startedAt} ms)`
      );
    }
  });
  next();
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.use('/api', apiRoutes);

/**
 * The friendly landing page, so opening the API root in a browser is useful.
 *
 * The page is a static .html file and `tsc` does not copy it, so its location
 * is resolved from the API ROOT - the folder holding package.json, found by
 * walking up from the compiled file (see src/config/env.ts). Computing it from
 * __dirname alone would look for api/dist/src/views and answer 404 instead.
 * The second candidate only covers a deployment that ships api/dist on its
 * own; the build's copy step places the page there as well.
 */
const LANDING_PAGE =
  [
    path.join(env.API_ROOT, 'src', 'views', 'api-index.html'),
    path.join(__dirname, 'src', 'views', 'api-index.html'),
  ].find((candidate) => fs.existsSync(candidate)) ??
  path.join(env.API_ROOT, 'src', 'views', 'api-index.html');

/**
 * Serve the landing page, falling back to a JSON banner if it cannot be read.
 *
 * The fallback keeps the root URL useful even in a deployment that shipped
 * without the static file, which is the one case where sendFile fails after the
 * headers were already committed.
 */
app.get('/', (req, res) => {
  res.sendFile(LANDING_PAGE, (error) => {
    if (error) {
      res.json({
        success: true,
        meta: { resource: 'api-index' },
        data: { message: 'Charity Events API is running.', try: '/api' },
      });
    }
  });
});

// 404 + central error handling must be registered last.
app.use(notFound);
app.use(errorHandler);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
/**
 * Connect to the data source, print the banner and begin listening.
 *
 * The banner names the data source and reports whether the database answered,
 * because the two most common setup mistakes (the wrong DATA_SOURCE, or no
 * database at all) are then visible at a glance. An unreachable database is a
 * warning rather than a fatal error: the API still starts and /api/health
 * reports the problem, which is more useful than a process that dies with a
 * driver stack trace. The signal handlers close the server first and only then
 * release the pool, so no in-flight request loses its connection.
 *
 * @returns The listening server, returned so a test or a caller can close it
 *   instead of leaving the port bound.
 */
async function start() {
  const health = await repository.health();

  console.log('----------------------------------------------------------');
  console.log(' PROG2002 A3 - Charity Events API');
  console.log(` Data source : ${repository.driver}`);
  if (repository.driver === 'mysql') {
    console.log(
      ` Database    : ${env.DB_NAME} @ ${env.DB_HOST}:${env.DB_PORT} (user ${env.DB_USER})`
    );
  }
  if (health.connected === false) {
    console.warn(' WARNING: the database is not reachable.');
    console.warn(`   ${health.error ? health.error.message : 'unknown error'}`);
    console.warn('   The API will start, and /api/health will report the problem.');
    console.warn('   Fix: run database/charityevents_db.sql, then check api/.env');
    console.warn('   Or set DATA_SOURCE=local in api/.env to use the offline data.');
  } else {
    console.log(' Database    : connected');
  }
  console.log(` Listening on: http://localhost:${env.PORT}`);
  console.log(` Try         : http://localhost:${env.PORT}/api/events`);
  console.log('----------------------------------------------------------');

  const server = app.listen(env.PORT, () => {
    // started
  });

  /**
   * Close the server and release the database pool, then end the process.
   *
   * The require of the pool module stays INSIDE the handler so that the pool is
   * only loaded when the process actually shuts down, exactly as before, and it
   * is safe in both modes because the local data source has nothing to close.
   */
  const shutdown = async (signal: string) => {
    console.log(`\n${signal} received - shutting down.`);
    server.close(async () => {
      try {
        // Safe in both modes: the local data source has nothing to close.
        const db = require('./src/db/event_db') as typeof import('./src/db/event_db');
        await db.close();
      } catch (error) {
        console.warn('Database pool cleanup skipped:', error.message);
      }
      process.exit(0);
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  return server;
}

/**
 * Whether Passenger loaded this file, detected from the variable it sets.
 *
 * The start-up guard below has to cover two different ways this file gets
 * loaded:
 *
 *   1. `node dist/server.js` (local development, `npm start`)
 *      -> require.main === module is true.
 *
 *   2. Passenger, which is what the SCU cPanel uses for its Node.js apps.
 *      Passenger does NOT execute the startup file - it `require()`s it and then
 *      expects the app to be listening on the port it assigned. Under Passenger
 *      `require.main` is Passenger's own loader, so `require.main === module` is
 *      FALSE and a plain `if (require.main === module)` guard would never call
 *      start(). The application would then never listen, and the browser would
 *      get Passenger's generic error page:
 *
 *        500 - "Web application could not be started"
 *
 *      That is exactly what happened on the first cPanel deployment: every file
 *      was correct, all 79 packages were installed, .env was right, and the app
 *      still refused to start. Passenger sets PASSENGER_BASE_URI, so that is the
 *      signal used to detect this case.
 *
 * Tests import { app, start } from this file directly, so they are unaffected:
 * neither condition is true when a test runner requires it.
 */
const IS_PASSENGER = Boolean(process.env.PASSENGER_BASE_URI);

if (require.main === module || IS_PASSENGER) {
  start().catch((error) => {
    console.error('Failed to start the API:', error);
    process.exit(1);
  });
}

/**
 * The two names the rest of the project imports.
 *
 * The compiled CommonJS output is `exports.app` / `exports.start`, so
 * `const { app } = require('./dist/server.js')` keeps working unchanged - which
 * is what the test suite does instead of starting a server on a port.
 */
export { app, start };
