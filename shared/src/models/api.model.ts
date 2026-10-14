/**
 * shared/src/models/api.model.ts
 * ---------------------------------------------------------------------------
 * The envelope every endpoint of the Charity Events API answers with.
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
 * One per-field problem. A 400 (validation) sends an array of these; a 409
 * (conflict) sends an object describing the clash. The extra fields below carry
 * the conflict payload the delete rule returns.
 */
export interface ApiErrorDetail {
  field?: string;
  message: string;
  eventId?: number;
  eventName?: string;
  registrationCount?: number;
  suggestion?: string;
}

/** The error envelope. */
export interface ApiErrorBody {
  success: false;
  error: {
    message: string;
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
 * A page of results: the rows plus the paging information needed to render a
 * "page 2 of 3" control.
 */
export interface Paged<T> {
  readonly items: readonly T[];
  readonly meta: PagedMeta;
}
