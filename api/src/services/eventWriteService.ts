/**
 * @file The business rules behind the three admin write endpoints.
 *
 * Assessment 3, Part 2:
 *
 *   createEvent()  POST   /api/events
 *   updateEvent()  PUT    /api/events/:id
 *   deleteEvent()  DELETE /api/events/:id
 *
 * Why a separate service from eventService.ts? eventService owns the read
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

import repository = require('../repositories');
import type { DataRecord, UntrustedInput, ValidationIssue } from '../types';
import { HttpError } from '../utils/errors';
const {
  requiredDate,
  requiredTime,
  requiredText,
  requiredNumber,
  requiredBoolean,
  requiredEnum,
  requiredId,
  throwIfInvalid,
} = require('../utils/validators') as typeof import('../utils/validators');

/** The publishing states the events.status column allows. */
const PUBLISH_STATUSES = ['active', 'suspended', 'cancelled'];

/**
 * The image files the client website ships with.
 *
 * A free-text image_url is accepted as well (an external URL), but choosing from
 * this list guarantees the event card shows real artwork.
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
 * A create and an update share this function because they validate the same
 * fields; the options object's `partial` flag is the only difference, and it is
 * what makes PUT a partial update - a field that is absent is left alone rather
 * than being blanked. The size bounds repeat the column definitions
 * (`goal_amount` is `DECIMAL(12,2)`, so 9,999,999,999.99 is the largest value it
 * can hold) on purpose: a value the column cannot store used to pass validation
 * and then be refused by MySQL, which surfaced as a 500 instead of the 400 a
 * validation failure deserves.
 *
 * @param body - The untrusted request body. May be omitted, in which case a create fails validation for every required field.
 * @returns The values to write, in camelCase, with defaults filled in and empty optional fields left out.
 * @throws HttpError with status 400 listing every invalid field, when at least one field could not be accepted.
 */
function validateEventBody(
  body: UntrustedInput = {},
  { partial = false }: { partial?: boolean } = {}
): DataRecord {
  const errors: ValidationIssue[] = [];
  const required = !partial;
  const values: DataRecord = {};

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
  // The bound matches events.goal_amount, which is DECIMAL(12,2): the largest
  // value it can hold is 9,999,999,999.99. A larger number used to pass validation
  // and then be rejected by MySQL with an out-of-range error, which surfaced as a
  // 500 instead of the 400 a validation failure deserves.
  const goalAmount = requiredNumber(body, 'goalAmount', errors, {
    required: false,
    min: 0,
    max: 9_999_999_999.99,
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
      const tiers = body.ticketTypes.map((ticket: UntrustedInput, index: number) =>
        validateTicketType(ticket, index, errors)
      );
      values.ticketTypes = tiers.filter(Boolean);
      if (values.ticketTypes.length === 0) delete values.ticketTypes;
    }
  }

  throwIfInvalid(errors, 'The event could not be saved because some fields are invalid.');
  return values;
}

/**
 * Validate one ticket tier inside an event body.
 *
 * The index is used in the field name (`ticketTypes[0].price`), because that is
 * what lets the admin form point at the exact row that is wrong. A tier without
 * a name is dropped by returning `null` rather than throwing, so the remaining
 * tiers are still reported and the caller can filter the nulls out.
 *
 * @param ticket - The untrusted ticket tier object. May be omitted, in which case the tier is reported as missing its name.
 * @param index - The tier's position in the submitted list, used in the field names of any problem.
 * @param errors - The shared problem list that this helper appends to.
 * @returns The normalised tier, or `null` when it has no usable name.
 */
function validateTicketType(
  ticket: UntrustedInput = {},
  index: number,
  errors: ValidationIssue[]
): DataRecord | null {
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
 * Create one event.
 *
 * A create is never partial, so `required` is true throughout validation and the
 * optional fields fall back to their column defaults. The controller turns the
 * returned row into a 201 with a `Location` header.
 *
 * @param body - The untrusted request body describing the event.
 * @returns The stored event, including its new id and its ticket tiers.
 * @throws HttpError with status 400 when a field is invalid or a selected organisation, category or venue does not exist, and 409 when a record with those details already exists.
 */
async function createEvent(body: UntrustedInput): Promise<DataRecord> {
  const values = validateEventBody(body, { partial: false });
  return repository.insertEvent(values);
}

/**
 * Update one event as a partial update.
 *
 * Only the fields sent are changed, and sending `{}` is a 400 because that is
 * more likely to be a client bug than a real request - it would otherwise be a
 * silent no-op reported as success.
 *
 * @param rawId - The id from the route parameter, still unvalidated text.
 * @param body - The untrusted request body holding only the fields to change.
 * @returns The event as it now stands, including its ticket tiers.
 * @throws HttpError with status 400 for an invalid id, an empty body or a value the database refuses, and 404 when no event has that id.
 */
async function updateEvent(rawId: string | number, body: UntrustedInput): Promise<DataRecord> {
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
 * Delete one event.
 *
 * Enforces the data-integrity rule from the brief: an event that has received
 * registrations must not be deleted. The repository performs the check and the
 * delete as one transaction; this layer turns the outcome into the right HTTP
 * status and a message a member of staff can act on - which is why the 409 names
 * how many registrations block it and offers suspending as the alternative.
 *
 * @param rawId - The id from the route parameter, still unvalidated text.
 * @returns The id and name of the event that was deleted.
 * @throws HttpError with status 400 for an invalid id, 404 when no event has that id, and 409 when registrations block the delete.
 */
async function deleteEvent(rawId: string | number): Promise<{
  eventId: number;
  eventName: string;
  deleted: true;
}> {
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

/**
 * Parse an event id, so all three endpoints reject a bad id identically.
 *
 * One helper rather than three copies is what keeps the message and the status
 * the same whichever write route was called.
 *
 * @param rawId - The id from the route parameter, still unvalidated text.
 * @returns The id as a number, once it is known to be a positive whole number.
 * @throws HttpError with status 400 when the value is not a positive whole number.
 */
function parseEventId(rawId: string | number): number {
  const eventId = Number(rawId);
  if (!Number.isInteger(eventId) || eventId <= 0) {
    throw HttpError.badRequest(
      `"${rawId}" is not a valid event id. Event ids are positive whole numbers.`
    );
  }
  return eventId;
}

/**
 * The service's public surface.
 *
 * The three write operations are used by the admin controller; the two
 * validators and `parseEventId` are exported so the tests can exercise a rule
 * without going through Express, and the two constant lists are exported so the
 * tests and the admin form refer to the same values the validator enforces.
 */
export = {
  createEvent,
  updateEvent,
  deleteEvent,
  validateEventBody,
  validateTicketType,
  parseEventId,
  PUBLISH_STATUSES,
  KNOWN_IMAGES,
};
