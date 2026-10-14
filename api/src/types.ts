/**
 * src/types.ts
 * ---------------------------------------------------------------------------
 * The TypeScript contracts that the JavaScript version used to describe only in
 * comments and JSDoc.
 *
 * Why one shared file?
 *   The whole point of src/repositories/index.ts is that the MySQL repository
 *   and the offline (DATA_SOURCE=local) repository are interchangeable: the
 *   same route, the same controller and the same service run against either
 *   one, and the automated test suite proves it by running the identical 116
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
 * One row / assembled document travelling between the repository and the
 * service layer. See the note above: the tests, not this alias, define the
 * fields.
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
  field: string;
  message: string;
  [key: string]: any;
}

/** The validated filter object built by services/eventService.buildQuery(). */
export interface EventFilters {
  categoryIds: number[];
  locationIds: number[];
  city?: string;
  from?: string;
  to?: string;
  /** upcoming | ongoing | past | all */
  state: string;
  sort: string;
  direction: string;
  isFree?: boolean;
  includePast: boolean;
  keyword?: string;
  organizationId?: number;
  /** public | admin - decides whether suspended events are visible. */
  audience: string;
  /** active | suspended | cancelled | all */
  publishStatus: string;
  excludePast: boolean;
}

/** The validated paging object built by services/eventService.buildQuery(). */
export interface Paging {
  limit: number;
  offset: number;
  page: number;
  sort: string;
  direction: string;
}

/** `{ status: 'all' }` lets the admin website open a suspended event. */
export interface FindEventOptions {
  status?: 'active' | 'all';
}

/** One page of events plus the unpaged total. */
export interface EventListResult {
  total: number;
  events: DataRecord[];
}

/** Filters accepted by the optional admin registrations list. */
export interface RegistrationFilters {
  eventId?: number;
  email?: string;
  keyword?: string;
}

/** One page of registrations plus the unpaged total. */
export interface RegistrationListResult {
  total: number;
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
  findByEventId(eventId: number): DataRecord[] | Promise<DataRecord[]>;
  findById(
    registrationId: number
  ): DataRecord | null | Promise<DataRecord | null>;
  findAll(
    filters: RegistrationFilters,
    paging: { limit: number; offset: number }
  ): RegistrationListResult | Promise<RegistrationListResult>;
  countByEventId(eventId: number): number | Promise<number>;
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

  findEvents(filters: EventFilters, paging: Paging): Promise<EventListResult>;
  findEventById(
    eventId: number,
    options?: FindEventOptions
  ): Promise<DataRecord | null>;
  findCategories(): Promise<DataRecord[]>;
  findLocations(): Promise<DataRecord[]>;
  findReferenceData(): Promise<DataRecord>;
  findFeaturedOrganization(): Promise<DataRecord | null>;
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
   * A create either stores the event and returns it, or throws (400/409), so
   * the result is never null - which is what lets the controller address the
   * new resource without an impossible "not found" branch.
   */
  insertEvent(values: DataRecord): Promise<DataRecord>;
  updateEvent(
    eventId: number,
    values: DataRecord
  ): Promise<DataRecord | null>;
  /**
   * Enforces the data-integrity rule and reports the outcome; the service turns
   * `reason` into the right HTTP status. `Promise<DataRecord>` rather than a
   * narrow union so the two implementations can carry their own extra fields
   * without the other one having to declare them.
   */
  deleteEvent(eventId: number): Promise<DataRecord>;
  replaceTicketTypes(
    eventId: number,
    ticketTypes: DataRecord[]
  ): Promise<DataRecord | void>;
}

/** Registration writes. Sync in the offline mirror, async against MySQL. */
export interface RegistrationWriteRepository {
  insertRegistration(
    eventId: number,
    values: DataRecord
  ): DataRecord | null | Promise<DataRecord | null>;
  updateRegistration(
    registrationId: number,
    values: DataRecord
  ): DataRecord | null | Promise<DataRecord | null>;
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

  /** The write half, also exported on its own for the unit tests. */
  writes: EventWriteRepository;

  /**
   * Restores the seeded offline data. Only meaningful with DATA_SOURCE=local;
   * the implementation throws for MySQL, where it would drop real rows.
   */
  resetLocalData(): boolean;
}
