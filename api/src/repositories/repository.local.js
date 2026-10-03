/**
 * src/repositories/repository.local.js
 * ---------------------------------------------------------------------------
 * Offline twin of repository.mysql.js.
 *
 * It exposes exactly the same methods and returns exactly the same object
 * shapes, but the rows come from local-data.js (a generated mirror of
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
 * `createRegistrationStore()` (see registration.repository.local.js), not in
 * this module, so a write performed by one request is visible to the next.
 * That is what lets the test suite exercise a create followed by a read.
 */
'use strict';

const env = require('../config/env');
const store = require('./local-store');
const registrationStore = require('./registration.repository.local');

const data = store.data;

/**
 * "Today" for the derived event state.
 * DATA_SOURCE=local + DEMO_TODAY=2026-09-28 makes the demo reproducible; when
 * DEMO_TODAY is not set the real current date is used, matching CURDATE().
 */
function today() {
  const override = process.env.DEMO_TODAY;
  if (override && /^\d{4}-\d{2}-\d{2}$/.test(override)) return override;
  return new Date().toISOString().slice(0, 10);
}

/** upcoming | ongoing | past - the same rule as vw_public_events. */
function eventState(row, currentDate = today()) {
  if (row.date_end < currentDate) return 'past';
  if (row.date_start <= currentDate) return 'ongoing';
  return 'upcoming';
}

function byId(collection, key, value) {
  return collection.find((row) => row[key] === value) || null;
}

function daysBetween(fromDate, toDate) {
  const from = Date.parse(`${fromDate}T00:00:00Z`);
  const to = Date.parse(`${toDate}T00:00:00Z`);
  return Math.round((to - from) / 86_400_000);
}

/**
 * Join the lookup tables, the ticket tiers and the donation totals for one
 * event. These names must stay identical to the aliases in
 * repository.mysql.js, because both are consumed by the same client code.
 */
function decorate(row) {
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
 */
function allEvents() {
  return store.effectiveEvents().map(decorate);
}

/** Public events only: status = 'active' is what vw_public_events enforces. */
function publicEvents() {
  return allEvents().filter((event) => event.status === 'active');
}

function matches(event, filters) {
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

  if (filters.organizationId && Number(event.organizationId) !== Number(filters.organizationId)) {
    return false;
  }

  // A3: the admin site can narrow the list to one publishing status.
  if (filters.publishStatus && filters.publishStatus !== 'all') {
    if (event.status !== filters.publishStatus) return false;
  }

  if (filters.keyword) {
    const needle = filters.keyword.toLowerCase();
    const haystack = [
      event.eventName,
      event.shortDescription,
      event.city,
      event.venueName,
      event.organizationName,
    ]
      .join(' ')
      .toLowerCase();
    if (!haystack.includes(needle)) return false;
  }

  if (filters.state === 'past' && event.eventState !== 'past') return false;
  if (
    (filters.state === 'upcoming' ||
      filters.state === 'ongoing' ||
      filters.excludePast) &&
    event.eventState === 'past'
  ) {
    return false;
  }

  return true;
}

const SORT_KEYS = {
  date: 'dateStart',
  name: 'eventName',
  goal: 'goalAmount',
  progress: 'progressPercent',
  category: 'categoryName',
  city: 'city',
  registrations: 'registrationCount',
  updated: 'eventId',
};

function sortEvents(events, sort, direction, defaultSort = 'date', defaultDir = 'ASC') {
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

/** The columns the admin ticket-tier panel may contain. */
function normaliseTicketTypes(eventId, ticketTypes) {
  return ticketTypes.map((ticket, index) => ({
    ticket_type_id: index + 1,
    event_id: eventId,
    ticket_name: ticket.ticketName,
    price: Number(ticket.price || 0),
    quantity_available:
      ticket.quantityAvailable === undefined || ticket.quantityAvailable === null
        ? null
        : Number(ticket.quantityAvailable),
    description: ticket.description === undefined ? null : ticket.description,
  }));
}

const repository = {
  driver: 'local',

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

  async findEvents(filters, paging) {
    // The admin list includes suspended and cancelled events; every public
    // caller keeps the active-only rule.
    const source = filters.audience === 'admin' ? allEvents() : publicEvents();
    const matched = source.filter((event) => matches(event, filters));
    const sorted = sortEvents(matched, paging.sort, paging.direction, 'date', 'ASC');
    const page = sorted.slice(paging.offset, paging.offset + paging.limit);
    return { total: sorted.length, events: page };
  },

  async findEventById(eventId, options = {}) {
    const allowAnyStatus = options.status === 'all';
    const source = allowAnyStatus ? allEvents() : publicEvents();
    const event = source.find((row) => row.eventId === Number(eventId));
    if (!event) return null;

    return {
      ...event,
      daysUntil: daysBetween(today(), event.dateStart),
      // A3: newest first, which is the order the brief asks the page to show.
      registrations: registrationStore.findByEventId(event.eventId),
      totalTicketsSold: event.ticketsSold,
    };
  },

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

  /** A3: the lookup lists the admin event forms need. */
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

  /** A3: read access to the registration list for the admin pages. */
  registrationQueries: registrationStore,
};

module.exports = repository;
module.exports.decorate = decorate;
module.exports.eventState = eventState;
module.exports.today = today;
module.exports.publicEvents = publicEvents;
module.exports.allEvents = allEvents;
module.exports.normaliseTicketTypes = normaliseTicketTypes;
module.exports.matches = matches;
module.exports.sortEvents = sortEvents;
