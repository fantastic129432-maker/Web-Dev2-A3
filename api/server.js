/**
 * server.js
 * ---------------------------------------------------------------------------
 * Application entry point.
 *
 * Startup order
 *   1. load configuration (config/env.js reads api/.env)
 *   2. build the Express application
 *   3. mount security middleware, routes and error handling
 *   4. confirm the database connection (mysql mode) and start listening
 *   5. shut down cleanly on Ctrl+C / SIGTERM
 *
 * Run with:  npm start        (api folder)
 */
'use strict';

const express = require('express');
const path = require('path');

const env = require('./src/config/env');
const apiRoutes = require('./src/routes/apiRoutes');
const { notFound, errorHandler } = require('./src/middleware/errorHandler');
const {
  securityHeaders,
  createCors,
  createRateLimiter,
} = require('./src/middleware/security');
const repository = require('./src/repositories');

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
app.set('trust proxy', true); // correct client IPs behind a proxy

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

// Friendly landing page so opening http://localhost:3000 in a browser is useful.
app.get('/', (req, res) => {
  res.sendFile(path.join(env.API_ROOT, 'src', 'views', 'api-index.html'), (error) => {
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

  const shutdown = async (signal) => {
    console.log(`\n${signal} received - shutting down.`);
    server.close(async () => {
      try {
        // Safe in both modes: the local data source has nothing to close.
        const db = require('./src/db/event_db');
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
 *   1. `node server.js` (local development, `npm start`)
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

module.exports = { app, start };
