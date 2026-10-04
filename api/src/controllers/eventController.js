/**
 * src/controllers/eventController.js
 * ---------------------------------------------------------------------------
 * HTTP layer for the event endpoints. A controller has three jobs only:
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

const eventService = require('../services/eventService');
const repository = require('../repositories');
const { asyncHandler } = require('../utils/asyncHandler');

/**
 * GET /api/events
 * The home page and the search page are both served by this one endpoint;
 * the home page simply asks for the events that have not finished yet.
 */
const getEvents = asyncHandler(async (req, res) => {
  // The service defaults to state=upcoming, which is exactly what the home
  // page wants. Passing ?state=past, ?state=all or ?includePast=true lets the
  // very same endpoint serve the search page's "past events" option.
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
 * GET /api/events/upcoming
 * Convenience endpoint for the home page: current and upcoming active events
 * only, soonest first.
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
 * GET /api/events/:id
 * Everything the event detail page needs, including the ticket tiers and the
 * goal vs progress figures.
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

/** GET /api/stats - headline numbers for the home page. */
const getStats = asyncHandler(async (req, res) => {
  const stats = await eventService.getStats();
  res.json({
    success: true,
    meta: { resource: 'stats', dataSource: repository.driver },
    data: stats,
  });
});

/** GET /api/organization - the organisation featured on the home page. */
const getFeaturedOrganization = asyncHandler(async (req, res) => {
  const organization = await eventService.getFeaturedOrganization();
  res.json({
    success: true,
    meta: { resource: 'organization', dataSource: repository.driver },
    data: organization,
  });
});

module.exports = {
  getEvents,
  getUpcomingEvents,
  getEventById,
  getStats,
  getFeaturedOrganization,
};
