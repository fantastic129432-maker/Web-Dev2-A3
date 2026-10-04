/**
 * src/controllers/categoryController.js
 * ---------------------------------------------------------------------------
 * Reference data used by the search page filters: event categories and the
 * venues that currently host at least one active event.
 */
'use strict';

const eventService = require('../services/eventService');
const repository = require('../repositories');
const { asyncHandler } = require('../utils/asyncHandler');

/** GET /api/categories - drives the category multi-select on the search page. */
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

/** GET /api/locations - drives the location select on the search page. */
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

module.exports = { getCategories, getLocations };
