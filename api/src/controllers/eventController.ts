/**
 * @file HTTP layer for the event endpoints.
 *
 * A controller has three jobs only:
 *   1. read the request,
 *   2. call the service,
 *   3. return a consistent JSON envelope.
 * All business rules live in the service, and all SQL lives in the repository.
 *
 * Response envelope
 *   success -> { success: true,  data: ..., meta: ... }
 *   failure -> { success: false, error: { status, message, details? } }
 */
'use strict';

import eventService = require('../services/eventService');
import repository = require('../repositories');
import { asyncHandler } from '../utils/asyncHandler';

/**
 * List the events that match the query string, for the home page and the search page.
 *
 * One endpoint serves both screens because the difference between them is a
 * filter rather than a resource: the service defaults to state=upcoming, which
 * is exactly what the home page wants, and ?state=past, ?state=all or
 * ?includePast=true lets the very same request serve the search page's "past
 * events" option. The meta block returns the applied filters and the paging
 * totals, so the client can render "showing 1-10 of 42" and its filter chips
 * without a second request.
 */
const getEvents = asyncHandler(async (req, res) => {
  const result = await eventService.searchEvents(req.query);

  res.json({
    success: true,
    meta: {
      resource: 'events',
      dataSource: repository.driver,
      total: result.total,
      count: result.count,
      page: result.page,
      totalPages: result.totalPages,
      limit: result.limit,
      offset: result.offset,
      appliedFilters: result.appliedFilters,
      generatedAt: new Date().toISOString(),
    },
    data: result.events,
  });
});

/**
 * List the current and upcoming active events, soonest first.
 *
 * A convenience endpoint for the home page, which wants a fixed shape rather
 * than a filtered one: the state, sort and direction are pinned here (with the
 * query string able to override the two ordering values) so the home page cannot
 * be broken by a stray parameter and does not have to repeat the defaults.
 */
const getUpcomingEvents = asyncHandler(async (req, res) => {
  const result = await eventService.listActiveEvents({
    ...req.query,
    state: 'upcoming',
    sort: req.query.sort || 'date',
    direction: req.query.direction || 'asc',
  });

  res.json({
    success: true,
    meta: {
      resource: 'events',
      view: 'upcoming',
      dataSource: repository.driver,
      total: result.total,
      count: result.count,
      generatedAt: new Date().toISOString(),
    },
    data: result.events,
  });
});

/**
 * Return everything the event detail page needs for one event.
 *
 * That is the event itself, its ticket tiers and the goal-versus-progress
 * figures. An unknown id is answered with 404 by the service rather than with an
 * empty 200, so the Angular route can tell "not found" from "no content" and
 * show the right message.
 */
const getEventById = asyncHandler(async (req, res) => {
  const event = await eventService.getEventById(req.params.id);

  res.json({
    success: true,
    meta: {
      resource: 'event',
      dataSource: repository.driver,
      generatedAt: new Date().toISOString(),
    },
    data: event,
  });
});

/**
 * Return the headline counts and totals for the home page.
 *
 * They are computed in one place so the numbers on the home page cannot disagree
 * with each other, and so the same figures can be quoted in the report and the
 * video without re-deriving them.
 */
const getStats = asyncHandler(async (req, res) => {
  const stats = await eventService.getStats();
  res.json({
    success: true,
    meta: { resource: 'stats', dataSource: repository.driver },
    data: stats,
  });
});

/**
 * Return the charitable organisation featured on the home page.
 *
 * The data is whatever the seed marks as featured, so this can legitimately be
 * `null`; the home page hides the section in that case rather than showing an
 * empty card, which is why the service is allowed to answer with nothing.
 */
const getFeaturedOrganization = asyncHandler(async (req, res) => {
  const organization = await eventService.getFeaturedOrganization();
  res.json({
    success: true,
    meta: { resource: 'organization', dataSource: repository.driver },
    data: organization,
  });
});

/**
 * The controller's public surface: one handler per event endpoint.
 *
 * src/routes/apiRoutes.ts mounts these names, so a handler is only reachable
 * through an explicit route registration and the router file stays the single
 * list of URLs the API publishes.
 */
export = {
  getEvents,
  getUpcomingEvents,
  getEventById,
  getStats,
  getFeaturedOrganization,
};
