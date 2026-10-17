# Demo video script (maximum 15 minutes)

PROG2002 Web Development II - **Assessment 3**

The brief still requires the video to answer **three questions**, and A3 adds one
condition: the video must focus on **your own contribution**, so it is better to
explain fewer things properly than to tour every file. The timing plan below adds
up to 15:00 with the A3 material included.

| Section | Time | Content | Question |
| --- | --- | --- | --- |
| 0 | 0:00 - 0:40 | Introduction | - |
| 1 | 0:40 - 2:30 | The new table and why it is shaped that way | Q1 |
| 2 | 2:30 - 4:30 | The full C.R.U.D. cycle in Postman | Q1 |
| 3 | 4:30 - 6:00 | The delete data-integrity rule, blocked **and** allowed | Q1 |
| 4 | 6:00 - 9:00 | Data flow: the registration page, end to end | Q2 |
| 5 | 9:00 - 11:00 | The public pages: home, the new location box, the registrations table and the four weather states | Q3 |
| 6 | 11:00 - 13:30 | The admin website | Q3 |
| 7 | 13:30 - 15:00 | Work progress, tests, deployment, closing | - |

If you are running short, cut the **home and search tour** (inside section 5)
first - it was the centrepiece of the A2 video and it is already documented - but
keep the forty seconds on the **location box**, because that control is new this
round and it is the one interaction a marker can see working. Never cut section
3: the delete rule is the A3 requirement the brief singles out.

---

## Before you record - checklist

Mechanics are in `docs/video-recording-guide.md` (OBS setup, exact URLs,
troubleshooting). The short version:

- [ ] MySQL is running and `charityevents_db` exists
      (`SELECT COUNT(*) FROM events;` returns 11,
      `SELECT COUNT(*) FROM event_registrations;` returns 20, and
      `SELECT SUM(tickets_purchased) FROM event_registrations;` returns 49). If
      `api/.env` says `DATA_SOURCE=local` the demo still works with no database
      server at all - the API then answers from the generated mirror of
      `database/02_seed.sql` - but say on camera which one you are showing
- [ ] **The demo date is pinned.** Every beat below was checked with the demo
      clock pinned to **2026-10-17**: put `DEMO_TODAY=2026-10-17` in `api/.env`
      and restart (it ships commented out, so otherwise the API uses the real
      clock). On that date six public events are upcoming, four are past, and
      *Coastal Stars Gala Dinner* on 24 October is the only public event inside
      Open-Meteo's sixteen-day window - which is what makes the weather beat in
      section 5 possible
- [ ] **The SQL dump was reloaded after the last demonstration**, so event 9
      still exists and can be deleted on camera, and the suspended event is named
      **Midnight Desert Auction**. A database that has been edited by hand during
      earlier practice may carry a suffix in the name such as "(suspended)", and
      a renamed event is confusing to explain on camera
- [ ] Everything is running: **`npm start`** from the project root, which
      compiles the TypeScript API, builds both Angular applications if either has
      not been built yet, and serves the API on 3000, the public site on 4200 and
      the admin site on 4300. It recompiles `api/dist/` on every start, which is
      what makes the API behaviour in this script the behaviour you will see
- [ ] **OBS Studio** open on the `Demo` scene, and the microphone bar moves when you talk
- [ ] Browser tabs open in this order:
   1. `http://localhost:4200/` (home)
   2. `http://localhost:4200/search` (search, and the location box)
   3. `http://localhost:4200/events/2` (event detail - registrations table and the forecast)
   4. `http://localhost:4200/register/2` (registration page)
   5. `http://localhost:4300/` (admin dashboard)
   6. `http://localhost:4300/events` (admin event list, for the delete)
   7. `http://localhost:3000/api/events/2` (raw JSON, showing `registrations`)

   The weather beat also visits `/events/1` (finished), `/events/3` (more than
   sixteen days away) and `/events/8` (the online venue, which has no coordinates).
   Open them as tabs or type them when you get there - they are the proof that the
   weather module now explains itself instead of vanishing.
- [ ] **MySQL Workbench** connected to `charityevents_db`, SCHEMAS expanded so Tables and Views are both visible - seven tables and five views
- [ ] **Postman** with the collection imported:
      `docs/postman/PROG2002-A2-Charity-Events-API.postman_collection.json`
      (the A2 read requests plus the **Assessment 3 - the write endpoints**
      folder, which ends with **Validation of the ticket allocation**)
- [ ] VS Code open on the project, with these files one keystroke away:
      `api/server.ts`, `api/src/routes/apiRoutes.ts`,
      `api/src/services/eventWriteService.ts`, `api/src/services/eventService.ts`,
      `api/src/db/event_db.ts`,
      `api/src/repositories/write.repository.mysql.ts`,
      `api/src/repositories/ticket-names.ts`,
      `clientside/src/app/pages/register/register.ts`,
      `clientside/src/app/pages/search/search.ts`,
      `adminside/src/app/pages/event-list/event-list.ts`
- [ ] Notifications off (`Win`+`A` > Do not disturb), other applications closed
- [ ] Browser zoom 110-125%, bookmarks bar hidden
- [ ] Have your GitHub repository open in one tab to show the commit history
- [ ] Have `docs/submission-checklist.md` open in another tab to confirm the
      deployed URLs at the end
- [ ] **Both sites are actually deployed on both hosts** (checklist section
      **E**). Both submission hosts - `https://24832481.it.scu.edu.au/` and
      `https://24832546.it.scu.edu.au/` - serve the public site at the site root,
      the admin site under `/admin/`, and their own API under
      `/charity-events-api/api`, and both pass all 28 deployment checks. If you
      are showing the deployed URLs, show the one that belongs to the student
      whose submission this is; do not claim a deployment that has not happened
- [ ] Speak slowly, and state your name and student number at the start

**Practice once without recording.** The most common reason for losing marks is
running out of time while explaining the wrong thing - the three required
questions matter more than the visual tour, and A3 adds the marks for showing
your own contribution clearly.

---

## 0:00 - 0:40 | Introduction

> "Hello, my name is _[name]_, student number _[number]_. This is my
> Assessment 3 submission for PROG2002 Web Development II.

> I have built a dynamic charity events website with five parts: a MySQL
> database called `charityevents_db`, a RESTful API built with NodeJS and
> Express and written in TypeScript, a client-side website built as an Angular 22
> application, a second **admin** Angular application for staff, and the
> deployment of both sites. The two applications share one TypeScript library.

> Assessment 2 already had the home, search and event pages working from the
> read-only API. For Assessment 3 I migrated the whole project to TypeScript and
> Angular, added the event registration table and the full C.R.U.D. cycle, a
> registration page that really writes to the database, and the admin site that
> creates, updates and deletes events. That is what this video demonstrates."

---

## 0:40 - 2:30 | Question 1: Database and API architecture (ULO3: Plan and design)

### 0:40 - 1:40 | The new table and why it is shaped that way

**Show:** MySQL Workbench with `charityevents_db` expanded, showing **Tables**
(seven) and **Views** (five). Then `database/01_schema.sql`, section 7,
`event_registrations`.

> "Assessment 3 asked for one new table, `event_registrations`. It records who
> registered for which event.

> Three design decisions in it are worth explaining, because each one is a rule
> from the brief expressed as a constraint rather than as code.

> First, the unique key. It is on the **pair** `(event_id, attendee_email)`, not
> on the email alone. The brief says a user may register for multiple events but
> can only register for an event once. A unique key on the email alone would
> break the first half of that sentence: the same person could never register
> for a second event. On the pair, the same email twice for event one is a
> duplicate, and the same email for event one and event two is fine.

> Second, the ticket tier. `ticket_type_id` is nullable - so "general entry" is
> allowed - and its foreign key guarantees that the chosen tier **exists**. The
> stronger rule, that the tier belongs to the *same* event as the registration, is
> enforced by the API instead: the natural composite key on
> `(event_id, ticket_type_id)` is refused by MySQL here (`ERROR 6125`, because
> `ticket_types` already has a unique index sharing that leading column, and
> `ERROR 3109`, which rules out the generated-column workaround). The reasoning is
> recorded as a comment beside the constraint, and question 9 below is the answer
> to give if you are asked.

> Third, `event_id` is `ON DELETE RESTRICT`. That is the database-level half of
> the rule 'an event can only be deleted when it has not yet received any
> registrations'. I will show that working in a moment.

> The other columns mirror what the brief says to store: the attendee's name,
> email, optional phone, the number of tickets purchased, the date of
> registration, and a notes field. The email and the phone are stored because the
> brief asks for them - and they are **not** published: the public event page
> receives a masked display name instead, which I will show in section 5."

**Do:** in Workbench, open a new SQL tab and run (the blue **Run** button, top
right):

```sql
USE charityevents_db;

-- the table exists and holds the seeded rows
SELECT COUNT(*) AS registrations FROM event_registrations;      -- 20
SELECT SUM(tickets_purchased) AS tickets_sold FROM event_registrations;  -- 49

-- the unique key IS the rule from the brief: this must fail
INSERT INTO event_registrations (event_id, attendee_name, attendee_email, tickets_purchased)
VALUES (1, 'Duplicate Tester', 'amelia.hartley@example.com', 1);
```

> "That insert fails with duplicate entry for key `uq_registration_event_email`.
> That error is the brief's rule, enforced by the database itself - not by the
> website and not by the API."

### 1:40 - 2:30 | The views and the TypeScript connection file

**Show:** the five views in the SCHEMAS panel, then `api/src/db/event_db.ts`.

> "The same one-place-for-each-rule idea applies to the views, and this file now
> defines five. `vw_event_columns` holds every event column joined to its lookups
> plus `registration_count` and `tickets_sold`; `vw_public_events` is now one line
> - `SELECT * FROM vw_event_columns WHERE status = 'active'` - so the public rule
> is unchanged; `vw_all_events` is the same rows without the status filter, and
> only the admin site reads it; and `vw_event_registrations` adds the ticket name,
> the price and a computed `total_amount` to each registration. Because both
> listings share one column list, they cannot drift apart.

> `event_db.ts` is still the required file that connects Node to MySQL, and it is
> TypeScript now. It uses a connection pool, and A3 added one thing: a
> `transaction()` helper. It hands a callback one connection inside BEGIN and
> COMMIT and rolls back if the callback throws. Every write that touches more than
> one row uses it - creating an event with its ticket tiers, replacing those
> tiers, both registration writes, and the delete rule I will show in a moment.

> Its `ping()` also reports whether the `event_registrations` table exists, so
> `GET /api/health` answers 'was the new table created?' in one request. On the
> local run the dashboard reports twelve objects in the schema: the seven tables
> and five views.

> The compiled JavaScript is what actually runs: `api/server.ts` and everything
> under `api/src/` are compiled by `tsc` into `api/dist/`, and `api/dist/server.js`
> is the entry point - locally and on the cPanel, whose Node version cannot run
> TypeScript directly."

---

## 2:30 - 4:30 | Question 1 continued: the full C.R.U.D. cycle

**Show:** `api/src/routes/apiRoutes.ts`.

> "My API follows a layered structure: routes decide the URL, controllers deal
> with HTTP, services validate and hold the business rules, repositories hold the
> SQL, and `event_db.ts` talks to MySQL. A layer only knows the layer below it -
> that is what let the whole `api/src` tree be converted to TypeScript without a
> single behavioural change.

> Assessment 2 was read-only. Assessment 3 completes the C.R.U.D. cycle:
> `POST /api/events` to create, `PUT /api/events/:id` to update,
> `DELETE /api/events/:id` to delete, plus the registration endpoints. The write
> handlers are mounted twice - under `/api/events` and under `/api/admin/events` -
> and both mounts call the same controller, so there is exactly one
> implementation of each rule. The admin mount exists because the admin list must
> include suspended events, and hiding that behind `/api/admin` means a public
> caller cannot reach it by accident."

**Show:** Postman. First `GET /events/1`, and point at the new part of the body.

In Postman this is already there, under **Event detail**:

```
/events/{{eventId}}  (full detail)      a GET, and {{eventId}} = 1
```

Every request in this section is in the collection
`docs/postman/PROG2002-A2-Charity-Events-API.postman_collection.json`, so nothing
has to be built by hand. Two things make that possible:

- **The requests use collection variables, not literal ids.** `{{newEventId}}`
  holds the id of the event the create request just made, and
  `{{registrationId}}` holds the id of the registration just created. The create
  and register requests have a test script that saves them, so the ids chain from
  one request to the next and no URL has to be edited between steps.
- **The order matters.** `{{newEventId}}` is empty until the create request has
  run, so the A3 folder is run from its first request onwards, in the order
  listed. The whole collection can also be run top to bottom with the Collection
  Runner.

Only step 5 needs a hand: reuse the step 4 request and replace its JSON body with
the four words on the right. Put the body back before step 6.

| Step | Folder and request | Expect |
| --- | --- | --- |
| 1 | `Event detail` -> `/events/{{eventId}}  (full detail)` | 200 |
| 2 | `Assessment 3 - the write endpoints` -> `Events` -> `POST /events  (create, and save the id)` | 201 |
| 3 | `Events` -> `POST /events  (missing required fields)  -> 400` | 400 |
| 4 | `Events` -> `PUT /events/{{newEventId}}  (partial update, two fields)` | 200 |
| 5 | `Events` -> the same `PUT`, body replaced with `{"dateStart": "2027-06-01"}` | 400 |
| 6 | `Registrations` -> `POST /events/{{newEventId}}/registrations  (register, and save the id)` | 201 |
| 7 | `Registrations` -> same request, sent again unchanged | 409 |
| 8 | `Registrations` -> `DELETE /events/{{newEventId}}  (blocked while it has registrations)` | 409 |
| 9 | `Registrations` -> `DELETE /registrations/{{registrationId}}  (204, unblock the event)` | 204 |
| 10 | `Registrations` -> `DELETE /events/{{newEventId}}  (204, the event that was created)` | 204 |

Steps 8 and 10 are the same endpoint on the same event; only the registration in
between changes, which is the comparison worth pointing at. Step 5 writes
nothing - it is refused - so the chain is unaffected by doing it.

> "The detail endpoint now also returns this event's registrations, ordered by
> `registered_at` descending - the brief asks for 'sorted by the latest date when
> the tickets were purchased' - with `ticketName`, `ticketPrice` and a computed
> `totalAmount`. The id is the tie-breaker, so two registrations made in the same
> second still order predictably. Those rows carry a masked display name and no
> email or phone at all, which is the privacy decision I will come back to."

**Do:** in `Events`, send `POST /events  (create, and save the id)`.

> "This is the create endpoint. It answers **201 Created** with a `Location`
> header pointing at the new resource - `/api/events/12` on a freshly reloaded
> database - which is the RESTful way to say 'it exists and here is where'. The
> body is the created event, read back through the admin view, so a create
> response looks exactly like a later read of the same event.

> That id is saved into the `{{newEventId}}` collection variable by this
> request's test script, which is why every later request can refer to it
> without me editing a URL."

**Do:** in `Events`, send `POST /events  (missing required fields)  -> 400`, then
point at the `details` array.

> "The validation collects **every** problem and returns one 400 with a
> `details` array: the field and the message for each one. The admin form paints
> each message next to its own control, so staff fix the form in one pass instead
> of playing error whack-a-mole."

**Do:** in `Events`, send `PUT /events/{{newEventId}}  (partial update, two fields)`
- it sends only `{ "goalAmount": 9000, "capacity": 200 }`, against the event the
create request made with `goalAmount: 8000` and `capacity: 180`.

> "An update is **partial**: only the fields in the body are validated and
> changed. Here just the goal and the capacity changed; the dates, the venue, the
> description and the ticket tiers are untouched. The admin update page uses
> exactly this - it sends only the fields the user edited."

**Do:** send the same request again with its body replaced by
`{ "dateStart": "2027-06-01" }`. Nothing else changes.

> "**400**, and the detail names `dateEnd`: *the end date cannot be earlier than
> the start date*. That is worth showing because the database cannot catch it
> here. A partial update sends one field, so the service reads the stored row,
> lays the change over it, and checks the pair it is about to create - otherwise
> the row would end up with a start in 2027 and the end date it already had in
> 2026. The schema declares `CHECK (date_end >= date_start)`, but the cPanel host
> runs MySQL 5.7, which parses a CHECK constraint and then ignores it, so on the
> deployed database the application layer is the only guard."

**If time allows, three more answers worth knowing:**

- `GET /api/admin/events?publishStatus=past` - type it into the URL field of the
  `Admin view` request - is a **400** that names the allowed values
  (`active, suspended, cancelled, all`). It used to be accepted and silently
  treated as "all", which told the caller that every event had a status none of
  them had. `?audience=publicly` is refused the same way, naming `public, admin`.
- The `Validation of the ticket allocation` folder creates a small event whose
  only tier has a single place, then asks for 20 tickets: **400**, *Only 1
  ticket of "Last place" remain, but 20 were requested.* The check runs again
  inside the write transaction with the tier row locked, so two people buying
  the last ticket at the same moment cannot both succeed. And two ticket tiers
  that differ only by an accent - `Café` and `Cafe` - are refused with a
  **409**, because the column's collation is accent-insensitive; that rule
  lives in `api/src/repositories/ticket-names.ts` so the offline mirror and
  MySQL give the same answer.
- Point at Postman's **Headers** tab: every response carries
  `X-RateLimit-Limit`, `X-RateLimit-Remaining` and `X-RateLimit-Reset`, the reset
  included on the first response of a window and not only the later ones.

**If time allows, show the registration endpoints:**

**Do:** in `Registrations`, send
`POST /events/{{newEventId}}/registrations  (register, and save the id)`, then
send the same request again unchanged.

> "A registration is created inside the event it belongs to, which is why the URL
> is `/events/{{newEventId}}/registrations` rather than a verb. The first attempt
> is a 201 with a `Location`, and it saves the new id into `{{registrationId}}`.
> The second attempt is a **409 Conflict**: that email has already registered for
> this event. Same email, different event would be allowed - that is the pair rule
> from the schema, and the API checks it first so the user gets a readable message
> instead of a raw duplicate-key error."

---

## 4:30 - 6:00 | Question 1 continued: the delete data-integrity rule, live

This is the A3 requirement the brief singles out, and the one to demonstrate in
**both** directions.

### 4:30 - 5:00 | The code behind it

**Show:** `api/src/repositories/write.repository.mysql.ts`, `deleteEvent()`, then
`api/src/services/eventWriteService.ts`, `deleteEvent()`.

> "The rule is: an event that has received registrations must not be deleted.
> The check and the delete run inside **one transaction**. I select the event row
> `FOR UPDATE`, which locks it, then count the registrations, and only delete
> when the count is zero.

> The lock is the important part. Without it, two requests could interleave:
> request A counts zero registrations, request B inserts one, request A deletes
> the event, and the new registration is orphaned. Locking the row first means
> the count cannot go stale between the check and the delete.

> When the count is not zero nothing was written, so the transaction simply ends
> and the service answers **409 Conflict**. 409 rather than 400: the request is
> perfectly well formed and the event exists, but the current state of the data
> means it cannot be carried out."

### 5:00 - 5:30 | The blocked delete

**Do:** in `Registrations`, send
`DELETE /events/{{newEventId}}  (blocked while it has registrations)`.

The event was created earlier in this demo and now has one registration, so the
url's `{{newEventId}}` resolves to it and nothing has to be typed in. The same
request also works against a seeded event that has registrations - send
`DELETE /events/1` (four registrations) if you would rather show a seeded one,
but that means editing the URL for this step only.

> "**409 Conflict.** The message names the event and the number of
> registrations, and it tells the user what to do instead: set the status to
> suspended. There is also a machine-readable part - `details.suggestion` is
> `suspend-instead` - which is what lets the admin page offer the alternative as
> a link rather than just printing text."

### 5:30 - 6:00 | The successful delete, and the second line of defence

**Do:** in `Registrations`, send
`DELETE /registrations/{{registrationId}}  (204, unblock the event)`, then send
`DELETE /events/{{newEventId}}  (204, the event that was created)`.

The first request removes the registration that was blocking the delete; the
second is the **same endpoint that answered 409 a moment ago**, on the same
event. Nothing else changed, which is the point.

> "**204 No Content**, which is the RESTful answer to 'it is gone'. A 204 carries
> no body, so the outcome is repeated in headers the client can read:
> `X-Deleted-Event-Id` and `X-Deleted-Event-Name`, and those headers are listed
> in `Access-Control-Expose-Headers` - otherwise the browser would hide them from
> the page.

> Both directions use events I control. The blocked delete hits the event this
> demo created, and the successful one deletes that same event once its
> registration is gone, so the seeded data is left exactly as it was found -
> which is also what lets the whole collection be run top to bottom.

> One more point about the block. Suppose I deleted that check from the code
> entirely. MySQL would still refuse, because the foreign key is
> `ON DELETE RESTRICT`: the registration rows point at the event, so the event
> cannot disappear. The answer would change, though: the delete path does not
> translate the driver error `ER_ROW_IS_REFERENCED_2`, so that refusal would
> come back as a 500 rather than the 409 the count check produces. The data is
> protected either way - only the response differs. As the code stands, the API
> never reaches the foreign key: the count and the delete share the transaction
> that holds the event row locked, so no registration can appear between them."

---

## 6:00 - 9:00 | Question 2: Data flow and interaction between the API and the website (ULO1 and ULO3)

**Show:** split screen - `clientside/src/app/pages/register/register.ts` and the
browser with DevTools open on the **Network** tab.

> "This question is about how a click in the browser becomes data in the
> database. I will follow one registration from start to finish, then summarise
> the read path that Assessment 2 already demonstrated.

> Two files carry this page: the component, `register.ts`, which owns the form
> and the screen states, and its template `register.html`. Everything that talks
> to the server goes through one shared service,
> `shared/src/api/api.service.ts` - no component calls `fetch` directly."

### 6:00 - 6:40 | Step 1: which event, and reading the form

**Show:** `register.ts`, `loadEvent()` and the `RegistrationForm` value.

> "Registration is per event, so the event id travels in the route:
> `/register/2`. The component reads it once from the route's parameters and
> loads the event with `GET /api/events/2`, so the visitor sees what they are
> registering for - name, date, venue, price - before they type anything.

> There is deliberately no route for a bare `/register`: a form that cannot know
> what it is registering for is worse than an honest answer, so the catch-all
> route shows the friendly 404 instead. And `/register/1` - a finished event -
> answers with the closed panel rather than a form, which is the same rule from
> the other side.

> The form is one object held in an Angular signal - name, email, phone, date of
> registration, ticket type, number of tickets and notes - which is one control
> per stored column. The ticket dropdown is built from **this** event's tiers
> only, and the running total is a `computed` value over the selected tier and
> the quantity, so it cannot go stale: there is no 'update the total' call
> anywhere.

> Two details on screen are worth naming because they are deliberate. The ticket
> count is a stepper - one value between a minus and a plus button - rather than
> a number box, because the two legal answers are 'one more' and 'one fewer'. And
> the dropdown opens on a tier the visitor can actually buy: on this event it is
> **Single Seat - $185.00, 196 available**, with the total underneath already
> reading *Total: 1 x $185.00 = $185*, while the second tier, Table of Ten, is
> labelled **Sold out** and cannot be chosen."

### 6:40 - 7:20 | Step 2: client-side validation

**Do:** submit the empty form, then type an invalid email and a bad phone number.

> "Nothing was sent - the Network tab is still empty. Each problem is written
> next to its own field, a summary with `role="alert"` appears and takes focus,
> and the first problem is scrolled into view. That is the accessibility pattern:
> a screen reader announces the summary, and the focus movement takes the user to
> the message rather than leaving them to hunt for it.

> Validating in the browser is for the visitor's benefit. The server never trusts
> it - it validates the same rules again, and so does the database."

### 7:20 - 8:10 | Step 3: the request

**Show:** `shared/src/api/api.service.ts`, `ApiService.send()` and
`createRegistration()`.

> "`ApiService` is the only place in either application that talks to the server.
> It builds the URL from an injected `API_BASE_URL` token - that is how one shared
> library serves two applications that have different API addresses - and it puts
> a ten-second `timeout` on every call, so a slow API can never leave a page
> spinning forever.

> It also unwraps the API's `{ success, meta, data }` envelope in that one place,
> and normalises **every** failure into one `ApiError` type: a timeout, a 400 with
> per-field details, a 409, or the API being unreachable. The components never
> see an envelope and never see a raw HTTP error, so there is exactly one error
> shape to render.

> A 204 - a delete - resolves to `null` rather than trying to parse an empty body.

> Underneath, `HttpClient` returns an Observable, and the component subscribes to
> it; the request is a normal XMLHttpRequest, which is what the Network tab is
> showing."

**Do:** submit the valid form and point at the `POST .../registrations` request:
status 201, the `Location` response header, and the JSON body.

> "Here is the request in the Network tab: 201 Created, a `Location` header, and
> the stored row coming back - including the id the database assigned and the
> `totalAmount` it computed from the tier price."

### 8:10 - 9:00 | Step 4: the confirmation, and the read path in one sentence

**Show:** the confirmation card on the page.

> "The form is replaced by a confirmation card built from the **API response**,
> not from what the form thought it sent - the receipt rows are computed from the
> registration the API returned. The receipt on screen is the record the database
> holds, which is why I can claim the write really happened.

> A failure takes the other branch: `ApiError` carries the status and the details
> array, `fieldErrorMap` puts each message on the control that produced it, and a
> 409 - this email already registered for this event - is shown beside the email
> field using our **own translated** sentence, so a visitor reading the site in
> Chinese, Vietnamese or Japanese is not handed an English sentence by the server.
> (The API's message for this conflict is always English, which is why the
> dictionary key exists in all four languages.)

> The read path is the same shape in reverse and A2 demonstrated it: the search
> page turns its filter form into the API's query parameters and calls the same
> service, and one shared component, `event-card.ts`, turns each returned event
> into the card the home page and the search page both use. One renderer, two
> pages."

---

## 9:00 - 11:00 | Question 3: Website functionality demo (ULO3: complete dynamic website)

### 9:00 - 9:35 | Home and search, and the location box that is now a real combobox

**Show:** `http://localhost:4200/`, then `/search`.

> "The home page mixes static organisation content with a dynamic listing from
> `GET /api/events/upcoming`: name, category, date, venue, price and a live
> progress bar. Six events are on it today, and no past event and no suspended
> event appears, because the public endpoints read the view that fixes
> `status = 'active'`.

> The search page filters by date, location and category, singly or combined,
> with removable chips and a Clear Filters button. The filters are written into
> the URL, so a search can be refreshed or shared."

**Do:** click the **City** field. The suggestion panel opens **downward**, under
the field, with two headings - **Cities** first, then **Venues** - and fifteen
entries in all. Type `Lis`: the list narrows to Lismore, Lismore City Hall and
Lismore Riverside Park. Press Enter (or click Lismore).

> "This is the one control I changed most this round, and the reason is what it
> used to be. It was a native `<select>`, and a native dropdown is drawn by the
> browser: near the bottom of the window it opens **upward**, over its own label
> and the date fields - which is exactly what happened on a laptop screen. It also
> said 'Start typing, e.g. Lis' under a control nobody could type into.

> It is now a real combobox: typing filters its own list, the list is grouped into
> cities and venues, and it opens downward because the page owns the list rather
> than the browser. Picking Lismore applies the filter at once - the chip appears
> above the results and one event matches - and typing on its own applies nothing,
> because a half-typed word is not a filter the visitor has chosen.

> The date fields next to it are still native `<input type="date">`, so their
> placeholder is painted by the **browser** - `mm/dd/yyyy` or `yyyy/mm/日`,
> depending on the browser's locale and not on the language you pick in the header.
> No attribute changes that, so the page shows a valid example underneath instead.
> The value it submits is always `yyyy-mm-dd`."

**Do:** scroll to the very bottom of the home page, then back up past two section
boundaries.

> "One thing that changed on every public page is the vertical rhythm. Between one
> section's content and the next the gap is **96 pixels** - 40 of padding below one
> block and 56 above the next - and the footer begins 64 pixels below the last
> block. It is all padding and no outer margins, which is what removed the
> half-screen gap above the footer: a margin there used to stack on two paddings
> and measured **193 pixels** of nothing on this page."

**Show:** the language picker in the header. Switch to 中文, then back to English.

> "Two things are worth watching while the language changes. The header does not
> move: the labels never wrap, the bar is the same height in all four languages,
> and the language picker and the theme button stay exactly where they are. The
> sentence that explains the switch now sits in a band **below** the header, where
> it cannot push anything around - before, it was a second line inside the header
> that only three languages rendered, so the header grew by up to twenty-four
> pixels and the menu moved.

> And that sentence is the honest limit of the translation. The **interface** is
> translated into four languages - 298 keys on this site, 252 on the admin site,
> identical keys in every language, down to each page's browser tab title and the
> home page's mission sentence - and a checker fails the build if an English word
> is left inside a Chinese, Vietnamese or Japanese value, or if a user-facing string
> is written into a template instead of a dictionary. The **content** - event names,
> descriptions, venues, organisers - comes from the database in English, because
> that is how the brief defines the data. Look at the tab while we are on the
> Chinese event page: it reads the event's English name, then a Chinese
> 'Unity Heart Foundation' - content first, interface second, in one title. The
> site says which is which, in the visitor's language, rather than pretending
> everything is translated."

### 9:35 - 10:20 | The event page: registrations, privacy, and the registration link

**Show:** `http://localhost:4200/events/2`, scrolled to the registrations panel.

> "The Register button is a real router link to the registration route with this
> event's id - the A2 'under construction' dialog is gone, because the feature
> exists. A past event shows a disabled button instead of a link that would only
> fail.

> Below the tickets is the registrations panel: an actual `<table>` with a
> caption for screen readers and `scope` on the headings. Each row is one
> registration - the backer, the ticket type, how many tickets, what they are
> worth and when they were bought - newest purchase first, with a totals footer.
> Three registrations have taken fourteen tickets, worth seventeen thousand two
> hundred and forty dollars, and the hero reports both figures by name:
> '3 registrations · 14 tickets sold'.

> The names are masked on purpose: the table reads **Grace T.**, not the full name
> that is in the database, and it carries no email address and no phone number at
> all - not hidden by the page, absent from the response. This page is public and
> anonymous, so the API projects an `attendeeDisplayName` and omits the contact
> columns; the page says so in one sentence under the heading, and staff still get
> the full details from the admin screens. That is data minimisation under the
> Australian Privacy Principles, and it is the sentence to have ready if you are
> asked why the table used to show more.

> The list is not re-sorted in the browser: the API returns it in
> `registered_at` descending order and the page renders it in the order it
> arrived, so there is only one place that owns that rule."

**Do:** point at the order of the rows, then run in Workbench:

```sql
SELECT registration_id, attendee_name, registered_at
  FROM event_registrations WHERE event_id = 1
 ORDER BY registered_at DESC, registration_id DESC;
```

> "Same order as the page, because it is the same rule: `registered_at`
> descending, with the id breaking ties. And the same table is what proves the
> masking: the database says 'Grace Tan', the page says 'Grace T.'"

**Show:** `http://localhost:3000/api/events/1` in the browser (tab 7 shows event
2; either one works).

> "The raw JSON shows the same thing: each registration carries
> `attendeeName` and `attendeeDisplayName`, and no `attendeeEmail` or
> `attendeePhone` key appears anywhere. The admin endpoint asks for them
> explicitly, which is why the staff pages still have them."

### 10:20 - 11:00 | The optional external API, in all four of its states

**Show:** the weather panel on `http://localhost:4200/events/2` (scroll up to the
middle column).

> "The brief allows an optional external API, so every event page carries a weather
> module for the day of the event, from Open-Meteo. No API key and no registration
> are needed, which matters because nothing secret has to be shipped to the marker.

> The integration is in `shared/src/weather/weather.service.ts`: it takes the
> venue's latitude and longitude and the event date and asks for one day in the
> Sydney timezone - the weather code, the temperature range, the rain chance and the
> wind. The WMO codes are mapped to translation keys in `weather.model.ts`, so the
> panel follows the language switcher.

> This is the only event whose page can show a forecast today, because it is the
> only public event inside Open-Meteo's sixteen-day window - the one other event
> that close is the suspended auction, which has no public page. The panel reads
> partly cloudy, a high of twenty-seven and a low of sixteen, a sixty-seven per cent
> chance of rain and twenty-two kilometres an hour of wind when I checked. The
> figures move with the real forecast; the module does not.

> The module is **always there** now, and that is the change this round. It used to
> be wrapped in a condition, so nine of the ten public event pages carried no
> weather module at all and a visitor could not tell 'this event is too far ahead'
> from 'this page is broken'. It now names which of the four cases it is. Let me
> show you the other three."

**Do:** open `/events/1` (finished), `/events/3` (more than sixteen days away) and
`/events/8` (the online venue).

> "`/events/1` has already happened, so the module says *this event has already
> finished, so there is no forecast to show*. `/events/3` is more than sixteen days
> away, and it says so with the number in it - read from the same configuration
> value the rule uses, not typed into four translations. `/events/8` is the online
> venue: it has no map coordinates at all, so the module says that. And while a
> forecast is being fetched it says 'loading', because the page distinguishes 'still
> loading' from 'there is nothing to show'.

> The service resolves `null` for every failure - no coordinates, out of range, a
> past date, or Open-Meteo unreachable - so a bonus feature can never break the
> page. The module is quiet about all four: no alert, no error panel, one sentence.
> The same service drives the live preview on the admin form, which I will show in
> a moment."

---

## 11:00 - 13:30 | Question 3 continued: the admin website (Part 4)

**Show:** `http://localhost:4300/`.

> "Assessment 3 also asks for an admin-side website. It is a **separate Angular
> application**, served on its own port - there is no second command and no
> second API. It is separate because its audience and its data view are
> different, not because its code is: it imports the same `shared/` library - the
> API layer, the models, the translation service, the theme service and the
> formatters - so the design tokens and the dark theme work here too, and it adds
> only its own layout, its own routing table and its own dictionary.

> The menu is defined once in the application shell - `app.html` plus the
> `admin-header` and `admin-nav` components - so no page can forget it, and the
> header carries the same language and theme controls as the public site. The
> menu also pins now: while the table scrolls, the header goes up and the menu
> stays at the top of the window. It did not before - it is a sticky element
> whose containing block was its own wrapper, so it scrolled away with the
> header and `top: 0` never took effect.

> The dashboard in front of you is the summary: six upcoming events, eight
> categories, six organisations, ninety-nine thousand two hundred and ninety
> dollars raised, twenty registrations and forty-nine tickets sold - and a card
> that needs attention, because Midnight Desert Auction is suspended and
> deliberately not on the public website."

### 11:00 - 11:40 | The list: every event, regardless of status

**Show:** `http://localhost:4300/events`.

> "This is the requirement that the public API cannot satisfy: a complete list of
> all events regardless of status. It reads `GET /api/admin/events`, which uses
> `vw_all_events` instead of the public view, so the suspended event and the past
> events are all here - eleven of eleven.

> Each row shows the id, the event with its category and organisation, the
> publishing status and the derived upcoming or past state, the dates, the venue,
> registrations against capacity, tickets sold, and the actions. The filters
> narrow by status, time and keyword - and they are written into the URL, so a
> filtered view can be refreshed or shared - and the footer totals the page.

> The 'sold' column is worth pointing out: it comes from the view's
> `registration_count` and `tickets_sold`, so listing eleven events is still one
> query rather than eleven."

### 11:40 - 12:20 | Create and update

**Show:** `http://localhost:4300/events/new`.

> "The create form is not hand-written markup per field: the reactive form is
> built once by `createEventForm()` in `adminside/src/app/core/event-form.ts`,
> and one shared component, `event-form`, renders it - so the create page and the
> update page cannot drift apart. The dropdowns are filled from
> `GET /api/admin/reference-data` - organisations, categories and venues in one
> request - and the form is only drawn once those lists arrive, which is what
> stops a typo becoming a foreign-key error.

> The layout was reworked this round and the screen shows it. The page title and
> the form start on the **same left edge** - 'Add a charity event' sits directly
> above the first field rather than centred over the page. The form is two
> columns whose **first controls line up**: Event name on the left and the
> publishing status on the right begin at the same height. The ticket rows run the
> **full width** underneath both columns. And the right column **follows the
> scroll**, with the save button in it, so Save is on screen at every scroll
> position instead of about sixteen hundred pixels down the form, which is where
> it used to be. There is no 'Clear the form' button any more: one misclick
> destroyed everything typed.

> Three smaller things are visible too. 'This is a free event' now sits directly
> above the ticket types it governs - it used to be three sections away under the
> fundraising goal - and ticking it locks and zeroes every price beside it. The
> description box resizes vertically only. And the weather card in the right
> column opens with a short prompt, *choose a venue and a date to see the
> forecast*, instead of the grey 'no forecast available' paragraph it used to
> show on an empty form.

> Ticket-tier rows can be added and removed, the same client-side validation runs
> before anything is sent, and the submission is `POST /api/events`.

> Once a venue and a date are chosen, that weather card becomes the live forecast
> for them - the same Open-Meteo service the public event page uses, working
> **before the event exists in the database**. That is the point of it: staff can
> see the beach fun run is forecast to be wet and move it while it is still a
> draft."

> "The update page, `/events/2/edit`, uses the **same** form component and loads
> `GET /api/admin/events/2`, which returns a suspended event as a 200 where the
> public route would return 404 - which is what keeps a suspended event
> editable."

**Do:** change one field in `/events/2/edit` and submit, with the Network tab
open.

> "Look at the request body: only the field I changed. `changedFields()` compares
> the form against the loaded event, so the API receives a partial update and
> there is no chance of a stale value overwriting a change someone else made.
> Submitting with nothing changed is refused with a message instead of sending a
> pointless request."

**Show:** the registrations table lower down the same page.

> "The same page lists this event's registrations read-only, with a delete on
> each row, and a standing warning: registrations block the event delete. That is
> the rule made visible in the interface rather than only in the API."

### 12:20 - 13:10 | The delete, blocked with a clear message

**Do:** on `/events`, click **Delete** on event 1, then confirm.

> "The confirmation dialog is my own component, not the browser's `confirm()`, so
> it can explain what is about to happen. It calls `DELETE /api/events/1`, and
> the API answers 409."

**Show:** the warning banner with the API's message, the links, and the disabled
button on that row.

> "The banner renders the API's own message - the event name and the number of
> registrations - and lists the structured part of the response underneath it,
> including the `suggestion` the API sent: suspend it instead, by opening the
> event and setting its status to Suspended. It also links straight to the
> registrations, and it disables and relabels that row's Delete button
> ('Deletion blocked', with the reason in its tooltip), so the rule stays visible
> next to the data after the banner has been dismissed.

> That link is worth following for one second: it opens the registrations page
> filtered to this event, which is where staff go to clear the block. Twenty
> registrations are in the system, ten to a page, so the pager has two pages - the
> pager is capped at seven entries with the first and last always present when
> there are more, but with two pages you just see one and two.

> That is the whole point of returning structured details rather than a sentence:
> the client can act on the numbers instead of only printing text."

**Do:** click **Delete** on event 9, confirm, and let the list reload.

> "And here is the other half: an event with no registrations deletes cleanly, a
> success banner appears - 'Winter Lights Gala 2026 was deleted' - and the list
> reloads without it. Blocked and allowed, from the user's side."

### 13:10 - 13:30 | One styling note worth mentioning

**Show:** the admin page in dark mode (the theme button in the header).

> "One detail I want to mention because it is the kind of thing that only shows
> up in one theme: the admin heading deliberately does **not** reuse the public
> site's `.page-header` class. That class paints a `--brand-100` band, and
> `--brand-100` is a dark teal in the dark theme, so reusing it produced dark
> text on a dark band. The heading is plain text on the page background instead,
> and the reason is written in a comment beside the rule in
> `adminside/src/styles.css`."

---

## 13:30 - 15:00 | Work progress, testing and closing

### 13:30 - 14:00 | Commits

**Show:** your GitHub repository commit history.

> "I committed regularly with descriptive messages, so the history shows how the
> work was built: the database first, then the API, then the client, and for
> Assessment 3 the table and views, the write endpoints, the delete rule, the
> registration page, the admin site and the tests as separate commits - and then
> the rounds of review fixes, one commit per defect, which is why the last dozen
> commit messages each name the thing that was wrong."

### 14:00 - 14:30 | Tests and the project's own checkers

**Show:** a terminal running `npm test`.

> "I extended the automated test suite, and there are four layers now.

> `npm test` runs **131 checks**: the HTTP contract against the real Express API,
> endpoint by endpoint, plus a jsdom regression suite that loads the **archived**
> Assessment 2 frontend - it is kept under `legacy/` as the behavioural reference
> for the pages I rewrote. It starts its own API instance on its own free port,
> so it never disturbs a running server and needs no MySQL.

> The delete rule is checked from both sides: an event with registrations is
> refused with a 409, then the registrations are removed and the same event is
> deleted successfully. Checking it both ways is what proves the block is caused
> by the registrations and not by something else. `npm run test:mysql` runs the
> identical **131** checks against the real database, which is how the MySQL and
> offline repositories are shown to behave the same.

> The Angular applications are covered separately by `npm run test:e2e`, which
> drives a headless browser through both sites against the compiled API - **40**
> checks - and by `npm run check:angular`, **16** checks that fail if the
> required architecture changes: no NgModule anywhere, zoneless, every component
> with an HTML template and a doc comment, both applications importing the shared
> library, the API source being TypeScript with no `.js` left, and both
> `index.html` files still carrying the early-theme script.

> `npm run check:translations` then checks the data: **12** checks over two
> dictionaries, four languages each, 298 keys on the public site and 252 on the
> admin site, identical key sets, and the two rules I mentioned a moment ago - no
> English inside a translated value, and no user-facing string outside a
> dictionary. That is the difference between 'translated' and 'claims to be
> translated'.

> `npm run check:docs` counts the documented symbols - **249** - and
> `npm run check:contrast` measures every text element on eight pages in both
> themes against the WCAG AA contrast minimum."

### 14:30 - 15:00 | Deployment and closing

**Show:** the deployed public site and the deployed admin site in the browser,
then the three zips in the file explorer.

> "Both websites are deployed to cPanel - the public site at the site root and
> the admin site in the `admin` folder - and both point at the deployed API, which
> runs on MySQL on the host. There are two submission hosts, one per student, and
> each carries its own copy of all three parts; `npm run deploy:verify` runs 28
> checks against a host and both of them pass all 28.

> The API is uploaded as its compiled `api/dist` plus `api/package.json`, because
> the host's Node version cannot run TypeScript, and Passenger starts
> `api/dist/server.js`. The deep links work because each site directory carries
> an `.htaccess`: a real path like `/events/2` is handed to the application shell,
> while a path that looks like a missing file - a `chunk-*.js` - still returns a
> real 404 instead of the shell, which is what stops a missing file looking like a
> mysterious MIME error.

> The submission has three zips: `<username>A3-api.zip`, which carries the
> TypeScript API source and the compiled `dist/`; `<username>A3-clientside.zip`,
> the public website; and `<username>A3-adminside.zip`, the admin website. Each
> front-end archive carries the built application ready to upload plus the
> trimmed Angular workspace it can be rebuilt from. The archived Assessment 2
> frontend under `legacy/` is deliberately **not** in any of them.

> To summarise: the database now records registrations with the uniqueness and
> delete rules enforced by the schema, and stores the contact details the brief
> asks for without publishing them; the API has the full C.R.U.D. cycle with one
> transactional delete rule and one validation layer; the public site can register
> someone end to end and explains its own weather module in four languages; and a
> separate admin site can manage events. Thank you for watching."

**Stop recording.**

---

## After recording

- [ ] Watch it back with the sound on and check the three question headings are clearly answered
- [ ] Confirm the total length is **at most 15 minutes**
- [ ] Confirm the video shows the blocked delete (**409**) **and** a successful
      delete (**204**), because that pair is the A3 requirement
- [ ] Confirm the registration page is shown end to end: validation, submission,
      and the confirmation read back from the API
- [ ] Confirm the admin list visibly contains the suspended event
- [ ] Confirm the weather beat shows **four** different states - a forecast, a
      finished event, an event beyond the sixteen-day window, and a venue with no
      coordinates - and that no page shows an error panel instead of a reason
- [ ] Confirm the registrations table shows a masked name and no email address,
      and that you said out loud why
- [ ] Confirm the location box was shown opening **downward** with its two groups
- [ ] Confirm the video says what **you** built and can defend, in your own words
- [ ] Upload to SCU OneDrive, set the sharing so your marker can view it, and test the link in a private browser window
- [ ] Put the shareable link in your submission

## Likely interview questions - be ready for these

1. Why did you use a view for the public events instead of a stored status column?
2. How exactly does your search avoid SQL injection?
3. Why is `limit` capped at 100?
4. What happens if the API is offline when the home page loads?
5. How does the event id get from the home page to the detail page, and then to the registration page?
6. **Why is the unique key on `(event_id, attendee_email)` rather than on the email alone?** (Any other choice breaks "a user may register for multiple events".)
7. **What does the transaction add to the delete rule, and what would still stop a bad delete if the check were removed?** (`FOR UPDATE` prevents a registration arriving between the count and the delete; `ON DELETE RESTRICT` refuses the delete at the database level.)
8. **Why 409 and not 400 for a blocked delete?** (The request is well formed and the event exists; the *state of the data* is what prevents it.)
9. **Why is the ticket tier NOT a composite foreign key, when that would enforce the same-event rule in the database?** (Because MySQL refuses it here, for two reasons: a foreign key may not reference a unique key sharing its leading column with another unique index on that table — `ERROR 6125` — and the usual workaround, a derived key column, may not refer to an `AUTO_INCREMENT` column — `ERROR 3109`. The rule is enforced by the API instead, and the foreign key still guarantees the tier exists.)
10. **Why does the admin site read a different view from the public site?** (`vw_all_events`, because the brief requires every status; the public view stays active-only.)
11. **What happens to the weather module when there is no forecast, and why keep it on the page?** (It names the reason - finished, no coordinates, no confirmed date, or beyond the sixteen-day window - and says so in one quiet line; while a request is in flight it says it is loading. It used to be hidden, which made "no module" and "no forecast" look identical to a visitor. The service resolves `null` instead of throwing, so a bonus feature can never break the page.)
12. **Why does the public event page not show the attendee's email any more, when the table stores it?** (Data minimisation: the registration list is on a public, anonymous page, so the API projects a masked display name and omits the contact columns; staff read them from `GET /api/admin/events/:id`, which asks for them explicitly. The brief requires the data to be *stored*, not published.)
13. **What happens when an unknown `publishStatus` or `audience` reaches the API?** (A 400 naming the allowed values, in the same single 400 as every other bad parameter. Before, the value was silently replaced by the default - so the caller was told, in the shape of a successful response, that every event had a status none of them had.)
14. **Why must a partial update check the merged row rather than just the body?** (An update sends one half of a pair; the other half is what the row already holds, and on the cPanel host MySQL 5.7 ignores CHECK constraints, so the application layer is the only guard.)
15. **Which parts of the client code would you change to add a new filter?** (The `FilterForm` value and `buildQuery()` in `search.ts`, the query parameters the API accepts, and the template - the shared API service does not change.)
16. **If you had to add authentication, where would it go?** (In front of the `/api/admin/...` routes and the write methods, which are already grouped for that purpose, plus an HTTP interceptor in each Angular application.)
17. **Why is the API a separate TypeScript build?** (The cPanel's Node version cannot execute TypeScript, and a `ts-node`/`tsx` loader would mean shipping a development dependency into the deployment, so `tsc` compiles to `api/dist` and that is what runs everywhere.)
18. **Why do both applications share one `shared/` folder instead of a library build?** (One path alias, no second build product and no stale-library failure mode; the only real loss - no independent type-check - is covered by `npm run check:shared`.)
