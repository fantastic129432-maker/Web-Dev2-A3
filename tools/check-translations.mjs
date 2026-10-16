/**
 * tools/check-translations.mjs
 * ---------------------------------------------------------------------------
 * Six checks that a language switcher can only be as good as. Four of them run
 * twice, once per dictionary, which is why the run prints twelve results:
 *
 *   1. PRESENCE - all four language blocks are there at all. A block that went
 *      missing would otherwise show English for every key it should answer.
 *
 *   2. SAME KEYS - the four dictionaries of a website define exactly the same
 *      keys. A missing key silently falls back to English, so without this check
 *      a half-translated label is invisible until a marker switches language.
 *
 *   3. USAGE - every key a template or component asks for actually exists. A typo
 *      in `t('nav.hom')` renders "nav.hom" on the page. That is easy to introduce
 *      during a migration and impossible to spot by reading 300 keys.
 *
 *   4. WORDS INSIDE A VALUE - no English word is left inside a Chinese,
 *      Vietnamese or Japanese string. Checks 1 to 3 are statements about keys, so
 *      `"home.statUpcoming": "已发布的 upcoming 活动"` passed every one of them:
 *      the key exists in all four languages, the template asks for it, and the
 *      value is in the dictionary where it belongs. Only reading the VALUE sees
 *      the English word in the middle of the Chinese sentence. The scan and its
 *      allow-list live further down this file; a word that has to stay in Latin
 *      letters is listed there by name with its reason, and an entry that stops
 *      matching fails, so the list cannot rot.
 *
 *   5. LITERALS IN TEMPLATES - two rules about what a template may render. First,
 *      no user-facing word is written into it: a template that asks for no key
 *      satisfies checks 1 to 3 while staying English in every language
 *      (`<h2>About this event</h2>`, `aria-label="Breadcrumb"`). Second, no
 *      dictionary key may be offered as the FALLBACK for a value that can win -
 *      `{{ organization()?.mission || ('about.mission' | t) }}`. The second rule
 *      is the one that reads the reported defect back: every word in that
 *      expression is a key, so every other check passed it, while the API's
 *      English content took the screen whenever the request succeeded and the
 *      translated sentence was left for the failure case. Both scans live in
 *      tools/check-template-literals.mjs, next to the lists they need.
 *
 *   6. LITERALS IN TYPESCRIPT - no user-facing English word is written into a
 *      `.ts` file either. This is the gap that let the same defect through twice:
 *      a sentence in a component, a service or a route definition is in no
 *      template and in no dictionary, so checks 1 to 5 all pass while the page
 *      shows English. It is the check that found the public site's route titles
 *      (`title: 'Search charity events | Unity Heart Foundation'`, applied by the
 *      router AFTER the page had set the translated one) and the two English
 *      ApiError fallbacks that could reach a 404 banner. The scan, its allow-list
 *      and its stated limits live in tools/check-ts-literals.mjs.
 *
 * WHAT NO CHECK HERE CAN SEE, AND WHY IT IS WRITTEN DOWN
 *   The API's content layer is English by design: organisation names and missions,
 *   event names, venues, cities, article text, and the API's own error wording all
 *   arrive in English, so a sentence that comes over HTTP is not a missing
 *   dictionary key. Check 6 therefore fails on the CODE that binds such a field to
 *   a page - it found `organization()?.mission || ('about.mission' | t)` on the
 *   home page, where the API's English `mission` won whenever the request
 *   succeeded - and the fix is to stop rendering a translated-looking slot from a
 *   content field rather than to translate the database. There is no mechanical
 *   check for a field that SHOULD have been site copy; that judgement is a
 *   person's, and this comment is where it is recorded.
 *
 * The dictionaries moved to TypeScript
 * (shared/src/i18n/client-translations.ts and admin-translations.ts) when the
 * frontend became Angular, so this checker parses those files instead of the old
 * vanilla clientside/js/translations.js. The parsing is deliberately tolerant of
 * formatting - it looks for `code: {` blocks and quoted keys - because people
 * edit these files by hand.
 *
 * The archived vanilla dictionaries under legacy/clientside/ are NOT scanned:
 * they are the migration record, which is why they still contain the two mixed
 * values this checker was written to catch. Editing them would falsify the
 * record of what was migrated.
 *
 * Run:  node tools/check-translations.mjs
 *       npm run check:translations
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runTemplateLiteralCheck } from './check-template-literals.mjs';
import { runTsLiteralCheck } from './check-ts-literals.mjs';

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

/* ------------------------------------------------------------------ */

/**
 * ENGLISH WORDS INSIDE A TRANSLATION - the kind of defect this checker was
 * missing.
 *
 * WHY THE OTHER CHECKS CANNOT SEE THIS
 *   Completeness, key usage and placeholders are all statements about KEYS, or
 *   about the {names} inside one value. The value
 *
 *     "home.statUpcoming": "已发布的 upcoming 活动"
 *
 *   defines the key, uses no placeholder, and is asked for by the template, so
 *   every other check passed while a Chinese page showed an English word in the
 *   middle of a Chinese sentence. The template-literal check cannot see it
 *   either - the template asked for a key, honestly, and the words ARE in the
 *   dictionary. Only reading the VALUE finds this, which is what this check does.
 *
 * WHAT IT CHECKS
 *   Every value of every language except the reference language (`en`), in both
 *   dictionaries:
 *     * zh and ja do not spell words in Latin letters, so ANY Latin word left in
 *       one of their values is reported;
 *     * vi IS written in the Latin alphabet, so a Latin word is reported only
 *       when the English dictionaries themselves use that word - the vocabulary
 *       a half-translated value would be quoting. A Vietnamese syllable that
 *       looks like an English function word (`do`) is allow-listed by name
 *       below; `to` never becomes a token at all, because the tokenizer keeps
 *       `toạ` and `Toàn` whole (see latinWords()).
 *   The mirror case is checked too: a CJK character inside an `en` value.
 *
 * WHAT IS NOT REPORTED
 *   Placeholders (`{count}`), e-mail addresses and URLs are removed before the
 *   words are read: they are format examples, and the translator's job is to keep
 *   them, not to translate them. Everything else that has to stay in Latin
 *   letters is listed BY NAME below with its reason, exactly like the template
 *   exemption list in tools/check-template-literals.mjs - and an entry that stops
 *   matching FAILS, so the list cannot rot into a set of excuses.
 *
 * WHAT IT CANNOT CHECK (its limits, stated on purpose)
 *   * A WORD THAT EXISTS IN BOTH LANGUAGES. `email`, `gala` and `menu` are
 *     Vietnamese loanwords and English words at once, `web` is a loanword in all
 *     three target languages, and `do` is a Vietnamese word spelled like an
 *     English verb; all five are allow-listed, so a defect whose ONLY English
 *     word was one of them would pass.
 *   * A TRANSLITERATION. A Japanese カタカナ rendering of an English word is not
 *     Latin script, so nothing here can tell it from a real translation.
 *   * A NAME THE PROJECT DECIDES TO KEEP. This check cannot know that `PROG2002`
 *     is a course code and `Lismore` a town; the allow-list records that decision
 *     instead of guessing at it.
 *   * A WORD NO ENGLISH VALUE EVER USES, in vi only. The vi rule needs an English
 *     vocabulary to compare against and builds it from the `en` values, so a
 *     stray English word that appears in no English string is invisible to it.
 *     zh and ja do not have this limit: any Latin word is reported there.
 *   * CASE. Allow-list matching ignores case, so `Web` and `web` share one entry.
 *   * A DEFECT PRESENT IN ALL FOUR LANGUAGES. If a key is wrong in the same way
 *     in en as well, this check has no reference to measure against; it compares
 *     each translation with the English words, not with English SENSE.
 */
const ENGLISH_ALLOWED_IN_A_TRANSLATION = [
  // -- acronyms the three target languages genuinely write as they are --------
  {
    value: 'API',
    why: 'The interface/programming acronym, written API in Chinese, Vietnamese and Japanese technical prose alike; the dictionaries translate the words around it (API 正在运行, API に接続できません), not the acronym.',
  },
  {
    value: 'ID',
    why: 'The identifier column heading. Chinese and Japanese admin tables use ID for a primary key exactly as English does; an invented translation would be less clear than the acronym the database itself uses.',
  },
  {
    value: 'AUD',
    why: 'The ISO 4217 currency code on the fundraising amount labels. A currency code is a value, not a word - the same reason the project keeps the $ symbol rather than writing "Australian dollars" in four languages.',
  },
  // -- format examples -------------------------------------------------------
  {
    value: 'A-Z',
    why: 'A sort-order example in the "name (A-Z)" option. It names the collation, not a word: the Chinese, Vietnamese and Japanese option labels all read "name (A-Z)" because that is what the list will do.',
  },
  {
    value: 'Z-A',
    why: 'The mirror image of A-Z, for the descending sort option, for the same reason.',
  },
  // -- proper nouns and brands ----------------------------------------------
  {
    value: 'PROG2002',
    why: "The unit code of the course this project is an assessment for. A course code is a proper noun - it is written PROG2002 on the syllabus, in the README and in the marked submission.",
  },
  {
    value: 'Web',
    why: 'The World Wide Web, written in Latin letters inside the course title "PROG2002 Web Development II". Chinese (Web 开发), Japanese (Web開発) and Vietnamese (Phát triển Web) all keep the borrowed name for the Web itself.',
  },
  {
    value: 'II',
    why: 'The roman numeral in the same course title, "Web Development II". It is part of the course name, not a word, and every language block keeps it so the title matches the syllabus.',
  },
  {
    value: 'Open-Meteo',
    why: 'The weather API provider, named in weather.lead. A brand is not translated - the same decision as the organisation name in the footer.',
  },
  {
    value: 'Open-Meteo.com',
    why: "The provider's domain in the weather attribution line. A domain is an address, like the organisation's email address in the footer, and a translated one would not resolve.",
  },
  {
    value: 'Lis',
    why: 'The first letters of Lismore, typed into the city search box as the example query in search.cityPlaceholder. It is a proper noun used as a format example: a visitor types a place name, whatever language the interface is in.',
  },
  {
    value: 'Lismore',
    why: "The office town in the contact details. Place names are proper nouns and are kept in the country's own spelling; zh and ja transliterate it (利斯莫尔 / リズモア) while vi keeps the Latin spelling, which is correct Vietnamese usage.",
  },
  {
    value: 'New South Wales',
    why: 'The Australian state in the same address line, as a phrase so that the individual words New, South and Wales are never exempt on their own - allow-listing "New" by itself would hide a real defect.',
  },
  // -- Vietnamese words and loanwords that collide with English --------------
  {
    value: 'do',
    only: ['vi'],
    why: 'The Vietnamese preposition "do" (by, from, because of), which is spelled without a diacritic and therefore looks exactly like the English verb. It is Vietnamese, not untranslated English.',
  },
  {
    value: 'email',
    only: ['vi'],
    why: 'A Vietnamese loanword in everyday use (thư điện tử is the formal alternative, and the dictionaries use "email" the way Vietnamese websites do).',
  },
  {
    value: 'gala',
    only: ['vi'],
    why: 'A Vietnamese loanword, as in "tiệc gala". It names a kind of event rather than wording, so it is kept.',
  },
  {
    value: 'menu',
    only: ['vi'],
    why: 'A Vietnamese loanword in interface language ("menu điều hướng"). Vietnamese software uses menu far more often than the native trình đơn.',
  },
  {
    value: 'Nguyễn Văn An',
    only: ['vi'],
    why: 'The example name in the registration form placeholder, as a phrase so that "An" alone is never exempt. A Vietnamese example name must be Vietnamese - and the English placeholder uses a different example name.',
  },
];

/** Escape a literal so it can be used inside a RegExp. */
function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Remove what a translator is told to KEEP, so that only translatable words are
 * left to judge: {placeholders}, e-mail addresses and URLs.
 *
 * These are the three exemptions the check can make mechanically, and it makes
 * them here rather than in the allow-list because none of them is a decision
 * about a specific word: `{count}` is a substitution, an address is an address.
 */
function stripFormatExamples(text) {
  return text
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ');
}

/**
 * The Latin words in a value.
 *
 * The token pattern is Unicode-aware so that a Vietnamese word is ONE token:
 * `Toàn` must not be split into `To` + `n`, because `To` would then look like an
 * English word. A token is kept only when it is entirely ASCII, so a word that
 * only contains non-Latin letters (网络, イベント, điều) is not a candidate.
 * Digits are part of a word (PROG2002 is one token) but a token has to START
 * with a letter, which is what keeps dates and times (2026-10-01, 9:00) out.
 * One-letter tokens are not words, so they are dropped - that is what lets the
 * multiplication sign in `{quantity} x {price}` stay as it is.
 */
function latinWords(text) {
  const words = [];
  for (const match of text.matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’.+-]*/gu)) {
    const word = match[0].replace(/[.'’+-]+$/, '');
    if (/^[A-Za-z][A-Za-z0-9'’-]*(?:\.[A-Za-z0-9'’-]+)*$/.test(word) && word.length >= 2) {
      words.push(word);
    }
  }
  return words;
}

/**
 * Remove the allow-listed words and phrases from one value, recording which
 * entries matched so that a stale one can be reported.
 *
 * The entries are tried LONGEST FIRST. `Open-Meteo.com` has to be consumed
 * before `Open-Meteo`, or the shorter entry would eat the brand and leave a bare
 * `.com` behind - which the word scan would then report as an English word, and
 * which would make the longer entry look unused. Sorting here rather than
 * demanding a hand-kept order in the list means the list can be edited in any
 * order without changing the result.
 */
function stripAllowedWords(text, code, used) {
  let remaining = text;
  const longestFirst = [...ENGLISH_ALLOWED_IN_A_TRANSLATION].sort(
    (a, b) => b.value.length - a.value.length
  );
  for (const entry of longestFirst) {
    if (entry.only && !entry.only.includes(code)) continue;
    const pattern = new RegExp(`\\b${escapeRegExp(entry.value)}\\b`, 'giu');
    if (!pattern.test(remaining)) continue;
    used.add(entry);
    remaining = remaining.replace(pattern, ' ');
  }
  return remaining;
}

/** Chinese characters and Japanese kana - never part of an English string. */
const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/u;

/**
 * Report every English word left inside a translation, then register the result
 * as one check in the caller's list.
 *
 * @param dictionariesByFile - One parsed dictionary map per dictionary file.
 */
function checkWordsInsideTranslations(dictionariesByFile) {
  // The English vocabulary to compare Vietnamese against: every word the
  // English dictionaries use. Built from BOTH files, because a word may be
  // introduced on one site and left untranslated on the other.
  const englishWords = new Set();
  for (const dictionaries of Object.values(dictionariesByFile)) {
    for (const value of dictionaries[CODES[0]]?.values() ?? []) {
      for (const word of latinWords(stripFormatExamples(value))) {
        englishWords.add(word.toLowerCase());
      }
    }
  }

  const problems = [];
  const used = new Set();

  for (const [file, dictionaries] of Object.entries(dictionariesByFile)) {
    for (const code of CODES.slice(1)) {
      for (const [key, value] of dictionaries[code] ?? new Map()) {
        const remaining = stripAllowedWords(stripFormatExamples(value), code, used);
        for (const word of latinWords(remaining)) {
          // zh and ja never spell a word in Latin letters; vi does, so there only
          // a word the English dictionaries themselves use is suspicious.
          const suspicious = code !== 'vi' || englishWords.has(word.toLowerCase());
          if (suspicious) problems.push({ file, code, key, value, word });
        }
      }
    }
  }

  // The mirror case: a Chinese or Japanese string inside an English value.
  for (const [file, dictionaries] of Object.entries(dictionariesByFile)) {
    for (const [key, value] of dictionaries[CODES[0]] ?? new Map()) {
      if (CJK.test(value)) problems.push({ file, code: CODES[0], key, value, word: 'CJK text' });
    }
  }

  const unused = ENGLISH_ALLOWED_IN_A_TRANSLATION.filter((entry) => !used.has(entry));
  // Printed in the order the list declares them, not in match order, so the
  // report reads like the decision record it is.
  const matched = ENGLISH_ALLOWED_IN_A_TRANSLATION.filter((entry) => used.has(entry));

  console.log('');
  console.log('Translated words');
  console.log('----------------');
  for (const problem of problems) {
    console.log(`          ${problem.code} ${problem.key} [${problem.word}] ${problem.value}`);
    console.log(`            in ${problem.file}`);
  }
  console.log(`          ${matched.length} allow-listed word(s), each with its reason:`);
  for (const entry of matched) {
    console.log(`            "${entry.value}"${entry.only ? ` (${entry.only.join(', ')} only)` : ''}`);
    console.log(`              why: ${entry.why}`);
  }
  for (const entry of unused) {
    console.log(`          STALE ALLOW-LIST ENTRY  "${entry.value}"`);
  }

  const detail =
    problems.length === 0 && unused.length === 0
      ? `${matched.length} allow-listed word(s) with a reason (listed above); no English word left in a zh, vi or ja value`
      : `${problems.length} English word(s) inside a translation, ${unused.length} stale allow-list entr(ies) - see the lines above`;

  check('no English word is left inside a zh, vi or ja translation', problems.length === 0 && unused.length === 0, detail);
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

// The fourth check: the words inside the values. It compares both dictionaries
// at once, because the allow-list and the English vocabulary it measures a
// Vietnamese value against are properties of the project, not of one file.
checkWordsInsideTranslations({
  'client-translations.ts': parseDictionaryValues(
    fs.readFileSync(path.join(SHARED_I18N, 'client-translations.ts'), 'utf8')
  ),
  'admin-translations.ts': parseDictionaryValues(
    fs.readFileSync(path.join(SHARED_I18N, 'admin-translations.ts'), 'utf8')
  ),
});

// The fifth check: the words themselves, in the templates. It belongs here
// rather than in the two dictionary sections above because it is about BOTH
// applications' templates at once, and because a literal in either one is the
// same defect.
runTemplateLiteralCheck(check);

// The sixth check: the words themselves, in TypeScript - the gap that let the
// same defect through twice, because a sentence written into a component, a
// service or a route definition is in no template and in no dictionary. A sibling
// file for the same reason as the template one: it needs its own allow-list, and
// its own account of what it cannot see.
runTsLiteralCheck(check);

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
