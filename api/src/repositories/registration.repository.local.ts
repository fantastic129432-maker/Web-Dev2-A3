/**
 * @file The registration repository for DATA_SOURCE=local: reads AND writes.
 *
 * In MySQL the reads live in repository.mysql.ts
 * (`registrationQueries`) and the writes live in
 * registration.repository.mysql.ts, because in MySQL the database itself holds
 * the state. Offline there is no database, so both halves operate on the single
 * mutable array held by local-store.ts. That array is what makes a POST
 * performed by one request visible to the GET performed by the next.
 *
 * Every method here returns exactly the object shape that
 * repository.mysql.ts produces, because the same controller and the same
 * client code consume both.
 *
 * Field naming follows the database: the raw rows use snake_case
 * (registration_id, tickets_purchased), and every value that leaves this module
 * is converted to the camelCase API shape. The conversion happens in exactly
 * one place, `toApiShape()`, so the two repositories cannot drift apart.
 */
'use strict';

import store = require('./local-store');
import type { DataRecord, RegistrationFilters } from '../types';
import { HttpError } from '../utils/errors';
import { assertTicketsRemain } from './ticket-allocation';

/**
 * Lower-case and trim an email address.
 *
 * The same rule the MySQL half and the service layer apply, so "the same email"
 * means the same thing whichever data source is answering.
 *
 * @param email - The address as submitted, in any casing or with surrounding spaces.
 * @returns The comparable form of the address, or an empty string when nothing was supplied.
 */
function normaliseEmail(email: unknown): string {
  return String(email || '').trim().toLowerCase();
}

/**
 * The tier a registration bought.
 *
 * Searched across the seeded tiers AND the ones added at run time for newly
 * created events (store.allTicketTypes()), because a registration may be made
 * against a tier that only came into existence a moment ago in the same
 * session. Looking in data.ticket_types alone would reject it.
 *
 * @param ticketTypeId - The tier id stored on the registration, which may be null for a registration with no tier.
 * @returns The raw tier row, or `null` when the id is absent or unknown.
 */
function ticketFor(ticketTypeId: unknown): DataRecord | null {
  if (ticketTypeId === null || ticketTypeId === undefined) return null;
  return (
    store
      .allTicketTypes()
      .find((ticket) => ticket.ticket_type_id === Number(ticketTypeId)) || null
  );
}

/**
 * The current row of the event a registration belongs to.
 *
 * It goes through the store rather than the snapshot so a registration made
 * against an event created earlier in the same session still finds its event.
 *
 * @param eventId - The event id stored on the registration.
 * @returns The raw event row, or `null` when the event is unknown or was deleted.
 */
function eventFor(eventId: number): DataRecord | null {
  return store.findEventRow(eventId);
}

/**
 * Convert one raw row into the API shape used by both data sources.
 *
 * The conversion happens in exactly one place so the two repositories cannot
 * drift apart; the tier price and the event name are looked up rather than
 * stored, so a registration always reports the current tier name and price.
 *
 * @param row - The raw registration row in the snapshot's snake_case shape.
 * @returns The registration as the API returns it, including the computed total amount.
 */
function toApiShape(row: DataRecord): DataRecord {
  const ticket = ticketFor(row.ticket_type_id);
  const event = eventFor(row.event_id);
  const price = ticket ? Number(ticket.price) : null;
  const ticketsPurchased = Number(row.tickets_purchased || 0);

  return {
    registrationId: row.registration_id,
    eventId: row.event_id,
    eventName: event ? event.event_name : null,
    ticketTypeId: row.ticket_type_id === null ? null : row.ticket_type_id,
    ticketName: ticket ? ticket.ticket_name : null,
    ticketPrice: price,
    attendeeName: row.attendee_name,
    attendeeEmail: row.attendee_email,
    attendeePhone: row.attendee_phone,
    ticketsPurchased,
    totalAmount: Number((ticketsPurchased * (price || 0)).toFixed(2)),
    registeredAt: row.registered_at,
    notes: row.notes,
  };
}

/**
 * Newest first, then by id descending.
 *
 * This is the ordering the brief requires the event page to display: "the list
 * of tickets purchased at the event, sorted by the latest date when the tickets
 * were purchased". registered_at is text in the form "YYYY-MM-DD HH:MM:SS", so
 * a plain string comparison sorts it correctly, and registration_id breaks a
 * tie between two rows written in the same second.
 *
 * @param left - One registration row.
 * @param right - The other registration row.
 * @returns A negative number when `left` sorts later, as Array.sort expects.
 */
function compareNewestFirst(left: DataRecord, right: DataRecord): number {
  if (left.registered_at !== right.registered_at) {
    return left.registered_at < right.registered_at ? 1 : -1;
  }
  return right.registration_id - left.registration_id;
}

/**
 * The raw rows for one event, newest first.
 *
 * @param eventId - The event whose registrations should be listed.
 * @returns A new array of the matching raw rows, sorted as the API reports them.
 */
function rawForEvent(eventId: number): DataRecord[] {
  return store.registrations
    .filter((row) => Number(row.event_id) === Number(eventId))
    .sort(compareNewestFirst);
}

/**
 * Mask an attendee's name as "Grace T.".
 *
 * A first name plus the initial of the surname identifies the row to the person
 * who booked it - "yes, that is my registration" - without publishing a full
 * identity next to a ticket count and a date, which is what turns a booking list
 * into a list of contactable people. A single-word name is shown as it is, and an
 * empty name yields an empty string so the caller can fall back to the
 * registration id rather than rendering a blank cell.
 *
 * The public page renders this inside the registrations table
 * key, so the words around it are translated while the name itself is data.
 *
 * @param attendeeName - The name as the registration stored it, or null when the row carries none.
 * @returns The masked name, for example "Grace T.", or an empty string when no name was stored.
 */
function maskAttendeeName(attendeeName: unknown): string {
  const name = String(attendeeName ?? '').trim();
  if (name === '') return '';
  const parts = name.split(/\s+/);
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1].charAt(0).toUpperCase()}.`;
}

/**
 * Replace an attendee's contact details with the masked line the public page shows.
 *
 * WHY THIS EXISTS
 *   The offline mirror is the twin of repository.mysql.ts, so it must enforce the
 *   same privacy rule that the narrower SELECT enforces there: `attendee_email`
 *   and `attendee_phone` are personal information, and the public event detail
 *   endpoint answers an anonymous visitor whose page renders whatever it receives.
 *   Publishing a named person's full email address and mobile number on a public
 *   page breaches the Australian Privacy Principles (APP 3 and APP 11 - collect
 *   and disclose only what the purpose needs).
 *
 *   The two keys are DELETED rather than blanked, so the response shape is
 *   identical to the MySQL one: `'attendeeEmail' in row` is false in both, which
 *   is exactly what the test suite asserts. This is a data-minimisation boundary
 *   rather than a display decision - a template can be changed tomorrow, a row
 *   that never left the database cannot - which is why it lives beside the query
 *   it mirrors instead of in the controller.
 *
 *   The admin path (GET /api/admin/events/:id) does NOT pass through here: staff
 *   keep the whole row, because they need the contact details to run the event.
 *
 * @param row - One registration in the API shape, as toApiShape() produced it.
 * @returns A copy of the row without attendeeEmail and attendeePhone, carrying attendeeDisplayName ("Grace T.") instead.
 */
function narrowRegistrationToPublic(row: DataRecord): DataRecord {
  const { attendeeEmail, attendeePhone, ...safe } = row;
  return { ...safe, attendeeDisplayName: maskAttendeeName(row.attendeeName) };
}

/**
 * The offline registration repository.
 *
 * It holds the reads the merged object publishes as `registrationQueries`, plus
 * the writes it binds on as its own.
 *
 * Every method returns exactly the object shape repository.mysql.ts produces,
 * because the same controller and the same client code consume both, and the
 * reads answer immediately rather than returning a promise - which callers can
 * await anyway, which is what keeps the two data sources interchangeable.
 */
const registrationStore = {
  driver: 'local',

  /**
   * List every registration for one event, newest first.
   *
   * @param eventId - The event whose registrations should be listed.
   * @returns The registrations in the API shape, newest purchase first.
   */
  findByEventId(eventId: number): DataRecord[] {
    return rawForEvent(eventId).map(toApiShape);
  },

  /**
   * List one event's registrations for the PUBLIC event detail page.
   *
   * The same rows, in the same newest-first order, with each row narrowed by
   * narrowRegistrationToPublic(): no attendee email, no attendee phone, and an
   * attendeeDisplayName ("Grace T.") in their place. It is a separate method
   * rather than a flag on findByEventId() so the two shapes cannot be confused at
   * a call site: a reader of `findPublicForEvent()` cannot accidentally keep the
   * contact details, and a reader of `findByEventId()` cannot accidentally drop
   * them from a staff screen.
   *
   * @param eventId - The event whose registrations should be listed.
   * @returns The registrations in the API shape, newest first, without attendee contact details.
   */
  findPublicForEvent(eventId: number): DataRecord[] {
    return rawForEvent(eventId).map((row) => narrowRegistrationToPublic(toApiShape(row)));
  },

  /**
   * Return one registration by its primary key.
   *
   * @param registrationId - The registration's id.
   * @returns The registration in the API shape, or `null` when no row has that id.
   */
  findById(registrationId: number): DataRecord | null {
    const row = store.registrations.find(
      (item) => Number(item.registration_id) === Number(registrationId)
    );
    return row ? toApiShape(row) : null;
  },

  /**
   * List the whole registration population, newest first.
   *
   * This powers the optional admin registrations page. The filters are applied in
   * memory with the same meanings the SQL gives them (an email is a case
   * insensitive fragment), and the total is counted before paging so it matches
   * the rows the same filters select.
   *
   * The keyword is tested against the name and the email separately, in the same
   * order as the two LIKEs in repository.mysql.ts: joining them first would let a
   * keyword match across the boundary between the two fields, which MySQL's two
   * independent LIKEs can never do. Both tests are literal `includes`, which is
   * what the MySQL side gets from escaping the LIKE metacharacters - so a `%` in
   * the query matches a `%`, not everything.
   *
   * @param filters - The event id, email fragment and keyword to filter on. May be omitted, in which case every registration is included.
   * @param paging - The limit and offset to apply. May be omitted, in which case the first hundred rows are returned.
   * @returns The page of registrations plus the unpaged total.
   */
  findAll(filters: RegistrationFilters = {}, paging: { limit: number; offset: number } = { limit: 100, offset: 0 }) {
    let rows = store.registrations.slice().sort(compareNewestFirst);

    if (filters.eventId) {
      rows = rows.filter((row) => Number(row.event_id) === Number(filters.eventId));
    }
    if (filters.email) {
      const needle = normaliseEmail(filters.email);
      rows = rows.filter((row) => normaliseEmail(row.attendee_email).includes(needle));
    }
    if (filters.keyword) {
      const needle = String(filters.keyword).toLowerCase();
      rows = rows.filter((row) =>
        [row.attendee_name, row.attendee_email].some((value) =>
          String(value === null || value === undefined ? '' : value)
            .toLowerCase()
            .includes(needle)
        )
      );
    }

    const total = rows.length;
    const offset = paging.offset || 0;
    const limit = paging.limit || total;

    return {
      total,
      registrations: rows.slice(offset, offset + limit).map(toApiShape),
    };
  },

  /**
   * Count how many registrations an event has.
   *
   * Used by the delete rule, which refuses to remove an event while this is not
   * zero.
   *
   * @param eventId - The event to count for.
   * @returns The number of registrations for that event.
   */
  countByEventId(eventId: number): number {
    return rawForEvent(eventId).length;
  },

  /**
   * Test whether an email already has a registration for an event.
   *
   * The address is normalised on both sides, which is what makes this agree with
   * the unique key on (event_id, attendee_email).
   *
   * @param eventId - The event to test against.
   * @param email - The attendee address, in any casing.
   * @returns `true` when a registration already exists, `false` otherwise.
   */
  existsForEventAndEmail(eventId: number, email: string): boolean {
    const needle = normaliseEmail(email);
    return store.registrations.some(
      (row) =>
        Number(row.event_id) === Number(eventId) &&
        normaliseEmail(row.attendee_email) === needle
    );
  },

  /**
   * Return the raw registration rows.
   *
   * The statistics strip needs the snake_case rows rather than the API shape,
   * because it counts and sums them itself; handing out the live array is safe
   * because the store is the single owner of that mutable state.
   *
   * @returns The live array of raw registration rows.
   */
  findAllRaw(): DataRecord[] {
    return store.registrations;
  },

  /**
   * Insert one registration for an event.
   *
   * The chosen tier must belong to the event, exactly as the composite foreign
   * key fk_registration_ticket requires in MySQL, and the email must not already
   * be registered for it, which is the unique key
   * uq_registration_event_email. Both rules are checked here because offline
   * there is no database to enforce them.
   *
   * The allocation rule is the third, and it is the mirror of the locked check
   * in registration.repository.mysql.ts: the tier's remaining tickets are
   * counted immediately before the row is pushed, from the same rows the event
   * page lists. No lock is needed and none is possible here - this method is
   * synchronous and Node runs one thread, so no other request can be interleaved
   * between the count and the push, which is what makes the offline twin
   * race-free by construction rather than by a database guarantee. The count is
   * taken after the email check so both data sources answer 409 before 400 when
   * a request breaks both rules.
   *
   * @param eventId - The event being registered for.
   * @param values - The validated registration values in camelCase.
   * @returns The stored registration, or `null` when the event does not exist.
   * @throws HttpError with status 400 when the tier belongs to another event or the tier is oversold, and 409 when that email is already registered for it.
   */
  insertRegistration(eventId: number, values: DataRecord): DataRecord | null {
    const event = eventFor(eventId);
    if (!event) return null;

    const ticketTypeId =
      values.ticketTypeId === undefined || values.ticketTypeId === null
        ? null
        : Number(values.ticketTypeId);

    // A chosen tier must belong to this event, exactly as the composite foreign
    // key fk_registration_ticket requires in MySQL.
    if (ticketTypeId !== null) {
      const ticket = ticketFor(ticketTypeId);
      if (!ticket || Number(ticket.event_id) !== Number(eventId)) {
        throw HttpError.badRequest(
          `Ticket type ${ticketTypeId} does not belong to event ${eventId}.`,
          [{ field: 'ticketTypeId', message: 'Choose a ticket type offered by this event.' }]
        );
      }
    }

    const email = normaliseEmail(values.attendeeEmail);

    // "One user may register for multiple events and can only register for an
    // event once" - the unique key uq_registration_event_email in MySQL.
    if (registrationStore.existsForEventAndEmail(eventId, email)) {
      throw HttpError.conflict(
        `${email} has already registered for "${event.event_name}". Each person may register for an event once.`,
        {
          field: 'attendeeEmail',
          eventId: Number(eventId),
          attendeeEmail: email,
          hint: 'Use the event detail page to see the existing registration.',
        }
      );
    }

    const row = {
      registration_id: store.allocateRegistrationId(),
      event_id: Number(eventId),
      ticket_type_id: ticketTypeId,
      attendee_name: values.attendeeName,
      attendee_email: email,
      attendee_phone:
        values.attendeePhone === undefined ? null : values.attendeePhone,
      tickets_purchased:
        values.ticketsPurchased === undefined ? 1 : Number(values.ticketsPurchased),
      // The column default in MySQL is CURRENT_TIMESTAMP; this is its twin.
      registered_at: values.registeredAt || nowStamp(),
      notes: values.notes === undefined ? null : values.notes,
    };

    // The same rule MySQL enforces while holding a row lock on the tier. The
    // count comes from the rows already stored for this event and tier, which is
    // the figure the event page displays; a tier that publishes no quantity is
    // unlimited and assertTicketsRemain returns without objecting.
    if (ticketTypeId !== null) {
      const tier = ticketFor(ticketTypeId);

      if (tier && tier.quantity_available !== null && tier.quantity_available !== undefined) {
        const sold = store.registrations
          .filter(
            (item) =>
              Number(item.event_id) === Number(eventId) &&
              Number(item.ticket_type_id) === Number(ticketTypeId)
          )
          .reduce((sum, item) => sum + Number(item.tickets_purchased || 0), 0);

        assertTicketsRemain({
          ticketName: tier.ticket_name,
          quantityAvailable: Number(tier.quantity_available),
          sold,
          requested: row.tickets_purchased,
        });
      }
    }

    store.registrations.push(row);
    return toApiShape(row);
  },

  /**
   * Update one registration in place.
   *
   * Only the fields present in the payload are changed. Moving the registration
   * to another tier is checked against the same event, and changing the email is
   * checked against the other registrations for that event, because the same
   * unique key has to hold after an update as after an insert.
   *
   * @param registrationId - The id of the registration to change.
   * @param values - The validated fields to change, in camelCase.
   * @returns The updated registration, or `null` when no row has that id.
   * @throws HttpError with status 400 when the tier belongs to another event and 409 when the new email is already registered for that event.
   */
  updateRegistration(registrationId: number, values: DataRecord): DataRecord | null {
    const row = store.registrations.find(
      (item) => Number(item.registration_id) === Number(registrationId)
    );
    if (!row) return null;

    if (values.ticketTypeId !== undefined) {
      const ticketTypeId =
        values.ticketTypeId === null ? null : Number(values.ticketTypeId);
      if (ticketTypeId !== null) {
        const ticket = ticketFor(ticketTypeId);
        if (!ticket || Number(ticket.event_id) !== Number(row.event_id)) {
          throw HttpError.badRequest(
            `Ticket type ${ticketTypeId} does not belong to event ${row.event_id}.`,
            [{ field: 'ticketTypeId', message: 'Choose a ticket type offered by this event.' }]
          );
        }
      }
      row.ticket_type_id = ticketTypeId;
    }

    if (values.attendeeName !== undefined) row.attendee_name = values.attendeeName;
    if (values.attendeeEmail !== undefined) {
      const email = normaliseEmail(values.attendeeEmail);
      // Changing the email must not collide with another registration for the
      // same event - the same guarantee uq_registration_event_email gives.
      const clash = store.registrations.some(
        (item) =>
          item.registration_id !== row.registration_id &&
          Number(item.event_id) === Number(row.event_id) &&
          normaliseEmail(item.attendee_email) === email
      );
      if (clash) {
        throw HttpError.conflict('That email is already registered for this event.', {
          field: 'attendeeEmail',
          registrationId: Number(registrationId),
        });
      }
      row.attendee_email = email;
    }
    if (values.attendeePhone !== undefined) row.attendee_phone = values.attendeePhone;
    if (values.ticketsPurchased !== undefined) {
      row.tickets_purchased = Number(values.ticketsPurchased);
    }
    if (values.notes !== undefined) row.notes = values.notes;
    if (values.registeredAt !== undefined) row.registered_at = values.registeredAt;

    return toApiShape(row);
  },

  /**
   * Remove one registration.
   *
   * The result is a boolean rather than the removed row, because the service only
   * needs to know whether anything was deleted in order to answer 204 or 404.
   *
   * @param registrationId - The id of the registration to remove.
   * @returns `true` when a row was removed, `false` when no row had that id.
   */
  deleteRegistration(registrationId: number): boolean {
    const index = store.registrations.findIndex(
      (item) => Number(item.registration_id) === Number(registrationId)
    );
    if (index === -1) return false;
    store.registrations.splice(index, 1);
    return true;
  },
};

/**
 * "YYYY-MM-DD HH:MM:SS" in local time, matching a MySQL DATETIME literal.
 *
 * It stands in for the column's CURRENT_TIMESTAMP default when a registration is
 * stored without an explicit date.
 *
 * @returns The current moment as the snapshot writes it.
 */
function nowStamp(): string {
  const now = new Date();
  const pad = (value: number): string => String(value).padStart(2, '0');
  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
    `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
  );
}

/**
 * The registration store plus the helpers the tests exercise.
 *
 * One export: the helpers the original attached to module.exports afterwards ride
 * along on the same object, so `require('./registration.repository.local')` is
 * both the read half MySQL keeps separately and the write half it keeps in
 * registration.repository.mysql.ts.
 */
export = Object.assign(registrationStore, {
  toApiShape,
  rawForEvent,
  normaliseEmail,
  nowStamp,
  maskAttendeeName,
  narrowRegistrationToPublic,
});
