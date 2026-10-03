/**
 * src/repositories/repository.mysql.js
 * ---------------------------------------------------------------------------
 * The submission read data source: every question the API asks the database is
 * written here as one parameterised MySQL statement, built against the views
 * created in database/01_schema.sql.
 *
 * Three rules are applied consistently:
 *   1. Only rows with status = 'active' are ever publicly visible. This is
 *      guaranteed by vw_public_events, so a suspended event cannot leak out
 *      through an endpoint that is added later.
 *   2. upcoming / ongoing / past are DERIVED from date_start and date_end
 *      compared with CURDATE(); they are never stored, so the website stays
 *      correct without a nightly job.
 *   3. A3: the admin website lists every event regardless of status, so it
 *      reads vw_all_events instead. The view, not the query, is what decides
 *      visibility, which is why the public surface cannot be widened by
 *      accident.
 *
 * `q` is a short alias for event_db.query().
 */
'use strict';

const env = require('../config/env');
const db = require('../db/event_db');
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
 * Build the WHERE / HAVING fragment used by every event listing.
 *
 * All user input is bound through `params`; even the sort column is
 * whitelisted rather than interpolated into the SQL text.
 *
 * @param {object} filters  normalised filters from eventService
 * @returns {{where:string, having:string, params:Array}}
 */
function buildEventFilter(filters = {}) {
  const params = [];
  const conditions = [];

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
    conditions.push('e.city LIKE ?');
    params.push(`%${filters.city}%`);
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
    conditions.push(
      `(e.event_name LIKE ? OR e.short_description LIKE ? OR
        e.city LIKE ? OR e.venue_name LIKE ? OR e.organization_name LIKE ?)`
    );
    const like = `%${filters.keyword}%`;
    params.push(like, like, like, like, like);
  }

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

  // The three public states. 'upcoming' in the UI means "not finished yet",
  // which also covers an event running today, so ongoing folds into it.
  let having = '';
  if (filters.state === 'past') {
    having = 'HAVING eventState = ?';
    params.push('past');
  } else if (
    filters.state === 'upcoming' ||
    filters.state === 'ongoing' ||
    filters.excludePast
  ) {
    having = 'HAVING eventState <> ?';
    params.push('past');
  }

  return { where, having, params };
}

/** Whitelist of sortable columns - prevents SQL injection through ?sort=. */
const SORT_COLUMNS = {
  date: 'dateStart',
  name: 'eventName',
  goal: 'goalAmount',
  progress: 'progressPercent',
  category: 'categoryName',
  city: 'city',
  registrations: 'registrationCount',
  updated: 'eventId',
};

/** Turn a requested sort key/direction into safe SQL. */
function buildOrderBy(sort, direction, defaultSort = 'date', defaultDir = 'ASC') {
  const column = SORT_COLUMNS[sort] || SORT_COLUMNS[defaultSort];
  const dir = String(direction).toLowerCase() === 'desc' ? 'DESC' : 'ASC';
  return `ORDER BY ${column} ${dir}, eventId ASC`;
}

/** Shared normalisation so both repositories return identical field types. */
function normaliseEvent(row) {
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
 * Wrap the filtered event query in a derived table so the API can page the
 * result and count the total using exactly the same filters.
 *
 * A derived table (rather than a CTE) is used so the statement also runs on
 * MySQL 5.7 and on MariaDB.
 */
function buildFilteredSubquery(filters, orderBy, view = 'vw_public_events') {
  const { where, having, params } = buildEventFilter(filters);
  const sql = `
    SELECT ${EVENT_COLUMNS}, ${PRIMARY_PRICE}
      FROM ${view} e
      ${where}
      ${having}
      ${orderBy}`;
  return { sql, params };
}

const repository = {
  driver: 'mysql',

  /** Does the database answer, and do the tables exist? */
  async health() {
    return db.ping();
  },

  /**
   * Home page + search page listing.
   *
   * @param {object} filters  normalised filters from eventService
   * @param {{limit:number, offset:number, sort:string, direction:string}} paging
   */
  async findEvents(filters, paging) {
    const orderBy = buildOrderBy(
      paging.sort,
      paging.direction,
      filters.audience === 'admin' ? 'date' : 'date',
      filters.audience === 'admin' ? 'DESC' : 'ASC'
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

    return {
      total: countRows[0] ? Number(countRows[0].total) : 0,
      events: rows.map(normaliseEvent),
    };
  },

  /**
   * Full details for one event, including its ticket tiers.
   *
   * @param {number} eventId
   * @param {{status?: 'active'|'all'}} [options]  A3: 'all' lets the admin
   *        website open an event that is suspended or cancelled.
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

    const event = normaliseEvent(rows[0]);
    return decorateEventDetail(event, eventId);
  },

  /** All categories with a count of how many active events use each one. */
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
    return rows.map((row) => ({
      ...row,
      eventCount: Number(row.eventCount),
      categoryId: Number(row.categoryId),
    }));
  },

  /** Distinct venues that currently host at least one public event. */
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
    return rows.map((row) => ({
      ...row,
      locationId: Number(row.locationId),
      latitude: row.latitude === null ? null : Number(row.latitude),
      longitude: row.longitude === null ? null : Number(row.longitude),
      eventCount: Number(row.eventCount),
    }));
  },

  /**
   * Reference data the admin forms need in a dropdown: every organisation,
   * category and venue, whether or not it currently has a public event.
   *                                                                      A3
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

  /** The organisation featured on the home page. */
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

  /** Headline numbers for the home page statistics strip. */
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
 * Attach the ticket tiers, the days remaining and (A3) the registration list
 * to an event that has already been read from a view.
 *
 * Kept as a plain function so repository.local.js can reuse the identical
 * field names and ordering rules.
 */
async function decorateEventDetail(event, eventId) {
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

  event.ticketTypes = tickets.map((ticket) => ({
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
  // display ("sorted by the latest date when the tickets were purchased").
  event.registrations = await registrationQueries.findByEventId(eventId);
  event.totalTicketsSold = event.registrations.reduce(
    (sum, row) => sum + row.ticketsPurchased,
    0
  );

  return event;
}

/* =====================================================================
 * A3 - registrations (read)
 * ===================================================================== */
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

/** Unqualified version of the same list, for statements without a join. */
const REGISTRATION_COLUMNS_BARE = `
  r.registration_id      AS registrationId,
  r.event_id             AS eventId,
  r.ticket_type_id       AS ticketTypeId,
  r.attendee_name        AS attendeeName,
  r.attendee_email       AS attendeeEmail,
  r.attendee_phone       AS attendeePhone,
  r.tickets_purchased    AS ticketsPurchased,
  r.registered_at        AS registeredAt,
  r.notes                AS notes`;

/** Normalise a registration row so both repositories emit the same types. */
function normaliseRegistration(row) {
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

const registrationQueries = {
  /**
   * Every registration for one event, newest first.
   *
   * ORDER BY registered_at DESC is the brief's "sorted by the latest date when
   * the tickets were purchased"; registration_id DESC breaks a tie between two
   * rows written in the same second, so the order is always stable.
   */
  async findByEventId(eventId) {
    const rows = await q.query(
      `SELECT ${REGISTRATION_COLUMNS}
         FROM event_registrations r
         LEFT JOIN ticket_types t ON t.ticket_type_id = r.ticket_type_id
         LEFT JOIN events e       ON e.event_id       = r.event_id
        WHERE r.event_id = ?
        ORDER BY r.registered_at DESC, r.registration_id DESC`,
      [eventId]
    );
    return rows.map(normaliseRegistration);
  },

  /** One registration by id, or null. */
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
   * The whole registration list across all events, newest first. Powers the
   * optional admin registrations page.
   */
  async findAll(filters = {}, paging = { limit: 100, offset: 0 }) {
    const params = [];
    const conditions = [];

    if (filters.eventId) {
      conditions.push('r.event_id = ?');
      params.push(filters.eventId);
    }
    if (filters.email) {
      conditions.push('r.attendee_email LIKE ?');
      params.push(`%${filters.email}%`);
    }
    if (filters.keyword) {
      conditions.push('(r.attendee_name LIKE ? OR r.attendee_email LIKE ?)');
      const like = `%${filters.keyword}%`;
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

  /** How many registrations an event has. Used by the delete rule. */
  async countByEventId(eventId) {
    const rows = await q.query(
      'SELECT COUNT(*) AS total FROM event_registrations WHERE event_id = ?',
      [eventId]
    );
    return rows[0] ? Number(rows[0].total) : 0;
  },

  /** Does this email already have a registration for this event? */
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

module.exports = repository;
module.exports.buildEventFilter = buildEventFilter;
module.exports.buildOrderBy = buildOrderBy;
module.exports.normaliseEvent = normaliseEvent;
module.exports.normaliseRegistration = normaliseRegistration;
module.exports.SORT_COLUMNS = SORT_COLUMNS;
module.exports.EVENT_COLUMNS = EVENT_COLUMNS;
module.exports.REGISTRATION_COLUMNS = REGISTRATION_COLUMNS;
module.exports.REGISTRATION_COLUMNS_BARE = REGISTRATION_COLUMNS_BARE;
module.exports.PRIMARY_PRICE = PRIMARY_PRICE;
module.exports.decorateEventDetail = decorateEventDetail;
module.exports.queryOne = async function queryOne(sql, params = []) {
  const rows = await q.query(sql, params);
  return rows.length > 0 ? rows[0] : null;
};
module.exports.registrationQueries = registrationQueries;
