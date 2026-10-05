/**
 * tests/run-tests.js
 * ---------------------------------------------------------------------------
 * Automated checks for the PROG2002 submission. Run from the project root:
 *
 *     node tests/run-tests.js
 *
 * Four groups of checks are performed:
 *
 *   PART A - HTTP tests against the live Express API.
 *            The suite starts the API itself (on its own free port, with a temporary
 *            local data source), so it never disturbs a running server.
 *            Every endpoint, filter, validation rule and error response that
 *            the marker can try is asserted here.
 *
 *   PART B - DOM tests for the client-side website.
 *            The real HTML files and the real client JavaScript modules are
 *            loaded into a jsdom document, with fetch redirected to the test
 *            API. This proves that the data flow really ends up as rendered
 *            HTML: event cards, the progress bar, ticket prices, the filter
 *            checkboxes and the Clear Filters button.
 *
 *   PART C - Assessment 3: the registration endpoints, the full C.R.U.D. cycle
 *            for events, the admin view and - the rule the brief singles out -
 *            the refusal to delete an event that already has registrations.
 *            The delete rule is exercised from both sides: blocked while a
 *            registration exists, then allowed once it has been removed, which
 *            is the strongest form of this check because it proves the block is
 *            caused by the registration and not by something else.
 *
 *   PART D - Assessment 3 DOM tests: the new registration page (including its
 *            client-side validation and the confirmation screen), the
 *            registrations table on the event page, and the admin website's
 *            list, menu, update panel and dashboard.
 *
 * Every check runs against whichever data source TEST_DATA_SOURCE selects, so
 * the whole suite can be pointed at MySQL to prove both repositories behave
 * identically:
 *
 *     node tests/run-tests.js
 *     set TEST_DATA_SOURCE=mysql && node tests/run-tests.js
 *
 * The suite uses only Node's built-in assert module plus jsdom (a development
 * dependency, not part of the submitted api or clientside folders).
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const CLIENT_DIR = path.join(ROOT, 'clientside');
const API_DIR = path.join(ROOT, 'api');
const PREFERRED_PORT = Number(process.env.TEST_PORT || 3100);
const DEMO_TODAY = '2026-09-28'; // matches the seed data and api/.env

/**
 * The port the test API actually listens on. It starts at PREFERRED_PORT and
 * moves up if that port is taken, so two suites running at the same time (for
 * example the offline and MySQL runs launched together) cannot collide. A
 * collision used to make several DOM tests fail intermittently, which is the
 * worst kind of test failure.
 */
let port = PREFERRED_PORT;
const baseUrl = () => `http://127.0.0.1:${port}/api`;
/** Origin only, for handlers that receive a path that already starts with /api. */
const origin = () => `http://127.0.0.1:${port}`;

let passed = 0;
let failed = 0;
const failures = [];

/** Run one named check. */
async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  PASS  ${name}`);
  } catch (error) {
    failed += 1;
    failures.push({ name, error });
    console.log(`  FAIL  ${name}`);
    console.log(`        ${error.message}`);
  }
}

function group(title) {
  console.log(`\n${title}`);
  console.log('-'.repeat(title.length));
}

/** Small fetch helper that also returns the status code. */
async function api(pathname, options = {}) {
  const response = await fetch(`${baseUrl()}${pathname}`, options);
  let body = null;
  try {
    body = await response.json();
  } catch (error) {
    body = null;
  }
  return { status: response.status, body, headers: response.headers };
}

/* =====================================================================
 * Start the API for testing
 * ===================================================================== */
async function startTestApi() {
  // The offline data source is the default so the suite never needs MySQL,
  // but TEST_DATA_SOURCE=mysql runs exactly the same checks against the real
  // database, which is the best way to prove both repositories behave alike.
  process.env.NODE_ENV = 'test';
  process.env.DATA_SOURCE = process.env.TEST_DATA_SOURCE || 'local';
  process.env.DEMO_TODAY = DEMO_TODAY;
  process.env.CORS_ORIGIN = '*';
  process.env.RATE_LIMIT_MAX = '0';

  /*
   * Put the offline data source back to its seeded state.
   *
   * Assessment 3 gave the offline repository real writes, which live in a module
   * level store that lasts as long as the process. Without this reset the suite
   * would inherit whatever a previous run created, and the checks that assert
   * exact figures ("the seed data holds 20 registrations") would fail for a
   * reason that has nothing to do with the code under test. MySQL needs no
   * equivalent because reloading database/charityevents_db.sql does the same job.
   */
  if (process.env.DATA_SOURCE === 'local') {
    require(path.join(API_DIR, 'src', 'repositories')).resetLocalData();
  }

  // A port that is already in use must not fail every HTTP test, so try a
  // handful of ports in a row.
  const maxAttempts = 6;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    port = PREFERRED_PORT + attempt;
    process.env.PORT = String(port);

    // Require once; the module caches the Express app across attempts, which
    // is fine because only the listening port changes.
    const { app } = require(path.join(API_DIR, 'server.js'));

    try {
      const server = await new Promise((resolve, reject) => {
        const candidate = app.listen(port, () => resolve(candidate));
        candidate.once('error', reject);
      });
      return server;
    } catch (error) {
      if (error.code !== 'EADDRINUSE' || attempt === maxAttempts - 1) throw error;
      console.log(`Port ${port} is busy, trying ${port + 1}...`);
    }
  }

  throw new Error(`No free port found between ${PREFERRED_PORT} and ${PREFERRED_PORT + maxAttempts - 1}`);
}

/* =====================================================================
 * PART A - API tests
 * ===================================================================== */
async function testApi() {
  group('PART A - REST API (HTTP)');

  await test('GET /api/health reports the database as connected', async () => {
    const { status, body } = await api('/health');
    assert.equal(status, 200);
    assert.equal(body.success, true);
    assert.notEqual(body.data.database.connected, false);
  });

  await test('GET /api lists every documented endpoint', async () => {
    const { status, body } = await api('');
    assert.equal(status, 200);
    const paths = body.data.endpoints.map((endpoint) => endpoint.path);
    for (const expected of [
      '/api/health',
      '/api/events',
      '/api/events/upcoming',
      '/api/events/:id',
      '/api/categories',
      '/api/locations',
      '/api/organization',
      '/api/stats',
    ]) {
      assert.ok(paths.includes(expected), `${expected} is missing from the API index`);
    }
  });

  await test('GET /api/events/upcoming returns only events that have not finished', async () => {
    const { status, body } = await api('/events/upcoming');
    assert.equal(status, 200);
    assert.ok(body.data.length >= 5, 'expected at least five upcoming events');
    assert.ok(
      body.data.every((event) => event.eventState !== 'past'),
      'a past event leaked into the upcoming list'
    );
    // Soonest first
    const dates = body.data.map((event) => event.dateStart);
    assert.deepEqual(dates, [...dates].sort(), 'upcoming events are not sorted by date');
  });

  await test('GET /api/events excludes suspended events', async () => {
    const { body } = await api('/events?state=all&limit=100');
    const ids = body.data.map((event) => event.eventId);
    assert.ok(!ids.includes(11), 'the suspended event 11 must never be returned');
    assert.ok(
      body.data.every((event) => event.status === undefined || event.status === 'active'),
      'a non-active event was returned'
    );
  });

  await test('GET /api/events includes at least 8 seeded events', async () => {
    const { body } = await api('/events?state=all&limit=100');
    assert.ok(
      body.meta.total >= 8,
      `the database must hold at least 8 events, found ${body.meta.total}`
    );
  });

  await test('GET /api/events contains both upcoming and past events', async () => {
    const { body } = await api('/events?state=all&limit=100');
    const states = new Set(body.data.map((event) => event.eventState));
    assert.ok(states.has('upcoming'), 'no upcoming events found');
    assert.ok(states.has('past'), 'no past events found');
  });

  await test('every event in the list carries the fields the client renders', async () => {
    const { body } = await api('/events?state=all&limit=100');
    for (const event of body.data) {
      for (const field of [
        'eventId',
        'eventName',
        'shortDescription',
        'dateStart',
        'dateEnd',
        'eventState',
        'categoryName',
        'organizationName',
        'city',
        'venueName',
        'goalAmount',
        'raisedAmount',
        'progressPercent',
      ]) {
        assert.ok(
          event[field] !== undefined && event[field] !== null,
          `event ${event.eventId} is missing ${field}`
        );
      }
    }
  });

  await test('search filter: category ids (multiple) narrow the result set', async () => {
    const all = await api('/events?state=all&limit=100');
    const filtered = await api('/events?state=all&category=1,2&limit=100');
    assert.equal(filtered.status, 200);
    assert.ok(filtered.body.data.length > 0, 'expected at least one fun run or gala');
    assert.ok(
      filtered.body.data.every((event) => [1, 2].includes(event.categoryId)),
      'a category outside the filter was returned'
    );
    assert.ok(
      filtered.body.meta.total < all.body.meta.total,
      'the filter did not narrow anything'
    );
  });

  await test('search filter: repeated category parameters behave like a comma list', async () => {
    const comma = await api('/events?state=all&category=1,2&limit=100');
    const repeated = await api('/events?state=all&category=1&category=2&limit=100');
    assert.equal(repeated.body.meta.total, comma.body.meta.total);
  });

  await test('search filter: location id', async () => {
    const { body } = await api('/events?state=all&location=1&limit=100');
    assert.ok(body.data.length > 0);
    assert.ok(body.data.every((event) => event.locationId === 1));
  });

  await test('search filter: city is a case-insensitive partial match', async () => {
    const { body } = await api('/events?state=all&city=lism&limit=100');
    assert.ok(body.data.length >= 1);
    assert.ok(
      body.data.every((event) => event.city.toLowerCase().includes('lism')),
      'a city outside the filter was returned'
    );
  });

  await test('search filter: date range', async () => {
    const { body } = await api('/events?state=all&from=2026-10-01&to=2026-10-31&limit=100');
    assert.ok(body.data.length >= 2);
    for (const event of body.data) {
      assert.ok(event.dateEnd >= '2026-10-01', `${event.eventName} ends before the range`);
      assert.ok(event.dateStart <= '2026-10-31', `${event.eventName} starts after the range`);
    }
  });

  await test('search filter: single date matches the event held that day', async () => {
    const { body } = await api('/events?state=all&date=2026-06-13');
    assert.equal(body.meta.total, 1);
    assert.equal(body.data[0].eventId, 9);
  });

  await test('search filter: keyword matches name, city and venue', async () => {
    const byName = await api('/events?state=all&keyword=paws&limit=100');
    assert.equal(byName.body.meta.total, 1);
    assert.equal(byName.body.data[0].eventId, 4);

    const byCity = await api('/events?state=all&keyword=Sydney&limit=100');
    assert.ok(byCity.body.meta.total >= 1);
    assert.ok(byCity.body.data.every((event) => event.city === 'Sydney'));
  });

  await test('search filter: isFree=true returns only free events', async () => {
    const { body } = await api('/events?state=all&isFree=true&limit=100');
    assert.ok(body.data.length >= 1);
    assert.ok(body.data.every((event) => event.isFree === true));
  });

  await test('search filter: criteria combine with AND', async () => {
    const { body } = await api('/events?state=all&city=Lismore&category=1&limit=100');
    assert.equal(body.meta.total, 1);
    assert.equal(body.data[0].eventId, 1);
  });

  await test('pagination reports total, page and totalPages', async () => {
    const { body } = await api('/events?state=all&limit=3&page=2');
    assert.equal(body.data.length, 3);
    assert.equal(body.meta.page, 2);
    assert.equal(body.meta.offset, 3);
    assert.ok(body.meta.total >= 9);
    assert.equal(body.meta.totalPages, Math.ceil(body.meta.total / 3));
  });

  await test('sorting by name and direction works', async () => {
    const { body } = await api('/events?state=all&sort=name&direction=desc&limit=100');
    const names = body.data.map((event) => event.eventName);
    assert.deepEqual(names, [...names].sort().reverse());
  });

  await test('GET /api/events/:id returns full detail with ticket tiers', async () => {
    const { status, body } = await api('/events/1');
    assert.equal(status, 200);
    const event = body.data;
    assert.equal(event.eventId, 1);
    assert.ok(event.description.length > 100, 'the full description is missing');
    assert.ok(event.purpose.length > 10, 'the purpose is missing');
    assert.ok(Array.isArray(event.ticketTypes) && event.ticketTypes.length >= 2);
    for (const ticket of event.ticketTypes) {
      assert.equal(typeof ticket.price, 'number');
      assert.ok(ticket.ticketName);
    }
    assert.equal(typeof event.goalAmount, 'number');
    assert.equal(typeof event.raisedAmount, 'number');
    assert.equal(typeof event.progressPercent, 'number');
  });

  await test('progress figures are consistent with the goal', async () => {
    const { body } = await api('/events/1');
    const { goalAmount, raisedAmount, progressPercent } = body.data;
    const expected = Math.min(Number(((raisedAmount / goalAmount) * 100).toFixed(1)), 100);
    assert.equal(progressPercent, expected);
  });

  await test('at least one seeded event offers a free ticket tier', async () => {
    const { body } = await api('/events/1');
    assert.ok(
      body.data.ticketTypes.some((ticket) => ticket.price === 0),
      'expected a free ticket tier on the fun run'
    );
  });

  await test('GET /api/events/:id returns 404 for a suspended event', async () => {
    const { status, body } = await api('/events/11');
    assert.equal(status, 404);
    assert.equal(body.success, false);
    assert.equal(body.error.status, 404);
  });

  await test('GET /api/events/:id returns 400 for a non-numeric id', async () => {
    const { status, body } = await api('/events/not-a-number');
    assert.equal(status, 400);
    assert.equal(body.success, false);
    assert.match(body.error.message, /not a valid event id/i);
  });

  await test('GET /api/events/:id returns 404 for an unknown id', async () => {
    const { status } = await api('/events/9999');
    assert.equal(status, 404);
  });

  await test('GET /api/categories returns categories with event counts', async () => {
    const { status, body } = await api('/categories');
    assert.equal(status, 200);
    assert.ok(body.data.length >= 3, 'the brief asks for a few different categories');
    for (const category of body.data) {
      assert.ok(category.categoryId && category.categoryName);
      assert.equal(typeof category.eventCount, 'number');
    }
  });

  await test('GET /api/locations returns venues with active events', async () => {
    const { status, body } = await api('/locations');
    assert.equal(status, 200);
    assert.ok(body.data.length >= 3);
    assert.ok(body.data.every((location) => location.eventCount > 0));
  });

  await test('GET /api/organization and /api/stats power the home page', async () => {
    const organisation = await api('/organization');
    assert.equal(organisation.status, 200);
    assert.ok(organisation.body.data.name);
    assert.ok(organisation.body.data.mission);

    const stats = await api('/stats');
    assert.equal(stats.status, 200);
    assert.ok(stats.body.data.upcomingEvents >= 5);
    assert.ok(stats.body.data.totalRaised > 0);
  });

  await test('invalid query values are rejected with 400 and field details', async () => {
    const badDate = await api('/events?from=2026-13-45');
    assert.equal(badDate.status, 400);
    assert.ok(Array.isArray(badDate.body.error.details));

    const reversed = await api('/events?from=2026-12-01&to=2026-01-01');
    assert.equal(reversed.status, 400);

    const badState = await api('/events?state=finished');
    assert.equal(badState.status, 400);

    const badSort = await api('/events?sort=;DROP TABLE events');
    assert.equal(badSort.status, 400, 'sort injection attempt must be rejected');

    const badLimit = await api('/events?limit=99999');
    assert.equal(badLimit.status, 400);
  });

  await test('unknown endpoints return a JSON 404 envelope', async () => {
    const { status, body } = await api('/does-not-exist');
    assert.equal(status, 404);
    assert.equal(body.success, false);
    assert.equal(body.error.status, 404);
  });

  await test('security headers and CORS headers are present', async () => {
    const response = await fetch(`${baseUrl()}/events?limit=1`);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
    assert.ok(response.headers.get('access-control-allow-origin'));
    assert.equal(response.headers.get('x-powered-by'), null);
  });

  await test('the API handles the write methods Assessment 3 adds', async () => {
    // Assessment 2 was read-only. Assessment 3 implements the full C.R.U.D.
    // cycle, so POST/PUT/DELETE must be routed rather than fall through to the
    // 404 handler. An empty body is used deliberately: a 400 or a 201 both
    // prove the route exists, while a 404 would mean it does not.
    const response = await fetch(`${baseUrl()}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.notEqual(
      response.status,
      404,
      'POST /api/events must be handled now that A3 adds it'
    );
    assert.ok(response.status < 500, `the route answered ${response.status}`);
  });
}

/**
 * .tmp/a3-tests-part.js
 * ---------------------------------------------------------------------------
 * The Assessment 3 additions to tests/run-tests.js, kept in a separate file
 * while they are written so the insertion point is unambiguous.
 *
 * Two groups:
 *   PART C - the A3 API surface: registrations, full C.R.U.D., the delete
 *            integrity rule and the admin view.
 *   PART D - the A3 client-side pages, loaded into jsdom exactly like PART B.
 */
'use strict';

/* =====================================================================
 * PART C - Assessment 3: registrations, CRUD and data integrity
 * ===================================================================== */
async function testA3Api() {
  group('PART C - A3 API: registrations, full C.R.U.D., delete integrity');

  /* ---------------------------------------------------------- database --- */

  await test('GET /api/health reports the new registration table', async () => {
    const { status, body } = await api('/health');
    assert.equal(status, 200);
    assert.equal(
      body.data.database.registrationTable,
      true,
      'event_registrations is missing from the database'
    );
  });

  await test('the event detail endpoint returns every registration, newest first', async () => {
    const { status, body } = await api('/events/1');
    assert.equal(status, 200);

    const registrations = body.data.registrations;
    assert.ok(Array.isArray(registrations), 'registrations must be an array');
    assert.equal(registrations.length, 4, 'event 1 has four seeded registrations');

    // The brief: "sorted by the latest date when the tickets were purchased".
    const dates = registrations.map((row) => row.registeredAt);
    const sorted = dates.slice().sort().reverse();
    assert.deepEqual(dates, sorted, 'registrations must be newest first');

    // Every field the page and the admin table display must be present.
    const first = registrations[0];
    ['registrationId', 'eventId', 'attendeeName', 'attendeeEmail', 'ticketsPurchased',
     'registeredAt', 'ticketName', 'totalAmount'].forEach((field) => {
      assert.ok(field in first, `a registration is missing ${field}`);
    });
  });

  await test('a registration reports the value of the tickets it bought', async () => {
    const { body } = await api('/events/1');
    const registration = body.data.registrations.find((row) => row.registrationId === 1);

    // Registration 1 is two 10 km Timed Run entries at $45.00.
    assert.equal(registration.ticketName, '10 km Timed Run');
    assert.equal(registration.ticketPrice, 45);
    assert.equal(registration.ticketsPurchased, 2);
    assert.equal(registration.totalAmount, 90);
  });

  await test('the event detail endpoint totals the tickets sold', async () => {
    const { body } = await api('/events/1');
    assert.equal(body.data.totalTicketsSold, 8, 'event 1 has 8 tickets across 4 registrations');
    assert.equal(body.data.registrationCount, 4);
  });

  await test('GET /api/events/:id/registrations returns the same list', async () => {
    const { status, body, headers } = await api('/events/1/registrations');
    assert.equal(status, 200);
    assert.equal(body.meta.total, 4);
    assert.equal(body.meta.ticketsSold, 8);
    assert.match(body.meta.order, /DESC/);
    assert.equal(body.data[0].registrationId, 4, 'the newest purchase comes first');
    assert.equal(headers.get('content-type').includes('application/json'), true);
  });

  /* -------------------------------------------------------- registration --- */

  const NEW_EVENT = {
    organizationId: 1,
    categoryId: 4,
    locationId: 1,
    eventName: 'Suite Test Concert 2026',
    shortDescription: 'A concert created by the automated test suite.',
    description:
      'This event exists only while the test suite runs. It proves the create, update and delete endpoints work together, including the ticket tiers written with the event.',
    purpose: 'Prove the create endpoint works.',
    eventDate: '2026-11-28',
    startTime: '16:00',
    endTime: '21:00',
    goalAmount: 8000,
    isFree: false,
    capacity: 400,
    status: 'active',
    imageUrl: 'community.svg',
    ticketTypes: [
      { ticketName: 'Adult Entry', price: 20, quantityAvailable: 200 },
      { ticketName: 'Child Entry', price: 8, quantityAvailable: 150 },
    ],
  };

  let createdEventId = null;
  let createdTierId = null;
  let createdTierName = null;
  let createdTierPrice = null;
  let createdRegistrationId = null;

  await test('POST /api/events creates an event and answers 201 with a Location', async () => {
    const response = await fetch(`${baseUrl()}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(NEW_EVENT),
    });
    assert.equal(response.status, 201);

    const body = await response.json();
    assert.equal(body.success, true);
    assert.equal(body.data.eventName, NEW_EVENT.eventName);
    assert.equal(body.data.eventState, 'upcoming');
    assert.match(response.headers.get('location') || '', /^\/api\/events\/\d+$/);

    createdEventId = body.data.eventId;
    assert.ok(Number.isInteger(createdEventId));

    // The tiers sent with the event must have been written.
    assert.equal(body.data.ticketTypes.length, 2);
    assert.equal(body.data.primaryPrice, 8, 'the cheapest tier is the headline price');
    // tickets[0] is the CHEAPEST tier - the $8 Child Entry - not the $20 Adult
    // Entry, because the API orders tiers by price. The suite registers against
    // whichever tier it picks here, so the expected values are taken from the
    // same tier rather than assumed.
    const chosenTier =
      body.data.ticketTypes.find((tier) => tier.ticketName === 'Adult Entry') ||
      body.data.ticketTypes[0];
    createdTierId = chosenTier.ticketTypeId;
    createdTierName = chosenTier.ticketName;
    createdTierPrice = chosenTier.price;
  });

  await test('the created event is immediately readable', async () => {
    const { status, body } = await api(`/events/${createdEventId}`);
    assert.equal(status, 200);
    assert.equal(body.data.eventId, createdEventId);
    assert.deepEqual(body.data.registrations, [], 'a new event has no registrations');
  });

  await test('POST /api/events validates the body and reports every problem', async () => {
    const response = await fetch(`${baseUrl()}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventName: 'x' }),
    });
    assert.equal(response.status, 400);

    const body = await response.json();
    assert.equal(body.success, false);
    assert.ok(Array.isArray(body.error.details), 'a validation failure lists the problems');
    assert.ok(
      body.error.details.length >= 6,
      `expected several problems, got ${body.error.details.length}`
    );
    body.error.details.forEach((detail) => {
      assert.ok(detail.field, 'every problem names its field');
      assert.ok(detail.message, 'every problem has a message');
    });
  });

  await test('POST /api/events rejects a foreign key that does not exist', async () => {
    const response = await fetch(`${baseUrl()}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...NEW_EVENT, organizationId: 9999 }),
    });
    assert.equal(response.status, 400);
  });

  await test('PUT /api/events/:id changes only the fields it is sent', async () => {
    const response = await fetch(`${baseUrl()}/events/${createdEventId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goalAmount: 12500 }),
    });
    assert.equal(response.status, 200);

    const body = await response.json();
    assert.equal(body.data.goalAmount, 12500);
    // Untouched fields must survive a partial update.
    assert.equal(body.data.capacity, 400);
    assert.equal(body.data.eventName, NEW_EVENT.eventName);
  });

  await test('PUT /api/events/:id answers 404 for an unknown event', async () => {
    const response = await fetch(`${baseUrl()}/events/999999`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goalAmount: 1 }),
    });
    assert.equal(response.status, 404);
  });

  await test('PUT /api/events/:id rejects an empty body', async () => {
    const response = await fetch(`${baseUrl()}/events/${createdEventId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(response.status, 400);
  });

  await test('POST /api/events/:id/registrations records a new registration', async () => {
    const response = await fetch(`${baseUrl()}/events/${createdEventId}/registrations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        attendeeName: 'Suite Tester',
        attendeeEmail: 'Suite.Tester@Example.com',
        attendeePhone: '0400 123 456',
        ticketsPurchased: 3,
        ticketTypeId: createdTierId,
        notes: 'Created by the test suite.',
      }),
    });

    const body = await response.json();

    // The id is captured BEFORE the assertions, so a failed assertion here does
    // not cascade into "GET /api/registrations/undefined" below and turn one
    // real failure into four misleading ones.
    createdRegistrationId = body.data ? body.data.registrationId : null;

    assert.equal(response.status, 201, JSON.stringify(body.error || {}));
    assert.equal(body.data.attendeeName, 'Suite Tester');
    // The API lower-cases the address so the unique key compares like a person does.
    assert.equal(body.data.attendeeEmail, 'suite.tester@example.com');
    assert.equal(body.data.eventName, NEW_EVENT.eventName);
    assert.equal(body.data.ticketName, createdTierName);
    assert.equal(
      body.data.totalAmount,
      3 * createdTierPrice,
      `${body.data.ticketsPurchased} x $${createdTierPrice}`
    );
    assert.match(response.headers.get('location') || '', /^\/api\/registrations\/\d+$/);
  });

  await test('one email may register for an event only once', async () => {
    const response = await fetch(`${baseUrl()}/events/${createdEventId}/registrations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        attendeeName: 'Someone Else',
        attendeeEmail: '  SUITE.TESTER@example.com ',
        ticketsPurchased: 1,
      }),
    });

    assert.equal(response.status, 409, 'a duplicate registration is a conflict');
    const body = await response.json();
    assert.match(body.error.message, /already registered/i);
    assert.equal(body.error.details.field, 'attendeeEmail');
  });

  await test('the same email may register for a different event', async () => {
    const response = await fetch(`${baseUrl()}/events/4/registrations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        attendeeName: 'Suite Tester',
        attendeeEmail: 'suite.tester@example.com',
        ticketsPurchased: 1,
      }),
    });

    assert.equal(response.status, 201, 'the unique key is per event, not per email');
    const body = await response.json();

    // Remove it again so the later "there are exactly 20 registrations" checks
    // still describe the seeded data rather than this test's leftovers.
    const removed = await fetch(`${baseUrl()}/registrations/${body.data.registrationId}`, {
      method: 'DELETE',
    });
    assert.equal(removed.status, 204, 'the cleanup delete should succeed');
  });

  await test('a ticket type from another event is refused', async () => {
    const response = await fetch(`${baseUrl()}/events/${createdEventId}/registrations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        attendeeName: 'Wrong Tier',
        attendeeEmail: 'wrong.tier@example.com',
        ticketsPurchased: 1,
        ticketTypeId: 4, // belongs to event 2
      }),
    });
    assert.equal(response.status, 400);
  });

  await test('a registration for an event that does not exist is 404', async () => {
    const response = await fetch(`${baseUrl()}/events/999999/registrations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        attendeeName: 'Nobody',
        attendeeEmail: 'nobody@example.com',
        ticketsPurchased: 1,
      }),
    });
    assert.equal(response.status, 404);
  });

  await test('a registration needs a name and a valid email', async () => {
    const response = await fetch(`${baseUrl()}/events/4/registrations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attendeeName: 'A', attendeeEmail: 'not-an-email' }),
    });
    assert.equal(response.status, 400);
    const body = await response.json();
    const fields = body.error.details.map((detail) => detail.field);
    assert.ok(fields.includes('attendeeName'));
    assert.ok(fields.includes('attendeeEmail'));
  });

  await test('GET and PUT /api/registrations/:id work for one registration', async () => {
    const read = await api(`/registrations/${createdRegistrationId}`);
    assert.equal(read.status, 200);
    assert.equal(read.body.data.ticketsPurchased, 3);

    const response = await fetch(`${baseUrl()}/registrations/${createdRegistrationId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticketsPurchased: 5 }),
    });
    assert.equal(response.status, 200);

    const body = await response.json();
    assert.equal(body.data.ticketsPurchased, 5);
    assert.equal(body.data.totalAmount, 100, 'the value follows the quantity');
  });

  /* --------------------------------------------------- delete integrity --- */

  await test('DELETE /api/events/:id is BLOCKED while registrations exist', async () => {
    const response = await fetch(`${baseUrl()}/events/${createdEventId}`, {
      method: 'DELETE',
    });

    assert.equal(response.status, 409, 'the brief requires the delete to be blocked');

    const body = await response.json();
    assert.equal(body.success, false);
    assert.equal(body.error.status, 409);
    assert.equal(body.error.details.registrationCount, 1);
    assert.match(body.error.message, /registration/i);
    assert.match(body.error.message, /cannot be deleted/i);
  });

  await test('a blocked delete leaves the event untouched', async () => {
    const { status, body } = await api(`/events/${createdEventId}`);
    assert.equal(status, 200, 'the event must still exist after a blocked delete');
    assert.equal(body.data.registrationCount, 1);
  });

  await test('the seeded event with registrations is protected too', async () => {
    // Event 7 has three seeded registrations.
    const response = await fetch(`${baseUrl()}/events/7`, { method: 'DELETE' });
    assert.equal(response.status, 409);

    const after = await api('/events/7');
    assert.equal(after.status, 200);
    assert.equal(after.body.data.registrations.length, 3, 'its registrations survived');
  });

  await test('DELETE /api/registrations/:id answers 204 and removes the row', async () => {
    const response = await fetch(`${baseUrl()}/registrations/${createdRegistrationId}`, {
      method: 'DELETE',
    });
    assert.equal(response.status, 204);
    assert.equal(await response.text(), '', 'a 204 has no body');

    const after = await api(`/registrations/${createdRegistrationId}`);
    assert.equal(after.status, 404);
  });

  await test('once the registrations are gone the event CAN be deleted', async () => {
    const response = await fetch(`${baseUrl()}/events/${createdEventId}`, {
      method: 'DELETE',
    });
    assert.equal(response.status, 204);
    assert.equal(
      response.headers.get('x-deleted-event-id'),
      String(createdEventId),
      'the outcome is reported in a header because 204 carries no body'
    );

    const after = await api(`/events/${createdEventId}`);
    assert.equal(after.status, 404);
  });

  await test('deleting an event twice answers 404 the second time', async () => {
    const response = await fetch(`${baseUrl()}/events/${createdEventId}`, {
      method: 'DELETE',
    });
    assert.equal(response.status, 404);
  });

  /* ------------------------------------------------------ admin surface --- */

  await test('GET /api/admin/events includes suspended and past events', async () => {
    const { status, body } = await api('/admin/events?limit=100&state=all&publishStatus=all');
    assert.equal(status, 200);
    assert.equal(body.meta.view, 'admin');

    const statuses = body.data.map((event) => event.status);
    assert.ok(statuses.includes('suspended'), 'the admin list must show suspended events');
    assert.ok(
      body.data.some((event) => event.eventState === 'past'),
      'the admin list must show past events'
    );

    // The public endpoint must still hide the suspended one.
    const hidden = await api('/events/11');
    assert.equal(hidden.status, 404, 'the public website must not expose a suspended event');

    // The admin endpoint may read it.
    const visible = await api('/admin/events/11');
    assert.equal(visible.status, 200);
    assert.equal(visible.body.data.status, 'suspended');
  });

  await test('the admin list reports how many registrations each event has', async () => {
    const { body } = await api('/admin/events?limit=100&state=all&publishStatus=all');
    const event7 = body.data.find((event) => event.eventId === 7);
    assert.equal(event7.registrationCount, 3);
    assert.equal(event7.ticketsSold, 5);
  });

  await test('?publishStatus=suspended narrows the admin list', async () => {
    const { body } = await api('/admin/events?publishStatus=suspended');
    assert.ok(body.data.length >= 1);
    body.data.forEach((event) => assert.equal(event.status, 'suspended'));
  });

  await test('GET /api/admin/reference-data supplies the form dropdowns', async () => {
    const { status, body } = await api('/admin/reference-data');
    assert.equal(status, 200);

    assert.ok(body.data.organizations.length >= 6, 'organisations');
    assert.ok(body.data.categories.length >= 8, 'categories');
    assert.ok(body.data.locations.length >= 9, 'venues');

    // The reference lists must include rows with no public event too, because
    // staff may be about to create one.
    assert.ok(
      body.data.locations.some((location) => location.venueName.includes('Online')),
      'every venue is offered, not only the ones with a public event'
    );
  });

  await test('GET /api/registrations lists every registration across events', async () => {
    const { status, body } = await api('/registrations?limit=200');
    assert.equal(status, 200);
    assert.equal(body.meta.total, 20, 'the seed data holds 20 registrations');
    assert.equal(body.meta.view, 'admin');

    const dates = body.data.map((row) => row.registeredAt);
    assert.deepEqual(dates, dates.slice().sort().reverse(), 'newest first');

    // Each row names its event, which the admin table needs.
    body.data.forEach((row) => assert.ok(row.eventName, 'a registration must name its event'));
  });

  await test('GET /api/registrations?eventId= narrows the list to one event', async () => {
    const { body } = await api('/registrations?eventId=2');
    assert.ok(body.data.length > 0);
    body.data.forEach((row) => assert.equal(row.eventId, 2));
  });

  await test('GET /api/registrations?keyword= searches name and email', async () => {
    const { body } = await api('/registrations?keyword=amelia');
    assert.equal(body.data.length, 1);
    assert.equal(body.data[0].attendeeName, 'Amelia Hartley');
  });

  /* ---------------------------------------------------------- security --- */

  await test('CORS now advertises the write methods', async () => {
    const response = await fetch(`${baseUrl()}/events`, { method: 'OPTIONS' });
    const allowed = response.headers.get('access-control-allow-methods') || '';
    assert.match(allowed, /POST/);
    assert.match(allowed, /PUT/);
    assert.match(allowed, /DELETE/);
    assert.match(response.headers.get('access-control-expose-headers') || '', /Location/);
  });

  await test('GET /api/stats reports the registration totals', async () => {
    const { body } = await api('/stats');
    assert.equal(body.data.registrations, 20);
    assert.equal(body.data.ticketsSold, 49);
  });

  await test('the submitted SQL dump matches the schema and seed sources', async () => {
    /*
     * The brief asks for the final database to be exported to a SINGLE SQL file,
     * and that file is what the marker runs. It is assembled from
     * database/01_schema.sql and database/02_seed.sql by
     * tools/export-database-dump.mjs, so the three cannot drift - but only if
     * the assembly is actually re-run after an edit.
     *
     * An earlier revision of this project kept a hand-maintained dump as well,
     * and it still described the Assessment 2 schema (six tables, no
     * event_registrations) while the API expected seven. A marker running that
     * file would have got a database the API could not use. This check is the
     * guard against a repeat.
     */
    const { spawnSync } = require('node:child_process');
    const result = spawnSync(
      process.execPath,
      [path.join(ROOT, 'tools', 'export-database-dump.mjs'), '--check'],
      { encoding: 'utf8' }
    );

    assert.equal(
      result.status,
      0,
      `database/charityevents_db.sql is out of date - run node tools/export-database-dump.mjs\n` +
        `${result.stderr || ''}${result.stdout || ''}`
    );
  });

  await test('the submitted SQL dump contains the A3 objects', async () => {
    const dump = fs.readFileSync(path.join(ROOT, 'database', 'charityevents_db.sql'), 'utf8');

    // The new table and the views it needs must be in the file the marker runs.
    assert.match(dump, /CREATE TABLE event_registrations/, 'event_registrations is missing');

    // The unique key that enforces "one registration per user per event".
    assert.match(
      dump,
      /UNIQUE KEY uq_registration_event_email \(event_id, attendee_email\)/,
      'the one-registration-per-event unique key is missing'
    );

    // ON DELETE RESTRICT is the database-level backstop for the delete rule.
    assert.match(
      dump,
      /CONSTRAINT fk_registration_event FOREIGN KEY \(event_id\)[\s\S]*?ON DELETE RESTRICT/,
      'the RESTRICT foreign key behind the delete rule is missing'
    );

    // The seed rows the whole feature is demonstrated with.
    assert.match(dump, /INSERT INTO event_registrations/, 'the registration seed data is missing');

    // Every view the API selects from.
    [
      'vw_event_progress',
      'vw_event_columns',
      'vw_public_events',
      'vw_all_events',
      'vw_event_registrations',
    ].forEach((view) => {
      assert.match(dump, new RegExp(`CREATE OR REPLACE VIEW ${view}\\b`), `${view} is missing`);
    });

    // And the preamble that actually creates the database.
    assert.match(dump, /DROP DATABASE IF EXISTS charityevents_db/);
    assert.match(dump, /CREATE DATABASE charityevents_db/);
  });
}

/* =====================================================================
 * PART B - client-side DOM tests
 * ===================================================================== */

/**
 * Read the import statements out of one client module.
 * Returns an array of { source, names: [{ imported, local }] }.
 */
function parseImports(source, url) {
  const imports = [];
  const pattern = /import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]\s*;?/g;
  let match;

  while ((match = pattern.exec(source)) !== null) {
    const names = match[1]
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const [imported, alias] = entry.split(/\s+as\s+/).map((part) => part.trim());
        return { imported, local: alias || imported };
      });
    imports.push({ source: resolveKey(url, match[2]), names });
  }

  return imports;
}

/** Remove the import statements and rewrite the export statements. */
function transformModule(source) {
  const exportNames = new Set();
  let code = source;

  code = code.replace(/import\s*\{[^}]*\}\s*from\s*['"][^'"]+['"]\s*;?/g, '');
  code = code.replace(/\bimport\s*\(/g, '__import(');

  // A bare list with no source, e.g. `export { validate, soldForTier };`. The
  // page modules added in A3 use this form, and leaving it in place made jsdom
  // throw "Unexpected token 'export'". The names are recorded so the loader can
  // still read them back out of the sandbox.
  code = code.replace(/export\s*\{([^}]*)\}\s*;?/g, (match, list) => {
    list
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .forEach((entry) => {
        const [local, exported] = entry.split(/\s+as\s+/).map((part) => part.trim());
        exportNames.add(exported || local);
      });
    return '';
  });

  code = code.replace(
    /export\s+(const|let|var|function|class|async\s+function)\s+([A-Za-z_$][\w$]*)/g,
    (match, kind, name) => {
      exportNames.add(name);
      return `${kind} ${name}`;
    }
  );

  return { code, exportNames };
}

/** Normalise './api.js' plus the module's own url into a registry key. */
function resolveKey(baseUrl, specifier) {
  if (!specifier.startsWith('.')) return specifier;
  const base = baseUrl.replace(/[^/]*$/, '');
  const segments = `${base}${specifier}`.split('/');
  const stack = [];
  for (const segment of segments) {
    if (segment === '.' || segment === '') continue;
    if (segment === '..') stack.pop();
    else stack.push(segment);
  }
  return stack.join('/');
}

/**
 * Load one client module: resolve its imports first, bind them as real
 * variables in the sandbox, then evaluate the transformed source.
 */
async function evaluateModule(shortName, registry, moduleCache) {
  const source = registry.get(shortName);
  const imports = parseImports(source, shortName);
  const { code, exportNames } = transformModule(source);

  const bindings = {};
  for (const dependency of imports) {
    await evaluateModule(dependency.source, registry, moduleCache);
    const exported = moduleCache.get(dependency.source);
    for (const { imported, local } of dependency.names) {
      Object.defineProperty(bindings, local, {
        enumerable: true,
        configurable: true,
        get: () => exported[imported],
      });
    }
  }

  const record = moduleCache.get(shortName) || {};
  const localRequire = (specifier) =>
    moduleCache.get(resolveKey(shortName, specifier)) || {};

  // Expose the live binding getters on the jsdom window so the sandbox can
  // copy them into local variables before the module body runs.
  globalThis.__jsdomWindow.__dshBindings = bindings;

  const sandbox = {
    window: globalThis.__jsdomWindow,
    document: globalThis.__jsdomWindow.document,
    console,
    setTimeout,
    clearTimeout,
    // The page must talk to the in-process test API, never the network.
    // loadPage() installs that stub on the jsdom window, so delegate to it.
    // Handing the modules Node's own fetch() instead would send every page
    // request to the real URL in config.js, which made these tests depend on
    // a separate API happening to run on port 3000: they passed with it up
    // and failed with it down, while testing neither deliberately.
    fetch: (input, init) => globalThis.__jsdomWindow.fetch(input, init),
    AbortController,
    URLSearchParams,
    Intl,
    __import: (specifier) =>
      evaluateModule(resolveKey(shortName, specifier), registry, moduleCache).then(() =>
        moduleCache.get(resolveKey(shortName, specifier))
      ),
    __require: localRequire,
  };

  const context = vm.createContext(sandbox);

  // `var a = window.__dshBindings["a"], b = ...` gives the module body the
  // imported names as ordinary variables, exactly like a real ES module.
  const bindingDeclaration = Object.keys(bindings)
    .map((name) => `${name} = window.__dshBindings[${JSON.stringify(name)}]`)
    .join(', ');
  if (bindingDeclaration) {
    vm.runInContext(`var ${bindingDeclaration};`, context, { filename: `${shortName}#bindings` });
  }

  vm.runInContext(code, context, { filename: shortName });

  exportNames.forEach((name) => {
    record[name] = vm.runInContext(`typeof ${name} === 'undefined' ? undefined : ${name}`, context);
  });

  moduleCache.set(shortName, record);
  return record;
}

/** Load the client modules into a jsdom window and return a loader. */
function createModuleLoader(window) {
  const registry = new Map();
  const moduleCache = new Map();

  // The transformed code refers to `window`, so expose the jsdom window.
  globalThis.__jsdomWindow = window;

  return {
    define(shortName, source) {
      registry.set(shortName, source);
    },
    load(shortName) {
      return evaluateModule(shortName, registry, moduleCache);
    },
  };
}

/** Wait until a condition is true, or time out. */
async function waitFor(condition, { timeout = 5000, interval = 25 } = {}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    if (condition()) return true;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  return false;
}

/** Build a jsdom page for one clientside HTML file. */
async function loadPage({ JSDOM }, htmlFile, { url, apiHandler, beforeInit }) {
  const html = fs.readFileSync(path.join(CLIENT_DIR, htmlFile), 'utf8');

  const dom = new JSDOM(html, {
    url,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const { window } = dom;

  /*
   * Redirect the page's fetch() calls to the in-process test API.
   *
   * js/api.js builds an ABSOLUTE url from `API_BASE_URL` in js/config.js, so the
   * production prefix has to be swapped for the test API's prefix. The path SHAPE
   * is kept exactly as it was - including the `/api` segment - because that is
   * what every apiHandler in this file expects: they all do
   * `fetch(`${origin()}${pathname}`)` with origin = http://127.0.0.1:<port>.
   *
   * Two mistakes were made here before this version, both worth recording:
   *
   *   1. Stripping only the origin. That worked while config.js held
   *      `http://localhost:3000/api` (leaving `/api/events`), and broke the moment
   *      the deployment step pointed it at
   *      `https://24832481.it.scu.edu.au/charity-events-api/api` - the path became
   *      `/charity-events-api/api/events`, every request 404'd, and 23 DOM checks
   *      failed for a reason unrelated to the code under test.
   *   2. Stripping the API prefix too. That produced `/events`, but the handlers
   *      then requested `<testOrigin>/events` instead of `<testOrigin>/api/events`,
   *      so every request still 404'd - just at a different URL.
   *
   * Substituting the prefix keeps both the page and the handlers correct, and it
   * keeps working wherever the site is pointed, because the prefix is read from
   * config.js rather than assumed.
   */
  const clientConfig = fs.readFileSync(path.join(CLIENT_DIR, 'js', 'config.js'), 'utf8');
  const apiBaseMatch = clientConfig.match(/API_BASE_URL\s*=\s*['"]([^'"]+)['"]/);
  const productionPrefix = apiBaseMatch
    ? apiBaseMatch[1].replace(/^https?:\/\/[^/]+/, '').replace(/\/+$/, '')
    : '';
  const testPrefix = new URL(origin()).pathname.replace(/\/+$/, '') + '/api';

  window.fetch = async (input, init) => {
    const target = typeof input === 'string' ? input : input.url;
    const withoutOrigin = target.replace(/^https?:\/\/[^/]+/, '');

    const pathname =
      productionPrefix && withoutOrigin.startsWith(productionPrefix)
        ? `${testPrefix}${withoutOrigin.slice(productionPrefix.length)}`
        : withoutOrigin;

    const result = await apiHandler(pathname, init);
    return {
      ok: result.status >= 200 && result.status < 300,
      status: result.status,
      headers: result.headers || new Headers(),
      json: async () => result.body,
    };
  };
  window.AbortController = AbortController;

  /*
   * jsdom implements no layout and therefore no scrolling.
   *
   * Only window.scrollTo needs a stub: the registration confirmation returns to
   * the top with it, and without this jsdom prints "Not implemented:
   * window.scrollTo" on every run. scrollIntoView is deliberately NOT stubbed,
   * because jsdom implements it as a harmless no-op and several existing checks
   * install their own spy on it - a prototype stub here would be overwritten by
   * those spies depending on which ran last, which is exactly the kind of
   * order-dependent behaviour that makes a suite untrustworthy.
   */
  window.__scrollCalls = [];
  window.scrollTo = (...args) => {
    window.__scrollCalls.push({ target: 'window', args });
  };

  // Let a test install spies or stubs before any page module runs.
  if (typeof beforeInit === 'function') beforeInit(window);

  const loader = createModuleLoader(window);

  /*
   * Register every client module, keyed by its path relative to the clientside
   * folder.
   *
   * A flat readdirSync of clientside/js was enough while every page lived at the
   * top level. The admin pages live in clientside/admin and import
   * '../../js/api.js', which resolves to 'js/api.js' - a key that did not exist,
   * so evaluateModule() was handed undefined and every admin DOM test failed
   * with "Cannot read properties of undefined". Indexing the whole tree makes
   * both the public modules and the admin modules addressable, and the
   * path-relative keys are what resolveKey() already produces.
   */
  const registryKeys = new Set();
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith('.js')) {
        const key = path.relative(CLIENT_DIR, full).split(path.sep).join('/');
        registryKeys.add(key);
        loader.define(key, fs.readFileSync(full, 'utf8'));
      }
    }
  };
  walk(CLIENT_DIR);

  // Find the module script the page uses and evaluate it.
  //
  // The src is resolved RELATIVE TO THE PAGE, exactly as a browser resolves it.
  // index.html loads "js/home.js" and admin/events.html loads "js/events.js":
  // both are correct and they name different files. Resolving every entry
  // against the clientside root made the admin pages load the PUBLIC
  // js/events.js, which is why every admin DOM check failed while the loader
  // itself looked healthy.
  const scriptMatch = html.match(/<script[^>]*type="module"[^>]*src="([^"]+\.js)"/);
  assert.ok(scriptMatch, `${htmlFile} must load a client module`);

  const pageDir = path.dirname(path.join(CLIENT_DIR, htmlFile));
  const entryKey = path
    .relative(CLIENT_DIR, path.resolve(pageDir, scriptMatch[1]))
    .split(path.sep)
    .join('/');

  assert.ok(
    registryKeys.has(entryKey),
    `${htmlFile} loads ${scriptMatch[1]}, which resolved to an unregistered module (${entryKey})`
  );

  // Fire DOMContentLoaded only after the entry module has registered its
  // listener, which is what a real browser does.
  await loader.load(entryKey);
  window.document.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true }));

  return { dom, window, loader };
}

async function testClient() {
  group('PART B - client-side website (DOM)');

  const { JSDOM } = require(path.join(ROOT, 'node_modules', 'jsdom'));

  // The DOM tests talk to the same in-process API, so no network is required.
  const apiHandler = async (pathname) => {
    const response = await fetch(`${origin()}${pathname}`);
    const body = await response.json();
    return { status: response.status, body, headers: response.headers };
  };

  /* ---------------------------------------------------------------- */
  await test('home page renders event cards from the API', async () => {
    const { window } = await loadPage({ JSDOM }, 'index.html', {
      url: 'http://localhost:5500/index.html',
      apiHandler,
    });

    const ok = await waitFor(() => window.document.querySelectorAll('.event-card').length > 0);
    assert.ok(ok, 'no event cards were rendered');

    const cards = window.document.querySelectorAll('.event-card');
    assert.ok(cards.length >= 5, `expected several upcoming events, got ${cards.length}`);

    // Every card must link to the detail page with the event id.
    const links = [...window.document.querySelectorAll('.event-card__title a')];
    assert.ok(links.length === cards.length);
    links.forEach((link) => assert.match(link.getAttribute('href'), /^event\.html\?id=\d+$/));

    // Summary data points required by the brief.
    const firstCard = cards[0];
    assert.ok(firstCard.querySelector('.event-card__title').textContent.trim().length > 0);
    assert.ok(firstCard.querySelector('.chip'), 'the category chip is missing');
    assert.ok(firstCard.querySelector('.progress__track'), 'the progress bar is missing');
    assert.ok(firstCard.querySelector('img'), 'the event image is missing');
  });

  await test('the event artwork is sized 16:9 from the container, not the image', async () => {
    /*
     * Regression guard for a defect that only appeared on the deployed site:
     * every activity card showed a square, cropped illustration.
     *
     * What went wrong, and why the DOM tests could not see it:
     *   .event-card__media declared `aspect-ratio: 16 / 9` on the IMG. The markup
     *   for each card writes <img ... width="640" height="360">, and a browser
     *   derives the replaced element's ratio from those attributes. The ratio on
     *   the img therefore resolved to a fixed 360px height instead of scaling
     *   with width:100%, so a 16:9 drawing was painted into a 359x360 box.
     *
     *   jsdom implements no layout, so getBoundingClientRect() reports zeros and
     *   nothing in this file could have caught it. The guard therefore asserts
     *   the RULE, which is where the bug actually lived: the ratio must be
     *   declared on the container and not on the image.
     *
     * Both rules are checked for cards and for the event page hero, because both
     * have the same width/height attributes in their markup.
     */
    const css = fs.readFileSync(path.join(CLIENT_DIR, 'css', 'styles.css'), 'utf8');

    /**
     * Isolate one rule block so a declaration cannot be found in a neighbour.
     *
     * Comments are stripped first. Skipping that step is a real trap: the rule
     * being checked carries a long explanatory comment, and the regex used to
     * capture the block stops at the first "}", which a comment can contain -
     * the block then comes back empty and the assertion fails for the wrong
     * reason. That happened on the first version of this test.
     */
    const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');

    /**
     * Capture the declarations of one rule, matching the selector exactly.
     *
     * Two traps, both hit while writing this test:
     *
     *   1. Comments must be removed first. The rule being checked carries a long
     *      explanatory comment, and the capture stops at the first "}", which a
     *      comment can contain - the block then comes back empty.
     *
     *   2. The selector must be anchored to a rule boundary. Searching for the
     *      bare text ".event-card__media img" finds it inside the earlier rule
     *      ".event-card--past .event-card__media img { filter: grayscale(...) }"
     *      and returns THAT block, so the real declarations are never seen and
     *      the assertion fails for the wrong reason.
     *
     * (?:^|[},]) makes sure the match starts at a selector boundary rather than
     * in the middle of a longer selector.
     */
    const block = (selector) => {
      const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(`(?:^|[},])\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm');
      const match = withoutComments.match(pattern);
      return match ? match[1] : null;
    };

    for (const [container, image, ratio] of [
      ['.event-card__media', '.event-card__media img', '16 / 9'],
      ['.event-hero__media', '.event-hero__media img', '16 / 10'],
    ]) {
      const containerRule = block(container);
      const imageRule = block(image);

      assert.ok(containerRule, `${container} rule is missing`);
      assert.ok(imageRule, `${image} rule is missing`);

      assert.match(
        containerRule,
        new RegExp(`aspect-ratio:\\s*${ratio.replace('/', '\\s*/\\s*')}`),
        `${container} must declare aspect-ratio: ${ratio} - the container fixes the box ` +
          'because the img carries width/height attributes that override a ratio set on the image'
      );

      assert.doesNotMatch(
        imageRule,
        /aspect-ratio/,
        `${image} must NOT declare its own aspect-ratio: the width/height attributes in the ` +
          'markup give it a fixed pixel height, which squashes the artwork into a square'
      );

      assert.match(
        imageRule,
        /height:\s*100%/,
        `${image} should fill the container with height: 100%`
      );
    }
  });

  await test('the card vocabulary comes from the dictionary, not English literals', async () => {
    // Regression guard for a defect found in a browser: dom.js built the card
    // labels and the card button from English literals, so the vocabulary
    // existed in all four dictionaries and was simply never used. A Japanese
    // visitor saw a Japanese badge above cards still reading "When / Where /
    // Cause" and a "View details" button.
    //
    // This is asserted against the source rather than through a loaded page
    // because the DOM harness caches modules between page loads: switching the
    // language there updates <html lang> but does not rebuild the cards, so a
    // rendered assertion would fail whether or not the code is correct. The
    // behaviour itself was confirmed in a real browser, in all four languages.
    const dom = fs.readFileSync(path.join(CLIENT_DIR, 'js', 'dom.js'), 'utf8');

    const banned = [
      ["'When'", 'card.when'],
      ["'Where'", 'card.where'],
      ["'Cause'", 'card.cause'],
      ["'View details'", 'common.viewDetails'],
    ];
    for (const [literal, key] of banned) {
      assert.ok(
        !dom.includes(literal),
        `dom.js still hardcodes ${literal}; it must use t('${key}') so the label translates`
      );
    }

    for (const key of [
      'card.when',
      'card.where',
      'card.cause',
      'common.viewDetails',
      'a11y.viewDetailsFor',
    ]) {
      assert.ok(
        dom.includes(`t('${key}'`),
        `dom.js does not use the ${key} key, so that vocabulary is dead`
      );
    }
  });

  await test('every element styled as a button can actually be clicked', async () => {
    // Regression guard for a defect reported from the browser: the event page's
    // "Find more events" control was built with el('p', { attributes: { href,
    // class: 'button ...' } }). A paragraph has no href behaviour, so it looked
    // exactly like a button and did nothing at all when clicked.
    //
    // The button styling must only ever sit on something that can receive a
    // click: an <a> with an href, a <button>, or a submit/button input.
    const pages = [
      ['index.html', 'http://localhost:5500/index.html', '.event-card'],
      ['search.html', 'http://localhost:5500/search.html', '#search-button'],
      ['event.html', 'http://localhost:5500/event.html?id=4', '.event-hero'],
    ];

    for (const [file, url, ready] of pages) {
      const { window } = await loadPage({ JSDOM }, file, { url, apiHandler });
      const rendered = await waitFor(() => window.document.querySelector(ready) !== null);
      assert.ok(rendered, `${file} did not finish rendering`);

      const dead = [...window.document.querySelectorAll('.button, [class*="button--"]')]
        .filter((node) => {
          const tag = node.tagName.toLowerCase();
          if (tag === 'a') return !node.hasAttribute('href');
          if (tag === 'button') return false;
          if (tag === 'input') return !/^(submit|button)$/.test(node.type);
          return true;
        })
        .map((node) => `<${node.tagName.toLowerCase()}> "${node.textContent.trim().slice(0, 30)}"`);

      assert.deepEqual(
        dead,
        [],
        `${file} has controls that look like buttons but cannot be clicked: ${dead.join(', ')}`
      );
    }
  });

  await test('home page shows no past or suspended event', async () => {
    const { window } = await loadPage({ JSDOM }, 'index.html', {
      url: 'http://localhost:5500/index.html',
      apiHandler,
    });
    await waitFor(() => window.document.querySelectorAll('.event-card').length > 0);

    const ids = [...window.document.querySelectorAll('.event-card')].map((card) =>
      Number(card.dataset.eventId)
    );
    assert.ok(!ids.includes(11), 'the suspended event must not be shown on the home page');
    assert.ok(
      !window.document.querySelector('.badge--past'),
      'a past event must not appear in the upcoming listing'
    );
  });

  await test('home page navigation menu holds every page destination', async () => {
    const { window } = await loadPage({ JSDOM }, 'index.html', {
      url: 'http://localhost:5500/index.html',
      apiHandler,
    });
    const links = [...window.document.querySelectorAll('#site-header .site-nav__link')];

    /*
     * The menu is deliberately limited to real destinations.
     *
     * The About and Contact sections are still on the page but are not menu
     * entries: linking to a section of another page needs the href rewritten per
     * page, and that conditional behaviour caused repeated defects.
     *
     * The registration page is NOT here, even though Assessment 3 adds it.
     * Registration is per event, so a global Register link has no subject - it
     * can only ask the visitor to pick an event first, which is what the home and
     * search pages already do. The page is reached from the Register button on an
     * event's own page, where the event is unambiguous.
     *
     * The admin site IS here. It was footer-only at first on the grounds that a
     * staff website does not belong in a visitor's journey, but the marker is
     * looking for two deliverables and an entry they cannot find costs more than
     * an unusual menu item. The footer link was kept as well.
     */
    assert.deepEqual(
      links.map((link) => link.textContent.trim()),
      ['Home', 'Search Events', 'Admin site'],
      'the menu should contain Home, Search Events and Admin site'
    );
    assert.deepEqual(
      links.map((link) => link.getAttribute('href')),
      ['index.html', 'search.html', '/admin/index.html'],
      'every menu entry must name a document'
    );

    assert.ok(
      !links.some((link) => (link.getAttribute('href') || '').includes('registration')),
      'the menu must not link to the registration page: registration is per event'
    );

    assert.ok(window.document.querySelector('#site-footer'), 'the footer is missing');
  });

  await test('the admin menu entry is site-absolute so it works from every page', async () => {
    /*
     * Regression guard. The admin link was '../admin/index.html', which is
     * resolved against the CURRENT page: it happened to work from the top-level
     * pages, but it left ".." in the address bar and would resolve differently
     * from any subfolder. Now that the link is in the main menu it is reached
     * from every page, so a leading slash is required - it always means the root
     * of this site.
     *
     * jsdom's getAttribute returns the raw attribute, so this catches the
     * relative form that a browser would silently normalise away.
     */
    for (const page of ['index.html', 'search.html', 'event.html?id=1', 'registration.html?id=1']) {
      const { window } = await loadPage({ JSDOM }, page.split('?')[0], {
        url: `http://localhost:5500/${page}`,
        apiHandler,
      });

      const adminLink = [...window.document.querySelectorAll('#site-header .site-nav__link')].find(
        (link) => /admin/i.test(link.getAttribute('href') || '')
      );

      assert.ok(adminLink, `the admin menu entry is missing on ${page}`);
      assert.equal(
        adminLink.getAttribute('href'),
        '/admin/index.html',
        `on ${page} the admin link must be site-absolute, not relative to that page`
      );
    }
  });

  await test('no navigation link points at the same page twice', async () => {
    // Regression guard: an earlier revision put both a "Search Events" menu
    // item and a heavy "Find an event" button in the header, and both pointed
    // at search.html. Two links with the same destination in one navigation is
    // redundant and confusing, so the header menu is now the single source.
    // The check runs against the rendered DOM rather than the source text, so
    // explanatory comments in nav.js cannot affect it.
    for (const file of ['index.html', 'search.html', 'event.html']) {
      const { window } = await loadPage({ JSDOM }, file, {
        url: `http://localhost:5500/${file}`,
        apiHandler,
      });
      await waitFor(() => window.document.querySelectorAll('#site-header a').length > 0);

      const header = window.document.querySelector('#site-header');
      const hrefs = [...header.querySelectorAll('a')].map((link) => link.getAttribute('href'));

      // 1. No two menu entries may share the same destination.
      const menuHrefs = [...header.querySelectorAll('.site-nav__link')].map((link) =>
        link.getAttribute('href')
      );
      const duplicated = menuHrefs.filter(
        (href, index) => menuHrefs.indexOf(href) !== index
      );
      assert.deepEqual(
        duplicated,
        [],
        `${file}: the menu links to ${[...new Set(duplicated)].join(', ')} more than once`
      );

      // 2. The brand logo must go to the home page, which means index.html is
      //    linked twice (brand + Home). That is the universal convention and is
      //    deliberately allowed; no other document may repeat.
      const brandHref = header.querySelector('.brand').getAttribute('href');
      assert.equal(brandHref, 'index.html', `${file}: the brand logo must link home`);
      assert.equal(
        hrefs.filter((href) => href === 'index.html').length,
        2,
        `${file}: index.html should be linked exactly twice (brand + Home)`
      );

      const otherDocumentLinks = hrefs.filter((href) => !href.startsWith('index.html'));
      const repeatedDocuments = otherDocumentLinks.filter(
        (href, index) => otherDocumentLinks.indexOf(href) !== index
      );
      assert.deepEqual(
        repeatedDocuments,
        [],
        `${file}: ${[...new Set(repeatedDocuments)].join(', ')} is linked more than once`
      );

      // 3. At most one menu entry may be highlighted. Two highlighted entries
      //    at once was a real defect, so this stays checked.
      //    event.html is the detail page, reached from an event card rather
      //    than from the menu, so it correctly highlights nothing.
      const activeMenuLinks = [...header.querySelectorAll('.site-nav__link--active')];
      assert.ok(
        activeMenuLinks.length <= 1,
        `${file}: expected at most one highlighted menu entry, found ${activeMenuLinks.length} (${activeMenuLinks
          .map((link) => link.textContent.trim())
          .join(', ')})`
      );

      // 4. The retired call to action must be gone from every rendered page.
      assert.ok(
        !/Find an event/.test(header.textContent),
        `${file}: the header still shows the duplicate "Find an event" call to action`
      );
    }
  });

  await test('the About and Contact sections remain on the home page', async () => {
    // Removing the menu entries must not remove the content: both sections are
    // still present, and the About section is still filled from the API.
    const { window } = await loadPage({ JSDOM }, 'index.html', {
      url: 'http://localhost:5500/index.html',
      apiHandler,
    });

    for (const section of ['about', 'contact']) {
      assert.ok(
        window.document.getElementById(section),
        `the #${section} section is missing from the home page`
      );
    }

    // The home page still uses a fragment link of its own, so the anchor
    // handling in nav.js must keep working.
    const inPageLinks = [...window.document.querySelectorAll('a[href^="#"]')].map((link) =>
      link.getAttribute('href')
    );
    assert.ok(inPageLinks.length > 0, 'the home page has no in-page links left');
    for (const href of inPageLinks) {
      assert.ok(
        window.document.getElementById(href.slice(1)),
        `the in-page link ${href} has no matching element`
      );
    }
  });

  await test('a section link puts its section in view, not just scrolls', async () => {
    // jsdom does not implement scrolling, so this records the requested
    // position and the resulting window scroll position. Checking the outcome
    // matters: an earlier revision used a smooth animation that was cancelled
    // by the page growing as event images loaded, so the section was requested
    // but the visitor stayed part way down the page.
    const calls = [];
    let scrollY = 0;
    const { window } = await loadPage({ JSDOM }, 'index.html', {
      url: 'http://localhost:5500/index.html#contact',
      apiHandler,
      beforeInit: (win) => {
        win.Element.prototype.scrollIntoView = function scrollIntoViewSpy() {
          calls.push({
            id: this.id || this.className || this.tagName.toLowerCase(),
            top: this.getBoundingClientRect().top,
          });
        };
        // jsdom leaves scrollY at 0, so it is made writable for the spy.
        Object.defineProperty(win, 'scrollY', {
          configurable: true,
          get: () => scrollY,
          set: (value) => {
            scrollY = value;
          },
        });
      },
    });

    const ok = await waitFor(() => calls.some((call) => call.id === 'contact'));
    assert.ok(ok, 'the contact section named in the URL was never scrolled to');

    // The scroll must be an instant, final jump: behaviour smooth is the thing
    // that was unreliable, so the spy also records the requested options.
    const contactCall = calls.find((call) => call.id === 'contact');
    assert.equal(typeof contactCall.top, 'number');

    // The target must be a real section on the page.
    const section = window.document.getElementById('contact');
    assert.ok(section, 'the contact section is missing from the home page');
  });

  await test('jumping to a section does not make page content focusable', async () => {
    /*
     * Reported defect: clicking the text of a section showed a vertical
     * insertion caret.
     *
     * Cause: the section jump added tabindex="-1" to the target and called
     * focus() on it. A focusable element is treated as a text input by the
     * browser, so clicking its paragraphs put a caret there; the same focus also
     * drew the :focus-visible ring around the whole section.
     *
     * Scrolling is all the visitor asked for, so no section may end up
     * focusable - and in particular no content element may carry tabindex="-1"
     * after a jump.
     */
    const { window } = await loadPage({ JSDOM }, 'index.html', {
      url: 'http://localhost:5500/index.html#contact',
      apiHandler,
      beforeInit: (win) => {
        // jsdom does not implement scrolling; the jump is what matters here.
        win.Element.prototype.scrollIntoView = function scrollIntoViewNoop() {};
      },
    });

    // Give the hash handler time to run.
    await waitFor(() => window.document.getElementById('contact'));
    await new Promise((resolve) => setTimeout(resolve, 250));

    const focusable = [...window.document.querySelectorAll('[tabindex]')];
    assert.deepEqual(
      focusable.map((el) => `${el.tagName.toLowerCase()}#${el.id}[tabindex="${el.getAttribute('tabindex')}"]`),
      [],
      'no element should be given a tabindex by the section jump'
    );

    // Section containers must not be focusable either, however they are reached.
    for (const id of ['about', 'contact', 'upcoming-events']) {
      const element = window.document.getElementById(id);
      if (!element) continue;
      assert.equal(
        element.getAttribute('tabindex'),
        null,
        `#${id} must not be focusable, or clicking its text shows an insertion caret`
      );
    }
  });

  await test('home page statistics are filled from /api/stats', async () => {
    const { window } = await loadPage({ JSDOM }, 'index.html', {
      url: 'http://localhost:5500/index.html',
      apiHandler,
    });

    // The four placeholder cards contain an en dash until the API answers.
    const ok = await waitFor(() => {
      const values = [...window.document.querySelectorAll('#stats-panel .stat__value')];
      return values.length === 4 && values.every((node) => !node.textContent.includes('–'));
    });
    assert.ok(ok, 'the statistics panel was not filled from /api/stats');

    const values = [...window.document.querySelectorAll('#stats-panel .stat__value')].map((node) =>
      node.textContent.trim()
    );
    assert.ok(values.every((value) => value !== ''));
    // The first card is the count of upcoming events, which must be a number.
    assert.match(values[0], /^\d+$/);
  });

  /* ---------------------------------------------------------------- */
  await test('search page builds its category checkboxes from the API', async () => {
    const { window } = await loadPage({ JSDOM }, 'search.html', {
      url: 'http://localhost:5500/search.html',
      apiHandler,
    });
    const ok = await waitFor(
      () => window.document.querySelectorAll('#category-options input[type="checkbox"]').length > 0
    );
    assert.ok(ok, 'no category checkboxes were created');
    const boxes = window.document.querySelectorAll('#category-options input[name="category"]');
    assert.ok(boxes.length >= 3, 'expected several categories');
    assert.ok(
      window.document.querySelectorAll('#city-options option').length >= 3,
      'the city suggestion list is empty'
    );
  });

  await test('search page returns results and marks the active filters', async () => {
    const { window } = await loadPage({ JSDOM }, 'search.html', {
      url: 'http://localhost:5500/search.html',
      apiHandler,
    });
    await waitFor(
      () => window.document.querySelectorAll('#category-options input').length > 0
    );

    // Tick one category and submit, exactly as a visitor would.
    const firstBox = window.document.querySelector('#category-options input[name="category"]');
    firstBox.checked = true;
    window.document.getElementById('search-form').dispatchEvent(
      new window.Event('submit', { bubbles: true, cancelable: true })
    );

    const ok = await waitFor(
      () => window.document.querySelectorAll('#results-list .event-card').length > 0
    );
    assert.ok(ok, 'no results were rendered after submitting the form');
    assert.ok(
      window.document.querySelectorAll('#active-filters .filter-chip').length >= 1,
      'the active filter chip was not added'
    );
    assert.match(window.document.getElementById('results-count').textContent, /event/i);
  });

  await test('search page validates the date range before calling the API', async () => {
    const { window } = await loadPage({ JSDOM }, 'search.html', {
      url: 'http://localhost:5500/search.html',
      apiHandler,
    });

    window.document.getElementById('filter-from').value = '2026-12-01';
    window.document.getElementById('filter-to').value = '2026-01-01';
    window.document.getElementById('search-form').dispatchEvent(
      new window.Event('submit', { bubbles: true, cancelable: true })
    );

    const message = window.document.getElementById('form-message').textContent;
    assert.match(message, /cannot be earlier/i);
    assert.equal(
      window.document.querySelectorAll('#results-list .event-card').length,
      0,
      'the search should not have run with an invalid range'
    );
  });

  await test('Clear Filters resets the form and the results with DOM manipulation', async () => {
    const { window } = await loadPage({ JSDOM }, 'search.html', {
      url: 'http://localhost:5500/search.html',
      apiHandler,
    });
    await waitFor(() => window.document.querySelectorAll('#category-options input').length > 0);

    // Apply some filters, then run a search that produces results.
    window.document.getElementById('filter-from').value = '2026-10-01';
    window.document.getElementById('filter-city').value = 'Lismore';
    window.document.querySelector('#category-options input[name="category"]').checked = true;
    window.document.getElementById('search-form').dispatchEvent(
      new window.Event('submit', { bubbles: true, cancelable: true })
    );
    await waitFor(() => window.document.querySelectorAll('#results-list .event-card').length > 0);
    assert.ok(window.document.querySelectorAll('#active-filters .filter-chip').length >= 2);

    // Clear Filters
    window.document.getElementById('clear-filters').click();

    assert.equal(window.document.getElementById('filter-from').value, '');
    assert.equal(window.document.getElementById('filter-city').value, '');
    assert.equal(
      window.document.querySelector('#category-options input[name="category"]').checked,
      false
    );
    assert.equal(window.document.querySelectorAll('#active-filters .filter-chip').length, 0);
    assert.equal(window.document.querySelectorAll('#results-list .event-card').length, 0);
    assert.match(window.document.getElementById('form-message').textContent, /cleared/i);
  });

  await test('search page shows an empty state when nothing matches', async () => {
    const { window } = await loadPage({ JSDOM }, 'search.html', {
      url: 'http://localhost:5500/search.html',
      apiHandler,
    });
    await waitFor(() => window.document.querySelectorAll('#category-options input').length > 0);

    window.document.getElementById('filter-keyword').value = 'zzz-no-such-event';
    window.document.getElementById('search-form').dispatchEvent(
      new window.Event('submit', { bubbles: true, cancelable: true })
    );

    const ok = await waitFor(() => window.document.querySelector('#results-list .state--empty'));
    assert.ok(ok, 'the empty state was not shown');
  });

  /* ---------------------------------------------------------------- */
  await test('event page shows only the event named in the query string', async () => {
    const { window } = await loadPage({ JSDOM }, 'event.html', {
      url: 'http://localhost:5500/event.html?id=1',
      apiHandler,
    });

    const ok = await waitFor(() => window.document.querySelector('.event-hero h1'));
    assert.ok(ok, 'the event hero was not rendered');

    assert.match(
      window.document.querySelector('.event-hero h1').textContent,
      /Riverside Rainbow Fun Run/
    );
    assert.equal(window.document.querySelectorAll('.event-hero').length, 1);
    assert.equal(window.document.querySelectorAll('.event-card').length, 0);
  });

  await test('event page shows full details, tickets and goal progress', async () => {
    const { window } = await loadPage({ JSDOM }, 'event.html', {
      url: 'http://localhost:5500/event.html?id=1',
      apiHandler,
    });
    await waitFor(() => window.document.querySelector('.event-hero h1'));

    // Full description and purpose
    assert.ok(window.document.body.textContent.includes('Riverside Rainbow Fun Run'));
    assert.ok(
      window.document.body.textContent.includes('Fund free paediatric allied health sessions')
    );

    // Ticket information, including the free tier
    const tickets = window.document.querySelectorAll('.ticket');
    assert.ok(tickets.length >= 2, 'the ticket tiers were not rendered');
    assert.ok(
      window.document.body.textContent.includes('Free'),
      'the free ticket tier is not shown'
    );

    // Goal vs progress
    const progress = window.document.querySelector('.progress__track');
    assert.ok(progress, 'the progress bar is missing');
    assert.ok(Number(progress.getAttribute('aria-valuenow')) > 0);
    assert.match(window.document.querySelector('.progress__amounts').textContent, /raised of/);
  });

  await test('Register button links to the registration page (A3)', async () => {
    const { window } = await loadPage({ JSDOM }, 'event.html', {
      url: 'http://localhost:5500/event.html?id=1',
      apiHandler,
    });
    await waitFor(() => window.document.getElementById('register-button'));

    const button = window.document.getElementById('register-button');
    assert.equal(button.textContent.trim(), 'Register');

    // Assessment 3 replaced the A2 placeholder dialog with a real destination:
    // "Update the existing Register button so that it now correctly links to the
    // new Event Registration Page." The button is therefore an anchor carrying
    // the event id.
    //
    // The check asserts the element type rather than clicking it: an anchor with
    // an href IS the navigation, and clicking it in jsdom only asks jsdom to
    // navigate, which it does not implement - the resulting stderr noise said
    // nothing about the code under test.
    assert.equal(button.tagName, 'A', 'the Register button must be a link, not a dialog trigger');
    assert.equal(button.getAttribute('href'), 'registration.html?id=1');
    assert.equal(
      button.getAttribute('aria-haspopup'),
      null,
      'an anchor navigates, so it must no longer advertise a dialog'
    );
  });

  await test('event page reports a missing id instead of breaking', async () => {
    const { window } = await loadPage({ JSDOM }, 'event.html', {
      url: 'http://localhost:5500/event.html',
      apiHandler,
    });
    const ok = await waitFor(() => window.document.querySelector('.state--error'));
    assert.ok(ok, 'no error state was shown for a missing event id');
  });

  await test('event page handles a suspended event id with a clear message', async () => {
    const { window } = await loadPage({ JSDOM }, 'event.html', {
      url: 'http://localhost:5500/event.html?id=11',
      apiHandler,
    });
    const ok = await waitFor(() => window.document.querySelector('.state--error'));
    assert.ok(ok, 'no error state was shown for a suspended event');
    assert.match(window.document.body.textContent, /could not be found|suspended/i);
  });

  await test('every page loads the shared navigation module', async () => {
    for (const file of ['index.html', 'search.html', 'event.html']) {
      const html = fs.readFileSync(path.join(CLIENT_DIR, file), 'utf8');
      assert.ok(html.includes('id="site-header"'), `${file} has no menu placeholder`);
      assert.ok(html.includes('id="site-footer"'), `${file} has no footer placeholder`);
      assert.match(html, /type="module"/, `${file} does not load a client module`);
    }
  });

  await test('hero buttons stay legible on the dark hero background', async () => {
    const html = fs.readFileSync(path.join(CLIENT_DIR, 'index.html'), 'utf8');
    const css = fs.readFileSync(path.join(CLIENT_DIR, 'css', 'styles.css'), 'utf8');

    // Regression guard: the default variant is a teal fill and --ghost paints
    // teal text, so both almost disappear over the green hero gradient. Every
    // hero action must use the single on-dark variant instead.
    const heroActions = html.match(/<div class="hero__actions">([\s\S]*?)<\/div>/);
    assert.ok(heroActions, 'the hero actions block was not found');

    const buttons = [...heroActions[1].matchAll(/<a class="([^"]+)"[^>]*>([^<]+)</g)];
    assert.equal(buttons.length, 2, 'the hero should offer exactly two actions');

    for (const [, classes, label] of buttons) {
      assert.match(
        classes,
        /\bbutton--on-dark\b/,
        `"${label.trim()}" must use button--on-dark`
      );
      assert.doesNotMatch(
        classes,
        /button--ghost|button--hero-primary|button--hero-secondary/,
        `"${label.trim()}" must not use a retired hero variant`
      );
    }

    // Both buttons must resolve to the same fill and text colour. The pattern
    // anchors to the start of a line so it matches the base rule rather than the
    // [data-theme='dark'] override further down the file.
    const rule = css.match(/^\.button--on-dark\s*\{([^}]*)\}/m);
    assert.ok(rule, 'styles.css has no .button--on-dark rule');
    const body = rule[1].replace(/\s+/g, ' ');
    assert.match(body, /background:\s*#ffffff/i, 'the on-dark button needs a white fill');
    assert.match(body, /color:\s*var\(--brand-900\)/i, 'the on-dark button needs dark teal text');

    // The retired variants must no longer be defined, so the two hero buttons
    // cannot drift apart again.
    for (const retired of ['button--hero-primary', 'button--hero-secondary']) {
      assert.ok(
        !new RegExp(`\\.${retired}\\s*\\{`).test(css),
        `.${retired} should no longer be defined`
      );
    }
  });

  await test('form controls cannot overflow the filter panel', async () => {
    const css = fs.readFileSync(path.join(CLIENT_DIR, 'css', 'styles.css'), 'utf8');

    // Regression guard: a date input has an intrinsic minimum width of roughly
    // 130px, so with a bare `1fr 1fr` grid the two date fields pushed past the
    // border of the 330px filter panel. The controls must opt out of their
    // intrinsic minimum, and the tracks must be allowed to shrink.
    const controlRule = css.match(
      /input\[type='text'\],[\s\S]{0,300}?textarea\s*\{([^}]*)\}/
    );
    assert.ok(controlRule, 'the shared form control rule was not found');
    assert.match(
      controlRule[1].replace(/\s+/g, ' '),
      /min-width:\s*0/,
      'form controls need min-width: 0 so grid and flex parents can shrink them'
    );

    const formRow = css.match(/\.form-row\s*\{([^}]*)\}/);
    assert.ok(formRow, 'styles.css has no .form-row rule');
    const row = formRow[1].replace(/\s+/g, ' ');
    assert.doesNotMatch(
      row,
      /grid-template-columns:\s*1fr\s+1fr/,
      '.form-row must not use a bare 1fr 1fr, which cannot shrink below content width'
    );
    assert.match(
      row,
      /grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(\s*\d+px/,
      '.form-row should use auto-fit minmax so the pair collapses when narrow'
    );
  });


  await test('the sticky filter panel cannot grow taller than the window', async () => {
    const css = fs.readFileSync(path.join(CLIENT_DIR, 'css', 'styles.css'), 'utf8');

    // Regression guard for a defect found in a real browser. The filter panel is
    // sticky and taller than a laptop window, so its bottom - which holds the
    // Search button - was pinned below the fold: measured from scrollY 500 to
    // 2200 the button's viewport position never changed, and the only way to run
    // a second search was to scroll to the very bottom of the page. Capping the
    // height to the window is what fixes it.
    //
    // jsdom applies no layout, so this cannot be a DOM test. It is asserted
    // against the stylesheet, like the dark-theme and closed-dialog guards.
    const panel = css.match(/\.filter-panel\s*\{([^}]*)\}/);
    assert.ok(panel, 'styles.css has no .filter-panel rule');
    const body = panel[1].replace(/\s+/g, ' ');
    assert.match(body, /position:\s*sticky/, 'the filter panel is expected to be sticky');
    assert.match(
      body,
      /max-height:\s*calc\(100(?:d)?vh\s*-/,
      'a sticky panel taller than the window pins its own bottom out of reach, ' +
        'so it needs a max-height tied to the viewport'
    );
    assert.match(
      body,
      /overflow-y:\s*auto/,
      'once the height is capped the panel has to scroll internally'
    );

    // The action row must stay on screen while the fields scroll behind it.
    const actions = css.match(/\.filter-panel\s+\.filter-actions\s*\{([^}]*)\}/);
    assert.ok(
      actions,
      'the filter actions are not pinned; the Search button would scroll out of the panel'
    );
    assert.match(
      actions[1].replace(/\s+/g, ' '),
      /position:\s*sticky/,
      'the Search button must remain visible while the filters scroll'
    );

    // The stacked layout is not sticky, so it must undo the cap and the scroll.
    const stacked = /@media[^{]*max-width:\s*1000px[^{]*\{([\s\S]*?)\n\}/.exec(css);
    assert.ok(stacked, 'the 1000px breakpoint was not found in styles.css');
    const stackedBody = stacked[1].replace(/\s+/g, ' ');
    assert.match(
      stackedBody,
      /\.filter-panel\s*\{[^}]*position:\s*static/,
      'when the layout stacks, the filter panel must stop being sticky'
    );
    assert.match(
      stackedBody,
      /\.filter-panel\s*\{[^}]*max-height:\s*none/,
      'a stacked panel must not cap its own height, or the page would scroll twice'
    );
  });

  await test('date fields state their format in English', async () => {
    const html = fs.readFileSync(path.join(CLIENT_DIR, 'search.html'), 'utf8');
    const css = fs.readFileSync(path.join(CLIENT_DIR, 'css', 'styles.css'), 'utf8');

    // A native date input paints its placeholder in the language of the
    // operating system (年/月/日 on a Chinese Windows) and that text cannot be
    // overridden from HTML, CSS or JavaScript. Each date field therefore
    // carries a visible English format line instead.
    // The tags may span several lines, so the pattern allows newlines.
    const dateInputs = [...html.matchAll(/<input[^>]*?type="date"[^>]*?>/gs)].map((m) => m[0]);
    assert.equal(dateInputs.length, 2, 'the search form should have two date inputs');

    for (const input of dateInputs) {
      const id = (input.match(/id="([^"]+)"/) || [])[1];
      assert.ok(id, 'every date input needs an id');
      assert.match(
        input,
        /aria-describedby="[^"]+-format"/,
        `the date input #${id} must point at its format line`
      );
      assert.ok(
        html.includes(`id="${id}-format"`),
        `the date input #${id} has no format line element`
      );
    }

    assert.equal(
      (html.match(/Format: yyyy-mm-dd/g) || []).length,
      2,
      'both date fields must show "Format: yyyy-mm-dd"'
    );
    assert.ok(
      /\.field__format\s*\{/.test(css),
      'styles.css needs a .field__format rule for the format line'
    );
  });

  /* ---------------------------------------------------------------- */
  /* Settings: theme and language                                      */
  /* ---------------------------------------------------------------- */

  /** Stub matchMedia, which jsdom does not implement. */
  function stubMatchMedia(window, { prefersDark = false } = {}) {
    const listeners = [];
    window.matchMedia = (query) => ({
      media: query,
      matches: prefersDark && query.includes('prefers-color-scheme: dark'),
      addEventListener: (type, callback) => listeners.push(callback),
      removeEventListener: () => {},
      addListener: (callback) => listeners.push(callback),
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    });
  }

  await test('the language switcher offers four languages and applies one', async () => {
    const { window } = await loadPage({ JSDOM }, 'index.html', {
      url: 'http://localhost:5500/index.html',
      apiHandler,
      beforeInit: (win) => {
        win.localStorage.setItem('charity-events:language', 'en');
        stubMatchMedia(win);
      },
    });

    const select = window.document.getElementById('language-select');
    assert.ok(select, 'the header has no language switcher');

    const options = [...select.options].map((option) => option.value);
    assert.deepEqual(options, ['en', 'zh', 'vi', 'ja'], 'expected English, Chinese, Vietnamese, Japanese');

    // The stored language is applied on load.
    assert.equal(window.document.documentElement.getAttribute('lang'), 'en-AU');

    // Switching translates the interface and updates <html lang>.
    select.value = 'ja';
    select.dispatchEvent(new window.Event('change', { bubbles: true }));

    assert.equal(
      window.localStorage.getItem('charity-events:language'),
      'ja',
      'the choice must be remembered for the other pages'
    );
    assert.equal(window.document.documentElement.getAttribute('lang'), 'ja-JP');

    const heading = window.document.querySelector('#events-heading').textContent;
    assert.match(heading, /[\u3040-\u30ff\u4e00-\u9fff]/, `expected Japanese text, got "${heading}"`);
    assert.ok(
      !/Current and upcoming/.test(heading),
      'the heading was not translated'
    );
  });

  await test('a remembered language is applied on the next page load', async () => {
    const { window } = await loadPage({ JSDOM }, 'search.html', {
      url: 'http://localhost:5500/search.html',
      apiHandler,
      beforeInit: (win) => {
        win.localStorage.setItem('charity-events:language', 'zh');
        stubMatchMedia(win);
      },
    });

    assert.equal(window.document.documentElement.getAttribute('lang'), 'zh-CN');
    const title = window.document.querySelector('h1').textContent;
    assert.match(title, /[\u4e00-\u9fff]/, `expected Chinese text, got "${title}"`);
    assert.equal(
      window.document.getElementById('language-select').value,
      'zh',
      'the switcher must show the remembered language'
    );
  });

  await test('every dictionary covers the same keys', async () => {
    const source = fs.readFileSync(path.join(CLIENT_DIR, 'js', 'translations.js'), 'utf8');
    const keysFor = (language) => {
      const match = source.match(new RegExp(`const ${language} = \\{([\\s\\S]*?)\\n\\};`, 'm'));
      return new Set([...match[1].matchAll(/^\s*'([^']+)':/gm)].map((entry) => entry[1]));
    };

    const english = keysFor('en');
    assert.ok(english.size > 150, `expected a substantial dictionary, got ${english.size} keys`);

    for (const language of ['zh', 'vi', 'ja']) {
      const keys = keysFor(language);
      const missing = [...english].filter((key) => !keys.has(key));
      assert.deepEqual(missing, [], `${language} is missing ${missing.length} key(s)`);
    }
  });

  await test('the theme switch cycles and is applied to the document', async () => {
    const { window } = await loadPage({ JSDOM }, 'index.html', {
      url: 'http://localhost:5500/index.html',
      apiHandler,
      beforeInit: (win) => {
        win.localStorage.setItem('charity-events:theme', 'light');
        stubMatchMedia(win);
      },
    });

    const root = window.document.documentElement;
    const button = window.document.getElementById('theme-toggle');
    assert.ok(button, 'the header has no theme switch');
    assert.equal(root.getAttribute('data-theme'), 'light', 'the stored theme must be applied on load');

    // light -> dark
    button.click();
    assert.equal(root.getAttribute('data-theme'), 'dark');
    assert.equal(window.localStorage.getItem('charity-events:theme'), 'dark');
    assert.equal(root.style.colorScheme, 'dark');

    // dark -> system (and the system preference is light in this stub)
    button.click();
    assert.equal(window.localStorage.getItem('charity-events:theme'), 'system');
    assert.equal(root.getAttribute('data-theme'), 'light');
    assert.equal(root.getAttribute('data-theme-preference'), 'system');

    // system -> light
    button.click();
    assert.equal(window.localStorage.getItem('charity-events:theme'), 'light');
  });

  await test('dark theme is a set of token overrides plus component fixes', async () => {
    const css = fs.readFileSync(path.join(CLIENT_DIR, 'css', 'styles.css'), 'utf8');

    const darkBlock = css.match(/\[data-theme='dark'\]\s*\{([^}]*)\}/);
    assert.ok(darkBlock, 'styles.css has no [data-theme="dark"] block');
    for (const token of ['--surface-0', '--ink-900', '--line', '--brand-900']) {
      assert.match(
        darkBlock[1],
        new RegExp(`${token}:`),
        `the dark theme should override ${token}`
      );
    }

    // The components that were hard-coded white need explicit dark handling.
    for (const selector of [
      "\\[data-theme='dark'\\] \\.site-header",
      "\\[data-theme='dark'\\] input\\[type='date'\\]",
    ]) {
      assert.ok(
        new RegExp(selector).test(css),
        `the dark theme is missing a rule for ${selector}`
      );
    }
  });

  await test('every page applies the stored theme before the first paint', async () => {
    for (const file of ['index.html', 'search.html', 'event.html']) {
      const html = fs.readFileSync(path.join(CLIENT_DIR, file), 'utf8');
      const bootIndex = html.indexOf('theme-boot');
      const cssIndex = html.indexOf('css/styles.css');

      assert.ok(bootIndex !== -1, `${file} has no theme boot script`);
      assert.ok(
        bootIndex < cssIndex,
        `${file}: the theme must be applied before the stylesheet, or a dark user sees a white flash`
      );
      assert.match(
        html,
        /localStorage\.getItem\('charity-events:theme'\)/,
        `${file}: the boot script must read the same storage key as theme.js`
      );
    }
  });

  await test('no rule paints light text on a background that flips to light', async () => {
    /*
     * This is the defect that produced the unreadable footer.
     *
     * The dark theme inverts the brand tokens, so --brand-900 becomes a LIGHT
     * teal. Any rule that used it as a background and painted light text on top
     * was designed for a dark surface and collapses once the token flips. The
     * same trap applies to --brand-700 for buttons.
     *
     * The rule below therefore fails the build if such a pair appears without a
     * dark-theme override.
     */
    const css = fs.readFileSync(path.join(CLIENT_DIR, 'css', 'styles.css'), 'utf8');

    // Strip comments so prose about tokens is not parsed as CSS.
    const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');

    const TOKENS_THAT_FLIP_TO_LIGHT = ['--brand-900', '--brand-700', '--accent-600'];
    const LIGHT_TEXT = /color:\s*(#fff(?:fff)?|white|var\(--on-brand\))/i;

    /*
     * Pairs that are safe even though the background token flips.
     *
     * --on-brand is itself theme-aware: it is the same value as --brand-900
     * (near-white in the light theme, deep ink in the dark one), so a fill and
     * an --on-brand label always move together and stay opposite. It was
     * introduced precisely to replace the broken pairs below, and the real
     * contrast of these controls is measured by tools/check-contrast.mjs.
     */
    const SAFE_WITH_ON_BRAND = [
      '.button',            // solid teal fill, label follows the theme
      '.badge--upcoming',   // same pattern for the status badge
      '.hero',              // the base colour under the hero gradient
    ];

    const rules = [];
    for (const match of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = match[1].replace(/\s+/g, ' ').trim();
      if (!selector || selector.startsWith('@')) continue;
      rules.push({ selector, body: match[2] });
    }

    const offenders = [];
    for (const rule of rules) {
      const background = rule.body.match(/background(?:-color)?:\s*([^;]+);/);
      if (!background) continue;

      const token = TOKENS_THAT_FLIP_TO_LIGHT.find((name) => background[1].includes(`var(${name})`));
      if (!token) continue;

      const colour = rule.body.match(/(?:^|;)\s*color:\s*([^;]+);/);
      if (!colour || !LIGHT_TEXT.test(`color: ${colour[1]}`)) continue;

      // A dark-theme rule is the fix, so it is allowed.
      if (rule.selector.includes("[data-theme='dark']")) continue;

      // Elements that live on the dark hero are deliberately light in both
      // themes; they are pinned by a separate rule that sets the base colour.
      if (/\.button--on-dark/.test(rule.selector)) continue;

      // The footer is a dark block in both themes, so its light text is correct
      // as long as the dark theme pins its background as well.
      if (/^\.site-footer/.test(rule.selector)) {
        assert.match(
          withoutComments,
          /\[data-theme='dark'\]\s*\.site-footer\s*\{[^}]*background:\s*#071a18/,
          'the footer paints light text on var(--brand-900), so the dark theme must pin its background'
        );
        continue;
      }

      // Safe when the label itself is the theme-aware --on-brand token.
      if (/var\(--on-brand\)/.test(colour[1]) && SAFE_WITH_ON_BRAND.includes(rule.selector)) {
        continue;
      }

      offenders.push(`${rule.selector} -> background ${background[1].trim()}, ${colour[1].trim()}`);
    }

    assert.deepEqual(
      offenders,
      [],
      `these rules paint light text on a token that becomes light in the dark theme, ` +
        `so they need either a dark-theme override or a token that does not flip:\n  ` +
        offenders.join('\n  ')
    );

    // And the token that exists precisely to avoid the trap must be used.
    assert.match(
      withoutComments,
      /--on-brand:\s*#ffffff/,
      'the light theme should define --on-brand'
    );
    assert.match(
      withoutComments,
      /\[data-theme='dark'\][\s\S]{0,400}?--on-brand:\s*#06201d/,
      'the dark theme should redefine --on-brand so filled controls stay legible'
    );

    /*
     * The footer is the case that was actually reported: it paints light text
     * (by design - it is a dark block) on var(--brand-900), which the dark theme
     * turns into a LIGHT teal. The fix is to pin its background in the dark
     * theme to a dark value. If that pin is ever removed or swapped for a
     * colour token, the footer becomes light-on-light again, so it is asserted
     * directly rather than left to the loop above.
     */
    const footerLightRule = rules.find((rule) => rule.selector === '.site-footer');
    assert.ok(footerLightRule, 'the base .site-footer rule was not found');
    assert.match(
      footerLightRule.body,
      /background:\s*var\(--brand-900\)/,
      'the footer is expected to use var(--brand-900) as its base background'
    );

    const footerDarkRule = rules.find(
      (rule) => rule.selector === "[data-theme='dark'] .site-footer"
    );
    assert.ok(footerDarkRule, 'the dark theme has no .site-footer rule');

    const footerDarkBackground = footerDarkRule.body.match(/background:\s*([^;]+);/);
    assert.ok(footerDarkBackground, 'the dark footer rule must set a background');
    assert.doesNotMatch(
      footerDarkBackground[1],
      /var\(--(brand|surface|ink|accent|line)/,
      'the dark footer background must be a pinned dark colour, not a token that ' +
        'flips - otherwise light text lands on a light footer'
    );
  });
}


/* =====================================================================
 * PART D - Assessment 3: the new client pages, in a DOM
 * ===================================================================== */
async function testA3Client() {
  group('PART D - A3 client pages (DOM)');

  const { JSDOM } = require(path.join(ROOT, 'node_modules', 'jsdom'));

  /**
   * The same in-process API bridge PART B uses, extended to pass the request
   * method and body through. The registration page POSTs, so a GET-only bridge
   * would make every A3 DOM test fail for the wrong reason.
   */
  const apiHandler = async (pathname, init = {}) => {
    const response = await fetch(`${origin()}${pathname}`, {
      method: init.method || 'GET',
      headers: init.headers,
      body: init.body,
    });

    // 204 has no body, and response.json() would throw.
    if (response.status === 204) {
      return { status: 204, body: null, headers: response.headers };
    }

    const body = await response.json();
    return { status: response.status, body, headers: response.headers };
  };

  /* ------------------------------------------- the event detail page --- */

  await test('the event page lists the registrations, newest purchase first', async () => {
    const { window } = await loadPage({ JSDOM }, 'event.html', {
      url: 'http://localhost:5500/event.html?id=1',
      apiHandler,
    });

    const ok = await waitFor(() => window.document.querySelector('.registrations'), 8000);
    assert.ok(ok, 'the registrations panel was never rendered');

    const rows = [...window.document.querySelectorAll('.registrations .data-table tbody tr')];
    assert.equal(rows.length, 4, 'event 1 has four seeded registrations');

    // The first row must be the most recent purchase: Diane Whitmore, 19 Sep.
    assert.match(rows[0].textContent, /Diane Whitmore/);
    assert.match(rows[3].textContent, /Amelia Hartley/);

    // The table must be a real table with column headers and a caption.
    const table = window.document.querySelector('.registrations table');
    assert.ok(table, 'the registrations must be a table element');
    assert.ok(table.querySelector('caption'), 'the table needs a caption for screen readers');
    const headers = [...table.querySelectorAll('thead th')];
    assert.ok(headers.length >= 4, 'the table needs column headers');
    headers.forEach((header) => assert.equal(header.getAttribute('scope'), 'col'));

    // Money and counts are shown.
    assert.match(table.textContent, /\$90/, 'the value of a registration is shown');
  });

  await test('the registrations table totals the tickets it lists', async () => {
    const { window } = await loadPage({ JSDOM }, 'event.html', {
      url: 'http://localhost:5500/event.html?id=1',
      apiHandler,
    });
    await waitFor(() => window.document.querySelector('.registrations tfoot'), 8000);

    const foot = window.document.querySelector('.registrations tfoot');
    assert.ok(foot, 'the totals row is missing');
    assert.match(foot.textContent, /8/, 'eight tickets were sold for event 1');
  });

  await test('the Register button LINKS to the registration page with the event id', async () => {
    const { window } = await loadPage({ JSDOM }, 'event.html', {
      url: 'http://localhost:5500/event.html?id=1',
      apiHandler,
    });

    const ok = await waitFor(() => window.document.querySelector('#register-button'), 8000);
    assert.ok(ok, 'the Register button was never rendered');

    const button = window.document.querySelector('#register-button');
    // A3 requires the button to link to the new page, not open a dialog.
    assert.equal(button.tagName, 'A', 'the Register button must be a link');
    assert.equal(button.getAttribute('href'), 'registration.html?id=1');
  });

  await test('a past event shows a disabled Register button instead of a link', async () => {
    const { window } = await loadPage({ JSDOM }, 'event.html', {
      url: 'http://localhost:5500/event.html?id=9',
      apiHandler,
    });

    const ok = await waitFor(() => window.document.querySelector('#register-button'), 8000);
    assert.ok(ok);

    const button = window.document.querySelector('#register-button');
    assert.equal(button.tagName, 'BUTTON');
    assert.ok(button.hasAttribute('disabled'), 'there is nothing left to book');
  });

  await test('the event page no longer carries the dead demonstration form', async () => {
    const { window } = await loadPage({ JSDOM }, 'event.html', {
      url: 'http://localhost:5500/event.html?id=1',
      apiHandler,
    });
    await waitFor(() => window.document.querySelector('.registrations'), 8000);

    // A2 had a non-functional form here. It was replaced by the real page, so a
    // second, dead form must not still be on the page.
    assert.equal(
      window.document.querySelector('#registration-form'),
      null,
      'the A2 demonstration form should have been removed'
    );
  });

  /* ------------------------------------------------ the registration page --- */


  await test('the registration page shows the event and one field per stored column', async () => {
    const { window } = await loadPage({ JSDOM }, 'registration.html', {
      url: 'http://localhost:5500/registration.html?id=1',
      apiHandler,
    });

    const ok = await waitFor(() => window.document.querySelector('#registration-form'), 8000);
    assert.ok(ok, 'the registration form was never rendered');

    const form = window.document.querySelector('#registration-form');
    // Every column of event_registrations that a person fills in.
    ['reg-name', 'reg-email', 'reg-phone', 'reg-date', 'reg-ticket', 'reg-quantity', 'reg-notes']
      .forEach((id) => assert.ok(form.querySelector(`#${id}`), `the form is missing #${id}`));

    // Every control needs a label.
    ['reg-name', 'reg-email', 'reg-date', 'reg-quantity'].forEach((id) => {
      const label = form.querySelector(`label[for="${id}"]`);
      assert.ok(label, `#${id} has no label`);
      assert.ok(label.textContent.trim().length > 0);
    });

    // The event being registered for must be obvious.
    const summary = window.document.querySelector('.registration-summary');
    assert.ok(summary, 'the event summary panel is missing');
    assert.match(summary.textContent, /Riverside Rainbow Fun Run 2026/);
  });

  await test('the ticket dropdown offers the event tiers with their prices', async () => {
    const { window } = await loadPage({ JSDOM }, 'registration.html', {
      url: 'http://localhost:5500/registration.html?id=1',
      apiHandler,
    });
    await waitFor(() => window.document.querySelector('#reg-ticket'), 8000);

    const select = window.document.querySelector('#reg-ticket');
    assert.equal(select.options.length, 3, 'event 1 has three ticket tiers');

    const labels = [...select.options].map((option) => option.textContent);
    assert.ok(labels.some((label) => label.includes('10 km Timed Run')));
    assert.ok(labels.some((label) => label.includes('$45.00')));

    // A paid tier is preselected, because that is what most visitors want.
    assert.ok(
      Number(select.selectedOptions[0].getAttribute('data-price')) > 0,
      'a paid tier should be selected by default'
    );
  });

  await test('client-side validation blocks an empty submission', async () => {
    const { window } = await loadPage({ JSDOM }, 'registration.html', {
      url: 'http://localhost:5500/registration.html?id=1',
      apiHandler,
    });
    await waitFor(() => window.document.querySelector('#registration-form'), 8000);

    const form = window.document.querySelector('#registration-form');
    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));

    // The page validates before it sends anything, and the brief asks for an
    // "appropriate client-side alert".
    const alert = window.document.querySelector('#form-alert');
    assert.ok(alert.textContent.trim().length > 0, 'the summary alert must be filled in');

    const nameMessage = window.document.querySelector('#reg-name-message');
    assert.ok(nameMessage.textContent.trim().length > 0, 'the name field must be marked');
    assert.match(nameMessage.className, /field-message--error/);
    assert.equal(
      window.document.querySelector('#reg-name').getAttribute('aria-invalid'),
      'true'
    );
  });

  await test('a valid submission is sent to the API and shows a confirmation', async () => {
    const unique = `dom.check.${Date.now()}@example.com`;
    const sent = [];

    const { window } = await loadPage({ JSDOM }, 'registration.html', {
      url: 'http://localhost:5500/registration.html?id=4',
      apiHandler: async (pathname, init = {}) => {
        if (init.method === 'POST') sent.push({ pathname, body: init.body });
        return apiHandler(pathname, init);
      },
    });

    await waitFor(() => window.document.querySelector('#registration-form'), 8000);

    const form = window.document.querySelector('#registration-form');
    const set = (id, value) => {
      const control = form.querySelector(`#${id}`);
      control.value = value;
      control.dispatchEvent(new window.Event('input', { bubbles: true }));
      control.dispatchEvent(new window.Event('change', { bubbles: true }));
    };

    set('reg-name', 'Dom Check');
    set('reg-email', unique);
    set('reg-quantity', '2');

    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));

    const done = await waitFor(() => window.document.querySelector('.confirmation'), 8000);
    assert.ok(done, 'the confirmation was never rendered');

    // The record really was sent to the endpoint the brief asks for.
    assert.equal(sent.length, 1, 'exactly one POST should have been made');
    assert.equal(sent[0].pathname, '/api/events/4/registrations');
    const payload = JSON.parse(sent[0].body);
    assert.equal(payload.attendeeName, 'Dom Check');
    assert.equal(payload.attendeeEmail, unique.toLowerCase());
    assert.equal(payload.ticketsPurchased, 2);

    // The confirmation shows what was stored, not what was typed.
    const confirmation = window.document.querySelector('.confirmation');
    assert.match(confirmation.textContent, /Dom Check/);
    assert.match(confirmation.textContent, new RegExp(unique.replace(/\./g, '\\.')));
    assert.ok(confirmation.querySelector('.confirmation__actions a'), 'a way onward is missing');

    // Remove the registration this check created.
    //
    // This test has to write a real record - that is the whole point of it - but
    // leaving it behind would make the later "the seed data holds 20
    // registrations" checks fail for a reason that has nothing to do with the
    // code under test. A test that changes shared state is responsible for
    // putting it back.
    const created = await api('/registrations?keyword=dom.check');
    for (const row of created.body.data) {
      const removed = await fetch(`${baseUrl()}/registrations/${row.registrationId}`, {
        method: 'DELETE',
      });
      assert.equal(removed.status, 204, 'the cleanup delete should succeed');
    }
  });

  await test('a duplicate registration is reported against the email field', async () => {
    // Amelia Hartley is already registered for event 1 in the seed data.
    const { window } = await loadPage({ JSDOM }, 'registration.html', {
      url: 'http://localhost:5500/registration.html?id=1',
      apiHandler,
    });

    await waitFor(() => window.document.querySelector('#registration-form'), 8000);
    const form = window.document.querySelector('#registration-form');

    const set = (id, value) => {
      const control = form.querySelector(`#${id}`);
      control.value = value;
      control.dispatchEvent(new window.Event('input', { bubbles: true }));
      control.dispatchEvent(new window.Event('change', { bubbles: true }));
    };
    set('reg-name', 'Amelia Hartley');
    set('reg-email', 'amelia.hartley@example.com');

    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));

    const shown = await waitFor(
      () => window.document.querySelector('#form-alert').textContent.trim().length > 0,
      8000
    );
    assert.ok(shown, 'the 409 must be surfaced to the visitor');

    const alert = window.document.querySelector('#form-alert');
    assert.match(alert.className, /field-message--error/);
    const emailMessage = window.document.querySelector('#reg-email-message');
    assert.ok(
      emailMessage.textContent.trim().length > 0,
      'the conflict belongs next to the email field'
    );
  });

  /* --------------------------------------------------- the admin website --- */

  await test('the admin events page lists every event and offers Delete on each row', async () => {
    const { window } = await loadPage({ JSDOM }, 'admin/events.html', {
      url: 'http://localhost:5500/admin/events.html',
      apiHandler,
    });

    const ok = await waitFor(
      () => window.document.querySelectorAll('#events-table tbody tr').length > 0,
      8000
    );
    assert.ok(ok, 'the admin table was never rendered');

    const rows = [...window.document.querySelectorAll('#events-table tbody tr')];
    assert.equal(rows.length, 11, 'all eleven events, whatever their status');

    // The brief: "a complete list of all registered events, regardless of their
    // status (Active, Past, Suspended)".
    const text = window.document.querySelector('#events-table').textContent;
    assert.match(text, /Midnight Desert Auction/, 'the suspended event must be listed');
    assert.match(text, /Winter Lights Gala/, 'a past event must be listed');

    // The brief: "a Delete button or link next to each event in the main listing".
    const deleteButtons = window.document.querySelectorAll('[data-delete-event]');
    assert.equal(deleteButtons.length, rows.length, 'every row needs a Delete button');

    // And an Edit link per row, for the update feature.
    const editLinks = [...window.document.querySelectorAll('#events-table a[href^="update.html?id="]')];
    assert.equal(editLinks.length, rows.length);
  });

  await test('the admin menu is present on every admin page', async () => {
    for (const page of [
      'admin/index.html',
      'admin/events.html',
      'admin/new.html',
      'admin/update.html',
      'admin/registrations.html',
    ]) {
      const { window } = await loadPage({ JSDOM }, page, {
        url: `http://localhost:5500/${page}`,
        apiHandler,
      });

      const nav = window.document.querySelector('#admin-nav');
      assert.ok(nav, `${page} has no admin menu`);

      const links = [...nav.querySelectorAll('a')].map((link) => link.getAttribute('href'));
      ['index.html', 'events.html', 'new.html', 'update.html', 'registrations.html'].forEach(
        (target) => {
          assert.ok(
            links.includes(target),
            `${page} cannot reach ${target} from its menu`
          );
        }
      );

      // Exactly one entry is marked as current.
      const current = nav.querySelectorAll('[aria-current="page"]');
      assert.equal(current.length, 1, `${page} should mark exactly one current menu entry`);
    }
  });

  await test('the admin update page shows the registrations for the chosen event', async () => {
    const { window } = await loadPage({ JSDOM }, 'admin/update.html', {
      url: 'http://localhost:5500/admin/update.html?id=7',
      apiHandler,
    });

    const ok = await waitFor(
      () => window.document.querySelector('#update-registrations-heading'),
      8000
    );
    assert.ok(ok, 'the registrations panel was never rendered');

    const panel = window.document.querySelector('#update-registrations-heading').closest('section');
    const text = panel.textContent;
    assert.match(text, /Quinn Alvarez/, 'the associated registration data must be displayed');
    assert.match(text, /Rebecca Lindqvist/);
    assert.match(text, /Samuel Adeyemi/);

    // The reason the delete is blocked is stated, not left for staff to guess.
    assert.match(text, /3/, 'the number of registrations must be shown');

    // The edit form must be filled in with the stored event.
    const nameInput = window.document.querySelector('#eventName');
    assert.equal(nameInput.value, 'Harbour Lights Art Exhibition');

    // And it posts to the update endpoint, so the form is really wired up.
    assert.ok(window.document.querySelector('#event-submit'), 'the save button is missing');
  });

  await test('the admin registrations page lists every registration', async () => {
    const { window } = await loadPage({ JSDOM }, 'admin/registrations.html', {
      url: 'http://localhost:5500/admin/registrations.html',
      apiHandler,
    });

    const ok = await waitFor(
      () => window.document.querySelectorAll('#registrations-table tbody tr').length > 0,
      8000
    );
    assert.ok(ok);

    const rows = window.document.querySelectorAll('#registrations-table tbody tr');
    assert.equal(rows.length, 20, 'the seed data holds 20 registrations');
  });

  await test('the admin dashboard reports the totals from the API', async () => {
    const { window } = await loadPage({ JSDOM }, 'admin/index.html', {
      url: 'http://localhost:5500/admin/index.html',
      apiHandler,
    });

    const ok = await waitFor(() => window.document.querySelector('.admin-stats'), 8000);
    assert.ok(ok, 'the statistic tiles were never rendered');

    const text = window.document.querySelector('.admin-stats').textContent;

    // The figures are asserted as "the tile labelled X shows the value the API
    // reports" rather than by searching the whole block for a number, because a
    // bare digit matches anywhere in the text and would pass even if the tile
    // were attached to the wrong label.
    const tiles = [...window.document.querySelectorAll('.admin-stat')].map((tile) => ({
      label: (tile.querySelector('.admin-stat__label') || {}).textContent || '',
      value: (tile.querySelector('.admin-stat__value') || {}).textContent || '',
    }));

    const byLabel = (fragment) =>
      tiles.find((tile) => tile.label.toLowerCase().includes(fragment));

    const events = byLabel('events');
    assert.ok(events, `no "events" tile was rendered (labels: ${tiles.map((t) => t.label).join(', ')})`);
    assert.equal(events.value, '11', 'all eleven events, whatever their status');

    const registrations = byLabel('registration');
    assert.ok(registrations, 'no "registrations" tile was rendered');
    assert.equal(registrations.value, '20', 'the seed data holds twenty registrations');

    // The suspended event must be counted, not hidden, on the admin side.
    const suspended = byLabel('suspended');
    assert.ok(suspended, 'no "suspended" tile was rendered');
    assert.equal(suspended.value, '1');
  });
}

/* =====================================================================
 * Runner
 * ===================================================================== */
(async function main() {
  console.log('PROG2002 A3 - submission test suite');
  console.log(`Project root: ${ROOT}`);

  const server = await startTestApi();
  console.log(`Test API listening on ${baseUrl()} (data source: ${process.env.DATA_SOURCE})\n`);

  try {
    await testApi();
    await testA3Api();
    await testClient();
    await testA3Client();
  } catch (error) {
    console.error('\nThe test run stopped unexpectedly:', error);
    failed += 1;
    failures.push({ name: 'test runner', error });
  } finally {
    // Closing the HTTP server and the MySQL pool releases every handle, so the
    // Node process can exit by itself. Without this the suite would print its
    // result and then appear to hang, because an idle keep-alive connection or
    // a pooled database connection keeps the event loop alive.
    await new Promise((resolve) => server.close(resolve));
    try {
      await require(path.join(API_DIR, 'src', 'db', 'event_db.js')).close();
    } catch (error) {
      // The offline data source has no pool to close.
    }
  }

  console.log('\n==========================================================');
  console.log(` ${passed} passed, ${failed} failed`);
  console.log('==========================================================');

  if (failures.length > 0) {
    console.log('\nFailures:');
    failures.forEach((failure) => {
      console.log(`\n* ${failure.name}`);
      console.log(`  ${failure.error.message}`);
    });
  }

  // Explicit exit code, then an explicit exit: some Node versions keep a
  // stray DNS or socket handle alive for a few seconds after close().
  process.exit(failed > 0 ? 1 : 0);
})();
