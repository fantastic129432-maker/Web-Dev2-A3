/**
 * src/repositories/write.repository.mysql.js
 * ---------------------------------------------------------------------------
 * Assessment 3, Part 2 - the WRITE half of the MySQL data source:
 *
 *   insertEvent()  POST   /api/events
 *   updateEvent()  PUT    /api/events/:id
 *   deleteEvent()  DELETE /api/events/:id
 *
 * The read half stays in repository.mysql.js. Splitting the two keeps each file
 * about one thing, and it makes the two data sources easy to compare:
 * write.repository.local.js must expose exactly the same three methods.
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

const db = require('../db/event_db');
const { HttpError } = require('../utils/errors');
const mysqlRepository = require('./repository.mysql');

const q = db;

/** The columns an administrator may set, in table order. */
const WRITABLE_COLUMNS = [
  'organization_id',
  'category_id',
  'location_id',
  'event_name',
  'short_description',
  'description',
  'purpose',
  'event_date',
  'start_time',
  'end_time',
  'date_start',
  'date_end',
  'goal_amount',
  'is_free',
  'capacity',
  'status',
  'image_url',
];

/** Map the camelCase keys of a validated payload onto database columns. */
function toColumns(values) {
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
  const params = [];

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
 * else is re-thrown and becomes a 500 with a stack trace in development.
 */
function translateMysqlError(error, context = {}) {
  const code = error.code || (error.errors || []).find((item) => item && item.code)?.code;

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
 * Re-read the row that was just written, through the admin view, so the API
 * returns the same shape for a create/update as it does for a read.
 */
async function readBack(eventId) {
  return mysqlRepository.findEventById(eventId, { status: 'all' });
}

const writeRepository = {
  /**
   * POST /api/events
   * @param {object} values validated payload from eventService
   * @returns {Promise<object>} the created event, with ticket types included
   */
  async insertEvent(values) {
    const { columns, params } = toColumns(values);
    if (columns.length === 0) {
      throw HttpError.badRequest('No event fields were supplied.');
    }

    const placeholders = columns.map(() => '?').join(', ');
    let result;
    try {
      result = await q.query(
        `INSERT INTO events (${columns.join(', ')}) VALUES (${placeholders})`,
        params
      );
    } catch (error) {
      const translated = translateMysqlError(error);
      if (translated) throw translated;
      throw error;
    }

    const eventId = Number(result.insertId);

    // The admin form may send ticket tiers in the same request; if it does, the
    // event and its tiers are written as one unit.
    if (Array.isArray(values.ticketTypes) && values.ticketTypes.length > 0) {
      await replaceTicketTypes(eventId, values.ticketTypes);
    }

    return readBack(eventId);
  },

  /**
   * PUT /api/events/:id - a partial update: only the fields present in the
   * request body are changed, so the admin form can send the whole object and
   * a future caller can send a single field.
   *
   * @returns {Promise<object|null>} the updated event, or null when no event has that id
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
      const assignments = columns.map((column) => `${column} = ?`).join(', ');
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
   * DELETE /api/events/:id
   *
   * Refuses to delete an event that already has registrations, which is the
   * data-integrity rule the brief asks for.
   *
   * @returns {Promise<{deleted:boolean, reason?:string}>}
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

  /** Does this (event, email) pair already exist? Used for a friendly message. */
  async registrationExists(eventId, email) {
    return mysqlRepository.registrationQueries.existsForEventAndEmail(eventId, email);
  },

  /** How many registrations an event has. */
  async countRegistrations(eventId) {
    return mysqlRepository.registrationQueries.countByEventId(eventId);
  },

  /**
   * Add ticket tiers when the admin form supplies them.
   *
   * A thin wrapper around the module-level function below, which is what
   * insertEvent() and updateEvent() call directly.
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
 * Insert the tiers for an event, unless it already has some.
 *
 * @param {number} eventId
 * @param {Array<{ticketName:string, price:number, quantityAvailable?:number|null,
 *                description?:string|null}>} ticketTypes
 */
async function replaceTicketTypes(eventId, ticketTypes) {
  try {
    await db.transaction(async (connection) => {
      const [existing] = await connection.execute(
        'SELECT COUNT(*) AS total FROM ticket_types WHERE event_id = ?',
        [eventId]
      );
      if (existing[0] && Number(existing[0].total) > 0) return;

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
    });
  } catch (error) {
    const translated = translateMysqlError(error);
    if (translated) throw translated;
    // A ticket tier problem must not hide the fact that the event was saved.
    console.warn('[events] ticket tiers were not saved:', error.message);
  }
}

module.exports = writeRepository;
module.exports.translateMysqlError = translateMysqlError;
module.exports.toColumns = toColumns;
module.exports.replaceTicketTypes = replaceTicketTypes;
module.exports.WRITABLE_COLUMNS = WRITABLE_COLUMNS;
