/**
 * shared/src/util/format.ts
 * ---------------------------------------------------------------------------
 * Presentation helpers used by both Angular applications.
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

/** 25000 -> "$25,000" */
export function formatCurrency(amount: number | string | null | undefined): string {
  return CURRENCY.format(Number(amount ?? 0) || 0);
}

/** 45 -> "$45.00" */
export function formatPrice(amount: number | string | null | undefined): string {
  return CURRENCY_WITH_CENTS.format(Number(amount ?? 0) || 0);
}

/** '2026-10-11' -> 'Sunday 11 October 2026' */
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

/** '2026-10-11' -> '11 Oct 2026' */
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

/** '07:30:00' -> '7:30 am' */
export function formatTime(time: string | null | undefined): string {
  if (!time) return '';
  const [hours, minutes] = time.split(':');
  const date = new Date();
  date.setHours(Number(hours), Number(minutes), 0, 0);
  return date.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' }).toLowerCase();
}

/**
 * The stored dates as something a human can read, including multi-day events
 * such as the three-week art exhibition.
 */
export function formatDateRange(event: Event): string {
  const start = event.dateStart ?? event.eventDate ?? '';
  const end = event.dateEnd ?? start;
  if (!end || end === start) return formatShortDate(start);
  return `${formatShortDate(start)} - ${formatShortDate(end)}`;
}

/** '18:30:00' + '23:00:00' -> '6:30 pm - 11:00 pm' */
export function formatTimeRange(event: Event): string {
  const start = formatTime(event.startTime);
  const end = formatTime(event.endTime);
  if (!start) return '';
  return end ? `${start} - ${end}` : start;
}

/** 'YYYY-MM-DD HH:MM:SS' -> '14 Sep 2026, 8:57 am' (registration timestamps) */
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
 */
export function imageUrl(event: Event | null | undefined): string {
  const raw = event?.imageUrl?.trim();
  const file = raw && raw !== '' ? raw : APP_CONFIG.fallbackImage;
  if (/^https?:\/\//i.test(file) || file.startsWith('/') || file.startsWith('data:')) return file;
  return `${APP_CONFIG.imageBaseUrl}${file}`;
}

/** A short "12 of 200 tickets" style label, or an empty string when unknown. */
export function capacityLabel(event: Event): string {
  if (event.capacity === null || event.capacity === undefined) return '';
  return `${event.ticketsSold} / ${event.capacity}`;
}
