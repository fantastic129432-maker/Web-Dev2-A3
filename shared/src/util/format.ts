/**
 * @file Presentation helpers used by both Angular applications.
 *
 * These are ports of the functions in the vanilla js/dom.js, kept deliberately
 * identical in output so the Angular pages show exactly the same strings as the
 * pages they replace:
 *
 *   25000    -> "$25,000"                     (fundraising totals)
 *   45       -> "$45.00"                      (ticket prices)
 *   2026-10-11 -> "Sunday 11 October 2026"
 *   "07:30:00" -> "7:30 am"
 *
 * A plain function rather than a pipe is used for anything with no per-language
 * variation; dates and money are formatted with the en-AU locale because the
 * organisation, the seeded data and the assessed deployment are all Australian.
 */
import { APP_CONFIG } from '../config/app-config';
import type { Event } from '../models/event.model';

/** Whole dollars, for totals. */
const CURRENCY = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  maximumFractionDigits: 0,
});

/** With cents, for a price a visitor pays. */
const CURRENCY_WITH_CENTS = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Format a fundraising total as whole Australian dollars.
 *
 * @param amount - A number, or a numeric string straight from the API, or null when the
 *   API sent no figure, which is treated as zero rather than rendering as "NaN".
 * @returns The amount as currency, for example 25000 becomes "$25,000".
 */
export function formatCurrency(amount: number | string | null | undefined): string {
  return CURRENCY.format(Number(amount ?? 0) || 0);
}

/**
 * Format a ticket price with its cents.
 *
 * Cents are shown here but not on a fundraising total, because a price is money
 * a visitor actually pays and "$45" next to "$45.50" would look like a mistake.
 *
 * @param amount - A number, or a numeric string straight from the API, or null when the
 *   API sent no figure, which is treated as zero.
 * @returns The amount as currency, for example 45 becomes "$45.00".
 */
export function formatPrice(amount: number | string | null | undefined): string {
  return CURRENCY_WITH_CENTS.format(Number(amount ?? 0) || 0);
}

/**
 * Format a stored date in full, in the assessed Australian locale.
 *
 * @param isoDate - A `YYYY-MM-DD` date as the database stores it.
 * @returns The date written out, for example '2026-10-11' becomes 'Sunday 11 October
 *   2026'; an empty string when `isoDate` is missing, and the input unchanged when it
 *   cannot be parsed so a bad value is visible rather than silently replaced.
 */
export function formatDate(isoDate: string | null | undefined): string {
  if (!isoDate) return '';
  const date = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) return isoDate;
  return date.toLocaleDateString('en-AU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/**
 * Format a stored date in the short form a card or a list row has room for.
 *
 * @param isoDate - A `YYYY-MM-DD` date as the database stores it.
 * @returns The abbreviated date, for example '2026-10-11' becomes '11 Oct 2026'; an
 *   empty string when `isoDate` is missing, and the input unchanged when it cannot be
 *   parsed.
 */
export function formatShortDate(isoDate: string | null | undefined): string {
  if (!isoDate) return '';
  const date = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) return isoDate;
  return date.toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Format a stored clock time as a visitor reads it.
 *
 * The time is placed on today's date purely to borrow `toLocaleTimeString`; only
 * the time part is ever returned.
 *
 * @param time - A `HH:MM:SS` time as the database stores it.
 * @returns The time in lower case 12-hour form, for example '07:30:00' becomes
 *   '7:30 am', or an empty string when `time` is missing.
 */
export function formatTime(time: string | null | undefined): string {
  if (!time) return '';
  const [hours, minutes] = time.split(':');
  const date = new Date();
  date.setHours(Number(hours), Number(minutes), 0, 0);
  return date.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' }).toLowerCase();
}

/**
 * Format an event's dates, including multi-day events.
 *
 * A single-day event shows one date; the three-week art exhibition shows a range.
 *
 * @param event - The event whose dates are wanted.
 * @returns The short date, or the short start and end dates joined by a hyphen, or an
 *   empty string when the event carries no usable date at all.
 */
export function formatDateRange(event: Event): string {
  const start = event.dateStart ?? event.eventDate ?? '';
  const end = event.dateEnd ?? start;
  if (!end || end === start) return formatShortDate(start);
  return `${formatShortDate(start)} - ${formatShortDate(end)}`;
}

/**
 * Format an event's start and end times as one range.
 *
 * @param event - The event whose times are wanted.
 * @returns The two times joined by a hyphen, the start time alone when no end time is
 *   recorded, or an empty string when the start time is missing.
 */
export function formatTimeRange(event: Event): string {
  const start = formatTime(event.startTime);
  const end = formatTime(event.endTime);
  if (!start) return '';
  return end ? `${start} - ${end}` : start;
}

/**
 * Format a registration timestamp as a date and a time.
 *
 * @param value - A `YYYY-MM-DD HH:MM:SS` timestamp as the API sends it.
 * @returns The timestamp such as '14 Sep 2026, 8:57 am', an empty string when `value`
 *   is missing, and the input unchanged when it cannot be parsed.
 */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '';
  // The API sends "2026-09-14 08:57:00"; Safari needs the space replaced by T.
  const date = new Date(value.replace(' ', 'T'));
  if (Number.isNaN(date.getTime())) return value;
  return `${date.toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })}, ${date.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' }).toLowerCase()}`;
}

/**
 * The translation key for a derived event state.
 *
 * Returns a KEY rather than translated text so the caller can render it with the
 * active language and have the label update when the language changes.
 *
 * @param eventState - The state the API derived from the event's dates, or null when the
 *   endpoint did not send one.
 * @returns The i18n key for that state, and 'state.event' for a missing or unrecognised
 *   value so a label always renders.
 */
export function stateKey(eventState: string | null | undefined): string {
  switch (eventState) {
    case 'upcoming':
      return 'state.upcoming';
    case 'ongoing':
      return 'state.ongoing';
    case 'past':
      return 'state.past';
    default:
      return 'state.event';
  }
}

/**
 * The image URL for an event.
 *
 * A bare filename ("gala-dinner.svg") is resolved against the shared assets
 * folder; an absolute URL (an administrator pasted a real photo URL) is used
 * unchanged. An event with no image gets the same fallback artwork as before.
 *
 * @param event - The event whose artwork is wanted. May be null or undefined, in which
 *   case the fallback artwork is returned.
 * @returns A URL a template can bind to directly: the stored filename made absolute, an
 *   external or data URL left as it is, or the project's fallback image.
 */
export function imageUrl(event: Event | null | undefined): string {
  const raw = event?.imageUrl?.trim();
  const file = raw && raw !== '' ? raw : APP_CONFIG.fallbackImage;
  if (/^https?:\/\//i.test(file) || file.startsWith('/') || file.startsWith('data:')) return file;
  return `${APP_CONFIG.imageBaseUrl}${file}`;
}

/**
 * How full an event is, as one short label.
 *
 * @param event - The event whose capacity is wanted.
 * @returns A label such as "12 / 200", or an empty string when the event records no
 *   capacity, because "12 / null" would be worse than showing nothing.
 */
export function capacityLabel(event: Event): string {
  if (event.capacity === null || event.capacity === undefined) return '';
  return `${event.ticketsSold} / ${event.capacity}`;
}
