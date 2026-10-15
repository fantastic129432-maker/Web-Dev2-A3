/**
 * @file The HTTP layer for the admin-side endpoints (Assessment 3, Part 2).
 *
 *   GET    /api/admin/events                  list EVERY event, any status
 *   GET    /api/admin/events/:id              one event, even if suspended
 *   POST   /api/admin/events                  create
 *   PUT    /api/admin/events/:id              update
 *   DELETE /api/admin/events/:id              delete (blocked by registrations)
 *   GET    /api/admin/reference-data          dropdown lists for the forms
 *
 * Why an /api/admin prefix as well as /api/events?
 *   The brief says "You are NOT required to create endpoints to manipulate
 *   category and registration, but you may do it if you want", and it asks for
 *   intuitive, resource-shaped URLs. The admin resources genuinely are the same
 *   events resource seen with different privileges, so the write endpoints are
 *   ALSO mounted at the plain RESTful URLs the brief describes:
 *
 *     POST   /api/events
 *     PUT    /api/events/:id
 *     DELETE /api/events/:id
 *
 *   Both mounts call these same handlers, so there is exactly one
 *   implementation of each rule. The admin mount exists because the admin list
 *   needs to include suspended events, and hiding that behind /api/admin makes
 *   it impossible for a public caller to reach it by accident.
 *
 * Authentication: the brief says "To limit the complexity, assume that
 * authentication is not required." That assumption is stated here explicitly so
 * it is clear it was a deliberate decision and not an oversight - see the
 * security note in docs/api-documentation.md.
 */
'use strict';

import eventService = require('../services/eventService');
import eventWriteService = require('../services/eventWriteService');
import repository = require('../repositories');
import type { DataRecord } from '../types';
import { asyncHandler } from '../utils/asyncHandler';

/**
 * Build the standard success envelope used across the whole API.
 *
 * Every admin response carries the data source and a timestamp, and the caller
 * adds the paging or view metadata that its own endpoint needs; keeping the
 * envelope in one helper is what stops the admin responses drifting away from
 * the public ones.
 *
 * @param resource - The resource name reported in `meta.resource`.
 * @param data - The payload for the `data` member.
 * @param extraMeta - Further metadata merged into `meta`, such as the paging
 *   totals. May be omitted when the endpoint has nothing to add.
 * @returns The complete envelope, ready to be passed to `res.json()`.
 */
function envelope(resource: string, data: unknown, extraMeta: DataRecord = {}) {
  return {
    success: true,
    meta: {
      resource,
      dataSource: repository.driver,
      generatedAt: new Date().toISOString(),
      ...extraMeta,
    },
    data,
  };
}

/**
 * List every event, whatever its status.
 *
 * This is the endpoint the brief describes as "displays a complete list of all
 * registered events, regardless of their status (Active, Past, Suspended)", so
 * it deliberately does not use the public view; `publishStatus` chooses between
 * active, suspended, cancelled and all. The remaining query parameters
 * (state, category, location, city, keyword, sort, direction, limit, offset,
 * page) are the same ones the public list accepts, so an admin search behaves
 * like the public one.
 */
const listAllEvents = asyncHandler(async (req, res) => {
  const result = await eventService.listAllEvents(req.query);

  res.json(
    envelope('events', result.events, {
      view: 'admin',
      total: result.total,
      count: result.count,
      page: result.page,
      totalPages: result.totalPages,
      limit: result.limit,
      offset: result.offset,
      appliedFilters: result.appliedFilters,
    })
  );
});

/**
 * Return one event whatever its status.
 *
 * That is what lets an admin open a suspended or cancelled record for editing.
 * `status: 'all'` is what widens the lookup; the public detail route uses the
 * default and therefore answers 404 for an event that has been withdrawn.
 *
 * `includeContactDetails: true` is the second, deliberate difference from the
 * public route, and it is why the attendee email and phone still reach the admin
 * screens (the registrations page and the event editor both render them). The
 * public endpoint no longer sends them at all, because publishing a named
 * person's full email address and phone number on a public page breaches the
 * Australian Privacy Principles - see REGISTRATION_COLUMNS_PUBLIC in
 * src/repositories/repository.mysql.ts. Asking for them HERE, on the /api/admin
 * mount, is the supported way to get them: it is the surface that exists for
 * staff. The privacy fix must not be undone by widening the public default.
 */
const getEventById = asyncHandler(async (req, res) => {
  const event = await eventService.getEventById(req.params.id, {
    status: 'all',
    includeContactDetails: true,
  });
  res.json(envelope('event', event, { view: 'admin' }));
});

/**
 * Create one event, also mounted as `POST /api/events`.
 *
 * The answer is 201 Created with a `Location` header pointing at the new
 * resource, which is the RESTful way to say "something was created, and here is
 * where it lives". The body is validated by the write service, so a malformed
 * event produces a 400 with the per-field list rather than a database error.
 */
const createEvent = asyncHandler(async (req, res) => {
  const event = await eventWriteService.createEvent(req.body);

  res
    .status(201)
    .location(`/api/events/${event.eventId}`)
    .json(envelope('event', event, { created: true }));
});

/**
 * Update one event, also mounted as `PUT /api/events/:id`.
 *
 * A partial update: only the fields present in the body are changed, which is
 * what lets the admin form submit a single edited field without resending the
 * whole event, and an unknown id is answered with 404 by the write service.
 */
const updateEvent = asyncHandler(async (req, res) => {
  const event = await eventWriteService.updateEvent(req.params.id, req.body);
  res.json(envelope('event', event, { updated: true }));
});

/**
 * Delete one event, also mounted as `DELETE /api/events/:id`.
 *
 * 204 No Content on success; 404 when there is no such event; and 409 Conflict
 * when the event already has registrations, which is the data-integrity rule the
 * brief requires. Because a 204 has no body, the outcome is also reported in
 * headers a client can read - which is what makes the delete easy to check with
 * Postman during the demonstration.
 */
const deleteEvent = asyncHandler(async (req, res) => {
  const result = await eventWriteService.deleteEvent(req.params.id);

  // Clear feedback for anyone testing with Postman: a 204 has no body, so the
  // outcome is also reported in headers a client can read.
  res.setHeader('X-Deleted-Event-Id', String(result.eventId));
  res.setHeader('X-Deleted-Event-Name', encodeURIComponent(result.eventName));
  res.status(204).end();
});

/**
 * Return the organisations, categories and venues the admin forms need.
 *
 * All three lists come back in one request so the "new event" and "update event"
 * dropdowns are ready in a single round trip, which is what keeps the form's
 * loading state to one spinner instead of three.
 */
const getReferenceData = asyncHandler(async (req, res) => {
  const reference = await eventService.getReferenceData();
  res.json(envelope('reference-data', reference));
});

/**
 * The controller's public surface: one handler per admin endpoint.
 *
 * src/routes/apiRoutes.ts mounts each write handler twice - once under
 * `/api/admin` and once at the plain RESTful URL - so this object is the single
 * implementation both mounts share.
 */
export = {
  listAllEvents,
  getEventById,
  createEvent,
  updateEvent,
  deleteEvent,
  getReferenceData,
};
