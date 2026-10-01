/**
 * src/repositories/write.repository.local.js
 * ---------------------------------------------------------------------------
 * The offline twin of write.repository.mysql.js: insertEvent, updateEvent and
 * deleteEvent for DATA_SOURCE=local.
 *
 * The rules are the same, only the storage differs. In particular the delete
 * rule is implemented identically:
 *
 *   "the event can only be deleted if it has not yet received any
 *    registrations. If registrations exist, the deletion attempt should be
 *    blocked, and an appropriate error response should be returned."
 *
 * MySQL enforces that with the ON DELETE RESTRICT foreign key. Offline there is
 * no database to lean on, so the check is explicit - which is also why the
 * automated test suite runs against this implementation: it is the one place
 * where the rule can be verified without a MySQL server, and the identical
 * observable behaviour (409 with reason 'has-registrations') is what both
 * implementations promise.
 */
'use strict';

const store = require('./local-store');
const registrationStore = require('./registration.repository.local');

/** Does a row exist for this id in the given seeded lookup table? */
function existsIn(collection, key, value) {
  return collection.some((row) => Number(row[key]) === Number(value));
}

/**
 * Validate referential integrity the way MySQL's foreign keys would.
 * @throws {HttpError} 400 with one entry per unknown id
 */
function assertReferences(values) {
  const { HttpError } = require('../utils/errors');
  const problems = [];

  if (values.organizationId !== undefined) {
    if (!existsIn(store.data.organizations, 'organization_id', values.organizationId)) {
      problems.push({
        field: 'organizationId',
        message: `No organisation has id ${values.organizationId}.`,
      });
    }
  }
  if (values.categoryId !== undefined) {
    if (!existsIn(store.data.categories, 'category_id', values.categoryId)) {
      problems.push({
        field: 'categoryId',
        message: `No category has id ${values.categoryId}.`,
      });
    }
  }
  if (values.locationId !== undefined) {
    if (!existsIn(store.data.locations, 'location_id', values.locationId)) {
      problems.push({
        field: 'locationId',
        message: `No venue has id ${values.locationId}.`,
      });
    }
  }

  if (problems.length > 0) {
    throw HttpError.badRequest(
      'One of the selected values (organisation, category or venue) does not exist.',
      problems
    );
  }
}

/** The camelCase payload field for each database column. */
const FIELD_TO_COLUMN = {
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

/**
 * Build a raw event row from a validated payload.
 *
 * `base` is the row being updated (undefined for a create). MySQL supplies its
 * own defaults for anything left out; the equivalents are applied here so both
 * data sources store the same values.
 */
function toRow(values, eventId, base) {
  const row = base ? { ...base } : {};
  row.event_id = eventId;

  for (const [field, column] of Object.entries(FIELD_TO_COLUMN)) {
    if (values[field] === undefined) continue;
    row[column] = typeof values[field] === 'boolean' ? Number(values[field]) : values[field];
  }

  if (!base) {
    // Column defaults from 01_schema.sql.
    row.goal_amount = row.goal_amount === undefined ? 0 : row.goal_amount;
    row.is_free = row.is_free === undefined ? 0 : row.is_free;
    row.capacity = row.capacity === undefined ? null : row.capacity;
    row.status = row.status === undefined ? 'active' : row.status;
    row.image_url = row.image_url === undefined ? null : row.image_url;
    row.created_at = nowStamp();
  }

  // ON UPDATE CURRENT_TIMESTAMP in MySQL.
  row.updated_at = nowStamp();

  return row;
}

/** "YYYY-MM-DD HH:MM:SS", matching a MySQL TIMESTAMP literal. */
function nowStamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
    `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
  );
}

/** Read the row back through the admin view, as the MySQL version does. */
function readBack(eventId) {
  const index = require('./index');
  return index.findEventById(eventId, { status: 'all' });
}

const writeRepository = {
  /**
   * POST /api/events
   * @returns {Promise<object>} the created event, including its ticket tiers
   */
  async insertEvent(values) {
    assertReferences(values);

    const eventId = store.allocateEventId();
    const row = toRow(values, eventId, undefined);

    store.saveEvent(row);

    // A brand-new event with no tiers would show no Price on the home page, so
    // the tier list is stored alongside the event when the form supplies one.
    if (Array.isArray(values.ticketTypes) && values.ticketTypes.length > 0) {
      saveTicketTypes(eventId, values.ticketTypes);
    }

    return readBack(eventId);
  },

  /**
   * PUT /api/events/:id - partial update.
   * @returns {Promise<object|null>} the updated event, or null when it does not exist
   */
  async updateEvent(eventId, values) {
    const base = store.findEventRow(eventId);
    if (!base) return null;

    assertReferences(values);

    store.saveEvent(toRow(values, Number(eventId), base));

    // The MySQL version only writes tiers for an event that has none yet, so
    // the offline twin does the same rather than replacing existing tiers.
    if (Array.isArray(values.ticketTypes) && values.ticketTypes.length > 0) {
      if (store.ticketTypesFor(Number(eventId)).length === 0) {
        saveTicketTypes(Number(eventId), values.ticketTypes);
      }
    }

    return readBack(eventId);
  },

  /**
   * DELETE /api/events/:id - blocked while registrations exist.
   * @returns {Promise<{deleted:boolean, reason?:string}>}
   */
  async deleteEvent(eventId) {
    const row = store.findEventRow(eventId);
    if (!row) return { deleted: false, reason: 'not-found' };

    const registrationCount = registrationStore.countByEventId(eventId);
    if (registrationCount > 0) {
      return {
        deleted: false,
        reason: 'has-registrations',
        eventName: row.event_name,
        registrationCount,
      };
    }

    // MySQL would cascade to ticket_types and donations.
    store.removeEvent(Number(eventId));
    return { deleted: true, eventName: row.event_name };
  },

  /** Does this (event, email) pair already exist? */
  async registrationExists(eventId, email) {
    return registrationStore.existsForEventAndEmail(eventId, email);
  },

  /** How many registrations an event has. */
  async countRegistrations(eventId) {
    return registrationStore.countByEventId(eventId);
  },

  /** Store the ticket tiers of a newly created event. */
  async replaceTicketTypes(eventId, ticketTypes) {
    saveTicketTypes(eventId, ticketTypes);
  },
};

/**
 * Add ticket tiers for an event.
 *
 * The seeded tier rows are never touched: a new event gets brand-new ids from
 * the store's allocator (the offline equivalent of AUTO_INCREMENT), so the demo
 * data stays exactly as the marker sees it in 02_seed.sql.
 */
function saveTicketTypes(eventId, ticketTypes) {
  for (const ticket of ticketTypes) {
    store.addedTicketTypes.push({
      ticket_type_id: store.allocateTicketTypeId(),
      event_id: Number(eventId),
      ticket_name: ticket.ticketName,
      price: Number(ticket.price || 0),
      quantity_available:
        ticket.quantityAvailable === undefined || ticket.quantityAvailable === null
          ? null
          : Number(ticket.quantityAvailable),
      description: ticket.description === undefined ? null : ticket.description,
    });
  }
}

module.exports = writeRepository;
module.exports.toRow = toRow;
module.exports.assertReferences = assertReferences;
module.exports.nowStamp = nowStamp;
