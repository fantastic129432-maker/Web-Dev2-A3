/**
 * tools/check-template-literals.mjs
 * ---------------------------------------------------------------------------
 * The third translation check: no user-facing WORD is written into a template.
 *
 * WHY THE KEY CHECKS CANNOT SEE THIS
 *   check-translations.mjs proves two things about keys, and both are statements
 *   about KEYS rather than about the text on the page:
 *     1. the four dictionaries of a website define exactly the same keys, and
 *     2. every key a template or component ASKS FOR exists.
 *   A template that never asks for a key at all - `<h2>About this event</h2>`,
 *   `aria-label="Breadcrumb"` - satisfies both: nothing is missing from any
 *   dictionary, the key sets still match, so every check passes while the page
 *   stays English in all four languages. Only a person reading the template
 *   could see it. That is the hole this file closes.
 *
 *   This file closes the TEMPLATE half of that hole. The VALUE half - a template
 *   that asks for a key honestly, and a dictionary that answers it in the wrong
 *   language - is closed by the fourth check in tools/check-translations.mjs,
 *   which reads the values themselves.
 *
 * WHAT IT CHECKS
 *   Every `*.html` file under `clientside/src` and `adminside/src`, for THREE
 *   kinds of user-facing literal:
 *
 *     * TEXT - the words between two tags, after `{{ interpolations }}` and
 *       Angular's `@if/@for/@switch` headers are removed. Anything with two or
 *       more letters left is a candidate.
 *     * ATTRIBUTES - an accessible name or a prompt on an element:
 *       `aria-label`, `aria-placeholder`, `aria-description`,
 *       `aria-roledescription`, `title`, `alt`, `placeholder`, `label`, and
 *       `value` on `<input type="submit|button|reset">` (the button's visible
 *       caption). Interpolated/bound attributes (`[attr.aria-label]=`, `{{ }}`)
 *       are resolved at runtime and are not literals.
 *     * A DICTIONARY KEY USED AS A FALLBACK - an interpolation or binding that
 *       offers translated text as the alternative to a value that can win:
 *       `{{ organization()?.mission || ('about.mission' | t) }}`. Every word in
 *       it is a dictionary key, so the two rules above pass it; the page still
 *       shows English, because the API's `mission` is content and wins whenever
 *       the request succeeds, and the translated sentence is left as dead code
 *       for the failure case. That is the exact shape of the defect this project
 *       shipped twice: the lead sentence on the Chinese home page. Rendering an
 *       API value on its own is content and is NOT reported - only offering
 *       translated text as its fallback is, because it means the slot was meant
 *       to be site copy.
 *
 *   A candidate FAILS unless it is listed in INTENTIONAL_LITERALS (or, for the
 *   third rule, INTENTIONAL_MIXED_FALLBACKS) below, so the normal way to add a
 *   word to a page is a dictionary key in all four languages - which the key
 *   checks and the value check then hold to their own rules.
 *
 * WHAT IT CANNOT CHECK (its own limits, stated on purpose)
 *   * A VALUE IN THE WRONG LANGUAGE. This check sees the key a template asks
 *     for, never the text it resolves to, so it cannot tell that `ja` carries
 *     "All rights reserved." for `nav.rights` - a value identical to English is
 *     a translation decision, not a missing lookup. That defect used to be a
 *     documented blind spot HERE; it is now caught by the fourth check in
 *     tools/check-translations.mjs, which reads the values ("All rights
 *     reserved." in the Japanese block is exactly what it reports). What is
 *     still invisible to both is a value that is translated into the WRONG
 *     non-English language, or one that is simply wrong in a way no English
 *     word appears in. This check also does not know that `state.event` and
 *     `state.charityEvent` are different words in English and the same word in
 *     another language.
 *   * A PROPER NOUN, A BRAND, A URL, A FORMAT. Nothing here can tell "Unity
 *     Heart Foundation" from a sentence, or an email address from a label, so
 *     those are exempted BY HAND below, each with its reason. A new one has to
 *     be added on purpose, which is the point: the list is a decision record,
 *     not a pattern.
 *   * AN INTERPOLATED VALUE. `{{ ... }}` is stripped before the text is judged,
 *     so a literal built inside an interpolation -
 *     `{{ kind === 'past' ? 'Past' : 'Soon' }}` - is NOT seen, and a sentence
 *     that is half literal and half interpolated ("Total: {{ money() }}") is
 *     reported for its literal half only. Keeping the weather panel's reason
 *     keys as `{{ 'weather.reasonPast' | t }}` rather than assembling them in
 *     TypeScript is deliberate for exactly this reason.
 *   * A NON-USER-FACING ATTRIBUTE. Only the attributes named above are read.
 *     `value` on an `<option>` or on a radio input is the value the form
 *     SUBMITS ("state=upcoming"), not words a person reads, so it is ignored -
 *     as are `content=` on a `<meta>`, `id`, `class`, `href`, `name`, every
 *     `data-*`, and anything not mentioned here.
 *   * A KEY BUILT IN TYPESCRIPT. `t(dynamicKey)` is invisible to the existing
 *     usage check as well; only string literals can be seen statically. The
 *     mixed-fallback rule below has the same blind spot: an expression assembled
 *     in the component and merely PRINTED here (`{{ missionOrFallback() }}`)
 *     leaves this file nothing to read, so a defect moved into a helper method
 *     still has to be caught by reading the component.
 *   * A DICTIONARY KEY THAT WINS FOR A REASON. The third rule reports the SHAPE
 *     (`value || ('key' | t)`), not the intent. A slot that genuinely wants to
 *     show the API's own wording when it is there and a translated sentence when
 *     it is not - the honest use of this shape - therefore has to be recorded in
 *     INTENTIONAL_MIXED_FALLBACKS with its reason, which is what that list is
 *     for. A field that is content and is rendered ON ITS OWN is not reported at
 *     all: this rule is about translated text losing, not about English content
 *     being English.
 *   * THE ARCHIVED VANILLA FRONTEND. `legacy/clientside/*.html` still contains
 *     `aria-label="Breadcrumb"`, and it is deliberately left alone: it is the
 *     migration record, it is not built, and it is not served by either
 *     application. Restyling a museum piece would make it a worse record.
 *
 * THE EXEMPTION LIST IS CHECKED TOO
 *   An entry that no longer matches anything FAILS, so the list cannot rot into
 *   a set of excuses for strings that were deleted years ago. When you remove a
 *   literal, remove its entry.
 *
 * Run:  node tools/check-template-literals.mjs
 *       npm run check:translations     (runs it with the key checks and the
 *                                       value check)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

/** The two applications whose templates are scanned, relative to the root. */
const APP_DIRECTORIES = ['clientside/src', 'adminside/src'];

/** An attribute whose value a person reads or hears, not one the code reads. */
const USER_FACING_ATTRIBUTES = [
  'aria-label',
  'aria-placeholder',
  'aria-description',
  'aria-roledescription',
  'title',
  'alt',
  'placeholder',
  'label',
];

/** The tags whose `value` attribute is a visible caption rather than a payload. */
const VALUE_IS_A_CAPTION = new Set(['submit', 'button', 'reset']);

/** Two letters of any script, so a Chinese or Japanese literal is caught too. */
const HAS_WORDS = /\p{L}{2}/u;

/**
 * The literals that are deliberately NOT dictionary keys.
 *
 * Each entry is one decision: the words are a name, a value or a unit rather
 * than wording, so translating them would be wrong. `file` is a POSIX-style path
 * relative to the project root and `value` is the exact text the scan reports -
 * both are printed by this check when they stop matching, so a stale entry is
 * easy to find.
 */
const INTENTIONAL_LITERALS = [
  {
    file: 'clientside/src/index.html',
    value: 'Unity Heart Foundation - Charity Events',
    reason:
      'The initial <title> of the app shell. It is replaced at runtime by useDocumentTitle() with the translated event.detailTitle / route key, so it is only what a browser tab shows during the second before Angular boots - and it is written HERE, in the shell, where no dictionary is loaded yet.',
  },
  {
    file: 'clientside/src/index.html',
    value: 'Loading the charity events website...',
    reason:
      'The pre-boot placeholder inside <app-root>. It is painted before the JavaScript bundle runs, so it cannot resolve a dictionary key; the same words exist as event.loading / home.loadingEvents for everything the application itself renders.',
  },
  {
    file: 'adminside/src/index.html',
    value: 'Charity Events administration',
    reason:
      'The initial <title> of the admin shell, for the same reason as the public one: the shell has no dictionary until Angular bootstraps.',
  },
  {
    file: 'adminside/src/index.html',
    value: 'Loading the administration site...',
    reason:
      'The admin shell pre-boot placeholder, for the same reason as the public one.',
  },
  {
    file: 'clientside/src/app/layout/site-footer.html',
    value: 'hello@unityheart.org.au',
    reason:
      'The TEXT of a mailto: link. It is the organisation\'s address, which is the same in every language, and a translated address would not deliver.',
  },
  {
    file: 'adminside/src/app/layout/admin-footer/admin-footer.html',
    value: 'Unity Heart Foundation',
    reason:
      'The organisation\'s own name. The public site reaches the same words through nav.siteName, but the admin footer names the body that runs the site rather than labelling a link, and a proper noun is never translated - see also data names such as eventName and venueName, which the API serves in English by design.',
  },
  {
    file: 'adminside/src/app/shared/weather-preview/weather-preview.html',
    value: 'km/h',
    reason:
      'A unit symbol, printed beside a number as "25 km/h". It is the same symbol in all four languages (the dictionaries translate the LABEL, weather.wind, not the unit), exactly like the degree sign and the percent sign beside it.',
  },
];

/**
 * The mixed fallbacks that are deliberate.
 *
 * Same contract as INTENTIONAL_LITERALS above: `file` and `value` (the
 * interpolation as the scan reads it, single-spaced) name the decision, `reason`
 * records it, and an entry that stops matching FAILS. There are no entries today,
 * because the shape this rule forbids is not used anywhere in either application
 * - the list exists so that the first honest use of it is a recorded decision
 * rather than a hole in the rule.
 */
const INTENTIONAL_MIXED_FALLBACKS = [];

/* ------------------------------------------------------------------ scanning */

/** Every .html file under a directory, skipping build output. */
function walkTemplates(directory) {
  const found = [];
  if (!fs.existsSync(directory)) return found;

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) {
      continue;
    }
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...walkTemplates(full));
    else if (entry.name.endsWith('.html')) found.push(full);
  }
  return found;
}

/**
 * Blank out a region WITHOUT moving a single line.
 *
 * The scan reports `file:line`, so the text it analyses has to keep the file's
 * own line numbering. Replacing a comment with a bare space would collapse its
 * lines, and every line number after it would be wrong by the height of that
 * comment - and this project documents a great deal inside template comments.
 * Every character except a newline becomes a space, so offsets survive and a
 * reported line is a line a person can open.
 */
function blankKeepingLines(region) {
  return region.replace(/[^\n]/g, ' ');
}

/**
 * Remove what a template RESOLVES and keep what it SAYS.
 *
 * Order matters. Comments go first, because the project documents examples such
 * as `<h2>About this event</h2>` inside them and a checker that treated an
 * example as a real literal would report documentation as a defect. Scripts and
 * styles go next: their contents are code, not words. Then the interpolations,
 * then Angular's control-flow headers (whose parentheses can nest), then HTML
 * entities, then the block braces that are all that is left of `@if (...) {`.
 */
function visibleTextOf(rawTextNode) {
  return rawTextNode
    .replace(/@(?:if|for|switch|case|defer|else\s+if)\s*\((?:[^()]|\([^()]*\))*\)/g, ' ')
    .replace(/@(?:else|default|empty|placeholder|loading|error)\b/g, ' ')
    .replace(/\{\{[\s\S]*?\}\}/g, ' ')
    .replace(/&[a-zA-Z#0-9]+;/g, ' ')
    .replace(/[{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The 1-based line a character offset falls on. */
function lineAt(text, offset) {
  let line = 1;
  for (let index = 0; index < offset && index < text.length; index += 1) {
    if (text[index] === '\n') line += 1;
  }
  return line;
}

/**
 * The text-node literals in one template.
 *
 * A text node is what lies between `>` and `<`. Everything the template
 * interpolates is removed first, so what remains is words that came from the
 * file itself.
 */
function findTextLiterals(source) {
  const findings = [];

  for (const match of source.matchAll(/>([^<>]*)</g)) {
    const value = visibleTextOf(match[1]);
    if (!HAS_WORDS.test(value)) continue;

    // The line of the first character of the literal rather than of the match,
    // so a literal indented under its opening tag is reported where it is read.
    const firstLetter = value.match(/\p{L}{2}/u)?.[0] ?? value;
    const inMatch = match[1].indexOf(firstLetter);
    const offset = match.index + 1 + (inMatch === -1 ? 0 : inMatch);

    findings.push({ kind: 'text', value, line: lineAt(source, offset) });
  }

  return findings;
}

/**
 * The user-facing attribute literals in one template.
 *
 * Tags are matched with their quoted values intact, so a `>` inside an attribute
 * does not end the tag - which is what keeps `<svg ... d="M4 9h16v9a2 2 0 0 1-2 2H6">`
 * from being read as text.
 */
function findAttributeLiterals(source) {
  const findings = [];
  const tagPattern = /<([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;

  for (const tag of source.matchAll(tagPattern)) {
    const name = tag[1].toLowerCase();
    const attributeText = tag[2];
    const attributes = new Map();
    for (const attribute of attributeText.matchAll(/([a-zA-Z-]+)\s*=\s*"([^"]*)"/g)) {
      attributes.set(attribute[1].toLowerCase(), attribute[2]);
    }

    for (const [attribute, rawValue] of attributes) {
      // An interpolated attribute is resolved at runtime: `aria-label="{{ 'a11y.breadcrumb' | t }}"`
      // is a dictionary lookup, not a literal, and `{{ }}` never survives here.
      const value = visibleTextOf(rawValue);
      if (!HAS_WORDS.test(value)) continue;

      const isCaptionValue =
        attribute === 'value' && name === 'input' && VALUE_IS_A_CAPTION.has(attributes.get('type'));
      if (attribute !== 'value' && !USER_FACING_ATTRIBUTES.includes(attribute)) continue;
      if (attribute === 'value' && !isCaptionValue) continue;

      const inAttribute = source.indexOf(value, tag.index);
      findings.push({
        kind: attribute === 'value' ? `${name}[value]` : attribute,
        value,
        line: lineAt(source, inAttribute === -1 ? tag.index : inAttribute),
      });
    }
  }

  return findings;
}

/**
 * A dictionary lookup inside an expression: the pipe (`'key' | t`) or a call to
 * the service's own method (`t('key')`, `i18n.t('key')`).
 */
const DICTIONARY_LOOKUP = /\|\s*t\b|[^\w.]t\s*\(\s*['"][A-Za-z0-9_.]+['"]/;

/**
 * Split an expression on `||` / `??` at its TOP LEVEL only.
 *
 * The nesting matters, and getting it wrong made this rule's first run report
 * three innocent lines: `{{ 'event.goalLead' | t: { organisation: x || '' } }}`
 * is a dictionary lookup whose PLACEHOLDER value defaults to an empty string, and
 * splitting it blindly produced a "side" with no lookup in it. A `||` or `??`
 * inside `(...)`, `[...]`, `{...}` or a string literal is part of a value being
 * passed, not a choice between two renderings, so only depth-0 operators split.
 *
 * @param expression - The interpolation or binding body.
 * @returns The top-level alternatives, or the whole expression when there is no
 *   top-level `||` / `??`.
 */
function splitTopLevel(expression) {
  const parts = [];
  let current = '';
  let depth = 0;
  let quote = '';

  for (let index = 0; index < expression.length; index += 1) {
    const character = expression[index];

    if (quote) {
      current += character;
      if (character === quote && expression[index - 1] !== '\\') quote = '';
      continue;
    }
    if (character === '"' || character === "'" || character === '`') {
      quote = character;
      current += character;
      continue;
    }
    if ('([{'.includes(character)) depth += 1;
    if (')]}'.includes(character)) depth -= 1;

    const pair = expression.slice(index, index + 2);
    if (depth === 0 && (pair === '||' || pair === '??')) {
      parts.push(current);
      current = '';
      index += 1;
      continue;
    }
    current += character;
  }

  parts.push(current);
  return parts;
}

/**
 * The interpolations and bindings that offer a dictionary key as the fallback for
 * a value that can win.
 *
 * Both `{{ ... }}` interpolations and `[attr]="..."` bindings are read, because
 * both resolve at runtime and both can carry this shape. The expression is split
 * on its top-level `||` and `??`, and if ANY side has no dictionary lookup while
 * another side has one, the interface can show the untranslated value: the
 * translated text is then only the failure path, which is how a Chinese page came
 * to render `organization()?.mission || ('about.mission' | t)` in English.
 *
 * @returns Findings with the 1-based line, the `mixed fallback` kind, the
 *   single-spaced expression and the side that is not translated.
 */
function findMixedFallbacks(source) {
  const findings = [];
  const regions = [];

  for (const match of source.matchAll(/\{\{([\s\S]*?)\}\}/g)) {
    regions.push({ body: match[1], index: match.index });
  }
  // A bound attribute: [title]="..." / [attr.aria-label]="..." - never a literal.
  for (const match of source.matchAll(/\[[a-zA-Z.-]+\]\s*=\s*"([^"]*)"/g)) {
    regions.push({ body: match[1], index: match.index });
  }

  for (const region of regions) {
    if (!DICTIONARY_LOOKUP.test(region.body)) continue;
    const sides = splitTopLevel(region.body);
    if (sides.length < 2) continue;
    const untranslated = sides.filter((side) => !DICTIONARY_LOOKUP.test(side));
    if (untranslated.length === 0) continue;

    findings.push({
      kind: 'mixed fallback',
      value: region.body.replace(/\s+/g, ' ').trim(),
      line: lineAt(source, region.index),
    });
  }

  return findings;
}

/**
 * Every user-facing literal in the two applications' templates.
 *
 * @returns The findings, each with the file (relative, POSIX separators), the
 *   1-based line, the kind of literal and the text itself, plus the entries of
 *   INTENTIONAL_LITERALS and INTENTIONAL_MIXED_FALLBACKS that were actually used
 *   - so a stale one can be reported rather than silently kept.
 */
export function collectTemplateLiterals() {
  const findings = [];

  for (const directory of APP_DIRECTORIES) {
    for (const file of walkTemplates(path.join(ROOT, directory))) {
      const source = fs
        .readFileSync(file, 'utf8')
        // Comments are documentation, and documentation quotes templates.
        .replace(/<!--[\s\S]*?-->/g, blankKeepingLines)
        .replace(/<script[\s\S]*?<\/script>/gi, blankKeepingLines)
        .replace(/<style[\s\S]*?<\/style>/gi, blankKeepingLines);

      const relative = path.relative(ROOT, file).split(path.sep).join('/');
      for (const finding of [
        ...findTextLiterals(source),
        ...findAttributeLiterals(source),
        ...findMixedFallbacks(source),
      ]) {
        findings.push({ file: relative, ...finding });
      }
    }
  }

  const used = new Set();
  const usedFallbacks = new Set();
  const unexpected = [];

  for (const finding of findings) {
    const exemption = INTENTIONAL_LITERALS.find(
      (entry) => entry.file === finding.file && entry.value === finding.value
    );
    if (exemption) {
      used.add(exemption);
      continue;
    }

    const fallback = INTENTIONAL_MIXED_FALLBACKS.find(
      (entry) => entry.file === finding.file && entry.value === finding.value
    );
    if (fallback) usedFallbacks.add(fallback);
    else unexpected.push(finding);
  }

  return {
    findings,
    unexpected,
    used: INTENTIONAL_LITERALS.filter((entry) => used.has(entry)),
    usedFallbacks: INTENTIONAL_MIXED_FALLBACKS.filter((entry) => usedFallbacks.has(entry)),
    unused: INTENTIONAL_LITERALS.filter((entry) => !used.has(entry)),
    unusedFallbacks: INTENTIONAL_MIXED_FALLBACKS.filter((entry) => !usedFallbacks.has(entry)),
  };
}

/* ------------------------------------------------------------------ reporting */

/**
 * Print the result, and register it as one check in the caller's list.
 *
 * The signature is the same `check(label, ok, detail)` helper that
 * tools/check-translations.mjs uses, so every translation check reports in one
 * format and they are all counted together.
 *
 * @param check - The caller's recording function.
 */
export function runTemplateLiteralCheck(check) {
  const { unexpected, used, usedFallbacks, unused, unusedFallbacks } = collectTemplateLiterals();

  console.log('');
  console.log('Template literals');
  console.log('-----------------');

  for (const finding of unexpected) {
    console.log(`          ${finding.file}:${finding.line}  [${finding.kind}] ${finding.value}`);
  }
  for (const entry of unused) {
    console.log(`          STALE EXEMPTION  ${entry.file}  "${entry.value}"`);
  }
  for (const entry of unusedFallbacks) {
    console.log(`          STALE MIXED-FALLBACK EXEMPTION  ${entry.file}  "${entry.value}"`);
  }

  console.log(`          ${used.length} intentional literal(s), each exempted by name:`);
  for (const entry of used) {
    console.log(`            ${entry.file}  "${entry.value}"`);
    console.log(`              why: ${entry.reason}`);
  }
  for (const entry of usedFallbacks) {
    console.log(`            ${entry.file}  "${entry.value}"  [mixed fallback]`);
    console.log(`              why: ${entry.reason}`);
  }

  const totalUnused = unused.length + unusedFallbacks.length;
  const detail =
    unexpected.length === 0 && totalUnused === 0
      ? `${used.length + usedFallbacks.length} intentional literal(s) exempted by name (listed above); nothing unexplained, and no dictionary key is left as the fallback for a value that can win`
      : `${unexpected.length} unexplained literal(s), ${totalUnused} stale exemption(s) - see the lines above`;

  check(
    'no user-facing literal is written into a template, and no dictionary key is offered as the fallback for a value that can win',
    unexpected.length === 0 && totalUnused === 0,
    detail
  );
}

/* A standalone run prints the same report and exits non-zero on a finding, so
   the check can be demonstrated (and its bite proved) on its own. */
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const failed = [];
  runTemplateLiteralCheck((label, ok, detail) => {
    failed.push(ok);
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
    if (detail) console.log(`          ${detail}`);
  });
  process.exit(failed.every(Boolean) ? 0 : 1);
}
