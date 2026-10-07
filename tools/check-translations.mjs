/**
 * check-translations.mjs
 * ---------------------------------------------------------------------------
 * Verifies that the four dictionaries in clientside/js/translations.js cover
 * exactly the same keys, and that the markup only refers to keys that exist.
 *
 * A missing key is silent at run time - the fallback shows the English text, so
 * a half-translated page looks fine in English and broken in the other
 * languages. This check makes the gap impossible to miss.
 *
 * Usage: node tools/check-translations.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const CLIENT = path.resolve('clientside');
const TRANSLATIONS = path.join(CLIENT, 'js', 'translations.js');

/** Extract one `const <lang> = { ... };` block and list its keys. */
function keysFor(source, language) {
  const pattern = new RegExp(`const ${language} = \\{([\\s\\S]*?)\\n\\};`, 'm');
  const match = source.match(pattern);
  if (!match) return null;

  const keys = new Set();
  for (const line of match[1].matchAll(/^\s*'([^']+)':/gm)) keys.add(line[1]);
  return keys;
}

const source = fs.readFileSync(TRANSLATIONS, 'utf8');
const languages = ['en', 'zh', 'vi', 'ja'];
const dictionaries = {};

for (const language of languages) {
  dictionaries[language] = keysFor(source, language);
  if (!dictionaries[language]) {
    console.error(`could not read the "${language}" dictionary`);
    process.exit(1);
  }
}

const base = dictionaries.en;
let problems = 0;

console.log(`en: ${base.size} keys`);
for (const language of languages.filter((code) => code !== 'en')) {
  const keys = dictionaries[language];
  const missing = [...base].filter((key) => !keys.has(key));
  const extra = [...keys].filter((key) => !base.has(key));

  console.log(
    `${language}: ${keys.size} keys` +
      (missing.length ? `  MISSING ${missing.length}` : '') +
      (extra.length ? `  EXTRA ${extra.length}` : '')
  );

  if (missing.length) {
    problems += missing.length;
    for (const key of missing.slice(0, 12)) console.log(`    missing: ${key}`);
  }
  if (extra.length) {
    problems += extra.length;
    for (const key of extra.slice(0, 12)) console.log(`    extra: ${key}`);
  }
}

/**
 * Every key referenced from the markup or the code must exist, otherwise a page
 * would render the raw key instead of a sentence.
 */
const referenced = new Set();

for (const file of fs.readdirSync(CLIENT).filter((name) => name.endsWith('.html'))) {
  const html = fs.readFileSync(path.join(CLIENT, file), 'utf8');
  // Skip the theme-boot comment block when scanning attributes.
  for (const match of html.matchAll(/data-i18n="([^"]+)"/g)) referenced.add(match[1]);
  for (const match of html.matchAll(/data-i18n-attr="([^"]+)"/g)) {
    for (const pair of match[1].split(',')) {
      const key = pair.split(':')[1];
      if (key) referenced.add(key.trim());
    }
  }
}

for (const file of fs.readdirSync(path.join(CLIENT, 'js')).filter((n) => n.endsWith('.js'))) {
  if (file === 'translations.js') continue;
  const code = fs.readFileSync(path.join(CLIENT, 'js', file), 'utf8');
  for (const match of code.matchAll(/\bt\(\s*'([^']+)'/g)) referenced.add(match[1]);
}

const unknown = [...referenced].filter((key) => !base.has(key));
console.log(`\nkeys referenced by markup and code: ${referenced.size}`);
if (unknown.length) {
  problems += unknown.length;
  console.log(`UNKNOWN KEYS (${unknown.length}):`);
  for (const key of unknown) console.log(`  ${key}`);
} else {
  console.log('every referenced key exists');
}

console.log('');
if (problems > 0) {
  console.log(`${problems} problem(s) found.`);
  process.exit(1);
}
console.log('Translations are complete and consistent.');
