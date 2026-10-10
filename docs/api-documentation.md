# API documentation - Charity Events API

PROG2002 Web Development II - Assessment 3, Part 2

Base URL: `http://localhost:3000/api`

Assessment 2 delivered the **read** half of this API (20% of that assessment).
Assessment 3 completes the C.R.U.D. cycle: events can now be created, updated and
deleted, and a person can register for an event. The read endpoints are
unchanged, so every A2 caller and every A2 screenshot still applies; what is new
is marked **A3** throughout this document.

Reading order: section 1 covers the conventions every endpoint shares, sections
2-6 are the read endpoints, sections 7-13 are the write endpoints (including the
delete rule, which is the one the brief singles out), and section 18 explains how
to try any of it.

---

## 1. Conventions

### Response envelope
Every successful response uses the same shape, so the client needs one code
path:

```json
{
  "success": true,
  "meta": {
    "resource": "events",
    "dataSource": "mysql",
    "total": 8,
    "count": 8,
    "page": 1,
    "totalPages": 1,
    "limit": 20,
    "offset": 0,
    "appliedFilters": { "state": "upcoming" },
    "generatedAt": "2026-09-28T02:15:31.220Z"
  },
  "data": [ ]
}
```

### Error envelope
Every failure uses the same shape, including the field that caused it:

```json
{
  "success": false,
  "error": {
    "status": 400,
    "message": "One or more query parameters are invalid.",
    "details": [
      { "field": "to", "message": "The end of the range cannot be earlier than the start." }
    ]
  }
}
```

### Status codes used

| Code | Meaning in this API |
| --- | --- |
| 200 | Success |
| 201 | **A3** - a resource was created. Always sent with a `Location` header |
| 204 | **A3** - a resource was deleted. No body at all |
| 400 | A query parameter or a request body field was invalid (bad date, unknown sort, id not a number, missing required field) |
| 404 | The endpoint or the resource does not exist, or a public request named a suspended event |
| 409 | **A3** - the request is well formed but conflicts with the current data: the event already has registrations, or the email is already registered for that event |
| 429 | Rate limit exceeded |
| 500 | Unexpected server fault (details logged, not returned) |
| 503 | `/api/health` only: the API runs but the database is unreachable |

Two details of the error body matter to a client:

* a **validation** failure puts an **array** in `details`, one
  `{ "field", "message" }` entry per problem, so a form can mark every field at
  once;
* a **conflict** puts an **object** in `details`, because there is no single
  field at fault (for example the delete rule reports the event, the count and a
  suggestion).

`clientside/js/api.js` normalises both into `ApiError.fieldErrors`, which is why
no page has to care which one it received.

### Cross-cutting behaviour

| Concern | Implementation |
| --- | --- |
| SQL injection | Every value is bound with a `?` placeholder through `mysql2`; the sort column is chosen from a whitelist |
| Input validation | `eventService.buildQuery()` validates every query parameter; `eventWriteService` and `registrationService` validate every body field and report all problems at once |
| Hidden records | All **public** queries read `vw_public_events`, which enforces `status = 'active'`; only `?audience=admin` and `/api/admin/...` read `vw_all_events` |
| Pagination | `?limit=` (max 100) and `?offset=` or `?page=` |
| Security headers | `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`; `X-Powered-By` removed |
| CORS | Origins listed in `CORS_ORIGIN`; `*` only for local marking. **A3 allows `GET,POST,PUT,DELETE,OPTIONS`** and exposes `Location` plus the `X-Deleted-*` headers, because a browser cannot read a header it is not allowed to see |
| Body size cap | `express.json({ limit: '100kb' })`, which matters now that the API accepts writes |
| Rate limiting | Fixed window per client IP (`RATE_LIMIT_MAX` per `RATE_LIMIT_WINDOW_MS`) |
| Full C.R.U.D. (A3) | `GET` and `POST` at the collection, `GET`/`PUT`/`DELETE` at the item - see sections 7-12 |
| Authentication | **Deliberately not implemented.** The brief states: "To limit the complexity, assume that authentication is not required." See section 17 |

---

## 2. `/api/health`

Confirms the API is running and whether the database answers. Also useful as
the first step of the demo video, and now as proof that the A3 table exists.

**Request** `GET /api/health`

**Response 200**

```json
{
  "success": true,
  "meta": { "resource": "health", "dataSource": "mysql", "environment": "development", "uptimeSeconds": 42 },
  "data": {
    "api": "ok",
    "database": {
      "connected": true,
      "database": "charityevents_db",
      "serverVersion": "8.0.36",
      "tableCount": 13,
      "registrationTable": true,
      "host": "localhost:3306",
      "user": "charity_app"
    }
  }
}
```

`tableCount` comes from `information_schema.tables` for this schema, so it counts
the **views as well as the tables**: 7 tables + 5 views = 12. It is a
"did the script run?" number rather than a table count.
`registrationTable` answers the more specific question - was
`event_registrations` created? - so a marker who runs only
`database/charityevents_db.sql` and then opens this URL can confirm Part 1 in one
request instead of counting rows in Workbench.

If MySQL is not reachable the status becomes **503** and `database` contains an
`error` object plus a `hint` explaining how to fix it.

---

## 3. `/api` - API index

**Request** `GET /api`

Returns the name, version and a list of every endpoint with its description and
query parameters. This doubles as living documentation during the demo. A3
extended the list to 20 endpoints and added the note that authentication is
deliberately absent, so the index states the assumption as well.

---

## 4. `/api/events` - the main resource

This one endpoint serves **both** the home page and the search page.

**Request** `GET /api/events`

### Query parameters

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `category` | id, repeatable or comma separated | - | Filter by one or more category ids, e.g. `?category=1,2` or `?category=1&category=2` |
| `location` | id, repeatable or comma separated | - | Filter by one or more location ids |
| `city` | text | - | Partial, case-insensitive city match |
| `date` | `YYYY-MM-DD` | - | Events running on that single day |
| `from` | `YYYY-MM-DD` | - | Events ending on or after this date |
| `to` | `YYYY-MM-DD` | - | Events starting on or before this date |
| `state` | `upcoming` \| `ongoing` \| `past` \| `all` | `upcoming` | Derived from the dates. `upcoming` means "has not finished yet", so it includes an event running today |
| `keyword` | text | - | Matches event name, short description, city, venue or organisation |
| `isFree` | `true` \| `false` | - | Only free events, or only paid events |
| `organizationId` | id | - | Restrict to one organisation |
| `includePast` | `true` \| `false` | `false` | Convenience alias for `state=all` |
| `audience` | `public` \| `admin` | `public` | **A3.** `admin` switches the query from `vw_public_events` to `vw_all_events`, so suspended and cancelled events are included. Any other value falls back to `public` |
| `publishStatus` | `active` \| `suspended` \| `cancelled` \| `all` | `all` | **A3.** Filters on the stored publishing status. It only has an effect when `audience=admin`, because the public view has already fixed the status to `active`. Any other value falls back to `all` |
| `sort` | `date` \| `name` \| `goal` \| `progress` \| `category` \| `city` | `date` | Whitelisted sort keys only |
| `direction` | `asc` \| `desc` | `asc` | Sort direction |
| `limit` | 1-100 | 20 | Page size |
| `offset` | >= 0 | 0 | Rows to skip |
| `page` | >= 1 | 1 | Alternative to `offset` |

`audience` and `publishStatus` are new in A3, and both are written so that an
existing A2 caller cannot change behaviour by accident: `audience` defaults to
`public`, which is the view A2 always used.

### Example - the home page (current and upcoming only)

```
GET /api/events?state=upcoming&sort=date&direction=asc&limit=12
```

```json
{
  "success": true,
  "meta": { "total": 8, "count": 8, "page": 1, "totalPages": 1, "appliedFilters": { "state": "upcoming" } },
  "data": [
    {
      "eventId": 4,
      "eventName": "Paws and Pints Charity Concert",
      "shortDescription": "Four local bands, food trucks and a dog-friendly lawn.",
      "eventDate": "2026-10-03",
      "startTime": "13:00:00",
      "endTime": "19:00:00",
      "dateStart": "2026-10-03",
      "dateEnd": "2026-10-03",
      "eventState": "upcoming",
      "status": "active",
      "categoryId": 4,
      "categoryName": "Charity Concert",
      "categorySlug": "charity-concert",
      "organizationId": 4,
      "organizationName": "Northern Rivers Animal Rescue",
      "locationId": 4,
      "venueName": "Ballina Beach Reserve",
      "city": "Ballina",
      "state": "NSW",
      "postcode": "2478",
      "latitude": -28.868,
      "longitude": 153.565,
      "goalAmount": 18000,
      "raisedAmount": 7025,
      "progressPercent": 39,
      "donationCount": 4,
      "registrationCount": 3,
      "ticketsSold": 6,
      "isFree": false,
      "primaryPrice": 15,
      "capacity": 800,
      "imageUrl": "charity-concert.svg"
    }
  ]
}
```

`registrationCount` and `ticketsSold` are **A3** additions: they come from the
`vw_event_columns` view, which counts the `event_registrations` rows per event.
They let the admin list show "3 / 800 registered" without a second request.

### Example - the search page (three criteria at once)

```
GET /api/events?state=all&city=Lismore&category=1&from=2026-01-01&to=2026-12-31
```

```json
{
  "success": true,
  "meta": {
    "total": 1,
    "appliedFilters": { "categoryIds": [1], "city": "Lismore", "from": "2026-01-01", "to": "2026-12-31", "state": "all" }
  },
  "data": [ { "eventId": 1, "eventName": "Riverside Rainbow Fun Run 2026", "eventState": "upcoming" } ]
}
```

### Example - past events

```
GET /api/events?state=past&sort=date&direction=desc
```

Returns the two completed events, with `eventState: "past"`.

### Example - the admin view (A3)

```
GET /api/events?audience=admin&publishStatus=all&state=all&sort=date&direction=desc
```

```json
{
  "success": true,
  "meta": {
    "total": 11,
    "count": 11,
    "appliedFilters": { "state": "all", "audience": "admin", "publishStatus": "all" }
  },
  "data": [
    { "eventId": 11, "eventName": "Winter Lights Lantern Walk", "status": "suspended", "eventState": "upcoming", "registrationCount": 0, "ticketsSold": 0 },
    { "eventId": 10, "eventName": "Jetty Dash Fun Run", "status": "active", "eventState": "past", "registrationCount": 0, "ticketsSold": 0 }
  ]
}
```

Eleven events, where the public view would return eight to ten depending on the
date. `appliedFilters` echoes `audience` and `publishStatus` as well, so the
admin page can show the operator which view is on screen. (Two of the eleven rows
are shown above.)

### Example - validation failure

```
GET /api/events?from=2026-12-01&to=2026-01-01
```

```json
{
  "success": false,
  "error": {
    "status": 400,
    "message": "One or more query parameters are invalid.",
    "details": [ { "field": "to", "message": "The end of the range cannot be earlier than the start." } ]
  }
}
```

---

## 5. `/api/events/upcoming`

The home page listing, in one call.

**Request** `GET /api/events/upcoming?limit=12&sort=date&direction=asc`

Identical to `GET /api/events?state=upcoming`, with a `meta.view` of
`"upcoming"`. It exists because it makes the home page's intent explicit and
gives the client a short, readable URL.

---

## 6. `/api/events/:id` - full detail

**Request** `GET /api/events/1`

Returns everything the event detail page needs: the ticket tiers, the
goal/progress figures and - **new in A3** - every registration for that event.

```json
{
  "success": true,
  "meta": { "resource": "event" },
  "data": {
    "eventId": 1,
    "eventName": "Riverside Rainbow Fun Run 2026",
    "shortDescription": "A 5 km and 10 km family fun run along the Wilsons River.",
    "description": "The Riverside Rainbow Fun Run is Unity Heart Foundations flagship community event...",
    "purpose": "Fund free paediatric allied health sessions for local families.",
    "eventDate": "2026-10-11",
    "startTime": "07:30:00",
    "endTime": "12:00:00",
    "dateStart": "2026-10-11",
    "dateEnd": "2026-10-11",
    "eventState": "upcoming",
    "status": "active",
    "daysUntil": 13,
    "organizationName": "Unity Heart Foundation",
    "categoryName": "Fun Run",
    "venueName": "Lismore Riverside Park",
    "address": "2 Riverside Dr",
    "city": "Lismore",
    "state": "NSW",
    "postcode": "2480",
    "latitude": -28.813,
    "longitude": 153.278,
    "capacity": 1200,
    "isFree": false,
    "goalAmount": 25000,
    "raisedAmount": 7720,
    "progressPercent": 30.9,
    "donationCount": 7,
    "registrationCount": 4,
    "ticketsSold": 8,
    "totalTicketsSold": 8,
    "primaryPrice": 0,
    "imageUrl": "fun-run.svg",
    "ticketTypes": [
      { "ticketTypeId": 3, "ticketName": "Free Community Entry", "price": 0, "quantityAvailable": 100, "description": "Free entry for concession card holders" },
      { "ticketTypeId": 2, "ticketName": "5 km Family Walk", "price": 25, "quantityAvailable": 500, "description": "Untimed walk entry, children under 12 free" },
      { "ticketTypeId": 1, "ticketName": "10 km Timed Run", "price": 45, "quantityAvailable": 600, "description": "Chip-timed entry with medal and breakfast voucher" }
    ],
    "registrations": [
      {
        "registrationId": 4,
        "eventId": 1,
        "ticketTypeId": 1,
        "ticketName": "10 km Timed Run",
        "ticketPrice": 45,
        "attendeeName": "Diane Whitmore",
        "attendeeEmail": "diane.whitmore@example.com",
        "attendeePhone": "0401 226 553",
        "ticketsPurchased": 1,
        "totalAmount": 45,
        "registeredAt": "2026-09-19 19:22:00",
        "notes": null
      },
      {
        "registrationId": 3,
        "eventId": 1,
        "ticketTypeId": 3,
        "ticketName": "Free Community Entry",
        "ticketPrice": 0,
        "attendeeName": "Chandra Pillai",
        "attendeeEmail": "chandra.pillai@example.com",
        "attendeePhone": null,
        "ticketsPurchased": 1,
        "totalAmount": 0,
        "registeredAt": "2026-09-08 10:05:00",
        "notes": "Concession card holder."
      }
    ]
  }
}
```

Four things to notice in the A3 additions:

* `registrations` is ordered by **`registered_at DESC, registration_id DESC`** -
  the brief asks for "sorted by the latest date when the tickets were purchased",
  and the id breaks a tie between two rows written in the same second so the
  order is never ambiguous (the array above is shortened: event 1 has four
  registrations in the seed data, and the two newest are shown);
* `totalTicketsSold` is the sum of `ticketsPurchased` over that array, so the
  page can print a total without doing its own arithmetic (it equals
  `ticketsSold`, which comes from the view - two routes to the same figure);
* `ticketPrice` and `totalAmount` are computed for the response
  (`tickets_purchased * price`) and are **not** stored on the registration row.
  If a tier price changes later, every registration reports the price that
  applies now, which is what the event page and the admin page both show;
* `status`, `latitude` and `longitude` are included because A3 uses them: the
  status for the badges, the coordinates for the optional weather panel.

### Errors

| Request | Status | Message |
| --- | --- | --- |
| `GET /api/events/abc` | 400 | `"abc" is not a valid event id. Event ids are positive whole numbers.` |
| `GET /api/events/9999` | 404 | `No active charity event was found with id 9999. It may have been suspended or removed.` |
| `GET /api/events/11` (suspended) | 404 | Same as above - a suspended event is not disclosed |
| `GET /api/admin/events/11` | 200 | The same event **is** returned by the admin route, which reads `vw_all_events` |

---

## 7. `POST /api/events` - create an event (A3)

**Request** `POST /api/events` with `Content-Type: application/json`

The handler is shared with `POST /api/admin/events`; both call
`eventWriteService.createEvent()`.

### Request body

| Field | Type | Required | Constraints |
| --- | --- | --- | --- |
| `organizationId` | integer | **yes** | Positive id that must exist in `organizations` |
| `categoryId` | integer | **yes** | Positive id that must exist in `categories` |
| `locationId` | integer | **yes** | Positive id that must exist in `locations` |
| `eventName` | string | **yes** | 3-180 characters |
| `shortDescription` | string | **yes** | 5-300 characters (used on the cards) |
| `description` | string | **yes** | 10-20000 characters |
| `purpose` | string | **yes** | 3-300 characters |
| `eventDate` | date | **yes** | `YYYY-MM-DD`, a real calendar date. A full ISO timestamp is accepted and the date part is kept |
| `startTime` | time | **yes** | `HH:MM` or `HH:MM:SS` |
| `endTime` | time | **yes** | Must be later than `startTime` |
| `dateStart` | date | no | Defaults to `eventDate`. Must not be after `dateEnd` |
| `dateEnd` | date | no | Defaults to `eventDate` |
| `goalAmount` | number | no | `>= 0`, up to 99,999,999,999; defaults to `0` |
| `isFree` | boolean | no | Accepts `true`/`false`; also `1`/`0` and `"yes"`/`"no"`. Defaults to `false` |
| `capacity` | integer | no | `>= 1`; send `""` or `null` for "no limit" |
| `status` | enum | no | `active` \| `suspended` \| `cancelled` (case-insensitive); defaults to `active` |
| `imageUrl` | string | no | Max 400 characters. One of the nine artwork files the client ships (`fun-run.svg`, `gala-dinner.svg`, ...) or any URL |
| `ticketTypes` | array | no | Each entry: `ticketName` (2-100, required), `price` (`>= 0`, required), `quantityAvailable` (integer `>= 0`, or empty for unlimited), `description` (max 255) |

### Example request

```json
{
  "organizationId": 1,
  "categoryId": 8,
  "locationId": 6,
  "eventName": "Riverside Trivia Night",
  "shortDescription": "Ten rounds, six people a table, all for the youth program.",
  "description": "A relaxed trivia night at Lismore City Hall with a licensed bar, a raffle and a prize for the best team name.",
  "purpose": "Fund the after-school homework club for 40 students.",
  "eventDate": "2026-11-14",
  "startTime": "18:30",
  "endTime": "22:00",
  "goalAmount": 8000,
  "capacity": 180,
  "status": "active",
  "imageUrl": "community.svg",
  "ticketTypes": [
    { "ticketName": "Table of six", "price": 60, "quantityAvailable": 30, "description": "One table, six players" },
    { "ticketName": "Single seat", "price": 12, "quantityAvailable": null, "description": "We will place you in a team" }
  ]
}
```

### Response 201 Created

`Location: /api/events/12`

```json
{
  "success": true,
  "meta": { "resource": "event", "dataSource": "mysql", "created": true },
  "data": {
    "eventId": 12,
    "eventName": "Riverside Trivia Night",
    "eventDate": "2026-11-14",
    "dateStart": "2026-11-14",
    "dateEnd": "2026-11-14",
    "status": "active",
    "eventState": "upcoming",
    "organizationName": "Unity Heart Foundation",
    "venueName": "Lismore City Hall",
    "registrationCount": 0,
    "ticketsSold": 0,
    "ticketTypes": [
      { "ticketTypeId": 19, "ticketName": "Table of six", "price": 60, "quantityAvailable": 30 },
      { "ticketTypeId": 20, "ticketName": "Single seat", "price": 12, "quantityAvailable": null }
    ]
  }
}
```

Why 201 and a `Location` header rather than a plain 200? Because the request
created something at a new URL, and telling the client where it lives is what
makes the response useful. The body is the created event, re-read through the
admin view, so a create response looks exactly like a later read of the same
resource.

### Errors

| Status | When | Example message |
| --- | --- | --- |
| 400 | Any field fails the table above. **All** problems are collected into one response | `The event could not be saved because some fields are invalid.` |
| 400 | An id does not exist (`ER_NO_REFERENCED_ROW_2`) | `One of the selected values (organisation, category or venue) does not exist.` |
| 400 | A database CHECK refuses the row (`ER_CHECK_CONSTRAINT_VIOLATED`) | `The database rejected the values: check that the end date is not before the start date...` |
| 409 | A unique key is violated (`ER_DUP_ENTRY`) | `A record with these details already exists.` |

```json
{
  "success": false,
  "error": {
    "status": 400,
    "message": "The event could not be saved because some fields are invalid.",
    "details": [
      { "field": "eventName", "message": "eventName must be at least 3 characters." },
      { "field": "endTime", "message": "The end time must be later than the start time." },
      { "field": "ticketTypes[1]", "message": "price is required." }
    ]
  }
}
```

One response listing every problem is a deliberate choice: staff fix the form in
one pass instead of submitting, learning about the next error, and submitting
again. The admin form paints each message beside its own control and puts a
summary above the form.

---

## 8. `PUT /api/events/:id` - update an event (A3)

**Request** `PUT /api/events/:id` with `Content-Type: application/json`

A **partial** update: only the fields present in the body are validated and
changed, so the admin page can send the two fields a user actually edited rather
than the whole object. The field list and the constraints are the same as
`POST` above, except that nothing is required.

`dateStart` and `dateEnd` follow the create rule: sending neither leaves them
alone; sending `eventDate` without them moves both to the new date.

### Example request - change the status and the capacity only

```
PUT /api/events/12
```

```json
{ "status": "suspended", "capacity": 120 }
```

**Response 200**

```json
{
  "success": true,
  "meta": { "resource": "event", "updated": true },
  "data": { "eventId": 12, "eventName": "Riverside Trivia Night", "status": "suspended", "capacity": 120 }
}
```

### Errors

| Status | When | Message |
| --- | --- | --- |
| 400 | The id is not a positive whole number | `"abc" is not a valid event id. Event ids are positive whole numbers.` |
| 400 | The body is empty | `No fields were supplied. Send only the fields you want to change.` |
| 400 | A field fails validation | `The event could not be saved because some fields are invalid.` with the per-field `details` array |
| 404 | No event has that id | `No charity event was found with id 9999, so there was nothing to update.` |
| 409 | A unique key is violated | `A record with these details already exists.` |

The empty body is refused rather than treated as "nothing to do" because it is
far more likely to be a client bug, and a silent 200 would hide it.

Sending `status: "suspended"` is also the intended answer to a blocked delete -
see the next two sections.

---

## 9. `DELETE /api/events/:id` (A3)

**Request** `DELETE /api/events/:id`

**Response 204 No Content** - no body at all, which is the RESTful answer to
"the resource is gone". Because a 204 carries nothing, the outcome is repeated
in headers a browser or Postman can read (they are also listed in
`Access-Control-Expose-Headers`, or the browser would hide them from the page):

| Header | Example |
| --- | --- |
| `X-Deleted-Event-Id` | `12` |
| `X-Deleted-Event-Name` | `Riverside%20Trivia%20Night` (URL-encoded, because a header cannot carry arbitrary text safely) |

### Errors

| Status | When | Message |
| --- | --- | --- |
| 400 | The id is not a positive whole number | `"abc" is not a valid event id. Event ids are positive whole numbers.` |
| 404 | No event has that id | `No charity event was found with id 9999, so there was nothing to delete.` |
| 409 | The event has registrations | See below |

### Response 409 Conflict - the blocked delete

```
DELETE /api/events/1
```

```json
{
  "success": false,
  "error": {
    "status": 409,
    "message": "\"Riverside Rainbow Fun Run 2026\" cannot be deleted because 4 registrations have already been recorded for it. The brief requires an event to be deleted only when it has not yet received any registrations. Set its status to \"suspended\" instead if it should no longer appear on the public website.",
    "details": {
      "eventId": 1,
      "eventName": "Riverside Rainbow Fun Run 2026",
      "registrationCount": 4,
      "suggestion": "suspend-instead"
    }
  }
}
```

The message names the event and the count so a member of staff knows what to do
next, and `details.suggestion` gives the client a machine-readable way to offer
the alternative (the admin site turns it into a link to Update and a link to the
registrations for that event).

---

## 10. The delete data-integrity rule (A3)

The brief requires that an event can only be deleted when it "has not yet
received any registrations". That is a rule about **data**, not about HTTP, so
it is enforced in three places at once, and the video script demonstrates all
three.

### 1. The API check, inside one transaction

`write.repository.mysql.js` runs the check and the delete as a single unit:

```sql
START TRANSACTION;
  SELECT event_id, event_name FROM events WHERE event_id = ? FOR UPDATE;
  SELECT COUNT(*) AS total FROM event_registrations WHERE event_id = ?;
  -- only when the count is zero:
  DELETE FROM events WHERE event_id = ?;
COMMIT;
```

`FOR UPDATE` locks the event row for the life of the transaction. Without it two
requests could interleave: request A counts zero registrations, request B inserts
one, request A then deletes the event and the new registration is orphaned (or
the delete fails on the foreign key). Locking the row first means the count
cannot become stale between the check and the delete. `event_db.transaction()`
provides the `BEGIN`/`COMMIT`/`ROLLBACK` wrapper, and it rolls back if the
callback throws, so a failure can never leave a half-applied change behind.

Because nothing was written when the count is not zero, the transaction simply
ends - a conflict is not an error state that needs undoing.

### 2. The 409 answer

The outcome is turned into HTTP status by `eventWriteService.deleteEvent()`:

| Outcome | Status | Body |
| --- | --- | --- |
| Deleted | 204 | empty, with the `X-Deleted-*` headers |
| No such event | 404 | the standard error envelope |
| Has registrations | 409 | the message and `details` shown in section 9 |

**409 Conflict** is the right code rather than 400: the request is perfectly well
formed and the event exists, but the current state of the data means it cannot be
carried out. 400 would blame the client for a malformed request, which this is
not. `HttpError.conflict()` was added to `api/src/utils/errors.js` for exactly
this case.

### 3. The MySQL foreign key as the backstop

`fk_registration_event` is declared `ON DELETE RESTRICT`. Even if the application
check above were removed or bypassed - by a direct SQL client, by a future
endpoint, or by a bug - MySQL itself refuses to delete an event that still has
registration rows. The schema, not the application, is the last line of defence.

That refusal arrives as the driver error `ER_ROW_IS_REFERENCED_2`, which
`translateMysqlError()` converts into **the same 409** with the same shape of
message. So the caller cannot tell which of the two defences stopped the delete,
and does not need to: the rule is what matters.

### Why this matters for the seed data

Events 9 and 10 (past) and event 11 (suspended) have **no** registrations on
purpose. They are the events the admin site can actually delete in a
demonstration, which is how the video shows both halves of the rule: a blocked
delete on an event that has registrations, and a successful 204 on one that does
not. See `docs/database-design.md` section 6 for the seed-data reasoning.

---

## 11. Registrations for one event (A3)

### 11.1 `GET /api/events/:id/registrations`

Every registration for one event, newest purchase first. The event detail page
uses this, and `GET /api/events/:id` already includes the same array.

**Request** `GET /api/events/1/registrations`

```json
{
  "success": true,
  "meta": {
    "resource": "registrations",
    "eventId": 1,
    "eventName": "Riverside Rainbow Fun Run 2026",
    "total": 4,
    "ticketsSold": 8,
    "order": "registeredAt DESC (newest purchase first)"
  },
  "data": [
    {
      "registrationId": 4,
      "eventId": 1,
      "ticketTypeId": 1,
      "ticketName": "10 km Timed Run",
      "ticketPrice": 45,
      "attendeeName": "Diane Whitmore",
      "attendeeEmail": "diane.whitmore@example.com",
      "attendeePhone": "0401 226 553",
      "ticketsPurchased": 1,
      "totalAmount": 45,
      "registeredAt": "2026-09-19 19:22:00",
      "notes": null
    }
  ]
}
```

**Errors** - 400 for an id that is not a positive whole number; 404
(`No event was found with id 9999.`) when the event does not exist. The check
deliberately accepts **any** status, so an administrator can look at the
registrations of a suspended event.

### 11.2 `POST /api/events/:id/registrations` - register for an event

This is the endpoint behind `registration.html`. A registration only exists
inside an event, so it is created by posting to the event's sub-collection; that
URL says "add a registration to event 1" without inventing a verb.

**Request** `POST /api/events/1/registrations` with `Content-Type: application/json`

| Field | Type | Required | Constraints |
| --- | --- | --- | --- |
| `attendeeName` | string | **yes** | 2-120 characters |
| `attendeeEmail` | string | **yes** | Must look like an email and satisfy the database CHECK. Trimmed and **lower-cased** before storage, so `Ann@Example.com ` and `ann@example.com` are the same person |
| `attendeePhone` | string | no | Max 30 characters; when present it must look like a phone number (`0400 000 000`, `+61 400 000 000`, `(02) 6620 1001`) |
| `ticketsPurchased` | integer | no | 1-20; defaults to 1. Must not exceed what is left of the chosen tier |
| `ticketTypeId` | integer | no | Must be a tier **of this event**. A tier from another event is rejected with a 400 naming this field; the `fk_registration_ticket` foreign key separately guarantees the tier exists. `null` or `""` means "no tier recorded" |
| `registeredAt` | date or datetime | no | "The date of registration". A date alone becomes `12:00:00` on that day; omit it and the database default (`CURRENT_TIMESTAMP`) records the moment of submission |
| `notes` | string | no | Max 300 characters |

The brief lists the stored fields as the user identifier, the date of
registration, the contact details and the number of tickets purchased, so the
form has one control per stored column and this body mirrors the table.

### Example request

```json
{
  "attendeeName": "Priya Raman",
  "attendeeEmail": "priya.raman@example.com",
  "attendeePhone": "0412 555 019",
  "ticketTypeId": 2,
  "ticketsPurchased": 2,
  "notes": "One adult and one child."
}
```

### Response 201 Created

`Location: /api/registrations/21`

```json
{
  "success": true,
  "meta": { "resource": "registration", "created": true, "eventId": 1 },
  "data": {
    "registrationId": 21,
    "eventId": 1,
    "eventName": "Riverside Rainbow Fun Run 2026",
    "ticketTypeId": 2,
    "ticketName": "5 km Family Walk",
    "ticketPrice": 25,
    "attendeeName": "Priya Raman",
    "attendeeEmail": "priya.raman@example.com",
    "attendeePhone": "0412 555 019",
    "ticketsPurchased": 2,
    "totalAmount": 50,
    "registeredAt": "2026-09-28 10:41:00",
    "notes": "One adult and one child."
  }
}
```

The response is the stored row read back through `vw_event_registrations`, so the
confirmation screen shows the receipt the **database** holds rather than what the
form thought it sent. That is why the page can prove the write really happened.

### Errors

| Status | When | Example |
| --- | --- | --- |
| 400 | A body field fails validation; every problem is reported at once | `The registration could not be saved because some fields are invalid.` with `details` |
| 400 | The tier belongs to a different event | `Ticket type 5 does not belong to event 1.` with `{ "field": "ticketTypeId", ... }` |
| 400 | More tickets than remain | `Only 3 tickets of "5 km Family Walk" remain, but 4 were requested.` with `{ "field": "ticketsPurchased", "remaining": 3, "ticketName": "5 km Family Walk" }` |
| 400 | The tier is sold out | `"5 km Family Walk" is sold out.` |
| 404 | The event does not exist | `No event was found with id 9999, so a registration cannot be recorded for it.` |
| 409 | That email already registered for that event | See below |

### Response 409 Conflict - the duplicate registration

```json
{
  "success": false,
  "error": {
    "status": 409,
    "message": "amelia.hartley@example.com has already registered for \"Riverside Rainbow Fun Run 2026\". Each person may register for an event once.",
    "details": {
      "field": "attendeeEmail",
      "eventId": 1,
      "attendeeEmail": "amelia.hartley@example.com",
      "hint": "Use the event detail page to see the existing registration."
    }
  }
}
```

This is the brief's rule - **a user may register for multiple events and can only
register for an event once** - reported as something a person can act on. The
guarantee behind it is the unique key `uq_registration_event_email (event_id,
attendee_email)` from Part 1; the API checks first so the normal case produces
this message, and it still translates a raw `ER_DUP_ENTRY` in case two requests
with the same email race each other by a few milliseconds. Either way the answer
is the same 409.

Note the asymmetry that makes the rule work: the unique key is on the **pair**,
so the same email may register for event 1 *and* event 2, but not twice for
event 1.

---

## 12. `/api/registrations` - registration records (A3)

### 12.1 `GET /api/registrations` - the admin list

Every registration across every event, newest first. This endpoint is optional in
the brief (which asks only that registrations are not manipulated); it exists
because the admin site has a Registrations page and a demonstration is easier
with one URL that shows the lot.

**Request** `GET /api/registrations?eventId=1&keyword=hartley&limit=50&offset=0`

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `eventId` | id | - | Only registrations for that event |
| `email` | text | - | Partial, case-insensitive match on the attendee email on record |
| `keyword` | text | - | Matches the attendee name or the attendee email |
| `limit` | 1-200 | 100 | Page size (a higher cap than `/api/events`, because this is an admin list) |
| `offset` | >= 0 | 0 | Rows to skip |

```json
{
  "success": true,
  "meta": {
    "resource": "registrations",
    "view": "admin",
    "total": 20,
    "count": 20,
    "limit": 100,
    "offset": 0,
    "ticketsSold": 49
  },
  "data": [
    {
      "registrationId": 19,
      "eventId": 7,
      "eventName": "Harbour Lights Art Exhibition",
      "ticketTypeId": 13,
      "ticketName": "Opening Night",
      "ticketPrice": 35,
      "attendeeName": "Samuel Adeyemi",
      "attendeeEmail": "samuel.adeyemi@example.com",
      "attendeePhone": "0491 335 176",
      "ticketsPurchased": 1,
      "totalAmount": 35,
      "registeredAt": "2026-09-24 09:28:00",
      "notes": null
    }
  ]
}
```

`ticketsSold` in `meta` is the sum over the rows this page returned, so it is a
page total rather than a global one - `GET /api/stats` is the place for the
global figures.

### 12.2 `GET /api/registrations/:id`

One registration, in the same shape as an element of the list above.

| Status | When | Message |
| --- | --- | --- |
| 200 | Found | the envelope with `data` |
| 400 | The id is not a positive whole number | `"abc" is not a valid registration id. Ids are positive whole numbers.` |
| 404 | No such registration | `No registration was found with id 999.` |

### 12.3 `PUT /api/registrations/:id`

A partial update using the same field list and constraints as the create
endpoint. `attendeePhone`, `notes` and `ticketTypeId` accept an explicit empty
value to clear them.

```
PUT /api/registrations/21
```

```json
{ "ticketsPurchased": 3, "attendeePhone": "" }
```

**Response 200**

```json
{
  "success": true,
  "meta": { "resource": "registration", "updated": true },
  "data": {
    "registrationId": 21,
    "ticketsPurchased": 3,
    "attendeePhone": null,
    "totalAmount": 75
  }
}
```

| Status | When | Message |
| --- | --- | --- |
| 400 | Empty body | `No fields were supplied. Send only the fields you want to change.` |
| 400 | A field fails validation, or the new tier belongs to another event | `Ticket type 5 does not belong to event 1.` |
| 404 | No such registration | `No registration was found with id 999, so there was nothing to update.` |
| 409 | The new email is already used for that event | `That email is already registered for this event.` |

### 12.4 `DELETE /api/registrations/:id`

**Request** `DELETE /api/registrations/21`

**Response 204 No Content**, with `X-Deleted-Registration-Id: 21`.

| Status | When | Message |
| --- | --- | --- |
| 400 | The id is not a positive whole number | `"abc" is not a valid registration id. Ids are positive whole numbers.` |
| 404 | No such registration | `No registration was found with id 999, so there was nothing to delete.` |

Deleting a registration is also the legitimate way to unblock an event that
should genuinely disappear: remove the registrations, then delete the event. The
admin site warns about this rather than doing it silently (section 9's
`details.suggestion` is the opposite advice: suspend instead).

---

## 13. The admin endpoints (A3)

The admin website needs to see events that the public site must never show, and
it needs the dropdown lists for its forms. Those are the only reasons these three
endpoints exist.

### 13.1 `GET /api/admin/events`

"Displays a complete list of all registered events, regardless of their status
(Active, Past, Suspended)" - the public `/api/events` cannot do that, because it
reads `vw_public_events`. This route always reads `vw_all_events`.

**Request** `GET /api/admin/events?publishStatus=suspended&state=all`

It accepts the same query parameters as `/api/events` (they are validated by the
same service), with different defaults: `state=all`, `publishStatus=all`,
`sort=date`, `direction=desc`. So the newest events appear first and nothing is
hidden unless a filter asks for it.

```json
{
  "success": true,
  "meta": {
    "resource": "events",
    "view": "admin",
    "total": 11,
    "count": 11,
    "page": 1,
    "totalPages": 1,
    "limit": 20,
    "offset": 0,
    "appliedFilters": { "state": "all", "audience": "admin", "publishStatus": "suspended" }
  },
  "data": [
    {
      "eventId": 11,
      "eventName": "Winter Lights Lantern Walk",
      "status": "suspended",
      "eventState": "upcoming",
      "eventDate": "2026-11-07",
      "venueName": "Lismore City Hall",
      "city": "Lismore",
      "capacity": 500,
      "registrationCount": 0,
      "ticketsSold": 0
    }
  ]
}
```

`meta.view` is `"admin"`, so a client can tell which view produced the list.

### 13.2 `GET /api/admin/events/:id`

One event whatever its status, with its ticket tiers and its registrations - the
same body as section 6, but a suspended event answers **200** instead of 404.

| Status | When | Message |
| --- | --- | --- |
| 400 | The id is not a positive whole number | `"abc" is not a valid event id. Event ids are positive whole numbers.` |
| 404 | Really no such row | `No charity event was found with id 9999.` |

### 13.3 `GET /api/admin/reference-data`

Organisations, categories and venues in one request, so the "Add event" and
"Update event" forms are ready after a single round trip.

**Request** `GET /api/admin/reference-data`

```json
{
  "success": true,
  "meta": { "resource": "reference-data" },
  "data": {
    "organizations": [
      { "organizationId": 1, "name": "Unity Heart Foundation", "city": "Lismore" }
    ],
    "categories": [
      { "categoryId": 1, "categoryName": "Fun Run", "slug": "fun-run", "icon": "run" }
    ],
    "locations": [
      { "locationId": 1, "venueName": "Lismore Riverside Park", "city": "Lismore", "state": "NSW", "latitude": -28.813, "longitude": 153.278 }
    ]
  }
}
```

Unlike `/api/categories` and `/api/locations`, this list is **not** filtered by
whether a row currently has a public event: staff may be about to create one. It
is also not paginated, because there are six organisations, eight categories and
nine venues.

### 13.4 The write methods are mounted at both paths

`POST`, `PUT` and `DELETE` exist at `/api/admin/events...` **and** at
`/api/events...`, and both mounts call the same controller functions. There is
exactly one implementation of each rule, so the two cannot drift apart:

| Plain RESTful path (the brief's wording) | Admin path | Handler |
| --- | --- | --- |
| `POST /api/events` | `POST /api/admin/events` | `adminController.createEvent` |
| `PUT /api/events/:id` | `PUT /api/admin/events/:id` | `adminController.updateEvent` |
| `DELETE /api/events/:id` | `DELETE /api/admin/events/:id` | `adminController.deleteEvent` |

Sections 7-9 document them once, at the plain paths.

### 13.5 What is still not implemented

| Endpoint | Why not |
| --- | --- |
| `POST /api/donations` | The brief does not ask for donations to be created, and A3's write work is registration and event management. The `donations` table and its INSERT shape are in place if it is ever wanted |
| `PUT /api/events/:id/status` | Suspending an event is done with `PUT /api/events/:id` and `{ "status": "suspended" }`, which is fewer endpoints for the same result |
| Any endpoint that manipulates categories, organisations or venues | Explicitly not required ("You are NOT required to create endpoints to manipulate category and registration"). Registrations were added anyway, because the client website cannot register without one |
| Authentication (login, tokens, sessions) | Deliberately omitted - see section 17 |

---

## 14. `/api/categories`

Drives the category checkboxes on the search page.

**Request** `GET /api/categories`

```json
{
  "success": true,
  "meta": { "resource": "categories", "count": 8 },
  "data": [
    { "categoryId": 1, "categoryName": "Fun Run", "slug": "fun-run", "description": "Walk, jog or run to raise funds", "icon": "run", "eventCount": 2 },
    { "categoryId": 2, "categoryName": "Gala Dinner", "slug": "gala-dinner", "description": "Formal evening of dining, speakers and auctions", "icon": "gala", "eventCount": 2 }
  ]
}
```

`eventCount` counts only **active** events, so a category whose only event is
suspended shows `0`.

---

## 15. `/api/locations`

Drives the location suggestions on the search page.

**Request** `GET /api/locations`

```json
{
  "success": true,
  "meta": { "resource": "locations", "count": 8 },
  "data": [
    { "locationId": 1, "venueName": "Lismore Riverside Park", "city": "Lismore", "state": "NSW", "eventCount": 1 },
    { "locationId": 5, "venueName": "Sydney Town Hall", "city": "Sydney", "state": "NSW", "eventCount": 2 }
  ]
}
```

Only venues that currently host at least one active event are returned. The
admin form uses `/api/admin/reference-data` instead, for the reason in 13.3.

---

## 16. `/api/organization` and `/api/stats`

Supporting endpoints for the home page.

**`GET /api/organization`**

```json
{
  "success": true,
  "data": {
    "organizationId": 1,
    "name": "Unity Heart Foundation",
    "mission": "We fund community health programs for families who cannot afford private care.",
    "email": "hello@unityheart.org.au",
    "phone": "(02) 6620 1001",
    "website": "https://unityheart.org.au",
    "city": "Lismore",
    "country": "Australia"
  }
}
```

**`GET /api/stats`**

```json
{
  "success": true,
  "data": {
    "upcomingEvents": 8,
    "categories": 8,
    "organizations": 6,
    "totalRaised": 99290,
    "activeGoal": 240000,
    "defaultPageSize": 20,
    "registrations": 20,
    "ticketsSold": 49
  }
}
```

`registrations` and `ticketsSold` are **A3** additions: a count of every
registration row and the sum of `tickets_purchased` across all of them (20 rows
and 49 tickets in the seed data). They give the admin dashboard its headline
figures in the same call the public home page already uses.

---

## 17. Security: what is deliberate and what is missing

The brief asks for "security considerations" and, for Assessment 3, states:
"To limit the complexity, assume that authentication is not required."

| Concern | What this API does |
| --- | --- |
| **Authentication** | **Not implemented, on purpose.** Anyone who can reach the API can create, update and delete an event. The brief grants this assumption explicitly, the API index repeats it in its own response, and the limitation is stated here rather than hidden. In a real deployment the `/api/admin/...` routes and every write method would sit behind a login; the endpoints are already grouped so that is where the check would go |
| SQL injection | Parameterised statements only; the sort column is chosen from a whitelist. A string such as `?sort=date;DROP TABLE events` is rejected before any SQL runs |
| Validation | Every query parameter and every body field is checked in the service layer, with all problems returned at once. The database then enforces types, keys, uniqueness and CHECK constraints - three layers, none of them trusting the one before |
| Destructive operations | The delete rule of section 10, `ON DELETE RESTRICT`, and a confirmation dialog in the admin site |
| Transport / headers | `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `X-Powered-By` removed |
| CORS | Only the origins in `CORS_ORIGIN` may call the API, and only `GET, POST, PUT, DELETE, OPTIONS`. `PATCH`, for example, is refused by the browser because it is not advertised |
| Abuse | Fixed-window rate limiting per client IP; JSON body size cap |
| Credentials | The real database password lives only in `api/.env`, which is git-ignored and excluded from the submission zips. `tools/check-no-secrets.mjs` refuses to publish a repository containing a credential |
| Database account | The API connects with a dedicated account limited to `charityevents_db`, never as `root`. **Check it before demonstrating a write**: on this machine the account still held `SELECT` only, so the grant must be extended with `INSERT, UPDATE, DELETE` (README section 1a) |

---

## 18. Testing the API

### Browser
Open <http://localhost:3000/> for a clickable index, or
<http://localhost:3000/api/events?state=all> for raw JSON.

### Postman
The collection `PROG2002 A2 - Charity Events API` in `docs/postman/` covers both
assessments: the A2 read endpoints in the folders `Health`, `Home page`,
`Search page`, `Event detail` and `Validation and error handling`, and the A3
write endpoints, registrations and admin views in the folder
`Assessment 3 - the write endpoints`. The A3 folder is chained with collection
variables and has to run in the order shown; the YAML files beside the exported
JSON are the source it is generated from.

1. Import `PROG2002-A2-Charity-Events-API.postman_collection.json`, or open the
   raw YAML folder in Postman.
2. Run the whole collection with the Collection Runner, top to bottom. It creates
   its own event, registers against it, proves the delete is refused, removes the
   registration and the event again, and so leaves the database as it found it.
3. To demonstrate the search filter, use
   `{{baseUrl}}/events?state=all&city=Lismore&category=1`.
4. To demonstrate the delete rule by hand: `DELETE {{baseUrl}}/events/1` must
   answer **409**, and `DELETE {{baseUrl}}/events/9` - a past event with no
   registrations - must answer **204**. Run them in that order so the 204 is
   repeatable (or reload the SQL dump afterwards). The same rule is shown from
   both sides inside the collection, first with the event it created and then
   with the registration removed.
5. Add a test script to the search request:

```javascript
pm.test('status is 200', () => pm.response.to.have.status(200));
pm.test('envelope is successful', () => pm.expect(pm.response.json().success).to.be.true);
pm.test('every event is in the requested category', () => {
  pm.response.json().data.forEach((event) => pm.expect(event.categoryId).to.eql(1));
});
```

A write request needs one extra assertion, because a 201 is only correct if the
resource really exists afterwards:

```javascript
pm.test('created a new event', () => pm.response.to.have.status(201));
pm.test('the Location header points at the new event', () => {
  pm.expect(pm.response.headers.get('Location')).to.match(/^\/api\/events\/\d+$/);
});
```

6. To populate the request body, choose **Body > raw > JSON**. A `POST` with no
   `Content-Type` header arrives as an empty body and is answered with the
   400 "required" list, which is a behaviour worth seeing once.

### Automated suite

```bash
node tests/run-tests.js
```

The suite starts its own API instance, then runs four groups of checks: the two
**A2 groups** (HTTP and DOM) are the original **64 checks** - two of them were
necessarily updated for A3, because A2 asserted that `POST /api/events` was not
routed and that Register opened an "under construction" dialog, and neither is
true any more - and the two A3 groups add the write endpoints above plus DOM
checks for the new pages. The A3 group exercises **both halves of the delete
rule**: an event with registrations is refused with a 409, then the
registrations are removed and the same event is deleted successfully. Checking
it from both sides is what proves the block is caused by the registrations
rather than by something else.

```bash
set TEST_DATA_SOURCE=mysql && node tests/run-tests.js
```

runs the same checks against the real MySQL database, which is how the MySQL and
offline repositories are shown to behave identically.
