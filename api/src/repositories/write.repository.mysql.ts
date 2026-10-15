/**
 * @file The WRITE half of the MySQL data source (Assessment 3, Part 2).
 *
 *
 *   insertEvent()  POST   /api/events
 *   updateEvent()  PUT    /api/events/:id
 *   deleteEvent()  DELETE /api/events/:id
 *
 * The read half stays in repository.mysql.ts. Splitting the two keeps each file
 * about one thing, and it makes the two data sources easy to compare:
 * write.repository.local.ts must expose exactly the same three methods.
 *
 * Data integrity rules implemented here
 *   * An event can only be deleted when it has no registrations. The check and
 *     the delete run inside ONE transaction (event_db.transaction), so a
 *     registration cannot slip in between them.
 *   * MySQL is the last line of defence: the foreign key
 *     fk_registration_event is ON DELETE RESTRICT, so the DELETE would be
 *     refused even if this check were removed. The mysql error code
 *     ER_ROW_IS_REFERENCED_2 is translated into the same 409 the check emits.
 *   * A foreign key value that does not exist (organisation, category, venue,
 *     ticket tier) is refused by the database and translated into a clear 400,
 *     so a typo in the admin form never becomes a 500.
 */
'use strict';

import db = require('../db/event_db');
import type { DataRecord, EventWriteRepository } from '../types';
import { HttpError } from '../utils/errors';
import mysqlRepository = require('./repository.mysql');

const q = db;

/**
 * The connection a transaction callback receives.
 *
 * Derived from event_db.transaction() rather than written out again, so this
 * file cannot end up describing an older version of that contract than the one
 * it is calling.
 */
type TransactionConnection = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Map the camelCase keys of a validated payload onto database columns.
 *
 * Only the keys that are actually present are emitted, which is what makes an
 * update partial: an absent key means "leave this column alone" rather than
 * "write its default". The mapping is explicit rather than derived from the key
 * name so that the API's vocabulary and the schema's cannot drift apart silently.
 *
 * The mapping is also the whole list of columns an administrator may set, in
 * table order: nothing outside it can be written, so a request cannot set a
 * column the form does not offer - an id, a timestamp or a computed column.
 *
 * @param values - The validated values from the write service.
 * @returns The column names to write and the values to bind to them, in matching order.
 */
function toColumns(values: DataRecord): { columns: string[]; params: any[] } {
  const mapping = {
    organizationId: 'organization_id',
    categoryId: 'category_id',
    locationId: 'location_id',
    eventName: 'event_name',
    shortDescription: 'short_description',
    description: 'description',
    purpose: 'purpose',
    eventDate: 'event_date',
    startTime: 'start_time',
    endTime: 'end_time',
    dateStart: 'date_start',
    dateEnd: 'date_end',
    goalAmount: 'goal_amount',
    isFree: 'is_free',
    capacity: 'capacity',
    status: 'status',
    imageUrl: 'image_url',
  };

  const columns = [];
  const params: any[] = [];

  for (const [key, column] of Object.entries(mapping)) {
    if (values[key] === undefined) continue;
    columns.push(column);
    // mysql2 cannot bind a boolean to a TINYINT column with execute(), so the
    // value is converted to 0/1 here rather than at the call site.
    params.push(typeof values[key] === 'boolean' ? Number(values[key]) : values[key]);
  }

  return { columns, params };
}

/**
 * Turn a mysql2 driver error into the HTTP error the client should see.
 *
 * Only the cases a member of staff can actually cause are translated; anything
 * else is re-thrown and becomes a 500 with a stack trace in development. The
 * `context` object carries the names the message needs (an event name, a
 * registration count) because the driver error alone does not know them.
 *
 * @param error - The value the driver rejected with, in any shape it uses.
 * @param context - Extra facts for the message, such as the event name or the registration count. May be omitted.
 * @returns The matching HttpError, or `null` when the code is not one this layer explains.
 */
function translateMysqlError(error: any, context: DataRecord = {}) {
  const code = error.code || (error.errors || []).find((item: any) => item && item.code)?.code;

  switch (code) {
    case 'ER_ROW_IS_REFERENCED_2':
      return HttpError.conflict(
        `"${context.eventName || 'This event'}" still has registrations, so it cannot be deleted. ` +
          'Remove the registrations first, or suspend the event instead of deleting it.',
        { code, registrations: context.registrationCount }
      );

    case 'ER_DUP_ENTRY':
      return HttpError.conflict(
        'A record with these details already exists.',
        { code, sqlMessage: error.sqlMessage }
      );

    case 'ER_NO_REFERENCED_ROW_2':
      return HttpError.badRequest(
        'One of the selected values (organisation, category or venue) does not exist.',
        { code, sqlMessage: error.sqlMessage }
      );

    case 'ER_ROW_IS_REFERENCED':
      return HttpError.conflict('This record is still referenced by other data.', {
        code,
      });

    case 'ER_CHECK_CONSTRAINT_VIOLATED':
      return HttpError.badRequest(
        'The database rejected the values: check that the end date is not before the start ' +
          'date, that the end time is after the start time, and that the goal is not negative.',
        { code, sqlMessage: error.sqlMessage }
      );

    case 'ER_DATA_TOO_LONG':
      return HttpError.badRequest(
        'One of the text values is longer than the column allows.',
        { code, sqlMessage: error.sqlMessage }
      );

    case 'ER_BAD_NULL_ERROR':
      return HttpError.badRequest('A required field was empty.', {
        code,
        sqlMessage: error.sqlMessage,
      });

    default:
      return null;
  }
}

/**
 * Re-read the row that was just written, through the admin view.
 *
 * That is what makes the API return the same shape for a create or an update as
 * it does for a read.
 *
 * The read half is reused rather than the inserted values being echoed back:
 * that is what makes a create return the database's own defaults, constraints
 * and derived figures instead of what the client hoped it had written.
 *
 * @param eventId - The id of the event to read back.
 * @returns The event as the admin view returns it, with its ticket tiers.
 */
async function readBack(eventId: number) {
  return mysqlRepository.findEventById(eventId, { status: 'all' });
}

/**
 * The MySQL write half of the repository contract.
 *
 * It is checked against `EventWriteRepository` at compile time, and
 * write.repository.local.ts must expose exactly the same four methods so the two
 * data sources stay interchangeable.
 */
const writeRepository: EventWriteRepository = {
  /**
   * Insert one event and return it as the API will report it.
   *
   * The admin form may send ticket tiers in the same request; when it does, the
   * event row and every tier are written inside ONE transaction, so a tier the
   * database refuses takes the event down with it. That is not decoration: two
   * tiers of one event that share a name are rejected by uq_ticket_event_name
   * with ER_DUP_ENTRY, and the earlier code inserted the event on the pool and
   * then opened a second transaction for the tiers - so the 409 it answered left
   * a committed event with no tiers behind, and a retry created a second one.
   * One transaction makes the 409 true. The row is read back after the commit,
   * through the admin view, so the response carries the database's own values.
   *
   * @param values - The validated event values in camelCase.
   * @returns The created event, read back through the admin view with its ticket tiers included.
   * @throws HttpError with status 400 when no fields were supplied or a chosen reference does not exist, and 409 when a record with those details already exists.
   */
  async insertEvent(values) {
    const { columns, params } = toColumns(values);
    if (columns.length === 0) {
      throw HttpError.badRequest('No event fields were supplied.');
    }

    const placeholders = columns.map(() => '?').join(', ');

    try {
      const eventId = await db.transaction(async (connection) => {
        const [result] = await connection.execute(
          `INSERT INTO events (${columns.join(', ')}) VALUES (${placeholders})`,
          params
        );
        const id = Number(result.insertId);

        // The tiers ride in the same transaction as the event row, which is what
        // the JSDoc above has always claimed and what the atomicity rule needs:
        // a duplicate tier name rolls the event back instead of stranding it.
        if (Array.isArray(values.ticketTypes) && values.ticketTypes.length > 0) {
          await insertTicketTypes(connection, id, values.ticketTypes);
        }

        return id;
      });

      // The row was inserted a moment ago, so the read-back can never be null.
      return (await readBack(eventId)) as DataRecord;
    } catch (error) {
      const translated = translateMysqlError(error);
      if (translated) throw translated;
      throw error;
    }
  },

  /**
   * Update one event as a partial update.
   *
   * Only the fields present in the request body are changed, so the admin form can
   * send the whole object while a future caller can send a single field. The
   * existence check runs first, because an UPDATE that matches nothing is a
   * success as far as the driver is concerned and would otherwise be reported as
   * an update that did not happen.
   *
   * @param eventId - The id of the event to change.
   * @param values - The validated fields to change, in camelCase.
   * @returns The updated event, read back through the admin view, or `null` when no event has that id.
   * @throws HttpError with status 400 when a value is refused by the database and 409 when it collides with an existing record.
   */
  async updateEvent(eventId, values) {
    // Confirm the event exists first so a missing id is a clean 404 rather than
    // an UPDATE that silently changes nothing.
    const existing = await q.query(
      'SELECT event_id FROM events WHERE event_id = ?',
      [eventId]
    );
    if (existing.length === 0) return null;

    const { columns, params } = toColumns(values);

    if (columns.length > 0) {
      const assignments = columns.map((column: string) => `${column} = ?`).join(', ');
      try {
        await q.query(
          `UPDATE events SET ${assignments} WHERE event_id = ?`,
          [...params, eventId]
        );
      } catch (error) {
        const translated = translateMysqlError(error);
        if (translated) throw translated;
        throw error;
      }
    }

    if (Array.isArray(values.ticketTypes)) {
      await replaceTicketTypes(eventId, values.ticketTypes);
    }

    return readBack(eventId);
  },

  /**
   * Delete one event, refusing when it already has registrations.
   *
   * The existence check, the registration count and the DELETE all run inside ONE
   * transaction (event_db.transaction), which is the whole point of the design: a
   * registration created between the check and the DELETE would otherwise be
   * orphaned or silently destroyed. `SELECT ... FOR UPDATE` locks the event row
   * for the same reason, so two concurrent deletes cannot both see it as present.
   * MySQL remains the last line of defence, because
   * fk_registration_event is ON DELETE RESTRICT and its
   * ER_ROW_IS_REFERENCED_2 is translated into the same 409 this check emits.
   * Child rows that are allowed to disappear with the event (ticket_types,
   * donations) are removed by ON DELETE CASCADE.
   *
   * @param eventId - The id of the event to delete.
   * @returns The outcome: `deleted: true` with the event name, or `deleted: false` with the reason `not-found` or `has-registrations` and the blocking count.
   */
  async deleteEvent(eventId) {
    return db.transaction(async (connection) => {
      // 1. Does the event exist? Lock the row so two deletes cannot race.
      const [rows] = await connection.execute(
        'SELECT event_id, event_name FROM events WHERE event_id = ? FOR UPDATE',
        [eventId]
      );
      if (rows.length === 0) {
        return { deleted: false, reason: 'not-found' };
      }

      // 2. Does it have registrations? This is the rule from the brief.
      const [counts] = await connection.execute(
        'SELECT COUNT(*) AS total FROM event_registrations WHERE event_id = ?',
        [eventId]
      );
      const registrationCount = counts[0] ? Number(counts[0].total) : 0;

      if (registrationCount > 0) {
        // Nothing was written, so the transaction simply ends.
        return {
          deleted: false,
          reason: 'has-registrations',
          eventName: rows[0].event_name,
          registrationCount,
        };
      }

      // 3. Safe to delete. The child rows that are allowed to disappear with
      //    the event (ticket_types, donations) are removed by ON DELETE CASCADE.
      await connection.execute('DELETE FROM events WHERE event_id = ?', [eventId]);
      return { deleted: true, eventName: rows[0].event_name };
    });
  },

  /**
   * Add ticket tiers when the admin form supplies them.
   *
   * A thin wrapper around the module-level function below, which is what
   * updateEvent() calls directly; a create does not come through it, because the
   * tiers of a new event are written inside the create's own transaction so that
   * a refused tier takes the event with it.
   *
   * Why the separation matters, recorded because it cost an afternoon: this was
   * originally an inline method, and insertEvent() referenced it as a bare
   * identifier - `await replaceTicketTypes(...)`. That is not the method, so every
   * create or update carrying ticket tiers threw
   * "ReferenceError: replaceTicketTypes is not defined" and answered 500.
   *
   * The defect survived the whole offline test suite, and that is the lesson
   * worth keeping: the offline repository implements this step differently, so
   * those tests never executed this file at all. A bug can hide behind a
   * same-shaped twin. Only loading database/charityevents_db.sql and running the
   * suite with TEST_DATA_SOURCE=mysql exercises this path.
   */
  async replaceTicketTypes(eventId, ticketTypes) {
    return replaceTicketTypes(eventId, ticketTypes);
  },
};

/**
 * Insert the tiers of an event on a connection a transaction already owns.
 *
 * The statements run on the caller's connection rather than on the pool, which
 * is the whole point: they are part of the caller's transaction, so a tier the
 * database refuses - a second tier with a name the event already uses, which
 * uq_ticket_event_name rejects - rolls back everything the transaction has
 * written so far. Nothing is caught here; the caller decides whether the failure
 * means "the create failed" (insertEvent, where the event must not survive) or
 * "the tiers were not saved" (replaceTicketTypes, where it must).
 *
 * @param connection - The connection the surrounding transaction is using.
 * @param eventId - The event the tiers belong to.
 * @param ticketTypes - The validated tiers to insert, each with a name, a price and optional quantity and description.
 */
async function insertTicketTypes(
  connection: TransactionConnection,
  eventId: number,
  ticketTypes: DataRecord[]
): Promise<void> {
  for (const ticket of ticketTypes) {
    // eslint-disable-next-line no-await-in-loop
    await connection.execute(
      `INSERT INTO ticket_types
         (event_id, ticket_name, price, quantity_available, description)
       VALUES (?, ?, ?, ?, ?)`,
      [
        eventId,
        ticket.ticketName,
        ticket.price,
        ticket.quantityAvailable === undefined ? null : ticket.quantityAvailable,
        ticket.description === undefined ? null : ticket.description,
      ]
    );
  }
}

/**
 * Add the tiers for an event, unless it already has some.
 *
 * This is the published `replaceTicketTypes` contract and the path updateEvent()
 * uses, so it keeps its own transaction: the existence check and the inserts are
 * one unit, and a failure half way through cannot leave an event with one of its
 * three tiers. A failure is logged and swallowed rather than rethrown, because
 * here the event itself has already been saved and losing the tiers is not a
 * reason to tell the client the update failed; a driver error that this layer
 * can explain (an unknown reference, a value the column refuses, a duplicate
 * tier name) is still raised as an HttpError, which is the same answer the
 * offline twin gives. insertEvent() deliberately does NOT come through here: a
 * create must fail as a whole, so it calls insertTicketTypes() inside its own
 * transaction instead.
 *
 * The "unless it already has some" guard is what makes this the same call in
 * both data sources; write.repository.local.ts now returns early for an event
 * that already has tiers too, where it used to append a second set.
 *
 * @param eventId - The event the tiers belong to.
 * @param ticketTypes - The validated tiers to insert, each with a name, a price and optional quantity and description.
 */
async function replaceTicketTypes(eventId: number, ticketTypes: DataRecord[]) {
  try {
    await db.transaction(async (connection) => {
      const [existing] = await connection.execute(
        'SELECT COUNT(*) AS total FROM ticket_types WHERE event_id = ?',
        [eventId]
      );
      if (existing[0] && Number(existing[0].total) > 0) return;

      await insertTicketTypes(connection, eventId, ticketTypes);
    });
  } catch (error) {
    const translated = translateMysqlError(error);
    if (translated) throw translated;
    // A ticket tier problem must not hide the fact that the event was saved.
    console.warn('[events] ticket tiers were not saved:', error.message);
  }
}

/**
 * The write repository plus the helpers the tests exercise.
 *
 * One export: the helpers the original attached to module.exports afterwards ride
 * along on the same object, so `require('./write.repository.mysql')` is still the
 * object src/repositories/index.ts binds onto the read half.
 */
export = Object.assign(writeRepository, {
  translateMysqlError,
  toColumns,
  replaceTicketTypes,
  insertTicketTypes,
});
