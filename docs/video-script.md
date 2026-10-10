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
| 5 | 9:00 - 11:00 | The public pages, including the registrations table and the weather API | Q3 |
| 6 | 11:00 - 13:30 | The admin website | Q3 |
| 7 | 13:30 - 15:00 | Work progress, tests, deployment, closing | - |

If you are running short, cut the **search page** demonstration (inside section
5) first - it was the centrepiece of the A2 video and it is already documented.
Never cut section 3: the delete rule is the A3 requirement the brief singles out.

---

## Before you record - checklist

Mechanics are in `video-recording-guide.md` (OBS setup, exact URLs,
troubleshooting). The short version:

- [ ] MySQL is running and `charityevents_db` exists
      (`SELECT COUNT(*) FROM events;` returns 11 and
      `SELECT COUNT(*) FROM event_registrations;` returns 20)
- [ ] **The SQL dump was reloaded after the last demonstration**, so event 9
      still exists and can be deleted on camera
- [ ] API is running: `cd api && npm start`
- [ ] Static server is running: `cd clientside && node serve-clientside.js`
- [ ] **OBS Studio** open on the `Demo` scene, and the microphone bar moves when you talk
- [ ] Browser tabs open in this order:
   1. `http://localhost:5500/index.html` (home)
   2. `http://localhost:5500/search.html` (search)
   3. `http://localhost:5500/event.html?id=1` (event detail - registrations table and weather panel)
   4. `http://localhost:5500/registration.html?id=1` (registration page)
   5. `http://localhost:5500/admin/index.html` (admin dashboard)
   6. `http://localhost:5500/admin/events.html` (admin event list, for the delete)
   7. `http://localhost:3000/api/events/1` (raw JSON, showing `registrations`)
- [ ] **MySQL Workbench** connected to `charityevents_db`, SCHEMAS expanded so Tables and Views are both visible
- [ ] **Postman** with the collection imported and the A3 requests added:
      `docs/postman/PROG2002-A2-Charity-Events-API.postman_collection.json`
      (A2 read requests) plus the A3 write requests from
      `docs/api-documentation.md`
- [ ] VS Code open on the project: `api/src/db/event_db.js`,
      `api/src/repositories/write.repository.mysql.js`,
      `clientside/js/registration.js`, `clientside/admin/js/events.js`
- [ ] Notifications off (`Win`+`A` > Do not disturb), other applications closed
- [ ] Browser zoom 110-125%, bookmarks bar hidden
- [ ] Have your GitHub repository open in one tab to show the commit history
- [ ] Have `docs/submission-checklist.md` open in another tab to confirm the
      deployed URLs at the end
- [ ] **Both sites are actually deployed** (checklist section **E**) if you
      intend to show the deployed URLs in the closing section. If they are not
      deployed yet, skip that line and show the local URLs instead - do not claim
      a deployment on camera that has not happened
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
> Express, a client-side website in plain HTML, JavaScript and the DOM, a second
> **admin** website for staff, and the deployment of both sites.

> Assessment 2 already had the home, search and event pages working from the
> read-only API. For Assessment 3 I added the event registration table and the
> full C.R.U.D. cycle, a registration page that really writes to the database,
> and the admin site that creates, updates and deletes events. That is what this
> video demonstrates."

---

## 0:40 - 2:30 | Question 1: Database and API architecture (ULO3: Plan and design)

### 0:40 - 1:40 | The new table and why it is shaped that way

**Show:** MySQL Workbench with `charityevents_db` expanded, showing **Tables**
(now eight) and **Views** (now five). Then `database/01_schema.sql`, section 7,
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

> Second, the ticket tier. The foreign key guarantees the tier exists,
> `(event_id, ticket_type_id)` pointing at `ticket_types`. A single-column key
> would only prove that the tier exists somewhere; this one proves the tier
> belongs to the same event as the registration.

> Third, `event_id` is `ON DELETE RESTRICT`. That is the database-level half of
> the rule 'an event can only be deleted when it has not yet received any
> registrations'. I will show that working in a moment.

> The other columns mirror what the brief says to store: the attendee's name,
> email and optional phone, the number of tickets purchased, the date of
> registration, and a notes field."

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

### 1:40 - 2:30 | The views and the Node connection file

**Show:** the five views in the SCHEMAS panel, then `api/src/db/event_db.js`.

> "The same one-place-for-each-rule idea applies to the views. A2 had two.
> A3 adds `vw_event_columns`, which holds every event column joined to its
> lookups plus `registration_count` and `tickets_sold`; `vw_public_events` is now
> one line - `SELECT * FROM vw_event_columns WHERE status = 'active'` - so the
> public rule is unchanged; `vw_all_events` is the same rows without the status
> filter, and only the admin site reads it; and `vw_event_registrations` adds the
> ticket name, the price and a computed `total_amount` to each registration.
> Because both listings share one column list, they cannot drift apart.

> `event_db.js` is still the required file that connects Node to MySQL. It uses a
> connection pool, and A3 added one thing: a `transaction()` helper. It hands a
> callback one connection inside BEGIN and COMMIT and rolls back if the callback
> throws. Two operations need that, and the delete rule is one of them.

> `ping()` now also reports whether the `event_registrations` table exists, so
> `GET /api/health` answers 'was the new table created?' in one request."

---

## 2:30 - 4:30 | Question 1 continued: the full C.R.U.D. cycle

**Show:** `api/src/routes/apiRoutes.js`.

> "My API follows a layered structure: routes decide the URL, controllers deal
> with HTTP, services validate and hold the business rules, repositories hold the
> SQL, and `event_db.js` talks to MySQL.

> Assessment 2 was read-only. Assessment 3 completes the C.R.U.D. cycle:
> `POST /api/events` to create, `PUT /api/events/:id` to update,
> `DELETE /api/events/:id` to delete, plus the registration endpoints. The write
> handlers are mounted twice - under `/api/events` and under `/api/admin/events` -
> and both mounts call the same controller, so there is exactly one
> implementation of each rule. The admin mount exists because the admin list must
> include suspended events, and hiding that behind `/api/admin` means a public
> caller cannot reach it by accident."

**Show:** Postman. First `GET /events/1`, and point at the new part of the body.

> "The detail endpoint now also returns this event's registrations, ordered by
> `registered_at` descending - the brief asks for 'sorted by the latest date when
> the tickets were purchased' - with `ticketName`, `ticketPrice` and a computed
> `totalAmount`. The id is the tie-breaker, so two registrations made in the same
> second still order predictably."

**Do:** send `POST /events` with a valid body.

> "This is the create endpoint. It answers **201 Created** with a `Location`
> header pointing at the new resource - `/api/events/12` - which is the RESTful
> way to say 'it exists and here is where'. The body is the created event, read
> back through the admin view, so a create response looks exactly like a later
> read of the same event."

**Do:** send the same request with several fields missing, then point at the
`details` array.

> "The validation collects **every** problem and returns one 400 with a
> `details` array: the field and the message for each one. The admin form paints
> each message next to its own control, so staff fix the form in one pass instead
> of playing error whack-a-mole."

**Do:** send `PUT /events/12` with only `{ "status": "suspended" }`.

> "An update is **partial**: only the fields in the body are validated and
> changed. Here just the status changed; the capacity and the dates are
> untouched. The admin update page uses exactly this - it sends only the fields
> the user edited."

**If time allows, show the registration endpoints:**

**Do:** send `POST /events/1/registrations` with a new email, then send it again
unchanged.

> "A registration is created inside the event it belongs to, which is why the URL
> is `/events/1/registrations` rather than a verb. The first attempt is a 201 with
> a `Location`. The second is a **409 Conflict**: that email has already
> registered for this event. Same email, different event would be allowed -
> that is the pair rule from the schema, and the API checks it first so the user
> gets a readable message instead of a raw duplicate-key error."

---

## 4:30 - 6:00 | Question 1 continued: the delete data-integrity rule, live

This is the A3 requirement the brief singles out, and the one to demonstrate in
**both** directions.

### 4:30 - 5:00 | The code behind it

**Show:** `api/src/repositories/write.repository.mysql.js`, `deleteEvent()`, then
`api/src/services/eventWriteService.js`, `deleteEvent()`.

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

**Do:** in Postman, send `DELETE /events/1` (four registrations).

> "**409 Conflict.** The message names the event and the number of
> registrations, and it tells the user what to do instead: set the status to
> suspended. There is also a machine-readable part - `details.suggestion` is
> `suspend-instead` - which is what lets the admin page offer the alternative as
> a link rather than just printing text."

### 5:30 - 6:00 | The successful delete, and the second line of defence

**Do:** in Postman, send `DELETE /events/9` (a past event with no
registrations).

> "**204 No Content**, which is the RESTful answer to 'it is gone'. A 204 carries
> no body, so the outcome is repeated in headers the client can read:
> `X-Deleted-Event-Id` and `X-Deleted-Event-Name`, and those headers are listed
> in `Access-Control-Expose-Headers` - otherwise the browser would hide them from
> the page.

> The events I seeded with no registrations are deliberate: 9, 10 and 11. Without
> an event that has none, I could only ever show the blocked delete and never a
> successful one.

> One more point about the block. Suppose I deleted that check from the code
> entirely. MySQL would still refuse, because the foreign key is
> `ON DELETE RESTRICT`: the registration rows point at the event, so the event
> cannot disappear. The driver error `ER_ROW_IS_REFERENCED_2` is translated into
> exactly the same 409, so a caller cannot tell which defence stopped it - and
> does not need to."

---

## 6:00 - 9:00 | Question 2: Data flow and interaction between the API and the website (ULO1 and ULO3)

**Show:** split screen - `clientside/js/registration.js` and the browser with
DevTools open on the **Network** tab.

> "This question is about how a click in the browser becomes data in the
> database. I will follow one registration from start to finish, then summarise
> the read path that Assessment 2 already demonstrated."

### 6:00 - 6:40 | Step 1: which event, and reading the form

**Show:** `registration.js`, the function that reads the id, then `buildForm()`.

> "The registration page accepts `?id=` in the query string. If it is missing, it
> falls back to the last event the visitor opened, which the event page stores in
> localStorage under `charity-events:last-viewed-event-id`. That is the brief's
> 'URL query strings or Local Storage' requirement used twice over.

> The page then loads the event from `GET /api/events/1`, so the visitor sees what
> they are registering for - name, date, venue, price - before they type
> anything.

> The form has one control per stored column: name, email, phone, date of
> registration, ticket type, number of tickets and notes. The ticket dropdown is
> built from this event's tiers only, and the total line updates live as the tier
> or the quantity changes."

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

**Show:** `js/api.js`, `request()` and `postJson()`.

> "`api.js` is the only place in the client that talks to the server. A3 added a
> generic `request(method, path, options)` and made the old `getJson` a thin
> wrapper, so a read, a create, an update and a delete all share one timeout, one
> error type and one understanding of the API envelope.

> It builds the URL, adds the JSON headers, attaches an `AbortController` so a
> slow request is cancelled after ten seconds, and resolves a **204 to null**,
> because a delete has no body to parse.

> `fetch()` returns a Promise. I use `await`, which is the same Promise with more
> readable syntax."

**Do:** submit the valid form and point at the `POST .../registrations` request:
status 201, the `Location` response header, and the JSON body.

> "Here is the request in the Network tab: 201 Created, a `Location` header, and
> the stored row coming back - including the id the database assigned and the
> `totalAmount` it computed from the tier price."

### 8:10 - 9:00 | Step 4: the confirmation, and the read path in one sentence

**Show:** the confirmation card on the page.

> "The form is replaced by a confirmation card built from the **API response**,
> not from what the form thought it sent. The receipt on screen is the record the
> database holds, which is why I can claim the write really happened.

> A failure takes the other branch: `ApiError` carries the status and the details
> array, `fieldErrors` normalises them, and a 409 - this email already registered
> for this event - is shown beside the email field with the API's own message.

> The read path is the same shape in reverse and A2 demonstrated it: the search
> page's `collectFilters()` builds query parameters, `getJson()` sends them to
> `GET /api/events`, and `dom.js` turns the returned objects into the same event
> cards the home page uses. One renderer, two pages."

---

## 9:00 - 11:00 | Question 3: Website functionality demo (ULO3: complete dynamic website)

### 9:00 - 9:30 | Home and search, briefly

**Show:** `http://localhost:5500/index.html`, then `search.html` with Lismore +
Fun Run.

> "The home page mixes static organisation content with a dynamic listing from
> `GET /api/events/upcoming`: name, category, date, venue, price and a live
> progress bar. No past event and no suspended event appears, because the public
> endpoints read the view that fixes `status = 'active'`.

> The search page filters by date, location and category, singly or combined,
> with removable chips and a Clear Filters button that resets every control with
> DOM manipulation."

### 9:30 - 10:30 | The event page: registrations and the registration link

**Show:** `event.html?id=1`, scrolled to the registrations panel.

> "The Register button is now a real **link** to the registration page with this
> event's id - the A2 'under construction' dialog is gone, because the feature
> exists. A past event shows a disabled button instead of a link that would only
> fail.

> Below the tickets is the registrations panel: an actual `<table>` with a
> caption for screen readers and `scope` on the headings. Each row is one
> registration - attendee and email, ticket type, how many tickets, what they are
> worth and when they were bought - newest purchase first, with a totals footer.
> The hero also reports how many tickets have been sold so far."

**Do:** point at the order of the rows, then run in Workbench:

```sql
SELECT registration_id, attendee_name, registered_at
  FROM event_registrations WHERE event_id = 1
 ORDER BY registered_at DESC, registration_id DESC;
```

> "Same order as the page, because it is the same rule: `registered_at`
> descending, with the id breaking ties."

### 10:30 - 11:00 | The optional external API

**Show:** the weather panel on the same page (scroll up to the hero).

> "The brief allows an optional external API, so the event page shows the
> forecast for the event day from Open-Meteo. No API key and no registration are
> needed, which matters because nothing secret has to be shipped to the marker.

> The coordinates come from `locations.latitude` and `longitude`, which were in
> the schema from A2 and are now actually used. The request asks for one day, in
> the Sydney timezone, for the weather code, the temperature range, the rain
> chance and the wind. The WMO weather codes are mapped to translation keys, so
> the panel follows the language switcher.

> It degrades silently, and that is deliberate: no coordinates - like the online
> venue - a date more than sixteen days away, a past event, or a network failure
> all mean the panel is simply not shown. It never throws and never blocks the
> page. Let me prove it."

**Do:** open `event.html?id=9` (a past event) and then the online-venue event.

> "No panel, no error, and the page is complete without it."

---

## 11:00 - 13:30 | Question 3 continued: the admin website (Part 4)

**Show:** `http://localhost:5500/admin/index.html`.

> "Assessment 3 also asks for an admin-side website. It is a **separate site** in
> its own folder, served by the same static server - there is no second command
> and no second API. It is separate because its audience and its data view are
> different, not because its code is: it reuses the public site's `api.js`,
> `dom.js`, `theme.js` and stylesheet, so the design tokens and the dark theme
> work here too, and it adds only its own layout and its own English strings.

> The menu is on all five pages - Dashboard, Events, Add event, Update event and
> Registrations - and it is defined once in `initAdminLayout()`, so no page can
> forget it."

### 11:00 - 11:40 | The list: every event, regardless of status

**Show:** `admin/events.html`.

> "This is the requirement that the public API cannot satisfy: a complete list of
> all events regardless of status. It reads `GET /api/admin/events`, which uses
> `vw_all_events` instead of the public view, so the suspended event and the past
> events are all here.

> Each row shows the id, the event with its category and organisation, the
> publishing status and the derived upcoming or past state, the dates, the venue,
> registrations against capacity, tickets sold, and the actions. The filters
> narrow by status, time and keyword, and the footer totals the page.

> The 'sold' column is worth pointing out: it comes from the view's
> `registration_count` and `tickets_sold`, so listing eleven events is still one
> query rather than eleven."

### 11:40 - 12:20 | Create and update

**Show:** `admin/new.html`.

> "The create form is generated from a single field description called
> `EVENT_FIELDS`, and the dropdowns are filled from
> `GET /api/admin/reference-data` - organisations, categories and venues in one
> request. Ticket-tier rows can be added and removed, and the same client-side
> validation runs before anything is sent, then `POST /api/events`.

> The update page uses the **same** form builder: you pick an event, or arrive
> with `?id=` from the list, and it loads `GET /api/admin/events/:id`, which
> returns a suspended event as a 200 where the public route would return 404."

**Do:** change one field in `update.html?id=1` and submit, with the Network tab
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

**Do:** on `admin/events.html`, click **Delete** on event 1, then confirm.

> "The confirmation dialog is mine, not the browser's `confirm()`, so it can
> explain what is about to happen. It calls `DELETE /api/events/1`, and the API
> answers 409."

**Show:** the warning banner with the API's message, the links, and the disabled
button on that row.

> "The page renders the API's own message - the event name and the number of
> registrations - as a warning banner, and it turns `details.suggestion` into two
> links: update the event, or look at the registrations. It also disables and
> relabels that row's Delete button, so the operator cannot sit there clicking a
> button that will never work.

> That is the whole point of returning structured details rather than a sentence:
> the client can offer the alternative instead of just reporting a failure."

**Do:** click **Delete** on event 9, confirm, and let the list reload.

> "And here is the other half: an event with no registrations deletes cleanly, a
> success banner appears and the list reloads without it. Blocked and allowed,
> from the user's side."

### 13:10 - 13:30 | One styling note worth mentioning

**Show:** the admin page in dark mode (the theme button in the header).

> "One detail I want to mention because it is the kind of thing that only shows
> up in one theme: the admin heading deliberately does **not** reuse the public
> site's `.page-header` class. That class paints a `--brand-100` band, and
> `--brand-100` is a dark teal in the dark theme, so reusing it produced dark
> text on a dark band. The heading is plain text on the page background instead,
> and the reason is written in a comment beside the rule."

---

## 13:30 - 15:00 | Work progress, testing and closing

### 13:30 - 14:00 | Commits

**Show:** your GitHub repository commit history.

> "I committed regularly with descriptive messages, so the history shows how the
> work was built: the database first, then the API, then the client, and for
> Assessment 3 the table and views, the write endpoints, the delete rule, the
> registration page, the admin site and the tests as separate commits."

### 14:00 - 14:30 | Tests

**Show:** a terminal running `node tests/run-tests.js`.

> "I also extended the automated test suite. It starts its own API instance, on
> its own port, and runs four groups: the sixty-four Assessment 2 HTTP and DOM
> checks - two of which had to change, because A2 checked that POST was *not*
> routed and that Register opened a placeholder dialog - and the new
> Assessment 3 groups for the write endpoints, the registration page, the admin
> site and the delete rule.

> The delete rule is checked from both sides: an event with registrations is
> refused with a 409, then the registrations are removed and the same event is
> deleted successfully. Checking it both ways is what proves the block is caused
> by the registrations and not by something else.

> It runs against the offline data source by default, and with
> `TEST_DATA_SOURCE=mysql` against the real database, to show both repositories
> behave identically."

### 14:30 - 15:00 | Deployment and closing

**Show:** the deployed public site and the deployed admin site in the browser
(or the two local URLs if you have not deployed yet - say which), then the three
zips in the file explorer.

> "Both websites are deployed to the SCU cPanel host - the public site at the
> site root and the admin site in the `admin` folder - and both point at the
> deployed API. The submission has three zips: the API, the clientside site and
> the admin site.

> To summarise: the database now records registrations with the uniqueness and
> delete rules enforced by the schema, the API has the full C.R.U.D. cycle with
> one transactional delete rule, the public site can register someone end to end,
> and a separate admin site can manage events. Thank you for watching."

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
- [ ] Confirm the video says what **you** built and can defend, in your own words
- [ ] Upload to SCU OneDrive, set the sharing so your marker can view it, and test the link in a private browser window
- [ ] Put the shareable link in your submission

## Likely interview questions - be ready for these

1. Why did you use a view for the public events instead of a stored status column?
2. How exactly does your search avoid SQL injection?
3. Why is `limit` capped at 100?
4. What happens if the API is offline when the home page loads?
5. How does the event id get from the home page to the detail page?
6. **Why is the unique key on `(event_id, attendee_email)` rather than on the email alone?** (Any other choice breaks "a user may register for multiple events".)
7. **What does the transaction add to the delete rule, and what would still stop a bad delete if the check were removed?** (`FOR UPDATE` prevents a registration arriving between the count and the delete; `ON DELETE RESTRICT` refuses the delete at the database level.)
8. **Why 409 and not 400 for a blocked delete?** (The request is well formed and the event exists; the *state of the data* is what prevents it.)
9. **Why is the ticket tier NOT a composite foreign key, when that would enforce the same-event rule in the database?** (Because MySQL refuses it here, for two reasons: a foreign key may not reference a unique key sharing its leading column with another unique index on that table — `ERROR 6125` — and the usual workaround, a derived key column, may not refer to an `AUTO_INCREMENT` column — `ERROR 3109`. The rule is enforced by the API instead, and the foreign key still guarantees the tier exists.)
10. **Why does the admin site read a different view from the public site?** (`vw_all_events`, because the brief requires every status; the public view stays active-only.)
11. **What happens to the weather panel when Open-Meteo is unreachable, and why?** (Nothing - it is hidden; a bonus feature must not break the page.)
12. **Which parts of the client code would you change to add a new filter?**
13. **If you had to add authentication, where would it go?** (In front of the `/api/admin/...` routes and the write methods, which are already grouped for that purpose.)
