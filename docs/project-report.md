# Project Report - Charity Events Website

**Unit:** PROG2002 Web Development II
**Assessment:** Assessment 2 - Case Study (Dynamic website)
**Student name:** _fill this in_
**Student number / SCU username:** _fill this in_
**GitHub repository:** _paste your repository link here_
**Date submitted:** _fill this in_

**Formatting reminder from the brief:** 12-point Arial, 1.5 line spacing.
Referencing is not required for this assessment.

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

> 1 short paragraph. Name the case study, state what you built (a dynamic
> charity events website), and list the three parts of the assessment you
> delivered: the database, the REST API, and the client-side website.

_Your answer_

### 1.1 Purpose and scope

> 1 paragraph. State the purpose: let the public discover charity events,
> search them by date/location/category, and view the full details of one
> event including its tickets and fundraising progress. State what is out of
> scope for A2 (registering and paying for tickets, admin functions) and why
> (they belong to Assessment 3).

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
> description, ticket price (including free), registration form and
> goal vs. progress; a menu on every page; a Register button that shows the
> "under construction" dialog.

| # | Requirement | Source in the brief |
| --- | --- | --- |
| FR1 | _..._ | Home page requirements |
| FR2 | _..._ | _..._ |

### 2.2 Non-functional requirements

> Cover: dynamic data must come from the API rather than being hard-coded;
> only approved technologies (NodeJS, HTML, JavaScript, DOM, MySQL, no
> AngularJS); usability on desktop and mobile; data integrity and security
> (parameterised queries, validation, suspended records never exposed);
> maintainability (separated layers, comments); performance (pagination,
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
> Explain why the layers are separated and what each one is responsible for.
> Mention that `event_db.js` creates one shared connection pool.

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
> Show the SQL you find most interesting (`repository.mysql.js`) and explain
> it line by line.

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

> Report how you tested the API: the Postman collection you built and the
> result of `node tests/run-tests.js` (state the number of checks that pass).
> Include one or two screenshots of Postman showing a search filter and an
> error response.

_Your answer_

---

## 5. Client-side website development (Part 3)

> About 2 pages.

### 5.1 Structure of the client

> Describe the three pages, what each one is for, and the shared pieces:
> one stylesheet, `nav.js` generating the menu and footer on every page,
> `api.js` centralising every `fetch()` call, and `dom.js` holding all of the
> DOM construction.

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

> Explain how the event id is passed (query string `event.html?id=7`, with
> localStorage as a fallback), what is displayed (full description, purpose,
> venue, times, capacity, organisation, ticket tiers including free tiers,
> goal vs. progress), and how the Register button opens the modal with the
> exact required message. Explain why a real modal was used instead of
> `window.alert()`.

_Your answer_

### 5.5 Data flow from API to page

> This is the question the video asks as well. Describe the full sequence in
> numbered steps: page loads -> the module runs -> `api.js` builds the URL ->
> `fetch()` returns a Promise -> the JSON envelope is unwrapped -> an ApiError
> is thrown if the response is not successful -> `dom.js` turns each event
> object into DOM nodes -> the nodes are inserted into the container. Mention
> that the loading, empty and error states are all rendered with DOM methods.

_Your answer_

### 5.6 User experience and design

> Describe the design decisions: colour palette and why it suits a charity
> brand, typography and spacing scale, card layout, progress bar, badges for
> past/upcoming, sticky navigation, responsive rules, accessibility work
> (semantic landmarks, labels on every input, `aria-live` regions,
> `aria-valuenow` on the progress bar, keyboard support and focus handling in
> the modal, `prefers-reduced-motion`).

_Your answer_

### 5.7 Cross-browser and responsive testing

> State the browsers and widths you tested and what you found.

_Your answer_

---

## 6. Testing

> About 1 page.

### 6.1 Test approach

> Explain the three levels you used: manual testing in the browser against the
> running API, Postman for the endpoints, and the automated suite in
> `tests/run-tests.js` which starts its own API instance and checks both the
> HTTP responses and the rendered DOM.

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

## 8. Future work (Assessment 3)

> List what comes next: registration and ticket purchasing with POST
> endpoints, donation processing, an admin side to create, suspend and restore
> events, authentication and authorisation, and email confirmation.

_Your answer_

---

## 9. Conclusion

> Half a paragraph. Confirm that the brief has been met, name the three parts
> delivered, and state that the site is fully driven by the API and the
> database rather than hard-coded data.

_Your answer_

---

## Appendix A - Project structure

> Paste the folder tree from the README and note which files are submitted in
> `usernameA2-clientside.zip` and which in `usernameA2-api.zip`.

---

## Appendix B - How to run the project

> Paste the quick-start steps from the README, in your own words, so the marker
> can reproduce your environment.

---

## Appendix C - Generative AI declaration

> Include the statement from `docs/genai-declaration.md` here (and in your
> final submission), choosing statement A or B depending on your own use.

---

## Appendix D - References to your own repository

> List the commits you are most proud of with their messages, as evidence of
> your work progress. For example:
>
> * `feat(database): create charityevents_db schema with 6 tables and 2 views`
> * `feat(api): add /api/events search filters for date, location and category`
> * `feat(client): render home page event cards from the API`
