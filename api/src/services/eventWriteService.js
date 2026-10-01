/**
 * src/services/eventWriteService.js
 * ---------------------------------------------------------------------------
 * Assessment 3, Part 2 - the business rules behind the three new admin
 * endpoints:
 *
 *   createEvent()  POST   /api/events
 *   updateEvent()  PUT    /api/events/:id
 *   deleteEvent()  DELETE /api/events/:id
 *
 * Why a separate service from eventService.js? eventService owns the read
 * rules (turning a query string into a validated filter). This file owns the
 * write rules (turning a JSON body into a validated event, and deciding whether
 * a delete is allowed). Keeping them apart means the read path that A2 was
 * marked on is untouched, and it is obvious in the report which rules are new.
 *
 * Validation policy
 *   Every field is checked and ALL problems are collected, then thrown as one
 *   HttpError(400) whose `details` array has one { field, message } entry per
 *   problem. Both websites render that list next to the form, so staff can fix
 *   everything in one pass instead of one error at a time.
 */
'use strict';

const repository = require('../repositories');
const { HttpError } = require('../utils/errors');
const {
  requiredDate,
  requiredTime,
  requiredText,
  requiredNumber,
  requiredBoolean,
  requiredEnum,
  requiredId,
  throwIfInvalid,
} = require('../utils/validators');

/** The publishing states the events.status column allows. */
const PUBLISH_STATUSES = ['active', 'suspended', 'cancelled'];

/**
 * The image files the client website ships with. A free-text image_url is
 * accepted as well (an external URL), but choosing from this list guarantees
 * the event card shows real artwork.
 */
const KNOWN_IMAGES = [
  'fun-run.svg',
  'gala-dinner.svg',
  'silent-auction.svg',
  'charity-concert.svg',
  'food-drive.svg',
  'golf-day.svg',
  'art-exhibition.svg',
  'virtual-challenge.svg',
  'community.svg',
];

/**
 * Validate and normalise an event body.
 *
 * @param {object} body       req.body
 * @param {{partial:boolean}} options  true for PUT, where only the fields that
 *        are present are validated and changed
 * @returns {object} the values to write, in camelCase
 */
function validateEventBody(body = {}, { partial = false } = {}) {
  const errors = [];
  const required = !partial;
  const values = {};

  // ---- foreign keys: must exist, which the database also enforces ----------
  const organizationId = requiredId(body, 'organizationId', errors, { required });
  if (organizationId !== undefined) values.organizationId = organizationId;

  const categoryId = requiredId(body, 'categoryId', errors, { required });
  if (categoryId !== undefined) values.categoryId = categoryId;

  const locationId = requiredId(body, 'locationId', errors, { required });
  if (locationId !== undefined) values.locationId = locationId;

  // ---- descriptive text ---------------------------------------------------
  const eventName = requiredText(body, 'eventName', errors, {
    required,
    min: 3,
    max: 180,
  });
  if (eventName !== undefined) values.eventName = eventName;

  const shortDescription = requiredText(body, 'shortDescription', errors, {
    required,
    min: 5,
    max: 300,
  });
  if (shortDescription !== undefined) values.shortDescription = shortDescription;

  const description = requiredText(body, 'description', errors, {
    required,
    min: 10,
    max: 20000,
  });
  if (description !== undefined) values.description = description;

  const purpose = requiredText(body, 'purpose', errors, {
    required,
    min: 3,
    max: 300,
  });
  if (purpose !== undefined) values.purpose = purpose;

  // ---- dates and times ----------------------------------------------------
  const eventDate = requiredDate(body, 'eventDate', errors, { required });
  if (eventDate !== undefined) values.eventDate = eventDate;

  const startTime = requiredTime(body, 'startTime', errors, { required });
  if (startTime !== undefined) values.startTime = startTime;

  const endTime = requiredTime(body, 'endTime', errors, { required });
  if (endTime !== undefined) values.endTime = endTime;

  // date_start / date_end drive the derived upcoming/ongoing/past state. For a
  // single-day event they both equal event_date, so the admin form only has to
  // send them when an event runs across several days.
  const dateStart = requiredDate(body, 'dateStart', errors, { required: false });
  const dateEnd = requiredDate(body, 'dateEnd', errors, { required: false });

  values.dateStart = dateStart || eventDate;
  values.dateEnd = dateEnd || eventDate;

  if (!values.dateStart) delete values.dateStart;
  if (!values.dateEnd) delete values.dateEnd;

  if (values.dateStart && values.dateEnd && values.dateEnd < values.dateStart) {
    errors.push({
      field: 'dateEnd',
      message: 'The end date cannot be earlier than the start date.',
    });
  }
  if (values.startTime && values.endTime && values.endTime <= values.startTime) {
    errors.push({
      field: 'endTime',
      message: 'The end time must be later than the start time.',
    });
  }

  // ---- money, capacity and flags ------------------------------------------
  const goalAmount = requiredNumber(body, 'goalAmount', errors, {
    required: false,
    min: 0,
    max: 99_999_999_999,
    integer: false,
  });
  if (goalAmount !== undefined) values.goalAmount = goalAmount;
  else if (required) values.goalAmount = 0;

  const isFree = requiredBoolean(body, 'isFree', errors, {
    required: false,
    fallback: required ? false : undefined,
  });
  if (isFree !== undefined) values.isFree = isFree;

  const capacity = requiredNumber(body, 'capacity', errors, {
    required: false,
    min: 1,
    max: 4_294_967_295,
    integer: true,
  });
  // An empty capacity is meaningful: it means "no limit".
  if (capacity !== undefined) values.capacity = capacity;
  else if (body.capacity === '' || body.capacity === null) values.capacity = null;

  const status = requiredEnum(body, 'status', PUBLISH_STATUSES, errors, {
    required: false,
    fallback: required ? 'active' : undefined,
  });
  if (status !== undefined) values.status = status;

  // ---- optional image -----------------------------------------------------
  const imageUrl = requiredText(body, 'imageUrl', errors, {
    required: false,
    max: 400,
  });
  if (imageUrl !== undefined) values.imageUrl = imageUrl;

  // ---- optional ticket tiers ---------------------------------------------
  if (body.ticketTypes !== undefined) {
    if (!Array.isArray(body.ticketTypes)) {
      errors.push({ field: 'ticketTypes', message: 'ticketTypes must be a list.' });
    } else {
      const tiers = body.ticketTypes.map((ticket, index) =>
        validateTicketType(ticket, index, errors)
      );
      values.ticketTypes = tiers.filter(Boolean);
      if (values.ticketTypes.length === 0) delete values.ticketTypes;
    }
  }

  throwIfInvalid(errors, 'The event could not be saved because some fields are invalid.');
  return values;
}

/** One ticket tier inside an event body. */
function validateTicketType(ticket = {}, index, errors) {
  const label = `ticketTypes[${index}]`;

  const ticketName = requiredText(ticket, 'ticketName', errors, {
    required: true,
    min: 2,
    max: 100,
  });
  if (ticketName === undefined) return null;

  const price = requiredNumber(ticket, 'price', errors, {
    required: true,
    min: 0,
    max: 9_999_999,
    integer: false,
  });

  const quantityAvailable = requiredNumber(ticket, 'quantityAvailable', errors, {
    required: false,
    min: 0,
    max: 4_294_967_295,
    integer: true,
  });

  return {
    ticketName,
    price: price === undefined ? 0 : price,
    quantityAvailable:
      quantityAvailable === undefined || ticket.quantityAvailable === ''
        ? null
        : quantityAvailable,
    description:
      ticket.description === undefined || ticket.description === null
        ? null
        : String(ticket.description).slice(0, 255),
  };
}

/**
 * POST /api/events
 * @param {object} body
 * @returns {Promise<object>} the created event
 */
async function createEvent(body) {
  const values = validateEventBody(body, { partial: false });
  return repository.insertEvent(values);
}

/**
 * PUT /api/events/:id
 * A partial update: only the fields sent are changed. Sending `{}` is a 400,
 * because that is more likely to be a client bug than a real request.
 *
 * @throws {HttpError} 400 for an invalid id, 404 when no event has that id
 */
async function updateEvent(rawId, body) {
  const eventId = parseEventId(rawId);

  const values = validateEventBody(body, { partial: true });
  if (Object.keys(values).length === 0) {
    throw HttpError.badRequest(
      'No fields were supplied. Send only the fields you want to change.'
    );
  }

  const event = await repository.updateEvent(eventId, values);
  if (!event) {
    throw HttpError.notFound(
      `No charity event was found with id ${eventId}, so there was nothing to update.`
    );
  }
  return event;
}

/**
 * DELETE /api/events/:id
 *
 * Enforces the data-integrity rule from the brief: an event that has received
 * registrations must not be deleted. The repository performs the check and the
 * delete as one transaction; this layer turns the outcome into the right HTTP
 * status and a message a member of staff can act on.
 *
 * @throws {HttpError} 400 for an invalid id, 404 when it does not exist,
 *        409 when registrations block the delete
 */
async function deleteEvent(rawId) {
  const eventId = parseEventId(rawId);

  const outcome = await repository.deleteEvent(eventId);

  if (outcome.reason === 'not-found') {
    throw HttpError.notFound(
      `No charity event was found with id ${eventId}, so there was nothing to delete.`
    );
  }

  if (outcome.reason === 'has-registrations') {
    const count = outcome.registrationCount;
    throw HttpError.conflict(
      `"${outcome.eventName}" cannot be deleted because ${count} ` +
        `${count === 1 ? 'registration has' : 'registrations have'} already been recorded for it. ` +
        'The brief requires an event to be deleted only when it has not yet received any registrations. ' +
        'Set its status to "suspended" instead if it should no longer appear on the public website.',
      {
        eventId,
        eventName: outcome.eventName,
        registrationCount: count,
        suggestion: 'suspend-instead',
      }
    );
  }

  return { eventId, eventName: outcome.eventName, deleted: true };
}

/** Shared id parsing so all three endpoints reject a bad id identically. */
function parseEventId(rawId) {
  const eventId = Number(rawId);
  if (!Number.isInteger(eventId) || eventId <= 0) {
    throw HttpError.badRequest(
      `"${rawId}" is not a valid event id. Event ids are positive whole numbers.`
    );
  }
  return eventId;
}

module.exports = {
  createEvent,
  updateEvent,
  deleteEvent,
  validateEventBody,
  validateTicketType,
  parseEventId,
  PUBLISH_STATUSES,
  KNOWN_IMAGES,
};
