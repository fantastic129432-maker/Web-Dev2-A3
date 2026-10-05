# Charity Events Website - PROG2002 Assessment 3

A dynamic charity events website built for the PROG2002 Web Development II
case study: **"develop a dynamic website to manage charity events in your city"**.

The project has five parts, exactly as the assessment briefs define them:

| Part | Deliverable | Where it lives |
| --- | --- | --- |
| 1 | MySQL database `charityevents_db` | `database/` |
| 2 | RESTful API with NodeJS + ExpressJS | `api/` |
| 3 | Client-side website with HTML, JavaScript and DOM | `clientside/` |
| 4 | Admin-side website (a second, separate site for staff) | `clientside/admin/` |
| 5 | Deployment of both websites to the SCU cPanel host | the three submission zips |

### Technologies used, and what is deliberately absent

The brief permits Express on the server and **nothing else**: no CSS framework,
no JavaScript framework, and no templating engine (the pages are proper HTML
files, not EJS). This project holds to that, and it is worth stating plainly
because "no framework" is easy to claim and easy to break by accident.

| Layer | Used | Not used |
| --- | --- | --- |
| Pages | Hand-written HTML5, delivered as static files | No EJS / Pug / Handlebars - nothing is rendered server-side |
| Styling | One hand-written stylesheet (`clientside/css/styles.css`) using custom properties, grid and flexbox | No Bootstrap, Tailwind, Bulma or any other CSS framework |
| Browser JavaScript | Native ES modules (`import` / `export`) and the DOM API | No React, Vue, Angular, jQuery or Svelte; no bundler and no build step |
| Server | Node.js + Express + `mysql2`, for the API only | Express does not serve or render the pages |

Two things that look like frameworks but are not:

* **`mysql2`** is the database driver. It is not a web framework, and the
  restriction is about CSS/JS frameworks and templating.
* **The one inline `<script>` on each page** is about fifteen lines this project
  wrote itself. It reads the saved colour-scheme preference and sets
  `data-theme` before the stylesheet loads, which is what stops a dark-mode
  visitor seeing a white flash. It stays because removing it would make every
  page flash white on load. It is plain JavaScript in the page, not a library.

This was verified rather than assumed. The browser loads the client JavaScript
with no bundler, so any third-party dependency would have to appear as a bare
module specifier (`import x from 'some-package'`) - and there are none: every
import under `clientside/` is a relative path to another file in this project.
There are also no `<script src>` or `<link href>` tags pointing at another
domain, and no `@import` in the CSS.

Assessment 2 marked Parts 1-3 only (15% database, 20% API, 45% client website,
plus 5% accuracy/validation and 15% concept understanding); Assessment 3 has its
own marking split, printed in that brief.

Parts 1-3 were **extended** for Assessment 3 rather than replaced. Everything A2
was marked on still behaves as it did: the three public pages, the read
endpoints and the five A2 filters are unchanged, and the suite still runs the
original A2 checks. What A3 adds on top is a registration table, the full
C.R.U.D. cycle, a registration page and a second website for staff (see
section 8).

---

## 1. Quick start

You need **Node.js 18 or newer**. MySQL is used for the submitted
configuration; the API can also run without MySQL so the site can be marked
anywhere (see step 4).

### The easy way

```bash
node tools/start-all.mjs
```

That checks MySQL, starts the API and the website, and opens
<http://localhost:5500/index.html> for you. Both servers run in that one
terminal with their output prefixed `[api]` and `[web]`, so **Ctrl+C stops
both**. Add `--no-browser` if you would rather open the page yourself.

The admin website is served by the same static server, so once `start-all.mjs`
is running it is already available at
**<http://localhost:5500/admin/index.html>**. There is no second server and no
second command: it is another folder of static files that calls the same API.

### The step-by-step way

```bash
# ---------- Part 1: the database ----------
# MySQL 8.0.1+ required. In MySQL Workbench:
#   File > Open SQL Script > database/charityevents_db.sql
#   then click the lightning bolt to run the whole script.
# Or from a terminal, with a local MySQL server running:
mysql -u root -p < database/charityevents_db.sql

# ---------- Part 2: the API ----------
cd api
npm install
copy .env.example .env      # Windows  (cp .env.example .env on macOS/Linux)
# edit .env and set DB_PASSWORD to your own MySQL password
npm start                   # http://localhost:3000

# ---------- Parts 3 and 4: both websites ----------
# In a second terminal
cd clientside
node serve-clientside.js    # http://localhost:5500  (public site)
                            # http://localhost:5500/admin/index.html (admin site)
```

Then open **http://localhost:5500/index.html** for the public site and
**http://localhost:5500/admin/index.html** for the admin site.

> The client must be served over `http://`, not opened as a `file://` path.
> Browsers block ES modules and cross-origin `fetch()` from the file system.

### Verify everything at once

```bash
node tests/run-tests.js                     # every check, using the offline data source
set TEST_DATA_SOURCE=mysql && node tests/run-tests.js   # the same checks against MySQL
```

The suite starts its own API instance, on its own free port, so it never
disturbs a running server. It then works through four groups:

| Group | What it covers |
| --- | --- |
| PART A | HTTP checks for the Assessment 2 read endpoints, filters, validation and errors |
| PART C | HTTP checks for the Assessment 3 write endpoints: registration, full C.R.U.D., the delete rule and the admin view |
| PART B | DOM checks for the three Assessment 2 pages |
| PART D | DOM checks for the registration page, the event page's registrations table and the admin site |

The two A2 groups are the original **64 checks**, and two of them were
necessarily updated for A3: the check that `POST /api/events` was *not* routed
had to be inverted once the endpoint existed, and the check that Register opened
the "under construction" dialog no longer applies, because that dialog has been
replaced by the registration page. The rest of the A2 checks are untouched. The
A3 groups are added on top, and because they are still growing the total is
whatever the suite prints at the end of a run - read the number from the run
rather than from a document.

The DOM half of the suite loads the real HTML files and the real ES modules
into jsdom with `fetch` redirected to the test API, so it proves the data
actually reaches the page: event cards, the progress bar, ticket prices, the
filter checkboxes, Clear Filters, the registrations table, the registration
form and its confirmation card, and the admin event list.

---

## 1a. MySQL on this computer

MySQL runs here as the **official MySQL Server 8.4** installed with the MySQL
Installer and registered as a Windows service:

| | |
| --- | --- |
| Version | MySQL Community Server **8.4.11** |
| Program files | `C:\Program Files\MySQL\MySQL Server 8.4` |
| Data | `C:\ProgramData\MySQL\MySQL Server 8.4\Data` |
| Config | `C:\ProgramData\MySQL\MySQL Server 8.4\my.ini` |
| Windows service | **MySQL84** - starts automatically with Windows |
| Port | 3306 (plus 33060 for the X Plugin) |
| Collation | `utf8mb4_0900_ai_ci` - matches the schema |
| Client tools | `mysql.exe`, `mysqladmin.exe`, `mysqldump.exe` in the `bin` folder |

Two database accounts are used:

| Account | Privileges | Used by |
| --- | --- | --- |
| `root` | full | `tools/load-database.mjs` when (re)creating the database |
| `charity_app` | an application account limited to `charityevents_db` | the API, through `api\.env` |

The API account exists so the running application never connects as `root`, and
so that a mistake in the application cannot reach any other schema on the
server. That least-privilege argument still holds; what changed in Assessment 3
is the list of verbs the account needs.

A2 only read, so `SELECT` was enough. A3 adds `POST`, `PUT` and `DELETE`, so the
account must also be allowed to write:

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON charityevents_db.* TO 'charity_app'@'127.0.0.1';
FLUSH PRIVILEGES;
```

The host matters: `api/.env` sets `DB_HOST=127.0.0.1`, so the account MySQL sees
is `charity_app@127.0.0.1`. A `...@'localhost'` grant created by copy-pasting an
older note applies to a **different** account and will not take effect here.

Without those grants an insert, an update or a delete is refused by the server
with error 1142 ("command denied to user"), which surfaces as a 500 rather than
the 409 the user should see. That failure is easy to miss, because the automated
suite runs on the offline data source unless `TEST_DATA_SOURCE=mysql` is set, so
the first thing to check when a write fails against MySQL is this grant. **When
this was last checked, the grant had not been applied**: `charity_app` held
`SELECT` only, so a MySQL-backed demonstration of any A3 write would have failed.
Check with `SHOW GRANTS FOR CURRENT_USER();` and apply the statement above if the
only line returned is the `SELECT` one. Note that the account's privileges are one
thing and the schema's own rules are another: even with full rights,
`DELETE /api/events/:id` is refused when the event has registrations (section 3).

The second thing to check is whether the **A3 schema** is loaded at all. At the
time of writing this machine's MySQL instance still had the A2 database (six
tables, two views, no `event_registrations`), which `GET /api/health` reports
directly as `registrationTable: false`. Reload it with the command further down
this section before demonstrating anything from Assessment 3.

The real password lives only in `api\.env`, which is git-ignored and excluded
from the submission zips; `api\.env.example` carries a placeholder instead.
`api\.env.example` still documents the A2 grant (`SELECT` only) in its comment,
because that file is the template that shipped with A2 - read the grant above,
not the one in the template.

MySQL runs as the Windows service **MySQL84**, which starts with Windows, so in
practice you normally only need one command:

```bash
node tools/start-all.mjs      # API + website (MySQL is already running)
```

`start-all.mjs` checks whether port 3306 answers before doing anything, so it
never tries to start a second server.

Reloading the database after changing `database/02_seed.sql`. It needs an
account that can drop and recreate the database, so pass `root` - the
`charity_app` account in `api/.env` is an application account and the script
will say so:

```bash
node tools/load-database.mjs --user root --password "your_root_password"
```

Put the password in `DB_PASSWORD` instead of the command line if you would
rather it did not appear in the process list:

```bash
set DB_PASSWORD=your_root_password && node tools/load-database.mjs --user root
```

### Finding MySQL

`tools/load-database.mjs` and `tools/start-all.mjs` both locate the server in
the same order: `--mysql-home`, `%MYSQL_HOME%`,
`Program Files\MySQL\MySQL Server *` (newest version first),
`%USERPROFILE%\mysql`, then `<project>\mysql`. A MySQL installed somewhere else
therefore keeps working without editing any file.

---

## 2. Folder structure

```
charity-events-a2/
├─ database/                    Part 1
│  ├─ charityevents_db.sql      complete dump - run this one (schema + data)
│  ├─ 01_schema.sql             database, 7 tables, 5 views
│  └─ 02_seed.sql               6 organisations, 8 categories, 11 events, tickets, donations, 20 registrations
├─ api/                         Part 2  -> usernameA3-api.zip
│  ├─ server.js                 Express application entry point
│  ├─ .env.example              configuration template
│  └─ src/
│     ├─ db/event_db.js         REQUIRED filename: the MySQL pool, query(), transaction()
│     ├─ repositories/          all SQL (mysql) + offline twin (local), read half and write half
│     ├─ services/              query validation + business rules
│     │                         (eventService reads, eventWriteService writes, registrationService registers)
│     ├─ controllers/           HTTP layer (event, category, admin, registration)
│     ├─ routes/apiRoutes.js    the REST endpoints
│     ├─ middleware/            security headers, CORS, rate limit, errors
│     ├─ utils/validators.js    field validators that collect every problem, not just the first
│     └─ views/api-index.html   human-readable API index
├─ clientside/                  Part 3  -> usernameA3-clientside.zip
│  ├─ index.html                Home page
│  ├─ search.html               Search events page
│  ├─ event.html                Event detail page + the registrations table
│  ├─ registration.html         Register for an event (A3)
│  ├─ admin/                    Part 4  -> usernameA3-adminside.zip
│  │  ├─ index.html             Dashboard: counts, next events, latest registrations
│  │  ├─ events.html            All events, any status, with the delete action
│  │  ├─ new.html               Create an event
│  │  ├─ update.html            Update an event + its registrations
│  │  ├─ registrations.html     Every registration, newest first
│  │  ├─ css/admin.css          admin layout layered on the shared design tokens
│  │  └─ js/                    admin.js (shell + menu), admin-i18n.js, admin-shared.js,
│  │                            event-editor.js, and one controller per page
│  ├─ css/styles.css            one stylesheet, design tokens at the top
│  ├─ js/config.js              API base URL, nav items, weather constants
│  ├─ js/api.js                 all fetch() calls, read and write, one error type
│  ├─ js/dom.js                 every DOM builder and formatter
│  ├─ js/i18n.js                language state, persistence, DOM translation
│  ├─ js/translations.js        the four dictionaries (323 keys each)
│  ├─ js/theme.js               light / dark / system
│  ├─ js/nav.js                 the menu, footer and settings controls
│  ├─ js/home.js                Home page controller
│  ├─ js/search.js              Search page controller
│  ├─ js/event.js               Event detail controller, registrations table, weather panel
│  ├─ js/registration.js        Registration page controller (A3)
│  ├─ js/weather.js             optional Open-Meteo forecast (A3)
│  ├─ js/modal.js               the A2 "under construction" dialog - now unused, kept as history
│  └─ images/*.svg              offline artwork (no external requests)
├─ tests/run-tests.js           automated checks for the whole submission
├─ tools/                       see the table below
└─ docs/                        report, API docs, ERD, video script
```

### What is in `tools/`

Nothing in the running application imports anything here; these are the setup
scripts and the checks. Every one is JavaScript, so the whole project - server,
client and tooling - runs on Node with no second language to install. Each
earns its place:

| Tool | Purpose |
| --- | --- |
| `start-all.mjs` | Checks MySQL, starts the API and the static server for both websites, opens the browser |
| `load-database.mjs` | Drops and recreates `charityevents_db` from the SQL dump, then verifies it |
| `export-database-dump.mjs` | Assembles `charityevents_db.sql` from `01_schema.sql` + `02_seed.sql` and verifies its own object counts (`--check` fails if the dump is stale) |
| `export-cpanel-sql.mjs` | Produces `charityevents_db.mysql57.sql`, the variant to import on the SCU cPanel: `utf8mb4_unicode_ci` instead of the MySQL 8.0 collation, and no `DROP DATABASE` / `CREATE DATABASE` / `TRUNCATE` (all three are rejected or fail there) |
| `generate-local-data.js` | Regenerates the offline seed mirror from `02_seed.sql` |
| `configure-deployment.mjs` | Points `API_BASE_URL` and `CORS_ORIGIN` at the cPanel host before packaging (`--local` puts them back) |
| `verify-deployment.mjs` | Checks a finished deployment over HTTP: health reports MySQL, public list hides the suspended event, admin list shows it, registrations come back newest-first, a delete with registrations is refused with 409, and both websites load |
| `sync-theme-snippet.mjs` | Keeps the inline theme script in step with `js/theme.js` |
| `postman-yaml-to-collection.mjs` | Re-exports the Postman collection from its YAML storage |
| `fix-postman-collection.mjs` | Repairs the collection after an edit in the Postman UI |
| `check-no-secrets.mjs` | Refuses to publish a repository containing a real credential |
| `check-contrast.mjs` | Measures every text element against WCAG AA in both themes |
| `check-translations.mjs` | Fails if the four dictionaries differ or a key is missing |
| `make-submission-zips.mjs` | Builds the three A3 zips into `dist/`, refusing to ship `node_modules` or a real `.env` |
| `audit-references.mjs` | Fails if documentation points at a file that does not exist |
| `find-encoding-damage.mjs` | Detects text mangled by an encoding round trip |
| `download-mysql-parallel.mjs` | Downloads the official MySQL ZIP with parallel range requests |

---

## 3. Database design summary

Seven tables with primary and foreign keys:

```
organizations ──┐
categories    ──┼──< events >──┬──< ticket_types ──┐
locations     ──┘              ├──< donations      │
                               └──< event_registrations
```

The arrow from `ticket_types` into `event_registrations` is optional: the ticket
tier is nullable, and when it is used the foreign key guarantees the tier exists. "The
`(event_id, ticket_type_id)`, so a registration can only name a tier that
belongs to the same event.

* `events.status` (`active` / `suspended` / `cancelled`) is the publishing flag.
  Suspended events are filtered out by the view `vw_public_events`, so they can
  never appear on the public website.
* `upcoming` / `ongoing` / `past` is **derived** from `date_start`, `date_end`
  and `CURDATE()`. It is not stored, so the site is always correct without a
  scheduled job.
* `vw_event_progress` totals the `donations` rows per event, which is what the
  "Goal vs. Progress" bar displays.
* `event_registrations` (A3) records who registered for which event. Its unique
  key `uq_registration_event_email (event_id, attendee_email)` is the rule the
  brief names: **a person may register for many events but only once for any one
  event**. The API also checks first, so the caller gets a readable 409 instead
  of a raw duplicate-key error, and the key is still there as the guarantee.
* `event_registrations.event_id` is `ON DELETE RESTRICT`. That is the
  database-level half of the A3 rule "an event can only be deleted when it has
  not yet received any registrations": the API checks inside a transaction and
  answers 409, and MySQL refuses the delete anyway even if that check were
  bypassed.
* Four views were added or rewritten for A3: `vw_event_columns` holds every
  event column joined to its lookup tables plus `registration_count` and
  `tickets_sold`; `vw_public_events` is now
  `SELECT * FROM vw_event_columns WHERE status = 'active'`;
  `vw_all_events` is the same rows **without** the status filter, which is what
  the admin site reads; and `vw_event_registrations` adds the ticket name, the
  price and the computed `total_amount` to each registration.
* `locations.latitude` / `longitude` existed in A2 but were unused. A3 uses
  them: they are what the optional weather panel sends to Open-Meteo. The
  "Online (Australia-wide)" venue has NULL coordinates on purpose, so no
  forecast is attempted for it.

Full table dictionary and ER diagram: `docs/database-design.md`.

---

## 4. Running without MySQL (marker-friendly fallback)

`api/.env` has a `DATA_SOURCE` setting:

```ini
DATA_SOURCE=mysql   # default: read and write the MySQL database
DATA_SOURCE=local   # the same sample data in a generated JS mirror, in memory
```

With `DATA_SOURCE=local` the API starts with no database server at all and
serves exactly the same data, because `api/src/repositories/local-data.js` is
generated from `database/02_seed.sql` by `tools/generate-local-data.js`. This
exists so the client website can always be demonstrated, and it is also how the
automated test suite runs.

Assessment 3 had to extend this fallback rather than leave it behind: the write
endpoints are implemented twice, once per data source, so the offline mode can
also create, update and delete. `write.repository.local.js` and
`registration.repository.local.js` write into an in-memory store
(`local-store.js`) that starts as a copy of the seed data, and they enforce the
same rules as the MySQL repositories - one registration per email per event, and
no deleting an event that has registrations. That is what lets the A3 half of
the test suite exercise the delete rule on a machine with no MySQL, and it keeps
the two data sources honest: the same requests must produce the same answers.

---

## 5. API endpoints (summary)

A2 shipped the read half; A3 completes the C.R.U.D. cycle. `GET` requests are
unchanged, so the home page, the search page and the event page still work
exactly as they did.

**Read (A2, plus the A3 additions to `/api/events/:id`)**

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/health` | API and database status, including whether `event_registrations` exists |
| GET | `/api` | Index of the API |
| GET | `/api/events` | Filtered event list (home + search). New: `audience`, `publishStatus` |
| GET | `/api/events/upcoming` | Current and upcoming events |
| GET | `/api/events/:id` | Full detail, tickets, goal progress, **and the event's registrations newest first** |
| GET | `/api/events/:id/registrations` | Every registration for one event, newest first |
| GET | `/api/registrations` | Admin list across every event (`eventId`, `email`, `keyword`) |
| GET | `/api/registrations/:id` | One registration |
| GET | `/api/admin/events` | Admin list: **every** event, including suspended, cancelled and past |
| GET | `/api/admin/events/:id` | One event whatever its status, with its registrations |
| GET | `/api/admin/reference-data` | Organisations, categories and venues for the admin forms |
| GET | `/api/categories` | Category filter options |
| GET | `/api/locations` | Location filter options |
| GET | `/api/organization` | Organisation shown on the home page |
| GET | `/api/stats` | Headline numbers, now including registrations and tickets sold |

**Write (A3)**

| Method | Endpoint | Purpose |
| --- | --- | --- |
| POST | `/api/events` | Create an event. `201 Created` + a `Location` header |
| PUT | `/api/events/:id` | Update an event; only the fields sent are changed |
| DELETE | `/api/events/:id` | Delete an event. `204 No Content`, or **`409 Conflict`** when it has registrations |
| POST | `/api/events/:id/registrations` | Register for an event. `201` + `Location`; `409` for a duplicate email; `400` for a tier from another event or too many tickets |
| PUT | `/api/registrations/:id` | Update a registration |
| DELETE | `/api/registrations/:id` | Delete a registration. `204 No Content` |

The write handlers are mounted twice, at `/api/events...` and at
`/api/admin/events...`, and both mounts call the same controller, so there is
exactly one implementation of each rule. The admin mount exists because the
admin list must include suspended events, and putting that behind `/api/admin`
means a public caller cannot reach it by accident.

The rule worth reading the code for is the delete: the existence check and the
`DELETE` run inside **one transaction** with `SELECT ... FOR UPDATE`, so a
registration cannot slip in between them. When the event does have
registrations the answer is `409` with a message naming the event and the count,
and `details.suggestion = "suspend-instead"`. MySQL's `ON DELETE RESTRICT`
foreign key refuses the delete as well, and the driver error
`ER_ROW_IS_REFERENCED_2` is translated into the same 409.

Example search:

```
GET /api/events?state=all&city=Lismore&category=1&from=2026-09-01&sort=date&direction=asc
```

Example admin request (every event, suspended ones included):

```
GET /api/events?audience=admin&publishStatus=all&state=all
```

Full parameter list, sample responses and status codes:
`docs/api-documentation.md`.

---

## 6. Documentation

| File | Contents |
| --- | --- |
| `docs/PLAN.md` | Requirements extracted from the brief and the task plan |
| `docs/database-design.md` | ERD, table dictionary, design justification |
| `docs/api-documentation.md` | Every endpoint, parameter and response |
| `docs/project-report.md` | Project report - **answer the prompts in your own words** |
| `docs/video-script.md` | Demo video script: the three required questions plus the A3 demonstration |
| `docs/video-recording-guide.md` | How to record it on this machine: the tool, the setup, the exact URLs |
| `docs/genai-declaration.md` | The declaration statement to include |
| `docs/submission-checklist.md` | Pre-submission checklist |
| `docs/settings-theme-and-language.md` | The dark theme and the four language switcher |
| `docs/browser-behaviours.md` | Two browser behaviours that look like bugs, and the evidence |

---

## 7. Settings: dark theme and language

The header carries two extra controls, both remembered in `localStorage` so the
choice follows the visitor between pages:

* **Theme** - one button cycling light / dark / follow the system. The palette is
  already made of custom properties, so the dark theme is one block of overrides
  plus the components that were hard coded white. A small inline script applies
  the stored value before the first paint, so a dark user never sees a white
  flash.
* **Language** - English, 中文, Tiếng Việt and 日本語, **323** interface strings
  each (236 in A2, plus the registration form and the weather panel in A3).
  Markup carries `data-i18n` / `data-i18n-attr` attributes and the generated text
  goes through the same `t()` helper, so event cards, filter chips, the progress
  bar, the registration form and every message follow the switch.

**Scope limit, deliberately:** only the interface is translated. Event names,
descriptions and venues come from the database in English, and a short note in
the header says so while another language is selected. Translating the content
would need translated columns or a translations table - a content management
feature beyond the assessment. The admin site (section 8) is English only for
the same reason: the four-language dictionary is a feature of the public site,
and the brief asks the admin site for event management, not localisation.

These two features are **not required by the brief**; they are additional work on
top of the required pages. See
`docs/settings-theme-and-language.md` for the design notes, the two helper tools
that keep the dictionaries and the inline theme script honest, and the
assessment caveat about machine-written translations.

Check them with:

```bash
node tools/check-translations.mjs            # four dictionaries, same keys
node tools/sync-theme-snippet.mjs --check    # inline theme script in step
```

---

## 8. Two websites, one API

Assessment 3 asks for a second, separate website for staff, so the project now
serves two front ends from one static server and one API:

| | Public site (Part 3) | Admin site (Part 4) |
| --- | --- | --- |
| URL | <http://localhost:5500/index.html> | <http://localhost:5500/admin/index.html> |
| Files | `clientside/*.html`, `js/`, `css/` | `clientside/admin/*.html`, `admin/js/`, `admin/css/` |
| Audience | visitors: browse, search, register | staff: create, update and delete events |
| Data | reads `vw_public_events`, so suspended events never appear | reads `vw_all_events`, so every status is listed |
| Language | four languages | English only |
| Menu | Home, Search, Register | Dashboard, Events, Add event, Update event, Registrations |
| Zip | `usernameA3-clientside.zip` | `usernameA3-adminside.zip` |

Why a separate site rather than a hidden page on the public one? Because the two
have different audiences and different rules, and mixing them would put a
"Delete event" control one click away from a page a visitor uses. Keeping them
in separate folders means the public site can keep reading the status-filtered
view while the admin site reads the unfiltered one, and a marker can see the
split in the file tree.

They are not two copies of the same code. The admin site **reuses** the public
site's `js/api.js` (which already knows every endpoint and how to build an
`ApiError`), `js/dom.js`, `js/theme.js` and `css/styles.css` (so the design
tokens and the dark theme work there too), all through relative paths from
`admin/` - and adds only its own layout, its own data-table / banner / stat-tile
/ confirm-dialog styling (`admin/css/admin.css`) and its own English strings
(`admin/js/admin-i18n.js`). That is also why the admin zip ships those shared
files under the same relative paths: extracted on its own, it still runs.

The admin site is deliberately **not** in the public menu; it is linked from the
public footer (`nav.admin`), because it is staff tooling and not something a
visitor should be pointed at. The one styling trap worth knowing about is
recorded in a comment in `admin.css`: the public `.page-header` class paints a
`--brand-100` band, which is dark in the dark theme, so reusing it would produce
dark text on a dark band. The admin heading is therefore plain text on the page
background.

From the admin site you can:

* **Dashboard** - headline counts and the newest registrations, so the state of
  the data is visible at a glance (the counts are worked out in the browser from
  the two lists the page already loads, so there is no third endpoint for them);
* **Events** - every event whatever its status, with filters and a totals footer;
* **Add event** - a form built from one field description (`EVENT_FIELDS`) and
  populated from `GET /api/admin/reference-data`, with ticket-tier rows that can
  be added and removed;
* **Update event** - pick an event (or arrive with `?id=`), change what needs
  changing, and see its registrations; only the changed fields are sent;
* **Registrations** - every registration, filterable, with a per-row delete.

Both sites are static files, so both are deployed the same way: upload the
folder to the SCU cPanel host and point the API base URL at the deployed API.

### 8a. Deploying to the SCU cPanel (Part 5)

Step-by-step instructions, the `.env` to create on the host, and a symptom-to-cause
table for the things that go wrong: **`docs/deployment-cpanel.md`**.

There is only one value that has to change before uploading, and one command
changes it everywhere it appears:

```bash
# point the websites at the deployed API, and open CORS to the deployed site
node tools/configure-deployment.mjs --api https://<your host>/charity-events-api

# build the three archives
node tools/make-submission-zips.mjs --username <your SCU username>

# afterwards, back to local development
node tools/configure-deployment.mjs --local
```

`configure-deployment.mjs` exists because the failure it prevents is silent: if
`clientside/js/config.js` still says `http://localhost:3000/api`, the uploaded site
opens and then looks for the API **on the visitor's own machine**, so every list is
empty and nothing says why. The same command keeps `api/.env` and
`api/.env.example`'s `CORS_ORIGIN` in step with the site address, because a CORS
mismatch looks equally like a broken site from the outside.

The three submission zips are listed in `docs/submission-checklist.md`.

---

## 9. Academic integrity

GenAI Level 2 applies to this assessment: brainstorming, grammar, paraphrasing,
formatting and layout templates are permitted; **creating the report or
generating code to copy and paste is not**. Read, understand, modify and be
able to explain every file here, complete the report prompts yourself, and keep
the commits in your GitHub repository your own work.
