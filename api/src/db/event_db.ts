/**
 * @file The MySQL connection layer.
 *
 * REQUIRED FILE: "Set up a Node.js file, named event_db.js, that connects to
 * your database." (Assessment 2, Part 1 - extended for Assessment 3.)
 *
 * The module is authored in TypeScript and compiles to exactly that name:
 * api/dist/src/db/event_db.js.
 *
 * Responsibilities
 *   1. Create one shared MySQL connection pool for the whole application
 *      (a pool is used instead of a single connection so that concurrent
 *      HTTP requests do not have to wait for each other, and so that a
 *      dropped connection is replaced automatically).
 *   2. Expose a tiny promise-based API (`query`, `transaction`, `ping`,
 *      `close`) built on mysql2/promise, so the rest of the code can use
 *      async/await instead of nested callbacks.
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
 *
 * Typing note
 *   `query()` is deliberately typed as `Promise<any>` and the pool as
 *   `mysql.Pool`. A statement's result is the union mysql2 itself publishes
 *   (a row array for a SELECT, a ResultSetHeader for an INSERT/UPDATE), and the
 *   repository layer narrows that per call site - typing it more tightly here
 *   would mean a cast on every one of the ~30 statements in the repositories,
 *   which is the data-layer concession described in src/types.ts. The pool and
 *   the transaction callback ARE fully typed, which is where the extra safety
 *   actually pays off.
 */
'use strict';

import mysql = require('mysql2/promise');

import env = require('../config/env');
import type { DataRecord } from '../types';

/** The shared pool, created on first use (see getPool). */
let pool: mysql.Pool | null = null;

/**
 * Pooled connections whose session time has already been pinned to DEMO_TODAY.
 *
 * `SET timestamp` is session state, so it has to be applied once per physical
 * connection rather than once per process. The WeakSet lets a connection that is
 * reused from the pool skip the statement without keeping it alive.
 */
const demoPinnedConnections = new WeakSet<object>();

/**
 * The validated DEMO_TODAY pin, or `undefined` when the real date should be used.
 *
 * @returns `YYYY-MM-DD` when the demo date is pinned, otherwise `undefined`.
 */
function demoTodayValue(): string | undefined {
  const value = process.env.DEMO_TODAY;
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  return value;
}

/** The small part of a pooled connection this module needs for the pin. */
interface SessionConnection {
  /** Run a statement on this one connection. */
  query(sql: string, params?: any[]): Promise<unknown>;
}

/**
 * Pin one pooled connection's session time to DEMO_TODAY, once.
 *
 * WHY THIS EXISTS
 *   DEMO_TODAY fixes "today" for the offline demo, but MySQL's derived
 *   upcoming/ongoing/past state and its DATEDIFF() read CURDATE()/NOW(), which
 *   the pin did not reach. The test suite pins the date to 2026-09-28 so the
 *   seed stays comparable, and it runs the same checks against both data
 *   sources; once the real clock moved past the seed's dates, MySQL called the
 *   seed's events "past" while the offline mirror still had them upcoming, and
 *   seven checks that passed offline failed against MySQL. Pinning the session
 *   makes DEMO_TODAY mean the same thing on both paths.
 *
 *   It is opt-in: api/.env leaves DEMO_TODAY unset, so production still answers
 *   the server's real CURDATE(). `SET timestamp` changes only the current
 *   session, so it cannot affect another connection or another user.
 *
 * @param connection - The pooled connection about to run a statement or a transaction.
 * @returns Nothing; the connection is pinned until it is closed.
 */
async function pinDemoToday(connection: SessionConnection): Promise<void> {
  const day = demoTodayValue();
  if (!day || demoPinnedConnections.has(connection)) return;

  // UNIX_TIMESTAMP() is evaluated by the server, so the calendar date is the
  // same date the server would report for CURDATE(), whatever its time zone.
  await connection.query('SET timestamp = UNIX_TIMESTAMP(?)', [day]);
  demoPinnedConnections.add(connection);
}

/** The exact connection settings being used (password never logged). */
const connectionSettings: mysql.PoolOptions = {
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
 *
 * The `error` listener is registered through a narrow local cast because
 * mysql2's own typings list only the pool's lifecycle events.
 *
 * @returns The process-wide pool, creating it on the first call and reusing it afterwards.
 */
function getPool(): mysql.Pool {
  if (pool) return pool;

  pool = mysql.createPool(connectionSettings);

  /**
   * Keep an idle-connection failure from crashing the Node process.
   *
   * A pool level error listener is the documented way to do that: mysql2's own
   * typings only list the pool's lifecycle events ('connection', 'acquire',
   * ...), but the pool is an EventEmitter at run time and 'error' is the event
   * that matters here.
   */
  const emitter = pool as unknown as {
    on(event: string, listener: (error: any) => void): void;
  };
  emitter.on('error', (error) => {
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
 * @param sql - The SQL text, containing "?" placeholders.
 * @param params - The values bound to the placeholders. May be omitted for a statement that takes none.
 * @returns The rows for a SELECT, or the result header for an INSERT or UPDATE.
 */
async function query(sql: string, params: any[] = []): Promise<any> {
  const pool = getPool();

  // Fast path, and the production path: with no DEMO_TODAY there is no session
  // state to apply, so the statement goes through the pool exactly as before.
  if (!demoTodayValue()) {
    const [rows] = await pool.execute(sql, params);
    return rows;
  }

  const connection = await pool.getConnection();
  try {
    await pinDemoToday(connection);
    const [rows] = await connection.execute(sql, params);
    return rows;
  } finally {
    connection.release();
  }
}

/**
 * The connection a transaction callback receives.
 *
 * The statement results are `any` here so that one callback can read either a
 * row array or a ResultSetHeader from the same call - which is exactly what the
 * delete rule does (SELECT the event, SELECT the registration count, then
 * DELETE). See the typing note at the top of this file.
 */
interface TransactionConnection {
  /** Run a prepared statement and return its `[result, fields]` pair. */
  execute(sql: string, params?: any[]): Promise<[any, any[]]>;
  /** Run a statement through the connection's query interface. */
  query(sql: string, params?: any[]): Promise<[any, any[]]>;
}

/**
 * Run `work` inside a database transaction.
 *
 * The connection is always released, and the transaction is rolled back if
 * `work` throws, so a failed write can never leave half-applied data behind.
 * Used by the event delete rule, which must decide and act as one unit.
 *
 * @param work - The callback that does the work, given the connection to run on.
 * @returns Whatever `work` returned, once the transaction has committed.
 * @throws Whatever `work` threw, after the rollback has been attempted, so the caller sees the original failure.
 */
async function transaction<T>(
  work: (connection: TransactionConnection) => Promise<T>
): Promise<T> {
  const connection = await getPool().getConnection();
  try {
    // The transaction must see the same DEMO_TODAY "today" as every other
    // statement, because the timestamps it writes and the dates it compares
    // both come from the session clock.
    await pinDemoToday(connection);
    await connection.beginTransaction();
    // The cast is the one place the statement result is widened to `any`; see
    // TransactionConnection above.
    const result = await work(connection as unknown as TransactionConnection);
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
 *
 * Used by GET /api/health so a marker can confirm the setup in one click, and by
 * the start-up banner. It deliberately never throws: an unreachable database is
 * reported as `connected: false` with the driver's code and a hint, because a
 * health check that fails is less useful than one that explains the failure. A3
 * reports `registrationTable` as well, so the marker can see at a glance whether
 * the new event_registrations table was created by 01_schema.sql.
 *
 * @returns A report of the connection, the server version, the table count, and
 *   the failure details when the database could not be reached.
 */
async function ping(): Promise<DataRecord> {
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

/**
 * Close the pool, used on shutdown and after the test suite.
 *
 * The module-level handle is cleared before awaiting `end()`, so a second call
 * (or a `query()` racing the shutdown) creates a fresh pool instead of using one
 * that is closing.
 */
async function close(): Promise<void> {
  if (!pool) return;
  const closing = pool;
  pool = null;
  await closing.end();
}

/**
 * Expose the settings for diagnostics.
 *
 * The password is deliberately omitted, so this can be logged or returned by a
 * health endpoint without leaking credentials.
 *
 * @returns The host, port, user, database and connection limit in use.
 */
function describe(): DataRecord {
  return {
    host: connectionSettings.host,
    port: connectionSettings.port,
    user: connectionSettings.user,
    database: connectionSettings.database,
    connectionLimit: connectionSettings.connectionLimit,
  };
}

/**
 * The module's public surface.
 *
 * The first group is the API the repositories and the server use; the second is
 * exported so the test suite can inspect the pool and the exact connection
 * settings without rebuilding them.
 */
export = {
  // main API
  query,
  transaction,
  ping,
  close,
  describe,
  // exported for tests
  getPool,
};
