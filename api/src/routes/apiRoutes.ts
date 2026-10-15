/**
 * @file The public RESTful surface of the API.
 *
 * URL design principles applied:
 *   * nouns, not verbs            -> /api/events, not /api/getEvents
 *   * the collection is filtered with query parameters rather than a
 *     different path per filter    -> /api/events?city=Lismore&category=1
 *   * a single resource is addressed by id  -> /api/events/7
 *   * fixed sub-resources come before the :id route so that "upcoming" is
 *     never mistaken for an event id
 *   * a registration is created inside the event it belongs to
 *     -> POST /api/events/7/registrations
 *   * once it exists it has its own identity
 *     -> PUT /api/registrations/42
 *
 * Assessment 2 was read-only (GET only). Assessment 3 adds the full C.R.U.D.
 * cycle: POST, PUT and DELETE are registered below, and the CORS middleware in
 * src/middleware/security.ts allows exactly the same four methods.
 */
'use strict';

import express = require('express');
import eventController = require('../controllers/eventController');
import categoryController = require('../controllers/categoryController');
import adminController = require('../controllers/adminController');
import registrationController = require('../controllers/registrationController');
import repository = require('../repositories');
import env = require('../config/env');

const router = express.Router();

/**
 * Report whether the API is running, and whether the database answers.
 *
 * This is the first check for the marker or the demo video, so it is public and
 * cheap. The status is 200 while the API itself is up and 503 only when the data
 * source reports `connected: false`, which is what lets a marker tell a dead
 * process apart from a missing database. A3 reports `registrationTable` as well,
 * which proves the new table was created by database/01_schema.sql.
 */
router.get('/health', async (req, res) => {
  const database = await repository.health();
  const healthy = database.connected !== false;

  res.status(healthy ? 200 : 503).json({
    success: healthy,
    meta: {
      resource: 'health',
      dataSource: repository.driver,
      environment: env.NODE_ENV,
      uptimeSeconds: Math.round(process.uptime()),
    },
    data: {
      api: 'ok',
      database,
    },
  });
});

/**
 * Describe every endpoint of the API in a machine readable form.
 *
 * The directory is written out here rather than generated from the router table,
 * so it doubles as living documentation during the demonstration and keeps the
 * query parameters of each route in one place; an endpoint that is added below
 * but not listed here is therefore visible at a glance.
 */
router.get('/', (req, res) => {
  res.json({
    success: true,
    meta: { resource: 'api-index', dataSource: repository.driver },
    data: {
      name: 'Charity Events API',
      version: '2.0.0',
      assessment: 'PROG2002 Assessment 3',
      note: 'Authentication is deliberately not implemented, as the brief allows.',
      endpoints: [
        {
          method: 'GET',
          path: '/api/health',
          description: 'Service and database health check.',
        },
        {
          method: 'GET',
          path: '/api/events',
          description:
            'Filtered list of active charity events. Home page and search page.',
          queryParameters:
            'category, location, city, date, from, to, state, keyword, isFree, organizationId, sort, direction, limit, offset, page',
        },
        {
          method: 'GET',
          path: '/api/events/upcoming',
          description: 'Convenience view: current and upcoming events, soonest first.',
        },
        {
          method: 'GET',
          path: '/api/events/:id',
          description:
            'Full detail for one event: ticket tiers, progress, AND the complete list of registrations for that event (newest first).',
        },
        {
          method: 'POST',
          path: '/api/events',
          description: 'Create a new charity event. Body: the event fields.',
        },
        {
          method: 'PUT',
          path: '/api/events/:id',
          description: 'Update an existing charity event by id (partial update).',
        },
        {
          method: 'DELETE',
          path: '/api/events/:id',
          description:
            'Delete an event. Blocked with 409 when the event already has registrations.',
        },
        {
          method: 'GET',
          path: '/api/events/:id/registrations',
          description: 'Every registration for one event, newest purchase first.',
        },
        {
          method: 'POST',
          path: '/api/events/:id/registrations',
          description:
            'Register for an event. Body: attendeeName, attendeeEmail, attendeePhone, ticketsPurchased, ticketTypeId, notes. One registration per email per event.',
        },
        {
          method: 'GET',
          path: '/api/registrations',
          description: 'All registrations (admin view). Filter: eventId, email, keyword.',
        },
        {
          method: 'GET',
          path: '/api/registrations/:id',
          description: 'One registration by id.',
        },
        {
          method: 'PUT',
          path: '/api/registrations/:id',
          description: 'Update a registration.',
        },
        {
          method: 'DELETE',
          path: '/api/registrations/:id',
          description: 'Delete a registration.',
        },
        {
          method: 'GET',
          path: '/api/admin/events',
          description:
            'Admin list: EVERY event regardless of status (active, past, suspended, cancelled).',
          queryParameters: 'publishStatus, state, category, location, keyword, sort, direction',
        },
        {
          method: 'GET',
          path: '/api/admin/events/:id',
          description: 'Admin detail: an event whatever its status, with its registrations.',
        },
        {
          method: 'GET',
          path: '/api/admin/reference-data',
          description:
            'Organisations, categories and venues for the admin event forms.',
        },
        {
          method: 'GET',
          path: '/api/categories',
          description: 'All event categories with an active event count.',
        },
        {
          method: 'GET',
          path: '/api/locations',
          description: 'Venues that currently host at least one active event.',
        },
        {
          method: 'GET',
          path: '/api/organization',
          description: 'The charitable organisation featured on the home page.',
        },
        {
          method: 'GET',
          path: '/api/stats',
          description: 'Headline counts and totals for the home page.',
        },
      ],
    },
  });
});

/**
 * Reference data: the filter lists both websites build their controls from.
 *
 * These are declared before `/events/:id` on purpose - they are different
 * resource paths, but keeping the fixed paths first avoids any ambiguity if a
 * broader pattern is ever introduced.
 */
router.get('/categories', categoryController.getCategories);
router.get('/locations', categoryController.getLocations);

/**
 * Events - the full C.R.U.D. cycle, added in Assessment 3.
 */

// Read
router.get('/events', eventController.getEvents);
router.get('/events/upcoming', eventController.getUpcomingEvents);

/**
 * The registration sub-collection of one event.
 *
 * Declared BEFORE `/events/:id` so that "registrations" is never interpreted as
 * an event id in a future change.
 */
router.get('/events/:id/registrations', registrationController.listForEvent);
router.post('/events/:id/registrations', registrationController.createRegistration);

// Read one / Create / Update / Delete
router.get('/events/:id', eventController.getEventById);
router.post('/events', adminController.createEvent);
router.put('/events/:id', adminController.updateEvent);
router.delete('/events/:id', adminController.deleteEvent);

/**
 * Registrations addressed directly, once a row has an identity of its own.
 */
router.get('/registrations', registrationController.listRegistrations);
router.get('/registrations/:id', registrationController.getRegistration);
router.put('/registrations/:id', registrationController.updateRegistration);
router.delete('/registrations/:id', registrationController.deleteRegistration);

/**
 * The admin view: the same events, but never filtered by status.
 *
 * Every write handler is shared with the plain RESTful routes above, so there is
 * exactly one implementation of each rule and the two surfaces cannot drift
 * apart.
 */
router.get('/admin/events', adminController.listAllEvents);
router.get('/admin/events/:id', adminController.getEventById);
router.get('/admin/reference-data', adminController.getReferenceData);
router.post('/admin/events', adminController.createEvent);
router.put('/admin/events/:id', adminController.updateEvent);
router.delete('/admin/events/:id', adminController.deleteEvent);

// Home page extras
router.get('/organization', eventController.getFeaturedOrganization);
router.get('/stats', eventController.getStats);

export = router;
