# Angular architecture

**PROG2002 Web Development II - Assessment 3**
How the two Angular applications, the shared TypeScript library and the compiled
TypeScript API fit together, and **why** each decision was made.

This document is the technical companion to the [README](../README.md). The
README tells a reader what the project is and how to run it; this file explains
the design, the trade-offs and the alternatives that were rejected, because the
assessment grades demonstrated understanding rather than the mere presence of
Angular.

---

## Contents

1. [Why Angular](#1-why-angular)
2. [The workspace: one `angular.json`, two applications](#2-the-workspace-one-angularjson-two-applications)
3. [`shared/` is a path-mapped folder, not an ng-packagr library](#3-shared-is-a-path-mapped-folder-not-an-ng-packagr-library)
4. [The DI-token pattern that keeps the shared library app-agnostic](#4-the-di-token-pattern-that-keeps-the-shared-library-app-agnostic)
5. [Data flow: browser -> Angular service -> Express -> MySQL and back](#5-data-flow-browser--angular-service--express--mysql-and-back)
6. [Signal-based i18n](#6-signal-based-i18n)
7. [Zoneless change detection](#7-zoneless-change-detection)
8. [The weather integration and its graceful degradation](#8-the-weather-integration-and-its-graceful-degradation)
9. [The TypeScript API build, and why cPanel needs it](#9-the-typescript-api-build-and-why-cpanel-needs-it)
10. [Testing strategy](#10-testing-strategy)
11. [What was rejected, and why](#11-what-was-rejected-and-why)
12. [The four segments: Header, Nav, Body and Footer](#12-the-four-segments-header-nav-body-and-footer)

---

## 1. Why Angular

The Assessment 2 brief permitted **no** framework: "HTML, CSS and JavaScript
only, no framework". The project complied, and the Assessment 2 architecture
checker enforced it. The Assessment 3 brief reverses that requirement and asks
for **HTML + TypeScript + CSS + Node.js + Angular v22 or later + an external
API**.

So the interesting question is not "why a framework" - the brief settles that -
but **why the vanilla frontend was replaced rather than carried along**, and
what the framework actually bought.

### What Angular replaced, concretely

The vanilla site was four HTML documents plus a folder of ES modules. It worked,
and it was marked well, but several parts of it were hand-written versions of
things a framework provides:

| Vanilla mechanism | What it was doing | Angular replacement |
| --- | --- | --- |
| `js/nav.js` writing the same header and footer markup into all four documents | One layout, four copies, kept in step by hand | `clientside/src/app/app.html` - the shell is rendered once, above `<router-outlet>` |
| `js/api.js` with one `fetch()` wrapper and an `ApiError` class | One HTTP layer, one error shape | the shared API service and its error class, both in `shared/src/api/` |
| `js/i18n.js` + `data-i18n` attributes + a DOM translation pass | Re-render the page when the language changes | `shared/src/i18n/translation.service.ts` (signals) + `translate.pipe.ts` |
| `js/theme.js` + an inline `<head>` script | Apply the stored theme before the first paint | `shared/src/theme/theme.service.ts` + `EARLY_THEME_SNIPPET`, still inline in `<head>` |
| `js/dom.js` building event cards with `document.createElement` | Turn an event object into DOM | components with real `.html` templates and `@if` / `@for` |
| Linking between pages by navigating to another document | Full page reload per navigation | the Angular router, with lazy `loadComponent` so the *code* still splits per page |
| No formal tests of the frontend | Behaviour checked by hand and in the jsdom suite | `ng test` for both applications, plus the browser end-to-end suite in `tests/angular-e2e.mjs` |

The parts that did **not** need replacing are equally important: the database,
the REST contract, the four languages, the theme system, the CSS design tokens
and the sample data all carried over unchanged. That is why the API's behaviour
is identical after the migration - the brief asked for a stack change, not a
rewrite of what the application does.

### What the framework actually bought

* **One layout, one place to change it.** The header and footer moved out of
  four documents into `app.html`, so the "Admin site" link, the language
  switcher and the health indicator exist once.
* **Typed boundaries.** The API's envelope is an interface
  (`shared/src/models/api.model.ts`), an event is an interface
  (`event.model.ts`), and `strictTemplates` means a template that reads a field
  the API does not send fails the build rather than rendering "undefined".
* **Real dependency injection.** The API base URL is a token, not a global
  constant, which is what makes one shared library serve two applications with
  different environments.
* **Lazy route components preserve what the four-document site had for free.**
  A single-page application bundles everything together by default, which would
  have *lost* the property that a visitor only downloads the page they asked
  for. `loadComponent` with a dynamic `import()` restores it; see the comment at
  the top of `clientside/src/app/app.routes.ts`.

### The honest costs

*The migration is not free, and pretending otherwise would be worse than
useless.* A build step now sits between the source and the browser, so a change
is not visible until the build finishes. Angular's own vocabulary - signals,
standalone components, injection tokens, zoneless change detection - has to be
learned and applied consistently. Two applications and a shared library are more
moving parts than one folder of static files. And the archived frontend has to be
kept in the repository (see [section 10](#10-testing-strategy)) rather than
deleted, which is a real, deliberate piece of duplication.

---

## 2. The workspace: one `angular.json`, two applications

```
charity-events-a3/
├─ angular.json          <- ONE workspace, TWO applications
├─ tsconfig.json         <- strict compiler options + the @charity/shared/* alias
├─ tsconfig.shared.json  <- type-checks shared/ on its own
├─ clientside/           <- project "clientside"  (public website, port 4200)
├─ adminside/            <- project "adminside"   (staff website,  port 4300)
└─ shared/               <- plain TypeScript, compiled into BOTH
```

`angular.json` declares two entries under `projects`, each with its own
`root`, `sourceRoot`, `prefix`, build options and serve port. Three settings in
there are worth pointing at:

* **`"polyfills": []`.** An empty array is not an oversight - it is the zoneless
  decision made concrete. There is no `zone.js` to load.
* **`fileReplacements`** on the production configuration swaps
  `src/environments/environment.ts` for `environment.production.ts`. That is the
  standard Angular mechanism, and it means the API address is decided at build
  time rather than by a runtime guess.
* **`"baseHref": "/admin/"`** on the admin production configuration. Both
  applications are built from one workspace, but they deploy to different
  folders on the same host, so the admin build has to be told where it lives or
  its hashed assets would resolve against the site root.

### The two routing tables

The public application (`clientside/src/app/app.routes.ts`):

| Route | Component (lazy) | Required by |
| --- | --- | --- |
| `''` | `pages/home/home` -> `HomePage` | A2 home page: organisation, About, Contact, event listing |
| `'search'` | `pages/search/search` -> `SearchPage` | A2 search page: keyword, dates, city, categories, chips |
| `'events/:id'` | `pages/event-detail/event-detail` -> `EventDetailPage` | A2 detail page + the A3 registration list |
| `'register/:id'` | `pages/register/register` -> `RegisterPage` | A3 registration form |
| `'**'` | `pages/not-found/not-found` -> `NotFoundPage` | The friendly 404 |

The staff application (`adminside/src/app/app.routes.ts`):

| Route | Component (lazy) | Purpose |
| --- | --- | --- |
| `''` | `pages/dashboard/dashboard` -> `Dashboard` | Statistics plus the API/database health report |
| `'events'` | `pages/event-list/event-list` -> `EventList` | Every event regardless of status, with Delete |
| `'events/new'` | `pages/event-new/event-new` -> `EventNew` | The create form |
| `'events/:id/edit'` | `pages/event-edit/event-edit` -> `EventEdit` | The update form, plus that event's registrations |
| `'registrations'` | `pages/registrations/registrations` -> `Registrations` | Every registration across every event |
| `'**'` | `pages/not-found/not-found` -> `NotFound` | The friendly 404 inside the admin shell |

The admin table declares the literal `events/new` before `events/:id/edit`.
The two cannot actually collide (one has two path segments, the other three), but
keeping the literal first is the habit that stops a future single-segment
`events/:id` route from swallowing `events/new` - and the comment in the file
says so.

Two details of the public table are deliberate and both are commented in the
source:

* **Nothing is eagerly imported.** Every page is loaded with `loadComponent`, so
  the home page's bundle does not contain the search form, the registration form
  or the registrations table. This preserves the property the four-document
  vanilla site had for free.
* **The route `title` is a translation key carried in `data.titleKey`, and the
  visible tab title is set by `setDocumentTitle()` in
  `clientside/src/app/shared/page-title.ts`.** The router evaluates `title:`
  once, when it activates the route, with no access to `TranslationService` - a
  hard-coded English string there would stay English after the visitor switched
  to Chinese. The `title:` strings are kept as well, because they document each
  route's intent where a reader looks for it.

---

## 3. `shared/` is a path-mapped folder, not an ng-packagr library

`shared/` contains all the code both applications need and nothing either one
owns. It is consumed through **one path alias** in the root `tsconfig.json`:

```json
"paths": {
  "@charity/shared/*": ["./shared/src/*"]
}
```

so an import reads:

```ts
import { ApiService } from '@charity/shared/api/api.service';
```

and resolves straight at the TypeScript source inside the shared folder.

### Why not `ng generate library` (ng-packagr)?

The idiomatic Angular answer to "code shared by two applications" is a
workspace library built with ng-packagr. It was considered and rejected:

| | ng-packagr library | path-mapped source folder (chosen) |
| --- | --- | --- |
| Extra build step | Yes - the library must be built before either application | No |
| Publish/consume cycle | Yes - the applications consume the built output, so a change needs a rebuild of the library first | No - a change is picked up by the next application build |
| Tooling | `ng-packagr`, `ng-package.json`, a second `tsconfig` per entry point | One alias |
| Enforces a public API surface | Yes, via `public-api.ts` | No |
| Tree-shaking | Yes | Yes - it is the same TypeScript the application bundler already processes |
| Independent versioning | Yes | Not applicable |

For a **single-repository, single-team assessment project** with exactly two
consumers, the extra build product earns nothing: it adds a failure mode
("the applications built against a stale library") and a step to every change,
in exchange for a public-API boundary nobody needs. The bundle is identical
either way, because `shared/` is plain TypeScript that the application bundler
tree-shakes like any other source.

The one genuine loss is that a path-mapped folder has **no independent
type-check**: an application only type-checks the files it imports. A service
that neither application imports *yet* could carry a type error that nobody
sees. That is exactly what `tsconfig.shared.json` exists to fix:

```bash
npm run check:shared        # tsc -p tsconfig.shared.json --noEmit over shared/src/**/*.ts
```

### What is in `shared/`, and why each part is shared

| Path | Contents | Why it is shared rather than duplicated |
| --- | --- | --- |
| `shared/src/api/` | `api.service.ts` (every HTTP call, one timeout, one envelope unwrap) and `api-error.ts` (the single error type, with `isConflict`, `fieldErrorMap` and `friendlyMessage(t)`) | Both sites call the same API, and the 409 delete rule and the 400 field errors are rendered by both sites |
| `config/app-config.ts` | Timeout, Open-Meteo URL/timezone/window, storage keys, image base, `EVENT_IMAGES`, `PUBLISH_STATUSES` | The two sites must agree on the storage keys or the language and theme would not carry between them |
| `config/environment.model.ts` | The `AppEnvironment` interface | Both environment pairs implement one shape |
| `models/*.ts` | The API envelope, `Event`, `EventDetail`, `Registration`, reference data | One type per resource, from one source |
| `weather/*` | The Open-Meteo integration and its WMO code mapping | The admin form previews the same forecast the public page shows |
| `i18n/*` | Languages, the two dictionaries, the service and the pipe | Four languages of interface text are needed by both sites, with different dictionaries |
| `theme/theme.service.ts` | light / dark / system + `EARLY_THEME_SNIPPET` | A visitor's theme choice must survive moving between the two sites |
| `util/format.ts` | Currency, dates, times, `imageUrl()` | The same event must be formatted the same way on both sites |
| `di/tokens.ts` | `API_BASE_URL`, `OTHER_SITE_URL` | The two values that genuinely differ per application - see the next section |

### Why the dictionaries stay separate

`client-translations.ts` holds **290 keys** and `admin-translations.ts` holds
**249** (the counts at the time of writing, printed by
`npm run check:translations`), and they are deliberately not merged. The public
dictionary is about a visitor's journey (browsing, searching, registering); the
admin one is about staff work (editing events, reading registrations). Very few
strings are genuinely shared, and merging them would produce one large file in
which neither audience can find its own wording - and would make each site carry
the other's text.

---

## 4. The DI-token pattern that keeps the shared library app-agnostic

The shared library needs two values that differ per application:

* the REST API root (`http://localhost:3000/api` locally, the cPanel URL in
  production),
* the URL of the *other* website (the admin site as seen from the public site,
  and the reverse).

The obvious wrong answer is for the shared code to import an environment file.
That cannot work, because the library is compiled into **both** applications: if
it imported `clientside/src/environments/environment`, the admin application
would pull the public site's settings in with it, and the production build of
one site could ship the other site's API address.

The pattern is an **injection token** - a typed, opaque key that the consuming
application provides a value for:

```ts
// shared/src/di/tokens.ts
export const API_BASE_URL = new InjectionToken<string>('API_BASE_URL');
export const OTHER_SITE_URL = new InjectionToken<string>('OTHER_SITE_URL');

// the shared API service, shared/src/
private readonly baseUrl = inject(API_BASE_URL).replace(/\/+$/, '');
```

and each application declares the values once, in its own `app.config.ts`:

```ts
// clientside/src/app/app.config.ts
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withInMemoryScrolling({ scrollPositionRestoration: 'top' })),
    provideHttpClient(),
    { provide: API_BASE_URL, useValue: environment.apiBaseUrl },
    { provide: OTHER_SITE_URL, useValue: environment.otherSiteUrl },
    { provide: APP_DICTIONARIES, useValue: CLIENT_DICTIONARIES },
  ],
};
```

`adminside/src/app/app.config.ts` is the same file with `environment` from the
admin folder, `ADMIN_DICTIONARIES`, and the other site's URL. That is the whole
of the difference between the two applications' configuration - which is the
point: a reviewer can diff the two files and see everything that is genuinely
app-specific.

**The dictionary uses the same pattern.** `TranslationService` injects
`APP_DICTIONARIES` (declared in `shared/src/i18n/translation.service.ts`)
instead of importing a dictionary, so one service compiled into both
applications translates with whichever dictionary its host provided.

There is a second, quieter benefit: the shared services become trivially
testable. A test provides a token and never has to touch an environment file or
mock a module.

`npm run check:angular` verifies the pattern is still intact: it fails if either
application stops providing `API_BASE_URL`, or provides the wrong dictionary.

---

## 5. Data flow: browser -> Angular service -> Express -> MySQL and back

### 5.1 The outward journey

```
  BROWSER
     |
     | 1. The router activates a lazy route, e.g. /events/2
     v
  EventDetailPage (clientside/src/app/pages/event-detail/)
     |
     | 2. inject(ApiService).getEventById(2)
     v
  ApiService  (the shared API service, shared/src/)
     |   - buildUrl:  API_BASE_URL (injected) + "/events/2"
     |   - timeout({ each: APP_CONFIG.requestTimeoutMs })      10 s
     v
  HttpClient  (Angular, provided by provideHttpClient())
     |
     | 3. GET http://localhost:3000/api/events/2      (XMLHttpRequest)
     v
  Express  (api/dist/server.js, compiled from api/server.ts)
     |   - security headers, CORS, rate limiter, JSON body cap
     |   - request log
     v
  routes/apiRoutes.ts  ->  controllers/eventController.ts
     |   - the controller only speaks HTTP
     v
  services/eventService.ts
     |   - validates every query parameter, collects ALL problems
     v
  repositories/index.ts
     |   - picks the mysql repository or the offline local one
     v
  repositories/repository.mysql.ts
     |   - builds the SQL, binds every value as a ? placeholder
     |   - reads vw_public_events (status = 'active' only)
     v
  db/event_db.ts  ->  mysql2 pool  ->  MySQL charityevents_db
```

The rule that makes the layering worth having: **a layer only knows the layer
below it.** The controller never writes SQL, the service never touches `req` or
`res`, and the repository never decides an HTTP status. Each one can therefore be
reasoned about (and replaced) on its own - which is exactly what let the whole
`api/src` tree be converted to TypeScript without a single behavioural change.

### 5.2 The return journey

```
  MySQL rows
     |
     | the view has already joined the category, venue and organisation names
     | and computed registration_count / tickets_sold
     v
  repositories/repository.mysql.ts   ->  plain objects
     |
     v
  services/eventService.ts           ->  business shape (eventState, daysUntil, ...)
     |
     v
  controllers/eventController.ts
     |   res.status(200).json({
     |     success: true,
     |     meta: { resource: 'event', dataSource, ... },
     |     data: { ...event, registrations: [...] }   <- A3: newest purchase first
     |   })
     v
  HTTP 200  { success, meta, data }
     |
     v
  ApiService.send<EventDetail>('GET', '/events/2')
     |   - a 204 with no body                -> { data: null, meta: {} }
     |   - a 200 carrying success: false     -> raised as an ApiError (a contract violation must not be hidden)
     |   - otherwise                         -> { data: body.data, meta: body.meta ?? {} }
     |   - catchError(...) normalises EVERY failure to ApiError:
     |        TimeoutError            -> ApiError (timedOut: true)
     |        status 0                -> "The API could not be reached."
     |        ApiErrorBody            -> ApiError.fromEnvelope(...), details preserved
     |        anything else           -> a generic ApiError
     v
  Observable<EventDetail>
     |
     | the component either subscribes, or uses toSignal() to read it in the template
     v
  EventDetailPage's template  ->  the rendered page
```

### 5.3 Why there is exactly one unwrapping point

The API answers with the same envelope on every endpoint:
`{ success, meta, data }`, and with `{ success: false, error }` on failure. Both
of those facts are known in **exactly one place** in the frontend -
`ApiService.send()` - and nowhere else:

* components never see an envelope, they see the payload (or a `Paged<T>` when
  the paging `meta` matters, as on the search page);
* components never see a raw `HttpErrorResponse` either, they see an `ApiError`,
  so there is one error type to catch and one thing to render.

`shared/src/models/api.model.ts` is the interface version of that contract
(`ApiEnvelope<T>`, `ApiMeta`, `ApiErrorBody`, `Paged<T>`), which means a change
to the response shape is a compile error at the boundary rather than an
`undefined` in a template.

### 5.4 A worked example: the delete rule, end to end

The A3 data-integrity rule is the best illustration, because it crosses every
layer and both sites:

| Layer | What happens |
| --- | --- |
| Admin event list (`adminside`) | The Delete button calls `ApiService.deleteEvent(id)` |
| `ApiService` | `DELETE /events/:id`, 10 s timeout, failures normalised |
| Express route | `routes/apiRoutes.ts` -> `controllers/adminController.ts` |
| Service | `eventWriteService.deleteEvent()` decides the HTTP outcome |
| Repository | `repository.mysql.ts` runs the check and the delete inside ONE transaction: `SELECT … FOR UPDATE`, `SELECT COUNT(*)`, then `DELETE` |
| MySQL | `event_registrations.event_id` is `ON DELETE RESTRICT`, so even a bypassed check is refused by the schema |
| Back up | `409 Conflict` + `details.suggestion = "suspend-instead"` |
| `ApiService` | The 409 arrives as `ApiError.fromEnvelope(...)`, so `error.isConflict` is true and `error.conflictDetails` carries the event name and count |
| `adminside` | The list shows the API's own message, naming the event and the registration count, and offers "suspend instead" |

`HttpError.conflict()` exists for exactly this case, and 409 is chosen over 400
deliberately: the request is perfectly well formed and the event exists, but
the current state of the data means it cannot be carried out. 400 would blame
the client for a malformed request, which this is not.

---

## 6. Signal-based i18n

The interface is offered in four languages: **English (`en`), Chinese (`zh`),
Vietnamese (`vi`) and Japanese (`ja`)**. The public site has **290** keys, the
admin site **249** (the counts at the time of writing - `npm run
check:translations` prints the current figures), and the four languages of each
dictionary define exactly the same key set.

### The design

```
  shared/src/i18n/languages.ts            LANGUAGE_CODES, SUPPORTED_LANGUAGES, DEFAULT_LANGUAGE
  shared/src/i18n/client-translations.ts  CLIENT_DICTIONARIES: 290 keys x 4 languages
  shared/src/i18n/admin-translations.ts   ADMIN_DICTIONARIES:  249 keys x 4 languages
  shared/src/i18n/language.model.ts       LanguageInfo, Dictionary, Dictionaries
  shared/src/i18n/translation.service.ts  TranslationService + the APP_DICTIONARIES token
  shared/src/i18n/translate.pipe.ts       {{ 'nav.home' | t }}
```

`TranslationService` holds the active language in a **signal**:

```ts
private readonly current = signal<LanguageCode>(this.detectInitialLanguage());

readonly language = this.current.asReadonly();
readonly languageInfo = computed(
  () => SUPPORTED_LANGUAGES.find((entry) => entry.code === this.current()) ?? SUPPORTED_LANGUAGES[0]
);

readonly t = (key: string, values?: TranslationValues): string =>
  this.translate(this.current(), key, values);
```

That is the whole re-render mechanism. Reading `this.current()` inside `t()`
registers the active language as a dependency of whatever template called it, so
when the language changes the signal notifies every view that read a translation
and Angular re-renders exactly those. There is **no manual DOM pass** - the
vanilla implementation had to walk the document looking for `data-i18n`
attributes - and **no subscription to manage**, so nothing can leak.

The pipe is deliberately **impure**:

```ts
@Pipe({ name: 't', pure: false })
```

A pure pipe is only re-evaluated when its *inputs* change, and the input here is
the key, which does not change when the visitor switches language. An impure
pipe is re-run whenever the view is checked - and because `t()` reads the signal,
the view is checked exactly when the language changes. Both forms are used in the
project (`{{ 'key' | t }}` in templates, `i18n.t('key')` in components for
attribute values and computed labels), and both are reactive.

### The four rules the service implements

Carried over from the vanilla `js/i18n.js` unchanged, because they were already
marked and they work:

1. **The stored choice wins.** `APP_CONFIG.storageKeys.language` is
   `'charity-events:language'` - **one key shared by both websites**, so choosing
   Chinese on the public site means the admin site opens in Chinese too. The two
   sites are separate applications on separate ports with separate
   `localStorage` in development, but they are the same origin in production;
   the shared key is what makes the choice follow a visitor in either case.
2. **`?lang=` beats the browser.** `?lang=ja` opens in Japanese, which is how a
   demonstration can link directly to a language.
3. **The browser's preference is used when it names one of the four**, matched on
   the base tag (`zh-CN` -> `zh`) so real browser tags are understood.
4. **A missing key falls back to English and warns in the console.** It never
   renders a blank label - a blank space in a translated interface is very hard
   to notice and very easy to ship.

An `effect` keeps `<html lang>` honest (`en-AU`, `zh-CN`, `vi-VN`, `ja-JP`),
which screen readers, the browser's own hyphenation and any `:lang()` CSS rule
all depend on.

### Why the dictionaries are generated TypeScript

The four-language text migrated out of the vanilla site **byte for byte** using
`tools/generate-i18n-data.mjs`, which reads the archived dictionaries at
`legacy/clientside/js/translations.js` and
`legacy/clientside/admin/js/admin-i18n.js` and writes the TypeScript modules. Roughly
130 KB of Chinese, Vietnamese and Japanese text could not be retyped or
reformatted by hand without silently corrupting something; the generator makes
that failure mode impossible, and `npm run generate:i18n:check` fails if the
output ever stops matching the archived source.

After the migration the generated files are the **source of truth** - the keys
are edited there, not regenerated - so the generator is a documented one-off
migration tool rather than part of the build.

### How the dictionaries are kept honest

`tools/check-translations.mjs` (`npm run check:translations`) parses the
TypeScript dictionaries and enforces six things:

1. all four languages are present;
2. every language defines the same keys (a missing key silently falls back to
   English, which is invisible until a marker switches language);
3. every key the source actually asks for exists - it collects `i18n.t('…')`
   calls and `'…' | t` pipes from `.ts` and `.html` files. A typo such as
   `t('nav.hom')` would otherwise render the literal string `nav.hom` on the
   page, which is easy to introduce during a migration and impossible to spot by
   reading 300 keys;
4. **no English word is left inside a value.** Checks 1 to 3 are statements
   about keys, and the literal check below is a statement about templates, so a
   value such as `"home.statUpcoming": "已发布的 upcoming 活动"` satisfied all of
   them: the key exists in all four languages, the template asks for it
   honestly, and the text is in the dictionary where it belongs - and the
   Chinese page showed an English word in the middle of a Chinese sentence. This
   check reads the VALUES. Chinese and Japanese never spell a word in Latin
   letters, so any Latin word in one of their values is reported; Vietnamese
   *is* written in Latin letters, so a Latin word there is reported only when
   the English dictionaries themselves use it. The words that legitimately stay
   in Latin letters - an acronym (`API`, `ID`), a currency code (`AUD`), a sort
   example (`A-Z`), the course code in the footer, a brand and its domain, a
   place name, and the Vietnamese loanwords - are allow-listed BY NAME with a
   reason, in the style of the template exemption list, and an entry that stops
   matching fails so the list cannot rot. Its own limits (a word that exists in
   both languages, a transliteration, a name the project decides to keep) are
   written down in that file rather than left implied;
5. **no user-facing word is written into a template at all, and no dictionary key
   is offered as the fallback for a value that can win.** The first half: checks
   1 to 3 are
   statements about KEYS, and a template that asks for no key satisfies every one
   of them while staying English in all four languages. The scan lives in
   `tools/check-template-literals.mjs`, which is run by this command; it reads
   the visible text and the user-facing attributes (`aria-label`, `title`, `alt`,
   `placeholder`, and a button's `value`) of every `.html` file in both
   applications, and fails on anything not on its short, hand-written list of
   intentional literals (an email address, an organisation's name, `km/h`, and
   the two app shells' pre-boot text). The second half is the rule that reads the
   reported defect back: an interpolation or binding that offers a dictionary key
   as the alternative to a value that can win -
   `{{ organization()?.mission || ('about.mission' | t) }}` - fails, because the
   translated sentence is then only the failure path and the API's English
   content takes the screen. Rendering a content field on its OWN is not
   reported; only letting it beat a key. Its own limits - a key that looks like
   English, a proper noun, a literal built inside an interpolation, and a
   dictionary key that wins for a reason (which has its own allow-list, empty
   today) - are written down in that file rather than left implied;
6. **no user-facing word is written into TypeScript either.** This is the gap
   that let one defect through two earlier sweeps, so it is worth stating
   exactly: a sentence written into a component, a service or a route definition
   is in no template and in no dictionary, which means checks 1 to 5 all pass
   while the page renders English in every language. `tools/check-ts-literals.mjs`
   (run by the same command) reads every `.ts` file under `clientside/src`,
   `adminside/src` and `shared/src` for two shapes - a quoted or template literal
   containing two or more words separated by a space (the shape a sentence
   takes), and any literal handed to a place a person reads from
   (`textContent`, `innerHTML`, `document.title`, `alert`, an `aria-label` set
   with `setAttribute`) - and fails on anything not on its own allow-list. That
   list is a decision record by name with a reason too: CSS class strings
   computed from an event state, the two CSS selectors built in code, the
   developer diagnostics behind `ApiError.friendlyMessage()`, the console
   warnings, the pre-paint theme script and its media query, and a language's
   name in its own language. An entry that stops matching fails. Its limits are
   stated in the file: a string built at runtime, a sentence assembled from
   interpolated fragments, a value that is legitimately English, a one-word
   literal handed to a helper the file does not know, and text the API serves as
   content rather than as site copy.

It also checks the cross-cutting property directly: that
`translation.service.ts` still reads `APP_CONFIG.storageKeys.language`, so the
language choice cannot stop being shared between the two sites by accident.

---

## 7. Zoneless change detection

**Angular 22 is zoneless by default, and this project does not opt back in.**
There is no `zone.js` dependency in `package.json`, `"polyfills": []` in
`angular.json`, and no `provideZoneChangeDetection` anywhere.

### What zone.js was, and what it cost

Historically Angular relied on `zone.js`, which patches every asynchronous
browser API (`setTimeout`, `addEventListener`, `Promise`, XHR, …) so the
framework is told when "something might have happened" and can re-check every
component's bindings. It works, but:

* it is a dependency that must be loaded and patched before the application
  starts, and it patches globals - a real cost in bundle size and in
  debuggability (`Zone` frames in every stack trace);
* it is imprecise: a `setTimeout` inside an unrelated library triggers a full
  application-wide check;
* third-party code that escapes the zone silently stops updating the view, which
  is a famously confusing failure.

### What replaces it

With zone.js gone, change detection is driven by **signals** (and by the
router). A component that reads a signal in its template is re-rendered when
that signal changes, and nothing else is re-checked. In this project that means:

* `TranslationService.language` is a signal - switching language re-renders
  exactly the views that read a translation.
* `ThemeService.preference` and `resolved` are signals, so the theme control
  updates itself.
* `ApiStatusComponent.state` is a signal, so the footer's health indicator
  repaints when `GET /api/health` answers.
* Route data that is not a signal is projected into one with `toSignal` - see
  `clientside/src/app/app.ts`, where the router's `NavigationEnd` events become
  a signal the shell computes from:

```ts
private readonly url = toSignal(
  this.router.events.pipe(
    filter((event): event is NavigationEnd => event instanceof NavigationEnd),
    map((event) => event.urlAfterRedirects)
  ),
  { initialValue: '' }
);
protected readonly showSiteChrome = computed(() => !this.isNotFoundUrl(this.url()));
```

That is also why the header hides its menu on the 404 route: the decision is a
`computed` over a signal, so it is recomputed on navigation without any manual
listener. Without `toSignal`, a zoneless application would simply never notice
the navigation.

### The consequences, stated plainly

* **Every piece of state that drives the view must be a signal, or reach the
  template through a signal.** This is a real constraint and the most likely
  source of a "the page did not update" bug for anyone new to it. The code
  comments call it out wherever it matters.
* **The early-theme script is still needed.** Zoneless has nothing to do with
  the white flash: the theme must be applied before Angular bootstraps at all,
  which is why `EARLY_THEME_SNIPPET` remains an inline `<head>` script in both
  `index.html` files (`clientside/src/index.html`, `adminside/src/index.html`).
* **One fewer dependency.** Nothing is patched before startup, the bundle is
  smaller, and stack traces are ordinary ones.

`npm run check:angular` fails if a `zone.js` dependency, a `zone.js` polyfill
entry or a `provideZoneChangeDetection` call ever reappears.

---

## 8. The weather integration and its graceful degradation

Assessment 3 asks for one external API. The brief names
**`api.open-meteo.com`**, and it is a genuinely good fit: it needs no API key and
no registration, so nothing secret has to be committed or shipped to a marker.

### What is shown

For an event with coordinates and a date inside the forecast window, the event
page shows the daily forecast **for the event's own date, at the venue's own
coordinates**: maximum and minimum temperature, the chance of rain, the maximum
wind, a glyph and a description. When the code means rain, a "bring a coat" hint
appears next to it.

The panel itself is on **every** event page, including the events that cannot
have a forecast. It used to be wrapped in `@if (weatherPossible())`, which with
the seeded data was true for exactly one event - the earliest one, and the only
one inside Open-Meteo's window - so the other nine pages showed no weather module
and no explanation, and a visitor could not tell "too far ahead" from "broken".
The heading is now unconditional and the four reasons are named in the visitor's
language (`weather.reasonPast`, `weather.reasonNoCoordinates`,
`weather.reasonNoDate`, `weather.reasonBeyondHorizon`), with the loading line and
the "we asked and got nothing" note rounding out the states. None of them is an
error: no `role="alert"`, no error styling, and `aria-live="polite"` so the
answer replaces the loading line without interrupting the reader.

### Where the request is made

| Step | Where |
| --- | --- |
| The event's `latitude` / `longitude` | `locations.latitude` / `longitude` in MySQL, returned by the event endpoints, typed in `shared/src/models/event.model.ts` |
| "Can a forecast be shown at all?" | `WeatherService.canShowForecast(target)`, which is now the yes/no form of the reason below |
| "Why not, exactly?" | `WeatherService.forecastUnavailableReason(target)` - `noCoordinates`, `noDate`, `past` or `beyondHorizon`, a typed union so the reason can never become an English sentence inside the shared library |
| The request | `WeatherService.forecastFor(target)` in `shared/src/weather/weather.service.ts` |
| URL, timezone, window | `APP_CONFIG.weatherApiUrl`, `weatherTimezone` (`Australia/Sydney`), `weatherForecastDays` (16) in `shared/src/config/app-config.ts` |
| WMO code -> text | `weatherCodeKey()` and the `WMO_KEYS` table in `shared/src/weather/weather.model.ts` |
| WMO code -> glyph | `weatherGlyph()` |
| "Is this wet weather?" | `isWetWeather()` |

The call is made **from the browser**, not proxied through the Express API.
There is no credential to protect and the free endpoint allows browser calls, so
a proxy would add a hop, a cache-invalidation problem and a second place for the
request to fail - for no benefit.

### Graceful degradation, in detail

This is the part that matters, and it is why `forecastFor()` returns
`Observable<WeatherForecast | null>` and **resolves `null` rather than
rejecting**:

```ts
forecastFor(target: WeatherTarget | null | undefined): Observable<WeatherForecast | null> {
  if (!target || !this.canShowForecast(target)) return of(null);

  return this.http.get<OpenMeteoResponse>(APP_CONFIG.weatherApiUrl, { params }).pipe(
    timeout({ each: APP_CONFIG.requestTimeoutMs }),
    map((body) => this.toForecast(body, date, latitude, longitude, target)),
    catchError(() => of(null))     // network failure, timeout, bad status, non-JSON: no forecast
  );
}
```

Every failure path collapses to the same quiet outcome - a `null` the page never
turns into an error:

| Situation | What happens |
| --- | --- |
| The venue has no coordinates (the "Online (Australia-wide)" pseudo-venue) | `canShowForecast()` is false, so **no request is made at all**; the panel says the venue has no map coordinates |
| The event is more than 16 days away | No request; Open-Meteo's daily forecast is not reliable that far out, so the panel says how far ahead the event is |
| The event is in the past | No request. Telling a visitor what the weather was is not useful; the panel says the event has finished |
| The event has no readable date | No request; the panel says the date is not confirmed yet |
| The machine has no internet | `catchError` -> `null`; the panel says no forecast is available, with no error styling and no console error the visitor must read |
| Open-Meteo is slow (> 10 s) | The `timeout` fires -> `catchError` -> `null`, same note |
| Open-Meteo answers with an unexpected status or non-JSON | `catchError` -> `null`, same note |
| The requested day is missing from a shortened response | `toForecast()` looks the day up by date and returns `null` if it is absent |

The event page therefore renders unconditionally and says **which** of those
cases applies. **A bonus feature must never be able to break the page it
decorates** - the registration list, the ticket tiers and the progress bar do not
depend on Open-Meteo being reachable, which is what makes the assessment
demonstrable on a machine with no internet.

The reason is checked **before** the request, so an ordinary past event costs
nothing:

```ts
forecastUnavailableReason(target: WeatherTarget | null | undefined): ForecastUnavailableReason | null {
  if (!target) return 'noDate';
  if (!Number.isFinite(target.latitude) || !Number.isFinite(target.longitude)) {
    return 'noCoordinates';
  }

  const offset = daysUntil(target.eventDate ?? target.dateStart);
  if (offset === null) return 'noDate';
  if (offset < 0) return 'past';
  if (offset > APP_CONFIG.weatherForecastDays) return 'beyondHorizon';
  return null;
}
```

### Mapping the codes

Open-Meteo returns a numeric **WMO 4677** `weather_code` rather than a
description, so the numbers have to be mapped to text. The brief prints the
grouping it expects (`0`; `1,2,3`; `45,48`; `51,53,55`; `61,63,65`; `80,81,82`;
`95`) and that grouping is followed exactly, with the few extra codes
Open-Meteo can return (`71,73,75` snow, `96,99` thunderstorm with hail) added so
that **no code is ever left unlabelled**. `weatherCodeKey()` falls back to
`weather.code3` ("overcast") for anything unknown, and every key it can produce
exists in **both** dictionaries - `npm run check:translations` compares them, so
a missing label is a test failure rather than a blank panel.

The glyph is a plain Unicode character rather than an image: nothing extra to
download and nothing that can break when an asset path changes.

`WeatherTarget` is deliberately a *structural* minimum (`latitude`, `longitude`,
a date, a venue name), not `Event`. A full `Event` satisfies it, and so does the
draft an administrator is still filling in on the admin "new event" form - which
is what lets the admin side preview the venue's weather **before the event exists
in the database**.

---

## 9. The TypeScript API build, and why cPanel needs it

### The shape of the build

```
api/
├─ server.ts                  <- entry point, source of truth
├─ src/**/*.ts                <- the application
├─ tsconfig.json              <- rootDir "." / outDir "dist"
├─ package.json               <- "main": "dist/server.js",  "build": "tsc -p tsconfig.json && node scripts/copy-views.mjs"
├─ scripts/copy-views.mjs     <- tsc does not copy static assets
└─ dist/                      <- BUILD OUTPUT: what actually runs
   ├─ server.js
   └─ src/**/*.js             <- layout MIRRORS the source tree
```

`api/tsconfig.json` sets `rootDir: "."` and `outDir: "dist"` for one specific
reason: it makes the output **mirror** the input layout.

```
api/server.ts              ->  api/dist/server.js
api/src/db/event_db.ts     ->  api/dist/src/db/event_db.js
api/src/routes/apiRoutes.ts -> api/dist/src/routes/apiRoutes.js
```

That mirroring is not cosmetic. Two things depend on it:

* the test suite and the deployment both run **`api/dist/server.js`**, so the
  relative `require('./src/…')` paths the compiled code emits must resolve
  inside `dist/` exactly as they did in the source tree;
* `api/package.json` declares `"main": "dist/server.js"`, so the entry point is
  discoverable by tooling rather than by convention.

### Why compilation is not optional on the SCU cPanel

The cPanel runs a Node.js version that **cannot execute TypeScript directly**.
There is no `ts-node`/`tsx` loader available to the Passenger application, and
relying on one would mean shipping a development dependency into the deployment.
So the compiled JavaScript is what runs, in **both** environments:

| Where | What runs |
| --- | --- |
| Local development (`npm start`, `npm run start:api`) | `api/dist/server.js`, compiled first by `npm run build:api` |
| Local tests (`npm test`, `npm run test:e2e`) | `api/dist/server.js` |
| SCU cPanel (Passenger) | the uploaded `api/dist/server.js` plus `api/package.json` |

`tools/start-all.mjs` therefore always compiles the API before serving - it is
fast, and serving a stale `api/dist` is a confusing failure to debug. The API
upload is the compiled output, not the sources.

### Two migration problems that the compiled layout created, and their fixes

**1. Finding `api/.env` from `api/dist/src/config/`.** `api/src/config/env.ts`
originally computed the API root as `path.resolve(__dirname, '..', '..')`, which
is correct only while the source runs in place. After compilation it resolves to
`api/dist`, so `api/.env` would never be found: `DATA_SOURCE` would fall back to
`mysql`, every `DB_*` value would fall back to its default, and the deployment
would look like a **database** problem when it was a **path** problem. The fix is
`findApiRoot()`, which walks **up** from the compiled file's directory until it
finds the folder holding `package.json` - `api/` locally, the application root on
the cPanel. It is correct for all three ways the code can start: the package
start script (which runs the compiled entry point), `node dist/server.js` from
inside the API folder, and Passenger.

**2. The landing page is a `.html` file, and `tsc` does not copy it.** The page
is resolved from the API **root** (`src/views/api-index.html`), not from
`__dirname`, so `api/dist/src/views/` is not what makes it work locally. The
build's `api/scripts/copy-views.mjs` step copies it into `dist/src/views/`
anyway, which covers a deployment that ships `api/dist` on its own without the
sources beside it. The resolution tries both candidates and falls back to a JSON
message if neither exists, so opening `http://localhost:3000/` is never a
mystery.

### What stayed exactly the same

The migration changed how the API is **written**, not what it **answers**:

* the same routes, with the same fixed sub-paths declared before `:id`;
* the same `{ success, meta, data }` success envelope and the same
  `{ success: false, error }` failure envelope;
* the same status codes (`200`, `201` + `Location`, `204`, `400` with a
  per-field `details` array, `404`, `409`, `429`, `500`, `503` for `/api/health`);
* the same C.R.U.D. cycle for events, the same registration endpoints, and the
  same data-integrity rule that an event with registrations cannot be deleted
  (409);
* the same two data sources (`mysql` and the offline `local` twin), with the
  same behaviour from both.

Two deliberate typing concessions are documented in the API itself.
`api/src/types.ts` draws the line explicitly: above the repository
(services, controllers, middleware, config) the shapes are fully typed
(`EventFilters`, `Paging`, `ValidationIssue`, `Repository`), while a row
travelling *between* the repository and the service is a `DataRecord` - because
its authority is the JSON the API returns, which the test suite already asserts
field by field, and pinning it to a hand-written interface would only duplicate
the database schema and let the two drift apart. `api/src/db/event_db.ts` makes
the same trade in one place: the pool and the `transaction()` callback are fully
typed, while `query()` is deliberately loose because a statement's result is the
union mysql2 itself publishes. `strict` is on; the two concessions are named
rather than silent, and both are confined to the data layer.

### The Passenger guard

`api/server.ts` keeps the guard that the first cPanel deployment proved was
necessary. Passenger does not *execute* the startup file - it `require()`s it and
expects the application to listen on the port it assigned. Under Passenger
`require.main === module` is **false**, so a plain guard would never call
`start()`, the application would never listen, and the browser would get
Passenger's generic `500 - Web application could not be started`. The file
therefore also tests for `PASSENGER_BASE_URI`, which Passenger sets:

```ts
const IS_PASSENGER = Boolean(process.env.PASSENGER_BASE_URI);
if (require.main === module || IS_PASSENGER) { start().catch(/* … */); }
```

It also strips the `PASSENGER_BASE_URI` mount prefix from incoming URLs, because
Passenger passes the **full** path through rather than removing the mount point.
Without that, a request for `/charity-events-api/api/health` reaches routes
mounted at `/api`, matches nothing, and **every endpoint answers 404 while the
application looks perfectly healthy**. Both fixes are documented in
`docs/deployment-cpanel.md`.

---

## 10. Testing strategy

Four layers, each answering a question the others cannot.

| Layer | Command | What only it can prove |
| --- | --- | --- |
| API + archived-frontend suite | `npm test` (`tests/run-tests.js`) | The HTTP contract, endpoint by endpoint, and the rendered DOM of the *archived* frontend |
| Browser end-to-end | `npm run test:e2e` (`tests/angular-e2e.mjs`) | That the Angular applications actually bootstrap, route, call the API and paint the result |
| Angular unit tests | `npm run test:ng` (`ng test clientside && ng test adminside`) | Components, services and pipes in isolation, through Angular's own test builder |
| Architecture + consistency checks | `npm run check:angular`, `check:translations`, `check:shared`, `check:refs`, `check:secrets`, `check:contrast` | That the required architecture and the data are still internally consistent |

### `tests/run-tests.js` - the API half

The suite starts its **own** API instance on its own free port with a temporary
offline data source, so it never disturbs a running server and needs no MySQL.
Part A asserts every A2 read endpoint, filter, validation rule and error
response. Part C asserts the A3 write endpoints: registration, the full C.R.U.D.
cycle, the admin view, and the delete rule **from both sides** - an event with
registrations is refused with a 409, then the registrations are removed and the
same event is deleted successfully. Checking it from both sides is what proves
the block is caused by the registrations rather than by something else.
`npm run test:mysql` runs the identical checks against real MySQL, which is how
the MySQL and offline repositories are shown to behave the same.

### `tests/run-tests.js` - the archived-frontend half, and the honest trade-off

Parts B and D load the **archived vanilla frontend** from `legacy/clientside/`
into jsdom, with `fetch` redirected to the test API, and assert on the rendered
result: event cards, the progress bar, ticket prices, the filter checkboxes,
Clear Filters, the registrations table, the registration form and its
confirmation card, and the admin event list.

This is a deliberate decision, and it is worth being straight about it:

* **Why keep it.** It is a fast, dependency-free regression test of the API
  contract, and it is the reference that proves the Angular pages show the same
  strings and states as the pages they replace. Deleting `legacy/` would delete
  that coverage.
* **Why not rewrite it against the Angular build.** `tests/angular-e2e.mjs`
  already covers the Angular side properly - in a real browser, against the real
  compiled API - and a jsdom version of an Angular application would test less
  and cost more to maintain. Duplicating the browser suite for the sake of
  consistency would be worse engineering than the duplication it removes.
* **What it does not cover.** jsdom is not a browser and cannot run the Angular
  build's rendering with its real change detection. That gap is exactly what the
  end-to-end suite exists to cover, and the two suites are documented as
  complementary rather than as one being the successor of the other.

### `tests/angular-e2e.mjs` - the browser suite

It starts the API and two static servers, launches headless Edge (or Chrome)
through `puppeteer-core`, and asserts on **what a person would actually see**:

* both applications boot and the "Loading the charity events website…"
  placeholder is gone;
* the router resolves every required route, including deep links;
* the page content really comes from the API - the script fetches the same data
  directly from the API and compares;
* the Assessment 3 registration list appears on the event detail page;
* the Open-Meteo forecast renders when one is available - and when Open-Meteo is
  unreachable, the assertion becomes "the page must degrade quietly, with no
  uncaught error" instead of being skipped;
* the language switcher and the theme switch change the document
  (`<html lang="zh-CN">`, `<html data-theme="dark">`);
* the admin side lists every event (including a non-active one) and every
  registration;
* the API's write contract behaves as both applications expect: `POST` 201,
  `PUT` 200, `DELETE` 204, and `DELETE` 409 when registrations exist.

It needs `npm run build:local` first, because it serves the built applications -
which is the point: it tests the artefact, not the dev server.

**It now passes in full: 40 checks.** The run starts the API and both static
servers itself and then asserts what a person would see - the organisation and
event cards, the filter form built from `/api/locations`, a real search
submission, the registrations table, the Open-Meteo panel with a real
temperature, the language switcher, the dark theme, the admin dashboard, the
admin event list including a suspended event, the admin registration list, and
the API write contract including the 409 refusal.

Two integration gaps were found by this suite while verifying, and both were real:

1. **CORS.** The applications are served from `127.0.0.1:4200` / `:4300`, and the
   API's `CORS_ORIGIN` listed only the archived vanilla port (5500), so the
   browser refused every `fetch` and the home page correctly rendered its "the
   events server is offline" state - the component behaving properly on top of a
   misconfiguration. The deployed origin was also written as
   `https://24832481.it.scu.edu.au/charity-events`, which can never match, because
   a browser `Origin` header never contains a path. Both are fixed in `api/.env`
   and `api/.env.example`.
2. **The interface language.** The applications honour the browser's own language
   preference, so on a machine reporting `zh-CN` the suite's English text
   assertions failed for a reason that was not a bug. The suite now stores
   `charity-events:language = 'en'` before any application code runs and asserts
   the language feature separately.

### The architecture checks as tests

`tools/check-angular-architecture.mjs` (`npm run check:angular`) replaced the
Assessment 2 guard script, which asserted the **opposite** rule
("no framework"). Keeping the old checker would now fail the build for the right
reason and the wrong outcome.

It deliberately tests **properties that would have to change for the requirement
to break**, rather than searching the source for the word "Angular", which would
prove nothing:

| Check | The property it protects |
| --- | --- |
| `@angular/core` is v22 or later | The version requirement |
| Both applications are configured in `angular.json` | Two separate deliverables |
| No `@NgModule` in any frontend source | Standalone components only |
| No `zone.js` dependency, polyfill entry or `provideZoneChangeDetection` | The zoneless decision |
| No component with an inline template | The brief's HTML requirement |
| Every `templateUrl` points at a file that exists | A renamed template is caught at check time |
| Every component has a doc block above its decorator | Comments are graded |
| Neither application imports the other | The two sites stay genuinely separate |
| Both applications import `@charity/shared` | The sharing is real, not a claim |
| Each app provides its own dictionary **and** `API_BASE_URL` | The DI-token pattern is intact |
| No page loads a script from a CDN | A self-contained bundle |
| Both `index.html` files carry the early-theme script | No white flash for a dark-mode visitor |
| The API source is TypeScript, with no `.js` left in `api/src` | The backend migration cannot half-revert |
| `api/tsconfig.json` has `outDir: dist` and `api/package.json` `main` is `dist/server.js` | The API compiles and runs from `dist/` |

`tools/check-translations.mjs` is the equivalent guard for the data: four
dictionaries, identical key sets, every requested key present, and the shared
language storage key intact.

`tools/audit-references.mjs` (`npm run check:refs`) closes the loop on
documentation: a command in the README that points at a script that no longer
exists is worse than no command at all, so every `tools/…`, `api/…`,
`clientside/…`, `database/…` and `docs/…` path in the markdown is required to
resolve, along with every npm script's target file.

#### Two bugs the architecture checker itself had

A checker that is wrong in either direction is worse than no checker, so both are
recorded - they were found while verifying, and both were fixed in
`tools/check-angular-architecture.mjs` rather than in the architecture it checks:

1. **The zoneless check matched comments.** It searched each frontend `.ts` file
   for the text `provideZoneChangeDetection`, without stripping comments first, so
   the explanatory comment in each `app.config.ts` - which says there is *no* such
   call - was reported as a violation. It now runs the search over the file with
   comment-only lines removed. The property itself always held: `package.json` has
   no `zone.js` dependency, `polyfills` is `[]` in `angular.json`, and neither
   application calls `provideZoneChangeDetection`.
2. **The TypeScript-backend check crashed on a commented JSON file.**
   `api/tsconfig.json` carries an explanatory comment, which TypeScript allows,
   and the checker read it with `JSON.parse`, so it stopped with a `SyntaxError`
   when it reached that check. It now strips JSONC comments and trailing commas
   before parsing.

This is the argument for running a guard rather than trusting it: the two bugs
were invisible until the checks were executed, and one of them (`SyntaxError`)
silently hid every check after it. The guard now reports **16 checks passing**.

The lesson is general enough to be worth stating: a check that fails loudly is
useful, a check that crashes and takes the rest of the output with it is actively
misleading, and a check that greps for a word inside prose will eventually find it
in a comment explaining why that word is not used.

---

## 11. What was rejected, and why

Recording the alternatives is the part of the work that shows the decision was
made rather than inherited.

| Alternative | Why it was rejected |
| --- | --- |
| **Keep the vanilla frontend and add Angular for one page.** | The brief requires Angular v22 for the frontends, not for a page. Half-migrating would leave two idioms, two i18n mechanisms and two theme mechanisms in one submission - strictly more to explain and to break |
| **Wrap the vanilla site in a Web Component / iframe.** | Technically "Angular is present", but nothing would be written in TypeScript, the routing, DI, signals and templates would all be unused, and a marker would see through it immediately |
| **`ng-packagr` library for `shared/`.** | Adds a build product, a publish cycle and a stale-library failure mode for exactly two consumers in one repository. The bundle is identical with a path alias; the one real loss (no independent type-check) is covered by `npm run check:shared` |
| **A library *per concern*** (api, i18n, theme as three libraries). | Three build steps and three public-API surfaces for code that is always used together and never versioned independently |
| **`zone.js` retained.** | Contradicts the Angular 22 default, costs bundle size, patches globals, and triggers application-wide checks from unrelated asynchronous work. Signals give precise updates instead |
| **`NgModule`s instead of standalone components.** | Standalone is the Angular 22 default and the simpler model for an application this size; an `NgModule` per feature would be boilerplate with no benefit here |
| **Component-relative inline templates.** | The brief asks for **HTML**; a component whose markup lives in TypeScript hides that. Every component uses `templateUrl` with a real `.html` file, and the architecture checker enforces it |
| **One application with an admin section behind a route guard.** | The brief asks for two separate websites. Two applications are also the honest model: different audiences, different data (status-filtered vs. unfiltered), different base hrefs and separate submission archives |
| **Copying the shared code into both applications.** | Two copies of the API layer, the models, the i18n service and the theme service would drift on the first change. Sharing is also a stated requirement, so `check:angular` verifies it |
| **Proxying Open-Meteo through Express.** | There is no API key to hide, so the proxy would only add a hop, a cache-invalidation problem and a second failure point on the critical path of the event page |
| **Caching the forecast in the database.** | A forecast is only valid for its own day; storing it would need an expiry policy and a refresh job to avoid showing yesterday's weather as today's |
| **Making the forecast a hard dependency of the event page.** | It is a bonus feature. `forecastFor()` returns `null` instead of rejecting so the page renders whether or not Open-Meteo answers - see [section 8](#8-the-weather-integration-and-its-graceful-degradation) |
| **Running the API from TypeScript via `ts-node`/`tsx`.** | The cPanel cannot execute TypeScript and a loader would mean shipping a development dependency into the deployment. Compiling to `api/dist` is the portability that works everywhere |
| **Deleting `legacy/`.** | It is the behavioural reference for the Angular pages and the DOM regression suite `tests/run-tests.js` still runs against it. See [section 10](#10-testing-strategy) |
| **Translating the event data as well as the interface.** | It would need translated columns or a translation table - a content management feature well beyond the assessment. The interface is translated (290 client keys + 249 admin keys); event names, descriptions and venues come from the database in English, and the header says so while another language is active |
| **`?lang=` only, with no stored preference.** | A choice that does not survive a reload is not a settings control. The stored key is shared between the two sites on purpose, so the choice follows the visitor |
| **A theme applied only after Angular bootstraps.** | Produces a white flash for a dark-mode visitor, which is exactly the defect `EARLY_THEME_SNIPPET` and the two inline `<head>` scripts exist to prevent |

---

## 12. The four segments: Header, Nav, Body and Footer

Assessment 2 marker feedback asked for the webpages to be broken into **Header, Nav,
Body and Footer**, with the common segments - Header, Nav and Footer - "created once
and common across all your pages". The vanilla site had four documents and wrote the
same header and footer into each of them from `js/nav.js`; in this project the four
segments are the structure of the **application shell**, and the common three are
rendered once, by `app.html`.

### Where each segment is defined

| Segment | Landmark in the rendered page | Defined in | How often |
| --- | --- | --- | --- |
| Header | `<header class="site-header">` / `<header class="admin-header">` | `clientside/src/app/layout/site-header/`, `adminside/src/app/layout/admin-header/` | once, in the shell |
| Nav | `<nav class="site-nav">` / `<nav class="admin-nav">` | `clientside/src/app/layout/site-nav/`, `adminside/src/app/layout/admin-nav/` | once, in the shell |
| Body | `<main id="main">` with `<router-outlet />` | `clientside/src/app/app.html`, `adminside/src/app/app.html` | one outlet; each routed page is the content |
| Footer | `<footer class="site-footer">` / `<footer class="admin-footer">` | `clientside/src/app/layout/site-footer/`, `adminside/src/app/layout/admin-footer/` | once, in the shell |

The shell names the four in order with a comment on each, so the structure is visible
before any component is opened.

### Why the common three are siblings of the routed page

`Header`, `Nav` and `Footer` are rendered by `app.html` as siblings of
`<router-outlet>`, never inside a page's template. Navigating therefore replaces only
the Body, which is exactly the property the feedback asks for:

* the three common segments are never destroyed and rebuilt, so **the language and
  theme state survives a navigation** - and a page **cannot forget** the header, the
  menu or the footer (the archived admin site had to call `initAdminLayout()` from
  every page to get the same guarantee);
* it is also why **`GET /api/health` is fetched once per full page load** rather than
  once per route: the footer's live indicator is a child of the shell, so the router
  never re-creates it.

### Why Nav is rendered inside Header

The nav segment is rendered by the header component, inside its `<header>` landmark
(`app-site-header` -> `<header>` -> `app-site-nav`), so the document has the four
landmarks in the natural order `header > nav`, `main`, `footer`. It is still a
component of its own: the menu markup, its destinations and its `routerLink`
configuration exist in one file per application.

Two details make the extraction safe, and both are deliberate:

* **No CSS moved.** Every class name (`site-nav`, `site-nav__list`, `site-nav__link`,
  `site-nav--open`, `admin-nav`, `admin-nav__list`, `admin-nav__link`) is still the one
  the global `styles.css` defines, and the markup is still a direct child of the box
  that used to contain it. Nothing was restyled.
* **The new host element adds no box.** `site-nav.css` and `admin-nav.css` give the
  host `display: contents`, so the `<nav>` is laid out exactly as it was before the
  markup moved. Without it the host would be a flex item of `.site-header__nav` and
  would add a `gap` even when the menu is hidden, and the sticky `.admin-nav` would be
  resolved against a different containing block.

### How `showNav` is wired

The public site hides the menu - and only the menu - on the wildcard 404 route. The
shell passes `[showNav]="showSiteChrome()"` to the **header**, which keeps the input
because it also owns the mobile menu button, and forwards it to the **nav**, which
renders or omits the `<nav>`. `app-site-nav` additionally takes the mobile-open flag
from the header (`menuOpen`, whose state lives next to the button that toggles it) and
emits `linkActivated` so the header can close the menu after a navigation. The admin
shell is wired the same way (`[showNav]="showNav()"` from `admin-header` to
`admin-nav`, always true there because the brief requires the menu on every admin
page), so the two applications can be read side by side.

---

## Appendix: the one-page summary

```
        clientside (Angular 22)            adminside (Angular 22)
        public website, :4200              staff website, :4300
        /, /search, /events/:id,           /, /events, /events/new,
        /register/:id, **                  /events/:id/edit, /registrations, **
                 \                                   /
                  \                                 /
                   v                               v
        ┌──────────────────────────────────────────────────┐
        │  shared/  - plain TypeScript, @charity/shared/*  │
        │  api.service + api-error   (one HTTP layer)      │
        │  models/                   (one API contract)    │
        │  weather/                  (Open-Meteo + WMO)    │
        │  i18n/                     (en zh vi ja, signals)│
        │  theme/                    (light / dark / system)│
        │  util/format, di/tokens    (shared, app-agnostic)│
        └───────────────────────┬──────────────────────────┘
                                │  HTTP, {success, meta, data}
                                v
        ┌──────────────────────────────────────────────────┐
        │  api/  - TypeScript, compiled to api/dist        │
        │  routes -> controllers -> services -> repos       │
        │                                       -> db pool  │
        └───────────────────────┬──────────────────────────┘
                                │  parameterised SQL only
                                v
        ┌──────────────────────────────────────────────────┐
        │  MySQL charityevents_db                          │
        │  7 tables, 5 views, 11 events, 20 registrations   │
        └──────────────────────────────────────────────────┘

        external:  Open-Meteo daily forecast  (browser -> api.open-meteo.com,
                   no API key, resolves null on every failure)
```
