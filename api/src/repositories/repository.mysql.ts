/**
 * @file The submission read data source.
 *
 * Every question the API asks the database is written here as one parameterised
 * MySQL statement, built against the views created in database/01_schema.sql.
 *
 * Three rules are applied consistently:
 *   1. The public view decides public visibility. vw_public_events carries
 *      `status = 'active'`, so a suspended event cannot leak out through a
 *      public endpoint that is added later - the view, not the query, is the
 *      filter. A3 deliberately widens this for the admin website only: the
 *      documented `?audience=admin` parameter on GET /api/events, and the
 *      /api/admin/... endpoints, read vw_all_events instead. That is a feature,
 *      not an exception to the rule, and it is why every query below names the
 *      view it reads rather than assuming one.
 *   2. upcoming / ongoing / past are DERIVED from date_start and date_end
 *      compared with CURDATE(); they are never stored, so the website stays
 *      correct without a nightly job. Each of the three is asked for by its own
 *      name: 'upcoming' means "not finished yet" and so includes an event
 *      running today, while 'ongoing' means only the events happening right
 *      now.
 *   3. Every user-supplied value reaches the statement as a bound parameter,
 *      and the one construct that is not a plain comparison - a LIKE pattern -
 *      is built by escapeLike() with an explicit ESCAPE clause, so a `%` or a
 *      `_` typed into the search box matches itself instead of acting as a
 *      wildcard.
 *
 * `q` is a short alias for event_db.query().
 */
'use strict';

import env = require('../config/env');
import db = require('../db/event_db');
import type {
  DataRecord,
  EventFilters,
  EventReadRepository,
  RegistrationQueries,
} from '../types';
const q = db;

/** Column list shared by the list and detail queries. */
const EVENT_COLUMNS = `
  e.event_id            AS eventId,
  e.event_name          AS eventName,
  e.short_description   AS shortDescription,
  e.description         AS description,
  e.purpose             AS purpose,
  e.event_date          AS eventDate,
  e.start_time          AS startTime,
  e.end_time            AS endTime,
  e.date_start          AS dateStart,
  e.date_end            AS dateEnd,
  e.goal_amount         AS goalAmount,
  e.is_free             AS isFree,
  e.capacity            AS capacity,
  e.status              AS status,
  e.image_url           AS imageUrl,
  e.organization_id     AS organizationId,
  e.organization_name   AS organizationName,
  e.category_id         AS categoryId,
  e.category_name       AS categoryName,
  e.category_slug       AS categorySlug,
  e.location_id         AS locationId,
  e.venue_name          AS venueName,
  e.address             AS address,
  e.city                AS city,
  e.state               AS state,
  e.postcode            AS postcode,
  e.latitude            AS latitude,
  e.longitude           AS longitude,
  e.raised_amount       AS raisedAmount,
  e.progress_percent    AS progressPercent,
  e.donation_count      AS donationCount,
  e.event_state         AS eventState,
  e.registration_count  AS registrationCount,
  e.tickets_sold        AS ticketsSold`;

/** Cheapest ticket price, used on the home/search cards. */
const PRIMARY_PRICE = `
  (SELECT MIN(t.price)
     FROM ticket_types t
    WHERE t.event_id = e.event_id)                       AS primaryPrice`;

/**
 * The ESCAPE clause every LIKE in this file is written with.
 *
 * MySQL's default escape character for a LIKE pattern is the backslash, but the
 * default is session state (NO_BACKSLASH_ESCAPES changes it), and a statement
 * that relies on it while escapeLike() inserts backslashes would silently stop
 * escaping - which is exactly the bug being fixed here. Naming it makes the
 * pattern and the escaping agree whatever the session says.
 *
 * THE DOUBLE BACKSLASH IS CORRECT - DO NOT "TIDY" IT TO ONE.
 *   A LIKE ESCAPE clause names exactly ONE character (MySQL answers
 *   ER_WRONG_ARGUMENTS "Incorrect arguments to ESCAPE" otherwise), and that
 *   character has to be the backslash escapeLike() uses. Inside a MySQL string
 *   literal a backslash starts an escape sequence, so TWO backslashes in the
 *   statement are what MySQL's literal parser turns into the ONE character the
 *   clause requires. The four characters `\\\\` in this source string are the
 *   two characters `\\` in the generated SQL, which is what the server needs.
 *
 *   Writing the clause with two source characters instead - `ESCAPE '\'`, i.e.
 *   one backslash in the statement - is a syntax error, not a fix: MySQL parses
 *   the `\'` as an escaped quote and aborts the statement with ER_PARSE_ERROR.
 *   Verified against MySQL 8.4.11: the pair below returns the escaped-pattern
 *   match, the single one fails to parse.
 */
const LIKE_ESCAPE = "ESCAPE '\\\\'";

/**
 * Escape the LIKE metacharacters in a value that is bound to a LIKE pattern.
 *
 * A keyword or a city is user text, so a `%` or a `_` in it has to match itself
 * rather than act as a wildcard: `?keyword=%` would otherwise build `LIKE '%%%'`
 * and return every row, and `?keyword=_` every row with at least one character,
 * while the offline mirror - whose `includes()` is literal - returns nothing for
 * the same request. Escaping in one place, used by every LIKE in this file, is
 * what keeps the two data sources answering the same question.
 *
 * @param value - The raw search text, exactly as the client sent it.
 * @returns The text with `\`, `%` and `_` backslash-escaped, ready to be wrapped in `%` signs.
 */
function escapeLike(value: string): string {
  return String(value).replace(/[\\%_]/g, (character) => `\\${character}`);
}

/**
 * Build the bound value for a contains-search on one column.
 *
 * The single place a LIKE pattern is assembled, so no call site can forget
 * either the escaping or the surrounding wildcards.
 *
 * @param value - The raw search text, exactly as the client sent it.
 * @returns The `%escaped%` pattern to bind to a `LIKE ? ESCAPE '\\'` condition.
 */
function containsPattern(value: string): string {
  return `%${escapeLike(value)}%`;
}

/**
 * Build the WHERE / HAVING fragment used by every event listing.
 *
 * All user input is bound through `params`; even the sort column is whitelisted
 * rather than interpolated into the SQL text, which is what keeps a filter value
 * like `%' OR 1=1 --` inert. The state filter goes into HAVING rather than WHERE
 * because `eventState` is derived by the view and cannot be tested before the row
 * is assembled.
 *
 * @param filters - The validated filters from the service layer. May be omitted, in which case no condition is added.
 * @returns The WHERE and HAVING fragments, empty when nothing was filtered, plus the values to bind to them.
 */
function buildEventFilter(filters: Partial<EventFilters> = {}) {
  const params: any[] = [];
  const conditions: string[] = [];

  if (filters.categoryIds && filters.categoryIds.length > 0) {
    const placeholders = filters.categoryIds.map(() => '?').join(', ');
    conditions.push(`e.category_id IN (${placeholders})`);
    params.push(...filters.categoryIds);
  }

  if (filters.locationIds && filters.locationIds.length > 0) {
    const placeholders = filters.locationIds.map(() => '?').join(', ');
    conditions.push(`e.location_id IN (${placeholders})`);
    params.push(...filters.locationIds);
  }

  if (filters.city) {
    conditions.push(`e.city LIKE ? ${LIKE_ESCAPE}`);
    params.push(containsPattern(filters.city));
  }

  if (filters.from) {
    conditions.push('e.date_end >= ?');
    params.push(filters.from);
  }

  if (filters.to) {
    conditions.push('e.date_start <= ?');
    params.push(filters.to);
  }

  if (filters.isFree === true) {
    conditions.push('e.is_free = 1');
  } else if (filters.isFree === false) {
    conditions.push('e.is_free = 0');
  }

  if (filters.keyword) {
    // The same five columns, in the same order, as the offline matches() tests
    // one by one; each is a separate LIKE so a keyword cannot match across the
    // boundary between two fields by accident.
    conditions.push(
      `(e.event_name LIKE ? ${LIKE_ESCAPE} OR e.short_description LIKE ? ${LIKE_ESCAPE} OR
        e.city LIKE ? ${LIKE_ESCAPE} OR e.venue_name LIKE ? ${LIKE_ESCAPE} OR e.organization_name LIKE ? ${LIKE_ESCAPE})`
    );
    const like = containsPattern(filters.keyword);
    params.push(like, like, like, like, like);
  }

  // organizationId is only reached with a positive whole number: the service
  // validates it like every other id, so a 0 or a non-numeric value is a 400
  // there rather than a filter that quietly disappears.
  if (filters.organizationId) {
    conditions.push('e.organization_id = ?');
    params.push(filters.organizationId);
  }

  // A3: the admin website can narrow the list to one publishing status. The
  // public endpoints never set this, so nothing changes for them.
  if (filters.publishStatus && filters.publishStatus !== 'all') {
    conditions.push('e.status = ?');
    params.push(filters.publishStatus);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // The three public states. 'upcoming' means "not finished yet", which also
  // covers an event running today, so ongoing is included in it. 'ongoing' is
  // the narrower question and asks for the events happening right now only; it
  // used to be folded into the 'upcoming' branch, which made ?state=ongoing
  // return events that had not even started.
  let having = '';
  if (filters.state === 'past') {
    having = 'HAVING eventState = ?';
    params.push('past');
  } else if (filters.state === 'ongoing') {
    having = 'HAVING eventState = ?';
    params.push('ongoing');
  } else if (filters.state === 'upcoming' || filters.excludePast) {
    having = 'HAVING eventState <> ?';
    params.push('past');
  }

  return { where, having, params };
}

/** Whitelist of sortable columns - prevents SQL injection through ?sort=. */
const SORT_COLUMNS: Record<string, string> = {
  date: 'dateStart',
  name: 'eventName',
  goal: 'goalAmount',
  progress: 'progressPercent',
  category: 'categoryName',
  city: 'city',
  registrations: 'registrationCount',
  updated: 'eventId',
};

/**
 * Turn a requested sort key and direction into safe SQL.
 *
 * An unknown key falls back to the default instead of reaching the statement, and
 * `eventId ASC` is always appended as a tie-breaker so two events sharing a date
 * cannot swap places between requests and make a page repeat or skip a row.
 *
 * @param sort - The requested sort key; an unknown key falls back to `defaultSort`.
 * @param direction - `desc` reverses the order; anything else is ascending.
 * @param defaultSort - The key to use when `sort` is not in the whitelist. May be omitted, in which case `date` is used.
 * @returns The ORDER BY fragment, ready to interpolate into a statement.
 */
function buildOrderBy(sort: string, direction: string, defaultSort = 'date'): string {
  const column = SORT_COLUMNS[sort] || SORT_COLUMNS[defaultSort];
  const dir = String(direction).toLowerCase() === 'desc' ? 'DESC' : 'ASC';
  return `ORDER BY ${column} ${dir}, eventId ASC`;
}

/**
 * Shared normalisation so both repositories return identical field types.
 *
 * The driver hands back DECIMAL and COUNT values in whichever type it chose, so
 * every numeric field is converted here; without this the two data sources would
 * emit `"1200.00"` and `1200` for the same field and the Angular pages would have
 * to defend against both.
 *
 * @param row - The row as the driver returned it, or null when the query matched nothing.
 * @returns The row with numeric fields converted, or `null` unchanged.
 */
function normaliseEvent(row: DataRecord | null): DataRecord | null {
  if (!row) return null;
  return {
    ...row,
    isFree: Boolean(row.isFree),
    goalAmount: Number(row.goalAmount || 0),
    raisedAmount: Number(row.raisedAmount || 0),
    progressPercent: Number(row.progressPercent || 0),
    donationCount: Number(row.donationCount || 0),
    registrationCount: Number(row.registrationCount || 0),
    ticketsSold: Number(row.ticketsSold || 0),
    latitude: row.latitude === null || row.latitude === undefined ? null : Number(row.latitude),
    longitude:
      row.longitude === null || row.longitude === undefined ? null : Number(row.longitude),
    primaryPrice:
      row.primaryPrice === null || row.primaryPrice === undefined
        ? null
        : Number(row.primaryPrice),
  };
}

/**
 * Attach each event's ticket tiers to a page of list rows.
 *
 * The list and the detail endpoints have to answer the same shape, because the
 * shared Event model declares `ticketTypes` as a member of both and because
 * repository.local.ts attaches them in decorate() for every row it returns. One
 * extra statement for the whole page (not one per event) keeps that true without
 * turning a listing into N+1 round trips; the tiers are grouped in memory by
 * event id, and the same projection, numeric conversion and price ordering as
 * decorateEventDetail() are used, so a tier looks identical whichever endpoint
 * returned it.
 *
 * An event with no tiers gets `[]`, which is what the offline `prices.length > 0`
 * branch of its own decorate() effectively reports through primaryPrice being
 * null; the array itself is always present so a client can read it without a
 * guard.
 *
 * @param events - The page of already-normalised event rows, modified in place.
 * @returns Nothing; the rows are decorated in place, which is what keeps this off the caller's critical path.
 */
async function attachTicketTypes(events: DataRecord[]): Promise<void> {
  if (events.length === 0) return;

  const ids = events.map((event) => Number(event.eventId));
  const placeholders = ids.map(() => '?').join(', ');
  const tickets = await q.query(
    `SELECT ticket_type_id      AS ticketTypeId,
            event_id            AS eventId,
            ticket_name         AS ticketName,
            price               AS price,
            quantity_available  AS quantityAvailable,
            description         AS description
       FROM ticket_types
      WHERE event_id IN (${placeholders})
      ORDER BY price ASC, ticket_name ASC`,
    ids
  );

  const byEvent = new Map<number, DataRecord[]>();
  for (const ticket of tickets) {
    const key = Number(ticket.eventId);
    if (!byEvent.has(key)) byEvent.set(key, []);
    byEvent.get(key)!.push({
      ticketTypeId: Number(ticket.ticketTypeId),
      ticketName: ticket.ticketName,
      price: Number(ticket.price),
      quantityAvailable:
        ticket.quantityAvailable === null ? null : Number(ticket.quantityAvailable),
      description: ticket.description,
    });
  }

  for (const event of events) {
    event.ticketTypes = byEvent.get(Number(event.eventId)) || [];
  }
}

/**
 * Wrap the filtered event query in a derived table.
 *
 * That is what lets the API page the result and count the total using exactly
 * the same filters. A derived table (rather than a CTE) is used so the statement
 * also runs on MySQL 5.7 and on MariaDB.
 *
 * @param filters - The validated filters to apply.
 * @param orderBy - The ORDER BY fragment built by `buildOrderBy`.
 * @param view - The view to read: the public one by default, or the admin one for the admin list.
 * @returns The SQL text of the derived table plus the values to bind to it.
 */
function buildFilteredSubquery(filters: EventFilters, orderBy: string, view = 'vw_public_events') {
  const { where, having, params } = buildEventFilter(filters);
  const sql = `
    SELECT ${EVENT_COLUMNS}, ${PRIMARY_PRICE}
      FROM ${view} e
      ${where}
      ${having}
      ${orderBy}`;
  return { sql, params };
}

/**
 * The MySQL read half of the repository contract.
 *
 * It is one object literal so the shape is checked against
 * `EventReadRepository` at compile time; src/repositories/index.ts swaps it for
 * the offline twin based on DATA_SOURCE, and the registration reads ride along on
 * `registrationQueries` so the merged object publishes them in both modes.
 */
const repository: EventReadRepository = {
  driver: 'mysql',

  /** Report whether the database answers and the expected tables exist. */
  async health() {
    return db.ping();
  },

  /**
   * Return one page of events for the validated filters, with the unpaged total.
   *
   * The admin list must include suspended and cancelled events, so it reads
   * vw_all_events; everything else keeps the safe public view. Paging is applied
   * to the derived table rather than to the view, so LIMIT and OFFSET cannot
   * change which rows the total counted - the two statements share one filter
   * fragment (and therefore the same bound values) precisely so they cannot
   * disagree.
   *
   * A3: every row carries its own `ticketTypes`, exactly as the offline
   * decorate() does and as the shared Event model declares (`ticketTypes` is not
   * optional there). This used to be missing: the offline mirror attached the
   * tiers to list rows and this half did not, so GET /api/events,
   * /api/events/upcoming and the admin list answered two different shapes
   * depending on DATA_SOURCE. Nothing failed visibly because `primaryPrice` is
   * what the cards render and because the automated suite runs the offline
   * source, where the field is present - see attachTicketTypes below.
   *
   * @param filters - The validated filters from the service layer.
   * @param paging - The limit, offset and ordering to apply.
   * @returns The rows for this page, normalised and carrying their ticket tiers, plus the total number of matches.
   */
  async findEvents(filters, paging) {
    const orderBy = buildOrderBy(
      paging.sort,
      paging.direction,
        'date'
    );
    // A3: the admin list must include suspended and cancelled events, so it
    // reads vw_all_events. Everything else keeps the safe public view.
    const view = filters.audience === 'admin' ? 'vw_all_events' : 'vw_public_events';
    const { sql: filteredSql, params } = buildFilteredSubquery(filters, orderBy, view);

    const rows = await q.query(
      `SELECT *
         FROM (${filteredSql}) AS ordered
        LIMIT ? OFFSET ?`,
      [...params, paging.limit, paging.offset]
    );

    const countRows = await q.query(
      `SELECT COUNT(*) AS total
         FROM (${filteredSql}) AS matched`,
      params
    );

    const events = rows.map(normaliseEvent) as DataRecord[];
    await attachTicketTypes(events);

    return {
      total: countRows[0] ? Number(countRows[0].total) : 0,
      events,
    };
  },

  /**
   * Return full details for one event, including its ticket tiers.
   *
   * The view decides visibility, exactly as it does for the list: a public caller
   * reads vw_public_events and therefore cannot see a suspended event, while
   * `status: 'all'` lets the admin website open one for editing.
   *
   * The second decision this method makes is what the attached registrations are
   * allowed to contain. `includeContactDetails` defaults to false, so the public
   * route (which passes only `status`) gets the narrowed projection with no
   * attendee email or phone; the admin route, which passes `true` explicitly,
   * still gets them for staff.
   *
   * @param eventId - The id of the event to read.
   * @param options - Which publish states to accept, and whether the registrations may carry attendee contact details. May be omitted, in which case only an active event is returned and the registrations are narrowed to the public fields.
   * @returns The event with its ticket tiers, days remaining and registrations, or `null` when the view has no such row.
   */
  async findEventById(eventId, options = {}) {
    const allowAnyStatus = options.status === 'all';
    const view = allowAnyStatus ? 'vw_all_events' : 'vw_public_events';

    const rows = await q.query(
      `SELECT ${EVENT_COLUMNS}, ${PRIMARY_PRICE}
         FROM ${view} e
        WHERE e.event_id = ?`,
      [eventId]
    );
    if (rows.length === 0) return null;

    // rows.length was checked above, so there is always a row to normalise.
    const event = normaliseEvent(rows[0]) as DataRecord;
    return decorateEventDetail(event, eventId, options.includeContactDetails === true);
  },

  /**
   * List every category with a count of how many active events use each one.
   *
   * A LEFT JOIN against the public view is what makes a category with no events
   * come back with a count of zero rather than disappearing, so the search form
   * can still show it and say so.
   *
   * @returns Every category, ordered by name, with its active event count as a number.
   */
  async findCategories() {
    const rows = await q.query(
      `SELECT c.category_id      AS categoryId,
              c.category_name    AS categoryName,
              c.slug             AS slug,
              c.description      AS description,
              c.icon             AS icon,
              COUNT(e.event_id)  AS eventCount
         FROM categories c
         LEFT JOIN vw_public_events e ON e.category_id = c.category_id
        GROUP BY c.category_id, c.category_name, c.slug, c.description, c.icon
        ORDER BY c.category_name ASC`
    );
    return rows.map((row: DataRecord) => ({
      ...row,
      eventCount: Number(row.eventCount),
      categoryId: Number(row.categoryId),
    }));
  },

  /**
   * List the distinct venues that currently host at least one public event.
   *
   * A plain JOIN rather than a LEFT JOIN, because a venue with no active event
   * would only ever produce an empty page; omitting it is the point.
   *
   * @returns Every such venue with its active event count, ordered by city then venue.
   */
  async findLocations() {
    const rows = await q.query(
      `SELECT l.location_id     AS locationId,
              l.venue_name      AS venueName,
              l.city            AS city,
              l.state           AS state,
              l.latitude        AS latitude,
              l.longitude       AS longitude,
              COUNT(e.event_id) AS eventCount
         FROM locations l
         JOIN vw_public_events e ON e.location_id = l.location_id
        GROUP BY l.location_id, l.venue_name, l.city, l.state, l.latitude, l.longitude
        ORDER BY l.city ASC, l.venue_name ASC`
    );
    return rows.map((row: DataRecord) => ({
      ...row,
      locationId: Number(row.locationId),
      latitude: row.latitude === null ? null : Number(row.latitude),
      longitude: row.longitude === null ? null : Number(row.longitude),
      eventCount: Number(row.eventCount),
    }));
  },

  /**
   * Return the reference data the admin forms need in their dropdowns.
   *
   * Every organisation, category and venue is included whether or not it
   * currently has a public event, because staff may be about to create the first
   * one. The three statements are independent, so they are issued together with
   * Promise.all rather than in sequence.
   *
   * @returns The three lookup lists, ready for the form controls.
   */
  async findReferenceData() {
    const [organizations, categories, locations] = await Promise.all([
      q.query(
        `SELECT organization_id AS organizationId, name, city
           FROM organizations ORDER BY name ASC`
      ),
      q.query(
        `SELECT category_id AS categoryId, category_name AS categoryName,
                slug, icon
           FROM categories ORDER BY category_name ASC`
      ),
      q.query(
        `SELECT location_id AS locationId, venue_name AS venueName,
                city, state, latitude, longitude
           FROM locations ORDER BY city ASC, venue_name ASC`
      ),
    ]);

    return { organizations, categories, locations };
  },

  /**
   * Return the organisation featured on the home page.
   *
   * The seed marks no organisation as featured, so the first row by id is the
   * documented stand-in; `LIMIT 1` keeps the query honest about returning one row
   * rather than relying on the caller to take the first.
   *
   * @returns The featured organisation, or `null` when the table is empty.
   */
  async findFeaturedOrganization() {
    const rows = await q.query(
      `SELECT organization_id  AS organizationId,
              name             AS name,
              mission          AS mission,
              email            AS email,
              phone            AS phone,
              website          AS website,
              city             AS city,
              country          AS country
         FROM organizations
        ORDER BY organization_id ASC
        LIMIT 1`
    );
    return rows[0] || null;
  },

  /**
   * Return the headline numbers for the home page statistics strip.
   *
   * All eight figures come from one statement of scalar subqueries, so they are
   * read at a single point in time and cannot contradict each other, and the
   * round trips do not multiply as figures are added. The public view is what
   * decides which events are counted, so a suspended event is excluded here as
   * everywhere else.
   *
   * @returns The counts and totals as numbers, with zero standing in for an empty database.
   */
  async findStats() {
    const rows = await q.query(
      `SELECT
          (SELECT COUNT(*) FROM vw_public_events WHERE event_state <> 'past') AS upcomingEvents,
          (SELECT COUNT(*) FROM categories)                                   AS categories,
          (SELECT COUNT(*) FROM organizations)                                AS organizations,
          (SELECT COALESCE(SUM(raised_amount), 0) FROM vw_public_events)      AS totalRaised,
          (SELECT COALESCE(SUM(goal_amount), 0)
             FROM vw_public_events WHERE event_state <> 'past')               AS activeGoal,
          (SELECT COUNT(*) FROM event_registrations)                          AS registrations,
          (SELECT COALESCE(SUM(tickets_purchased), 0)
             FROM event_registrations)                                        AS ticketsSold`
    );
    const stats = rows[0] || {};
    return {
      upcomingEvents: Number(stats.upcomingEvents || 0),
      categories: Number(stats.categories || 0),
      organizations: Number(stats.organizations || 0),
      totalRaised: Number(stats.totalRaised || 0),
      activeGoal: Number(stats.activeGoal || 0),
      registrations: Number(stats.registrations || 0),
      ticketsSold: Number(stats.ticketsSold || 0),
      defaultPageSize: env.DEFAULT_PAGE_SIZE,
    };
  },
};

/**
 * Attach the ticket tiers, the days remaining and the registrations to an event.
 *
 * The event has already been read from a view. Three small queries rather than
 * one wide join: the tiers, the days-remaining computation and the registrations
 * have different cardinalities, and joining them would multiply the event row and
 * force the caller to de-duplicate it. Kept as a plain function so
 * repository.local.ts can reuse the identical field names and ordering rules.
 *
 * The registration query is the one place a public response could leak an
 * attendee's personal information, so it is also where that is decided:
 * `includeContactDetails` is threaded through from the route rather than assumed,
 * and it defaults to false - see the privacy note on REGISTRATION_COLUMNS_PUBLIC.
 *
 * @param event - The event row that has already been normalised.
 * @param eventId - The event's id, used by the follow-up queries.
 * @param includeContactDetails - True only for the admin path, which keeps the attendee's email and phone on each registration row. May be omitted, in which case the public projection is used.
 * @returns The same event object, with `ticketTypes`, `daysUntil`, `registrations` and `totalTicketsSold` added.
 */
async function decorateEventDetail(
  event: DataRecord,
  eventId: number,
  includeContactDetails = false
): Promise<DataRecord> {
  const tickets = await q.query(
    `SELECT ticket_type_id      AS ticketTypeId,
            ticket_name         AS ticketName,
            price               AS price,
            quantity_available  AS quantityAvailable,
            description         AS description
       FROM ticket_types
      WHERE event_id = ?
      ORDER BY price ASC, ticket_name ASC`,
    [eventId]
  );

  event.ticketTypes = tickets.map((ticket: DataRecord) => ({
    ...ticket,
    ticketTypeId: Number(ticket.ticketTypeId),
    price: Number(ticket.price),
    quantityAvailable:
      ticket.quantityAvailable === null ? null : Number(ticket.quantityAvailable),
  }));

  // How many days remain until the event starts (negative once it is past).
  const days = await q.query(
    'SELECT DATEDIFF(date_start, CURDATE()) AS daysUntil FROM events WHERE event_id = ?',
    [eventId]
  );
  event.daysUntil = days[0] ? Number(days[0].daysUntil) : null;

  // A3: the event detail endpoint now also returns every registration for the
  // event, newest first, which is exactly the order the brief asks the page to
  // display ("sorted by the latest date when the tickets were purchased"). The
  // projection - and therefore whether an attendee's email and phone are in the
  // response at all - is decided by `includeContactDetails`, not here.
  event.registrations = await registrationQueries.findByEventId(eventId, includeContactDetails);
  event.totalTicketsSold = event.registrations.reduce(
    (sum: number, row: DataRecord) => sum + row.ticketsPurchased,
    0
  );

  return event;
}

/**
 * The registration columns shared by the read queries that serve STAFF.
 *
 * The joined form is used wherever the tier name, the price and the event name
 * are needed; the amounts are computed in SQL so both data sources report the
 * same total for a registration.
 *
 * This projection carries `attendee_email` and `attendee_phone`, so it must only
 * ever be selected for the admin routes. The public counterpart is
 * REGISTRATION_COLUMNS_PUBLIC below, and the two differ on purpose - see the
 * privacy note there before adding a caller.
 */
const REGISTRATION_COLUMNS = `
  r.registration_id      AS registrationId,
  r.event_id             AS eventId,
  r.ticket_type_id       AS ticketTypeId,
  r.attendee_name        AS attendeeName,
  r.attendee_email       AS attendeeEmail,
  r.attendee_phone       AS attendeePhone,
  r.tickets_purchased    AS ticketsPurchased,
  r.registered_at        AS registeredAt,
  r.notes                AS notes,
  t.ticket_name          AS ticketName,
  t.price                AS ticketPrice,
  (r.tickets_purchased * COALESCE(t.price, 0)) AS totalAmount,
  e.event_name           AS eventName`;

/**
 * The attendee's name as the SQL mask below reads it: every whitespace character
 * is folded to a space, and the ends are then trimmed.
 *
 * The offline mask trims the name and splits it on /\s+/, so a tab, a newline and
 * a run of spaces all separate two words equally. MySQL's TRIM() removes spaces
 * only, and SUBSTRING_INDEX() splits on the one delimiter it is given, so the
 * ASCII whitespace a stored name can carry is folded to a space first and the
 * TRIM() runs last: "Grace\tTurner" and "  Grace  Turner  " then reach the CASE
 * in REGISTRATION_COLUMNS_PUBLIC as "Grace Turner", instead of falling to its
 * single-word branch and being published in full.
 *
 * The five REPLACEs cover tab, line feed, vertical tab, form feed and carriage
 * return - the ASCII half of what Javascript's trim() and /\s+/ accept, and the
 * half that means the same thing under every connection charset (a CHAR(160) or
 * a CHAR(12288) means whatever the session's collation says it means). The
 * non-ASCII spaces that Javascript also splits on (a non-breaking space, U+2000
 * to U+200A, U+2028, U+2029, U+202F, U+205F, U+3000, U+FEFF) are deliberately
 * not folded: a name whose only word separator is one of those has no space left
 * after this expression, so it takes the single-word branch below and is
 * published unchanged. That residue is recorded rather than hidden - it is the
 * only place the two masks can still disagree - and it stays narrow because
 * spelling out nineteen more characters would multiply the projection by two
 * kilobytes and tie the mask to the connection charset.
 */
const ATTENDEE_NAME_FOR_MASK = [
  `TRIM(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(r.attendee_name,`,
  ` CHAR(9), ' '), CHAR(10), ' '), CHAR(11), ' '), CHAR(12), ' '), CHAR(13), ' '))`,
].join('');

/**
 * The registration columns for the PUBLIC endpoints: the same rows, MINUS the
 * attendee's email address and phone number, PLUS the masked backer name that
 * replaces the full one.
 *
 * WHY THIS PROJECTION EXISTS AND MUST NOT BE "COMPLETED"
 *   `attendee_email` and `attendee_phone` are personal information. The public
 *   event detail endpoint answers an anonymous visitor, and the page renders the
 *   rows it returns, so selecting those two columns published a named person's
 *   full email address and mobile number on a public web page - a breach of the
 *   Australian Privacy Principles (APP 3 and APP 11: collect and hold only what
 *   the purpose needs, and do not disclose it). They are therefore NOT selected
 *   here, so no later change to the template, the client or the serialiser can
 *   put them back on the page: the data never leaves the database.
 *
 *   A future reader adding a column to this list must keep that rule. If a screen
 *   genuinely needs an attendee's contact details, it is a staff screen and it
 *   must read the admin endpoint (GET /api/admin/events/:id), which asks for
 *   REGISTRATION_COLUMNS above - never this list.
 *
 * WHY THE BACKER NAME IS DERIVED HERE RATHER THAN SENT RAW
 *   The public page still has to say who a registration belongs to, and it shows
 *   a masked backer line ("Grace T."). That line is derived in SQL - the CASE on
 *   attendeeDisplayName below - rather than shipping `attendee_name` and masking
 *   it in the page, for the same reason the two contact columns are not selected:
 *   a response that never carried the full name cannot publish it, whatever a
 *   template, a client or a future export later renders. Masking on the way out
 *   of the database is a data-minimisation boundary, not a display decision.
 *
 *   The CASE is the twin of maskAttendeeName() in
 *   registration.repository.local.ts, and it has to reproduce it exactly: an
 *   empty or whitespace-only name masks to an empty string, a single word is
 *   returned unchanged, and anything longer keeps the first word and the
 *   upper-cased initial of the last word followed by a full stop. Only the
 *   offline twin can be run by the suite here, so tests/run-tests.js reads this
 *   CASE back out of this constant and compares the two on the same inputs.
 *
 *   The admin projection above is deliberately NOT masked, and neither is the
 *   write read-back in registration.repository.mysql.ts: staff need the whole
 *   name and both contact details, and the offline twin keeps them raw in exactly
 *   the same places.
 *
 * Everything the public page legitimately needs is still here: the attendee's
 * masked name, how many tickets they bought, the tier they bought and when.
 */
const REGISTRATION_COLUMNS_PUBLIC = `
  r.registration_id      AS registrationId,
  r.event_id             AS eventId,
  r.ticket_type_id       AS ticketTypeId,
  r.attendee_name        AS attendeeName,
  CASE
    WHEN ${ATTENDEE_NAME_FOR_MASK} = ''
      THEN ''
    WHEN ${ATTENDEE_NAME_FOR_MASK} NOT LIKE '% %'
      THEN ${ATTENDEE_NAME_FOR_MASK}
    ELSE CONCAT(
      SUBSTRING_INDEX(${ATTENDEE_NAME_FOR_MASK}, ' ', 1),
      ' ',
      UPPER(LEFT(SUBSTRING_INDEX(${ATTENDEE_NAME_FOR_MASK}, ' ', -1), 1)),
      '.'
    )
  END                    AS attendeeDisplayName,
  r.tickets_purchased    AS ticketsPurchased,
  r.registered_at        AS registeredAt,
  r.notes                AS notes,
  t.ticket_name          AS ticketName,
  t.price                AS ticketPrice,
  (r.tickets_purchased * COALESCE(t.price, 0)) AS totalAmount,
  e.event_name           AS eventName`;

/**
 * Normalise a registration row so both repositories emit the same types.
 *
 * @param row - The row as the driver returned it, or null when the query matched nothing.
 * @returns The row with its ids and amounts converted to numbers, or `null` unchanged.
 */
function normaliseRegistration(row: DataRecord | null): DataRecord | null {
  if (!row) return null;
  return {
    ...row,
    registrationId: Number(row.registrationId),
    eventId: Number(row.eventId),
    ticketTypeId:
      row.ticketTypeId === null || row.ticketTypeId === undefined
        ? null
        : Number(row.ticketTypeId),
    ticketsPurchased: Number(row.ticketsPurchased || 0),
    ticketPrice:
      row.ticketPrice === null || row.ticketPrice === undefined
        ? null
        : Number(row.ticketPrice),
    totalAmount: Number(row.totalAmount || 0),
  };
}

/**
 * The registration reads the merged repository publishes as `registrationQueries`.
 *
 * They live on the read half because MySQL keeps every registration read here;
 * the offline twin keeps its reads and writes in one module instead, which is why
 * src/repositories/index.ts publishes this member only when the read half does
 * not already carry it.
 */
const registrationQueries: RegistrationQueries = {
  /**
   * Every registration for one event, newest first.
   *
   * ORDER BY registered_at DESC is the brief's "sorted by the latest date when
   * the tickets were purchased"; registration_id DESC breaks a tie between two
   * rows written in the same second, so the order is always stable.
   *
   * WHICH COLUMNS COME BACK IS THE CALLER'S DECISION, AND THE SAFE DEFAULT IS
   * THE NARROW ONE. `includeContactDetails` defaults to false, so the public
   * event detail endpoint selects REGISTRATION_COLUMNS_PUBLIC and never sees an
   * attendee's email address or phone number. Only a caller that has explicitly
   * established that it serves staff (`getEventById(..., { status: 'all',
   * includeContactDetails: true })`, reached through /api/admin/events/:id)
   * selects the full list.
   *
   * @param eventId - The event whose registrations should be listed.
   * @param includeContactDetails - True only for the admin path, which keeps the
   *   attendee's email and phone for staff. May be omitted, in which case the
   *   public projection without contact details is used.
   * @returns The registration rows, normalised, newest first.
   */
  async findByEventId(eventId, includeContactDetails = false) {
    const columns = includeContactDetails ? REGISTRATION_COLUMNS : REGISTRATION_COLUMNS_PUBLIC;
    const rows = await q.query(
      `SELECT ${columns}
         FROM event_registrations r
         LEFT JOIN ticket_types t ON t.ticket_type_id = r.ticket_type_id
         LEFT JOIN events e       ON e.event_id       = r.event_id
        WHERE r.event_id = ?
        ORDER BY r.registered_at DESC, r.registration_id DESC`,
      [eventId]
    );
    return rows.map(normaliseRegistration);
  },

  /**
   * Every registration for one event, projected for a PUBLIC caller.
   *
   * The named counterpart of the offline `findPublicForEvent()` in
   * registration.repository.local.ts, and the method the public sub-collection
   * (GET /api/events/:id/registrations) calls. It is `findByEventId(eventId,
   * false)` - the explicit `false` is what selects REGISTRATION_COLUMNS_PUBLIC -
   * but it exists as its own name for the reason the offline twin records beside
   * its own copy: the public shape and the staff shape are then chosen at the
   * call site by name, so neither can be reached by forgetting a flag's default.
   * Staff get the contact details from the admin list, which asks for
   * `includeContactDetails: true` through GET /api/admin/events/:id.
   *
   * @param eventId - The event whose registrations should be listed.
   * @returns The registrations in the public projection, newest first, without attendee contact details.
   */
  async findPublicForEvent(eventId) {
    return registrationQueries.findByEventId(eventId, false);
  },

  /**
   * Return one registration by its primary key.
   *
   * @param registrationId - The registration's id.
   * @returns The registration row, or `null` when no row has that id.
   */
  async findById(registrationId) {
    const rows = await q.query(
      `SELECT ${REGISTRATION_COLUMNS}
         FROM event_registrations r
         LEFT JOIN ticket_types t ON t.ticket_type_id = r.ticket_type_id
         LEFT JOIN events e       ON e.event_id       = r.event_id
        WHERE r.registration_id = ?`,
      [registrationId]
    );
    return rows.length > 0 ? normaliseRegistration(rows[0]) : null;
  },

  /**
   * List the whole registration population, newest first.
   *
   * This powers the optional admin registrations page. The count is taken with
   * the same WHERE fragment (and the same bound values) as the page, so a filter
   * cannot make the total disagree with the rows returned.
   *
   * @param filters - The event id, email fragment and keyword to filter on. May be omitted, in which case every registration is included.
   * @param paging - The limit and offset to apply. May be omitted, in which case the first hundred rows are returned.
   * @returns The page of registration rows plus the unpaged total.
   */
  async findAll(filters = {}, paging = { limit: 100, offset: 0 }) {
    const params: any[] = [];
    const conditions: string[] = [];

    if (filters.eventId) {
      conditions.push('r.event_id = ?');
      params.push(filters.eventId);
    }
    if (filters.email) {
      // Escaped like every other LIKE in this file, so an address fragment of
      // "_" searches for an underscore rather than for any one character.
      conditions.push(`r.attendee_email LIKE ? ${LIKE_ESCAPE}`);
      params.push(containsPattern(filters.email));
    }
    if (filters.keyword) {
      // Two separate LIKEs, one per field, exactly as the offline twin tests
      // name and email separately: joining them first would let a keyword match
      // across the boundary between the two.
      conditions.push(
        `(r.attendee_name LIKE ? ${LIKE_ESCAPE} OR r.attendee_email LIKE ? ${LIKE_ESCAPE})`
      );
      const like = containsPattern(filters.keyword);
      params.push(like, like);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const rows = await q.query(
      `SELECT ${REGISTRATION_COLUMNS}
         FROM event_registrations r
         LEFT JOIN ticket_types t ON t.ticket_type_id = r.ticket_type_id
         LEFT JOIN events e       ON e.event_id       = r.event_id
         ${where}
        ORDER BY r.registered_at DESC, r.registration_id DESC
        LIMIT ? OFFSET ?`,
      [...params, paging.limit, paging.offset]
    );

    const countRows = await q.query(
      `SELECT COUNT(*) AS total FROM event_registrations r ${where}`,
      params
    );

    return {
      total: countRows[0] ? Number(countRows[0].total) : 0,
      registrations: rows.map(normaliseRegistration),
    };
  },

  /**
   * Count how many registrations an event has.
   *
   * Used by the delete rule, which runs this check inside the same transaction as
   * the delete.
   *
   * @param eventId - The event to count for.
   * @returns The number of registrations, or zero for an event with none.
   */
  async countByEventId(eventId) {
    const rows = await q.query(
      'SELECT COUNT(*) AS total FROM event_registrations WHERE event_id = ?',
      [eventId]
    );
    return rows[0] ? Number(rows[0].total) : 0;
  },

  /**
   * Test whether an email already has a registration for an event.
   *
   * The address is compared as stored, so the caller must normalise it first -
   * which the registration service does, and which is what makes this check agree
   * with the unique key on (event_id, attendee_email).
   *
   * @param eventId - The event to test against.
   * @param email - The normalised attendee address.
   * @returns `true` when a registration already exists, `false` otherwise.
   */
  async existsForEventAndEmail(eventId, email) {
    const rows = await q.query(
      `SELECT registration_id AS registrationId
         FROM event_registrations
        WHERE event_id = ? AND attendee_email = ?
        LIMIT 1`,
      [eventId, email]
    );
    return rows.length > 0;
  },
};

/**
 * The read repository plus the SQL helpers the tests exercise.
 *
 * One export: the helpers and column lists the original attached to
 * module.exports afterwards ride along on the same object, so
 * `require('./repository.mysql')` is still the repository the merged module
 * expects and the unit tests can assert on the generated SQL.
 *
 * WHICH HELPERS RIDE ALONG, AND WHY THE LIST IS SHORTER THAN IT WAS
 *   Five names from the original list were attached for a reader that does not
 *   exist and have been removed: `buildOrderBy`, `normaliseEvent`,
 *   `normaliseRegistration`, `decorateEventDetail` and `PRIMARY_PRICE`. A name
 *   search for each returned only this file - where every one of them is still
 *   called by name from the query builders above - and `docs/api-reference.md`,
 *   which is generated from those same blocks; no test, tool, service or
 *   controller ever reached for one. `EVENT_COLUMNS`, `SORT_COLUMNS` and
 *   `LIKE_ESCAPE` are in the same position as exports but stay for a different
 *   reason: they are module-level constants this file reads directly, so
 *   removing them from the attachment would delete nothing while making the
 *   similarity between the two data sources harder to see.
 *
 *   What remains attached is what is genuinely read from outside:
 *   `buildEventFilter`, `escapeLike` and `containsPattern` are called by
 *   `tests/run-tests.js` to assert that a keyword of `%` is escaped rather than
 *   selecting the whole table, and `REGISTRATION_COLUMNS` is read there too, as
 *   the counter-example in the privacy check: the staff projection must NOT
 *   carry the masked name. `REGISTRATION_COLUMNS_PUBLIC` is the projection that
 *   same check reads the SQL mask out of, which is why it is attached beside it.
 */
export = Object.assign(repository, {
  buildEventFilter,
  escapeLike,
  containsPattern,
  REGISTRATION_COLUMNS,
  REGISTRATION_COLUMNS_PUBLIC,
  registrationQueries,
});
