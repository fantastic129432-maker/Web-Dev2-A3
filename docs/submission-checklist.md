# Submission checklist

PROG2002 Web Development II - **Assessment 3**
**Weight:** 40% (the same unit weighting as A2; the A3 brief sets the part split)

> A note on the A2 corrections at the end of this file (section **J**). They were
> posted during Assessment 2 and they still matter: AI use requires the official
> prompt plus screenshots of your chat log. The A2 "no JavaScript or CSS
> framework" rule, however, was **reversed** by the A3 brief, which requires
> Angular v22 or later - section J2 records what replaced it.
>
> This project is a **TypeScript stack**: two Angular applications
> (`clientside/`, `adminside/`) sharing the `shared/` library, plus an Express API
> written in TypeScript and compiled to `api/dist/`. Everything below assumes
> that; if a path in this list looks like a `.js` source file under `api/`, it is
> out of date.

Work through this list top to bottom before you submit. Tick nothing you have
not actually verified.

---

## A. Database (Part 1)

> **Do this first.** The submitted configuration uses MySQL, so the A3 dump has to
> be loaded before Part 1 or the A3 write features can be demonstrated:
>
> ```bash
> npm run db:load -- --user root --password "your_root_password"
> # or:  mysql -u root -p < database/charityevents_db.sql
> ```
>
> After that, `GET /api/health` must report `registrationTable: true` and a
> `tableCount` of **12** (7 tables + 5 views).
>
> On this machine `api/.env` currently sets `DATA_SOURCE=local`, so the API starts
> and answers from the generated in-memory mirror with **no MySQL at all** - which
> is why `npm start` works here without a database server. Everything below still
> applies to the MySQL run the submission is configured for;
> `api/.env.example` ships with `DATA_SOURCE=mysql`.

- [ ] **The A3 dump is loaded** and `GET /api/health` reports
      `registrationTable: true`
- [ ] `charityevents_db` is created by `database/charityevents_db.sql`
- [ ] The script was run on a **clean** server and completed without errors
      (verified here on MySQL 8.4.11 Community Server)
- [ ] MySQL 8.0.1 or newer is used (the dump uses the `utf8mb4_0900_ai_ci`
      collation, `CHECK` constraints and `ON DELETE RESTRICT` foreign keys)
- [ ] On this computer MySQL is the Windows service **MySQL84** (8.4.11) and the
      API reads it with the application account `charity_app`
- [ ] `charity_app` has **`SELECT, INSERT, UPDATE, DELETE`** on
      `charityevents_db`. A2 needed `SELECT` only; the A3 write endpoints fail
      with MySQL error 1142 without the other three, so check the **live** grant
      rather than the template, whose comment still describes A2:
      `SHOW GRANTS FOR CURRENT_USER();`, then, if needed,
      `GRANT SELECT, INSERT, UPDATE, DELETE ON charityevents_db.* TO 'charity_app'@'127.0.0.1';`
      - note the host, because `api/.env` connects from `127.0.0.1` and a
      `@'localhost'` grant would create a different account
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
- [ ] Events 9, 10 and 11 have **no** registrations (only events 1-8 do), so a
      successful event delete can still be demonstrated
- [ ] `api/src/db/event_db.ts` exists, is named exactly, and connects to MySQL
      using a pool (it compiles to `api/dist/src/db/event_db.js`)
- [ ] `api/src/db/event_db.ts` was proof-read for hard-coded passwords (use `.env`)
- [ ] The SQL file is attached to the submission

## B. REST API (Part 2)

### Read endpoints (A2, still true)

- [ ] `cd api && npm install` completes
- [ ] `api/.env` exists (copied from `.env.example`) with the correct DB password
- [ ] `npm run build` inside `api/` compiles the TypeScript with no errors and
      writes `api/dist/server.js` - the compiled file is what runs, because the
      cPanel's Node version cannot execute TypeScript
- [ ] `npm start` inside `api/` (which runs `node dist/server.js`) prints the data
      source it is using and, with `DATA_SOURCE=mysql`, that the database is
      connected
- [ ] `GET /api/health` returns 200, `registrationTable: true`, and a
      `tableCount` of **12** - that number comes from `information_schema`, so it
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
      with the A3 requests added to the A2 ones. The repository copy is
      `docs/postman/PROG2002-A2-Charity-Events-API.postman_collection.json` and it
      already holds the **Assessment 3 - the write endpoints** folder
- [ ] **Authentication is deliberately absent** and you can say why: the brief
      says "assume that authentication is not required"

## C. Client-side website (Part 3)

The public site is the `clientside` Angular application. Its routes are `/`,
`/search`, `/events/:id`, `/register/:id` and the catch-all 404.

### Home, search and event pages (A2, still true)

- [ ] `npm start` runs, and `http://localhost:4200/` opens the public site
- [ ] **Home page**: static organisation information is visible
- [ ] **Home page**: the event list is loaded from the API (check the Network tab)
- [ ] **Home page**: each card shows name, category, location, date, price,
      image and progress, and links to the detail page
- [ ] **Home page**: no past event and no suspended event appears
- [ ] **Menu**: present and working on the public pages (the 404 route hides the
      menu on purpose)
- [ ] **Search page**: date, location and category controls all work
- [ ] **Search page**: more than one category can be selected at once
- [ ] **Search page**: criteria combine (test Lismore + Fun Run + a date range)
- [ ] **Search page**: **Clear Filters** resets everything
- [ ] **Search page**: error messages are shown for invalid input, with no
      request sent (watch the Network tab)
- [ ] **Search page**: an empty result set shows a helpful message, not a blank page
- [ ] **Search page**: the chosen filters appear in the address bar and a reload
      reproduces the same search
- [ ] **Detail page**: `/events/1` shows only the selected event
- [ ] **Detail page**: full description, venue, times, capacity and purpose
- [ ] **Detail page**: ticket prices shown, including a free tier
- [ ] **Detail page**: goal vs. progress bar with real figures

### The registration page (A3)

- [ ] **Register** on the event page is a real link to `/register/<id>` - the A2
      "under construction" dialog is gone (a past event shows a disabled button
      instead of a dead link)
- [ ] Opening `http://localhost:4200/register/1` directly shows **that** event,
      and the page loads it from `GET /api/events/1`
- [ ] Opening `http://localhost:4200/register` with **no** id shows the friendly
      404 - a registration form that cannot know its event is not offered
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
- [ ] **Optional weather panel**: it is present on **every** event page. For an
      upcoming event with coordinates inside the 16-day window it shows the date,
      the summary, the temperature range and the rain chance
- [ ] Where a forecast is impossible the same panel explains why, in the visitor's
      language and with no console error: the online venue (no coordinates), an
      event more than 16 days away, a past event - and, with the machine offline,
      "no forecast is available" instead of silence. None of those states uses the
      error styling, and the panel is genuinely absent only on the error branch
      (an id that does not resolve, such as the suspended event)

## D. Admin-side website (Part 4)

The staff site is the `adminside` Angular application, on its **own port**. Its
routes are `/`, `/events`, `/events/new`, `/events/:id/edit`, `/registrations`
and the catch-all 404.

- [ ] `http://localhost:4300/` opens, with no second command and no second API
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
- [ ] **Add event**: the live **weather preview** appears for the chosen venue and
      date (the same Open-Meteo service the public event page uses) and simply
      says it is unavailable when there is nothing to show
- [ ] **Add event**: a valid submission creates the event (201) and the new event
      appears in the Events list
- [ ] **Update event**: `/events/1/edit` (from the list's Edit link or typed)
      loads the event, and a **suspended** event still loads - the admin endpoint
      returns it as a 200 where the public one returns 404
- [ ] **Update event**: changing one field sends only that field - confirm the
      request body in the Network tab is the small diff, not the whole event
- [ ] **Update event**: submitting with nothing changed is refused with a clear
      message and sends no request
- [ ] **Update event**: the event's registrations are listed read-only, each with
      a working delete, and the warning that registrations block the event delete
      is visible
- [ ] **Delete**: the confirmation dialog appears; cancelling does nothing
- [ ] **Delete**: deleting an event that **has** registrations shows a warning
      banner with the API's message, the registration count, the "suspend it
      instead" suggestion and a link to the registrations, and that row's Delete
      button is disabled and relabelled
- [ ] **Delete**: deleting event 9 (no registrations) shows a success banner and
      the list reloads without it
- [ ] **Registrations** page lists all registrations, filters them and deletes one
- [ ] Both sites follow the light/dark theme, and the header controls switch
      language on both (the shared library carries the choice across)
- [ ] Reload the SQL dump after the delete demonstrations

## E. Deployment (Part 5)

> **Full step-by-step instructions: [`deployment-cpanel.md`](deployment-cpanel.md).**
> It covers the cPanel screens, the exact `api/.env` to create on the host,
> importing the SQL through phpMyAdmin, the `.htaccess` rewrite the two
> single-page applications need for deep links, and a symptom-to-cause table. The
> list below is the checkable summary.

- [ ] `npm run deploy:configure -- --site https://<host>/ --api https://<host>/charity-events-api`
      has been run **before** the production build. It edits
      `clientside/src/environments/environment.production.ts`,
      `adminside/src/environments/environment.production.ts` and
      `CORS_ORIGIN` in `api/.env` together. Skipping it is the single most common
      deployment failure: the uploaded site then looks for the API on the
      visitor's own machine and every list is simply empty. Afterwards,
      `npm run deploy:configure -- --local` puts the machine back
- [ ] `api/.env` on the host exists and has `DATA_SOURCE=mysql`, the cPanel MySQL
      host/username/password/database, and `CORS_ORIGIN` set to the deployed
      site's **origin** - no path, because a browser `Origin` header never
      contains one
- [ ] `database/charityevents_db.mysql57.sql` was imported through phpMyAdmin (the
      host runs MySQL 5.7, which rejects the `utf8mb4_0900_ai_ci` collation in
      `database/charityevents_db.sql`), and the database holds **7 tables + 5
      views**, `events` = 11 rows, `event_registrations` = 20 rows
- [ ] `https://<host>/charity-events-api/api/health` answers
      `"connected": true` and `"registrationTable": true` on the public internet
- [ ] The uploaded layout, which needs no path to be edited:
      * the **contents** of `site/` from `usernameA3-clientside.zip` go to the
        site root, so `index.html` and the hashed `main-*.js` / `styles-*.css`
        files are directly under the public URL;
      * the **contents** of `site/` from `usernameA3-adminside.zip` go to
        `public_html/admin/`, because that build uses `baseHref: /admin/`;
      * the API is uploaded as the **compiled** `api/dist` plus
        `api/package.json` (and its own `.env`) into
        `/home/<user>/charity-events-api/`, and the Passenger **Application
        startup file** is `api/dist/server.js` - the host cannot run TypeScript
- [ ] Each uploaded folder has the `.htaccess` rewrite to `index.html`, so a deep
      link such as `/search` or `/admin/events` works when typed or refreshed
- [ ] The production API address in both `environment.production.ts` files points
      at the **deployed** API, not at `localhost`
- [ ] `CORS_ORIGIN` on the deployed API lists the deployed site's origin
- [ ] The deployed public site opens, loads events and can register someone
- [ ] The deployed admin site lists the suspended event and can create, update
      and delete
- [ ] The event page's optional weather panel either works or explains itself
      quietly on the deployed site (an external API may be blocked on a shared
      host; that must not break the page, and the panel must not read as an error)
- [ ] Both deployed sites were opened in a **private browser window**, so nothing
      depends on a local session
- [ ] The URLs to submit are written down, ready to paste into the submission

## F. Automated tests

Run everything from the project root.

- [ ] `npm test` prints `131 passed, 0 failed`
- [ ] That run covers the HTTP contract against the real Express API **and** the
      jsdom regression suite over the archived vanilla frontend under `legacy/`;
      the printout is read from the run itself, not from this document
- [ ] You have run the suite **after** your last code change
- [ ] `npm run test:mysql` also prints `0 failed` (this is the run that proves the
      MySQL repositories behave like the offline ones, and the run that catches a
      missing grant)
- [ ] `npm run build:local` has been run, then `npm run test:e2e` prints
      `40 end-to-end checks passed` - headless browser checks over **both** Angular
      applications against the compiled API
- [ ] `npm run check:angular` prints `16 checks passed` - the architecture guard:
      Angular v22, two applications, standalone components, zoneless, a real
      `.html` template and a doc comment per component, no cross-application
      imports, both applications importing `shared/`, the early-theme script in
      both `index.html` files, and a TypeScript-only API that compiles to `dist/`
- [ ] `npm run check:translations` prints `12 checks passed`, with **298** keys in
      each of the four client languages and **250** in each of the four admin
      languages, and every key the templates ask for present. The tenth check
      reads the VALUES rather than the keys: it fails when a Chinese, Vietnamese
      or Japanese string still contains an English word, which is how the home
      page's `已发布的 upcoming 活动` statistic was found. It keeps a hand-written
      allow-list of the words that have to stay in Latin letters, each BY NAME
      with its reason, and an entry that stops being needed fails as well:
      acronyms (`API`, `ID`), the currency code `AUD`, the sort examples `A-Z`
      and `Z-A`, the course code and roman numeral `PROG2002` / `Web` / `II`,
      the weather brand `Open-Meteo` with its domain `Open-Meteo.com`, the place
      names `Lismore` and `New South Wales` and the example city `Lis`, the
      example name `Nguyễn Văn An`, the Vietnamese word `do` and the Vietnamese
      loanwords `web`, `email`, `menu` and `gala`. The eleventh check is
      `tools/check-template-literals.mjs`, and it makes two statements about a
      template: no user-facing word may be written into one instead of resolved
      from a dictionary (which the key-based checks cannot see), and no dictionary
      key may be offered as the **fallback** for a value that can win -
      `{{ organization()?.mission || ('about.mission' | t) }}`, the exact
      expression that rendered the API's English mission under the Chinese "Who we
      are" heading while every other check passed it. The twelfth check is
      `tools/check-ts-literals.mjs`, the sibling that closes the same hole in
      **TypeScript**: a sentence written into a component, a service or a route
      definition is in no template and in no dictionary, so all eleven checks
      above passed while the Chinese home page rendered the API's English
      `mission` and every public page carried an English route title. It has its
      own allow-list, by name with a reason (CSS class strings and selectors
      computed in code, the developer diagnostics behind `ApiError.friendlyMessage`,
      the console warnings, the pre-paint theme script and its media query, and a
      language's name in its own language), an entry that stops matching fails,
      and its limits are stated in the file: a string built at runtime, a sentence
      assembled from fragments, a value that is legitimately English, a
      single-word literal handed to an unlisted helper, and text the API serves
      as content
- [ ] `npm run check:shared` type-checks `shared/` on its own with no errors
- [ ] `npm run check:refs`, `npm run check:secrets` and `npm run check:encoding`
      are clean

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
      page, the admin site, the migration to Angular and TypeScript, and the
      optional external API
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

### The three archives

- [ ] `usernameA3-api.zip` built (replace `username` with your SCU username)
- [ ] `usernameA3-clientside.zip` built
- [ ] `usernameA3-adminside.zip` built
- [ ] They were produced by `npm run zip` (or the manual equivalent at the end of
      this file), and the dry run reported no `ERROR` lines
- [ ] Each front-end archive contains `README-SUBMISSION.md`, `site/` (the built
      application, ready to upload) and `source/` (the trimmed Angular workspace
      it can be rebuilt from)
- [ ] `usernameA3-api.zip` contains `api/server.ts`, `api/src/`, `api/dist/`,
      `api/package.json` and `api/.env.example`
- [ ] All three zips open correctly and contain the expected folders
- [ ] `.env` is **not** inside the api archive if it contains a real password
      (`.env.example` should be there instead)
- [ ] `node_modules` is **not** inside any archive
- [ ] `legacy/` is **not** inside any archive - the archived A2 frontend is kept
      in the repository as a reference and a regression-test target, and is
      deliberately not submitted
- [ ] The GitHub link is in the submission and is accessible to the marker
- [ ] The repository is private, or the marker has been invited as a collaborator
- [ ] The video is uploaded to SCU OneDrive, the link is shareable and you have
      tested it in a private browser window
- [ ] **The video is at most 15 minutes, focuses on your own contribution, and
      still answers the three required questions** (see your role's script:
      `docs/video-script-frontend.md` for the client side, or
      `docs/video-script-backend.md` for the server side)
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
      * the connection file: **`api/src/db/event_db.ts`** (compiled to
        `api/dist/src/db/event_db.js`)
      * the new table: **`event_registrations`**
      * the running API entry point: **`api/dist/server.js`**
      * authentication is **deliberately absent** and you can justify it
- [ ] Be ready to answer, without notes: why the unique key is on
      `(event_id, attendee_email)` and not on the email alone; what the
      transaction and `FOR UPDATE` add to the delete rule; what would still stop
      a bad delete if the API check were deleted; why the API is compiled before
      it runs
- [ ] Submit with time to spare - late submissions may be penalised

---

## Build the three archives

There are two ways to do this. Use the script - it is the one that has been
tested, and it refuses to build an archive that is missing a required file.

### The script (preferred)

```bash
npm run build                                    # api/dist, dist/clientside, dist/adminside
node tools/make-submission-zips.mjs --dry-run    # show what each archive would contain
npm run zip -- --username YourUsername           # write them into dist/
npm run zip -- --username YourUsername --out dist
```

* The **username** comes from the `author` field in the root `package.json`
  (`"<your name> (<your SCU username>)"`), so it is edited in one place; pass
  `--username` to override it. If neither is filled in, the script refuses to
  write anything and says which field to edit.
* An archive is no longer "a folder minus another folder", because the two
  applications live in one workspace:
  * `usernameA3-clientside.zip` - the **public** application: `site/` (the built
    site, ready to upload) plus `source/` (the workspace, this application,
    `shared/` and `assets/`, trimmed to what this one application needs to
    rebuild);
  * `usernameA3-adminside.zip` - the same shape for the staff application. The
    other application is deliberately absent from each: it has its own archive,
    and including both would submit the same code twice;
  * `usernameA3-api.zip` - the TypeScript API: `api/server.ts`, `api/src/`,
    `api/scripts/`, `api/tsconfig.json`, `api/package.json`,
    `api/package-lock.json`, **the compiled `api/dist/`** and
    `api/.env.example`.
* It never includes `node_modules`, `.git`, `api/.env`, `legacy/`, any `dist/`
  build cache or local scratch files, and it fails loudly (an `ERROR:` line) if an
  archive is missing a file it must contain - `site/index.html`,
  `source/<app>/src/main.ts`, `source/shared/src/`, `api/server.ts`,
  `api/dist/server.js` and so on.
* If the built output is missing the script writes nothing and names the command
  to run. `--skip-build-check` exists only for inspecting the layout; the archives
  it writes are **not** submittable.
* Build with **`npm run build`**, not `npm run build:local`. The archives must
  carry the production build, which has the deployed API address baked in from
  `environment.production.ts` and hashes every asset name; `build:local` produces
  the development build that points at `localhost`, and it is only for
  `npm run test:e2e`. The script cannot tell the two apart, so this one is on you.

- [ ] `node tools/make-submission-zips.mjs --dry-run` lists three archives with
      no `ERROR` lines
- [ ] The three zips are built, and the GitHub link and video link are ready to
      submit with them

### The manual equivalent

If the script cannot be run, the same three archives can be built by hand from
the project root with `Compress-Archive`. Replace `username` with your SCU
username. Build the project first (`npm run build`), because the front-end
archives carry the **built** site and the API archive carries the compiled
`dist/`.

```powershell
# a single staging folder, so the archive entries land at the same paths the
# script produces (site/..., source/..., api/...)
$stage = "stage-a3"
Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue

# --- api zip: the TypeScript sources AND the compiled dist/ the host runs -----
New-Item -ItemType Directory -Force "$stage\api" | Out-Null
Copy-Item api\* "$stage\api" -Recurse -Force
Remove-Item "$stage\api\node_modules" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item "$stage\api\.env" -Force -ErrorAction SilentlyContinue
Compress-Archive -Path "$stage\api" -DestinationPath "usernameA3-api.zip" -Force

# --- one front-end archive: site/ = built app, source/ = buildable workspace ---
function New-FrontendArchive($app, $buildFolder, $zipName) {
  $root = "$stage\$app"
  New-Item -ItemType Directory -Force "$root\site", "$root\source" | Out-Null
  Copy-Item "$buildFolder\*" "$root\site" -Recurse -Force
  Copy-Item angular.json, tsconfig.json, tsconfig.shared.json, package.json, package-lock.json, .gitignore "$root\source"
  Copy-Item $app "$root\source\$app" -Recurse -Force
  Copy-Item shared "$root\source\shared" -Recurse -Force
  Copy-Item assets "$root\source\assets" -Recurse -Force
  Compress-Archive -Path "$root\*" -DestinationPath $zipName -Force
}

New-FrontendArchive "clientside" "dist\clientside" "usernameA3-clientside.zip"
New-FrontendArchive "adminside"  "dist\adminside"  "usernameA3-adminside.zip"
```

Then verify each one. No archive may contain `.env`, `node_modules` or `legacy/`:

```powershell
Add-Type -AssemblyName System.IO.Compression.FileSystem
foreach ($z in @("usernameA3-api.zip", "usernameA3-clientside.zip", "usernameA3-adminside.zip")) {
  $a = [System.IO.Compression.ZipFile]::OpenRead((Resolve-Path $z))
  "{0}: {1} entries" -f $z, $a.Entries.Count
  $bad = $a.Entries | Where-Object { $_.FullName -match 'node_modules|(^|/)\.env$|(^|/)legacy/' }
  if ($bad) { "  PROBLEM: " + ($bad.FullName -join ', ') } else { "  no .env, no node_modules, no legacy" }
  $a.Dispose()
}
```

Finally, confirm each archive is usable **after extraction on its own**, which is
what the marker will do. The entries inside the archives are `api/dist/server.js`,
`site/index.html`, `source/<app>/src/main.ts` and so on; the staging folder built
above holds exactly those files, one level down under `stage-a3\`:

```powershell
# the api archive must carry the compiled entry point the host runs
Test-Path stage-a3\api\dist\server.js                        # True
Test-Path stage-a3\api\src\db\event_db.ts                    # True
Test-Path stage-a3\api\.env.example                          # True
# each front-end archive carries the built site AND a buildable workspace
Test-Path stage-a3\clientside\site\index.html                # True
Test-Path stage-a3\clientside\source\clientside\src\main.ts  # True
Test-Path stage-a3\clientside\source\shared\src\api\api.service.ts   # True
Test-Path stage-a3\adminside\site\index.html                 # True
Test-Path stage-a3\adminside\source\adminside\src\main.ts    # True
# and neither front-end archive contains the other application, or legacy/
Test-Path stage-a3\clientside\source\adminside               # False
Test-Path stage-a3\clientside\source\legacy                  # False
```

The staging folder is not part of the repository; delete it afterwards:

```powershell
Remove-Item stage-a3 -Recurse -Force
```

---

## J. Unit Assessor updates from Assessment 2 (still in force)

Two announcements changed the rules during A2. This section records each one and
exactly where the project stands, because parts of them carry into Assessment 3.

### J1. The A2 deadline moved

From **28 September** to **5 October 2026, 11:59 pm**. One extra week. Keep this
here only as history: the A3 due date is the one printed in the A3 brief.

### J2. The A2 "no framework" rule, and what replaced it

> "You are NOT allowed to use any frameworks for CSS or Javascript. You may use
> the Express framework to build the server side script, that's all. Do not use
> any Templating provided by Express... Your webpages must be delivered using
> only HTML, CSS and JS."

That was the **Assessment 2** rule, and the A2 submission complied with it.
**Assessment 3 reverses it for the frontends**: the brief requires *HTML +
TypeScript + CSS + Node.js + Angular v22 or later + an external API*. The
frontends are therefore Angular applications, written in TypeScript, and a
document that still describes them as "plain HTML, CSS and JS" is out of date.

What the A2 announcement still means, and where the project stands:

- [x] **Express is the only server-side framework.** The API's runtime
      dependencies are `express` and `mysql2` (a database driver, not a
      framework). CORS headers are written by hand in `api/src/middleware/security.ts`
- [x] **No template engine anywhere**: no `view engine`, no `res.render`, no EJS,
      Pug, Handlebars or Nunjucks. The API's one HTML page is served as a plain
      file
- [x] **No CDN**: every script, stylesheet and image is served from the
      application's own bundle, so both sites work offline. `check:angular`
      enforces this
- [x] **`jsdom` is a dev dependency only**, for the test suite over the archived
      frontend. It is not part of either website and is not shipped in any archive
- [x] **No PowerShell or batch file is tracked in the repository.** The
      `start.cmd`, `start-local.cmd` and `start-local.ps1` launchers that exist in
      the working folder are local conveniences listed in `.gitignore`, so they
      never reach GitHub or an archive; the documented entry point is
      `npm start` (which runs `tools/start-all.mjs`)

The A2 checks were made by reading the code, and reading is not repeatable. What a
script can assert is asserted now:

```bash
npm run check:angular        # 16 checks, including "no page loads a script from a CDN"
npm run check:translations   # the four languages of both dictionaries, and no English literal left in a template or in TypeScript
npm test                     # the API contract, endpoint by endpoint
```

The two rules no script covers - the runtime dependency list and the absence of a
template engine - are re-read in `api/package.json` (two runtime dependencies,
`express` and `mysql2`, and no template engine package) and in `api/server.ts`,
whose one HTML page is still served with `res.sendFile()`. Both are unchanged
since A2.

The A2 architecture guard asserted the opposite rule ("no framework") and was
**deleted**, because keeping it would fail the build for the right reason and the
wrong outcome. `docs/angular-architecture.md` records the reasoning, including
why the guard tests properties (no NgModule, no `zone.js`, a `templateUrl` per
component) rather than searching the source for the word "Angular".

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
