/**
 * @file A charity event, exactly as the REST API returns it.
 *
 * Why one interface with optional fields rather than several? The API enriches
 * the same `events` row differently per endpoint:
 *
 *   GET /api/events        adds the joined category/venue/organisation names,
 *                          the derived state and the ticket tiers
 *   GET /api/events/:id    adds `registrations` and `daysUntil`
 *   GET /api/admin/events  the same row whatever its publishing status
 *
 * A single interface with optional extras keeps one type for one resource, which
 * is what the RESTful design is aiming at.
 */
import type { Registration } from './registration.model';

/** One purchasable ticket tier for an event. */
export interface TicketType {
  ticketTypeId: number;
  ticketName: string;
  price: number;
  /** null means "no limit recorded". */
  quantityAvailable: number | null;
  description?: string | null;
}

/**
 * The state of an event relative to today, derived rather than stored.
 *
 * The API derives it from date_start/date_end, and it is what the cards and the
 * "Upcoming / Past" filters use. The union ends in `string` so a state the API
 * adds later cannot become a compile error in the front end.
 */
export type EventState = 'upcoming' | 'ongoing' | 'past' | string;

/** The publishing status an administrator controls. */
export type PublishStatus = 'active' | 'suspended' | 'cancelled' | string;

/**
 * One charity event, as the API returns it from the event endpoints.
 *
 * The API enriches the same database row differently per endpoint, which is why
 * the joined reference data, the weather coordinates and the computed figures
 * below are all optional.
 */
export interface Event {
  eventId: number;
  eventName: string;
  shortDescription?: string | null;
  description?: string | null;
  /** What the money is for, shown on the detail page. */
  purpose?: string | null;

  /** The day the event happens (or starts). */
  eventDate?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  /** The full run of a multi-day event; equal to eventDate for a single day. */
  dateStart?: string | null;
  dateEnd?: string | null;

  goalAmount?: number | null;
  isFree: boolean;
  /** null means "no capacity limit". */
  capacity?: number | null;
  status?: PublishStatus | null;
  imageUrl?: string | null;

  /* ---- joined reference data ---- */
  organizationId?: number | null;
  organizationName?: string | null;
  categoryId?: number | null;
  categoryName?: string | null;
  categorySlug?: string | null;
  locationId?: number | null;
  venueName?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  postcode?: string | null;

  /* ---- where the event is, for the weather API ---- */
  latitude?: number | null;
  longitude?: number | null;

  /* ---- figures computed by the API ---- */
  raisedAmount: number;
  progressPercent: number;
  donationCount: number;

  /* ---- Assessment 3 additions ---- */
  eventState?: EventState | null;
  registrationCount: number;
  ticketsSold: number;
  /** The cheapest tier, used for the "from $x" label on a card. */
  primaryPrice?: number | null;
  ticketTypes: TicketType[];
}

/**
 * GET /api/events/:id - the detail response.
 *
 * Assessment 3 requirement: this endpoint now returns the COMPLETE list of
 * registrations for the event, newest purchase first, so the detail page can
 * display them without a second request.
 */
export interface EventDetail extends Event {
  /** Whole days from today; negative for a past event. */
  daysUntil?: number | null;
  registrations: Registration[];
  totalTicketsSold?: number;
}

/** The body of POST /api/events (and PUT /api/events/:id, partially). */
export interface EventInput {
  organizationId: number;
  categoryId: number;
  locationId: number;
  eventName: string;
  shortDescription: string;
  description: string;
  purpose: string;
  eventDate: string;
  startTime: string;
  endTime: string;
  dateStart?: string;
  dateEnd?: string;
  goalAmount?: number;
  isFree?: boolean;
  capacity?: number | null;
  status?: string;
  imageUrl?: string | null;
  ticketTypes?: TicketTypeInput[];
}

/** One ticket tier inside an EventInput. */
export interface TicketTypeInput {
  ticketName: string;
  price: number;
  quantityAvailable?: number | null;
  description?: string | null;
}

/**
 * The query parameters GET /api/events and GET /api/admin/events accept.
 * Every field is optional; ApiService drops the empty ones, so the request only
 * carries the filters the user actually chose.
 */
export interface EventQuery {
  /** Repeatable, as in ?category=1&category=2. */
  category?: Array<number | string>;
  /** Repeatable, as in ?location=3&location=5. */
  location?: Array<number | string>;
  city?: string;
  /** A single day, YYYY-MM-DD. */
  date?: string;
  /** A range, YYYY-MM-DD. */
  from?: string;
  to?: string;
  /** One of 'upcoming', 'past' or 'all'. */
  state?: string;
  keyword?: string;
  isFree?: boolean;
  organizationId?: number | string;
  /** Admin only: one of 'active', 'past', 'suspended', 'cancelled' or 'all'. */
  publishStatus?: string;
  /** For example 'date' | 'name' | 'raised'. */
  sort?: string;
  direction?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
  page?: number;
}
