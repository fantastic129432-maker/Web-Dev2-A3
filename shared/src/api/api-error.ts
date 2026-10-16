/**
 * @file The single error type every API call in both Angular applications fails with.
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
const HTTP_STATUS = {
  badRequest: 400,
  notFound: 404,
  conflict: 409,
  tooManyRequests: 429,
  serverError: 500,
} as const;

/**
 * The error every failing API call arrives as, whatever actually went wrong.
 *
 * A component therefore catches one type and renders one message, and the message
 * is produced late - by `friendlyMessage`, when the UI asks for it - so an error
 * already on screen is re-rendered in the new language when the visitor switches.
 */
export class ApiError extends Error {
  /** The HTTP status, or 0 when the request never reached a server. */
  readonly status: number;
  /** Per-field problems (400) or the conflict payload (409), as received. */
  readonly details: ApiErrorDetail[] | Record<string, unknown> | null;
  /** The full URL that was called, which makes a bug report actionable. */
  readonly url: string;
  /** True when the request timed out rather than being refused. */
  readonly timedOut: boolean;

  /**
   * Build an error from an HTTP failure, a timeout or a client-side fault.
   *
   * @param message - The message to carry, normally the API's own wording. An EMPTY
   *   string is passed when the server sent no wording: unlike an English fallback,
   *   it lets `friendlyMessage()` resolve the status to a dictionary key, so a 404
   *   or a 409 is still explained in the active language. May be omitted, in which
   *   case the error reads as a client-side fault with status 0.
   * @param options - The status, the `details` payload, the URL and the timeout flag. May
   *   be omitted, in which case the error reads as a client-side fault with status 0.
   */
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
   * 409: the request contradicts the current state.
   *
   * In this project that is mainly "this event already has registrations, so it
   * cannot be deleted" - the data-integrity rule the brief asks for.
   */
  get isConflict(): boolean {
    return this.status === HTTP_STATUS.conflict;
  }

  /** 5xx: the API itself failed. */
  get isServerError(): boolean {
    return this.status >= HTTP_STATUS.serverError;
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

    // An explicit loop rather than filter+map: `message` is optional on
    // ApiErrorDetail (a 409 conflict carries facts, not a message), so narrowing
    // has to happen where the value is read.
    const problems: { field: string; message: string }[] = [];
    for (const item of this.details) {
      if (!item || typeof item.message !== 'string') continue;
      problems.push({ field: item.field ?? '', message: item.message });
    }
    return problems;
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
   * The facts behind a blocked delete, when the API sent them.
   *
   * The admin list uses this to say WHICH event was kept and why, so getting it
   * wrong is not cosmetic: it turns "Coastal Stars Gala Dinner cannot be deleted
   * because 3 registrations exist" into a bare error.
   *
   * The check is deliberately about the FACTS, not about a `message`. This API's
   * 409 sends `{ eventId, eventName, registrationCount, suggestion }` as the
   * details object, and that object carries no `message` field of its own (the
   * sentence explaining the clash is on the envelope, not in these facts) - an
   * earlier version of this accessor required one and so returned null for every
   * conflict it was written to explain. It now accepts any object carrying at
   * least one recognisable conflict fact, and still returns null for an object
   * payload that means something else.
   */
  get conflictDetails(): ApiErrorDetail | null {
    if (Array.isArray(this.details) || this.details === null) return null;
    if (typeof this.details !== 'object') return null;

    const record = this.details as Record<string, unknown>;
    const carriesConflictFacts =
      typeof record['eventName'] === 'string' ||
      typeof record['registrationCount'] === 'number' ||
      typeof record['eventId'] === 'number' ||
      typeof record['suggestion'] === 'string';

    return carriesConflictFacts ? (record as unknown as ApiErrorDetail) : null;
  }

  /* ------------------------------------------------------------- display */

  /**
   * A message that is safe and helpful to show a person, in the active language.
   *
   * The API's own wording is preferred where it is genuinely useful (a 404
   * names the missing event; a 409 explains how many registrations block the
   * delete). For everything else a translated, status-appropriate sentence is
   * better than an internal message, so the i18n key is used instead.
   *
   * Two of those statuses carry a decision worth keeping in writing. A 429 means
   * the API's rate limiter refused the request, so the visitor is told to slow
   * down in their own language rather than shown the limiter's own wording. A
   * status of 0 with `timedOut` false is the "never reached a server" case
   * (offline, DNS failure, CORS rejection), and it is named EXPLICITLY rather
   * than left to the last branch. A timeout also leaves no HTTP status behind,
   * but it arrives with `timedOut` set and is named first instead, because "check
   * your connection" is the wrong advice for a slow API.
   *
   * The explicit status-0 test matters for a status that is none of the above: a
   * 200 carrying `success: false` (the contract violation ApiService raises) is a
   * server that answered, so the last branch would have told the visitor to check
   * a connection that plainly worked. Anything unmapped now gets the server
   * sentence, which is true of a server that answered with something unusable.
   *
   * @param t - The `TranslationService.t` function for the active language.
   * @returns The message to display: the API's wording where it is useful, and a
   *   translated sentence chosen from the status otherwise.
   */
  friendlyMessage(t: (key: string) => string): string {
    if (this.timedOut) return t('error.timeout');
    if (this.status === HTTP_STATUS.notFound) return this.message || t('error.notFound');
    if (this.status === HTTP_STATUS.badRequest) return t('error.badRequest');
    if (this.status === HTTP_STATUS.conflict) return this.message || t('error.conflict');
    if (this.status === HTTP_STATUS.tooManyRequests) return t('error.rateLimited');
    if (this.isServerError) return t('error.server');
    if (this.status === 0) return t('error.offline');
    return t('error.server');
  }

  /**
   * Rebuild an ApiError from a decoded error envelope.
   *
   * Used by ApiService for an error status and for the contract violation of a
   * 200 that carries `success: false`.
   *
   * An envelope with no `message` yields an EMPTY message rather than an English
   * fallback such as "Request failed (404).": `friendlyMessage()` shows
   * `this.message` for a 404 and a 409, so an empty one resolves to the
   * translated sentence for the status instead of printing English under a
   * Chinese banner. The status and the URL still identify the failure.
   *
   * @param body - The decoded `{ success: false, error: { ... } }` response.
   * @param status - The HTTP status the response arrived with.
   * @param url - The full URL that was requested, which makes a bug report actionable.
   * @returns A new error carrying the envelope's message, details and status.
   */
  static fromEnvelope(body: ApiErrorBody, status: number, url: string): ApiError {
    return new ApiError(body.error?.message ?? '', {
      status,
      details: body.error?.details ?? null,
      url,
    });
  }
}
