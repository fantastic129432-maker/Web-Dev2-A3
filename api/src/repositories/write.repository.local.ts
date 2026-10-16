/**
 * @file The offline twin of write.repository.mysql.ts.
 *
 * It provides insertEvent, updateEvent and deleteEvent for DATA_SOURCE=local.
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

import store = require('./local-store');
import type { DataRecord, EventWriteRepository } from '../types';
import registrationStore = require('./registration.repository.local');

/**
 * Report whether a seeded lookup table contains a row with this id.
 *
 * The comparison is numeric because the snapshot mixes numbers and numeric
 * strings, which is also how the decorated rows come to compare equal.
 *
 * @param collection - The raw snapshot table to search.
 * @param key - The column name to match, such as `category_id`.
 * @param value - The id to look for.
 * @returns `true` when a row with that id exists.
 */
function existsIn(collection: DataRecord[], key: string, value: unknown): boolean {
  return collection.some((row) => Number(row[key]) === Number(value));
}

/**
 * Validate referential integrity the way MySQL's foreign keys would.
 *
 * Offline there is no database to refuse a dangling id, so every unknown
 * organisation, category or venue is collected and reported as one 400 with a
 * per-field entry - the same response the MySQL half produces when it translates
 * ER_NO_REFERENCED_ROW_2.
 *
 * @param values - The validated event values about to be written.
 * @throws HttpError with status 400 listing every selected value that does not exist.
 */
function assertReferences(values: DataRecord): void {
  const { HttpError } = require('../utils/errors') as typeof import('../utils/errors');
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

/**
 * Refuse two ticket tiers of one event that share a name.
 *
 * MySQL enforces this with uq_ticket_event_name and answers 409 through
 * translateMysqlError when ER_DUP_ENTRY comes back; offline there is no key to
 * lean on, so the rule is stated explicitly. The name is compared as text, which
 * is what a case-insensitive database collation does with 'General' and
 * 'general', so both data sources refuse the same submissions.
 *
 * It is called before anything is stored as well as before the tiers are
 * written, because the offline store has no transaction to roll back: a create
 * the database would refuse has to leave no event behind at all, and the check
 * is only cheap enough to run twice because a submission carries a handful of
 * tiers at most.
 *
 * @param ticketTypes - The validated tiers about to be written. May be omitted, in which case there is nothing to check.
 * @throws HttpError with status 409 when two tiers share a name.
 */
function assertUniqueTicketTypeNames(ticketTypes?: DataRecord[]): void {
  if (!Array.isArray(ticketTypes)) return;

  const { HttpError } = require('../utils/errors') as typeof import('../utils/errors');
  const seen = new Set<string>();

  for (const ticket of ticketTypes) {
    const name = String(ticket.ticketName);
    if (seen.has(name.toLowerCase())) {
      throw HttpError.conflict('A record with these details already exists.', {
        field: 'ticketTypes',
        ticketName: name,
        hint: 'Two ticket types of one event cannot share a name; rename one of them.',
      });
    }
    seen.add(name.toLowerCase());
  }
}

/**
 * The camelCase payload field for each database column.
 *
 * The same mapping as toColumns() in the MySQL half, kept explicit so the mirror
 * stores the identical column names and a test can compare the two rows directly.
 */
const FIELD_TO_COLUMN: Record<string, string> = {
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
 * data sources store the same values, and the timestamps are maintained by hand
 * where MySQL would use CURRENT_TIMESTAMP and ON UPDATE CURRENT_TIMESTAMP.
 *
 * @param values - The validated values in camelCase.
 * @param eventId - The id the row is stored under, allocated for a create and unchanged for an update.
 * @param base - The existing raw row when updating. May be omitted, in which case a new row is built with the column defaults.
 * @returns The raw row in the snapshot's snake_case shape.
 */
function toRow(values: DataRecord, eventId: number, base?: DataRecord): DataRecord {
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

/**
 * "YYYY-MM-DD HH:MM:SS" in local time, matching a MySQL TIMESTAMP literal.
 *
 * @returns The current moment as the snapshot and the driver both write it.
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
 * Read the row back through the admin view, as the MySQL version does.
 *
 * The require is lazy because ./index requires this module while it is being
 * loaded, so a top-level import here would be a cycle; by the time a write
 * happens the merged repository exists.
 *
 * @param eventId - The id of the event to read back.
 * @returns The event as the merged repository reports it, or `null` when it is gone.
 */
function readBack(eventId: number): Promise<DataRecord | null> {
  const index = require('./index') as typeof import('./index');
  return index.findEventById(eventId, { status: 'all' });
}

/**
 * The offline write half of the repository contract.
 *
 * It is checked against `EventWriteRepository` at compile time, and
 * write.repository.mysql.ts exposes exactly the same four methods so the two data
 * sources stay interchangeable.
 */
const writeRepository: EventWriteRepository = {
  /**
   * Insert one event and return it as the API will report it.
   *
   * References are validated first, because the mirror has no foreign keys to do
   * it. A brand-new event with no tiers would show no price on the home page, so
   * the tier list is stored alongside the event when the form supplies one, and
   * the row is read back afterwards so the response carries the stored defaults.
   *
   * The tier names are checked before the event row is stored, which is the
   * offline equivalent of the MySQL create's transaction: where MySQL rolls the
   * event back when a tier is refused, the mirror simply never writes it, so a
   * create that answers 409 leaves no event behind in either data source.
   *
   * @param values - The validated event values in camelCase.
   * @returns The created event, read back through the merged repository with its ticket tiers included.
   * @throws HttpError with status 400 when a selected organisation, category or venue does not exist, and 409 when two of the submitted tiers share a name.
   */
  async insertEvent(values) {
    assertReferences(values);
    assertUniqueTicketTypeNames(values.ticketTypes);

    const eventId = store.allocateEventId();
    const row = toRow(values, eventId, undefined);

    store.saveEvent(row);

    // A brand-new event with no tiers would show no Price on the home page, so
    // the tier list is stored alongside the event when the form supplies one.
    if (Array.isArray(values.ticketTypes) && values.ticketTypes.length > 0) {
      saveTicketTypes(eventId, values.ticketTypes);
    }

    // The row was saved a moment ago, so the read-back can never be null here.
    return (await readBack(eventId)) as DataRecord;
  },

  /**
   * Update one event as a partial update.
   *
   * Only the fields present in the payload are changed, because toRow starts from
   * the stored row and overwrites only what it is given. The MySQL version writes
   * tiers only for an event that has none yet, so the offline twin does the same
   * rather than replacing existing tiers.
   *
   * @param eventId - The id of the event to change.
   * @param values - The validated fields to change, in camelCase.
   * @returns The updated event, read back through the merged repository, or `null` when no event has that id.
   * @throws HttpError with status 400 when a selected organisation, category or venue does not exist.
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
   * Delete one event, refusing when it already has registrations.
   *
   * The rule is the one the brief states, and offline it has to be enforced
   * explicitly: there is no ON DELETE RESTRICT foreign key to lean on, so the
   * registration count is read here and the delete is abandoned when it is not
   * zero. The outcome is the same object the MySQL half returns, which is what
   * lets the service layer turn either one into the same HTTP response. Removing
   * the row cascades in MySQL to ticket_types and donations; the mirror simply
   * hides the row, so nothing else has to be deleted.
   *
   * @param eventId - The id of the event to delete.
   * @returns The outcome: `deleted: true` with the event name, or `deleted: false` with the reason `not-found` or `has-registrations` and the blocking count.
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

  /**
   * Store the ticket tiers of a newly created event.
   *
   * MySQL's replaceTicketTypes returns early when the event already has tiers, so
   * the offline twin answers the same instead of appending a second set: both
   * data sources used to answer differently here, which is a defect even while
   * no HTTP route reaches this method, because the repository is the published
   * contract and one call must not have two meanings. The names are checked for
   * the same reason - MySQL would refuse a duplicate through
   * uq_ticket_event_name.
   *
   * @param eventId - The event the tiers belong to.
   * @param ticketTypes - The validated tiers to store.
   * @throws HttpError with status 409 when two of the submitted tiers share a name.
   */
  async replaceTicketTypes(eventId, ticketTypes) {
    if (store.ticketTypesFor(Number(eventId)).length > 0) return;
    saveTicketTypes(Number(eventId), ticketTypes);
  },
};

/**
 * Add ticket tiers for an event.
 *
 * The seeded tier rows are never touched: a new event gets brand-new ids from
 * the store's allocator (the offline equivalent of AUTO_INCREMENT), so the demo
 * data stays exactly as the marker sees it in 02_seed.sql.
 *
 * The duplicate-name check runs here as well as before an insert, so every path
 * that writes tiers - a create, an update of an event that has none, and a direct
 * replaceTicketTypes call - is refused the same submission MySQL would refuse.
 *
 * @param eventId - The event the tiers belong to.
 * @param ticketTypes - The validated tiers to add.
 * @throws HttpError with status 409 when two of the submitted tiers share a name.
 */
function saveTicketTypes(eventId: number, ticketTypes: DataRecord[]): void {
  assertUniqueTicketTypeNames(ticketTypes);

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

/**
 * The write repository, and the only thing this module exports.
 *
 * THE HELPERS THAT USED TO RIDE ALONG
 *   When the API was JavaScript this module attached `toRow`,
 *   `assertReferences`, `assertUniqueTicketTypeNames` and `nowStamp` to
 *   `module.exports` after the fact, so a caller could reach a private helper
 *   through the repository object. The TypeScript migration kept all four
 *   attachments, and each of them was then reachable from outside the module
 *   while nothing outside the module ever reached for one: repository member
 *   searches for all four names returned only this file (their own call sites
 *   inside it) plus `docs/api-reference.md`, and the statements above the
 *   original block that said the helpers were there for the test suite were
 *   wrong - `tests/run-tests.js` requires `./repositories`,
 *   `./repositories/repository.local`, `./repositories/repository.mysql` and
 *   `./repositories/registration.repository.local`, and never this module, so it
 *   could not have exercised them. The four attachments were therefore removed:
 *   every one of them is still called internally, by name, a few lines above.
 *
 * WHY THE HELPERS THEMSELVES STAY
 *   They are the reasoning this file exists to record, and their own blocks
 *   carry it: `assertReferences` names the three foreign keys and why the
 *   offline half reproduces them (see also the note in
 *   write.repository.mysql.ts), and `assertUniqueTicketTypeNames` records why
 *   the twin of `uq_ticket_event_name` has to be stated explicitly when there is
 *   no key to lean on. Deleting the exports removes an unused way IN, not the
 *   rules themselves.
 */
export = writeRepository;
