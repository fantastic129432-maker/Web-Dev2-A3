/**
 * tools/check-translations.mjs
 * ---------------------------------------------------------------------------
 * Three checks that a language switcher can only be as good as:
 *
 *   1. COMPLETENESS - the four dictionaries of a website define exactly the same
 *      keys. A missing key silently falls back to English, so without this check
 *      a half-translated label is invisible until a marker switches language.
 *
 *   2. USAGE - every key a template or component asks for actually exists. A typo
 *      in `t('nav.hom')` renders "nav.hom" on the page. That is easy to introduce
 *      during a migration and impossible to spot by reading 300 keys.
 *
 *   3. LITERALS - no user-facing word is written into a template at all. Checks 1
 *      and 2 are both statements about KEYS, and a template that asks for no key
 *      satisfies both while staying English in every language: `<h2>About this
 *      event</h2>` and `aria-label="Breadcrumb"` are invisible to them. The scan
 *      itself lives in tools/check-template-literals.mjs, next to the exemption
 *      list it needs; this file runs it so the three are counted and reported as
 *      one suite.
 *
 * The dictionaries moved to TypeScript
 * (shared/src/i18n/client-translations.ts and admin-translations.ts) when the
 * frontend became Angular, so this checker parses those files instead of the old
 * vanilla clientside/js/translations.js. The parsing is deliberately tolerant of
 * formatting - it looks for `code: {` blocks and quoted keys - because people
 * edit these files by hand.
 *
 * Run:  node tools/check-translations.mjs
 *       npm run check:translations
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runTemplateLiteralCheck } from './check-template-literals.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SHARED_I18N = path.join(ROOT, 'shared', 'src', 'i18n');
const CLIENT = path.join(ROOT, 'clientside', 'src');
const ADMIN = path.join(ROOT, 'adminside', 'src');

const results = [];
function check(label, ok, detail = '') {
  results.push({ label, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (detail) console.log(`          ${detail}`);
}

/** The language codes, read from the generated languages.ts so there is one truth. */
function readLanguageCodes() {
  const source = fs.readFileSync(path.join(SHARED_I18N, 'languages.ts'), 'utf8');
  const match = source.match(/LANGUAGE_CODES\s*=\s*\[([^\]]+)\]/);
  if (!match) throw new Error('Could not read LANGUAGE_CODES from shared/src/i18n/languages.ts');
  return [...match[1].matchAll(/["']([^"']+)["']/g)].map((entry) => entry[1]);
}

const CODES = readLanguageCodes();

/**
 * Extract one key set per language from a `Record<LanguageCode, Dictionary>`
 * literal.
 *
 * A language block starts at a line like `  en: {` and ends where the next one
 * begins; the last block ends at the closing `};` of the exported literal.
 */
function parseDictionaries(source) {
  const dictionaries = {};

  for (const code of CODES) {
    const startPattern = new RegExp(`(^|\\n)[ \\t]*${code}[ \\t]*:[ \\t]*\\{`, 'm');
    const startMatch = startPattern.exec(source);
    if (!startMatch) continue;

    const start = startMatch.index + startMatch[0].length;
    let end = source.length;

    // The block ends at the next language's opening brace...
    for (const other of CODES) {
      if (other === code) continue;
      const otherPattern = new RegExp(`(^|\\n)[ \\t]*${other}[ \\t]*:[ \\t]*\\{`, 'm');
      const otherMatch = otherPattern.exec(source.slice(start));
      if (otherMatch) end = Math.min(end, start + otherMatch.index);
    }

    // ...or, for the final language, at the end of the exported literal.
    if (end === source.length) {
      const closing = source.slice(start).lastIndexOf('};');
      if (closing !== -1) end = start + closing;
    }

    const block = source.slice(start, end);
    const keys = new Set();
    for (const match of block.matchAll(/["']([^"'\n]+)["'][ \t]*:/g)) keys.add(match[1]);
    dictionaries[code] = keys;
  }

  return dictionaries;
}

/** Every .ts and .html file under a directory, skipping build output. */
function walk(dir, extensions, skip = ['node_modules', 'dist', '.angular']) {
  const found = [];
  if (!fs.existsSync(dir)) return found;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skip.includes(entry.name) || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walk(full, extensions, skip));
    else if (extensions.some((extension) => entry.name.endsWith(extension))) found.push(full);
  }
  return found;
}

/**
 * The keys a set of source files asks for.
 *
 * Two shapes are recognised:
 *   i18n.t('nav.home')        a call in TypeScript or in a template
 *   {{ 'nav.home' | t }}      the pipe
 *
 * Two things are deliberately excluded:
 *   * comment-only lines, because documentation writes examples such as
 *     `i18n.t('...')` and a checker that treats an example as a real lookup would
 *     report a key that nobody ever asked for;
 *   * anything that is not a plausible dotted key, so a placeholder like '...'
 *     or a bare word is ignored.
 *
 * A key built dynamically (for example `t(stateKey(eventState))`) cannot be
 * checked statically, so only string literals are collected.
 */
function collectRequestedKeys(directories) {
  const callPattern = /\.t\(\s*["']([A-Za-z0-9_.]+)["']/g;
  const pipePattern = /["']([A-Za-z0-9_.]+)["']\s*\|\s*t\b/g;
  const plausibleKey = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/;
  const requested = new Map();

  for (const directory of directories) {
    for (const file of walk(directory, ['.ts', '.html'])) {
      const text = fs
        .readFileSync(file, 'utf8')
        .split(/\r?\n/)
        .filter((line) => !/^\s*(\/\/|\/\*|\*|\*\/)/.test(line))
        .join('\n');

      for (const pattern of [callPattern, pipePattern]) {
        pattern.lastIndex = 0;
        for (const match of text.matchAll(pattern)) {
          const key = match[1];
          if (!plausibleKey.test(key)) continue;
          requested.set(key, path.relative(ROOT, file).split(path.sep).join('/'));
        }
      }
    }
  }

  return requested;
}

/**
 * The {placeholder} names in a translated value, sorted so order is irrelevant.
 *
 * `{count}` and `{ name }` - the substitution regex in TranslationService is
 * /\{(\w+)\}/g, so a name with a space in it is NOT substituted and would be
 * printed to the visitor verbatim.
 */
function placeholders(text) {
  return [...text.matchAll(/\{([A-Za-z_]\w*)\}/g)].map((match) => match[1]).sort();
}

/** Braces in a value that the substitution regex cannot use. */
function unusableBraces(text) {
  return [...text.matchAll(/\{[^}]*\}/g)]
    .filter((match) => !/^\{[A-Za-z_]\w*\}$/.test(match[0]))
    .map((match) => match[0]);
}

/**
 * Extract one key -> value map per language from a
 * `Record<LanguageCode, Dictionary>` literal.
 *
 * Same block-slicing as parseDictionaries(), but it keeps each VALUE, because a
 * key being present in all four languages says nothing about the placeholders
 * inside it: `"{count} tickets"` in English and `"tickets"` in Japanese both
 * "define the key", and the number silently disappears from the Japanese page.
 */
function parseDictionaryValues(source) {
  const dictionaries = {};

  for (const code of CODES) {
    const startPattern = new RegExp(`(^|\\n)[ \\t]*${code}[ \\t]*:[ \\t]*\\{`, 'm');
    const startMatch = startPattern.exec(source);
    if (!startMatch) continue;

    const start = startMatch.index + startMatch[0].length;
    let end = source.length;

    for (const other of CODES) {
      if (other === code) continue;
      const otherPattern = new RegExp(`(^|\\n)[ \\t]*${other}[ \\t]*:[ \\t]*\\{`, 'm');
      const otherMatch = otherPattern.exec(source.slice(start));
      if (otherMatch) end = Math.min(end, start + otherMatch.index);
    }

    if (end === source.length) {
      const closing = source.slice(start).lastIndexOf('};');
      if (closing !== -1) end = start + closing;
    }

    const block = source.slice(start, end);
    const values = new Map();
    for (const match of block.matchAll(/^\s*"([^"\n]+)":\s*"((?:[^"\\]|\\.)*)"/gm)) {
      if (!values.has(match[1])) values.set(match[1], match[2]);
    }
    dictionaries[code] = values;
  }

  return dictionaries;
}

/**
 * Compare the {placeholders} of every key across the four languages.
 *
 * WHY THIS IS NOT COVERED BY THE KEY COMPARISON ABOVE
 *   That check proves a key exists everywhere; this one proves the value still
 *   USES it. A translation that drops `{count}` renders a sentence with the
 *   number missing, and one that invents `{qty}` prints "{qty}" on the page -
 *   both are invisible to a key-set comparison and to a translator reading one
 *   language at a time. The reference language is CODES[0], the same reference
 *   the key comparison uses.
 */
function checkPlaceholders(name, dictionaries) {
  const reference = dictionaries[CODES[0]] ?? new Map();
  const problems = [];

  for (const [key, text] of reference) {
    const want = placeholders(text);
    const badReference = unusableBraces(text);
    if (badReference.length) {
      problems.push(`${CODES[0]} ${key}: ${badReference.join(', ')} is not a usable placeholder`);
    }
    if (want.length === 0) continue;

    for (const code of CODES) {
      if (code === CODES[0]) continue;
      const value = dictionaries[code]?.get(key);
      if (value === undefined) continue; // the key comparison above already reports this

      const got = placeholders(value);
      if (got.join(',') !== want.join(',')) {
        problems.push(
          `${code} ${key}: ${CODES[0]} has ${want.map((p) => `{${p}}`).join(' ')} but ${code} has ${got.map((p) => `{${p}}`).join(' ') || 'none'}`
        );
      }
      const bad = unusableBraces(value);
      if (bad.length) problems.push(`${code} ${key}: ${bad.join(', ')} is not a usable placeholder`);
    }
  }

  check(
    `${name} dictionary: every language fills the same {placeholders}`,
    problems.length === 0,
    problems.slice(0, 6).join('; ')
  );
}

/** Compare the four languages of one dictionary and report the gaps. */
function checkDictionary(name, file, requested, requestedLabel) {
  console.log('');
  console.log(`${name} dictionary`);
  console.log('-'.repeat(name.length + 10));

  const source = fs.readFileSync(file, 'utf8');
  const dictionaries = parseDictionaries(source);

  check(
    'all four languages are present',
    CODES.every((code) => (dictionaries[code]?.size ?? 0) > 0),
    CODES.map((code) => `${code}: ${dictionaries[code]?.size ?? 0} keys`).join(', ')
  );

  const reference = dictionaries[CODES[0]] ?? new Set();
  const uneven = CODES.filter((code) => {
    const keys = dictionaries[code] ?? new Set();
    return keys.size !== reference.size || [...reference].some((key) => !keys.has(key));
  });

  check(
    'every language defines the same keys',
    uneven.length === 0,
    uneven
      .map((code) => {
        const keys = dictionaries[code] ?? new Set();
        const missing = [...reference].filter((key) => !keys.has(key));
        return `${code} is missing ${missing.length}: ${missing.slice(0, 4).join(', ')}`;
      })
      .join('; ')
  );

  const missing = [...requested].filter(([key]) => !reference.has(key));
  check(
    `every key the ${requestedLabel} code asks for exists`,
    missing.length === 0,
    missing.map(([key, where]) => `${key} (in ${where})`).join('; ')
  );

  checkPlaceholders(name, parseDictionaryValues(source));
}

/* ===================================================================== */

checkDictionary(
  'Client-side',
  path.join(SHARED_I18N, 'client-translations.ts'),
  // The shared library also renders client-side text (error messages, for example).
  collectRequestedKeys([CLIENT, path.join(ROOT, 'shared', 'src')]),
  'client'
);

checkDictionary(
  'Admin-side',
  path.join(SHARED_I18N, 'admin-translations.ts'),
  collectRequestedKeys([ADMIN]),
  'admin'
);

/* ===================================================================== */

console.log('');
console.log('Cross-cutting');
console.log('-------------');

// Both websites must share the language storage key, or choosing a language on
// one would not carry over to the other.
const translationService = fs.readFileSync(
  path.join(ROOT, 'shared', 'src', 'i18n', 'translation.service.ts'),
  'utf8'
);
check(
  'the language choice is stored under one shared key',
  translationService.includes('storageKeys.language') && translationService.includes('APP_CONFIG'),
  'both applications use APP_CONFIG.storageKeys.language'
);

// The third check: the words themselves. It belongs here rather than in the two
// dictionary sections above because it is about BOTH applications' templates at
// once, and because a literal in either one is the same defect.
runTemplateLiteralCheck(check);

/* ===================================================================== */

const failed = results.filter((entry) => !entry.ok);

console.log('');
console.log('==========================================================');
if (failed.length === 0) {
  console.log(`  ${results.length} checks passed`);
} else {
  console.log(`  ${results.length - failed.length} passed, ${failed.length} failed`);
  for (const entry of failed) console.log(`    FAIL  ${entry.label}`);
}
console.log('==========================================================');

process.exit(failed.length === 0 ? 0 : 1);
