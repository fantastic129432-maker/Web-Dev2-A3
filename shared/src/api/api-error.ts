/**
 * shared/src/api/api-error.ts
 * ---------------------------------------------------------------------------
 * The single error type every API call in both Angular applications fails with.
 *
 * Why a custom error at all? Three reasons, and each one earns its place:
 *
 *   1. One shape. A network failure, a 404, a 400 with per-field problems and a
 *      409 conflict all arrive here as an ApiError, so a component has exactly
 *      one thing to catch and one thing to render.
 *
 *   2. Translation happens late. The message is produced when the UI asks for
 *      it (friendlyMessage), not when the error is created, so switching from
 *      English to Chinese re-renders the same error in the new language.
 *
 *   3. Field errors are normalised. The API sends `details` as an ARRAY for a
 *      validation failure ({ field, message }) but as an OBJECT for the delete
 *      conflict. `fieldErrors` flattens both so no page has to care which it got.
 */
import type { ApiErrorBody, ApiErrorDetail } from '../models/api.model';

/** HTTP status codes this application reacts to by name. */
export const HTTP_STATUS = {
  badRequest: 400,
  notFound: 404,
  conflict: 409,
  tooManyRequests: 429,
  serverError: 500,
} as const;

export class ApiError extends Error {
  /** The HTTP status, or 0 when the request never reached a server. */
  readonly status: number;
  /** Per-field problems (400) or the conflict payload (409), as received. */
  readonly details: ApiErrorDetail[] | Record<string, unknown> | null;
  /** The full URL that was called, which makes a bug report actionable. */
  readonly url: string;
  /** True when the request timed out rather than being refused. */
  readonly timedOut: boolean;

  constructor(
    message: string,
    options: {
      status?: number;
      details?: ApiErrorDetail[] | Record<string, unknown> | null;
      url?: string;
      timedOut?: boolean;
    } = {}
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = options.status ?? 0;
    this.details = options.details ?? null;
    this.url = options.url ?? '';
    this.timedOut = options.timedOut ?? false;
  }

  /* ---------------------------------------------------------------- kinds */

  /** 400: the API rejected one or more fields. */
  get isValidation(): boolean {
    return this.status === HTTP_STATUS.badRequest;
  }

  /** 404: there is no such event / registration. */
  get isNotFound(): boolean {
    return this.status === HTTP_STATUS.notFound;
  }

  /**
   * 409: the request contradicts the current state. In this project that is
   * mainly "this event already has registrations, so it cannot be deleted" -
   * the data-integrity rule the brief asks for.
   */
  get isConflict(): boolean {
    return this.status === HTTP_STATUS.conflict;
  }

  /** 429: the API's rate limiter refused the request. */
  get isRateLimited(): boolean {
    return this.status === HTTP_STATUS.tooManyRequests;
  }

  /** 5xx: the API itself failed. */
  get isServerError(): boolean {
    return this.status >= HTTP_STATUS.serverError;
  }

  /** Never reached the server, or the request was aborted by the timeout. */
  get isOffline(): boolean {
    return this.status === 0 && !this.timedOut;
  }

  /**
   * The per-field problems, flattened to a uniform list.
   *
   * A 400 arrives as [{ field, message }, ...]; anything else has no field list,
   * so an empty array is returned and the caller falls back to the summary
   * message.
   */
  get fieldErrors(): { field: string; message: string }[] {
    if (!Array.isArray(this.details)) return [];
    return this.details
      .filter((item): item is ApiErrorDetail => Boolean(item) && typeof item.message === 'string')
      .map((item) => ({ field: item.field ?? '', message: item.message }));
  }

  /** The per-field problems keyed by field name, for a form to look up. */
  get fieldErrorMap(): Record<string, string> {
    const map: Record<string, string> = {};
    for (const problem of this.fieldErrors) {
      if (problem.field && !map[problem.field]) map[problem.field] = problem.message;
    }
    return map;
  }

  /**
   * The conflict payload of a blocked delete, when the API sent one.
   * The admin list uses it to say WHICH event was kept and why.
   */
  get conflictDetails(): ApiErrorDetail | null {
    if (Array.isArray(this.details) || this.details === null) return null;
    const record = this.details;
    if (typeof record['message'] !== 'string') return null;
    return record as unknown as ApiErrorDetail;
  }

  /* ------------------------------------------------------------- display */

  /**
   * A message that is safe and helpful to show a person, in the active
   * language.
   *
   * The API's own wording is preferred where it is genuinely useful (a 404
   * names the missing event; a 409 explains how many registrations block the
   * delete). For everything else a translated, status-appropriate sentence is
   * better than an internal message, so the i18n key is used instead.
   *
   * @param t the TranslationService.t function for the active language
   */
  friendlyMessage(t: (key: string) => string): string {
    if (this.timedOut) return t('error.timeout');
    if (this.status === HTTP_STATUS.notFound) return this.message || t('error.notFound');
    if (this.status === HTTP_STATUS.badRequest) return t('error.badRequest');
    if (this.status === HTTP_STATUS.conflict) return this.message || t('error.conflict');
    if (this.status === HTTP_STATUS.tooManyRequests) return t('error.rateLimited');
    if (this.isServerError) return t('error.server');
    return t('error.offline');
  }

  /** Rebuild an ApiError from a decoded error envelope. */
  static fromEnvelope(body: ApiErrorBody, status: number, url: string): ApiError {
    return new ApiError(body.error?.message || `Request failed (${status}).`, {
      status,
      details: body.error?.details ?? null,
      url,
    });
  }
}
