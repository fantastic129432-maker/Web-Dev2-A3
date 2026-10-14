/**
 * adminside/src/app/core/feedback.ts
 * ---------------------------------------------------------------------------
 * The one description of an on-screen feedback message, and the one place a
 * failed API call is turned into one.
 *
 * WHY THIS IS A PLAIN MODULE RATHER THAN PART OF THE BANNER COMPONENT
 *   A banner is DATA (tone, title, message, extra lines) and a component is the
 *   way that data is PAINTED. Several pages produce the data - the event list,
 *   the two event forms, the registrations page - and they all have to handle
 *   the same three failures: a 400 with one entry per bad field, a 409 (the
 *   delete that data integrity refuses) and a dead API. Deciding that once here
 *   is what stops one page from rendering a blank screen where another shows an
 *   explanation.
 *
 *   It also means the messages are built through TranslationService.t at the
 *   moment the error is shown, so switching language re-renders an error that is
 *   already on screen in the new language.
 */
import { ApiError } from '@charity/shared/api/api-error';

/** The four tones the admin stylesheet defines (.banner--info, --success, ...). */
export type BannerTone = 'info' | 'success' | 'warning' | 'error';

/** One message at the top of a page. `details` becomes a list under the message. */
export interface Banner {
  readonly tone: BannerTone;
  readonly title: string;
  readonly message: string;
  readonly details: readonly string[];
}

/** A translation function: the `.t` of TranslationService, or a stand-in. */
export type Translate = (key: string, values?: Readonly<Record<string, string | number>>) => string;

/** Build a banner, so no page has to spell out all four fields. */
export function banner(
  tone: BannerTone,
  title: string,
  message: string,
  details: readonly string[] = []
): Banner {
  return { tone, title, message, details };
}

/** One label/value pair a page can render itself if it wants more than a banner. */
export interface ConflictFacts {
  readonly eventId?: number;
  readonly eventName?: string;
  readonly registrationCount?: number;
}

/**
 * The event a refused delete is about, and how many registrations protect it.
 *
 * ApiError.conflictDetails is the documented accessor, and it is used first. It
 * only answers when the conflict payload carries a `message`, though, and this
 * API's 409 sends `{ eventId, eventName, registrationCount, suggestion }` with no
 * `message` - so the raw `details` record is read as a fallback. Without that
 * fallback the banner would show the event name and count only inside the API's
 * own sentence, and nothing structured at all.
 */
export function conflictFacts(error: ApiError): ConflictFacts {
  const direct = error.conflictDetails;
  if (direct?.eventName || direct?.registrationCount !== undefined) {
    return {
      eventId: direct.eventId,
      eventName: direct.eventName,
      registrationCount: direct.registrationCount,
    };
  }

  const raw = error.details;
  if (!raw || Array.isArray(raw)) return {};

  const record = raw as Record<string, unknown>;
  const eventName = record['eventName'];
  const registrationCount = record['registrationCount'];
  const eventId = record['eventId'];

  return {
    eventId: typeof eventId === 'number' ? eventId : undefined,
    eventName: typeof eventName === 'string' ? eventName : undefined,
    registrationCount: typeof registrationCount === 'number' ? registrationCount : undefined,
  };
}

/**
 * Turn any thrown value into a banner.
 *
 * `labels` maps an API field name ("eventName", "ticketTypes[0].price") to the
 * label a person recognises, so a 400 does not list raw column names. The event
 * form owns that mapping because it is the only thing that knows the field list.
 */
export function errorBanner(
  error: unknown,
  t: Translate,
  title: string,
  labels: ReadonlyMap<string, string> = new Map<string, string>()
): Banner {
  if (!(error instanceof ApiError)) {
    return banner('error', title, t('error.server'));
  }

  /*
   * 409 - the conflict. In this project that is the delete that the data
   * integrity rule refuses, and the API's own sentence is the most useful thing
   * to show: it names the event and how many registrations block it. The
   * structured part of `details` is listed underneath so the numbers are
   * readable without parsing the sentence.
   */
  if (error.isConflict) {
    const conflict = conflictFacts(error);
    const details: string[] = [];

    if (conflict.eventName) details.push(`${t('events.colName')}: ${conflict.eventName}`);
    if (conflict.registrationCount !== undefined) {
      details.push(`${t('events.colRegistrations')}: ${conflict.registrationCount}`);
    }
    details.push(t('delete.blockedSuggestion'));

    return banner('warning', title, error.friendlyMessage(t), details);
  }

  /* 400 - one entry per field the API rejected, and the same messages are also
     placed beside their own inputs by the form. */
  if (error.isValidation) {
    const details = error.fieldErrors.map((problem) =>
      problem.field
        ? `${labels.get(problem.field) ?? problem.field}: ${problem.message}`
        : problem.message
    );

    return banner('error', title, error.friendlyMessage(t), details);
  }

  /* 404 - the event was deleted in another tab, or the id in the URL is wrong. */
  if (error.isNotFound) {
    return banner('warning', title, error.friendlyMessage(t));
  }

  /* Everything else: timed out, server error, unreachable API. */
  return banner('error', title, error.friendlyMessage(t));
}
