/**
 * src/repositories/registration.repository.mysql.js
 * ---------------------------------------------------------------------------
 * Assessment 3, Part 2 - writes for the event_registrations table.
 *
 * The brief says endpoints for registration are optional, but the client
 * website needs one: the registration page cannot submit a new record without
 * it. So this file provides the full set:
 *
 *   insertRegistration()  POST   /api/events/:id/registrations
 *   updateRegistration()  PUT    /api/registrations/:id
 *   deleteRegistration()  DELETE /api/registrations/:id
 *
 * Business rules enforced here (and mirrored one-to-one in
 * registration.repository.local.js)
 *   * The event must exist. A registration for a missing event is a 404, not a
 *     foreign key crash.
 *   * One user may register for an event ONCE (Part 1 requirement). The
 *     database enforces it with uq_registration_event_email; this layer checks
 *     first so the caller gets a readable 409 instead of a raw driver error,
 *     and still translates ER_DUP_ENTRY in case of a race between the two.
 *   * Email addresses are stored lower-cased and trimmed, so
 *     "Ann@Example.com " and "ann@example.com" are correctly recognised as the
 *     same person by the unique key.
 *   * A ticket tier, when one is supplied, must belong to the same event.
 *   * "The date of registration" may be supplied by the caller; when it is not,
 *     the database default (CURRENT_TIMESTAMP) records the moment of
 *     submission.
 */
'use strict';

const db = require('../db/event_db');
const { HttpError } = require('../utils/errors');
const mysqlRepository = require('./repository.mysql');

const q = db;

/** Lower-case and trim an email so the unique key behaves as users expect. */
function normaliseEmail(email) {
  return String(email || '').trim().toLowerCase();
}

/** Does the event exist? Returns its name, or null. */
async function findEventName(eventId) {
  const rows = await q.query('SELECT event_name AS eventName FROM events WHERE event_id = ?', [
    eventId,
  ]);
  return rows.length > 0 ? rows[0].eventName : null;
}

/** Is the ticket tier valid for this event? */
async function ticketBelongsToEvent(ticketTypeId, eventId) {
  if (ticketTypeId === null || ticketTypeId === undefined) return true;
  const rows = await q.query(
    `SELECT ticket_type_id
       FROM ticket_types
      WHERE ticket_type_id = ? AND event_id = ?`,
    [ticketTypeId, eventId]
  );
  return rows.length > 0;
}

const registrationRepository = {
  /**
   * POST /api/events/:id/registrations
   *
   * @param {number} eventId
   * @param {object} values validated payload from registrationService
   * @returns {Promise<object>} the stored registration, fully decorated
   */
  async insertRegistration(eventId, values) {
    // 1. The event must exist.
    const eventName = await findEventName(eventId);
    if (!eventName) return null;

    // 2. The chosen tier must belong to that event.
    const ticketTypeId =
      values.ticketTypeId === undefined ? null : values.ticketTypeId;
    if (!(await ticketBelongsToEvent(ticketTypeId, eventId))) {
      throw HttpError.badRequest(
        `Ticket type ${ticketTypeId} does not belong to event ${eventId}.`,
        [{ field: 'ticketTypeId', message: 'Choose a ticket type offered by this event.' }]
      );
    }

    const email = normaliseEmail(values.attendeeEmail);

    // 3. One registration per user per event.
    if (await mysqlRepository.registrationQueries.existsForEventAndEmail(eventId, email)) {
      throw HttpError.conflict(
        `${email} has already registered for "${eventName}". Each person may register for an event once.`,
        {
          field: 'attendeeEmail',
          eventId,
          attendeeEmail: email,
          hint: 'Use the event detail page to see the existing registration.',
        }
      );
    }

    const columns = [
      'event_id',
      'ticket_type_id',
      'attendee_name',
      'attendee_email',
      'attendee_phone',
      'tickets_purchased',
      'notes',
    ];
    const params = [
      eventId,
      ticketTypeId,
      values.attendeeName,
      email,
      values.attendeePhone === undefined ? null : values.attendeePhone,
      values.ticketsPurchased === undefined ? 1 : values.ticketsPurchased,
      values.notes === undefined ? null : values.notes,
    ];

    // registered_at is only set when the caller supplied one, so the column
    // default (the moment of submission) is used otherwise.
    if (values.registeredAt) {
      columns.push('registered_at');
      params.push(values.registeredAt);
    }

    const placeholders = columns.map(() => '?').join(', ');

    let insertId;
    try {
      const result = await q.query(
        `INSERT INTO event_registrations (${columns.join(', ')}) VALUES (${placeholders})`,
        params
      );
      insertId = Number(result.insertId);
    } catch (error) {
      const code = error.code || (error.errors || []).find((item) => item && item.code)?.code;
      if (code === 'ER_DUP_ENTRY') {
        // Someone registered with the same email for the same event in the
        // fraction of a second since the check above.
        throw HttpError.conflict(
          `${email} has already registered for "${eventName}".`,
          { field: 'attendeeEmail', eventId, attendeeEmail: email }
        );
      }
      if (code === 'ER_NO_REFERENCED_ROW_2') {
        throw HttpError.badRequest(
          'The event or ticket type does not exist.',
          { code, sqlMessage: error.sqlMessage }
        );
      }
      if (code === 'ER_CHECK_CONSTRAINT_VIOLATED') {
        throw HttpError.badRequest(
          'The registration was rejected: check the email address and that at least one ticket is requested.',
          { code, sqlMessage: error.sqlMessage }
        );
      }
      throw error;
    }

    return mysqlRepository.registrationQueries.findById(insertId);
  },

  /**
   * PUT /api/registrations/:id - partial update of a registration.
   * @returns {Promise<object|null>} the updated row, or null when not found
   */
  async updateRegistration(registrationId, values) {
    const existing = await mysqlRepository.registrationQueries.findById(registrationId);
    if (!existing) return null;

    const mapping = {
      ticketTypeId: 'ticket_type_id',
      attendeeName: 'attendee_name',
      attendeeEmail: 'attendee_email',
      attendeePhone: 'attendee_phone',
      ticketsPurchased: 'tickets_purchased',
      notes: 'notes',
      registeredAt: 'registered_at',
    };

    const columns = [];
    const params = [];

    for (const [key, column] of Object.entries(mapping)) {
      if (values[key] === undefined) continue;

      let value = values[key];
      if (key === 'attendeeEmail') value = normaliseEmail(value);

      if (key === 'ticketTypeId') {
        // A tier can only be swapped for one that belongs to the same event.
        const allowed = await ticketBelongsToEvent(value, existing.eventId);
        if (!allowed) {
          throw HttpError.badRequest(
            `Ticket type ${value} does not belong to event ${existing.eventId}.`,
            [{ field: 'ticketTypeId', message: 'Choose a ticket type offered by this event.' }]
          );
        }
      }

      columns.push(column);
      params.push(value === null ? null : value);
    }

    if (columns.length > 0) {
      const assignments = columns.map((column) => `${column} = ?`).join(', ');
      try {
        await q.query(
          `UPDATE event_registrations SET ${assignments} WHERE registration_id = ?`,
          [...params, registrationId]
        );
      } catch (error) {
        const code = error.code || (error.errors || []).find((item) => item && item.code)?.code;
        if (code === 'ER_DUP_ENTRY') {
          throw HttpError.conflict(
            'That email is already registered for this event.',
            { field: 'attendeeEmail', registrationId }
          );
        }
        if (code === 'ER_CHECK_CONSTRAINT_VIOLATED') {
          throw HttpError.badRequest(
            'The update was rejected: check the email address and that at least one ticket is requested.',
            { code, sqlMessage: error.sqlMessage }
          );
        }
        throw error;
      }
    }

    return mysqlRepository.registrationQueries.findById(registrationId);
  },

  /**
   * DELETE /api/registrations/:id
   * @returns {Promise<boolean>} true when a row was removed
   */
  async deleteRegistration(registrationId) {
    const result = await q.query(
      'DELETE FROM event_registrations WHERE registration_id = ?',
      [registrationId]
    );
    return Number(result.affectedRows) > 0;
  },
};

module.exports = registrationRepository;
module.exports.normaliseEmail = normaliseEmail;
