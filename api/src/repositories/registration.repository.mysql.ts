/**
 * @file The registration writes for the event_registrations table.
 *
 * Part 2 of Assessment 3.
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
 * registration.repository.local.ts)
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

import db = require('../db/event_db');
import type { RegistrationWriteRepository } from '../types';
import { HttpError } from '../utils/errors';
import mysqlRepository = require('./repository.mysql');

const q = db;

/**
 * Lower-case and trim an email so the unique key behaves as users expect.
 *
 * @param email - The address as submitted, in any casing or with surrounding spaces.
 * @returns The comparable form of the address, or an empty string when nothing was supplied.
 */
function normaliseEmail(email: unknown): string {
  return String(email || '').trim().toLowerCase();
}

/**
 * Look up an event's name.
 *
 * The name is needed for the "already registered" message, so the existence check
 * and the message text come from one query rather than two.
 *
 * @param eventId - The event to look up.
 * @returns The event's name, or `null` when no event has that id.
 */
async function findEventName(eventId: number) {
  const rows = await q.query('SELECT event_name AS eventName FROM events WHERE event_id = ?', [
    eventId,
  ]);
  return rows.length > 0 ? rows[0].eventName : null;
}

/**
 * Test whether a ticket tier is offered by an event.
 *
 * A tier id that was not supplied passes, because the column is optional; a tier
 * belonging to a different event is refused here as well as by the composite
 * foreign key fk_registration_ticket, so the client gets a readable 400 rather
 * than a driver error.
 *
 * @param ticketTypeId - The tier id, which may be null or undefined for a registration without a tier.
 * @param eventId - The event the registration belongs to.
 * @returns `true` when the tier belongs to that event, or when none was supplied.
 */
async function ticketBelongsToEvent(ticketTypeId: number, eventId: number) {
  if (ticketTypeId === null || ticketTypeId === undefined) return true;
  const rows = await q.query(
    `SELECT ticket_type_id
       FROM ticket_types
      WHERE ticket_type_id = ? AND event_id = ?`,
    [ticketTypeId, eventId]
  );
  return rows.length > 0;
}

/**
 * The MySQL registration write half of the repository contract.
 *
 * It is checked against `RegistrationWriteRepository` at compile time, and
 * registration.repository.local.ts enforces the same rules against the in-memory
 * store, so the two data sources answer identically.
 */
const registrationRepository: RegistrationWriteRepository = {
  /**
   * Insert one registration for an event.
   *
   * Three rules are applied in order: the event must exist, a supplied tier must
   * belong to it, and the email must not already be registered for it. The
   * database is still the final authority - the unique key and the foreign keys
   * can refuse the insert if two requests race past the checks - so the driver
   * codes are translated into the same 400 and 409 rather than surfacing as a
   * 500. `registered_at` is only included when the caller supplied one, so the
   * column default records the moment of submission otherwise.
   *
   * @param eventId - The event being registered for.
   * @param values - The validated registration values in camelCase.
   * @returns The stored registration, read back in the API shape, or `null` when the event does not exist.
   * @throws HttpError with status 400 when the tier or the values are refused by the database, and 409 when that email is already registered for the event.
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
      const code = error.code || (error.errors || []).find((item: any) => item && item.code)?.code;
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
   * Update one registration as a partial update.
   *
   * Only the fields present in the payload are changed. Swapping the tier is
   * checked against the registration's own event, and the email is normalised
   * before it is written, so the unique key still means what it meant on insert;
   * ER_DUP_ENTRY is translated so a collision is a 409 rather than a 500.
   *
   * @param registrationId - The id of the registration to change.
   * @param values - The validated fields to change, in camelCase.
   * @returns The updated registration, read back in the API shape, or `null` when no row has that id.
   * @throws HttpError with status 400 when the tier belongs to another event or a value is refused by the database, and 409 when the new email is already registered for that event.
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
        const code = error.code || (error.errors || []).find((item: any) => item && item.code)?.code;
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
   * Remove one registration.
   *
   * `affectedRows` is what distinguishes a delete from a delete that matched
   * nothing, which is how the service decides between 204 and 404.
   *
   * @param registrationId - The id of the registration to remove.
   * @returns `true` when a row was removed, `false` when no row had that id.
   */
  async deleteRegistration(registrationId) {
    const result = await q.query(
      'DELETE FROM event_registrations WHERE registration_id = ?',
      [registrationId]
    );
    return Number(result.affectedRows) > 0;
  },
};

/**
 * The write repository plus the helper the tests exercise.
 *
 * One export: the helper the original attached to module.exports afterwards rides
 * along on the same object, so `require('./registration.repository.mysql')` is
 * still the object src/repositories/index.ts binds onto the merged repository.
 */
export = Object.assign(registrationRepository, { normaliseEmail });
