# Settings: dark theme and language

This document describes the two settings controls in the header, how they are
implemented in the shared TypeScript library, and - importantly - what they
deliberately do **not** do.

The controls are the only part of the interface that is *not* per page: they live
in the header of **both** Angular applications and are driven by two services in
`shared/`, so a choice made on one site is honoured by the other. The mechanism
changed when the vanilla frontend was replaced (see
[`angular-architecture.md`](angular-architecture.md)); the behaviour a visitor
sees did not.

---

## 1. What was added

| Control | Where | Values | Remembered |
| --- | --- | --- | --- |
| Theme switch (button) | Header, next to the menu | Light, Dark, System | `localStorage` key `charity-events:theme` |
| Language picker (`<select>`) | Header, next to the theme switch | English, 中文, Tiếng Việt, 日本語 | `localStorage` key `charity-events:language` |

On the public site both controls are one component,
`clientside/src/app/layout/settings-bar.ts`, which the site header renders on
every page. The admin header,
`adminside/src/app/layout/admin-header/admin-header.ts`, carries the same two
controls against the same two services, so the two websites cannot disagree about
how a theme or a language is chosen.

### The theme switch

A single button cycles **light → dark → system** and shows the current setting
("Theme: Dark"), so it doubles as a status indicator. Three states rather than
two because "follow my computer" is what most visitors expect by default, and it
keeps following the system if the visitor changes it while the page is open -
`ThemeService` listens to `matchMedia('(prefers-color-scheme: dark)')` and writes
the resolved value again when it fires.

The switch also carries an `aria-label` that names the **stored** preference as
well as the visible one ("Theme: Light (System = system)"), because "Light" and
"System" look identical when the operating system happens to be light.

### The language picker

A native `<select>`, chosen because it is keyboard accessible and behaves
correctly on phones without extra code. The label of each option is written in
its own language (中文, Tiếng Việt, 日本語) - taken from `nativeLabel` in
`shared/src/i18n/languages.ts` - which is the convention for language pickers: a
visitor who cannot read the current interface language can still recognise their
own.

---

## 2. Important scope limit

**Only the interface is translated. Event content is not.**

Event names, descriptions, venue names and organisation names come from the
MySQL database in English (`Riverside Rainbow Fun Run 2026`,
`Lismore City Hall`, and so on). Translating that content would need either
translated columns on every content table or a separate translations table keyed
by language - a content management feature well beyond this assessment.

Rather than leave the visitor guessing, the header shows a short note while a
language other than English is selected:

> Interface language only; event details stay in English.

(The note is itself translated - the `settings.interfaceOnly` key - and is hidden
in English.)

---

## 3. Files

| File | Responsibility |
| --- | --- |
| `shared/src/theme/theme.service.ts` | Reads and stores the theme, resolves "system", writes `<html data-theme>`; also exports `EARLY_THEME_SNIPPET`, the inline `<head>` script |
| `shared/src/i18n/translation.service.ts` | Reads and stores the language, holds it in a signal, exposes `t()` and `set()`, keeps `<html lang>` honest |
| `shared/src/i18n/languages.ts` | `LANGUAGE_CODES`, `SUPPORTED_LANGUAGES` (code, label, `nativeLabel`, `htmlLang`), `DEFAULT_LANGUAGE` |
| `shared/src/i18n/client-translations.ts` | The public site's dictionary: 306 keys in each of the four languages |
| `shared/src/i18n/admin-translations.ts` | The admin site's dictionary: 253 keys in each of the four languages |
| `shared/src/i18n/translate.pipe.ts` | The `t` pipe, so a template writes `{{ 'key' \| t }}` |
| `shared/src/config/app-config.ts` | The three `storageKeys`, including the one language key both sites share |
| `clientside/src/app/layout/settings-bar.ts` | Builds both controls for the public header |
| `adminside/src/app/layout/admin-header/admin-header.ts` | The same two controls in the admin header |
| `clientside/src/index.html`, `adminside/src/index.html` | Carry the inline early-theme script before the first paint |
| `clientside/src/styles.css`, `adminside/src/styles.css` | The `[data-theme='dark']` token overrides and the component fixes |
| `tools/check-translations.mjs` | Fails if the four languages of a dictionary differ, or if a template asks for a key that does not exist |
| `tools/check-angular-architecture.mjs` | Fails if either `index.html` loses the early-theme script, and if either app stops providing its own dictionary |
| `tools/check-contrast.mjs` | Measures the contrast of every text element on every route, in both themes |

---

## 4. How the markup is translated

There are no `data-i18n` attributes any more. The markup is HTML with Angular
bindings, and the dictionary is reached through the service or the pipe, which is
what makes a language change re-render the page with no DOM pass at all:

```html
<!-- element text: the pipe -->
<h1>{{ 'home.title' | t }}</h1>

<!-- an attribute: an explicit binding -->
<input [attr.placeholder]="'search.cityPlaceholder' | t" />
```

A component that has to build a string - a chip label, a status sentence, a
validation message - injects `TranslationService` and calls `i18n.t(key)`:

```ts
protected readonly themeLabel = computed(
  () => `${this.i18n.t('settings.theme')}: ${this.i18n.t(this.theme.labelKey())}`
);
```

Both forms read the same signal, so both are reactive; the project uses the pipe
where the template is the only reader and `t()` where a value is combined or
computed.

Placeholders use braces and are substituted without touching the DOM:

```ts
this.i18n.t('search.eventCountMany', { count: 12 })   // "12 events matched your filters."
```

Because `t()` warns in the console and falls back to English for a missing key it
never renders a blank label, which is why `tools/check-translations.mjs` collects
every `t('…')` call and every `'…' | t` pipe from the `.ts` and `.html` files and
checks that each key exists.

---

## 5. Avoiding a white flash

The stored theme can only be read once JavaScript runs. If that happened after
Angular bootstrapped and the stylesheet had been applied, a visitor who chose dark
would see a white flash on every page load. Both applications therefore carry a
tiny inline script in the `<head>` of `index.html`, **before** the stylesheet
link:

```html
<!-- theme-boot -->
<script>(function(){try{var p=localStorage.getItem('charity-events:theme')||'system'; ... })();</script>
<!-- /theme-boot -->
```

That snippet duplicates the storage key and the attribute name used by
`ThemeService`, so it is **not** written out twice by hand:
`shared/src/theme/theme.service.ts` exports it as `EARLY_THEME_SNIPPET`
immediately below the service that must agree with it, and
`npm run check:angular` fails if either `index.html` stops carrying it. (The
Assessment 2 arrangement was a generator that walked the vanilla pages and
rewrote the snippet into each one; with two Angular applications and one exported
constant, a check replaces the generator.)

---

## 6. How the dark theme is built

Every colour in the light theme is already a custom property, so the dark theme
is one block of token overrides in the shared stylesheet:

```css
[data-theme='dark'] {
  --surface-0: #16211f;
  --ink-900: #eef4f3;
  --line: #2c3a38;
  /* ... */
}
```

`ThemeService` writes `data-theme` (the resolved light or dark value) plus
`data-theme-preference` (the raw light/dark/system choice) to `<html>`, and also
sets `color-scheme`, which is what lets the browser style its own controls -
scrollbars and the native calendar picker - to match.

A handful of components were not driven by tokens alone and are fixed explicitly:
the header's translucent background, the hero gradient, the white form controls
(including inverting the calendar icon inside a date field), cards and panels, the
modal backdrop, and the event artwork, which is dimmed slightly so it does not
glare against a dark card. Both `clientside/src/styles.css` and
`adminside/src/styles.css` carry those rules.

---

## 7. Testing

### Automated

```bash
npm test                        # 116 checks: the API contract, plus the jsdom suite
npm run test:e2e                # 33 checks in a real browser, over both Angular apps
npm run check:translations      # each dictionary: four languages, identical keys, every key used
npm run check:angular           # 16 checks, including the early-theme script in both index.html files
npm run check:contrast          # WCAG AA on every route in both themes (both sites must be running)
```

Six of the `npm test` checks cover the settings, and they run against the
**archived** frontend under `legacy/clientside/` - the jsdom suite is a regression
test of the behaviour the Angular pages were written to match: the language
switcher offers four languages and applies one; a remembered language is applied
on the next page load; all four dictionaries have identical keys; the theme cycles
light → dark → system and is stored; the dark theme is a set of token overrides
plus the component fixes; and every page applies the theme before the stylesheet.
The Angular implementation of the same features is asserted by `npm run test:e2e`,
which checks `<html lang="zh-CN">` after a language switch and
`<html data-theme="dark">` after the theme switch in a real browser.

### Manually

Open either site and use the two controls in the header. The theme defaults to
following the operating system, so setting Windows to a dark app mode is enough
to see the dark theme without touching the switch. Language can also be forced
with a query string, which is handy for a screenshot or a demonstration:

```
http://localhost:4200/?lang=ja
```

`?lang=` accepts `en`, `zh`, `vi` and `ja`. The order of precedence is: a stored
choice first, then `?lang=`, then the browser's own preference, then English - so
`?lang=` beats the browser, and clearing the stored value (or using a private
window) is what makes a demonstration link reliable.

---

## 8. Assessment note

The A2 brief asked for three pages (Home, Search, Details), a menu on every page,
basic DOM manipulation and "Goal vs. Progress". A3 adds the registration page and
a second, separate admin website, and the theme and language features remain
**not** required by either brief; they are additional work. Three consequences
worth being clear about:

1. **The two websites have separate dictionaries on purpose.** The public site
   translates with `shared/src/i18n/client-translations.ts` (306 keys) and the
   admin site with `shared/src/i18n/admin-translations.ts` (253 keys); both offer
   all four languages. They are separate because a visitor's journey and a staff
   member's work share very little wording, not because one of the sites is
   English-only - that was the vanilla arrangement, where the admin pages had
   their own single-language file. `TranslationService` receives whichever
   dictionary its host provided through the `APP_DICTIONARIES` token, so the
   shared service never has to know which site it is running in.
2. **You must be able to explain every line**, including why `matchMedia` is
   used, why the theme is applied before the stylesheet, why the `t` pipe is
   declared impure, and how a signal read inside a template makes the page
   re-render. The remarks in each file are written to make that possible.
3. **The translations are machine-written.** Chinese, Vietnamese and Japanese
   interface text was produced by an AI assistant, not a native speaker. If the
   phrasing matters to you, have a native speaker review
   `shared/src/i18n/client-translations.ts` and
   `shared/src/i18n/admin-translations.ts` - each is a flat list of key/value
   pairs per language, so corrections are a one-line change each.
   `npm run check:translations` will confirm nothing was lost in the process.
