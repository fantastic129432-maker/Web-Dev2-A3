/**
 * @file The TypeScript contracts for the API.
 *
 * The JavaScript version described these shapes only in comments and JSDoc.
 *
 * Why one shared file?
 *   The whole point of src/repositories/index.ts is that the MySQL repository
 *   and the offline (DATA_SOURCE=local) repository are interchangeable: the
 *   same route, the same controller and the same service run against either
 *   one, and the automated test suite proves it by running the identical 131
 *   checks against both. `Repository` below is that promise written down, so the
 *   compiler now enforces the interface that used to be a convention between two
 *   hand-written JavaScript files.
 *
 * Where the line between strict and loose is drawn
 *   * Above the repository (services, controllers, middleware, config) the
 *     shapes are fully typed: `EventFilters`, `Paging`, `ValidationIssue` and
 *     friends are real contracts and are checked at every use.
 *   * Inside the data layer the opposite is true. A repository row is assembled
 *     from SQL column aliases or from the generated local-data snapshot, and its
 *     authority is the JSON the API returns - which the test suite asserts
 *     field by field. Pinning those fields to a hand-written interface here
 *     would duplicate the database schema, could drift away from it silently,
 *     and would say nothing the tests do not already prove. So a row travelling
 *     between the repository and the service is a `DataRecord`, and the one
 *     place that consumes it (the service/controller layer) treats it as such.
 *     This is the single concession the migration makes to `strict` mode, and it
 *     is deliberately kept to the data layer.
 */
'use strict';

/**
 * One row or assembled document travelling through the data layer.
 *
 * It is what a repository returns and what the service consumes. See the note
 * above: the tests, not this alias, define the fields.
 */
export type DataRecord = Record<string, any>;

/**
 * A raw request object (`req.query`, `req.body`).
 *
 * Everything here is untrusted text from the network in an unknown shape, so it
 * is intentionally untyped: src/utils/validators.ts parses it and the result of
 * that parsing (EventFilters, Paging, the camelCase value objects) is what the
 * rest of the application is typed against.
 */
export type UntrustedInput = Record<string, any>;

/** One `{ field, message }` entry in a 400 response, plus optional extras. */
export interface ValidationIssue {
  /** Name of the request field the message belongs to. */
  field: string;
  /** The explanation the client displays next to that field. */
  message: string;
  /** Any further machine readable detail a validator chose to attach. */
  [key: string]: any;
}

/** The validated filter object built by services/eventService.buildQuery(). */
export interface EventFilters {
  /** Category ids to match; empty means every category. */
  categoryIds: number[];
  /** Location ids to match; empty means every location. */
  locationIds: number[];
  /** Exact city name to match, when the client asked for one. */
  city?: string;
  /** Earliest event date to include, as a `YYYY-MM-DD` string. */
  from?: string;
  /** Latest event date to include, as a `YYYY-MM-DD` string. */
  to?: string;
  /** One of upcoming, ongoing, past or all. */
  state: string;
  /** The column to order by, already checked against the allowed list. */
  sort: string;
  /** Either `asc` or `desc`. */
  direction: string;
  /** Set when the client asked for free events only. */
  isFree?: boolean;
  /** True when the past state was requested explicitly rather than by default paging. */
  includePast: boolean;
  /** Free text searched in the event name and description. */
  keyword?: string;
  /** Restrict the result to one organisation's events. */
  organizationId?: number;
  /** public | admin - decides whether suspended events are visible. */
  audience: string;
  /** active | suspended | cancelled | all. */
  publishStatus: string;
  /** True when the query is a search, which hides past events unless asked for. */
  excludePast: boolean;
}

/** The validated paging object built by services/eventService.buildQuery(). */
export interface Paging {
  /** Maximum number of rows this page may return. */
  limit: number;
  /** Number of rows to skip before the page starts. */
  offset: number;
  /** The page number as the client asked for it, echoed back in the meta envelope. */
  page: number;
  /** The column being ordered by, repeated here for the response metadata. */
  sort: string;
  /** The direction being used, repeated here for the response metadata. */
  direction: string;
}

/** `{ status: 'all' }` lets the admin website open a suspended event. */
export interface FindEventOptions {
  /** Which publish states to accept; the default looks at active events only. */
  status?: 'active' | 'all';

  /**
   * Whether the registrations attached to the event may carry the attendee's
   * email address and phone number.
   *
   * The default is `false`, which is the privacy-safe answer: the PUBLIC event
   * detail endpoint serves an anonymous visitor, and publishing an attendee's
   * full contact details there breaches the Australian Privacy Principles'
   * data-minimisation principle. Only the admin endpoints (which staff are
   * authenticated to use - see the authentication note in adminController.ts)
   * ask for `true`.
   *
   * Opting IN rather than opting out is deliberate: a new caller that forgets to
   * think about this gets the narrowed projection rather than the breach.
   */
  includeContactDetails?: boolean;
}

/** One page of events plus the unpaged total. */
export interface EventListResult {
  /** How many events match the filters in total, ignoring paging. */
  total: number;
  /** The rows for this page only. */
  events: DataRecord[];
}

/** Filters accepted by the optional admin registrations list. */
export interface RegistrationFilters {
  /** Restrict the list to one event's registrations. */
  eventId?: number;
  /** Restrict the list to one registrant's address. */
  email?: string;
  /** Free text searched in the registrant's name and email. */
  keyword?: string;
}

/** One page of registrations plus the unpaged total. */
export interface RegistrationListResult {
  /** How many registrations match the filters in total, ignoring paging. */
  total: number;
  /** The rows for this page only. */
  registrations: DataRecord[];
}

/**
 * Registration reads.
 *
 * Some implementations answer with promises (MySQL) and some answer
 * immediately (the offline mirror reads an in-memory array), so the return
 * types allow both. Every caller awaits, and awaiting a plain value is a no-op,
 * which is what keeps the two data sources interchangeable.
 */
export interface RegistrationQueries {
  /**
   * Every registration belonging to one event, newest first.
   *
   * `includeContactDetails` decides whether each row carries the attendee's email
   * address and phone number, and it defaults to false so a caller that has not
   * thought about it gets the public, privacy-safe projection. Only a caller that
   * serves staff asks for true - see FindEventOptions.
   */
  findByEventId(
    eventId: number,
    includeContactDetails?: boolean
  ): DataRecord[] | Promise<DataRecord[]>;
  /**
   * Every registration belonging to one event, projected for a public caller.
   *
   * The privacy-safe counterpart of `findByEventId()`: the same rows in the same
   * order, but the attendee's email address and phone number are not selected (or
   * are dropped) whichever data source answers. The public sub-collection
   * (GET /api/events/:id/registrations) calls this rather than relying on
   * `findByEventId()`'s default, so the narrower shape is chosen by name at the
   * call site and the two data sources cannot disagree about it.
   */
  findPublicForEvent(eventId: number): DataRecord[] | Promise<DataRecord[]>;
  /** One registration by its primary key, or null when the id is unknown. */
  findById(
    registrationId: number
  ): DataRecord | null | Promise<DataRecord | null>;
  /** One page of registrations matching the filters, with the unpaged total. */
  findAll(
    filters: RegistrationFilters,
    paging: { limit: number; offset: number }
  ): RegistrationListResult | Promise<RegistrationListResult>;
  /** How many registrations an event already has, used by the delete rule. */
  countByEventId(eventId: number): number | Promise<number>;
  /** Whether this address is already registered for this event. */
  existsForEventAndEmail(
    eventId: number,
    email: string
  ): boolean | Promise<boolean>;
}

/** The read half: identical method names in both data sources. */
export interface EventReadRepository {
  /** 'mysql' | 'local' - reported by every meta envelope. */
  driver: string;

  /** Used by GET /api/health and by the start-up banner. */
  health(): Promise<DataRecord>;

  /** One page of events for the validated filters, with the unpaged total. */
  findEvents(filters: EventFilters, paging: Paging): Promise<EventListResult>;
  /** One event with its ticket types, or null when the id is unknown. */
  findEventById(
    eventId: number,
    options?: FindEventOptions
  ): Promise<DataRecord | null>;
  /** Every category, used by the filter lists and the admin form. */
  findCategories(): Promise<DataRecord[]>;
  /** Every location, used by the filter lists and the admin form. */
  findLocations(): Promise<DataRecord[]>;
  /** The lookup data the filter panels need, in one round trip. */
  findReferenceData(): Promise<DataRecord>;
  /** The organisation featured on the home page, or null when none is marked. */
  findFeaturedOrganization(): Promise<DataRecord | null>;
  /** The headline counts shown on the home page. */
  findStats(): Promise<DataRecord>;

  /**
   * Read access to the registrations.
   *
   * Optional here because a data source may publish it a moment after the read
   * half is built - repository.mysql.ts attaches it to the same object, exactly
   * as the JavaScript version did. `Repository` below narrows it back to
   * required, so every caller of the merged object can rely on it.
   */
  registrationQueries?: RegistrationQueries;
}

/** The write half of the events resource. */
export interface EventWriteRepository {
  /**
   * Create an event, or fail.
   *
   * A create either stores the event and returns it, or throws (400/409), so
   * the result is never null - which is what lets the controller address the
   * new resource without an impossible "not found" branch.
   */
  insertEvent(values: DataRecord): Promise<DataRecord>;
  /** Store the changed fields and return the event as it now stands, or null when the id is unknown. */
  updateEvent(
    eventId: number,
    values: DataRecord
  ): Promise<DataRecord | null>;
  /**
   * Enforce the data-integrity rule and report the outcome.
   *
   * The service turns `reason` into the right HTTP status. `Promise<DataRecord>`
   * rather than a narrow union so the two implementations can carry their own
   * extra fields without the other one having to declare them.
   */
  deleteEvent(eventId: number): Promise<DataRecord>;
  /** Replace an event's ticket types with the submitted set, inside one transaction. */
  replaceTicketTypes(
    eventId: number,
    ticketTypes: DataRecord[]
  ): Promise<DataRecord | void>;
}

/** Registration writes. Sync in the offline mirror, async against MySQL. */
export interface RegistrationWriteRepository {
  /** Create one registration and return the stored row, or null when the event does not exist. */
  insertRegistration(
    eventId: number,
    values: DataRecord
  ): DataRecord | null | Promise<DataRecord | null>;
  /** Update one registration and return the stored row, or null when the id is unknown. */
  updateRegistration(
    registrationId: number,
    values: DataRecord
  ): DataRecord | null | Promise<DataRecord | null>;
  /** Remove one registration, reporting whether a row was actually deleted. */
  deleteRegistration(
    registrationId: number
  ): boolean | Promise<boolean>;
}

/**
 * The merged object exported by src/repositories/index.ts.
 *
 * index.ts starts from whichever read half DATA_SOURCE selected and binds the
 * matching write half onto it, so at run time this is one object holding every
 * method. The two halves are merged by assignment rather than by inheritance,
 * which is what lets the identical service code call `repository.insertEvent()`
 * and `repository.findEvents()` without knowing that they live in different
 * modules.
 */
export interface Repository
  extends EventReadRepository,
    EventWriteRepository,
    RegistrationWriteRepository {
  /** The merged object always publishes the registration reads. */
  registrationQueries: RegistrationQueries;

  /**
   * Restore the seeded offline data.
   *
   * Only meaningful with DATA_SOURCE=local; the implementation throws for MySQL,
   * where it would drop real rows.
   */
  resetLocalData(): boolean;
}
