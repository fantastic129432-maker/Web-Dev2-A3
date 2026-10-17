/**
 * The one description of an on-screen feedback message, and the one place a failed
 * API call is turned into one.
 *
 * @file The feedback-message model shared by every admin page.
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
  /** Which accent the stylesheet applies to the banner. */
  readonly tone: BannerTone;
  /** The short heading, which is often the name of the thing acted on. */
  readonly title: string;
  /** The one-sentence explanation of what happened. */
  readonly message: string;
  /** Extra lines rendered as a list under the message. */
  readonly details: readonly string[];
}

/** A translation function: the `.t` of TranslationService, or a stand-in. */
export type Translate = (key: string, values?: Readonly<Record<string, string | number>>) => string;

/**
 * Build a banner, so no page has to spell out all four fields.
 *
 * @param tone - Which accent the banner is drawn with.
 * @param title - The short heading.
 * @param message - The one-sentence explanation.
 * @param details - Extra lines rendered as a list; may be omitted for none.
 * @returns The assembled banner value.
 */
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
  /** The id of the event the refused delete was about, when the API named it. */
  readonly eventId?: number;
  /** The name of that event, when the API named it. */
  readonly eventName?: string;
  /** How many registrations block the delete, when the API reported a number. */
  readonly registrationCount?: number;
  /**
   * The API's stable code for the advice to offer, e.g. "suspend-instead".
   *
   * A code, never a sentence: the client maps it to its own translated wording
   * and has a generic fallback for a code it does not recognise.
   */
  readonly suggestion?: string;
}

/**
 * The event a refused delete is about, how many registrations protect it, and the
 * advice the API suggests.
 *
 * ApiError.conflictDetails is the documented accessor, and it is used first. It
 * answers for any object carrying a recognised conflict fact, so this API's 409 -
 * `{ eventId, eventName, registrationCount, suggestion }`, with no `message` of
 * its own - is read through it. The raw `details` record is still read as a
 * fallback, so a payload the accessor declines cannot silently drop the facts:
 * without it the banner would show the event name and count only inside the API's
 * own sentence, and nothing structured at all.
 *
 * `suggestion` is a CODE rather than wording, so it is kept as one here and the
 * banner chooses the sentence in the reader's language. Only a non-empty string
 * is accepted: anything else is dropped, and the banner's generic fallback then
 * explains the refusal instead of the client guessing at advice it was not given.
 *
 * @param error - The 409 the API answered a delete with.
 * @returns Whatever the conflict payload named; an empty object when it carried
 *   nothing structured.
 */
export function conflictFacts(error: ApiError): ConflictFacts {
  const direct = error.conflictDetails;
  if (direct?.eventName || direct?.registrationCount !== undefined || direct?.suggestion) {
    return {
      eventId: direct.eventId,
      eventName: direct.eventName,
      registrationCount: direct.registrationCount,
      suggestion: nonEmptyString(direct.suggestion),
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
    suggestion: nonEmptyString(record['suggestion']),
  };
}

/** A value as a usable string, or undefined when it is not a non-empty string. */
function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * The dictionary key for each suggestion code the API can send.
 *
 * `suggestion` is a stable code because the API deliberately leaves the wording
 * to the interface, so the client maps the code to a key and translates it when
 * the banner is built. A code that is not listed here gets
 * `delete.blockedSuggestionUnknown` rather than borrowing the suspend advice:
 * the fallback still explains the refusal and points at the registrations, while
 * guessing another code's meaning could tell staff to do the wrong thing.
 *
 * Adding a suggestion to the contract means adding one entry here (and its
 * sentence to all four dictionaries), which is the whole point of the field.
 */
const SUGGESTION_KEYS: ReadonlyMap<string, string> = new Map([
  ['suspend-instead', 'delete.blockedSuggestion'],
]);

/** The key used when the API's suggestion is missing or not a known code. */
const SUGGESTION_FALLBACK_KEY = 'delete.blockedSuggestionUnknown';

/**
 * Turn any thrown value into a banner.
 *
 * `labels` maps an API field name ("eventName", "ticketTypes[0].price") to the
 * label a person recognises, so a 400 does not list raw column names. The event
 * form owns that mapping because it is the only thing that knows the field list.
 *
 * @param error - The value a failed request rejected with; anything that is not
 *   an ApiError becomes a generic server-error banner.
 * @param t - The translation function, called at the moment the banner is built.
 * @param title - The heading to give the banner, usually the page's own context.
 * @param labels - Optional map from an API field name to the label a person
 *   recognises.
 * @returns The banner describing the failure, with its tone chosen from the one
 *   error's status.
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
   * readable without parsing the sentence, and the advice line is chosen from the
   * API's `suggestion` code - not echoed from the API and not assumed - so an
   * unknown code still gets a true, translated sentence.
   */
  if (error.isConflict) {
    const conflict = conflictFacts(error);
    const details: string[] = [];

    if (conflict.eventName) details.push(`${t('events.colName')}: ${conflict.eventName}`);
    if (conflict.registrationCount !== undefined) {
      details.push(`${t('events.colRegistrations')}: ${conflict.registrationCount}`);
    }
    details.push(t(SUGGESTION_KEYS.get(conflict.suggestion ?? '') ?? SUGGESTION_FALLBACK_KEY));

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
