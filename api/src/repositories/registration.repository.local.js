/**
 * src/repositories/registration.repository.local.js
 * ---------------------------------------------------------------------------
 * The registration repository for DATA_SOURCE=local: reads AND writes.
 *
 * In MySQL the reads live in repository.mysql.js
 * (`registrationQueries`) and the writes live in
 * registration.repository.mysql.js, because in MySQL the database itself holds
 * the state. Offline there is no database, so both halves operate on the single
 * mutable array held by local-store.js. That array is what makes a POST
 * performed by one request visible to the GET performed by the next.
 *
 * Every method here returns exactly the object shape that
 * repository.mysql.js produces, because the same controller and the same
 * client code consume both.
 *
 * Field naming follows the database: the raw rows use snake_case
 * (registration_id, tickets_purchased), and every value that leaves this module
 * is converted to the camelCase API shape. The conversion happens in exactly
 * one place, `toApiShape()`, so the two repositories cannot drift apart.
 */
'use strict';

const store = require('./local-store');
const { HttpError } = require('../utils/errors');

/** Lower-case and trim an email, matching registration.repository.mysql.js. */
function normaliseEmail(email) {
  return String(email || '').trim().toLowerCase();
}

/**
 * The tier a registration bought.
 *
 * Searched across the seeded tiers AND the ones added at run time for newly
 * created events (store.allTicketTypes()), because a registration may be made
 * against a tier that only came into existence a moment ago in the same
 * session. Looking in data.ticket_types alone would reject it.
 */
function ticketFor(ticketTypeId) {
  if (ticketTypeId === null || ticketTypeId === undefined) return null;
  return (
    store
      .allTicketTypes()
      .find((ticket) => ticket.ticket_type_id === Number(ticketTypeId)) || null
  );
}

function eventFor(eventId) {
  return store.findEventRow(eventId);
}

/** Convert one raw row into the API shape used by both data sources. */
function toApiShape(row) {
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
 */
function compareNewestFirst(left, right) {
  if (left.registered_at !== right.registered_at) {
    return left.registered_at < right.registered_at ? 1 : -1;
  }
  return right.registration_id - left.registration_id;
}

/** The raw rows for one event, newest first. */
function rawForEvent(eventId) {
  return store.registrations
    .filter((row) => Number(row.event_id) === Number(eventId))
    .sort(compareNewestFirst);
}

const registrationStore = {
  driver: 'local',

  /** Newest first - the event detail page. */
  findByEventId(eventId) {
    return rawForEvent(eventId).map(toApiShape);
  },

  /** One registration, or null. */
  findById(registrationId) {
    const row = store.registrations.find(
      (item) => Number(item.registration_id) === Number(registrationId)
    );
    return row ? toApiShape(row) : null;
  },

  /** The optional admin list: every registration, newest first, filterable. */
  findAll(filters = {}, paging = { limit: 100, offset: 0 }) {
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
        `${row.attendee_name} ${row.attendee_email}`.toLowerCase().includes(needle)
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

  /** How many registrations an event has. Used by the delete rule. */
  countByEventId(eventId) {
    return rawForEvent(eventId).length;
  },

  /** Has this email already registered for this event? */
  existsForEventAndEmail(eventId, email) {
    const needle = normaliseEmail(email);
    return store.registrations.some(
      (row) =>
        Number(row.event_id) === Number(eventId) &&
        normaliseEmail(row.attendee_email) === needle
    );
  },

  /** The raw rows, for the statistics strip. */
  findAllRaw() {
    return store.registrations;
  },

  /* ----------------------------------------------------------------- writes */

  /**
   * POST /api/events/:id/registrations
   * @returns {object|null} the stored registration, or null when the event does not exist
   */
  insertRegistration(eventId, values) {
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

    store.registrations.push(row);
    return toApiShape(row);
  },

  /**
   * PUT /api/registrations/:id
   * @returns {object|null} the updated row, or null when it does not exist
   */
  updateRegistration(registrationId, values) {
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

  /** DELETE /api/registrations/:id */
  deleteRegistration(registrationId) {
    const index = store.registrations.findIndex(
      (item) => Number(item.registration_id) === Number(registrationId)
    );
    if (index === -1) return false;
    store.registrations.splice(index, 1);
    return true;
  },
};

/** "YYYY-MM-DD HH:MM:SS" in local time, matching a MySQL DATETIME literal. */
function nowStamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
    `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
  );
}

module.exports = registrationStore;
module.exports.toApiShape = toApiShape;
module.exports.rawForEvent = rawForEvent;
module.exports.normaliseEmail = normaliseEmail;
module.exports.nowStamp = nowStamp;
