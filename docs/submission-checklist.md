# Submission checklist

PROG2002 Web Development II - **Assessment 3**
**Weight:** 40% (the same unit weighting as A2; the A3 brief sets the part split)

> A note on the A2 corrections at the end of this file (section **J**). They were
> posted during Assessment 2 and they still matter: no CSS or JavaScript
> framework, and AI use requires the official prompt plus screenshots of your
> chat log. Where the A3 brief repeats a rule, the same checks apply.

Work through this list top to bottom before you submit. Tick nothing you have
not actually verified.

---

## A. Database (Part 1)

> **Do this first.** As of the last check on this machine, the running MySQL
> instance still held the **A2** schema: `information_schema` reported 6 base
> tables and 2 views, `GET /api/health` reported `tableCount: 8` and
> `registrationTable: false`, and `event_registrations` did not exist. Nothing in
> Part 1 or the A3 write features can be demonstrated until the A3 dump is
> loaded:
>
> ```bash
> node tools/load-database.mjs --user root --password "your_root_password"
> # or:  mysql -u root -p < database/charityevents_db.sql
> ```
>
> After that, `GET /api/health` must report `registrationTable: true` and
> `tableCount: 12` (7 tables + 5 views).

- [ ] **The A3 dump is loaded** and `GET /api/health` reports
      `registrationTable: true`
- [ ] `charityevents_db` is created by `database/charityevents_db.sql`
- [ ] The script was run on a **clean** server and completed without errors
      (verified here on MySQL 8.4.11 Community Server)
- [ ] MySQL 8.0.1 or newer is used (the dump uses the `utf8mb4_0900_ai_ci`
      collation, `CHECK` constraints and `ON DELETE RESTRICT` foreign keys)
- [ ] On this computer MySQL is the Windows service **MySQL84** (8.4.11) and the
      API reads it with the application account `charity_app`
- [ ] `charity_app` has `SELECT, INSERT, UPDATE, DELETE` on `charityevents_db`.
      **Verified on this machine: it holds `SELECT` only**
      (`SHOW GRANTS FOR CURRENT_USER();` returns just
      `GRANT SELECT ON charityevents_db.* TO charity_app@127.0.0.1`), so every
      A3 write currently fails with MySQL error 1142. Apply
      `GRANT SELECT, INSERT, UPDATE, DELETE ON charityevents_db.* TO 'charity_app'@'127.0.0.1';`
      - note the host, because `api/.env` connects from `127.0.0.1` and a
      `@'localhost'` grant would create a different account.
      `api/.env.example` still shows the A2 grant in its comment, so check the
      live grant rather than the template
- [ ] `SELECT COUNT(*) FROM events;` returns 11
- [ ] Tables exist with primary and foreign keys: `organizations`, `categories`,
      `locations`, `events`, `ticket_types`, `donations`, **`event_registrations`**
      (7 tables)
- [ ] Views exist: `vw_event_progress`, **`vw_event_columns`**,
      `vw_public_events`, **`vw_all_events`**, **`vw_event_registrations`**
      (5 views)
- [ ] At least **8 events** (this project seeds 11) and several categories are present
- [ ] `SELECT COUNT(*) FROM event_registrations;` returns **20** and
      `SELECT SUM(tickets_purchased) FROM event_registrations;` returns **49**
- [ ] The one-registration-per-event rule is real: inserting a second row with
      `(event_id, attendee_email)` = `(1, 'amelia.hartley@example.com')` fails
      with `Duplicate entry ... for key 'uq_registration_event_email'`
- [ ] The delete rule is real at the database level: `DELETE FROM events WHERE
      event_id = 1;` fails with `Cannot delete or update a parent row` (the
      `ON DELETE RESTRICT` key), even though event 1 exists
- [ ] Events 9, 10 and 11 have **no** registrations, so a successful event
      delete can still be demonstrated
- [ ] `event_db.js` exists, is named exactly, and connects to MySQL using a pool
- [ ] `event_db.js` was proof-read for hard-coded passwords (use `.env`)
- [ ] The SQL file is attached to the submission

## B. REST API (Part 2)

### Read endpoints (A2, still true)

- [ ] `cd api && npm install` completes
- [ ] `api/.env` exists (copied from `.env.example`) with the correct DB password
- [ ] `npm start` prints "Database : connected"
- [ ] `GET /api/health` returns 200, `registrationTable: true`, and a
      `tableCount` of **13** - that number comes from `information_schema`, so it
      counts the 7 tables **and** the 5 views
- [ ] `GET /api/events` returns upcoming events with their category
- [ ] `GET /api/events` filters by **date**, **location** and **category**,
      individually and combined
- [ ] `GET /api/categories` and `GET /api/locations` return filter options
- [ ] `GET /api/events/:id` returns full detail including `ticketTypes`
- [ ] Invalid input returns 400 with field details; unknown ids return 404
- [ ] The suspended event (id 11) returns 404 from `GET /api/events/11` and
      appears in no public list

### Write endpoints (A3)

- [ ] `POST /api/events` with a valid body returns **201** and a `Location`
      header such as `/api/events/12`
- [ ] `POST /api/events` with several bad fields returns **one 400** whose
      `details` array names **every** problem, not just the first
- [ ] `PUT /api/events/:id` with one field changes only that field (check the
      other columns are untouched, in Workbench)
- [ ] `PUT /api/events/:id` with `{}` returns 400 "No fields were supplied."
- [ ] `DELETE /api/events/1` (four registrations) returns **409** with a message
      naming the event and the count, and
      `details.suggestion = "suspend-instead"`
- [ ] `DELETE /api/events/9` (a past event with no registrations) returns
      **204 No Content** with the `X-Deleted-Event-Id` and
      `X-Deleted-Event-Name` headers
- [ ] Reload the SQL dump afterwards, so the marker sees the seeded data
- [ ] `POST /api/events/1/registrations` with a new email returns **201** and a
      `Location` header such as `/api/registrations/21`
- [ ] The same request again returns **409** ("has already registered for")
- [ ] A tier from a different event returns 400 with
      `details[0].field = "ticketTypeId"`
- [ ] More tickets than remain returns 400 with
      `details[0].field = "ticketsPurchased"`
- [ ] `GET /api/events/1/registrations` returns the event's registrations
      **newest first** (`registeredAt DESC`), each with `ticketName`,
      `ticketPrice` and `totalAmount` - four of them in the seed data, or five if
      the POST above added one
- [ ] `GET /api/registrations` returns all 20 (admin list - 21 after the POST
      above) and accepts `?eventId=`, `?email=` and `?keyword=`
- [ ] `GET /api/registrations/:id`, `PUT /api/registrations/:id` and
      `DELETE /api/registrations/:id` behave (204 on delete)
- [ ] `GET /api/admin/events` returns **11** events including the suspended one
      (id 11) and the past ones
- [ ] `GET /api/admin/events/11` returns **200** for the suspended event, where
      the public route returns 404
- [ ] `GET /api/admin/reference-data` returns organisations, categories and venues
- [ ] `GET /api/events?audience=admin&publishStatus=all&state=all` returns the
      same 11 rows
- [ ] `GET /api/stats` includes `registrations: 20` and `ticketsSold: 49`
- [ ] `OPTIONS` on a write endpoint returns 204 with
      `Access-Control-Allow-Methods: GET,POST,PUT,DELETE,OPTIONS` and a
      `Location` entry in `Access-Control-Expose-Headers`
- [ ] A Postman collection has been built and exported (include it in the zip),
      with the A3 requests added to the A2 ones
- [ ] **Authentication is deliberately absent** and you can say why: the brief
      says "assume that authentication is not required"

## C. Client-side website (Part 3)

### Home, search and event pages (A2, still true)

- [ ] `node serve-clientside.js` runs and `http://localhost:5500/index.html` opens
- [ ] **Home page**: static organisation information is visible
- [ ] **Home page**: the event list is loaded from the API (check the Network tab)
- [ ] **Home page**: each card shows name, category, location, date, price,
      image and progress, and links to the detail page
- [ ] **Home page**: no past event and no suspended event appears
- [ ] **Menu**: present and working on all four public pages
- [ ] **Search page**: date, location and category controls all work
- [ ] **Search page**: more than one category can be selected at once
- [ ] **Search page**: criteria combine (test Lismore + Fun Run + a date range)
- [ ] **Search page**: **Clear Filters** resets everything
- [ ] **Search page**: error messages are shown for invalid input
- [ ] **Search page**: an empty result set shows a helpful message, not a blank page
- [ ] **Detail page**: only the selected event is shown
- [ ] **Detail page**: full description, venue, times, capacity and purpose
- [ ] **Detail page**: ticket prices shown, including a free tier
- [ ] **Detail page**: goal vs. progress bar with real figures

### The new registration page (A3)

- [ ] **Register** on the event page is an **anchor** to
      `registration.html?id=<id>` - the A2 "under construction" dialog is gone
      (a past event shows a disabled button instead of a dead link)
- [ ] Opening `registration.html?id=1` directly shows **that** event, and the
      page loads it from `GET /api/events/1`
- [ ] Opening `registration.html` with **no** query string falls back to the
      last event viewed (the `charity-events:last-viewed-event-id` key)
- [ ] The form has one control per stored column: name, email, phone (optional),
      date of registration (defaults to today), ticket type, number of tickets,
      notes
- [ ] The ticket-type dropdown lists only **this** event's tiers, with their prices
- [ ] The live total updates when the tier or the number of tickets changes
- [ ] Submitting an empty form writes one message **next to each field** and
      shows a summary with `role="alert"` that receives focus; the first problem
      is scrolled into view
- [ ] A bad email and a phone number that is not a phone number are both refused
      **before** any request is sent (check the Network tab stays empty)
- [ ] A valid submission returns 201 and the form is replaced by a confirmation
      card showing the values the **API** returned (compare the receipt with the
      JSON in the Network tab)
- [ ] The confirmation offers a link back to the event and a link to search, and
      both work
- [ ] Registering again with the same email for the same event shows the 409
      message from the API, beside the email field
- [ ] Registering the same email for a **different** event succeeds (that is the
      other half of the brief's rule)

### The event page's registrations panel (A3)

- [ ] The panel is a real `<table>` with a caption (screen-reader only) and
      `scope` attributes on the headings
- [ ] Rows are **newest first** - compare with
      `SELECT registration_id, registered_at FROM event_registrations WHERE event_id = 1 ORDER BY registered_at DESC;`
- [ ] Each row shows the attendee with their email, the ticket type, the ticket
      count, the value and the purchase date
- [ ] The footer totals the tickets and the value for the event
- [ ] The hero also shows "Tickets sold so far"
- [ ] An event with no registrations (for example event 9) shows a sensible empty
      state rather than an empty table
- [ ] **Optional weather panel**: it appears for an upcoming event with
      coordinates (for example event 1) and shows the date, the summary, the
      temperature range and the rain chance
- [ ] The weather panel is **absent**, with no console error, for: the online
      venue (no coordinates), an event more than 16 days away, a past event, and
      with the machine offline

## D. Admin-side website (Part 4)

- [ ] `http://localhost:5500/admin/index.html` opens (same static server, no
      second command)
- [ ] The menu is present on **all five** pages: Dashboard, Events, Add event,
      Update event, Registrations
- [ ] **Dashboard** shows counts and the latest registrations
- [ ] **Events** lists every event **regardless of status** - the suspended event
      (id 11) and the past events (9 and 10) are all there with status pills
- [ ] The list shows registration count vs capacity and tickets sold per event,
      plus a totals footer
- [ ] The status, time and keyword filters each narrow the list, and clearing
      them restores it
- [ ] **Add event**: the organisation, category and venue dropdowns are filled
      from `GET /api/admin/reference-data`
- [ ] **Add event**: ticket-tier rows can be added and removed, and client-side
      validation stops an incomplete form before it is sent
- [ ] **Add event**: a valid submission creates the event (201) and the new event
      appears in the Events list
- [ ] **Update event**: the event picker and `update.html?id=1` both load the event
- [ ] **Update event**: changing one field sends only that field - confirm the
      request body in the Network tab is the small diff, not the whole event
- [ ] **Update event**: submitting with nothing changed is refused with a clear
      message and sends no request
- [ ] **Update event**: the event's registrations are listed read-only, each with
      a working delete, and the warning that registrations block the event delete
      is visible
- [ ] **Delete**: the confirmation dialog appears; cancelling does nothing
- [ ] **Delete**: deleting an event that **has** registrations shows a warning
      banner with the API's message and links to Update and to the registrations,
      and that row's Delete button is disabled and relabelled
- [ ] **Delete**: deleting event 9 (no registrations) shows a success banner and
      the list reloads without it
- [ ] **Registrations** page lists all registrations, filters them and deletes one
- [ ] The admin pages follow the light/dark theme and the heading is readable in
      **both** (the shared `.page-header` class was deliberately not reused)
- [ ] Reload the SQL dump after the delete demonstrations

## E. Deployment (Part 5)

> **Full step-by-step instructions: [`deployment-cpanel.md`](deployment-cpanel.md).**
> It covers the cPanel screens, the exact `api/.env` to create on the host, importing
> the SQL through phpMyAdmin, and a symptom-to-cause table. The list below is the
> checkable summary.

- [ ] `node tools/configure-deployment.mjs --api https://<host>/charity-events-api`
      has been run **before** building the zips. Skipping it is the single most
      common deployment failure: the uploaded site then looks for the API on the
      visitor's own machine and every list is simply empty
- [ ] `api/.env` on the host exists and has `DATA_SOURCE=mysql`, the cPanel MySQL
      host/username/password/database, and `CORS_ORIGIN` set to the deployed site's
      origin
- [ ] `database/charityevents_db.sql` was imported through phpMyAdmin, and the
      database holds **7 tables + 5 views**, `events` = 11 rows,
      `event_registrations` = 20 rows
- [ ] `https://<host>/charity-events-api/api/health` answers
      `"connected": true` and `"registrationTable": true` on the public internet
- [ ] Both websites are uploaded to the SCU cPanel host. The layout that works
      without editing a single path:
      * the **contents** of `usernameA3-clientside.zip` go to the site root
        (so `index.html`, `registration.html`, `js/`, `css/`, `images/` are
        directly under the public URL);
      * the **contents** of `usernameA3-adminside.zip` go over the same root,
        which places the admin pages in `admin/` and reuses the `js/`, `css/`
        and `images/` folders already there. Uploading it to a separate folder
        instead also works, but only if that folder is beside a copy of `js/`,
        `css/` and `images/`, because the admin pages import the shared modules
        by relative path
- [ ] The public URL opens and the admin site is reachable at
      `<public-url>/admin/index.html`
- [ ] `API_BASE_URL` in `clientside/js/config.js` (and therefore for the admin
      site too, which shares the file) points at the **deployed** API, not at
      `localhost`
- [ ] The API is deployed as well, or the deployment notes state exactly where it
      runs and that the marker must start it locally
- [ ] `CORS_ORIGIN` on the deployed API lists the deployed site's origin
- [ ] The deployed public site opens, loads events and can register someone
- [ ] The deployed admin site lists the suspended event and can create, update
      and delete
- [ ] The registration page's optional weather panel either works or is hidden
      silently on the deployed site (an external API may be blocked on a shared
      host; that must not break the page)
- [ ] Both deployed sites were opened in a **private browser window**, so nothing
      depends on a local session
- [ ] The URLs to submit are written down, ready to paste into the submission

## F. Automated tests

- [ ] `node tests/run-tests.js` prints `0 failed`
- [ ] The printed total is read from the run itself - the A2 groups are the
      original 64 checks (two were updated for A3: `POST` is now routed, and the
      "under construction" dialog no longer exists) and the A3 groups are added
      on top
- [ ] You have run the suite **after** your last code change
- [ ] `set TEST_DATA_SOURCE=mysql && node tests/run-tests.js` also prints
      `0 failed` (this is the run that proves the MySQL repositories behave like
      the offline ones, and it is the run that catches a missing grant)
- [ ] `npm run check:frameworks` prints `6 passed, 0 failed` - the "HTML, CSS and
      JS only" rule, checked against the delivered files rather than by eye (the
      checks it makes are listed under J2)
- [ ] `npm run check:translations` prints `Translations are complete and
      consistent` - both sites' dictionaries have the same keys in all four
      languages, and every key the code asks for exists

## G. Documentation and deliverables

- [ ] `docs/project-report.md` is complete: **every prompt answered in your own
      words**, no leftover `_placeholder_` text and no leftover blockquote prompts
- [x] Report uses 12-point Arial with 1.5 line spacing. Verified in the file
      itself: 234 runs at Arial 12 pt and 81 paragraphs at 1.5 line spacing.
      Code samples and figure captions are the exceptions - Consolas 10 pt and
      Arial italic 10 pt - which is intentional so that code and captions are
      visually distinct from body text
- [ ] The A3 sections of the report are written: the new table and its
      constraints, the C.R.U.D. endpoints, the delete rule, the registration
      page, the admin site and the optional external API
- [x] ER diagram included in the report as **Figure 4**, under *Data Schema*
      (page 10). Source: `docs/report-images/06-er-diagram.png`. **A3**: the ERD
      must now show `event_registrations`, so either update the figure or add a
      second one showing just the new table and its two foreign keys
- [x] Screenshots included: home page (Figure 1, page 5), search page with
      results (Figure 2, page 6) and event detail page (Figure 3, page 8). The
      report is now 17 pages with six figures in total
- [ ] **A3 screenshots still to take**: the registration form, the confirmation
      card, the registrations table on the event page, the admin event list
      (suspended event visible), the create form, and the **409 banner** from a
      blocked delete
- [ ] **Postman success and Postman 400 are still outstanding** from A2. Figures
      5 and 6 show the live API response (request line, status and body), which is
      equivalent evidence, but the checklist asked for Postman screenshots
      specifically. Take those, plus one for the 201 and one for the 409
- [ ] The report's section titles are bold body text, not Word heading styles,
      so the document has no navigation pane and no automatic table of contents.
      Apply **Heading 1** to each section title if the marker expects a
      structured document
- [ ] The GenAI declaration is included, with the correct option chosen
- [ ] The peer evaluation form required by the brief is completed and submitted
- [ ] `usernameA3-api.zip` built (replace `username` with your SCU username)
- [ ] `usernameA3-clientside.zip` built
- [ ] `usernameA3-adminside.zip` built
- [ ] They were produced by `node tools/make-submission-zips.mjs` (or the manual
      equivalent at the end of this file), and the dry run reported no missing
      files
- [ ] All three zips open correctly and contain the expected folders
- [ ] `.env` is **not** inside the api zip if it contains a real password
      (`.env.example` should be there instead)
- [ ] `node_modules` is **not** inside any zip
- [ ] The GitHub link is in the submission and is accessible to the marker
- [ ] The repository is private, or the marker has been invited as a collaborator
- [ ] The video is uploaded to SCU OneDrive, the link is shareable and you have
      tested it in a private browser window
- [ ] **The video is at most 15 minutes, focuses on your own contribution, and
      still answers the three required questions** (see `docs/video-script.md`)
- [ ] The video shows a **blocked** delete (409) **and** a **successful** one (204)
- [ ] The submission link on Blackboard has been completed

## H. GitHub evidence (explicitly graded)

- [ ] The repository has a meaningful commit history, not one giant commit
- [ ] Commit messages explain **what changed**, for example
      `feat(api): add date, location and category filters to /api/events`
- [ ] Commits show the real order of work: database, then API, then client
- [ ] The A3 work appears as its own commits, not as one "assessment 3" commit:
      the table and views, the write endpoints, the delete rule, the registration
      page, the admin site, the tests, the documentation
- [ ] No secret (database password, API key) appears anywhere in the history

## I. Final read-through

- [ ] Open the report and read it start to finish as a marker would
- [ ] Open every file you would be asked about and confirm you can explain it
- [ ] Confirm the exact required details exist:
      * the database name: **`charityevents_db`**
      * the connection file: **`event_db.js`**
      * the new table: **`event_registrations`**
      * authentication is **deliberately absent** and you can justify it
- [ ] Be ready to answer, without notes: why the unique key is on
      `(event_id, attendee_email)` and not on the email alone; what the
      transaction and `FOR UPDATE` add to the delete rule; what would still stop
      a bad delete if the API check were deleted
- [ ] Submit with time to spare - late submissions may be penalised

---

## Build the three zips

There are two ways to do this. Use the script - it is the one that has been
tested, and it refuses to build an archive that is missing a required file.

### The script (preferred)

```bash
node tools/make-submission-zips.mjs --dry-run     # show what each zip would contain
node tools/make-submission-zips.mjs               # write them into dist/
node tools/make-submission-zips.mjs --username LiuXu --out dist
```

* The **username** comes from the `author` field in the root `package.json`
  (`"<your name> (<your SCU username>)"`), so it is edited in one place; pass
  `--username` to override it. If neither is filled in, the archives are named
  `usernameA3-*.zip` and the script says so.
* The three archives are **self-contained for their marker**:
  * `usernameA3-clientside.zip` - the public website. The `admin/` folder is
    **excluded**, because it is a separate deliverable (next row).
  * `usernameA3-adminside.zip` - the admin pages plus the shared `js/`, `css/`
    and `images/` files they import, under the same relative paths, so this zip
    runs after being extracted on its own.
  * `usernameA3-api.zip` - `api/` without `node_modules` and without the real
    `.env` (`.env.example` **is** included, because that is the template).
* It never includes `node_modules`, `.git`, `api/.env`, `package-lock.json` or
  the local `dist/` folder, and it fails loudly if an archive is missing a file
  it must contain (`server.js`, `src/db/event_db.js`, `admin/index.html`,
  `registration.html` and so on).

- [ ] `node tools/make-submission-zips.mjs --dry-run` lists three archives with
      no ERROR lines
- [ ] The three zips are built, and the GitHub link and video link are ready to
      submit with them

### The manual equivalent

If the script cannot be run, the same three archives can be built by hand from
the project root. Replace `username` with your SCU username.

```powershell
# api zip  (no node_modules, no .env with secrets, SQL and Postman collection included)
# Note: the database scripts live at the project root in database\, NOT inside api\,
# so they have to be copied in separately - the marker needs them for Part 1.
$api = "usernameA3-api"
Remove-Item $api -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $api | Out-Null
Copy-Item api\* $api -Recurse -Force
Remove-Item "$api\node_modules" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item "$api\.env" -Force -ErrorAction SilentlyContinue
Copy-Item database "$api\database" -Recurse -Force
New-Item -ItemType Directory -Force "$api\postman" | Out-Null
Copy-Item "docs\postman\PROG2002-A2-Charity-Events-API.postman_collection.json" "$api\postman\"
Compress-Archive -Path $api -DestinationPath "$api.zip" -Force

# clientside zip - the PUBLIC site only; the admin folder has its own zip
$client = "usernameA3-clientside"
Remove-Item $client -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $client | Out-Null
Copy-Item clientside\* $client -Recurse -Force
Remove-Item "$client\admin" -Recurse -Force -ErrorAction SilentlyContinue
Compress-Archive -Path $client -DestinationPath "$client.zip" -Force

# adminside zip - the admin pages plus the shared files they import, so this
# archive runs after being extracted on its own
$admin = "usernameA3-adminside"
Remove-Item $admin -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force "$admin\admin" | Out-Null
Copy-Item clientside\admin\* "$admin\admin" -Recurse -Force
New-Item -ItemType Directory -Force "$admin\css","$admin\js","$admin\images" | Out-Null
Copy-Item clientside\css\styles.css "$admin\css\"
Copy-Item clientside\js\* "$admin\js\"
Copy-Item clientside\images\* "$admin\images\"
Copy-Item clientside\index.html, clientside\search.html, clientside\event.html, clientside\registration.html $admin
Compress-Archive -Path $admin -DestinationPath "$admin.zip" -Force

# the staging folders are not part of the repository
Remove-Item $api, $client, $admin -Recurse -Force
```

Then verify each one. The zips must contain no `.env` and no `node_modules`:

```powershell
Add-Type -AssemblyName System.IO.Compression.FileSystem
foreach ($z in @("usernameA3-api.zip", "usernameA3-clientside.zip", "usernameA3-adminside.zip")) {
  $a = [System.IO.Compression.ZipFile]::OpenRead((Resolve-Path $z))
  "{0}: {1} entries" -f $z, $a.Entries.Count
  $bad = $a.Entries | Where-Object { $_.FullName -match '\\node_modules\\|\\\.env$' }
  if ($bad) { "  PROBLEM: " + ($bad.FullName -join ', ') } else { "  no .env, no node_modules" }
  $a.Dispose()
}
```

Finally, confirm each archive is usable **after extraction on its own**, which is
what the marker will do:

```powershell
# the api zip must contain the required connection file
Test-Path usernameA3-api\src\db\event_db.js          # True
# the admin zip must contain its pages AND the shared modules, under the
# paths the admin pages import them from
Test-Path usernameA3-adminside\admin\index.html      # True
Test-Path usernameA3-adminside\js\api.js             # True
Test-Path usernameA3-adminside\css\styles.css        # True
# the clientside zip must contain the registration page
Test-Path usernameA3-clientside\registration.html    # True
# and must NOT contain the admin folder, which has its own zip
Test-Path usernameA3-clientside\admin                # False
```

---

## J. Unit Assessor updates from Assessment 2 (still in force)

Two announcements changed the rules during A2. This section records each one and
exactly where the project stands, because the same rules carry into Assessment 3.

### J1. The A2 deadline moved

From **28 September** to **5 October 2026, 11:59 pm**. One extra week. Keep this
here only as history: the A3 due date is the one printed in the A3 brief.

### J2. No CSS or JavaScript framework (this project complies)

> "You are NOT allowed to use any frameworks for CSS or Javascript. You may use
> the Express framework to build the server side script, that's all. Do not use
> any Templating provided by Express... Your webpages must be delivered using
> only HTML, CSS and JS."

Verified against the code, not assumed:

- [x] The API's only runtime dependencies are **`express`** and **`mysql2`**
      (a database driver, not a framework). The unused `cors` package was
      removed, because CORS headers are written by hand in
      `api/src/middleware/security.js`
- [x] No template engine anywhere: no `view engine`, no `res.render`, no EJS,
      Pug, Handlebars or Nunjucks. The API's one HTML page is served as a plain
      file with `res.sendFile()`
- [x] The client uses no framework and no library - no React, Vue, Angular,
      Svelte, jQuery, Bootstrap, Tailwind or Alpine. **The A3 admin site is
      plain HTML, CSS and JS too**, reusing the public site's own modules
      (`api.js`, `dom.js`, `theme.js`) rather than adding a UI library
- [x] No CDN: every script, stylesheet and image is a local file. The four
      public pages load one inline theme snippet and one ES module each; the
      admin pages load their own controller plus the shared modules
- [x] The only external request the site makes is the **optional** Open-Meteo
      forecast. It is a plain `fetch()` to a documented public API, it needs no
      library, and the page works with it blocked
- [x] `jsdom` appears only in the root `package.json` as a **dev** dependency
      for the test suite. It is not part of either website and is not shipped in
      any zip
- [x] **The repository contains no PowerShell and no batch files.** The setup
      scripts were `.ps1` and `.cmd`, which made GitHub's language bar report
      "PowerShell 4.6%" and "Batchfile 0.9%" - not a breach of the rule above,
      which is about the webpages, but easy for a marker to misread. They are
      now JavaScript: `tools/start-all.mjs` replaces `start-all.cmd`, and
      `tools/load-database.mjs` replaces `load-database.ps1`. The installer
      scripts were deleted outright, because MySQL 8.4.11 is already installed
      and they had no further use. The language bar now shows JavaScript, CSS,
      HTML, SQL and JSON only. Nothing in the running application changed

The checks above were originally made by reading the code. Reading is not
repeatable, and the rule is the kind that breaks by accident - one CDN link, one
`import` of a package, one `res.render`. So they are now automated:

```bash
npm run check:frameworks      # node tools/check-no-frameworks.mjs
```

It passes 6 checks over the delivered files:

| Check | Why it is the right test |
| --- | --- |
| Every `import` is a relative path | The browser loads the client scripts with no bundler, so a third-party package would have to appear as a bare specifier. There are none |
| No `<script>`, `<link>` or `@import` names another host | A framework added by CDN can only enter through one of these three tags |
| No `view engine`, no `res.render` | Either one means the pages stopped being plain HTML |
| Runtime dependencies are only `express` and `mysql2` | Express is explicitly allowed; `mysql2` is a driver. Anything else would need justifying |
| No template engine installed | Guards against one being added "to help with the forms" |
| Every page is a complete HTML document | A page assembled from fragments at request time is templating, whatever it is called |

It deliberately does **not** search for framework names. That approach fails in
both directions: it misses a framework nobody listed, and it fires on ordinary
words - "value" contains "vue", "reactive" contains "react", and this project's
own `grid` and `grid--events` classes would look like Tailwind. Testing the
properties a framework would have to break is both stricter and quieter.

### J3. The report template was replaced

An updated **PROG2002 A2 Report Template** was posted on SIE Moodle, together
with an **AI-Assignment-Prompt** file. Check whether the A3 brief points at a
newer template again.

- [ ] **Download the current template and check the report against it.** The
      existing report was written against the previous A2 template, so its
      section headings and question order may no longer match. Nobody but you
      can download these files - they need your Moodle login

### J4. AI use needs evidence

> "If you use AI in any capacity, please use the AI Prompt as provided... Please
> also include screenshots of your AI chat log with your report to show that you
> only asked AI questions to further your understanding and NOT to use AI to
> generate the code for you. Failure to provide the appropriate evidence will
> result in a loss of marks."

- [ ] **This is still unresolved and it is the most serious item on this list.**
      The code, the report and the translations in this project were generated
      with an AI assistant, at the owner's request. That is generation, not
      question-asking, so an honest chat log cannot show what the Unit Assessor
      asks to see. Screenshots must not be manufactured to imply otherwise.

The only defensible routes from here:

1. **Rebuild the code yourself** and use AI only to ask questions. Keep the real
   chat log, starting from the official prompt.
2. **Disclose the true extent of the AI use**, in the declaration and to the
   Unit Assessor, and be ready to explain every line. `docs/genai-declaration.md`
   gives the wording for the disclosure option.

What is *not* an option: submitting a chat log that shows only question-asking
when the log in fact contains the generation. That is the specific thing the
warning is about.

### J5. What the project can still do legitimately

Using AI to **understand** code is permitted and produces a genuine, submittable
log. That is the useful work available right now:

- walk through each file and explain what it does and why
- quiz yourself on a random function until you can explain it unaided
- ask why one approach was chosen over another, and what would break otherwise

The rule from `docs/genai-declaration.md` still stands on its own: if you cannot
explain a line, you cannot submit it.
