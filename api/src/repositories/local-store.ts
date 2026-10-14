/**
 * src/repositories/local-store.ts
 * ---------------------------------------------------------------------------
 * The mutable state behind DATA_SOURCE=local.
 *
 * local-data.ts is a frozen snapshot generated from database/02_seed.sql. This
 * module wraps it in the smallest possible layer that lets the offline data
 * source support Assessment 3's write operations:
 *
 *   * `overrides`     events created or edited at run time, keyed by event id
 *   * `removedEventIds`  events deleted at run time
 *   * `registrations` a copy of the seed rows that inserts and deletes mutate
 *   * `nextEventId` / `nextRegistrationId`  AUTO_INCREMENT equivalents
 *
 * Only the offline mode has this state. In MySQL the database itself is the
 * state, which is exactly why this file is not part of the submitted data path
 * and why the two repositories must expose the same interface instead of
 * sharing an implementation.
 *
 * Deliberately import-free (it only reads local-data.ts) so that
 * repository.local.ts, write.repository.local.ts and
 * registration.repository.local.ts can all use it without an import cycle.
 */
'use strict';

import type { DataRecord } from '../types';

import data = require('./local-data');

/** Events created or updated at run time, keyed by event id. */
const overrides = new Map<number, DataRecord>();

/** Ids of events deleted at run time. */
const removedEventIds = new Set<number>();

/** A working copy of the seeded registrations. */
const registrations: DataRecord[] = data.event_registrations.map((row) => ({ ...row }));

/**
 * Ticket tiers added at run time for newly created events.
 *
 * They are kept here rather than pushed into data.ticket_types so the generated
 * local-data.ts array is never mutated - RESET simply empties this list.
 */
const addedTicketTypes: DataRecord[] = [];

/** AUTO_INCREMENT equivalents. */
let nextEventId =
  data.events.reduce((max, row) => Math.max(max, Number(row.event_id)), 0) + 1;
let nextRegistrationId =
  registrations.reduce((max, row) => Math.max(max, Number(row.registration_id)), 0) + 1;
let nextTicketTypeId =
  data.ticket_types.reduce((max, row) => Math.max(max, Number(row.ticket_type_id)), 0) + 1;

/** The seeded event rows with every run-time change applied. */
function effectiveEvents(): DataRecord[] {
  const rows = data.events
    .filter((row) => !removedEventIds.has(row.event_id))
    .map((row) => (overrides.has(row.event_id) ? overrides.get(row.event_id)! : row));

  // Events created at run time are appended, so they take their place at the
  // end of the standard date ordering exactly as a fresh primary key would.
  for (const [eventId, row] of overrides) {
    if (!data.events.some((seed) => seed.event_id === eventId)) rows.push(row);
  }

  return rows;
}

/** Insert or replace one event row. */
function saveEvent(row: DataRecord): DataRecord {
  overrides.set(row.event_id, row);
  return row;
}

/** Remove one event row. */
function removeEvent(eventId: number): void {
  removedEventIds.add(eventId);
  overrides.delete(eventId);
}

/** Snapshot of the current event rows (used when an update needs the old one). */
function findEventRow(eventId: number): DataRecord | null {
  return effectiveEvents().find((row) => row.event_id === Number(eventId)) || null;
}

/** Every ticket tier of one event: the seeded rows plus any added at run time. */
function ticketTypesFor(eventId: number): DataRecord[] {
  const seeded = data.ticket_types.filter(
    (row) => Number(row.event_id) === Number(eventId)
  );
  const added = addedTicketTypes.filter(
    (row) => Number(row.event_id) === Number(eventId)
  );
  return seeded.concat(added);
}

/** Every ticket tier, seeded and added, so @see repository.local.ts decorate(). */
function allTicketTypes(): DataRecord[] {
  return data.ticket_types.concat(addedTicketTypes);
}

function allocateEventId(): number {
  const id = nextEventId;
  nextEventId += 1;
  return id;
}

function allocateRegistrationId(): number {
  const id = nextRegistrationId;
  nextRegistrationId += 1;
  return id;
}

/**
 * The ticket_type_id equivalent of AUTO_INCREMENT. Every new tier takes the
 * next number after the highest id ever allocated, so two events created in the
 * same session can never be given the same tier id - which is what the previous
 * "highest seeded + count" arithmetic got wrong.
 */
function allocateTicketTypeId(): number {
  const id = nextTicketTypeId;
  nextTicketTypeId += 1;
  return id;
}

/* ------------------------------------------------------------------ resets */

/**
 * Restore the seeded state. Used by the automated test suite so one test's
 * writes cannot affect the next one.
 */
function reset(): void {
  overrides.clear();
  removedEventIds.clear();
  addedTicketTypes.length = 0;
  registrations.length = 0;
  for (const row of data.event_registrations) registrations.push({ ...row });

  nextEventId =
    data.events.reduce((max, row) => Math.max(max, Number(row.event_id)), 0) + 1;
  nextRegistrationId =
    registrations.reduce((max, row) => Math.max(max, Number(row.registration_id)), 0) + 1;
  nextTicketTypeId =
    data.ticket_types.reduce((max, row) => Math.max(max, Number(row.ticket_type_id)), 0) + 1;
}

export = {
  data,
  overrides,
  removedEventIds,
  registrations,
  addedTicketTypes,
  effectiveEvents,
  ticketTypesFor,
  allTicketTypes,
  saveEvent,
  removeEvent,
  findEventRow,
  allocateEventId,
  allocateRegistrationId,
  allocateTicketTypeId,
  reset,
};
