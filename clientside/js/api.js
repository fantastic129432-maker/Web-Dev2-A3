/**
 * js/api.js
 * ---------------------------------------------------------------------------
 * The single point in the client that talks to the REST API.
 *
 * Everything is built on fetch(), which returns a Promise - the brief asks for
 * Promises, and `async/await` is simply a cleaner way to read the same thing.
 * Centralising the calls here means:
 *   * the API base URL is defined once (config.js),
 *   * every failure produces the same ApiError object, so the pages can show
 *     one consistent error message,
 *   * a slow or dead API cannot freeze the page (10 second timeout).
 *
 * Assessment 3 addition
 *   The write half. `request()` now carries the whole implementation and
 *   `getJson` / `postJson` / `putJson` / `deleteJson` are thin wrappers around
 *   it, so a create, an update and a read all share one timeout, one error type
 *   and one understanding of the API envelope. Every A2 caller keeps working
 *   because getJson() behaves exactly as it did.
 */
import { API_BASE_URL } from './config.js';
import { t } from './i18n.js';

/** Error type thrown by every function in this module. */
export class ApiError extends Error {
  constructor(message, { status = 0, details = null, url = '' } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
    this.url = url;
  }

  /**
   * A message that is safe and helpful to display to a member of the public.
   * Translated at the moment it is read, so it follows the language switcher.
   */
  get friendlyMessage() {
    if (this.status === 404) {
      return this.message || t('error.notFound');
    }
    if (this.status === 400) {
      return t('error.badRequest');
    }
    if (this.status === 409) {
      return this.message || t('error.conflict');
    }
    if (this.status === 429) {
      return t('error.rateLimited');
    }
    if (this.status >= 500) {
      return t('error.server');
    }
    return t('error.offline');
  }

  /**
   * The per-field problems a 400 or a 409 reported, in the shape
   * dom.setFieldMessage() and the form code expect.
   *
   * The API sends `details` as an array of { field, message } for a validation
   * failure, but as a plain object for a conflict (for example the delete
   * rule). Normalising both here means no page has to care which it received.
   */
  get fieldErrors() {
    if (!Array.isArray(this.details)) return [];
    return this.details
      .filter((item) => item && typeof item === 'object' && item.message)
      .map((item) => ({ field: item.field || '', message: item.message }));
  }
}

/** Build a query string, dropping empty values and expanding arrays. */
export function buildQueryString(params = {}) {
  const search = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;

    if (Array.isArray(value)) {
      value
        .filter((item) => item !== undefined && item !== null && item !== '')
        .forEach((item) => search.append(key, item));
      return;
    }
    search.append(key, value);
  });

  const text = search.toString();
  return text ? `?${text}` : '';
}

/**
 * The one place a request is made.
 *
 * @param {string} method   GET | POST | PUT | DELETE
 * @param {string} path     e.g. '/events/1'
 * @param {object} [options]
 * @param {object} [options.params] query parameters
 * @param {object} [options.body]   request body, serialised as JSON
 * @returns {Promise<any>} the `data` part of the API envelope, or null for 204
 */
export async function request(method, path, { params = {}, body = undefined } = {}) {
  const url = `${API_BASE_URL}${path}${buildQueryString(params)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);

  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timer);
    if (error.name === 'AbortError') {
      throw new ApiError(t('error.timeout'), { url });
    }
    throw new ApiError(t('error.offline'), { url });
  } finally {
    clearTimeout(timer);
  }

  // 204 No Content carries no body, so there is nothing to parse. The delete
  // endpoints use it, which is the RESTful answer to "it is gone".
  if (response.status === 204) return null;

  let parsed = null;
  try {
    parsed = await response.json();
  } catch (error) {
    // A non-JSON body means something other than our API answered.
    parsed = null;
  }

  if (!response.ok || (parsed && parsed.success === false)) {
    const apiError = parsed && parsed.error ? parsed.error : {};
    throw new ApiError(apiError.message || `Request failed (${response.status}).`, {
      status: response.status,
      // A validation failure is an array; a conflict is an object. Both are
      // preserved so the caller can decide how to show them.
      details: apiError.details || null,
      url,
    });
  }

  return parsed ? parsed.data : null;
}

/**
 * Perform a GET request and return the `data` part of the API envelope.
 *
 * @param {string} path    e.g. '/events/1'
 * @param {object} params  query parameters
 */
export function getJson(path, params = {}) {
  return request('GET', path, { params });
}

/** POST a JSON body. Returns the created resource. */
export function postJson(path, body, params = {}) {
  return request('POST', path, { body, params });
}

/** PUT a JSON body. Returns the updated resource. */
export function putJson(path, body, params = {}) {
  return request('PUT', path, { body, params });
}

/**
 * DELETE a resource. Resolves with null, because the API answers 204.
 *
 * A 409 (the event still has registrations) arrives as a rejected ApiError, so
 * the caller shows the message rather than treating it as success.
 */
export function deleteJson(path, params = {}) {
  return request('DELETE', path, { params });
}

/**
 * GET /api/events - the workhorse behind both the home page and the search
 * page. `params` may contain category (array), location (array), city, date,
 * from, to, state, keyword, isFree, sort, direction, limit, offset, page.
 */
export function getEvents(params = {}) {
  return getJson('/events', params);
}

/** GET /api/events/upcoming - current and upcoming events, soonest first. */
export function getUpcomingEvents(params = {}) {
  return getJson('/events/upcoming', params);
}

/** GET /api/events/:id - full detail including ticket tiers and progress. */
export function getEventById(eventId) {
  return getJson(`/events/${encodeURIComponent(eventId)}`);
}

/** GET /api/categories - category filter options. */
export function getCategories() {
  return getJson('/categories');
}

/** GET /api/locations - location filter options. */
export function getLocations() {
  return getJson('/locations');
}

/** GET /api/stats - headline numbers for the home page. */
export function getStats() {
  return getJson('/stats');
}

/** GET /api/organization - the organisation featured on the home page. */
export function getOrganization() {
  return getJson('/organization');
}

/** GET /api/health - used by the footer to show whether the API is online. */
export function getHealth() {
  return getJson('/health');
}

/* =====================================================================
 * Assessment 3 - registrations
 * ===================================================================== */

/**
 * GET /api/events/:id/registrations
 * The list the event detail page displays, newest purchase first.
 */
export function getEventRegistrations(eventId) {
  return getJson(`/events/${encodeURIComponent(eventId)}/registrations`);
}

/**
 * POST /api/events/:id/registrations
 * The registration form calls this. One email may register for an event once;
 * a second attempt is rejected by the API with a 409.
 *
 * @param {string|number} eventId
 * @param {{attendeeName:string, attendeeEmail:string, attendeePhone?:string,
 *          ticketsPurchased:number, ticketTypeId?:number|null,
 *          registeredAt?:string, notes?:string}} registration
 */
export function createRegistration(eventId, registration) {
  return postJson(`/events/${encodeURIComponent(eventId)}/registrations`, registration);
}

/** GET /api/registrations - every registration. Used by the admin site. */
export function getRegistrations(params = {}) {
  return getJson('/registrations', params);
}

/** PUT /api/registrations/:id */
export function updateRegistration(registrationId, changes) {
  return putJson(`/registrations/${encodeURIComponent(registrationId)}`, changes);
}

/** DELETE /api/registrations/:id */
export function deleteRegistration(registrationId) {
  return deleteJson(`/registrations/${encodeURIComponent(registrationId)}`);
}

/* =====================================================================
 * Assessment 3 - admin event management and reference data
 * ===================================================================== */

/** GET /api/admin/events - every event regardless of status. */
export function getAdminEvents(params = {}) {
  return getJson('/admin/events', params);
}

/** GET /api/admin/events/:id - one event whatever its status. */
export function getAdminEventById(eventId) {
  return getJson(`/admin/events/${encodeURIComponent(eventId)}`);
}

/** POST /api/events - create a charity event. */
export function createEvent(event) {
  return postJson('/events', event);
}

/** PUT /api/events/:id - update a charity event. */
export function updateEvent(eventId, changes) {
  return putJson(`/events/${encodeURIComponent(eventId)}`, changes);
}

/** DELETE /api/events/:id - rejected with a 409 when registrations exist. */
export function deleteEvent(eventId) {
  return deleteJson(`/events/${encodeURIComponent(eventId)}`);
}

/** GET /api/admin/reference-data - organisations, categories and venues. */
export function getReferenceData() {
  return getJson('/admin/reference-data');
}
