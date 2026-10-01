/**
 * src/db/event_db.js
 * ---------------------------------------------------------------------------
 * REQUIRED FILE: "Set up a Node.js file, named event_db.js, that connects to
 * your database." (Assessment 2, Part 1 - extended for Assessment 3.)
 *
 * Responsibilities
 *   1. Create one shared MySQL connection pool for the whole application
 *      (a pool is used instead of a single connection so that concurrent
 *      HTTP requests do not have to wait for each other, and so that a
 *      dropped connection is replaced automatically).
 *   2. Expose a tiny promise-based API (`query`, `getConnection`,
 *      `transaction`, `ping`, `close`) built on mysql2/promise, so the rest
 *      of the code can use async/await instead of nested callbacks.
 *   3. Fail with a clear, actionable message when the database is not
 *      reachable, instead of an unhandled exception.
 *
 * Assessment 3 change
 *   A2 only read data, so a single `query()` was enough. A3 adds
 *   INSERT / UPDATE / DELETE, and two of those operations must be all or
 *   nothing (for example: confirm an event has no registrations, then delete
 *   it). `transaction()` was added for that: it hands the callback one
 *   connection inside BEGIN/COMMIT and rolls back if the callback throws.
 *   The pool is still the same pool, so nothing else in the application
 *   changed.
 *
 * The pool is created lazily: simply requiring this file never touches the
 * network, which keeps unit tests and the alternative local data source fast.
 */
'use strict';

const mysql = require('mysql2/promise');
const env = require('../config/env');

/** @type {import('mysql2/promise').Pool | null} */
let pool = null;

/** The exact connection settings being used (password never logged). */
const connectionSettings = {
  host: env.DB_HOST,
  port: env.DB_PORT,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  database: env.DB_NAME,
  waitForConnections: true,
  connectionLimit: env.DB_CONNECTION_LIMIT,
  queueLimit: 0,
  // Return DECIMAL columns as numbers so the API emits 1200 not "1200.00".
  decimalNumbers: true,
  // Keep DATE/DATETIME as strings: no timezone shifting between DB and API.
  dateStrings: true,
  charset: 'utf8mb4_0900_ai_ci',
  timezone: 'Z',
  namedPlaceholders: false,
};

/**
 * Create (once) and return the shared pool.
 * @returns {import('mysql2/promise').Pool}
 */
function getPool() {
  if (pool) return pool;

  pool = mysql.createPool(connectionSettings);

  // A pool level error listener stops an idle-connection failure from
  // crashing the Node process.
  pool.on('error', (error) => {
    console.error('[event_db] MySQL pool error:', error.code || error.message);
  });

  return pool;
}

/**
 * Run a parameterised SQL statement.
 *
 * ALWAYS pass user input through `params` - never build SQL by string
 * concatenation. mysql2 escapes every value in `params`, which is what
 * prevents SQL injection on the search endpoint.
 *
 * @param {string} sql    SQL text containing "?" placeholders.
 * @param {Array}  params Values bound to the placeholders.
 * @returns {Promise<Array>} rows (SELECT) or a result header (INSERT/UPDATE).
 */
async function query(sql, params = []) {
  const [rows] = await getPool().execute(sql, params);
  return rows;
}

/** Borrow a connection for a manual transaction. Remember to release it. */
async function getConnection() {
  return getPool().getConnection();
}

/**
 * Run `work` inside a database transaction.                        A3
 *
 * @param {(connection: import('mysql2/promise').PoolConnection) => Promise<any>} work
 * @returns {Promise<any>} whatever `work` returned
 *
 * The connection is always released, and the transaction is rolled back if
 * `work` throws, so a failed write can never leave half-applied data behind.
 * Used by the event delete rule, which must decide and act as one unit.
 */
async function transaction(work) {
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    try {
      await connection.rollback();
    } catch (rollbackError) {
      console.error('[event_db] rollback failed:', rollbackError.message);
    }
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Check that the database is reachable and that the expected tables exist.
 * Used by GET /api/health so a marker can confirm the setup in one click.
 *
 * A3 report: `registrationTable` tells the marker at a glance whether the
 * new event_registrations table was created by 01_schema.sql.
 */
async function ping() {
  try {
    const rows = await query('SELECT DATABASE() AS db, VERSION() AS version');
    const tables = await query(
      `SELECT COUNT(*) AS tableCount
         FROM information_schema.tables
        WHERE table_schema = ?`,
      [env.DB_NAME]
    );
    const registrations = await query(
      `SELECT COUNT(*) AS tableCount
         FROM information_schema.tables
        WHERE table_schema = ? AND table_name = 'event_registrations'`,
      [env.DB_NAME]
    );

    return {
      connected: true,
      database: rows[0] ? rows[0].db : env.DB_NAME,
      serverVersion: rows[0] ? rows[0].version : null,
      tableCount: tables[0] ? tables[0].tableCount : 0,
      registrationTable: Boolean(
        registrations[0] && Number(registrations[0].tableCount) > 0
      ),
      host: `${env.DB_HOST}:${env.DB_PORT}`,
      user: env.DB_USER,
    };
  } catch (error) {
    return {
      connected: false,
      database: env.DB_NAME,
      host: `${env.DB_HOST}:${env.DB_PORT}`,
      user: env.DB_USER,
      error: {
        code: error.code || 'UNKNOWN',
        message: error.message,
      },
      hint:
        'Start MySQL, then run database/charityevents_db.sql and check the ' +
        'DB_* values in api/.env. Example: mysql -u root -p < charityevents_db.sql',
    };
  }
}

/** Close the pool (used on shutdown and after the test suite). */
async function close() {
  if (!pool) return;
  const closing = pool;
  pool = null;
  await closing.end();
}

/** Expose the settings for diagnostics (password deliberately omitted). */
function describe() {
  return {
    host: connectionSettings.host,
    port: connectionSettings.port,
    user: connectionSettings.user,
    database: connectionSettings.database,
    connectionLimit: connectionSettings.connectionLimit,
  };
}

module.exports = {
  // main API
  query,
  getConnection,
  transaction,
  ping,
  close,
  describe,
  // exported for tests
  getPool,
  connectionSettings,
};
