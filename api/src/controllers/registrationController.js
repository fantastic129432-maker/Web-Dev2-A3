/**
 * src/controllers/registrationController.js
 * ---------------------------------------------------------------------------
 * HTTP layer for event registration.
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

const registrationService = require('../services/registrationService');
const repository = require('../repositories');
const { asyncHandler } = require('../utils/asyncHandler');

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
 * POST /api/events/:id/registrations
 * Validates the body, enforces "one registration per email per event", and
 * stores the record. 201 + Location on success.
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
 * GET /api/events/:id/registrations
 * The list the event detail page displays, newest purchase first.
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

/** GET /api/registrations - the optional admin list, across every event. */
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

/** GET /api/registrations/:id */
const getRegistration = asyncHandler(async (req, res) => {
  const registration = await registrationService.getRegistration(req.params.id);
  res.json(envelope('registration', registration));
});

/** PUT /api/registrations/:id - partial update. */
const updateRegistration = asyncHandler(async (req, res) => {
  const registration = await registrationService.updateRegistration(
    req.params.id,
    req.body
  );
  res.json(envelope('registration', registration, { updated: true }));
});

/** DELETE /api/registrations/:id - 204 No Content. */
const deleteRegistration = asyncHandler(async (req, res) => {
  const result = await registrationService.deleteRegistration(req.params.id);
  res.setHeader('X-Deleted-Registration-Id', String(result.registrationId));
  res.status(204).end();
});

module.exports = {
  createRegistration,
  listForEvent,
  listRegistrations,
  getRegistration,
  updateRegistration,
  deleteRegistration,
};
