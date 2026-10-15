# Code comment style (autodoc / TSDoc)

PROG2002 Web Development II — **Assessment 3**

Assessment 2 feedback: *"Comments style not consistent, should follow the autodoc
style, for ease of automatic doc generation through your code."*

This file is the single source of truth for how this project is commented. Every
source file follows it, so the documentation is consistent and a generator can read
it. The style is **TSDoc** (the TypeScript dialect of JSDoc), which is what
TypeDoc, VS Code hover text and most documentation generators consume.

Two commands keep it honest:

```bash
npm run check:docs     # fails if a documented symbol does not follow this file
npm run docs           # generates docs/api-reference.md from the comments
```

---

## 1. The block format

One block per documented symbol, immediately above it, starting with `/**` and every
continuation line beginning with ` * `.

```ts
/**
 * One sentence saying what this is, in the third person, ending with a full stop.
 *
 * Optional further paragraphs for the reasoning: why it exists, what would break
 * without it, what it deliberately does NOT do. This is where the project's
 * decisions are recorded, and it is the part a marker reads.
 *
 * @param name - What the parameter is, not its type (the type is in the signature).
 * @returns What comes back, including the empty or null case.
 * @throws When it throws, and what the caller should do about it.
 */
```

Rules that the checker enforces:

1. **The summary is one sentence ending in a full stop.** Not a fragment, not a
   question. `@param`/`@returns` descriptions follow the same rule.
2. **Every exported symbol has a block**: class, method, function, interface,
   type alias, constant, and every public class member.
3. **Tag order is fixed**: summary and body first, then `@param` (in signature
   order), then `@returns`, then `@throws`, then `@example`, then `@see`.
4. **`@param` has the form `@param name - description.`** An em-dash-free hyphen
   (` - `) separates the name from the description. No `{type}` braces: the type
   is already in the signature, and repeating it is how two descriptions of the
   same thing drift apart.
5. **`@param` covers every parameter and no others.** Optional parameters are
   documented as `@param name - ... May be omitted, in which case ...`.
6. **`@returns` is present for anything that returns a value**, including
   `Promise<T>`, and says what the resolved value is. A function returning `void`
   does not get one.
7. **`@throws` is present if the function can throw**, including throwing through a
   rejected promise. Documenting a throw that cannot happen is worse than omitting
   it, so only list real ones.
8. **No `@author`, `@date`, `@version` or a comment signing off the file.** Git
   records who and when, and a stale `@author` is worse than none.
9. **Internal (non-exported) helpers get a summary block** with the same shape but
   do not need `@param`/`@returns` unless the meaning is not obvious from the name.
10. **Private class members** get a one-line `/** ... */` summary. No tags.

## 2. What the body is for

The summary says *what*; the body says *why*. This project's comments exist to show
understanding, so the body carries the decision and the alternative that was
rejected — for example why a unique key is on a pair of columns, why a delete check
runs inside a transaction, or why a client-side value is written in a `[selected]`
binding. Write the reason, not a restatement of the code.

Do not narrate the obvious (`// loop over the events`). If a line needs no
explanation, it needs no comment.

## 3. Angular templates

* A template-level comment uses `<!-- ... -->`.
* A component's template gets a short comment at the top saying what the whole
  screen or region is, and section comments before each region — Header, Nav, the
  main content, and the footer (see `docs/angular-architecture.md`).
* Comments that exist to explain a binding to a future reader (rather than to
  narrate markup) are kept, because that is where Angular-specific traps are
  recorded.

## 4. File-level blocks

Files that are entry points or that carry a rule worth stating up front begin with a
file block: the same `/** */` form plus `@file`.

```ts
/**
 * Application shell: the segments every page shares.
 *
 * @file
 * Header, nav and footer are rendered here, once, as siblings of the routed page,
 * so navigating never rebuilds them.
 */
```

Write the **summary sentence first and `@file` after it**, because the checker reads
the summary as the first non-tag paragraph; `@file` on the very first line is also
accepted, but keeping the order the same everywhere is what "consistent" means.

Do not put a file block on every file: use it where the file is a boundary
(an entry point, a barrel, a configuration file).

## 5. Examples

**Exported function**

```ts
/**
 * Format a stored date as `Saturday 24 October 2026`.
 *
 * @param value - A `YYYY-MM-DD` string or an ISO timestamp from the API.
 * @param locale - Language code used for the month and weekday names.
 * @returns The formatted date, or an empty string when `value` is missing.
 */
export function formatDate(value: string | null, locale: string): string
```

**Interface**

```ts
/**
 * One event as the API returns it.
 *
 * Database content stays in English: these strings are data, not interface text,
 * so they are deliberately not translated.
 */
export interface CharityEvent {
  /** Primary key, and the id used in every route that addresses one event. */
  eventId: number;
  /** Display name, as entered by staff in the admin site. */
  eventName: string;
}
```

**Returning a value, and the case that has no value**

```ts
/**
 * Read one interface string.
 *
 * @param key - Dictionary key, for example `nav.home`.
 * @returns The translation, or the key itself when the dictionary has no entry, so a
 *   missing key is visible on screen rather than rendering as `undefined`.
 */
```

---

## 6. How this is verified

`npm run check:docs` walks `api/`, `shared/`, `clientside/` and `adminside/`,
collects every exported declaration, and fails when one has no block, when the
summary does not end in a full stop, when a `@param` does not match a parameter in
the signature, when a parameter is missing a `@param`, or when the tag order is
wrong. It runs in the same style as the project's other checks, so a regression is
caught the same way as an architecture or translation regression.

`npm run docs` writes `docs/api-reference.md` from the same blocks. If you would
rather use TypeDoc, the comments are already in the format it reads:

```bash
npx typedoc --entryPoints api/server.ts --entryPoints shared/src/index.ts
```
