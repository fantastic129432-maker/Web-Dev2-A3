/**
 * @file An event registration (Assessment 3, Part 1).
 *
 * Database shape: the `registrations` table created by database/01_schema.sql.
 * One row records who registered for which event, when, how many tickets, and
 * the contact details. The brief allows one registration per person per event,
 * which the table's UNIQUE (event_id, attendee_email) constraint enforces; a
 * second attempt is answered with HTTP 409.
 *
 * TWO SHAPES, ONE INTERFACE
 *   The same database row is served differently depending on who is asking, and
 *   the optional fields below are what records that:
 *
 *     admin endpoints (GET /api/admin/events/:id, GET /api/registrations)
 *        carry attendeeEmail and attendeePhone, because staff need them to run
 *        the event.
 *     the PUBLIC event detail endpoint (GET /api/events/:id)
 *        carries NEITHER. An anonymous visitor must not be shown a named
 *        person's email address or phone number - that is the Australian Privacy
 *        Principles' data-minimisation rule (APP 3/11) - so the API omits both
 *        keys and sends `attendeeDisplayName` ("Grace T.") instead. See
 *        REGISTRATION_COLUMNS_PUBLIC in api/src/repositories/repository.mysql.ts.
 *
 *   Both are the same interface rather than two, exactly as Event and EventDetail
 *   are: it is one resource, and a caller that has narrowed its data legitimately
 *   cannot read the fields it did not ask for.
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
  /**
   * The attendee's email address, or absent on a public response.
   *
   * Optional because the public event detail endpoint does not send it at all:
   * the key is missing, not blank, so a template that tried to render it would
   * show nothing rather than a stale value. Read it only on an admin screen.
   */
  attendeeEmail?: string | null;
  /** The attendee's phone number, or absent on a public response, for the same reason as attendeeEmail. */
  attendeePhone?: string | null;
  /**
   * The masked attendee name the public page shows, for example "Grace T.".
   *
   * Sent by the public endpoint INSTEAD of the contact details, so the visitor
   * can still recognise their own booking without the page publishing who else
   * booked. Absent on the admin responses, which carry the full name and the
   * contact details instead.
   */
  attendeeDisplayName?: string | null;
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

