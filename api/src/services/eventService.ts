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
 *   audience              public | admin (the A3 admin switch)
 *   publishStatus         active | suspended | cancelled | all, checked like `state`
 *                         and `sort`: a value outside the list is a 400 rather than
 *                         a filter that is quietly ignored
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

  // organizationId is an id like every other id filter, so it is parsed like one
  // rather than coerced: this used to be `Number(parseText(...))`, which turned
  // "abc" into NaN and 0 into 0, both of which the repository then treated as
  // "no filter" - so a typo silently widened the result set to every event
  // instead of answering the 400 the rest of the query string would have got.
  // It is parsed before the throw below so the problem joins the same 400 as the
  // other invalid parameters instead of being reported on its own.
  const organizationIdText = parseText(query.organizationId);
  const organizationId =
    organizationIdText === undefined
      ? undefined
      : parseInteger(organizationIdText, 'organizationId', { min: 1, errors });

  // The publishing state the admin list filters on is checked exactly like `state`
  // and `sort` above, and the problem is collected BEFORE the throw below so it
  // joins the same single 400 as every other bad parameter.
  //
  // This used to fall back to 'all' - the admin list's default - whenever the value
  // was not one of the four accepted words, which is the one failure mode a filter
  // must never have: GET /api/admin/events?publishStatus=past answered 200 with the
  // WHOLE table (11 events) and no hint that the filter had been dropped, so the
  // caller was told, in the shape of a successful response, that every event had
  // that status. A client cannot tell that apart from a correct answer, whereas
  // ?sort=nope and ?state=nope were already 400s - so an unknown value is now a 400
  // naming the accepted ones instead of a silently widened result set.
  const publishStatusText = (parseText(query.publishStatus) || 'all').toLowerCase();
  if (!ALLOWED_PUBLISH_STATUSES.includes(publishStatusText)) {
    errors.push({
      field: 'publishStatus',
      message: `Publish status must be one of: ${ALLOWED_PUBLISH_STATUSES.join(', ')}.`,
    });
  }

  if (errors.length > 0) {
    throw HttpError.badRequest('One or more query parameters are invalid.', errors);
  }

  // A3: the admin website asks for ?audience=admin, which switches the query to
  // vw_all_events so suspended and cancelled events are included. The default
  // stays 'public', so no existing caller changes behaviour.
  const audienceText = (parseText(query.audience) || 'public').toLowerCase();
  const audience = ALLOWED_AUDIENCES.includes(audienceText) ? audienceText : 'public';

  // Already known to be one of the four accepted words: everything outside that
  // list was reported and threw above, so this needs no second fallback.
  const publishStatus = publishStatusText;

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
      organizationId,
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
 * turn the home page listing into a history listing with `?state=past` or
 * `?state=all` - the pinned value overwrites whatever arrived. The documented
 * `?includePast=true` alias still widens it, because that alias is folded into
 * the state below as `all`; that is deliberate rather than an oversight, since
 * the alias means exactly "include the past" and the search page relies on it.
 * Anything else the caller sends is still honoured.
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
 * The options are passed through UNCHANGED and the repository applies its own
 * safe default, so this layer cannot turn the public route into the admin one by
 * accident. That matters for `includeContactDetails`: the public route omits it
 * and therefore receives registrations without attendee email addresses or phone
 * numbers, while /api/admin/events/:id asks for them explicitly.
 *
 * @param rawId - The id from the route parameter, still unvalidated text.
 * @param options - Which publish states to accept, and whether the registration rows may carry attendee contact details. May be omitted, in which case only an active event is returned and the registrations are public-safe.
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
 * `searchEvents` serves this call by being asked explicitly for `audience: 'admin'`,
 * which switches the repository to vw_all_events; the public default stays
 * `public`, so a public client only sees suspended or cancelled events when it
 * asks for them with the documented `?audience=admin` parameter, which is an A3
 * feature rather than a hole - the earlier wording here ("the public path cannot
 * be switched to the admin view by a query parameter") described A2, before that
 * parameter existed. This entry point remains separate because the defaults
 * differ: an admin screen with no filters still shows the complete list, newest
 * first, which is not what the public listing should do with an empty query.
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
 * The query builders and listings are used by the event and admin controllers.
 * The four ALLOWED_* lists above stay module-private: they are the values the
 * validator enforces and the wording of each 400 message is built from them, so
 * there is exactly one definition of each accepted word. The tests state the
 * same rules through the HTTP responses rather than by importing the lists.
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
