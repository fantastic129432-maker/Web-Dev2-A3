/**
 * @file The envelope every endpoint of the Charity Events API answers with.
 *
 *   {
 *     "success": true,
 *     "meta":    { "resource": "events", "total": 6, ... },
 *     "data":    [ ... ] | { ... }
 *   }
 *
 * A failure answers with the same shape but `success: false` and an `error`
 * object, which is what ApiService turns into an ApiError.
 */

/** Metadata the API attaches to a response. Only some fields apply to a given endpoint. */
export interface ApiMeta {
  /** The resource the response describes, for example "events". */
  resource?: string;
  /** "local" or "mysql" - which data source answered. Shown in the footer/dashboard. */
  dataSource?: string;
  generatedAt?: string;
  /** Paging, present on list endpoints. */
  total?: number;
  count?: number;
  page?: number;
  totalPages?: number;
  limit?: number;
  offset?: number;
  /** The filters the API actually applied, which proves a query was honoured. */
  appliedFilters?: Record<string, string | number | boolean | string[]>;
  /** "admin" on the admin views. */
  view?: string;
  /** True on a 201 Created / 200 updated response. */
  created?: boolean;
  updated?: boolean;
}

/** The success envelope. */
export interface ApiEnvelope<T> {
  success: boolean;
  meta?: ApiMeta;
  data: T;
}

/**
 * The payload a failed write returns.
 *
 * Two DIFFERENT shapes travel in `details`, which is why almost every field here
 * is optional:
 *
 *   a 400 (validation)  an ARRAY of { field, message } - one entry per problem,
 *                       rendered next to the offending form control
 *   a 409 (conflict)    an OBJECT of facts about the clash, with no `message`
 *                       field of its own:
 *                       { eventId, eventName, registrationCount, suggestion }
 *
 * The 409 is the delete rule: the event cannot be removed because registrations
 * exist, so the API puts the numbers the UI needs to explain itself in that
 * object. The ENVELOPE still carries a sentence about the clash (the live body
 * reads `"X cannot be deleted because 4 registrations have already been recorded
 * for it..."`), but the object does not, and that distinction is what the
 * paragraph below turns on. `message` on a detail is therefore optional, and an
 * accessor that insists on it will silently return nothing for every conflict -
 * which is exactly the bug ApiError.conflictDetails used to have.
 */
export interface ApiErrorDetail {
  /** The form field the problem belongs to (400 only). */
  field?: string;
  /** The human-readable problem (400 only). */
  message?: string;
  /** The event that could not be deleted (409 only). */
  eventId?: number;
  /** Its name, so the message can say which event (409 only). */
  eventName?: string;
  /** How many registrations block the delete (409 only). */
  registrationCount?: number;
  /** What the API suggests instead, e.g. "suspend-instead" (409 only). */
  suggestion?: string;
}

/** The error envelope. */
export interface ApiErrorBody {
  success: false;
  error: {
    /**
     * The same status the response arrived with, repeated in the body.
     *
     * This API sends it (see any 4xx/5xx answer: `{"success":false,"error":
     * {"status":404,"message":"..."}}`), which is why it is declared here. No
     * caller reads it - `ApiError.status` is taken from the HTTP response, which
     * cannot disagree with the body - but a model that omits a field the API
     * always sends is a model of something else.
     */
    status?: number;
    message: string;
    /**
     * An optional machine-readable failure name.
     *
     * Accepted for an API that names its failures, but THIS one sends none: a
     * failure is identified by `status`, so `code` is never present in a response.
     */
    code?: string;
    details?: ApiErrorDetail[] | Record<string, unknown> | null;
  };
}

/** Paging metadata, narrowed from ApiMeta for the list endpoints. */
export interface PagedMeta extends ApiMeta {
  total: number;
  count: number;
  page: number;
  totalPages: number;
  limit: number;
  offset: number;
}

/**
 * A page of results: the rows, plus the paging a "page 2 of 3" control needs.
 */
export interface Paged<T> {
  readonly items: readonly T[];
  readonly meta: PagedMeta;
}
