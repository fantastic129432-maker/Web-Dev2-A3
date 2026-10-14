/**
 * tools/generate-i18n-data.mjs
 * ---------------------------------------------------------------------------
 * Regenerate the TypeScript dictionaries in shared/src/i18n from the archived
 * vanilla frontend in legacy/clientside.
 *
 * WHY A GENERATOR RATHER THAN A HAND COPY
 *   The two dictionaries are ~130 KB of Chinese, Vietnamese and Japanese text.
 *   Retyping or reformatting that by hand is how translations get silently
 *   corrupted (a mis-decoded byte, a dropped key, an escaped quote). This script
 *   reads the ORIGINAL modules and writes them out again, so the text is copied
 *   byte for byte and the migration cannot lose a string.
 *
 * WHERE THE DATA COMES FROM
 *   legacy/clientside/js/translations.js
 *       an ES module, so it is imported directly. Exports SUPPORTED_LANGUAGES,
 *       DICTIONARIES, DEFAULT_LANGUAGE.
 *   legacy/clientside/admin/js/admin-i18n.js
 *       the dictionaries are module-private, so the object-literal region is
 *       extracted from the source text and evaluated in a vm sandbox. Only this
 *       project's own file is ever evaluated.
 *
 * Run:  node tools/generate-i18n-data.mjs
 *       node tools/generate-i18n-data.mjs --check    fail if output differs
 *       node tools/generate-i18n-data.mjs --force    overwrite existing files
 *
 * THIS SCRIPT REFUSES TO OVERWRITE BY DEFAULT.
 *   It ran once, when the frontend moved to Angular, and the TypeScript files it
 *   produced are now the source of truth - they have since gained keys that the
 *   archived vanilla dictionaries never had. Re-running it without --force would
 *   silently discard those keys, so it stops and says so instead. Use --force only
 *   if you really do want to reset the dictionaries to the archived text.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const LEGACY = path.join(ROOT, 'legacy', 'clientside');
const OUT_DIR = path.join(ROOT, 'shared', 'src', 'i18n');
const CHECK_ONLY = process.argv.includes('--check');
const FORCE = process.argv.includes('--force');

const GENERATED_FILES = [
  'shared/src/i18n/languages.ts',
  'shared/src/i18n/client-translations.ts',
  'shared/src/i18n/admin-translations.ts',
];

if (!CHECK_ONLY && !FORCE) {
  const alreadyThere = GENERATED_FILES.filter((file) => fs.existsSync(path.join(ROOT, file)));
  if (alreadyThere.length > 0) {
    console.error('Refusing to overwrite existing dictionaries.\n');
    console.error('These files are the source of truth now and contain keys added since the');
    console.error('migration, which the archived vanilla text does not have:\n');
    for (const file of alreadyThere) console.error(`  ${file}`);
    console.error('\nNothing was written. Pass --force to reset them from legacy/clientside,');
    console.error('or use --check to verify the current files against the archived text.');
    process.exit(1);
  }
}

/* ------------------------------------------------------------------ sources */

/** The client-side dictionary module, imported exactly as the browser did. */
async function readClientSource() {
  const file = path.join(LEGACY, 'js', 'translations.js');
  const module = await import(pathToFileURL(file).href);
  return {
    languages: module.SUPPORTED_LANGUAGES,
    dictionaries: module.DICTIONARIES,
    defaultLanguage: module.DEFAULT_LANGUAGE,
  };
}

/**
 * The admin dictionaries are not exported, so the `const en = {...}` ...
 * `const DICTIONARIES = { en, zh, vi, ja };` region is cut out and evaluated.
 * This is the project's own source file, read from disk, so evaluating it is
 * equivalent to reading a JSON file with a comment header.
 */
function readAdminDictionary() {
  const file = path.join(LEGACY, 'admin', 'js', 'admin-i18n.js');
  const source = fs.readFileSync(file, 'utf8');

  const start = source.indexOf('const en = {');
  const marker = 'const DICTIONARIES = { en, zh, vi, ja };';
  const end = source.indexOf(marker);
  if (start === -1 || end === -1) {
    throw new Error(`Could not locate the dictionary region in ${file}`);
  }

  const region = source.slice(start, end + marker.length);
  const sandbox = vm.createContext({});
  return vm.runInContext(`${region}\nDICTIONARIES`, sandbox, { filename: file });
}

/* ------------------------------------------------------------------ helpers */

/** A JavaScript string literal that is always valid TypeScript. */
function quote(value) {
  return JSON.stringify(value);
}

/** Render one dictionary as a stable, readable object literal. */
function renderDictionary(dictionary) {
  const keys = Object.keys(dictionary).sort();
  const lines = keys.map((key) => `    ${quote(key)}: ${quote(dictionary[key])},`);
  return `{\n${lines.join('\n')}\n  }`;
}

/**
 * Report any key that is not present in every language.
 *
 * The dictionaries are flat and parallel on purpose: a missing key falls back to
 * English, so a gap is invisible at runtime but very visible to a marker. This
 * turns that into a build-time warning.
 */
function keyReport(dictionaries) {
  const codes = Object.keys(dictionaries);
  const reference = new Set(Object.keys(dictionaries[codes[0]]));
  const problems = [];

  for (const code of codes) {
    const keys = new Set(Object.keys(dictionaries[code]));
    const missing = [...reference].filter((key) => !keys.has(key));
    const extra = [...keys].filter((key) => !reference.has(key));
    if (missing.length) problems.push(`${code}: ${missing.length} missing (e.g. ${missing.slice(0, 3).join(', ')})`);
    if (extra.length) problems.push(`${code}: ${extra.length} extra (e.g. ${extra.slice(0, 3).join(', ')})`);
  }

  return { total: reference.size, problems };
}

/** Write a file, or in --check mode confirm it already matches. */
function emit(relativePath, contents, written) {
  const target = path.join(ROOT, relativePath);
  const existing = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
  const normalised = contents.replace(/\r\n/g, '\n');
  const current = existing === null ? null : existing.replace(/\r\n/g, '\n');

  if (CHECK_ONLY) {
    if (current !== normalised) {
      written.push({ relativePath, status: 'STALE' });
    } else {
      written.push({ relativePath, status: 'ok' });
    }
    return;
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, normalised, 'utf8');
  written.push({ relativePath, status: current === normalised ? 'unchanged' : 'written' });
}

/* --------------------------------------------------------------------- main */

const HEADER = `/*
 * MIGRATED FROM the archived vanilla frontend during the Angular migration, by
 * tools/generate-i18n-data.mjs. The text was copied byte for byte so no
 * translation could be corrupted on the way over.
 *
 * THIS FILE IS NOW THE SOURCE OF TRUTH. Edit the strings here.
 * Add a new key to EVERY language block, keeping the four key sets identical -
 * tools/check-translations.mjs fails the build if they diverge. Re-running the
 * generator would overwrite your edits; it exists to document and reproduce the
 * one-off migration, not to be run again.
 */
`;

async function main() {
  const client = await readClientSource();
  const adminDictionaries = readAdminDictionary();

  const clientReport = keyReport(client.dictionaries);
  const adminReport = keyReport(adminDictionaries);

  const written = [];

  /* 1. The language list and its types. */
  const languageLines = client.languages
    .map(
      (language) =>
        `  { code: ${quote(language.code)}, label: ${quote(language.label)}, ` +
        `nativeLabel: ${quote(language.nativeLabel)}, htmlLang: ${quote(language.htmlLang)} },`
    )
    .join('\n');

  emit(
    'shared/src/i18n/languages.ts',
    `${HEADER}
import type { LanguageInfo } from './language.model';

/**
 * The language codes the switchers offer, as a literal union so a typo in a
 * translation lookup is a compile error rather than a blank label.
 */
export const LANGUAGE_CODES = [${client.languages.map((l) => quote(l.code)).join(', ')}] as const;

export type LanguageCode = (typeof LANGUAGE_CODES)[number];

/** The languages offered, in the order the switcher lists them. */
export const SUPPORTED_LANGUAGES: readonly LanguageInfo<LanguageCode>[] = [
${languageLines}
];

/** Used when nothing is stored and the browser expresses no preference. */
export const DEFAULT_LANGUAGE: LanguageCode = ${quote(client.defaultLanguage)};
`,
    written
  );

  /* 2. The client-side dictionary. */
  emit(
    'shared/src/i18n/client-translations.ts',
    `${HEADER}
import type { Dictionaries } from './language.model';
import type { LanguageCode } from './languages';

/**
 * Every string the CLIENT-SIDE website shows, one flat key/value map per
 * language. Run \`npm run check:translations\` for the current key count, and for a
 * check that all four languages define exactly the same keys.
 *
 * Scope note carried over from the original file: this translates the INTERFACE
 * only. Event names, descriptions and venue names come from the database in
 * English, because the brief defines the data layer in English and a translated
 * content layer would need extra columns or a translation table.
 *
 * Key groups: nav.* common.* home.* search.* event.* card.* state.* error.*
 * a11y.* settings.* weather.*
 */
export const CLIENT_DICTIONARIES: Dictionaries<LanguageCode> = {
  en: ${renderDictionary(client.dictionaries.en)},
  zh: ${renderDictionary(client.dictionaries.zh)},
  vi: ${renderDictionary(client.dictionaries.vi)},
  ja: ${renderDictionary(client.dictionaries.ja)},
};
`,
    written
  );

  /* 3. The admin-side dictionary. */
  emit(
    'shared/src/i18n/admin-translations.ts',
    `${HEADER}
import type { Dictionaries } from './language.model';
import type { LanguageCode } from './languages';

/**
 * Every string the ADMIN-SIDE website shows. Run \`npm run check:translations\`
 * for the current key count, and for a check that all four languages define
 * exactly the same keys.
 *
 * The two sites keep separate dictionaries on purpose. The public site's
 * dictionary is about a visitor's journey (browsing, searching, registering);
 * this one is about staff work (editing events, reading registrations). Very few
 * strings are genuinely shared, and merging them would produce one large file
 * where neither audience can see its own wording.
 */
export const ADMIN_DICTIONARIES: Dictionaries<LanguageCode> = {
  en: ${renderDictionary(adminDictionaries.en)},
  zh: ${renderDictionary(adminDictionaries.zh)},
  vi: ${renderDictionary(adminDictionaries.vi)},
  ja: ${renderDictionary(adminDictionaries.ja)},
};
`,
    written
  );

  /* ----------------------------------------------------------------- report */
  for (const entry of written) {
    const marker = entry.status === 'STALE' ? 'STALE  ' : 'ok     ';
    console.log(`  ${CHECK_ONLY ? marker : ''}${entry.relativePath} (${entry.status})`);
  }

  console.log('');
  console.log(`  client dictionary : ${clientReport.total} keys per language`);
  console.log(`  admin dictionary  : ${adminReport.total} keys per language`);

  const problems = [...clientReport.problems, ...adminReport.problems];
  if (problems.length) {
    console.log('');
    console.log('  Language key mismatches:');
    for (const problem of problems) console.log(`    - ${problem}`);
  }

  if (CHECK_ONLY && written.some((entry) => entry.status === 'STALE')) {
    console.error('\nGenerated i18n files are out of date. Run: node tools/generate-i18n-data.mjs');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Failed to generate the i18n dictionaries:', error);
  process.exit(1);
});
