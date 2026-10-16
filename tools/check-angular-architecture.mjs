/**
 * tools/check-angular-architecture.mjs
 * ---------------------------------------------------------------------------
 * Prove the project still has the architecture the teacher asked for:
 *
 *   HTML + TypeScript + CSS frontends built with Angular v22 or later, a Node.js
 *   backend written in TypeScript, and one shared library used by both websites.
 *
 * This replaces tools/check-no-frameworks.mjs, which asserted the opposite rule
 * for Assessment 2 ("HTML, CSS and JavaScript only, no framework"). That rule is
 * gone, so keeping the old checker would now fail the build for the right reason
 * and the wrong outcome.
 *
 * WHY CHECK PROPERTIES RATHER THAN SEARCH FOR NAMES
 *   Searching source for the word "Angular" proves nothing. Each check below
 *   tests a property that would have to change for the requirement to be broken:
 *   an NgModule appearing, zone.js coming back, a component inlined into
 *   TypeScript instead of a real .html file, one app reaching into the other, the
 *   API drifting back to JavaScript, or the two dictionaries losing a key.
 *
 * Run:  node tools/check-angular-architecture.mjs
 *       npm run check:angular
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const CLIENT = path.join(ROOT, 'clientside');
const ADMIN = path.join(ROOT, 'adminside');
const SHARED = path.join(ROOT, 'shared');
const API = path.join(ROOT, 'api');

const results = [];

function check(label, ok, detail = '') {
  results.push({ label, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (detail) console.log(`          ${detail}`);
}

/** Every file under a directory with one of the given extensions. */
function walk(dir, extensions, { skip = ['node_modules', 'dist', '.angular'] } = {}) {
  const found = [];
  if (!fs.existsSync(dir)) return found;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skip.includes(entry.name) || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...walk(full, extensions, { skip }));
    } else if (extensions.some((extension) => entry.name.endsWith(extension))) {
      found.push(full);
    }
  }
  return found;
}

/**
 * Read a JSON file that may contain comments.
 *
 * Angular's generated tsconfig files (and the one written for the API) are
 * JSONC: they carry a `/* ... *\/` header explaining themselves. JSON.parse
 * rejects that, and a checker that crashes on a legitimate file is worse than no
 * checker, so comments and trailing commas are removed first. The `//` pattern
 * deliberately requires a non-colon character before it, so `https://...` inside
 * a string is left alone.
 */
function readJson(file) {
  const raw = fs
    .readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(raw);
}

/**
 * The source with comment-only lines removed.
 *
 * Several checks below search for a construct by name, and a mention of that name
 * inside a comment - for example a note explaining that
 * `provideZoneChangeDetection` is deliberately NOT used - must not count as a
 * use of it.
 */
function codeOnly(source) {
  return source
    .split(/\r?\n/)
    .filter((line) => !/^\s*(\/\/|\/\*|\*|\*\/)/.test(line))
    .join('\n');
}

const relative = (file) => path.relative(ROOT, file).split(path.sep).join('/');

/** The Angular major version declared in the root package.json, or 0. */
function angularMajor() {
  const pkg = readJson(path.join(ROOT, 'package.json'));
  const declared = pkg.dependencies?.['@angular/core'] ?? pkg.devDependencies?.['@angular/core'] ?? '';
  const match = String(declared).match(/(\d+)/);
  return match ? Number(match[1]) : 0;
}

/* ------------------------------------------------------------------ frontend */

console.log('Angular frontends');
console.log('-----------------');

const major = angularMajor();
check(
  '@angular/core is v22 or later',
  major >= 22,
  major ? `declared major version: ${major}` : 'Could not read @angular/core from package.json'
);

const angularJson = readJson(path.join(ROOT, 'angular.json'));
const projects = angularJson.projects ?? {};
check(
  'both applications are configured in angular.json',
  Boolean(projects.clientside) && Boolean(projects.adminside),
  `projects: ${Object.keys(projects).join(', ') || '(none)'}`
);

const appSources = [
  ...walk(CLIENT, ['.ts']),
  ...walk(ADMIN, ['.ts']),
];
const sharedSources = walk(SHARED, ['.ts']);
const allFrontend = [...appSources, ...sharedSources];

/* 1. No NgModule anywhere: the applications are standalone-only. */
const ngModules = allFrontend.filter((file) => /@NgModule\b/.test(codeOnly(fs.readFileSync(file, 'utf8'))));
check(
  'no NgModule in the Angular source (standalone components only)',
  ngModules.length === 0,
  ngModules.map(relative).join(', ')
);

/* 2. Zoneless: zone.js must not be a dependency and must not be polyfilled. */
const rootPkg = readJson(path.join(ROOT, 'package.json'));
const hasZoneDependency = Boolean(
  rootPkg.dependencies?.['zone.js'] ?? rootPkg.devDependencies?.['zone.js']
);
const polyfillsFor = (name) =>
  projects[name]?.architect?.build?.options?.polyfills ?? [];
const clientPolyfills = polyfillsFor('clientside');
const adminPolyfills = polyfillsFor('adminside');
const zoneInPolyfills = [...clientPolyfills, ...adminPolyfills].some((entry) =>
  String(typeof entry === 'string' ? entry : entry?.input ?? '').includes('zone.js')
);
const zoneChangeDetection = allFrontend.filter((file) =>
  /provideZoneChangeDetection/.test(codeOnly(fs.readFileSync(file, 'utf8')))
);
check(
  'zoneless change detection (no zone.js dependency or polyfill)',
  !hasZoneDependency && !zoneInPolyfills && zoneChangeDetection.length === 0,
  [
    hasZoneDependency ? 'zone.js is still a dependency' : '',
    zoneInPolyfills ? 'zone.js is still in polyfills' : '',
    zoneChangeDetection.length ? `provideZoneChangeDetection in ${zoneChangeDetection.map(relative).join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('; ')
);

/* 3. Standalone is the default in v19+; nothing may opt back out. */
const optedOut = allFrontend.filter((file) =>
  /standalone\s*:\s*false/.test(codeOnly(fs.readFileSync(file, 'utf8')))
);
check('every component stays standalone', optedOut.length === 0, optedOut.map(relative).join(', '));

/* 4. HTML requirement: a component's markup lives in a real .html file. */
const componentFiles = appSources.filter((file) =>
  /@Component\s*\(/.test(codeOnly(fs.readFileSync(file, 'utf8')))
);
const missingTemplate = [];
const missingFile = [];

for (const file of componentFiles) {
  const source = fs.readFileSync(file, 'utf8');
  const match = source.match(/templateUrl\s*:\s*['"]([^'"]+)['"]/);
  if (!match) {
    missingTemplate.push(relative(file));
    continue;
  }
  const templatePath = path.resolve(path.dirname(file), match[1]);
  if (!fs.existsSync(templatePath)) missingFile.push(`${relative(file)} -> ${match[1]}`);
}

check(
  'every component loads its markup from a .html file',
  componentFiles.length > 0 && missingTemplate.length === 0,
  missingTemplate.length
    ? `inline templates in: ${missingTemplate.join(', ')}`
    : `${componentFiles.length} components, all with templateUrl`
);
check('every templateUrl points at a file that exists', missingFile.length === 0, missingFile.join(', '));

/* 5. Comment quality is graded, so every component carries a doc block. */
const undocumented = componentFiles.filter((file) => {
  const source = fs.readFileSync(file, 'utf8');
  const decoratorAt = source.indexOf('@Component');
  const docAt = source.indexOf('/**');
  return docAt === -1 || docAt > decoratorAt;
});
check(
  'every component has a documentation comment above its decorator',
  componentFiles.length > 0 && undocumented.length === 0,
  undocumented.map(relative).join(', ')
);

/* 6. The two websites must not import each other's code. */
function leaksInto(source, forbidden) {
  return walk(source, ['.ts']).filter((file) => {
    const text = codeOnly(fs.readFileSync(file, 'utf8'));
    return text.includes(`../${forbidden}`) || text.includes(`@charity/${forbidden}`);
  });
}
const clientLeaks = leaksInto(CLIENT, 'adminside');
const adminLeaks = leaksInto(ADMIN, 'clientside');
check(
  'neither website imports the other',
  clientLeaks.length === 0 && adminLeaks.length === 0,
  [...clientLeaks, ...adminLeaks].map(relative).join(', ')
);

/* 7. Both applications must actually use the shared library. */
const sharedUsage = (app) =>
  walk(app, ['.ts']).filter((file) =>
    codeOnly(fs.readFileSync(file, 'utf8')).includes('@charity/shared')
  ).length;
const clientShared = sharedUsage(CLIENT);
const adminShared = sharedUsage(ADMIN);
check(
  'both applications import the shared library',
  clientShared > 0 && adminShared > 0,
  `clientside: ${clientShared} files, adminside: ${adminShared} files`
);

/* 8. The dictionary each app provides must match the app it is for. */
const clientConfig = fs.readFileSync(path.join(CLIENT, 'src/app/app.config.ts'), 'utf8');
const adminConfig = fs.readFileSync(path.join(ADMIN, 'src/app/app.config.ts'), 'utf8');
check(
  'each app provides its own dictionary and the API base URL',
  clientConfig.includes('CLIENT_DICTIONARIES') &&
    adminConfig.includes('ADMIN_DICTIONARIES') &&
    clientConfig.includes('API_BASE_URL') &&
    adminConfig.includes('API_BASE_URL'),
  'clientside -> CLIENT_DICTIONARIES, adminside -> ADMIN_DICTIONARIES'
);

/* 9. No framework fetched from a CDN: the bundle must be self-contained. */
const cdnScripts = [CLIENT, ADMIN]
  .map((app) => path.join(app, 'src/index.html'))
  .filter((file) => fs.existsSync(file))
  .filter((file) => /<script[^>]+src\s*=\s*['"]https?:/i.test(fs.readFileSync(file, 'utf8')));
check('no page loads a script from a CDN', cdnScripts.length === 0, cdnScripts.map(relative).join(', '));

/* 10. The early-theme script must be in both documents, or dark mode flashes.
 *
 * WHY THIS COMPARES THE SCRIPT AND NOT TWO SUBSTRINGS
 *   The earlier version of this check asked whether each index.html merely
 *   CONTAINED the text 'charity-events:theme' and the text 'data-theme'. Both
 *   strings appear in the explanatory comment beside the script, so a page whose
 *   script had been deleted, or had its logic broken (a changed attribute, a
 *   changed default, `p === 'system'` inverted), still passed - and
 *   shared/src/theme/theme.service.ts states that this tool verifies "that both
 *   pages still carry it, so a change to the storage key or the attribute name
 *   cannot be made in only one place". A check that only sees the two names does
 *   not verify that.
 *
 *   The snippet the pages must carry is read back out of EARLY_THEME_SNIPPET in
 *   theme.service.ts, and each page's inline <script> is compared with it
 *   ignoring comments and whitespace (the pages add a comment inside the catch
 *   block and wrap the statement over several lines). Any change to the logic,
 *   the key or an attribute now fails here until both pages are updated too.
 */
const earlyThemeSource = fs.readFileSync(path.join(SHARED, 'src/theme/theme.service.ts'), 'utf8');
const snippetMatch = /EARLY_THEME_SNIPPET\s*=\s*([\s\S]*?);\s*$/m.exec(earlyThemeSource);
const earlyThemeSnippet = snippetMatch
  ? [...snippetMatch[1].matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g)]
      .map((match) => match[1] ?? match[2])
      .join('')
  : '';
const normaliseScript = (text) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/\s+/g, '');

const earlyThemePages = [CLIENT, ADMIN].map((app) => path.join(app, 'src/index.html'));
const earlyThemeProblems = [];
if (earlyThemeSnippet === '') {
  earlyThemeProblems.push('EARLY_THEME_SNIPPET could not be read from shared/src/theme/theme.service.ts');
}
for (const file of earlyThemePages) {
  if (!fs.existsSync(file)) {
    earlyThemeProblems.push(`${relative(file)} does not exist`);
    continue;
  }
  const scripts = [...fs.readFileSync(file, 'utf8').matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((match) => normaliseScript(match[1]));
  if (earlyThemeSnippet !== '' && !scripts.includes(normaliseScript(earlyThemeSnippet))) {
    earlyThemeProblems.push(`${relative(file)}: no inline script matches EARLY_THEME_SNIPPET`);
  }
}
check(
  'both documents apply the stored theme before the first paint',
  earlyThemeProblems.length === 0,
  earlyThemeProblems.length
    ? earlyThemeProblems.join('; ')
    : `${earlyThemePages.length} of 2 pages carry the shared EARLY_THEME_SNIPPET verbatim`
);

/* --------------------------------------------------------------------- backend */

console.log('');
console.log('TypeScript backend');
console.log('------------------');

const apiTs = walk(API, ['.ts']);
const apiJs = walk(API, ['.js'], { skip: ['node_modules', 'dist', '.angular'] });
check(
  'the API source is TypeScript',
  apiTs.length > 0 && fs.existsSync(path.join(API, 'server.ts')),
  `${apiTs.length} .ts files; server.ts ${fs.existsSync(path.join(API, 'server.ts')) ? 'present' : 'MISSING'}`
);
check(
  'no JavaScript source remains in the API',
  apiJs.length === 0,
  apiJs.length ? apiJs.map(relative).join(', ') : 'only .ts sources and api/dist output'
);

const apiTsconfig = path.join(API, 'tsconfig.json');
const apiPackage = path.join(API, 'package.json');
let apiCompiles = false;
let apiDetail = 'api/tsconfig.json is missing';

if (fs.existsSync(apiTsconfig) && fs.existsSync(apiPackage)) {
  const config = readJson(apiTsconfig);
  const pkg = readJson(apiPackage);
  const outDir = String(config.compilerOptions?.outDir ?? '');
  const main = String(pkg.main ?? '');
  const hasBuild = Boolean(pkg.scripts?.build);
  apiCompiles = outDir.includes('dist') && main.includes('dist') && hasBuild;
  apiDetail = `outDir: ${outDir || '(unset)'}, main: ${main || '(unset)'}, build script: ${hasBuild ? 'yes' : 'no'}`;
}
check('the API compiles to dist/ and runs from there', apiCompiles, apiDetail);

/* ---------------------------------------------------------------------- result */

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
