/**
 * @file HTTP layer for event registration.
 *
 *   POST   /api/events/:id/registrations   the client registration form
 *   GET    /api/events/:id/registrations   the list shown on the event page
 *   GET    /api/registrations              the optional admin list
 *   GET    /api/registrations/:id          one registration
 *   PUT    /api/registrations/:id          admin update
 *   DELETE /api/registrations/:id          admin delete
 *
 * RESTful design notes
 *   * A registration only exists inside an event, so creating one is a POST to
 *     the event's sub-collection: /api/events/7/registrations. That URL says
 *     "add a registration to event 7" without inventing a verb.
 *   * Once created, a registration has its own identity, so it is addressed
 *     directly as /api/registrations/42. That keeps the URL for an update or a
 *     delete short and stable even if the registration were ever moved.
 *   * 201 Created plus a Location header is returned for a successful create,
 *     which is what tells the client where the new resource lives.
 */
'use strict';

import registrationService = require('../services/registrationService');
import repository = require('../repositories');
import type { DataRecord } from '../types';
import { asyncHandler } from '../utils/asyncHandler';

/**
 * Build the standard success envelope used across the whole API.
 *
 * Every registration response carries the data source and a timestamp, and the
 * caller adds the metadata its own endpoint needs; keeping the envelope in one
 * helper is what stops the registration responses drifting away from the event
 * ones.
 *
 * @param resource - The resource name reported in `meta.resource`.
 * @param data - The payload for the `data` member.
 * @param extraMeta - Further metadata merged into `meta`, such as the event id
 *   or the paging totals. May be omitted when the endpoint has nothing to add.
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
 * Register one attendee for one event.
 *
 * The body is validated and "one registration per email per event" is enforced
 * by the service before anything is stored, so the answer is either 201 Created
 * with a `Location` header for the new registration, or a 409 when that address
 * is already registered for the event.
 */
const createRegistration = asyncHandler(async (req, res) => {
  const registration = await registrationService.createRegistration(
    req.params.id,
    req.body
  );

  res
    .status(201)
    .location(`/api/registrations/${registration.registrationId}`)
    .json(
      envelope('registration', registration, {
        created: true,
        eventId: registration.eventId,
      })
    );
});

/**
 * List every registration for one event, newest purchase first.
 *
 * This is the list the event detail page and the admin event screen display, so
 * the metadata names the event and reports how many tickets were sold - the count
 * is derived from the same rows, which is why the page never has to add them up
 * in the browser.
 */
const listForEvent = asyncHandler(async (req, res) => {
  const result = await registrationService.listForEvent(req.params.id);

  res.json(
    envelope('registrations', result.registrations, {
      eventId: result.eventId,
      eventName: result.eventName,
      total: result.total,
      ticketsSold: result.ticketsSold,
      order: 'registeredAt DESC (newest purchase first)',
    })
  );
});

/**
 * List registrations across every event, for the optional admin screen.
 *
 * The filters (eventId, email, keyword) and the paging values come straight from
 * the query string and are validated by the service, so the same endpoint serves
 * "all registrations" and "the registrations for event 7" without a second route.
 */
const listRegistrations = asyncHandler(async (req, res) => {
  const result = await registrationService.listRegistrations(req.query);

  res.json(
    envelope('registrations', result.registrations, {
      view: 'admin',
      total: result.total,
      count: result.count,
      limit: result.limit,
      offset: result.offset,
      ticketsSold: result.ticketsSold,
    })
  );
});

/**
 * Return one registration by its id.
 *
 * An unknown id is answered with 404 by the service, so the admin screen can
 * distinguish a deleted row from a failed request.
 */
const getRegistration = asyncHandler(async (req, res) => {
  const registration = await registrationService.getRegistration(req.params.id);
  res.json(envelope('registration', registration));
});

/**
 * Update one registration, as a partial update.
 *
 * Only the fields present in the body are changed, and an unknown id is answered
 * with 404 rather than silently creating anything.
 */
const updateRegistration = asyncHandler(async (req, res) => {
  const registration = await registrationService.updateRegistration(
    req.params.id,
    req.body
  );
  res.json(envelope('registration', registration, { updated: true }));
});

/**
 * Delete one registration and answer 204 No Content.
 *
 * Because a 204 has no body, the deleted id is repeated in a header so the admin
 * screen - and anyone testing with Postman - can confirm which row was removed.
 */
const deleteRegistration = asyncHandler(async (req, res) => {
  const result = await registrationService.deleteRegistration(req.params.id);
  res.setHeader('X-Deleted-Registration-Id', String(result.registrationId));
  res.status(204).end();
});

/**
 * The controller's public surface: one handler per registration endpoint.
 *
 * src/routes/apiRoutes.ts mounts these under both the event sub-collection and
 * the top-level `/api/registrations` path, so this object is the single
 * implementation behind both.
 */
export = {
  createRegistration,
  listForEvent,
  listRegistrations,
  getRegistration,
  updateRegistration,
  deleteRegistration,
};
