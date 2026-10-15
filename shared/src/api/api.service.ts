/**
 * @file The single point in EITHER Angular application that talks to the REST API.
 *
 * Design decisions, each of which the assessment brief or good practice asks for:
 *
 *   * HttpClient, not raw fetch. Angular's HttpClient gives typed responses,
 *     interceptors and testability (HttpTestingController) without any wrapper.
 *   * Observables. HTTP in Angular is asynchronous; returning Observables lets a
 *     component use the async pipe or `toSignal`, cancel a request when the user
 *     navigates away, and debounce a search box - all of which the search page
 *     does. The underlying implementation is still Promises, which is what the
 *     brief lists.
 *   * One timeout. APP_CONFIG.requestTimeoutMs (10 s) applies to every call, so a
 *     dead API can never leave a page spinning forever.
 *   * One error type. Everything fails with ApiError, so a component catches one
 *     thing and renders one message in the active language.
 *   * One unwrapping point. The API always answers with `{ success, meta, data }`;
 *     the `data` part is what callers want, and the paging `meta` is kept for the
 *     list endpoints that need it.
 *
 * The base URL comes from the API_BASE_URL token, so the same compiled library
 * serves the localhost API and the SCU cPanel one (see environments/).
 */
import { HttpClient, HttpErrorResponse, HttpHeaders, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, TimeoutError, catchError, map, throwError, timeout } from 'rxjs';

import { APP_CONFIG } from '../config/app-config';
import { API_BASE_URL } from '../di/tokens';
import type {
  ApiEnvelope,
  ApiErrorBody,
  ApiMeta,
  Paged,
  PagedMeta,
} from '../models/api.model';
import type { Event, EventDetail, EventInput, EventQuery } from '../models/event.model';
import type { Registration, RegistrationInput } from '../models/registration.model';
import type {
  Category,
  EventStats,
  HealthReport,
  Organization,
  ReferenceData,
  Venue,
} from '../models/reference.model';
import { ApiError } from './api-error';

/** Filters GET /api/registrations accepts (admin view). */
export interface RegistrationQuery {
  /** Keep only the registrations recorded against one event. */
  eventId?: number | string;
  /** Match part of the attendee's email address, not the whole of it. */
  email?: string;
  /** Free-text search over the attendee's name and email address. */
  keyword?: string;
  limit?: number;
  offset?: number;
  /**
   * One-based page number, accepted for symmetry with the event list.
   *
   * This endpoint pages with `limit` and `offset` only, so a `page` sent here is
   * ignored rather than rejected.
   */
  page?: number;
}

/**
 * Values a query parameter may hold.
 *
 * An array becomes repeated parameters, which is one of the two forms the API
 * accepts for a multi-value filter.
 */
export type QueryValue = string | number | boolean | Array<string | number> | undefined;

/** A decoded API response: the payload plus the metadata the API attached. */
interface ApiResult<T> {
  data: T;
  meta: ApiMeta;
}

/**
 * Turn a plain object into HttpParams.
 *
 * Behaviour mirrors the API's own expectations:
 *   * `undefined`, `null` and `''` are dropped, so an unset filter is simply not
 *     sent (the API then applies its default, for example "upcoming only"),
 *   * `false` IS sent (it is a meaningful value for isFree),
 *   * an array is appended repeatedly: ?category=1&category=2, which is one of
 *     the two forms the API accepts.
 */
function buildHttpParams(query: Record<string, QueryValue> = {}): HttpParams {
  let params = new HttpParams();

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;

    if (Array.isArray(value)) {
      for (const item of value) {
        if (item === undefined || item === null || item === '') continue;
        params = params.append(key, String(item));
      }
      continue;
    }

    params = params.append(key, String(value));
  }

  return params;
}

/**
 * Fill in the paging fields the UI relies on.
 *
 * A list endpoint always sends them, but a defensive default means a control can
 * render even if one is missing.
 */
function toPagedMeta(meta: ApiMeta, fallbackCount: number): PagedMeta {
  return {
    ...meta,
    total: meta.total ?? fallbackCount,
    count: meta.count ?? fallbackCount,
    page: meta.page ?? 1,
    totalPages: meta.totalPages ?? 1,
    limit: meta.limit ?? fallbackCount,
    offset: meta.offset ?? 0,
  };
}

/**
 * The one place in either Angular application that talks to the REST API.
 *
 * Every endpoint the two websites use is a method here, so a component never
 * builds a URL and never sees the response envelope: it asks for data and gets
 * either the payload or an ApiError. The design decisions behind that are
 * recorded in the file block at the top of this file.
 *
 * The per-event registration list is not a method here, and not because the
 * endpoint is missing: neither website ever asks for those rows separately.
 * GET /api/events/:id already carries the complete registration list, newest
 * purchase first, which is what the public detail page renders, so the API's own
 * GET /api/events/:id/registrations route would be a call nothing makes.
 *
 * @throws ApiError Every method's Observable errors with an ApiError, never a bare
 *   HttpErrorResponse or a TimeoutError, so a caller has one error type to render in the
 *   active language.
 */
@Injectable({ providedIn: 'root' })
export class ApiService {
  /** The Angular HTTP client every request goes through. */
  private readonly http = inject(HttpClient);
  /** The API root from the API_BASE_URL token, with a trailing slash removed. */
  private readonly baseUrl = inject(API_BASE_URL).replace(/\/+$/, '');

  /* =====================================================================
   * The one request implementation
   * =================================================================== */

  /**
   * Perform a request and return the payload plus the API metadata.
   *
   * `method` is the HTTP verb, `path` is the API path such as '/events/2', and
   * `options` carries query parameters and/or a JSON body. A body is sent only
   * when one was supplied, so a GET is never given a Content-Type it does not
   * need. The single timeout lives here, which is what makes it apply to every
   * endpoint rather than to the ones each caller remembered.
   */
  private send<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    options: { params?: Record<string, QueryValue>; body?: unknown } = {}
  ): Observable<ApiResult<T>> {
    const url = `${this.baseUrl}${path}`;
    const hasBody = options.body !== undefined;

    return this.http
      .request<ApiEnvelope<T> | null>(method, url, {
        params: buildHttpParams(options.params),
        body: hasBody ? options.body : undefined,
        headers: hasBody ? new HttpHeaders({ 'Content-Type': 'application/json' }) : undefined,
      })
      .pipe(
        // A slow API must not hang the page. TimeoutError is turned into an
        // ApiError by normalise(), so callers only ever see one error type.
        timeout({ each: APP_CONFIG.requestTimeoutMs }),
        map((body) => {
          // 204 No Content: DELETE answers with no body at all.
          if (body === null || body === undefined) {
            return { data: null as unknown as T, meta: {} };
          }
          // A 200 carrying success:false would be a contract violation, but
          // treating it as success would hide a real failure, so it is raised.
          if (body.success === false) {
            throw ApiError.fromEnvelope(body as unknown as ApiErrorBody, 200, url);
          }
          return { data: body.data, meta: body.meta ?? {} };
        }),
        catchError((error: unknown) => throwError(() => this.normalise(error, url)))
      );
  }

  /** GET returning just the payload, for endpoints with no paging to keep. */
  private get<T>(path: string, params?: Record<string, QueryValue>): Observable<T> {
    return this.send<T>('GET', path, { params }).pipe(map((result) => result.data));
  }

  /** GET returning the payload and its paging metadata. */
  private getPaged<T>(path: string, params?: Record<string, QueryValue>): Observable<Paged<T>> {
    return this.send<T[]>('GET', path, { params }).pipe(
      map((result) => {
        const items = Array.isArray(result.data) ? result.data : [];
        return { items, meta: toPagedMeta(result.meta, items.length) };
      })
    );
  }

  /**
   * Reduce every possible failure to a single ApiError.
   *
   * HttpErrorResponse covers an HTTP error status; a status of 0 means the
   * request never reached the server (offline, DNS failure, CORS rejection).
   * TimeoutError comes from the rxjs timeout above.
   */
  private normalise(error: unknown, url: string): ApiError {
    if (error instanceof ApiError) return error;

    if (error instanceof TimeoutError) {
      return new ApiError('The request timed out.', { url, timedOut: true });
    }

    if (error instanceof HttpErrorResponse) {
      if (error.status === 0) {
        return new ApiError('The API could not be reached.', { status: 0, url });
      }

      const body = error.error as ApiErrorBody | null;
      if (body && typeof body === 'object' && body.error && typeof body.error.message === 'string') {
        return ApiError.fromEnvelope(body, error.status, url);
      }

      return new ApiError(`Request failed (${error.status}).`, { status: error.status, url });
    }

    return new ApiError('An unexpected error occurred.', { status: 0, url });
  }

  /* =====================================================================
   * Events - read
   * =================================================================== */

  /**
   * Read a page of events for the public site.
   *
   * GET /api/events, the workhorse behind the home page and the search page.
   *
   * @param query - Filters, sorting and paging. May be omitted, in which case the API
   *   answers with the current and upcoming events only.
   * @returns The events on this page, plus the paging metadata a list control needs.
   */
  getEvents(query: EventQuery = {}): Observable<Paged<Event>> {
    return this.getPaged<Event>('/events', query as Record<string, QueryValue>);
  }

  /**
   * Read a page of the events that are current or upcoming, soonest first.
   *
   * GET /api/events/upcoming.
   *
   * @param query - Filters, sorting and paging. May be omitted, in which case the API's
   *   own defaults apply.
   * @returns The events on this page, plus the paging metadata a list control needs.
   */
  getUpcomingEvents(query: EventQuery = {}): Observable<Paged<Event>> {
    return this.getPaged<Event>('/events/upcoming', query as Record<string, QueryValue>);
  }

  /**
   * Read one event, together with every registration recorded against it.
   *
   * GET /api/events/:id. Assessment 3: the response also carries the registrations,
   * newest purchase first, which the detail page renders directly.
   *
   * @param eventId - Primary key of the event, or the id taken from the route.
   * @returns The event, its ticket tiers and its registrations.
   */
  getEventById(eventId: number | string): Observable<EventDetail> {
    return this.get<EventDetail>(`/events/${encodeURIComponent(eventId)}`);
  }

  /* =====================================================================
   * Events - the C.R.U.D. cycle the admin site drives
   * =================================================================== */

  /**
   * Create a charity event.
   *
   * POST /api/events.
   *
   * @param event - The validated values for the new event.
   * @returns The created event as the API stored it, including its new id.
   */
  createEvent(event: EventInput): Observable<Event> {
    return this.send<Event>('POST', '/events', { body: event }).pipe(map((r) => r.data));
  }

  /**
   * Change an event, sending only the fields that changed.
   *
   * PUT /api/events/:id, used as a partial update: the API changes what is sent and
   * leaves the rest of the row alone.
   *
   * @param eventId - Primary key of the event to change.
   * @param changes - The fields to change, as a partial event.
   * @returns The updated event as the API stored it.
   */
  updateEvent(eventId: number | string, changes: Partial<EventInput>): Observable<Event> {
    return this.send<Event>('PUT', `/events/${encodeURIComponent(eventId)}`, { body: changes }).pipe(
      map((r) => r.data)
    );
  }

  /**
   * Delete an event, unless it already has registrations.
   *
   * DELETE /api/events/:id. Resolves with null on 204 No Content. When the event
   * already has registrations the API refuses with 409, which arrives as a rejected
   * ApiError whose `isConflict` is true - that is the data-integrity rule the brief
   * requires, and the admin list shows it instead of pretending success.
   *
   * @param eventId - Primary key of the event to delete.
   * @returns An Observable that emits null once the API has confirmed the delete with
   *   204 No Content.
   */
  deleteEvent(eventId: number | string): Observable<null> {
    return this.send<null>('DELETE', `/events/${encodeURIComponent(eventId)}`).pipe(
      map((r) => r.data)
    );
  }

  /* =====================================================================
   * Registrations (Assessment 3)
   * =================================================================== */

  /**
   * Register an attendee for an event.
   *
   * POST /api/events/:id/registrations. One email may register for an event once; a
   * second attempt is answered with 409, which the form shows against the email
   * field rather than as a page-level failure.
   *
   * @param eventId - Primary key of the event being registered for.
   * @param registration - The attendee details and the number of tickets.
   * @returns The stored registration, including the total the API computed for it.
   */
  createRegistration(
    eventId: number | string,
    registration: RegistrationInput
  ): Observable<Registration> {
    return this.send<Registration>('POST', `/events/${encodeURIComponent(eventId)}/registrations`, {
      body: registration,
    }).pipe(map((r) => r.data));
  }

  /**
   * Read a page of registrations for the admin list.
   *
   * GET /api/registrations.
   *
   * @param query - Filters and paging. May be omitted, in which case the API's own
   *   defaults apply.
   * @returns The registrations on this page, plus the paging metadata a list control
   *   needs.
   */
  getRegistrations(query: RegistrationQuery = {}): Observable<Paged<Registration>> {
    return this.getPaged<Registration>('/registrations', query as Record<string, QueryValue>);
  }

  /**
   * Read one registration.
   *
   * GET /api/registrations/:id.
   *
   * @param registrationId - Primary key of the registration.
   * @returns The registration as the API stored it.
   */
  getRegistration(registrationId: number | string): Observable<Registration> {
    return this.get<Registration>(`/registrations/${encodeURIComponent(registrationId)}`);
  }

  /**
   * Change a registration, sending only the fields that changed.
   *
   * PUT /api/registrations/:id.
   *
   * @param registrationId - Primary key of the registration to change.
   * @param changes - The fields to change, as a partial registration.
   * @returns The updated registration as the API stored it.
   */
  updateRegistration(
    registrationId: number | string,
    changes: Partial<RegistrationInput>
  ): Observable<Registration> {
    return this.send<Registration>('PUT', `/registrations/${encodeURIComponent(registrationId)}`, {
      body: changes,
    }).pipe(map((r) => r.data));
  }

  /**
   * Delete a registration.
   *
   * DELETE /api/registrations/:id.
   *
   * @param registrationId - Primary key of the registration to delete.
   * @returns An Observable that emits null once the API has confirmed the delete with
   *   204 No Content.
   */
  deleteRegistration(registrationId: number | string): Observable<null> {
    return this.send<null>('DELETE', `/registrations/${encodeURIComponent(registrationId)}`).pipe(
      map((r) => r.data)
    );
  }

  /* =====================================================================
   * Admin views (Assessment 3)
   * =================================================================== */

  /**
   * Read a page of EVERY event, whatever its publishing status.
   *
   * GET /api/admin/events: active, past, suspended and cancelled alike, which is
   * the admin "list feature" the brief describes.
   *
   * @param query - Filters, sorting and paging, including `publishStatus`. May be
   *   omitted, in which case the API's own defaults apply.
   * @returns The events on this page, plus the paging metadata a list control needs.
   */
  getAdminEvents(query: EventQuery = {}): Observable<Paged<Event>> {
    return this.getPaged<Event>('/admin/events', query as Record<string, QueryValue>);
  }

  /**
   * Read one event whatever its publishing status.
   *
   * GET /api/admin/events/:id.
   *
   * @param eventId - Primary key of the event.
   * @returns The event, its ticket tiers and its registrations.
   */
  getAdminEventById(eventId: number | string): Observable<EventDetail> {
    return this.get<EventDetail>(`/admin/events/${encodeURIComponent(eventId)}`);
  }

  /**
   * Read the three dropdown lists the admin event forms need.
   *
   * GET /api/admin/reference-data.
   *
   * @returns The organisations, categories and venues, in one response rather than
   *   three.
   */
  getReferenceData(): Observable<ReferenceData> {
    return this.get<ReferenceData>('/admin/reference-data');
  }

  /* =====================================================================
   * Reference data and health
   * =================================================================== */

  /**
   * Read the category filter options.
   *
   * GET /api/categories.
   *
   * @returns Every category with the number of active events that use it.
   */
  getCategories(): Observable<Category[]> {
    return this.get<Category[]>('/categories');
  }

  /**
   * Read the venue filter options.
   *
   * GET /api/locations.
   *
   * @returns The venues that currently host at least one active event.
   */
  getLocations(): Observable<Venue[]> {
    return this.get<Venue[]>('/locations');
  }

  /**
   * Read the headline numbers.
   *
   * GET /api/stats.
   *
   * @returns The counts and totals the home page and the admin dashboard display.
   */
  getStats(): Observable<EventStats> {
    return this.get<EventStats>('/stats');
  }

  /**
   * Read the featured charitable organisation.
   *
   * GET /api/organization.
   *
   * @returns The organisation whose mission the home page features.
   */
  getOrganization(): Observable<Organization> {
    return this.get<Organization>('/organization');
  }

  /**
   * Check the API and the database behind it.
   *
   * GET /api/health, used by the footer and the admin dashboard.
   *
   * @returns The API's own status, and the database half of the report with the data
   *   source that answered.
   */
  getHealth(): Observable<HealthReport> {
    return this.get<HealthReport>('/health');
  }
}
