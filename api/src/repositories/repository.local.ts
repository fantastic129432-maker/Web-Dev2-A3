/**
 * @file Offline twin of repository.mysql.ts.
 *
 * It exposes exactly the same methods and returns exactly the same object
 * shapes, but the rows come from local-data.ts (a generated mirror of
 * database/02_seed.sql) instead of MySQL. It exists so the website can be run,
 * demonstrated and marked on a computer that has no MySQL server, and so the
 * API logic can be tested in isolation.
 *
 * The MySQL version is the submitted data source. Nothing in the case study
 * rules is changed here: suspended events are still hidden from the public
 * endpoints, upcoming/ongoing/past are still derived from the dates rather than
 * stored, and - as in MySQL - one email may register for an event only once.
 *
 * A3 note: the registration list lives in a mutable array created by
 * `createRegistrationStore()` (see registration.repository.local.ts), not in
 * this module, so a write performed by one request is visible to the next.
 * That is what lets the test suite exercise a create followed by a read.
 */
'use strict';

import env = require('../config/env');
import store = require('./local-store');
import registrationStore = require('./registration.repository.local');
import type { DataRecord, EventFilters, EventReadRepository } from '../types';

const data = store.data;

/**
 * "Today" for the derived event state.
 *
 * DATA_SOURCE=local + DEMO_TODAY=2026-09-28 makes the demo reproducible; when
 * DEMO_TODAY is not set the real current date is used, matching CURDATE().
 *
 * That date is the HOST'S LOCAL date, not the UTC one. CURDATE() answers in the
 * database server's own time zone, which on the deployment host is local time,
 * so taking the UTC date here made the two data sources disagree for the first
 * ten or eleven hours of every day on a UTC+10 host - an event happening today
 * was "upcoming" offline and "ongoing" in MySQL. Building the string from the
 * local getters is what makes the mirror answer what CURDATE() answers.
 *
 * @returns The demo date, or the real current local date as `YYYY-MM-DD`.
 */
function today(): string {
  const override = process.env.DEMO_TODAY;
  if (override && /^\d{4}-\d{2}-\d{2}$/.test(override)) return override;
  const now = new Date();
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * Derive upcoming, ongoing or past from the event's own dates.
 *
 * The state is computed rather than stored, exactly as vw_public_events does it,
 * so the mirror cannot disagree with MySQL about whether an event has finished.
 *
 * @param row - The raw event row.
 * @param currentDate - The date to compare against. May be omitted, in which case `today()` is used.
 * @returns `upcoming`, `ongoing` or `past`.
 */
function eventState(row: DataRecord, currentDate = today()): string {
  if (row.date_end < currentDate) return 'past';
  if (row.date_start <= currentDate) return 'ongoing';
  return 'upcoming';
}

/**
 * Find one row by a raw column value.
 *
 * The snapshot keeps the database's snake_case column names, so a lookup always
 * names the column it is matching on.
 *
 * @param collection - The raw snapshot table to search.
 * @param key - The column name to match, such as `category_id`.
 * @param value - The value to match.
 * @returns The first matching row, or `null` when the table has none.
 */
function byId(collection: DataRecord[], key: string, value: unknown): DataRecord | null {
  return collection.find((row) => row[key] === value) || null;
}

/**
 * Count whole days between two `YYYY-MM-DD` dates.
 *
 * The event detail page uses this for its "days to go" line, and it is computed
 * here rather than in the client so the two data sources report the same figure.
 *
 * @param fromDate - The earlier date, as `YYYY-MM-DD`.
 * @param toDate - The later date, as `YYYY-MM-DD`.
 * @returns The number of days, negative when `toDate` is in the past.
 */
function daysBetween(fromDate: string, toDate: string): number {
  const from = Date.parse(`${fromDate}T00:00:00Z`);
  const to = Date.parse(`${toDate}T00:00:00Z`);
  return Math.round((to - from) / 86_400_000);
}

/**
 * Join the lookup tables, the ticket tiers and the donation totals for one event.
 *
 * These names must stay identical to the aliases in repository.mysql.ts, because
 * both are consumed by the same client code; the decorated shape is the API's
 * real contract, which is why it is assembled in one function per data source
 * rather than shared.
 *
 * @param row - The raw event row from the snapshot or from an override.
 * @returns The event as the API returns it, with its names, totals, tiers and derived state.
 */
function decorate(row: DataRecord): DataRecord {
  const organization = byId(data.organizations, 'organization_id', row.organization_id);
  const category = byId(data.categories, 'category_id', row.category_id);
  const location = byId(data.locations, 'location_id', row.location_id);
  // Seeded tiers plus any tier added at run time for a newly created event.
  const tickets = store.ticketTypesFor(row.event_id);
  const gifts = data.donations.filter((d) => d.event_id === row.event_id);

  const raisedAmount = Number(
    gifts.reduce((sum, gift) => sum + Number(gift.amount), 0).toFixed(2)
  );
  const goalAmount = Number(row.goal_amount || 0);
  const prices = tickets.map((t) => Number(t.price));

  const registrations = registrationStore.findByEventId(row.event_id);

  return {
    eventId: row.event_id,
    eventName: row.event_name,
    shortDescription: row.short_description,
    description: row.description,
    purpose: row.purpose,
    eventDate: row.event_date,
    startTime: row.start_time,
    endTime: row.end_time,
    dateStart: row.date_start,
    dateEnd: row.date_end,
    goalAmount,
    isFree: Boolean(row.is_free),
    capacity: row.capacity === null ? null : Number(row.capacity),
    status: row.status,
    imageUrl: row.image_url,
    organizationId: row.organization_id,
    organizationName: organization ? organization.name : null,
    categoryId: row.category_id,
    categoryName: category ? category.category_name : null,
    categorySlug: category ? category.slug : null,
    locationId: row.location_id,
    venueName: location ? location.venue_name : null,
    address: location ? location.address : null,
    city: location ? location.city : null,
    state: location ? location.state : null,
    postcode: location ? location.postcode : null,
    latitude:
      location && location.latitude !== null && location.latitude !== undefined
        ? Number(location.latitude)
        : null,
    longitude:
      location && location.longitude !== null && location.longitude !== undefined
        ? Number(location.longitude)
        : null,
    raisedAmount,
    progressPercent:
      goalAmount > 0
        ? Math.min(Number(((raisedAmount / goalAmount) * 100).toFixed(1)), 100)
        : 0,
    donationCount: gifts.length,
    eventState: eventState(row),
    // A3: the admin list shows how much interest an event has attracted.
    registrationCount: registrations.length,
    ticketsSold: registrations.reduce((sum, item) => sum + item.ticketsPurchased, 0),
    primaryPrice: prices.length > 0 ? Math.min(...prices) : null,
    ticketTypes: tickets
      .slice()
      .sort((a, b) => Number(a.price) - Number(b.price))
      .map((ticket) => ({
        ticketTypeId: ticket.ticket_type_id,
        ticketName: ticket.ticket_name,
        price: Number(ticket.price),
        quantityAvailable:
          ticket.quantity_available === null ? null : Number(ticket.quantity_available),
        description: ticket.description,
      })),
  };
}

/**
 * All events, decorated, without any status filter.
 *
 * The variable is called `events` so the same function body can serve the
 * public view (which filters to status = 'active', exactly as
 * vw_public_events does) and the admin view (which does not).
 *
 * A3 added `overrides`: the write repository can replace or add a row, so a
 * freshly created event is visible to the very next read.
 *
 * @returns Every event in the mirror, decorated, including suspended and deleted-at-runtime rows removed.
 */
function allEvents(): DataRecord[] {
  return store.effectiveEvents().map(decorate);
}

/**
 * Public events only: status = 'active' is what vw_public_events enforces.
 *
 * @returns The decorated events a public endpoint may return.
 */
function publicEvents(): DataRecord[] {
  return allEvents().filter((event) => event.status === 'active');
}

/**
 * Test one decorated event against the validated filters.
 *
 * This is the in-memory equivalent of the WHERE clause repository.mysql.ts
 * builds, and the two must stay in step: a filter that is added to one and not
 * the other would make the two data sources disagree, which is exactly what the
 * test suite runs twice to catch.
 *
 * @param event - The decorated event to test.
 * @param filters - The validated filters from the service layer.
 * @returns `true` when the event satisfies every filter that was set.
 */
function matches(event: DataRecord, filters: EventFilters): boolean {
  if (filters.categoryIds && filters.categoryIds.length > 0) {
    if (!filters.categoryIds.includes(Number(event.categoryId))) return false;
  }

  if (filters.locationIds && filters.locationIds.length > 0) {
    if (!filters.locationIds.includes(Number(event.locationId))) return false;
  }

  if (filters.city) {
    const needle = filters.city.toLowerCase();
    if (!String(event.city).toLowerCase().includes(needle)) return false;
  }

  if (filters.from && event.dateEnd < filters.from) return false;
  if (filters.to && event.dateStart > filters.to) return false;

  if (filters.isFree === true && !event.isFree) return false;
  if (filters.isFree === false && event.isFree) return false;

  // The mirror of MySQL's `e.organization_id = ?`. The value is only ever a
  // positive whole number, because the service parses it like every other id, so
  // the falsy test here cannot swallow a 0 that the caller meant as a filter.
  if (filters.organizationId && Number(event.organizationId) !== Number(filters.organizationId)) {
    return false;
  }

  // A3: the admin site can narrow the list to one publishing status.
  if (filters.publishStatus && filters.publishStatus !== 'all') {
    if (event.status !== filters.publishStatus) return false;
  }

  if (filters.keyword) {
    // The same five fields, in the same order, as the five LIKEs
    // repository.mysql.ts builds - each tested on its own. Joining them into one
    // string first (which is what this did) made a two-word keyword match across
    // the boundary between two fields, so "Dinner Black-tie" found the gala
    // offline and nothing in MySQL. A field that is absent contributes nothing,
    // exactly as a LIKE against a NULL column matches nothing.
    const needle = filters.keyword.toLowerCase();
    const fields = [
      event.eventName,
      event.shortDescription,
      event.city,
      event.venueName,
      event.organizationName,
    ];
    const found = fields.some((value) =>
      String(value === null || value === undefined ? '' : value)
        .toLowerCase()
        .includes(needle)
    );
    if (!found) return false;
  }

  if (filters.state === 'past' && event.eventState !== 'past') return false;
  // 'ongoing' is its own state now: it used to share the 'upcoming' branch
  // below, which made ?state=ongoing return events that had not started yet.
  if (filters.state === 'ongoing' && event.eventState !== 'ongoing') return false;
  if (
    (filters.state === 'upcoming' || filters.excludePast) &&
    event.eventState === 'past'
  ) {
    return false;
  }

  return true;
}

/**
 * The sortable keys, mapped onto the decorated row's own field names.
 *
 * A whitelist rather than a dynamic lookup, because the value ends up deciding
 * the order of the results: anything not named here falls back to the default
 * sort instead of being passed through.
 */
const SORT_KEYS: Record<string, string> = {
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
 * Sort decorated events by a whitelisted key.
 *
 * A copy is sorted rather than the caller's array, and equal values fall back to
 * the event id so the order is stable - without that, two events on the same
 * date could swap places between requests and a page could repeat or skip a row.
 *
 * @param events - The events to sort.
 * @param sort - The requested sort key; an unknown key falls back to `defaultSort`.
 * @param direction - `desc` reverses the order; anything else is ascending.
 * @param defaultSort - The key to use when `sort` is not in the whitelist. May be omitted, in which case `date` is used.
 * @returns A new, sorted array.
 */
function sortEvents(events: DataRecord[], sort: string, direction: string, defaultSort = 'date'): DataRecord[] {
  const key = SORT_KEYS[sort] || SORT_KEYS[defaultSort];
  const dir = String(direction).toLowerCase() === 'desc' ? -1 : 1;

  return events.slice().sort((a, b) => {
    const left = a[key];
    const right = b[key];
    if (left === right) return a.eventId - b.eventId;
    if (typeof left === 'number' && typeof right === 'number') {
      return (left - right) * dir;
    }
    return String(left).localeCompare(String(right)) * dir;
  });
}

/**
 * The offline read half of the repository contract.
 *
 * It is the same object shape as the MySQL half, which is what lets
 * src/repositories/index.ts swap one for the other without a single caller
 * changing; the registration reads ride along on `registrationQueries` so the
 * merged object publishes them in both modes.
 */
const repository: EventReadRepository = {
  driver: 'local',

  /**
   * Report the health of the offline data source.
   *
   * It is always connected: the "database" is an array in memory, so the answer
   * describes the mirror (including the date the demo is pinned to) instead of
   * testing a connection that cannot fail.
   */
  async health() {
    return {
      connected: true,
      driver: 'local',
      database: `${env.DB_NAME} (in-memory mirror of database/02_seed.sql)`,
      serverVersion: 'n/a',
      tableCount: 12,
      registrationTable: true,
      host: 'local',
      user: 'local',
      note:
        'DATA_SOURCE=local. Set DATA_SOURCE=mysql in api/.env to read from MySQL.',
      demoToday: today(),
    };
  },

  /**
   * Return one page of decorated events for the validated filters.
   *
   * The admin list includes suspended and cancelled events; every public caller
   * keeps the active-only rule. Filtering, sorting and paging all happen in
   * memory on the same decorated rows that are returned, so the total can never
   * disagree with the page.
   */
  async findEvents(filters, paging) {
    // The admin list includes suspended and cancelled events; every public
    // caller keeps the active-only rule.
    const source = filters.audience === 'admin' ? allEvents() : publicEvents();
    const matched = source.filter((event) => matches(event, filters));
    const sorted = sortEvents(matched, paging.sort, paging.direction, 'date');
    const page = sorted.slice(paging.offset, paging.offset + paging.limit);
    return { total: sorted.length, events: page };
  },

  /**
   * Return one event with its registrations and its days-to-go figure.
   *
   * The publish-state rule is the same as MySQL's view: a public caller sees an
   * active event only, while `status: 'all'` (the admin pages) accepts any
   * status. The registrations come from the same store the event page reads, and
   * they are in newest-first order there.
   *
   * WHICH REGISTRATIONS COME BACK IS DECIDED HERE, MIRRORING THE MYSQL SELECT.
   * `includeContactDetails` defaults to false, so the public route gets
   * findPublicForEvent() - the rows without an attendee email address or phone
   * number, and with a masked attendeeDisplayName instead. The admin route passes
   * `true` explicitly and keeps the whole row for staff. Those two calls are the
   * local twins of REGISTRATION_COLUMNS_PUBLIC and REGISTRATION_COLUMNS in
   * repository.mysql.ts; changing one without the other is what the suite runs
   * the offline data source to catch.
   */
  async findEventById(eventId, options = {}) {
    const allowAnyStatus = options.status === 'all';
    const source = allowAnyStatus ? allEvents() : publicEvents();
    const event = source.find((row) => row.eventId === Number(eventId));
    if (!event) return null;

    const includeContactDetails = options.includeContactDetails === true;

    return {
      ...event,
      daysUntil: daysBetween(today(), event.dateStart),
      // A3: newest first, which is the order the brief asks the page to show.
      registrations: includeContactDetails
        ? registrationStore.findByEventId(event.eventId)
        : registrationStore.findPublicForEvent(event.eventId),
      totalTicketsSold: event.ticketsSold,
    };
  },

  /**
   * List every category with a count of its active events.
   *
   * The count is taken from the public view, so the filter panel's numbers match
   * what selecting that category would actually return.
   */
  async findCategories() {
    const events = publicEvents();
    return data.categories
      .map((category) => ({
        categoryId: category.category_id,
        categoryName: category.category_name,
        slug: category.slug,
        description: category.description,
        icon: category.icon,
        eventCount: events.filter((e) => e.categoryId === category.category_id).length,
      }))
      .sort((a, b) => a.categoryName.localeCompare(b.categoryName));
  },

  /**
   * List the venues that host at least one active event.
   *
   * Venues with no active event are filtered out here rather than in the client,
   * so no surface can offer a filter option that could only return nothing.
   */
  async findLocations() {
    const events = publicEvents();
    return data.locations
      .map((location) => ({
        locationId: location.location_id,
        venueName: location.venue_name,
        city: location.city,
        state: location.state,
        latitude:
          location.latitude === null || location.latitude === undefined
            ? null
            : Number(location.latitude),
        longitude:
          location.longitude === null || location.longitude === undefined
            ? null
            : Number(location.longitude),
        eventCount: events.filter((e) => e.locationId === location.location_id).length,
      }))
      .filter((location) => location.eventCount > 0)
      .sort(
        (a, b) =>
          a.city.localeCompare(b.city) || a.venueName.localeCompare(b.venueName)
      );
  },

  /**
   * Return the lookup lists the admin event forms need.
   *
   * Every reference row is included, even one with no public event: staff may be
   * about to create the first event for it, which is why this is not built from
   * the public event list the way findCategories() is.
   */
  async findReferenceData() {
    return {
      organizations: data.organizations
        .map((row) => ({
          organizationId: row.organization_id,
          name: row.name,
          city: row.city,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      categories: data.categories
        .map((row) => ({
          categoryId: row.category_id,
          categoryName: row.category_name,
          slug: row.slug,
          icon: row.icon,
        }))
        .sort((a, b) => a.categoryName.localeCompare(b.categoryName)),
      locations: data.locations
        .map((row) => ({
          locationId: row.location_id,
          venueName: row.venue_name,
          city: row.city,
          state: row.state,
          latitude: row.latitude === null ? null : Number(row.latitude),
          longitude: row.longitude === null ? null : Number(row.longitude),
        }))
        .sort(
          (a, b) =>
            a.city.localeCompare(b.city) || a.venueName.localeCompare(b.venueName)
        ),
    };
  },

  /**
   * Return the organisation featured on the home page.
   *
   * The mirror has one organisation, so it is the first row; the `null` case is
   * still handled because the MySQL view can legitimately return no featured row
   * and both data sources must behave the same way.
   */
  async findFeaturedOrganization() {
    const organization = data.organizations[0];
    if (!organization) return null;
    return {
      organizationId: organization.organization_id,
      name: organization.name,
      mission: organization.mission,
      email: organization.email,
      phone: organization.phone,
      website: organization.website,
      city: organization.city,
      country: organization.country,
    };
  },

  /**
   * Return the headline numbers for the home page.
   *
   * They are derived from the same decorated rows the listings return, so the
   * statistics strip cannot contradict the list below it; the registration totals
   * come from the mutable store so a registration taken during the demo shows up
   * immediately.
   */
  async findStats() {
    const events = publicEvents();
    const active = events.filter((e) => e.eventState !== 'past');
    const registrations = registrationStore.findAllRaw();
    return {
      upcomingEvents: active.length,
      categories: data.categories.length,
      organizations: data.organizations.length,
      totalRaised: Number(
        events.reduce((sum, e) => sum + e.raisedAmount, 0).toFixed(2)
      ),
      activeGoal: active.reduce((sum, e) => sum + e.goalAmount, 0),
      // A3: the home page statistics strip can now report registrations.
      registrations: registrations.length,
      ticketsSold: registrations.reduce((sum, row) => sum + row.tickets_purchased, 0),
      defaultPageSize: env.DEFAULT_PAGE_SIZE,
    };
  },

  /** Read access to the registration list for the admin pages. */
  registrationQueries: registrationStore,
};

/**
 * The read repository plus the pure helpers the tests exercise.
 *
 * One export: the helpers the original attached to module.exports afterwards
 * ride along on the same object, so `require('./repository.local')` is still the
 * repository the merged module expects and the unit tests can call `decorate()`
 * or `matches()` directly.
 */
export = Object.assign(repository, {
  decorate,
  eventState,
  today,
  publicEvents,
  allEvents,
  matches,
  sortEvents,
});
