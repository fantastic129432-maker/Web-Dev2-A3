/**
 * sync-theme-snippet.mjs
 * ---------------------------------------------------------------------------
 * Injects the early theme script into the <head> of every page.
 *
 * Why an inline script at all: the preferred theme is stored in localStorage,
 * which the page can only read once JavaScript runs. If that happened after the
 * stylesheet was applied, a visitor who chose dark would see a white flash on
 * every page load. The snippet runs before the first paint instead.
 *
 * Why it is generated: the snippet duplicates the storage key and the attribute
 * name used by js/theme.js. Keeping a single source (EARLY_THEME_SNIPPET in that
 * module) and writing it into the pages means the two cannot drift apart.
 *
 * Usage:
 *   node tools/sync-theme-snippet.mjs          write the snippet into the pages
 *   node tools/sync-theme-snippet.mjs --check   fail if a page is out of date
 */
import fs from 'node:fs';
import path from 'node:path';

const CLIENT = path.resolve('clientside');
const MARKER_START = '<!-- theme-boot -->';
const MARKER_END = '<!-- /theme-boot -->';
const CHECK_ONLY = process.argv.includes('--check');

/**
 * Every page that needs the snippet, discovered rather than listed.
 *
 * A hardcoded list is a page that can be forgotten: Assessment 3 added
 * registration.html and five admin pages, and a list would have silently kept
 * reporting "3 pages, up to date" while six pages had no theme boot at all - and
 * the failure mode is a white flash for a dark-theme visitor, which nobody
 * notices during marking. Walking the folder and looking for the markers means a
 * new page is covered the moment it is created, and the check also reports a
 * page that carries the stylesheet but no markers, which is the actual mistake.
 */
function findPages(directory) {
  const pages = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      pages.push(...findPages(full));
      continue;
    }
    if (!entry.name.endsWith('.html')) continue;
    const html = fs.readFileSync(full, 'utf8');
    // Only real pages: a fragment or a template has no stylesheet link.
    if (!html.includes('<link rel="stylesheet"')) continue;
    pages.push(path.relative(CLIENT, full).split(path.sep).join('/'));
  }
  return pages.sort();
}

const PAGES = findPages(CLIENT);

/**
 * The snippet must sit in a classic <script> BEFORE the first stylesheet link,
 * so the attribute is set before the browser paints. A page whose markers are
 * missing is reported rather than silently patched into the wrong place.
 */
const MISSING_MARKERS = [];

/** Read the snippet straight out of js/theme.js so there is one source. */
function readSnippet() {
  const source = fs.readFileSync(path.join(CLIENT, 'js', 'theme.js'), 'utf8');
  const match = source.match(/export const EARLY_THEME_SNIPPET\s*=\s*([\s\S]*?);\n/);
  if (!match) throw new Error('EARLY_THEME_SNIPPET was not found in js/theme.js');

  // The literal is a series of concatenated string literals; evaluate it.
  const expression = match[1].trim();
  // eslint-disable-next-line no-new-func
  return new Function(`return ${expression};`)();
}

const snippet = readSnippet();
const block = `${MARKER_START}\n  <script>${snippet}</script>\n  ${MARKER_END}`;

let problems = 0;

for (const page of PAGES) {
  const file = path.join(CLIENT, page);
  const html = fs.readFileSync(file, 'utf8');

  const hasBlock = html.includes(MARKER_START) && html.includes(MARKER_END);

  if (!hasBlock) {
    // Reported, never auto-inserted: guessing where the block belongs is how the
    // snippet ends up after the stylesheet, which reintroduces the flash it
    // exists to prevent.
    console.log(`  ${page}: MISSING the theme-boot markers`);
    problems += 1;
    continue;
  }

  const withBlock = html.replace(
    new RegExp(`${MARKER_START}[\\s\\S]*?${MARKER_END}`),
    block
  );

  // The block must come before the first stylesheet, or a dark-theme visitor
  // sees a white page until the stylesheet has loaded.
  const blockAt = withBlock.indexOf(MARKER_START);
  const styleAt = withBlock.indexOf('<link rel="stylesheet"');
  if (styleAt !== -1 && blockAt > styleAt) {
    console.log(`  ${page}: theme-boot appears AFTER the stylesheet`);
    problems += 1;
    continue;
  }

  if (withBlock === html) {
    console.log(`  ${page}: up to date`);
    continue;
  }

  if (CHECK_ONLY) {
    console.log(`  ${page}: OUT OF DATE - run node tools/sync-theme-snippet.mjs`);
    problems += 1;
    continue;
  }

  fs.writeFileSync(file, withBlock, 'utf8');
  console.log(`  ${page}: snippet written`);
}

console.log(`\n${PAGES.length} pages checked.`);

if (CHECK_ONLY && problems > 0) {
  console.error(`${problems} page(s) need attention.`);
  process.exit(1);
}
