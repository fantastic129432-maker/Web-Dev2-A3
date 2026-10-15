/**
 * @file An event registration (Assessment 3, Part 1).
 *
 * Database shape: the `registrations` table created by database/01_schema.sql.
 * One row records who registered for which event, when, how many tickets, and
 * the contact details. The brief allows one registration per person per event,
 * which the table's UNIQUE (event_id, attendee_email) constraint enforces; a
 * second attempt is answered with HTTP 409.
 */

/** A registration as the API returns it. */
export interface Registration {
  registrationId: number;
  eventId: number;
  /** Present on the admin list, which joins the event name in. */
  eventName?: string | null;
  /** The ticket tier bought, when one was chosen. */
  ticketTypeId?: number | null;
  ticketName?: string | null;
  ticketPrice?: number | null;
  attendeeName: string;
  attendeeEmail: string;
  attendeePhone?: string | null;
  ticketsPurchased: number;
  /** ticketsPurchased x ticketPrice, computed by the API. */
  totalAmount?: number | null;
  /** "YYYY-MM-DD HH:MM:SS", the moment the tickets were bought. */
  registeredAt: string;
  notes?: string | null;
}

/** The body of POST /api/events/:id/registrations. */
export interface RegistrationInput {
  attendeeName: string;
  attendeeEmail: string;
  attendeePhone?: string | null;
  ticketsPurchased: number;
  ticketTypeId?: number | null;
  /** Optional ISO date; the API defaults to the moment of the request. */
  registeredAt?: string;
  notes?: string | null;
}

