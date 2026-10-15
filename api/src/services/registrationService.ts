/**
 * @file The business rules behind event registration.
 *
 * Registration is the feature Assessment 3 adds to the client website.
 *
 *   createRegistration()  POST   /api/events/:id/registrations
 *   updateRegistration()  PUT    /api/registrations/:id
 *   deleteRegistration()  DELETE /api/registrations/:id
 *   listRegistrations()   GET    /api/registrations            (admin, optional)
 *   listForEvent()        GET    /api/events/:id/registrations
 *
 * The rules that matter for marking
 *   1. "One user may register for multiple events and can only register for an
 *      event once." Enforced by the unique key
 *      uq_registration_event_email (event_id, attendee_email) in Part 1, and
 *      reported as a 409 with a readable message here.
 *   2. Email addresses are compared case-insensitively and trimmed, so
 *      "Ann@Example.com " is recognised as the same person as
 *      "ann@example.com". Without this the unique key would not do its job,
 *      because MySQL's default collation is case-insensitive but a trailing
 *      space is a different string.
 *   3. The number of tickets must be a whole number of at least 1, and cannot
 *      exceed the remaining allocation of the chosen tier when the tier
 *      publishes a quantity. The same rule runs on an update, where the row's
 *      own tickets count as already accounted for - otherwise raising a
 *      quantity could oversell a tier that a create would have refused.
 *   4. The optional ticket type must belong to the same event, which the
 *      composite foreign key fk_registration_ticket also enforces.
 *   5. "The date of registration" may be supplied; when it is not, the moment
 *      of submission is used (the DATETIME column default).
 */
'use strict';

import repository = require('../repositories');
import type { DataRecord, UntrustedInput, ValidationIssue } from '../types';
import { HttpError } from '../utils/errors';
import {
  assertTicketsRemain,
  soldForTier,
} from '../repositories/ticket-allocation';
const {
  requiredDate,
  requiredText,
  requiredNumber,
  requiredId,
  requiredEmail,
  throwIfInvalid,
  parseInteger,
} = require('../utils/validators') as typeof import('../utils/validators');

/** The largest number of tickets one registration may buy. */
const MAX_TICKETS_PER_REGISTRATION = 20;

/**
 * Lower-case and trim an email address.
 *
 * This is the one place that decides what "the same email" means, which is what
 * makes the uniqueness check and the database's unique key agree with each other.
 *
 * @param email - The address as submitted, in any casing or with surrounding spaces.
 * @returns The comparable form of the address, or an empty string when nothing was supplied.
 */
function normaliseEmail(email: unknown): string {
  return String(email || '').trim().toLowerCase();
}

/**
 * Validate a registration body.
 *
 * A create and an update share this function because they accept the same
 * fields; the options object's `partial` flag is the only difference. It also
 * gives an explicit empty string a meaning on an update: clearing the phone
 * number or the notes sends `""`, which becomes `null` in the row, because
 * "absent" and "cleared" have to be distinguishable in a partial update.
 *
 * @param body - The untrusted request body. May be omitted, in which case a create fails validation for every required field.
 * @returns The values to write, in camelCase, with the email normalised and cleared optional fields set to null.
 * @throws HttpError with status 400 listing every invalid field, when at least one field could not be accepted.
 */
function validateRegistrationBody(
  body: UntrustedInput = {},
  { partial = false }: { partial?: boolean } = {}
): DataRecord {
  const errors: ValidationIssue[] = [];
  const required = !partial;
  const values: DataRecord = {};

  const attendeeName = requiredText(body, 'attendeeName', errors, {
    required,
    min: 2,
    max: 120,
  });
  if (attendeeName !== undefined) values.attendeeName = attendeeName;

  const attendeeEmail = requiredEmail(body, 'attendeeEmail', errors, { required });
  if (attendeeEmail !== undefined) values.attendeeEmail = normaliseEmail(attendeeEmail);

  const attendeePhone = requiredText(body, 'attendeePhone', errors, {
    required: false,
    max: 30,
  });
  if (attendeePhone !== undefined) {
    // A phone number is optional, but when it is given it must look like one.
    // The pattern accepts +61 400 000 000, (02) 6620 1001 and 0400000000.
    if (!/^[+()\d][\d\s\-().]{5,29}$/.test(attendeePhone)) {
      errors.push({
        field: 'attendeePhone',
        message: 'Enter a phone number such as 0400 000 000, or leave it empty.',
      });
    } else {
      values.attendeePhone = attendeePhone;
    }
  } else if (partial && body.attendeePhone === '') {
    // An explicit empty string clears the phone number on an update.
    values.attendeePhone = null;
  }

  const ticketsPurchased = requiredNumber(body, 'ticketsPurchased', errors, {
    required,
    min: 1,
    max: MAX_TICKETS_PER_REGISTRATION,
    integer: true,
  });
  if (ticketsPurchased !== undefined) values.ticketsPurchased = ticketsPurchased;

  const ticketTypeId = requiredId(body, 'ticketTypeId', errors, { required: false });
  if (ticketTypeId !== undefined) values.ticketTypeId = ticketTypeId;
  else if (body.ticketTypeId === '' || body.ticketTypeId === null) {
    values.ticketTypeId = null;
  }

  const registeredAt = requiredDate(body, 'registeredAt', errors, { required: false });
  if (registeredAt !== undefined) {
    // The column is a DATETIME, so keep the time when one was supplied: the
    // event page orders the list by exactly this value.
    const normalised = normaliseRegisteredAt(body.registeredAt, registeredAt, errors);
    if (normalised !== undefined) values.registeredAt = normalised;
  }

  const notes = requiredText(body, 'notes', errors, { required: false, max: 300 });
  if (notes !== undefined) values.notes = notes;
  else if (partial && body.notes === '') values.notes = null;

  throwIfInvalid(
    errors,
    'The registration could not be saved because some fields are invalid.'
  );
  return values;
}

/**
 * Turn a supplied registration date into a DATETIME literal.
 *
 * Accepts "2026-09-21", "2026-09-21 14:30", "2026-09-21T14:30" or a full ISO
 * string, and a bare date becomes midday so that a date-only entry still sorts
 * sensibly against the registrations that carry a real time.
 *
 * The clock time is range checked, because `\d{2}` on its own accepted "99:99",
 * which became "2026-09-21 99:99:00". MySQL rejects that with an out-of-range
 * error, so the caller saw a 500 rather than the 400 a bad field deserves; the
 * offline store accepted it and then sorted the row as the NEWEST registration,
 * quietly corrupting the order the event page is required to show. A field error
 * is the honest answer.
 *
 * @param raw - The value as submitted, in any of the accepted shapes.
 * @param datePart - The validated `YYYY-MM-DD` part, taken from the same value.
 * @param errors - The shared problem list, appended to when the time is impossible. May be omitted by a caller with no list to report into.
 * @returns The `YYYY-MM-DD HH:MM:SS` literal, or `undefined` when the time is out of range.
 */
function normaliseRegisteredAt(
  raw: unknown,
  datePart: string,
  errors: ValidationIssue[] = []
): string | undefined {
  const text = String(raw).trim();
  if (text.length <= 10) return `${datePart} 12:00:00`;

  const timeMatch = text.match(/[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!timeMatch) return `${datePart} 12:00:00`;

  const [, hours, minutes, seconds = '00'] = timeMatch;

  const [h, m, s] = [hours, minutes, seconds].map(Number);
  if (h > 23 || m > 59 || s > 59) {
    errors.push({
      field: 'registeredAt',
      message: 'registeredAt must contain a time between 00:00:00 and 23:59:59.',
    });
    return undefined;
  }

  return `${datePart} ${hours}:${minutes}:${seconds}`;
}

/**
 * Register one attendee for one event.
 *
 * The remaining allocation is checked before the insert (rule 3), and the
 * repository's unique key is the final authority on rule 1 - the check here
 * gives a readable 409 in the ordinary case, and the key still refuses a second
 * registration if two requests race.
 *
 * @param rawEventId - The event id from the route parameter, still unvalidated text.
 * @param body - The untrusted request body describing the attendee.
 * @returns The stored registration, including its new id.
 * @throws HttpError with status 400 for an invalid id, body or ticket count, 404 when the event does not exist, and 409 when that email is already registered for the event.
 */
async function createRegistration(
  rawEventId: string | number,
  body: UntrustedInput
): Promise<DataRecord> {
  const eventId = parsePositiveId(rawEventId, 'event');

  const values = validateRegistrationBody(body, { partial: false });

  // Rule 3: do not accept more tickets than the tier has left. The count is
  // taken from the registrations already recorded, which is the same figure the
  // event page shows.
  //
  // This is the readable answer, not the safe one: between this read and the
  // insert another request could buy the last ticket, so the repository repeats
  // the identical check inside the transaction that writes the row, with the
  // tier row locked. Keeping both is deliberate - this one answers with the
  // per-field detail before anything is written, and the locked one is what
  // makes the limit hold under concurrency.
  if (values.ticketTypeId !== undefined && values.ticketTypeId !== null) {
    await assertTicketsAvailable(eventId, values.ticketTypeId, values.ticketsPurchased);
  }

  const registration = await repository.insertRegistration(eventId, values);
  if (!registration) {
    throw HttpError.notFound(
      `No event was found with id ${eventId}, so a registration cannot be recorded for it.`
    );
  }
  return registration;
}

/**
 * Check a tier's remaining allocation.
 *
 * Only tiers that publish `quantity_available` are limited; a NULL means
 * unlimited, which is how the virtual challenge tiers are seeded. The sold count
 * is derived from the registrations already recorded for the tier rather than
 * from a stored counter, so it cannot drift away from the rows the event page
 * displays. The arithmetic and the 400 itself live in
 * repositories/ticket-allocation.ts, because the repository repeats this exact
 * check inside the transaction that inserts the row, and two implementations of
 * "how many are left" would eventually disagree.
 *
 * The check is shared by a create and an update. On an update the registration
 * being changed is excluded from the sold count: its own tickets are already
 * accounted for, so sending the quantity the row already has stays valid while
 * an increase beyond the tier's remaining allocation is refused.
 *
 * @param eventId - The id of the event being registered for.
 * @param ticketTypeId - The tier the attendee chose.
 * @param requested - The number of tickets being requested.
 * @param options - The registration whose own tickets must not be counted. May be omitted, in which case every recorded registration counts.
 * @throws HttpError with status 404 when the event does not exist, and 400 when the tier belongs to another event, is sold out, or has fewer tickets left than were requested.
 */
async function assertTicketsAvailable(
  eventId: number,
  ticketTypeId: number,
  requested: number,
  { excludeRegistrationId }: { excludeRegistrationId?: number } = {}
): Promise<void> {
  const event = await repository.findEventById(eventId, { status: 'all' });
  if (!event) {
    throw HttpError.notFound(`No event was found with id ${eventId}.`);
  }

  const tier = (event.ticketTypes || []).find(
    (ticket: DataRecord) => Number(ticket.ticketTypeId) === Number(ticketTypeId)
  );
  if (!tier) {
    throw HttpError.badRequest(`Ticket type ${ticketTypeId} is not offered by this event.`, [
      { field: 'ticketTypeId', message: 'Choose one of the ticket types shown for this event.' },
    ]);
  }

  assertTicketsRemain({
    ticketName: tier.ticketName,
    quantityAvailable:
      tier.quantityAvailable === null || tier.quantityAvailable === undefined
        ? null
        : Number(tier.quantityAvailable),
    sold: soldForTier(event.registrations || [], ticketTypeId, excludeRegistrationId),
    requested,
  });
}

/**
 * Update one registration as a partial update.
 *
 * Only the fields sent are changed, and sending `{}` is a 400 rather than a
 * silent success, because a client that sent nothing has almost certainly made a
 * mistake. Changing the email is re-checked against the event's unique key by
 * the repository, so a move onto an address that is already registered is a 409.
 *
 * The allocation rule from a create applies here too: raising `ticketsPurchased`,
 * or moving the row onto a different tier, is checked against the tier's
 * remaining allocation before anything is written. The row's own tickets are
 * excluded from that count, so an update that keeps the quantity it already has
 * is never refused - which is what makes a partial update of only the notes, or
 * a re-send of the current quantity, still succeed for a tier that is sold out.
 * The row is read first so the check knows which event and tier it is about; a
 * missing id is a 404 at that point rather than after the check, so an unknown
 * id is never reported as an allocation problem.
 *
 * @param rawId - The registration id from the route parameter, still unvalidated text.
 * @param body - The untrusted request body holding only the fields to change.
 * @returns The registration as it now stands.
 * @throws HttpError with status 400 for an invalid id, an empty body, a ticket count the tier cannot satisfy or a value the database refuses, 404 when no registration has that id, and 409 when the new email is already registered for that event.
 */
async function updateRegistration(
  rawId: string | number,
  body: UntrustedInput
): Promise<DataRecord> {
  const registrationId = parsePositiveId(rawId, 'registration');

  const values = validateRegistrationBody(body, { partial: true });
  if (Object.keys(values).length === 0) {
    throw HttpError.badRequest(
      'No fields were supplied. Send only the fields you want to change.'
    );
  }

  const existing = await repository.registrationQueries.findById(registrationId);
  if (!existing) {
    throw HttpError.notFound(
      `No registration was found with id ${registrationId}, so there was nothing to update.`
    );
  }

  // The tier and the quantity the row will have once the update is applied: an
  // absent field keeps the stored value, which is what makes this a check of the
  // outcome rather than of the payload.
  const ticketTypeId =
    values.ticketTypeId === undefined ? existing.ticketTypeId : values.ticketTypeId;
  const requested =
    values.ticketsPurchased === undefined ? existing.ticketsPurchased : values.ticketsPurchased;

  if (ticketTypeId !== null && ticketTypeId !== undefined) {
    await assertTicketsAvailable(existing.eventId, ticketTypeId, requested, {
      excludeRegistrationId: registrationId,
    });
  }

  const registration = await repository.updateRegistration(registrationId, values);
  if (!registration) {
    throw HttpError.notFound(
      `No registration was found with id ${registrationId}, so there was nothing to update.`
    );
  }
  return registration;
}

/**
 * Delete one registration.
 *
 * The repository reports whether a row was removed, which is what lets an
 * unknown id be a 404 rather than a 204 that claims to have deleted something.
 *
 * @param rawId - The registration id from the route parameter, still unvalidated text.
 * @returns The id of the registration that was deleted.
 * @throws HttpError with status 400 for an invalid id and 404 when no registration has that id.
 */
async function deleteRegistration(
  rawId: string | number
): Promise<{ registrationId: number; deleted: true }> {
  const registrationId = parsePositiveId(rawId, 'registration');

  const removed = await repository.deleteRegistration(registrationId);
  if (!removed) {
    throw HttpError.notFound(
      `No registration was found with id ${registrationId}, so there was nothing to delete.`
    );
  }
  return { registrationId, deleted: true };
}

/**
 * List every registration for one event, newest first.
 *
 * The order is the one the event page displays, and the event is looked up with
 * `status: 'all'` so a withdrawn event still shows the registrations already
 * taken for it. The ticket total is summed from the same rows that are returned,
 * so the count in the metadata can never contradict the list.
 *
 * @param rawEventId - The event id from the route parameter, still unvalidated text.
 * @returns The event's name and date, its registration count, the tickets sold and the registrations themselves.
 * @throws HttpError with status 400 for an invalid id and 404 when no event has that id.
 */
async function listForEvent(rawEventId: string | number) {
  const eventId = parsePositiveId(rawEventId, 'event');

  const event = await repository.findEventById(eventId, { status: 'all' });
  if (!event) {
    throw HttpError.notFound(`No event was found with id ${eventId}.`);
  }

  // The public projection, by name: this backs a PUBLIC endpoint, so the rows must
  // carry no attendee email or phone. The admin list (GET /api/registrations) is
  // where staff get the contact details.
  const registrations = await repository.registrationQueries.findPublicForEvent(eventId);

  return {
    eventId,
    eventName: event.eventName,
    eventDate: event.eventDate,
    capacity: event.capacity,
    total: registrations.length,
    ticketsSold: registrations.reduce((sum, row) => sum + row.ticketsPurchased, 0),
    registrations,
  };
}

/**
 * List registrations across every event, for the optional admin screen.
 *
 * The query string supplies ?eventId=, ?email=, ?keyword=, ?limit= and ?offset=.
 * The paging values are bounded here rather than trusted, so one admin request
 * cannot ask for the whole table; the filter values are passed through as text
 * because the repository parameterises them.
 *
 * @param query - The untrusted query string. May be omitted, in which case the first hundred registrations are returned.
 * @returns The page of registrations, its totals and the tickets sold across the returned rows.
 * @throws HttpError with status 400 when a paging or filter value cannot be understood.
 */
async function listRegistrations(query: UntrustedInput = {}) {
  const errors: ValidationIssue[] = [];

  let eventId: number | undefined;
  if (query.eventId !== undefined && query.eventId !== '') {
    eventId = parseInteger(query.eventId, 'eventId', { min: 1, errors });
  }

  const limit =
    query.limit === undefined
      ? 100
      : parseInteger(query.limit, 'limit', { min: 1, max: 200, errors });
  const offset =
    query.offset === undefined
      ? 0
      : parseInteger(query.offset, 'offset', { min: 0, max: 1_000_000, errors });

  throwIfInvalid(errors, 'One or more query parameters are invalid.');

  const filters = {
    eventId,
    email: query.email ? String(query.email) : undefined,
    keyword: query.keyword ? String(query.keyword) : undefined,
  };

  const result = await repository.registrationQueries.findAll(filters, {
    limit: limit === undefined ? 100 : limit,
    offset: offset === undefined ? 0 : offset,
  });

  return {
    total: result.total,
    count: result.registrations.length,
    limit,
    offset,
    ticketsSold: result.registrations.reduce((sum, row) => sum + row.ticketsPurchased, 0),
    registrations: result.registrations,
  };
}

/**
 * Return one registration by its id.
 *
 * @param rawId - The registration id from the route parameter, still unvalidated text.
 * @returns The stored registration.
 * @throws HttpError with status 400 for an invalid id and 404 when no registration has that id.
 */
async function getRegistration(rawId: string | number) {
  const registrationId = parsePositiveId(rawId, 'registration');
  const registration = await repository.registrationQueries.findById(registrationId);
  if (!registration) {
    throw HttpError.notFound(`No registration was found with id ${registrationId}.`);
  }
  return registration;
}

/**
 * Parse a positive id, naming the resource in the message.
 *
 * One helper for events and registrations, so both routes reject a malformed id
 * with the same status and the same wording.
 *
 * @param rawId - The id from the route parameter, still unvalidated text.
 * @param noun - The resource name used in the message, such as `event`.
 * @returns The id as a number, once it is known to be a positive whole number.
 * @throws HttpError with status 400 when the value is not a positive whole number.
 */
function parsePositiveId(rawId: string | number, noun: string): number {
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    throw HttpError.badRequest(
      `"${rawId}" is not a valid ${noun} id. Ids are positive whole numbers.`
    );
  }
  return id;
}

/**
 * The service's public surface.
 *
 * The five operations are used by the registration and admin controllers; the
 * validators and the id parser are exported so the tests can exercise a rule
 * without going through Express, and the ticket ceiling is exported so the admin
 * form can state the same limit the validator enforces.
 */
export = {
  createRegistration,
  updateRegistration,
  deleteRegistration,
  listForEvent,
  listRegistrations,
  getRegistration,
  normaliseEmail,
};
