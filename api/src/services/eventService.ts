/**
 * @file The only place where query-string text becomes a validated filter object.
 *
 * Why a service layer? The controller stays thin (HTTP in, JSON out) and the
 * repository stays purely about data, which means the same validation rules
 * apply no matter which repository implementation is active, and the rules can
 * be unit tested without starting a web server.
 */
'use strict';

import env = require('../config/env');
import type {
  DataRecord,
  EventFilters,
  FindEventOptions,
  UntrustedInput,
  ValidationIssue,
} from '../types';
import repository = require('../repositories');
import { HttpError } from '../utils/errors';
const {
  parseIdList,
  parseInteger,
  parseText,
  isValidDate,
} = require('../utils/validators') as typeof import('../utils/validators');

/** The states a client may ask for; anything else is a 400. */
const ALLOWED_STATES = ['upcoming', 'ongoing', 'past', 'all'];
/** The columns the client may sort by, which is what keeps ORDER BY out of user hands. */
const ALLOWED_SORTS = ['date', 'name', 'goal', 'progress', 'category', 'city'];
/** The publishing states the admin list can filter on. */
const ALLOWED_PUBLISH_STATUSES = ['active', 'suspended', 'cancelled', 'all'];
/** Which audience is asking, which decides whether suspended events appear. */
const ALLOWED_AUDIENCES = ['public', 'admin'];

/**
 * Turn raw req.query into { filters, paging } or throw HttpError(400).
 *
 * Every value is checked here rather than in the controller, because the same
 * filters have to be produced for both data sources and for the admin and public
 * views. A problem is collected rather than thrown on the spot, so one 400 can
 * list every bad parameter instead of only the first.
 *
 * Supported parameters
 *   category, categoryId  one or many ids (repeat the key or use commas)
 *   location, locationId  one or many location ids
 *   city                  partial city name
 *   date                  a single day (YYYY-MM-DD)
 *   from, to              a date range (YYYY-MM-DD, inclusive)
 *   state                 upcoming | ongoing | past | all
 *   keyword               free text search
 *   organizationId        restrict to one organisation
 *   isFree                true | false
 *   includePast           true | false (used by the home page)
 *   sort, direction       whitelisted sort keys
 *   limit, offset, page   pagination
 *
 * @param query - The untrusted query string. May be omitted, in which case the defaults describe the next upcoming events.
 * @returns The validated filters and the paging values derived from them.
 * @throws HttpError with status 400 when any parameter cannot be understood, carrying the per-parameter list.
 */
function buildQuery(query: UntrustedInput = {}) {
  const errors: ValidationIssue[] = [];

  const categoryIds = [
    ...parseIdList(query.category, 'category', errors),
    ...parseIdList(query.categoryId, 'categoryId', errors),
  ];
  const locationIds = [
    ...parseIdList(query.location, 'location', errors),
    ...parseIdList(query.locationId, 'locationId', errors),
  ];
  const uniqueCategories = [...new Set(categoryIds)];
  const uniqueLocations = [...new Set(locationIds)];

  let from = parseText(query.from);
  let to = parseText(query.to);
  const singleDate = parseText(query.date);

  if (singleDate) {
    if (!isValidDate(singleDate)) {
      errors.push({
        field: 'date',
        message: 'Date must be a real calendar date in YYYY-MM-DD format.',
      });
    } else {
      from = singleDate;
      to = singleDate;
    }
  }

  if (from && !isValidDate(from)) {
    errors.push({ field: 'from', message: 'From date must be YYYY-MM-DD.' });
  }
  if (to && !isValidDate(to)) {
    errors.push({ field: 'to', message: 'To date must be YYYY-MM-DD.' });
  }
  if (from && to && isValidDate(from) && isValidDate(to) && to < from) {
    errors.push({
      field: 'to',
      message: 'The end of the range cannot be earlier than the start.',
    });
  }

  const state = parseText(query.state) || 'upcoming';
  if (!ALLOWED_STATES.includes(state)) {
    errors.push({
      field: 'state',
      message: `State must be one of: ${ALLOWED_STATES.join(', ')}.`,
    });
  }
  // ?includePast=true is a convenience alias for ?state=all, so the home page
  // can ask for the full history if it ever needs to.
  const includePastAlias = parseText(query.includePast) === 'true';

  const sort = parseText(query.sort) || 'date';
  if (!ALLOWED_SORTS.includes(sort)) {
    errors.push({
      field: 'sort',
      message: `Sort must be one of: ${ALLOWED_SORTS.join(', ')}.`,
    });
  }

  const direction = (parseText(query.direction) || 'asc').toLowerCase();
  if (!['asc', 'desc'].includes(direction)) {
    errors.push({ field: 'direction', message: 'Direction must be asc or desc.' });
  }

  let isFree: boolean | undefined;
  const freeText = parseText(query.isFree);
  if (freeText !== undefined) {
    if (freeText === 'true') isFree = true;
    else if (freeText === 'false') isFree = false;
    else errors.push({ field: 'isFree', message: 'isFree must be true or false.' });
  }

  let includePast = false;  const includePastText = parseText(query.includePast);
  if (includePastText !== undefined) {
    if (includePastText === 'true') includePast = true;
    else if (includePastText === 'false') includePast = false;
    else
      errors.push({
        field: 'includePast',
        message: 'includePast must be true or false.',
      });
  }

  const effectiveState = includePastAlias && state === 'upcoming' ? 'all' : state;

  const limit =
    query.limit === undefined
      ? env.DEFAULT_PAGE_SIZE
      : parseInteger(query.limit, 'limit', { min: 1, max: env.MAX_PAGE_SIZE, errors });

  let offset = 0;
  const pageText = parseText(query.page);
  if (pageText !== undefined) {
    const page = parseInteger(pageText, 'page', { min: 1, max: 10_000, errors });
    if (page !== undefined && limit !== undefined) offset = (page - 1) * limit;
  }
  const offsetText = parseText(query.offset);
  if (offsetText !== undefined) {
    const parsed = parseInteger(offsetText, 'offset', { min: 0, max: 1_000_000, errors });
    if (parsed !== undefined) offset = parsed;
  }

  if (errors.length > 0) {
    throw HttpError.badRequest('One or more query parameters are invalid.', errors);
  }

  const organizationId = parseText(query.organizationId);

  // A3: the admin website asks for ?audience=admin, which switches the query to
  // vw_all_events so suspended and cancelled events are included. The default
  // stays 'public', so no existing caller changes behaviour.
  const audienceText = (parseText(query.audience) || 'public').toLowerCase();
  const audience = ALLOWED_AUDIENCES.includes(audienceText) ? audienceText : 'public';

  const publishStatusText = (parseText(query.publishStatus) || 'all').toLowerCase();
  const publishStatus = ALLOWED_PUBLISH_STATUSES.includes(publishStatusText)
    ? publishStatusText
    : 'all';

  return {
    filters: {
      categoryIds: uniqueCategories,
      locationIds: uniqueLocations,
      city: parseText(query.city),
      from,
      to,
      state: effectiveState,
      sort,
      direction,
      isFree,
      includePast,
      keyword: parseText(query.keyword),
      organizationId: organizationId ? Number(organizationId) : undefined,
      // A3 additions - both default to the A2 behaviour.
      audience,
      publishStatus,
      // `state` is the single source of truth for the derived past/upcoming
      // filter: 'past' shows history, 'all' shows everything, and the default
      // 'upcoming' shows only events that have not finished yet.
      excludePast: effectiveState === 'upcoming',
    },
    paging: {
      limit: limit === undefined ? env.DEFAULT_PAGE_SIZE : limit,
      offset,
      page: Math.floor(offset / (limit || env.DEFAULT_PAGE_SIZE)) + 1,
      sort,
      direction,
    },
  };
}

/**
 * List the events matching a query string, for the home page and the search page.
 *
 * The repository returns one page plus the unpaged total; the extra figures added
 * here (count, totalPages and the applied filters) are what the Angular pages
 * need to render a result summary and the "no results" message, so they are
 * computed once on the server rather than re-derived in each client.
 *
 * @param query - The untrusted query string from the request.
 * @returns The page of events, the paging totals and the filters that were actually applied.
 * @throws HttpError with status 400 when the query string is not valid.
 */
async function searchEvents(query: UntrustedInput) {
  const { filters, paging } = buildQuery(query);
  const result = await repository.findEvents(filters, paging);

  return {
    total: result.total,
    count: result.events.length,
    limit: paging.limit,
    offset: paging.offset,
    page: paging.page,
    totalPages: Math.max(Math.ceil(result.total / paging.limit), 1),
    appliedFilters: describeFilters(filters),
    events: result.events,
  };
}

/**
 * Listing for the home page: everything that has not finished yet.
 *
 * The state is pinned to `upcoming` rather than defaulted, so a caller cannot
 * turn the home page listing into a history listing by passing a query
 * parameter; anything else the caller sends is still honoured.
 *
 * @param query - The untrusted query string. May be omitted, in which case the default page of upcoming events is returned.
 * @returns The page of upcoming events, in the same shape as `searchEvents`.
 * @throws HttpError with status 400 when the remaining query parameters are not valid.
 */
async function listActiveEvents(query: UntrustedInput = {}) {
  return searchEvents({ ...query, state: 'upcoming' });
}

/**
 * Return one event with its ticket tiers.
 *
 * The id is checked here rather than by the database so that a request for
 * `/api/events/abc` is a 400 (the client sent nonsense) while a well-formed id
 * that matches nothing is a 404 (the resource is not there) - a distinction the
 * Angular pages use to decide what to tell the user. The options object widens
 * the lookup: the admin website passes `status: 'all'` so it can open a
 * suspended or cancelled event, which the public route deliberately cannot.
 *
 * @param rawId - The id from the route parameter, still unvalidated text.
 * @param options - Which publish states to accept. May be omitted, in which case only an active event is returned.
 * @returns The event, with its ticket tiers and progress figures.
 * @throws HttpError with status 400 when the id is not a positive whole number.
 * @throws HttpError with status 404 when no event matches, or when the only match is not active and `status` was not widened.
 */
async function getEventById(rawId: string | number, options: FindEventOptions = {}) {
  const eventId = Number(rawId);
  if (!Number.isInteger(eventId) || eventId <= 0) {
    throw HttpError.badRequest(
      `"${rawId}" is not a valid event id. Event ids are positive whole numbers.`
    );
  }

  const event = await repository.findEventById(eventId, options);
  if (!event) {
    throw HttpError.notFound(
      options.status === 'all'
        ? `No charity event was found with id ${eventId}.`
        : `No active charity event was found with id ${eventId}. It may have been suspended or removed.`
    );
  }
  return event;
}

/**
 * List every event regardless of status, for the admin listing.
 *
 * This is deliberately a separate entry point rather than a flag on
 * searchEvents(), so the public path cannot be switched to the admin view by a
 * query parameter alone - `getEventById` and `searchEvents` keep their own
 * defaults and only the admin controller asks for the wider view. The defaults
 * are the admin ones (everything, newest first) so an admin screen with no
 * filters still shows the complete list.
 *
 * @param query - The untrusted query string. May be omitted, in which case every event is returned newest first.
 * @returns The page of events of every status, in the same shape as `searchEvents`.
 * @throws HttpError with status 400 when the query string is not valid.
 */
async function listAllEvents(query: UntrustedInput = {}) {
  return searchEvents({
    ...query,
    audience: 'admin',
    // The admin list shows everything by default, including past events.
    state: query.state || 'all',
    publishStatus: query.publishStatus || 'all',
    sort: query.sort || 'date',
    direction: query.direction || 'desc',
  });
}

/**
 * List the categories for the search page filter.
 *
 * @returns Every category with its active event count, so the filter can show how much each one would return.
 */
async function listCategories() {
  return repository.findCategories();
}

/**
 * List the venues for the search page filter.
 *
 * @returns The venues that currently host at least one active event, so no filter option can only return an empty page.
 */
async function listLocations() {
  return repository.findLocations();
}

/**
 * Return the organisations, categories and venues for the admin event forms.
 *
 * Unlike listCategories()/listLocations(), this includes reference rows that
 * currently have no public event, because staff may be about to create one.
 *
 * @returns The three reference lists, in one payload so the form needs a single request.
 */
async function getReferenceData() {
  return repository.findReferenceData();
}

/**
 * Return the organisation shown on the home page.
 *
 * @returns The featured organisation, or `null` when the seed marks none, in which case the home page hides the section.
 */
async function getFeaturedOrganization() {
  return repository.findFeaturedOrganization();
}

/**
 * Return the numbers for the home page statistics strip.
 *
 * @returns The headline counts and totals, computed by the repository so both data sources report the same figures.
 */
async function getStats() {
  return repository.findStats();
}

/**
 * Echo back the filters that were actually applied.
 *
 * Only the filters the caller really set are reported, and `state` is always
 * included because every listing has one; that is what lets the client build its
 * "no results for these filters" message and its filter chips from the response
 * alone, instead of remembering what it asked for.
 *
 * The admin switches (`audience`, `publishStatus`) are reported only when the
 * admin view was requested, so a public response is byte-for-byte what it was
 * before Assessment 3.
 *
 * @param filters - The validated filters used for the query.
 * @returns The subset of the filters that were applied, ready to place in the response metadata.
 */
function describeFilters(filters: EventFilters): DataRecord {
  const applied: DataRecord = {};
  if (filters.categoryIds && filters.categoryIds.length > 0) {
    applied.categoryIds = filters.categoryIds;
  }
  if (filters.locationIds && filters.locationIds.length > 0) {
    applied.locationIds = filters.locationIds;
  }
  if (filters.city) applied.city = filters.city;
  if (filters.from) applied.from = filters.from;
  if (filters.to) applied.to = filters.to;
  if (filters.keyword) applied.keyword = filters.keyword;
  if (typeof filters.isFree === 'boolean') applied.isFree = filters.isFree;
  if (filters.organizationId) applied.organizationId = filters.organizationId;
  applied.state = filters.state;
  // A3: report the admin switches so the admin page can echo them back.
  if (filters.audience === 'admin') {
    applied.audience = filters.audience;
    applied.publishStatus = filters.publishStatus;
  }
  return applied;
}

/**
 * The service's public surface.
 *
 * The query builders and listings are used by the event and admin controllers;
 * the four ALLOWED_* lists are exported so the tests and the API directory can
 * state the same rule the validator enforces, rather than repeating the values.
 */
export = {
  buildQuery,
  searchEvents,
  listActiveEvents,
  listAllEvents,
  getEventById,
  listCategories,
  listLocations,
  getReferenceData,
  getFeaturedOrganization,
  getStats,
};
