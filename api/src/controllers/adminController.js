/**
 * src/controllers/adminController.js
 * ---------------------------------------------------------------------------
 * Assessment 3, Part 2 - the HTTP layer for the admin-side endpoints.
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

const eventService = require('../services/eventService');
const eventWriteService = require('../services/eventWriteService');
const repository = require('../repositories');
const { asyncHandler } = require('../utils/asyncHandler');

/** The standard success envelope used across the whole API. */
function envelope(resource, data, extraMeta = {}) {
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
 * GET /api/admin/events
 * "displays a complete list of all registered events, regardless of their
 * status (Active, Past, Suspended)".
 *
 * Query parameters: publishStatus, state, category, location, city, keyword,
 * sort, direction, limit, offset, page.
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

/** GET /api/admin/events/:id - one event whatever its status. */
const getEventById = asyncHandler(async (req, res) => {
  const event = await eventService.getEventById(req.params.id, { status: 'all' });
  res.json(envelope('event', event, { view: 'admin' }));
});

/**
 * POST /api/admin/events
 * Also mounted as POST /api/events.
 * Answers 201 Created with a Location header pointing at the new resource,
 * which is the RESTful answer to "you have created something".
 */
const createEvent = asyncHandler(async (req, res) => {
  const event = await eventWriteService.createEvent(req.body);

  res
    .status(201)
    .location(`/api/events/${event.eventId}`)
    .json(envelope('event', event, { created: true }));
});

/**
 * PUT /api/admin/events/:id
 * Also mounted as PUT /api/events/:id.
 * A partial update: only the fields present in the body are changed.
 */
const updateEvent = asyncHandler(async (req, res) => {
  const event = await eventWriteService.updateEvent(req.params.id, req.body);
  res.json(envelope('event', event, { updated: true }));
});

/**
 * DELETE /api/admin/events/:id
 * Also mounted as DELETE /api/events/:id.
 *
 * 204 No Content on success; 404 when there is no such event; and 409 Conflict
 * when the event already has registrations, which is the data-integrity rule
 * the brief requires.
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
 * GET /api/admin/reference-data
 * Organisations, categories and venues for the "new event" and "update event"
 * dropdowns, in one request so the form is ready in a single round trip.
 */
const getReferenceData = asyncHandler(async (req, res) => {
  const reference = await eventService.getReferenceData();
  res.json(envelope('reference-data', reference));
});

module.exports = {
  listAllEvents,
  getEventById,
  createEvent,
  updateEvent,
  deleteEvent,
  getReferenceData,
};
