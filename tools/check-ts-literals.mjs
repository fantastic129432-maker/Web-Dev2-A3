/**
 * tools/check-ts-literals.mjs
 * ---------------------------------------------------------------------------
 * The check the template and dictionary checks cannot make: no user-facing English
 * WORD is written into TypeScript.
 *
 * WHY THE OTHER CHECKS MISSED THIS CLASS
 *   The template check (tools/check-template-literals.mjs) reads `*.html` only,
 *   and the four checks in tools/check-translations.mjs are statements about KEYS
 *   (does every language define it, does the code ask for it, do the values agree
 *   on their {placeholders}) or about the VALUES inside the dictionary. A word
 *   written in TypeScript satisfies all of them:
 *
 *     * it is not in a template, so the template check never sees it;
 *     * it asks for no key, so the usage check has nothing to complain about;
 *     * it is not in a dictionary, so the value check never reads it.
 *
 *   That is exactly how a sentence - "We fund community health programs for
 *   families who cannot afford private care." - reached the Chinese home page
 *   from the API's organisation record and stayed English there for two sweeps:
 *   the template carried `{{ organization()?.mission || ('about.mission' | t) }}`,
 *   which asked for a key honestly, so every key check passed, and the words that
 *   actually rendered came from a value no check inspects.
 *
 * WHAT IT CHECKS
 *   Every `*.ts` file under `clientside/src`, `adminside/src` and `shared/src`
 *   (the last one because both applications render text the shared library
 *   supplies), for two shapes of user-facing literal:
 *
 *     * A PHRASE - a quoted or template literal that contains two or more Latin
 *       words, e.g. `new ApiError('The API could not be reached.')`. This is the
 *       shape a sentence takes, and the shape this project writes into a
 *       dictionary instead.
 *     * A USER-FACING SINK - a literal of any length handed to a call that puts
 *       text in front of a person: `textContent`, `innerText`, `innerHTML`,
 *       `insertAdjacentHTML`, `document.title`, `alert`/`confirm`/`prompt`, and
 *       `setAttribute` for `aria-label`, `title`, `alt` or `placeholder`. A
 *       single word is a defect here, so this rule exists to catch the
 *       one-word literal that the phrase rule is deliberately blind to.
 *
 *   A candidate FAILS unless it is listed in INTENTIONAL_TS_LITERALS below, so
 *   the normal way to put a word in front of a visitor is a dictionary key in
 *   all four languages.
 *
 * WHAT IT CANNOT CHECK (its own limits, stated on purpose)
 *   * A STRING BUILT AT RUNTIME. `const key = 'error.' + status` never becomes a
 *     literal this scan can read: only a quoted or template literal in the file
 *     is a candidate. A key assembled from parts is invisible here AND to the
 *     usage check in tools/check-translations.mjs.
 *   * A SENTENCE ASSEMBLED FROM FRAGMENTS. A template with an interpolation is
 *     read for its CONSTANT parts only: `\`Total: ${money}\`` is reported for
 *     "Total:", but a sentence pieced together from two dictionary values, or
 *     from a value plus a literal, can still read as English in Chinese while
 *     every fragment looks legitimate on its own.
 *   * A VALUE THAT IS LEGITIMATELY ENGLISH. A route path, a CSS class, a storage
 *     key, a query parameter, a selector, a MIME type, an API path, a date
 *     format, a log line and a test id are all English and all correct; nothing
 *     here can tell them from a defect, so they are allow-listed BY NAME below,
 *     with the reason they are not words on a page. A stale entry FAILS, so the
 *     list stays a decision record rather than a set of excuses.
 *   * A STRING PASSED THROUGH A HELPER. `render('Search events')` is reported -
 *     it has two words - but a SINGLE word handed to a helper this file does not
 *     know (`helper('Save')`) is not, because a one-word literal is a candidate
 *     only in the sinks named above. The sinks are a list, so a new
 *     text-bearing call has to be added to it on purpose.
 *   * TEXT ASSEMBLED FROM API DATA. The API's own content layer is English by
 *     design (see the note in clientside/src/app/pages/home/home.ts), and this
 *     check reads the code, not a response body: a sentence the API supplies is
 *     visible to it only where the code touches it. That is why the home page
 *     now renders the dictionary sentence rather than a field of
 *     `GET /api/organization`. The TEMPLATE half of this limit is closed by the
 *     mixed-fallback rule in tools/check-template-literals.mjs, which fails on
 *     `value || ('key' | t)` - a content field allowed to beat a dictionary key -
 *     and this scan covers the same shape in TypeScript only as far as a literal
 *     is involved (`this.message || t('error.notFound')` is read as one string
 *     that IS translated, so it passes).
 *   * A WORD THAT IS NOT ENGLISH-LOOKING. Only ASCII letter words are read, so a
 *     literal already written in Chinese, Japanese or Vietnamese is not a
 *     candidate - this check is about English left where a translation belongs.
 *   * A COMMENT. Comments are documentation in this project and quote page text
 *     constantly ("the white Get in touch section"), so they are blanked before
 *     the scan. A sentence that exists only in a comment is not on a page.
 *
 * THE ALLOW-LIST IS CHECKED TOO
 *   An entry that no longer matches anything FAILS. When the literal it names is
 *   removed, its entry has to go with it.
 *
 * Run:  node tools/check-ts-literals.mjs
 *       npm run check:translations     (runs it as the sixth check, with the
 *                                       five in that file)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

/** The directories scanned, relative to the project root. */
const SOURCE_DIRECTORIES = ['clientside/src', 'adminside/src', 'shared/src'];

/**
 * Files that ARE the dictionary, or are generated from it.
 *
 * They are excluded by name because their whole content is English values in a
 * `Record<LanguageCode, Dictionary>` literal - that is what the fourth check in
 * tools/check-translations.mjs reads, and running this scan over them would
 * report every English value as its own defect.
 */
const SKIPPED_FILES = [
  'shared/src/i18n/client-translations.ts',
  'shared/src/i18n/admin-translations.ts',
];

/**
 * Test files, excluded for the same reason a test id is allow-listed: nothing in
 * them reaches a page.
 *
 * `*.spec.ts` is run by the test runner and is not part of either application's
 * bundle (`ng build` does not include it), so its literals are test names and the
 * selectors those tests query with. Excluding them by pattern rather than listing
 * every test name as an allow-list entry keeps the list below about the SHIPPED
 * code - which is where a translator's missing string can actually be seen.
 */
const TEST_FILE = /\.spec\.ts$/;

/** Calls that put a string in front of a person, for the one-word rule. */
const USER_FACING_SINKS = [
  'textContent',
  'innerText',
  'innerHTML',
  'insertAdjacentHTML',
  'alert',
  'confirm',
  'prompt',
];

/** The attributes whose value a person reads or hears when set from code. */
const USER_FACING_ATTRIBUTES = ['aria-label', 'aria-placeholder', 'title', 'alt', 'placeholder'];

/** Two letters of Latin script, so a phrase is recognised in any of them. */
const HAS_WORDS = /[A-Za-z]{2}/;

/**
 * The literals that are deliberately NOT dictionary keys.
 *
 * Each entry is one decision, named so the report reads as a record rather than
 * a list of strings: `values` (or `pattern`) is what it exempts and `why` is the
 * reason. An entry that stops matching anything FAILS.
 */
const INTENTIONAL_TS_LITERALS = [
  {
    name: 'CSS class strings returned to a [class] binding',
    pattern: /^(?:event-card|badge|price)(?:\s+(?:event-card|badge|price)--[a-z-]*)+$/,
    why: 'A class name is read by the stylesheet, not by a person: `badge badge--upcoming`, `price price--closed` and `event-card event-card--past` are the words a `[class]` binding paints with, and the state they name is translated in the badge TEXT beside them (state.upcoming / state.ongoing / state.past). Translating the class would break the stylesheet instead of helping a reader. The pattern is anchored to this project\'s three class prefixes and to the `--modifier` shape, so a sentence that mentioned a badge would not be covered by it.',
  },
  {
    name: 'CSS selectors handed to querySelector / querySelectorAll',
    values: [
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      'admin-event-form [aria-invalid="true"]',
    ],
    why: 'A selector is a query the DOM engine answers, in the language of the DOM rather than of the visitor: the first is the focusable-element list the confirm dialog traps Tab within, the second is what the event form scrolls to when validation fails. Neither is ever painted, and a translated selector would match nothing.',
  },
  {
    name: 'the developer diagnostics an ApiError carries, which friendlyMessage() never renders',
    values: [
      'The request timed out.',
      'The API could not be reached.',
      'An unexpected error occurred.',
    ],
    why: 'These are the messages a console, a stack trace and a bug report read, and none of them can reach the screen: friendlyMessage() resolves `timedOut` to error.timeout, a timeout also leaves no HTTP status, status 0 to error.offline, and the final branch to error.server, so the ApiError message is only shown for a 404 or a 409 - and those two carry the API\'s own wording or an empty string (see ApiError.fromEnvelope). A page that rendered `error.message` directly instead of calling friendlyMessage() would defeat this, which is why that is written down here rather than assumed.',
  },
  {
    name: 'console warnings about the interface itself, printed for a developer',
    pattern: /^\[(?:i18n|theme)\] /,
    why: 'Three console.warn() lines - a translation key that no dictionary defines, a language code nothing supports and a stored theme value nothing recognises. They are diagnostics for whoever is reading the console, they are prefixed with the subsystem that emitted them, and the strings a visitor sees instead are the dictionary values the same code falls back to (the key itself for a missing translation, and the default language or the system theme for the other two).',
  },
  {
    name: 'the pre-paint theme script, inlined in both index.html files',
    pattern: /^(?:\(function\(\)|var [a-z]=|document\.documentElement)/,
    why: 'EARLY_THEME_SNIPPET is a JavaScript PROGRAM, concatenated from three string pieces and pasted into a <script> in <head>, where it reads the stored theme and sets data-theme before the first paint. Its strings are a localStorage key, the three preference names and a matchMedia query - code, not copy - and it runs before any bundle (and therefore any dictionary) has loaded, which is the whole reason it is inlined.',
  },
  {
    name: 'the prefers-color-scheme media query',
    values: ['(prefers-color-scheme: dark)'],
    files: ['shared/src/theme/theme.service.ts'],
    why: 'The CSS feature query matchMedia() is asked about, in the service that follows the operating system when the visitor has chosen no theme. A media query is read by the browser; writing it in four languages would be writing it once and breaking it three times.',
  },
  {
    name: 'the name of a language, written in that language',
    values: ['Tiếng Việt'],
    files: ['shared/src/i18n/languages.ts'],
    why: "The nativeLabel of Vietnamese in SUPPORTED_LANGUAGES, which is what both language switchers render (`{{ entry.nativeLabel }}` / `{{ option.nativeLabel }}`) so that a visitor can find their own language whatever the interface is currently in - the same reason 'English', '中文' and '日本語' sit beside it. The English `label` field on the same rows ('Chinese', 'Vietnamese', ...) is never rendered by either switcher; it is data about the language, not a label on screen.",
  },
];

/* ------------------------------------------------------------------ scanning */

/** Every .ts file under a directory, skipping build output and spec files. */
function walk(dir) {
  const found = [];
  if (!fs.existsSync(dir)) return found;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walk(full));
    else if (entry.name.endsWith('.ts')) found.push(full);
  }
  return found;
}

/**
 * Blank out a region without moving a line.
 *
 * The report names `file:line`, so the analysed text keeps the file's own line
 * numbering - and this project documents heavily, so a comment removed by line
 * would shift every finding after it.
 */
function blankKeepingLines(region) {
  return region.replace(/[^\n]/g, ' ');
}

/**
 * Remove comments, keeping every line break.
 *
 * Block comments go first so that a `//` inside one cannot end the wrong line;
 * the line-comment pass then has to avoid a `//` inside a URL, so it only
 * matches a `//` that starts a comment (`//` or code followed by whitespace and
 * `//`).
 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, blankKeepingLines)
    .replace(/(^|[^:\w"'`])\/\/[^\n]*/g, (match, prefix) => prefix + ' '.repeat(match.length - prefix.length));
}

/** The 1-based line a character offset falls on. */
function lineAt(text, offset) {
  let line = 1;
  for (let index = 0; index < offset && index < text.length; index += 1) {
    if (text[index] === '\n') line += 1;
  }
  return line;
}

/** The Latin words in a literal, so a path or a key can be told from a phrase. */
function latinWords(text) {
  const words = [];
  for (const match of text.matchAll(/[A-Za-z][A-Za-z0-9'’-]*/g)) {
    if (match[0].length >= 2) words.push(match[0]);
  }
  return words;
}

/** A dotted translation key such as `nav.home` is a lookup, not page text. */
const TRANSLATION_KEY = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/;

/**
 * Is this literal handed to a user-facing sink?
 *
 * The sink is looked for in the text immediately before the literal (the call
 * or the property assignment), because that is where the destination is written:
 * `element.textContent = 'Save'`, `setAttribute('aria-label', 'Save')`.
 */
function sinkFor(before) {
  const tail = before.slice(-120);
  for (const attribute of USER_FACING_ATTRIBUTES) {
    if (new RegExp(`setAttribute\\(\\s*["']${attribute}["']\\s*,\\s*$`).test(tail)) {
      return `setAttribute(${attribute})`;
    }
  }
  if (/document\s*\.\s*title\s*=\s*$/.test(tail)) return 'document.title';
  for (const sink of USER_FACING_SINKS) {
    if (new RegExp(`(?:\\.|\\b)${sink}\\s*=\\s*$`).test(tail)) return `${sink} =`;
    if (new RegExp(`\\b${sink}\\(\\s*$`).test(tail)) return `${sink}(`;
  }
  return null;
}

/** Unescape the few sequences that change whether a literal reads as words. */
function literalValue(raw) {
  return raw
    .replace(/\\n/g, ' ')
    .replace(/\\t/g, ' ')
    // A character escape is one character, not a word: `\u00B7` is a middle dot
    // and `\u00B0C` is a degree sign, and reading their letters would report a
    // separator as an English word.
    .replace(/\\u[0-9a-fA-F]{4}/g, ' ')
    .replace(/\\x[0-9a-fA-F]{2}/g, ' ')
    .replace(/\\(["'`\\])/g, '$1');
}

/**
 * Every English-looking literal in one TypeScript source.
 *
 * The judged text is the literal's CONSTANT part: for a template with an
 * interpolation the `${...}` expressions are REMOVED (not replaced by a space, so
 * that removing one cannot glue two fragments into a word), and the result is
 * collapsed to one line. `` `badge badge--${state}` `` is therefore judged as
 * "badge badge--" and `` `/events/${id}/registrations` `` as
 * "/events//registrations" - one token, no space between words, and so not a
 * phrase. The raw text is kept as well, because that is what the report prints.
 *
 * @returns Findings, each with the 1-based line, the text, the constant part, the
 *   words it contains and (when one applies) the user-facing sink it is handed to.
 */
function findLiterals(source) {
  const findings = [];
  const stripped = stripComments(source);
  const literalPattern = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g;

  for (const match of stripped.matchAll(literalPattern)) {
    const quoted = match[0];
    const raw = quoted.slice(1, -1);
    const value = literalValue(raw);
    const interpolated = value.includes('${');
    const constant = (interpolated ? value.replace(/\$\{[^}]*\}/g, '') : value)
      .replace(/\s+/g, ' ')
      .trim();

    if (!HAS_WORDS.test(constant)) continue;
    if (TRANSLATION_KEY.test(constant)) continue;

    const words = latinWords(constant);
    const sink = sinkFor(stripped.slice(0, match.index));
    // A phrase is two or more words separated by a space - the shape a sentence
    // takes. A path, a class name, an id or a storage key has no space between its
    // words, so it never becomes a phrase; a single word counts only when it is
    // handed to a place a person reads it from.
    const isPhrase = words.length >= 2 && /\s/.test(constant);
    if (!isPhrase && !sink) continue;

    findings.push({
      line: lineAt(stripped, match.index),
      value: value.replace(/\s+/g, ' ').trim(),
      constant,
      words,
      interpolated,
      sink: sink === null ? (isPhrase ? 'phrase' : '') : sink,
    });
  }

  return findings;
}

/* ------------------------------------------------------------------ reporting */

/**
 * Every user-facing literal in the scanned TypeScript.
 *
 * @returns The findings (with their file), the unexplained ones, and the
 *   allow-list entries that were used or left stale.
 */
export function collectTsLiterals() {
  const findings = [];

  for (const directory of SOURCE_DIRECTORIES) {
    for (const file of walk(path.join(ROOT, directory))) {
      const relative = path.relative(ROOT, file).split(path.sep).join('/');
      if (SKIPPED_FILES.includes(relative)) continue;
      if (TEST_FILE.test(relative)) continue;

      const source = fs.readFileSync(file, 'utf8');
      for (const finding of findLiterals(source)) {
        findings.push({ file: relative, ...finding });
      }
    }
  }

  const used = new Set();
  const unexpected = [];

  for (const finding of findings) {
    // Matched on the CONSTANT part, which is what the scan judged: an entry for
    // `badge badge--` covers `badge badge--${state}` without spelling out every
    // state the template can be in.
    const entry = INTENTIONAL_TS_LITERALS.find((candidate) => {
      if (candidate.files && !candidate.files.includes(finding.file)) return false;
      if (candidate.values) return candidate.values.includes(finding.constant);
      if (candidate.pattern) return candidate.pattern.test(finding.constant);
      return false;
    });
    if (entry) used.add(entry);
    else unexpected.push(finding);
  }

  return {
    findings,
    unexpected,
    used: INTENTIONAL_TS_LITERALS.filter((entry) => used.has(entry)),
    unused: INTENTIONAL_TS_LITERALS.filter((entry) => !used.has(entry)),
  };
}

/**
 * Print the result and register it as one check in the caller's list.
 *
 * @param check - The caller's recording function, `check(label, ok, detail)`.
 */
export function runTsLiteralCheck(check) {
  const { unexpected, used, unused } = collectTsLiterals();

  console.log('');
  console.log('TypeScript literals');
  console.log('-------------------');

  for (const finding of unexpected) {
    const sink = finding.sink ? ` (${finding.sink})` : '';
    const constant = finding.constant === finding.value ? '' : `  [constant part: "${finding.constant}"]`;
    console.log(`          ${finding.file}:${finding.line}${sink}  "${finding.value}"${constant}`);
  }
  for (const entry of unused) {
    console.log(`          STALE TS ALLOW-LIST ENTRY  ${entry.name}`);
  }

  console.log(`          ${used.length} intentional TypeScript literal(s), each exempted by name:`);
  for (const entry of used) {
    console.log(`            ${entry.name}`);
    console.log(`              why: ${entry.why}`);
  }

  const detail =
    unexpected.length === 0 && unused.length === 0
      ? `${used.length} intentional literal(s) exempted by name (listed above); nothing unexplained`
      : `${unexpected.length} unexplained literal(s), ${unused.length} stale allow-list entr(ies) - see the lines above`;

  check('no user-facing English literal is written into TypeScript instead of a dictionary key', unexpected.length === 0 && unused.length === 0, detail);
}

/* A standalone run prints the same report and exits non-zero on a finding, so the
   check can be demonstrated - and its bite proved - on its own. */
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--list')) {
    const { findings } = collectTsLiterals();
    for (const finding of findings) {
      console.log(`${finding.file}:${finding.line}  "${finding.value}"`);
    }
    console.log(`${findings.length} candidate(s)`);
    process.exit(0);
  }

  const results = [];
  runTsLiteralCheck((label, ok, detail) => {
    results.push(ok);
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
    if (detail) console.log(`          ${detail}`);
  });
  process.exit(results.every(Boolean) ? 0 : 1);
}
