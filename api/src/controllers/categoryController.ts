/**
 * @file Reference data for the search page filters.
 *
 * The event categories, and the venues that currently host at least one active
 * event.
 */
'use strict';

import eventService = require('../services/eventService');
import repository = require('../repositories');
import { asyncHandler } from '../utils/asyncHandler';

/**
 * List the event categories, each with a count of its active events.
 *
 * The counts are what drives the category multi-select on the search page: a
 * category with no active events is still listed, because the count is what tells
 * the user it would return nothing rather than the filter silently disappearing.
 */
const getCategories = asyncHandler(async (req, res) => {
  const categories = await eventService.listCategories();
  res.json({
    success: true,
    meta: {
      resource: 'categories',
      dataSource: repository.driver,
      count: categories.length,
    },
    data: categories,
  });
});

/**
 * List the venues that currently host at least one active event.
 *
 * A venue with no active events is deliberately omitted: it would be a filter
 * option that could only ever return an empty page, which is how a search form
 * wastes a user's time.
 */
const getLocations = asyncHandler(async (req, res) => {
  const locations = await eventService.listLocations();
  res.json({
    success: true,
    meta: {
      resource: 'locations',
      dataSource: repository.driver,
      count: locations.length,
    },
    data: locations,
  });
});

/**
 * The controller's public surface: the two reference-data handlers.
 *
 * Both are mounted by src/routes/apiRoutes.ts before the `/events/:id` route, so
 * a fixed path is never mistaken for an id.
 */
export = { getCategories, getLocations };
