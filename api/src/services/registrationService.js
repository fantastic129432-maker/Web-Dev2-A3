/**
 * src/services/registrationService.js
 * ---------------------------------------------------------------------------
 * The business rules behind event registration - the feature Assessment 3 adds
 * to the client website.
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
 *      publishes a quantity.
 *   4. The optional ticket type must belong to the same event, which the
 *      composite foreign key fk_registration_ticket also enforces.
 *   5. "The date of registration" may be supplied; when it is not, the moment
 *      of submission is used (the DATETIME column default).
 */
'use strict';

const repository = require('../repositories');
const { HttpError } = require('../utils/errors');
const {
  requiredDate,
  requiredText,
  requiredNumber,
  requiredId,
  requiredEmail,
  throwIfInvalid,
  parseInteger,
} = require('../utils/validators');

/** The largest number of tickets one registration may buy. */
const MAX_TICKETS_PER_REGISTRATION = 20;

/** Lower-case and trim - the one place that decides what "the same email" means. */
function normaliseEmail(email) {
  return String(email || '').trim().toLowerCase();
}

/**
 * Validate a registration body.
 *
 * @param {object} body
 * @param {{partial:boolean}} options  true for PUT
 * @returns {object} camelCase values ready for the repository
 */
function validateRegistrationBody(body = {}, { partial = false } = {}) {
  const errors = [];
  const required = !partial;
  const values = {};

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
    values.registeredAt = normaliseRegisteredAt(body.registeredAt, registeredAt);
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
 * Turn a supplied date into a DATETIME literal.
 *
 * Accepts "2026-09-21", "2026-09-21 14:30", "2026-09-21T14:30" or a full ISO
 * string. A bare date becomes midday so that a date-only entry still sorts
 * sensibly against the registrations that carry a real time.
 */
function normaliseRegisteredAt(raw, datePart) {
  const text = String(raw).trim();
  if (text.length <= 10) return `${datePart} 12:00:00`;

  const timeMatch = text.match(/[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!timeMatch) return `${datePart} 12:00:00`;

  const [, hours, minutes, seconds = '00'] = timeMatch;
  return `${datePart} ${hours}:${minutes}:${seconds}`;
}

/**
 * POST /api/events/:id/registrations
 *
 * @throws {HttpError} 400 invalid body or id, 404 unknown event,
 *        409 the email is already registered for this event
 */
async function createRegistration(rawEventId, body) {
  const eventId = parsePositiveId(rawEventId, 'event');

  const values = validateRegistrationBody(body, { partial: false });

  // Rule 3: do not accept more tickets than the tier has left. The count is
  // taken from the registrations already recorded, which is the same figure the
  // event page shows.
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
 * unlimited, which is how the virtual challenge tiers are seeded.
 */
async function assertTicketsAvailable(eventId, ticketTypeId, requested) {
  const event = await repository.findEventById(eventId, { status: 'all' });
  if (!event) {
    throw HttpError.notFound(`No event was found with id ${eventId}.`);
  }

  const tier = (event.ticketTypes || []).find(
    (ticket) => Number(ticket.ticketTypeId) === Number(ticketTypeId)
  );
  if (!tier) {
    throw HttpError.badRequest(`Ticket type ${ticketTypeId} is not offered by this event.`, [
      { field: 'ticketTypeId', message: 'Choose one of the ticket types shown for this event.' },
    ]);
  }

  if (tier.quantityAvailable === null || tier.quantityAvailable === undefined) return;

  const sold = (event.registrations || [])
    .filter((row) => Number(row.ticketTypeId) === Number(ticketTypeId))
    .reduce((sum, row) => sum + Number(row.ticketsPurchased || 0), 0);

  const remaining = Number(tier.quantityAvailable) - sold;
  if (requested > remaining) {
    throw HttpError.badRequest(
      remaining <= 0
        ? `"${tier.ticketName}" is sold out.`
        : `Only ${remaining} ${remaining === 1 ? 'ticket' : 'tickets'} of "${tier.ticketName}" remain, but ${requested} were requested.`,
      [
        {
          field: 'ticketsPurchased',
          message: `Choose ${Math.max(remaining, 0)} or fewer.`,
          remaining,
          ticketName: tier.ticketName,
        },
      ]
    );
  }
}

/**
 * PUT /api/registrations/:id
 * @throws {HttpError} 400 invalid body or id, 404 unknown registration,
 *        409 the new email is already used for that event
 */
async function updateRegistration(rawId, body) {
  const registrationId = parsePositiveId(rawId, 'registration');

  const values = validateRegistrationBody(body, { partial: true });
  if (Object.keys(values).length === 0) {
    throw HttpError.badRequest(
      'No fields were supplied. Send only the fields you want to change.'
    );
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
 * DELETE /api/registrations/:id
 * @throws {HttpError} 400 invalid id, 404 unknown registration
 */
async function deleteRegistration(rawId) {
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
 * GET /api/events/:id/registrations
 * Newest first, which is the order the event page displays.
 */
async function listForEvent(rawEventId) {
  const eventId = parsePositiveId(rawEventId, 'event');

  const event = await repository.findEventById(eventId, { status: 'all' });
  if (!event) {
    throw HttpError.notFound(`No event was found with id ${eventId}.`);
  }

  const registrations = await repository.registrationQueries.findByEventId(eventId);

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
 * GET /api/registrations - the optional admin list across every event.
 * Supports ?eventId=, ?email=, ?keyword=, ?limit= and ?offset=.
 */
async function listRegistrations(query = {}) {
  const errors = [];

  let eventId;
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
 * GET /api/registrations/:id
 * @throws {HttpError} 404 when it does not exist
 */
async function getRegistration(rawId) {
  const registrationId = parsePositiveId(rawId, 'registration');
  const registration = await repository.registrationQueries.findById(registrationId);
  if (!registration) {
    throw HttpError.notFound(`No registration was found with id ${registrationId}.`);
  }
  return registration;
}

/** Shared id parsing. */
function parsePositiveId(rawId, noun) {
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    throw HttpError.badRequest(
      `"${rawId}" is not a valid ${noun} id. Ids are positive whole numbers.`
    );
  }
  return id;
}

module.exports = {
  createRegistration,
  updateRegistration,
  deleteRegistration,
  listForEvent,
  listRegistrations,
  getRegistration,
  validateRegistrationBody,
  normaliseEmail,
  normaliseRegisteredAt,
  parsePositiveId,
  MAX_TICKETS_PER_REGISTRATION,
};
