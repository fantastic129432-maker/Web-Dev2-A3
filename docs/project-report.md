# Project Report - Charity Events Website

**Unit:** PROG2002 Web Development II
**Assessment:** Assessment 3 - Case Study (Dynamic website, two frontends)
**Student name:** _fill this in_
**Student number / SCU username:** _fill this in_
**GitHub repository:** _paste your repository link here_
**Date submitted:** _fill this in_

**Formatting reminder from the brief:** 12-point Arial, 1.5 line spacing.
Referencing is not required for this assessment.

> **Architecture note (updated for Assessment 3).** This report now describes the
> **full TypeScript stack** the A3 brief requires: two **Angular v22**
> applications (public and admin) written in HTML, TypeScript and CSS, and a
> **TypeScript** Node.js/Express API compiled to the `dist` folder inside the API
> folder. The database and the REST behaviour are unchanged from Assessment 2.
> The technical detail behind every architecture claim below is in
> [`angular-architecture.md`](angular-architecture.md); the A2 report content -
> the case study, the database design, the endpoint design and the reflection -
> carries over and is marked where it needed updating.

---

> ## How to use this file
>
> This is a **template with the structure and the prompts already worked out**.
> The brief does not permit GenAI to write your report, so every answer below
> must be written by you, in your own words, describing the work you can see in
> the repository. The prompts (in the blockquotes) tell you what each section
> must cover and roughly how long it should be.
>
> Before you submit: delete every blockquote prompt and every `_placeholder_`,
> then read the whole report once from start to finish as a marker would.

---

## 1. Introduction

> 1-2 short paragraphs. Name the case study; state the **required technology
> stack** for Assessment 3 (HTML, TypeScript, CSS, Node.js, Angular v22 or
> later, plus the external Open-Meteo weather API); and list the parts you
> delivered: the MySQL database, the TypeScript REST API, the public Angular
> website, the separate Angular administration website, and the deployment.
> Say in one sentence that the frontend and the API were migrated from the
> Assessment 2 vanilla HTML/CSS/JavaScript versions and that the database and
> the REST behaviour were deliberately left unchanged.

_Your answer_

### 1.1 Purpose and scope

> 1 paragraph. State the purpose: let the public discover charity events,
> search them by date/location/category, view the full details of one event
> including its tickets, fundraising progress and the complete list of
> registrations, and register for an event; and let staff manage events
> (create, update, delete) and read every registration through a second,
> separate website. State what is out of scope and why (payment processing,
> authentication - the A3 brief says authentication may be assumed absent -
> and a translated content layer).

_Your answer_

---

## 2. Analysis of the case study

> About 1 page. Do not describe your code here; describe the **problem**.
> Work through the requirements in the brief and turn each one into a
> requirement of your own.

### 2.1 Functional requirements

> Present these as a numbered list. Cover at least: home page with organisation
> information and a dynamic event list; events marked past/upcoming from their
> dates; suspended events hidden; search by date, location and category
> (one or many at once); clear filters; event detail page with full
> description, ticket price (including free), goal vs. progress, the complete
> list of registrations and a forecast from the external weather API; a
> registration form; a separate staff website with a dashboard, a list of every
> event whatever its status, and create / update / delete forms.

| # | Requirement | Source in the brief |
| --- | --- | --- |
| FR1 | _..._ | Home page requirements |
| FR2 | _..._ | _..._ |

### 2.2 Non-functional requirements

> Cover: dynamic data must come from the API rather than being hard-coded;
> **the technology is prescribed for A3 - HTML, TypeScript, CSS, Node.js,
> Angular v22 or later, and an external API - so explain how the implementation
> satisfies that (one Angular workspace with two applications, a shared
> TypeScript library, a TypeScript API compiled to `dist`, the Open-Meteo
> forecast) rather than justifying the choice against the A2 "no framework"
> rule**; usability on desktop and mobile; accessibility (semantic landmarks,
> labelled inputs, live regions, keyboard support, WCAG AA contrast in both
> themes); data integrity and security (parameterised queries, three validation
> layers, suspended records never exposed, the delete rule); maintainability
> (separated layers, one shared library, a comment on every component, and the
> automated architecture checks); performance (lazy-loaded routes, pagination,
> indexes).

_Your answer_

### 2.3 Assumptions

> List the assumptions you made where the brief was open, for example:
> the site represents one featured charity and also lists partner charities;
> paying for tickets is out of scope; currency is AUD; the platform is
> Australian.

_Your answer_

---

## 3. Database design (Part 1)

> About 1.5 pages. Base this on `docs/database-design.md`, but explain the
> reasoning in your own words rather than copying the tables.

### 3.1 Design approach

> Explain how you moved from the case study to the entities: what repeats
> (organisations, categories, venues) became lookup tables, what the main
> resource is (events), and which repeating details became child tables
> (ticket tiers, donations). Include your ER diagram, either as an image
> exported from MySQL Workbench or as a table listing.

_Your answer_

### 3.2 Tables and relationships

> One short paragraph per table: what it stores, its primary key, its foreign
> keys, and why it exists. Mention the cardinality: one organisation to many
> events, one event to many ticket types, one event to many donations.

_Your answer_

### 3.3 How the "past / upcoming" rule is implemented

> Explain that the state is **derived**, not stored: `date_start` and
> `date_end` are compared with `CURDATE()` in `vw_public_events`. Explain why
> this is better than a stored status column (no scheduled job, never stale)
> and what `event_date` is for.

_Your answer_

### 3.4 How suspended events are hidden

> Explain the `status` column and the `WHERE e.status = 'active'` clause inside
> `vw_public_events`. Explain why putting the rule in the view is safer than
> repeating it in each query, and how you tested it (event id 11 must return
> 404 and must never appear in a list).

_Your answer_

### 3.5 Goal vs. progress

> Explain `vw_event_progress`: it sums `donations.amount` per event and
> calculates the percentage against `events.goal_amount`, and why a view was
> used instead of a generated column.

_Your answer_

### 3.6 Sample data

> State the counts: 6 organisations, 8 categories, 9 locations, 11 events
> (including 2 past and 1 suspended), 18 ticket tiers and 42 donations, and
> note that this exceeds the required minimum of 8 events and several
> categories. Explain that the suspended event is there deliberately as a test
> case.

_Your answer_

### 3.7 Data integrity and validation

> Explain the three validation layers (client, API service layer, database
> constraints) and give two or three examples of the CHECK constraints and
> foreign key rules you used and why.

_Your answer_

---

## 4. API design and development (Part 2)

> About 1.5 pages.

### 4.1 Architecture

> Describe the request path:
> route -> controller -> service -> repository -> MySQL.
> Explain why the layers are separated and what each one is responsible for
> (the controller speaks HTTP, the service validates and applies business
> rules, the repository is the only place with SQL). Mention that
> `event_db.ts` creates one shared connection pool and that `transaction()`
> was added in A3 for the all-or-nothing delete.
>
> Then explain the **TypeScript build**, because it changes how the API is
> deployed: `api/server.ts` and the modules under the API's `src/` folder are
> compiled by `tsc` into the `dist/` folder beside them, the output mirrors the
> source layout (`api/server.ts` -> `api/dist/server.js`), and the compiled
> `server.js` in `dist` is what
> runs both locally and on the SCU cPanel, whose Node version cannot execute
> TypeScript. Say what that bought (types across every layer, one `Repository`
> interface that the MySQL and offline data sources both satisfy) and what it
> cost (a build step, and a path problem: `env.ts` has to walk up to find
> `api/.env` from inside the compiled `config` folder under `dist`).

_Your answer_

### 4.2 RESTful design decisions

> Justify your URLs against REST principles: resources are nouns
> (`/api/events`, not `/api/getEvents`); filtering uses query parameters on the
> collection rather than a different path per filter; a single resource is
> addressed by id (`/api/events/7`); fixed sub-paths (`/api/events/upcoming`)
> are declared before `:id`; only safe GET methods exist in A2.

_Your answer_

### 4.3 Endpoints

> Summarise each endpoint in one or two sentences and state what page of the
> website it serves. Include the `/api/health` diagnostic.

| Endpoint | Serves | Notes |
| --- | --- | --- |
| `GET /api/events` | Home + Search | _your note_ |
| `GET /api/events/:id` | Event detail | _your note_ |

### 4.4 The search endpoint in detail

> This is the endpoint the marker will test. Explain how the query is built:
> each filter adds one condition to a list, values are bound as placeholders,
> the filter is wrapped in a derived table so the total count and the page use
> exactly the same conditions, and the sort column is chosen from a whitelist.
> Show the SQL you find most interesting (in the MySQL repository under
> `api/src/repositories/`) and explain it line by line. Note that the
> repository is now TypeScript like the rest of the API - the SQL itself did
> not change, only the language it is written in.

_Your answer_

### 4.5 Validation and error handling

> Explain that the service layer validates types, formats, ranges and
> relationships (for example `to` must not be earlier than `from`), collects
> all problems, and returns one 400 response with a `details` array so the
> client can show messages next to the right field. Explain the `asyncHandler`
> wrapper and the single error middleware.

_Your answer_

### 4.6 Security considerations

> Explain the decisions you made: parameterised queries to prevent SQL
> injection; whitelisting for the sort parameter; `limit` capped at 100 to
> prevent data scraping in one request; CORS restricted to the website origin;
> rate limiting per IP; security headers; no internal error details leaked in
> production; suspended events not disclosed even when the id is known.

_Your answer_

### 4.7 Testing evidence

> Report how you tested the API: the Postman collection you built, the result
> of `npm test` (`tests/run-tests.js`, state the number of checks that pass),
> and the A3 write checks. Include one or two screenshots of Postman showing a
> search filter and an error response. Mention that the same suite can be run
> against MySQL with `npm run test:mysql`.

_Your answer_

---

## 5. Client-side website development (Part 3)

> About 2 pages. This section describes the **Angular** public website.

### 5.1 Structure of the client

> Describe the application: it is the `clientside` project of one Angular
> workspace (`angular.json`), bootstrapped from
> `clientside/src/main.ts`, with the routing table in
> `clientside/src/app/app.routes.ts` and the shell (header, router outlet,
> footer) in `clientside/src/app/app.html`. Name the five routes and say why
> each page is loaded with `loadComponent` rather than imported eagerly. Then
> describe the shared pieces and where they live: the layout components
> (`layout/site-header`, `layout/site-footer`, `layout/settings-bar`), the
> reusable pieces under `app/shared/` (the progress bar, the API status
> indicator, the document-title helper), and the `shared/` library that both
> applications compile in - `ApiService` for every HTTP call, the models, the
> i18n service and the theme service. Say why the library is a path-mapped
> TypeScript folder (`@charity/shared/*` in the root `tsconfig.json`) rather
> than an `ng-packagr` library.

_Your answer_

### 5.2 Home page

> Explain the two kinds of content: the **static** organisation information
> (welcome message, mission, contact details) and the **dynamic** event
> listing. Describe what each summary card shows (event name, category,
> location, date, price, image, progress) and how the card links to the detail
> page.

_Your answer_

### 5.3 Search page

> Explain each control and why it fits the data type: date inputs for dates, a
> text field with a datalist for the city, checkboxes for categories (because
> multiple categories may be chosen). Explain how one or many criteria are
> combined, how the Clear Filters button works with DOM manipulation, how
> client-side validation reports problems, and how the removable filter chips
> and URL synchronisation work.

_Your answer_

### 5.4 Event detail page

> Explain how the event id reaches the page (the `:id` route parameter, read
> from the router rather than a query string), what is displayed (full
> description, purpose, venue, times, capacity, organisation, ticket tiers
> including free tiers, goal vs. progress), and - **new in A3** - the complete
> **list of registrations**, newest purchase first, plus the **Open-Meteo
> forecast** for the venue's own coordinates on the event's own date. Explain
> why the forecast is treated as a bonus: `WeatherService.forecastFor()`
> resolves `null` rather than throwing when the venue has no coordinates, the
> date is outside the 16-day window, the event is past, or the network fails, so
> the page renders either way. Say how the Register button links to
> `/register/:id`.

_Your answer_

### 5.5 Data flow from API to page

> This is the question the video asks as well. Describe the full sequence in
> numbered steps: the router activates a lazy route -> the page component
> injects `ApiService` -> `ApiService` builds the URL from the injected
> `API_BASE_URL` token and applies the 10-second timeout -> Angular's
> `HttpClient` sends the request -> Express routes it through controller,
> service and repository to MySQL -> MySQL answers -> the repository, service
> and controller assemble the `{success, meta, data}` envelope -> the component
> receives the **unwrapped payload** (or an `ApiError`, which is the only error
> type it can see) -> the template renders it. Explain that the envelope is
> unwrapped in exactly one place and that the rendered states are driven by
> **signals**, which is also why the page re-renders when the data or the
> language changes. Mention the loading, empty and error states.

_Your answer_

### 5.6 User experience and design

> Describe the design decisions: colour palette and why it suits a charity
> brand, typography and spacing scale, card layout, progress bar, badges for
> past/upcoming, sticky navigation, responsive rules, accessibility work
> (semantic landmarks, labels on every input, `aria-live` regions,
> `aria-valuenow` on the progress bar, keyboard support, `prefers-reduced-motion`,
> and the WCAG AA contrast checks that run over every route in both themes).

_Your answer_

### 5.7 Cross-browser and responsive testing

> State the browsers and widths you tested and what you found.

_Your answer_

---

## 6. Testing

> About 1 page.

### 6.1 Test approach

> Explain the four levels you used: manual testing in the browser against the
> running API; Postman for the endpoints; the automated suite in
> `tests/run-tests.js`, which starts its own API instance and checks both the
> HTTP responses and the rendered DOM of the archived A2 frontend; and the
> **browser end-to-end suite** in `tests/angular-e2e.mjs`
> (`npm run test:e2e`), which loads the built Angular applications in a real
> headless browser and asserts that they bootstrap, route, fetch from the API
> and paint the result. Mention the Angular unit tests (`npm run test:ng`) and
> the architecture checkers (`npm run check:angular`,
> `npm run check:translations`, `npm run check:shared`). Say plainly why the
> archived frontend is still covered: it is a fast regression test of the API
> contract, and the Angular side is covered properly by the browser suite.

_Your answer_

### 6.2 Test results

> Include a table of the main test cases and their results, and paste the
> summary line from the test suite output.

| # | Test case | Input | Expected | Result |
| --- | --- | --- | --- | --- |
| 1 | Home lists only upcoming events | open home page | 8 cards, no past badge | _pass/fail_ |
| 2 | Suspended event is hidden | `GET /api/events/11` | 404 | _..._ |
| 3 | Search by city and category | Lismore + Fun Run | 1 result | _..._ |
| 4 | Invalid date range | from 2026-12-01, to 2026-01-01 | 400 + message | _..._ |
| 5 | Clear Filters | click the button | form and results reset | _..._ |
| 6 | Register button | click | under construction modal | _..._ |

### 6.3 Issues found and fixed

> This section carries real marks for "accuracy, efficiency and validations".
> Describe at least two genuine defects you found and how you fixed them, for
> example: a single-date search returned nothing because the range logic
> excluded the event's own date; a filter combination was not narrowing
> results; a missing id produced a blank page instead of an error message.

_Your answer_

---

## 7. Challenges and reflection

> About half a page. Be honest and specific: what was genuinely difficult, what
> you would do differently, and what you learned about the interaction between
> client, API and database.

_Your answer_

---

## 8. Migration to Angular and TypeScript (Assessment 3)

> About 1 page. This is the architecture section the A3 brief is really asking
> about, so be specific and be honest about the trade-offs.
>
> Cover, in your own words:
>
> * **What the brief required** (HTML, TypeScript, CSS, Node.js, Angular v22+,
>   an external API) and **what changed**: the vanilla frontend and the
>   JavaScript API were both replaced, while the database and every REST
>   response stayed the same.
> * **One workspace, two applications**: why `clientside` and `adminside` are
>   separate Angular applications in a single `angular.json` rather than one
>   application with a hidden admin route, and how they avoid duplicating code
>   (the shared library, the DI tokens, the same design tokens).
> * **The shared library**: what is in it (the API layer and its one error type,
>   the models, the i18n service, the theme service, the formatters, the weather
>   integration, the injection tokens), why it is a **path-mapped TypeScript
>   folder rather than an `ng-packagr` library** (no extra build step, no
>   publish cycle, identical bundle - at the cost of an independent type-check,
>   which `tsconfig.shared.json` restores), and how the `API_BASE_URL` /
>   `OTHER_SITE_URL` / `APP_DICTIONARIES` tokens keep it from hard-coding either
>   application's environment.
> * **Angular-specific decisions**: zoneless change detection (no `zone.js`, no
>   polyfills, state carried in signals), standalone components instead of
>   `NgModule`s, real `.html` template files because the brief asks for HTML,
>   `strictTemplates` and strict TypeScript, and lazy-loaded routes so a page
>   still downloads only its own code.
> * **The i18n design**: four languages, two dictionaries (290 client keys and
>   249 admin keys when this was written - `npm run check:translations` prints
>   the current counts), the language held in a signal so every template that reads
>   a translation re-renders by itself, one shared `localStorage` key so the
>   choice follows a visitor between the two sites, and the completeness checks
>   that make a missing translation a test failure rather than a blank label.
> * **The external API**: Open-Meteo, chosen because it needs no key; the
>   coordinates come from `locations.latitude` / `longitude`; the WMO codes are
>   mapped to translation keys; and every failure path resolves to `null` so a
>   missing forecast can never break the event page.
> * **The TypeScript API build**: `tsc` to `api/dist`, the output mirroring the
>   source layout, and why compiling is not optional (the cPanel's Node cannot
>   run TypeScript). Mention the one migration problem it created and the fix -
>   finding `api/.env` from `api/dist/src/config/` by walking up to the
>   `package.json`.
> * **What was rejected and why**. Pick two or three and give the reason: an
>   `ng-packagr` library, keeping `zone.js`, one application with an admin
>   section, proxying Open-Meteo through the API, running the API with
>   `ts-node`, deleting the archived frontend.
> * **The trade-offs you accept**: a build step between the source and the
>   browser; more moving parts than one folder of static files; new framework
>   vocabulary to learn; and `legacy/` deliberately kept in the repository.
> * **How the architecture is protected**: `npm run check:angular` tests
>   properties that would have to change for the requirement to break (Angular
>   version, both applications configured, no `NgModule`, no `zone.js`, no
>   inline template, every component documented, the apps not importing each
>   other, both using the shared library, no CDN script, the API being
>   TypeScript that compiles to `dist/`).

_Your answer_

---

## 9. Conclusion

> Half a paragraph. Confirm that the brief has been met, name the parts
> delivered (database, TypeScript API, public Angular website, admin Angular
> website, deployment), and state that the site is fully driven by the API and
> the database rather than hard-coded data - and that the whole stack is now
> TypeScript, as Assessment 3 requires.

_Your answer_

---

## Appendix A - Project structure

> Paste the folder tree from the README and note which files are submitted in
> `usernameA3-clientside.zip`, which in `usernameA3-adminside.zip` and which in
> `usernameA3-api.zip`. Note that `legacy/` is kept in the repository but is
> deliberately **not** part of any submission archive.

---

## Appendix B - How to run the project

> Paste the quick-start steps from the README, in your own words, so the marker
> can reproduce your environment. Two things matter here and are easy to get
> wrong: `npm start` compiles the TypeScript API before serving, and both
> Angular applications need `npm install` at the repository root (there is one
> `node_modules` for the whole workspace).

---

## Appendix C - Generative AI declaration

> Include the statement from [`genai-declaration.md`](genai-declaration.md) here
> (and in your final submission), choosing statement A or B depending on your
> own use.

---

## Appendix D - References to your own repository

> List the commits you are most proud of with their messages, as evidence of
> your work progress. For example:
>
> * `feat(database): create charityevents_db schema with 6 tables and 2 views`
> * `feat(api): add /api/events search filters for date, location and category`
> * `feat(client): render home page event cards from the API`
