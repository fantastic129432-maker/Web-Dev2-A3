/**
 * server.ts
 * ---------------------------------------------------------------------------
 * Application entry point.
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

const app = express();

// ---------------------------------------------------------------------------
// Mount point (Passenger / cPanel)
// ---------------------------------------------------------------------------
/**
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
app.disable('x-powered-by');

/*
 * Trust exactly ONE proxy hop - Passenger, which sits in front of this app on the
 * cPanel - and no more.
 *
 * `true` was wrong and quietly defeated the rate limiter: it makes req.ip the
 * LEFTMOST X-Forwarded-For value, and the limiter keys on req.ip, so any caller
 * could send a different `X-Forwarded-For` on every request and never be limited
 * (RATE_LIMIT_MAX is 300). Trusting one hop takes the address Passenger appends,
 * which the client cannot forge.
 */
app.set('trust proxy', 1);

app.use(securityHeaders);
app.use(createCors());
app.use(createRateLimiter());

// The API only needs JSON in Assessment 2, but the parser is capped so that
// the POST/PUT/DELETE endpoints added in Assessment 3 cannot be abused.
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));

// A tiny request log so the demo video can show the API being called.
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
 * The friendly landing page so opening http://localhost:3000 in a browser is
 * useful.
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

  const shutdown = async (signal: string) => {
    console.log(`\n${signal} received - shutting down.`);
    server.close(async () => {
      try {
        // Safe in both modes: the local data source has nothing to close.
        // The require stays INSIDE the handler so that the pool module is only
        // loaded when the process actually shuts down, exactly as before.
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

/*
 * ---------------------------------------------------------------------------
 * Start the server.
 * ---------------------------------------------------------------------------
 * The guard has to cover two different ways this file gets loaded.
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

// Named exports: the compiled CommonJS output is `exports.app` / `exports.start`,
// so `const { app } = require('./dist/server.js')` keeps working unchanged.
export { app, start };
