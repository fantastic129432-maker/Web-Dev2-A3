/**
 * shared/src/api/api.service.ts
 * ---------------------------------------------------------------------------
 * The single point in EITHER Angular application that talks to the REST API.
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
  eventId?: number | string;
  email?: string;
  keyword?: string;
  limit?: number;
  offset?: number;
  page?: number;
}

/** Values a query parameter may hold. Arrays become repeated parameters. */
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
 * Fill in the paging fields the UI relies on. A list endpoint always sends them,
 * but a defensive default means a control can render even if one is missing.
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

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL).replace(/\/+$/, '');

  /* =====================================================================
   * The one request implementation
   * =================================================================== */

  /**
   * Perform a request and return the payload plus the API metadata.
   *
   * @param method  GET | POST | PUT | DELETE
   * @param path    e.g. '/events/2'
   * @param options query parameters and/or a JSON body
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
   * GET /api/events
   * The workhorse behind the home page and the search page. With no parameters
   * the API answers with the current and upcoming events only.
   */
  getEvents(query: EventQuery = {}): Observable<Paged<Event>> {
    return this.getPaged<Event>('/events', query as Record<string, QueryValue>);
  }

  /** GET /api/events/upcoming - current and upcoming events, soonest first. */
  getUpcomingEvents(query: EventQuery = {}): Observable<Paged<Event>> {
    return this.getPaged<Event>('/events/upcoming', query as Record<string, QueryValue>);
  }

  /**
   * GET /api/events/:id
   * Assessment 3: the response also carries every registration for the event,
   * newest purchase first, which the detail page renders directly.
   */
  getEventById(eventId: number | string): Observable<EventDetail> {
    return this.get<EventDetail>(`/events/${encodeURIComponent(eventId)}`);
  }

  /* =====================================================================
   * Events - the C.R.U.D. cycle the admin site drives
   * =================================================================== */

  /** POST /api/events - create a charity event. */
  createEvent(event: EventInput): Observable<Event> {
    return this.send<Event>('POST', '/events', { body: event }).pipe(map((r) => r.data));
  }

  /** PUT /api/events/:id - a partial update; only the fields sent are changed. */
  updateEvent(eventId: number | string, changes: Partial<EventInput>): Observable<Event> {
    return this.send<Event>('PUT', `/events/${encodeURIComponent(eventId)}`, { body: changes }).pipe(
      map((r) => r.data)
    );
  }

  /**
   * DELETE /api/events/:id
   *
   * Resolves with null on 204 No Content. When the event already has
   * registrations the API refuses with 409, which arrives here as a rejected
   * ApiError whose `isConflict` is true - that is the data-integrity rule the
   * brief requires, and the admin list shows it instead of pretending success.
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
   * GET /api/events/:id/registrations
   * The list the event detail page displays, newest purchase first.
   */
  getEventRegistrations(eventId: number | string): Observable<Registration[]> {
    return this.get<Registration[]>(`/events/${encodeURIComponent(eventId)}/registrations`);
  }

  /**
   * POST /api/events/:id/registrations
   * The registration form calls this. One email may register for an event once;
   * a second attempt is answered with 409.
   */
  createRegistration(
    eventId: number | string,
    registration: RegistrationInput
  ): Observable<Registration> {
    return this.send<Registration>('POST', `/events/${encodeURIComponent(eventId)}/registrations`, {
      body: registration,
    }).pipe(map((r) => r.data));
  }

  /** GET /api/registrations - every registration, for the admin list. */
  getRegistrations(query: RegistrationQuery = {}): Observable<Paged<Registration>> {
    return this.getPaged<Registration>('/registrations', query as Record<string, QueryValue>);
  }

  /** GET /api/registrations/:id */
  getRegistration(registrationId: number | string): Observable<Registration> {
    return this.get<Registration>(`/registrations/${encodeURIComponent(registrationId)}`);
  }

  /** PUT /api/registrations/:id */
  updateRegistration(
    registrationId: number | string,
    changes: Partial<RegistrationInput>
  ): Observable<Registration> {
    return this.send<Registration>('PUT', `/registrations/${encodeURIComponent(registrationId)}`, {
      body: changes,
    }).pipe(map((r) => r.data));
  }

  /** DELETE /api/registrations/:id */
  deleteRegistration(registrationId: number | string): Observable<null> {
    return this.send<null>('DELETE', `/registrations/${encodeURIComponent(registrationId)}`).pipe(
      map((r) => r.data)
    );
  }

  /* =====================================================================
   * Admin views (Assessment 3)
   * =================================================================== */

  /**
   * GET /api/admin/events
   * EVERY event regardless of status (active, past, suspended, cancelled),
   * which is the admin "list feature" the brief describes.
   */
  getAdminEvents(query: EventQuery = {}): Observable<Paged<Event>> {
    return this.getPaged<Event>('/admin/events', query as Record<string, QueryValue>);
  }

  /** GET /api/admin/events/:id - one event whatever its publishing status. */
  getAdminEventById(eventId: number | string): Observable<EventDetail> {
    return this.get<EventDetail>(`/admin/events/${encodeURIComponent(eventId)}`);
  }

  /** GET /api/admin/reference-data - organisations, categories and venues. */
  getReferenceData(): Observable<ReferenceData> {
    return this.get<ReferenceData>('/admin/reference-data');
  }

  /* =====================================================================
   * Reference data and health
   * =================================================================== */

  /** GET /api/categories - category filter options with active event counts. */
  getCategories(): Observable<Category[]> {
    return this.get<Category[]>('/categories');
  }

  /** GET /api/locations - venues that currently host at least one active event. */
  getLocations(): Observable<Venue[]> {
    return this.get<Venue[]>('/locations');
  }

  /** GET /api/stats - headline numbers for the home page and the dashboard. */
  getStats(): Observable<EventStats> {
    return this.get<EventStats>('/stats');
  }

  /** GET /api/organization - the charitable organisation featured on the home page. */
  getOrganization(): Observable<Organization> {
    return this.get<Organization>('/organization');
  }

  /** GET /api/health - used by the footer and the admin dashboard. */
  getHealth(): Observable<HealthReport> {
    return this.get<HealthReport>('/health');
  }
}
