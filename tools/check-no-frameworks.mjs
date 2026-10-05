/**
 * tools/check-no-frameworks.mjs
 * ---------------------------------------------------------------------------
 * Prove the "HTML, CSS and JavaScript only" rule is still true.
 *
 * The brief permits Express on the server and nothing else: no CSS framework, no
 * JavaScript framework and no templating engine. A rule like that is easy to
 * state and easy to break by accident - one `import` from a CDN, one
 * `<link href="https://cdn...">`, one `res.render` - and the break is invisible
 * until someone reads the source closely.
 *
 * So this checks the properties that would have to change for a framework to
 * appear, rather than searching for framework names. Searching for names is
 * unreliable in both directions: it misses a framework nobody thought to list,
 * and it produces false alarms on ordinary words ("value" contains "vue",
 * "reactive" contains "react").
 *
 * The five properties:
 *
 *   1. The client loads its own files. Without a bundler the browser resolves
 *      every import itself, so a third-party package must appear as a bare
 *      specifier (`import x from 'some-package'`). Any bare specifier means a
 *      dependency reached the browser.
 *   2. Nothing is fetched from another origin. A CSS or JS framework added by
 *      CDN shows up as a <script src> or <link href> with a host in it, or as an
 *      @import in a stylesheet.
 *   3. The server renders nothing. `res.render`, a view engine setting, or a
 *      template-engine dependency all mean the pages are no longer plain HTML.
 *   4. The server's runtime dependencies are only Express and the database
 *      driver. Express is explicitly allowed; mysql2 is a driver, not a web
 *      framework.
 *   5. Every page is a complete HTML document, so no page is assembled from
 *      fragments at request time.
 *
 * Run:  node tools/check-no-frameworks.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const CLIENT = path.join(ROOT, 'clientside');
const API = path.join(ROOT, 'api');

const results = [];
function check(label, ok, detail = '') {
  results.push({ label, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (detail) console.log(`          ${detail}`);
}

/** Every file under a directory that ends with one of the given extensions. */
function walk(dir, extensions) {
  const found = [];
  if (!fs.existsSync(dir)) return found;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walk(full, extensions));
    else if (extensions.some((ext) => entry.name.endsWith(ext))) found.push(full);
  }
  return found;
}

/** Read a file, or return '' when it is not there. */
function read(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

const clientJs = walk(CLIENT, ['.js']);
const clientCss = walk(CLIENT, ['.css']);
const clientHtml = walk(CLIENT, ['.html']);

console.log(`\nInspecting ${clientHtml.length} pages, ${clientJs.length} scripts and ${clientCss.length} stylesheets.\n`);

/* ------------------------------------------------------------------ 1. imports */
console.log('1. The browser only loads files from this project');

const bareImports = [];

for (const file of clientJs) {
  const text = read(file);
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');

  /*
   * Static and dynamic imports. A specifier starting with '.' or '/' is a file
   * in this project; anything else is a package name, which the browser cannot
   * resolve on its own.
   */
  const specifiers = [
    ...text.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g),
    ...text.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g),
    ...text.matchAll(/\bimport\s+['"]([^'"]+)['"]/g),
  ].map((match) => match[1]);

  for (const specifier of specifiers) {
    if (specifier.startsWith('.') || specifier.startsWith('/')) continue;
    bareImports.push(`${rel}: ${specifier}`);
  }
}

check(
  'every import is a relative path inside this project',
  bareImports.length === 0,
  bareImports.slice(0, 8).join('\n          ')
);

/* ------------------------------------------------------------------ 2. origins */
console.log('\n2. Nothing is loaded from another origin');

const EXTERNAL = /(?:src|href)\s*=\s*["'](https?:)?\/\//i;
const externalRefs = [];

for (const file of [...clientHtml, ...clientCss]) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  read(file)
    .split('\n')
    .forEach((line, index) => {
      if (EXTERNAL.test(line)) externalRefs.push(`${rel}:${index + 1}  ${line.trim().slice(0, 80)}`);
      if (/@import\s+(?!url\(["']?\.)/.test(line) && /@import/.test(line)) {
        externalRefs.push(`${rel}:${index + 1}  ${line.trim().slice(0, 80)}`);
      }
    });
}

check(
  'no <script>/<link>/@import points at another host',
  externalRefs.length === 0,
  externalRefs.slice(0, 8).join('\n          ')
);

/* Note: the API base URL in js/config.js is a data endpoint, not a loaded
   resource, so it is deliberately not counted here. It is also unreachable as a
   script or stylesheet, because nothing loads it that way. */

/* ------------------------------------------------------------------ 3. rendering */
console.log('\n3. The server does not render pages');

const apiJs = [...walk(path.join(API, 'src'), ['.js']), path.join(API, 'server.js')];

const renderMarkers = [
  [/res\.render\s*\(/, 'res.render('],
  [/app\.set\(\s*['"]views?['"]/, "app.set('views')"],
  [/app\.set\(\s*['"]view engine['"]/, "app.set('view engine')"],
];

const renderHits = [];

for (const file of apiJs) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  read(file)
    .split('\n')
    .forEach((line, index) => {
      // A marker inside a comment is documentation, not behaviour.
      if (/^\s*(\*|\/\/|\/\*)/.test(line)) return;
      for (const [pattern, name] of renderMarkers) {
        if (pattern.test(line)) renderHits.push(`${rel}:${index + 1}  ${name}`);
      }
    });
}

check('no view engine and no res.render', renderHits.length === 0, renderHits.slice(0, 6).join('\n          '));

/* ------------------------------------------------------------------ 4. deps */
console.log('\n4. Server runtime dependencies');

const pkg = JSON.parse(read(path.join(API, 'package.json')) || '{}');
const deps = Object.keys(pkg.dependencies || {});
const devDeps = Object.keys(pkg.devDependencies || {});

console.log(`          dependencies: ${deps.join(', ') || '(none)'}`);
console.log(`          devDependencies: ${devDeps.join(', ') || '(none)'}`);

/** Express is allowed by the brief; mysql2 is a database driver. */
const ALLOWED = ['express', 'mysql2'];
const unexpected = deps.filter((name) => !ALLOWED.includes(name));

check(
  'only Express and the database driver are runtime dependencies',
  unexpected.length === 0,
  unexpected.length ? `unexpected: ${unexpected.join(', ')}` : ''
);

const TEMPLATE_ENGINES = ['ejs', 'pug', 'jade', 'hbs', 'handlebars', 'nunjucks', 'mustache', 'eta', 'liquidjs'];
const engines = deps.filter((name) => TEMPLATE_ENGINES.includes(name));

check('no template engine is installed', engines.length === 0, engines.join(', '));

/* ------------------------------------------------------------------ 5. documents */
console.log('\n5. Every page is a complete HTML document');

const incomplete = [];

for (const file of clientHtml) {
  const text = read(file);
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');

  const missing = [];
  if (!/^\s*<!DOCTYPE html>/i.test(text)) missing.push('doctype');
  if (!/<html\b/i.test(text)) missing.push('<html>');
  if (!/<head\b/i.test(text)) missing.push('<head>');
  if (!/<body\b/i.test(text)) missing.push('<body>');

  if (missing.length) incomplete.push(`${rel}: missing ${missing.join(', ')}`);
}

check(
  'each page is standalone HTML, not a fragment',
  incomplete.length === 0,
  incomplete.slice(0, 6).join('\n          ')
);

/* ------------------------------------------------------------------ report */
const failed = results.filter((result) => !result.ok);

console.log(`\n${'='.repeat(70)}`);
console.log(`${results.length} checks: ${results.length - failed.length} passed, ${failed.length} failed`);

if (failed.length) {
  console.log('\nFailed:');
  for (const item of failed) console.log(`  - ${item.label}`);
}
console.log('='.repeat(70));

process.exitCode = failed.length === 0 ? 0 : 1;
