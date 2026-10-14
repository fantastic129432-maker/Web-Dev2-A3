/**
 * tools/start-all.mjs
 * ---------------------------------------------------------------------------
 * Starts the whole PROG2002 A3 project from one terminal:
 *
 *   1. compiles the TypeScript API        (api/*.ts -> api/dist)
 *   2. makes sure both Angular applications are built
 *   3. starts the API                     http://localhost:3000
 *   4. serves the CLIENT website          http://localhost:4200
 *   5. serves the ADMIN website           http://localhost:4300
 *
 * Usage (from the project root):
 *   node tools/start-all.mjs               build if needed, then serve the builds
 *   node tools/start-all.mjs --rebuild     rebuild both applications first
 *   node tools/start-all.mjs --dev         use `ng serve` (live reload) instead
 *   node tools/start-all.mjs --no-browser  do not open the browser
 *
 * WHY THE BUILT OUTPUT BY DEFAULT RATHER THAN `ng serve`
 *   Serving dist/ demonstrates the SAME artefact the SCU cPanel receives -
 *   base href, hashed asset names and the environment file included - and it
 *   starts in a second. `--dev` switches to the Angular development servers when
 *   you are editing, because then live reload matters more.
 *
 * The three ports match the values in the environment files:
 *   clientside/src/environments/environment.ts   otherSiteUrl http://localhost:4300/
 *   adminside/src/environments/environment.ts    otherSiteUrl http://localhost:4200/
 *   api/.env                                     PORT 3000, CORS allows both
 * Changing a port here without changing those would break the cross-site links
 * and the browser's CORS check, so they are read from one place - this file.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const API_DIR = join(ROOT, 'api');
const DIST_CLIENT = join(ROOT, 'dist', 'clientside');
const DIST_ADMIN = join(ROOT, 'dist', 'adminside');
const NG_CLI = join(ROOT, 'node_modules', '@angular', 'cli', 'bin', 'ng.js');

const args = process.argv.slice(2);
const noBrowser = args.includes('--no-browser');
const devMode = args.includes('--dev');
const forceRebuild = args.includes('--rebuild');

const PORTS = { api: 3000, client: 4200, admin: 4300 };

/* ------------------------------------------------------------- api/.env ---- */

/** The value of one key in api/.env, or null. */
function readEnvValue(key) {
  const file = join(API_DIR, '.env');
  if (!existsSync(file)) return null;
  const line = readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .find((entry) => new RegExp(`^\\s*${key}\\s*=`).test(entry));
  return line ? line.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '') : null;
}

/* ------------------------------------------------------------- helpers ---- */

const children = [];

/** Start a child process and prefix its output so one terminal stays readable. */
function start(label, command, commandArgs, cwd = ROOT) {
  const child = spawn(command, commandArgs, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);

  const prefix = `[${label}] `;
  for (const stream of [child.stdout, child.stderr]) {
    let buffered = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      buffered += chunk;
      const lines = buffered.split(/\r?\n/);
      buffered = lines.pop() ?? '';
      for (const line of lines) console.log(prefix + line);
    });
  }

  child.on('exit', (code) => {
    if (code !== 0 && code !== null) console.log(`${prefix}stopped with exit code ${code}`);
  });

  return child;
}

/** Run a build step, inheriting the terminal, and stop if it fails. */
function build(label, command, commandArgs) {
  console.log(`Building ${label}...`);
  const result = spawnSync(command, commandArgs, { cwd: ROOT, stdio: 'inherit', shell: false });
  if (result.status !== 0) {
    console.error(`\n${label} failed to build. Fix the errors above and run again.`);
    process.exit(1);
  }
  console.log('');
}

const node = process.execPath;

/* --------------------------------------------------------------- 1. checks -- */

const [major] = process.versions.node.split('.').map(Number);
if (major < 20) {
  console.error(`Node ${process.versions.node} is too old. Angular 22 needs Node 22.22+, 24.15+ or 26+.`);
  process.exit(1);
}

if (!existsSync(join(API_DIR, '.env'))) {
  console.log('!  api/.env is missing. Copy api/.env.example to api/.env first:');
  console.log('     the API defaults to DATA_SOURCE=local, which needs no database.');
  console.log('');
}

const dataSource = readEnvValue('DATA_SOURCE') ?? 'local';
if (dataSource === 'mysql') {
  console.log('i  api/.env sets DATA_SOURCE=mysql, so the API will read from MySQL.');
  console.log('   MySQL (the MySQL84 Windows service here) must be running or the pages');
  console.log('   will load with no events. Set DATA_SOURCE=local to work offline.');
  console.log('');
}

/* ------------------------------------------------------------- 2. building -- */

if (!existsSync(join(API_DIR, 'node_modules'))) {
  build('API dependencies', 'npm', ['install']);
}

// The API is always compiled: it is fast, and running a stale api/dist would be
// a confusing failure to debug.
build('the API (TypeScript -> dist)', 'npm', ['run', 'build:api']);

const needsAppBuildBase =
  forceRebuild || !existsSync(join(DIST_CLIENT, 'index.html')) || !existsSync(join(DIST_ADMIN, 'index.html'));

/**
 * Does this build talk to the LOCAL API?
 *
 * This matters because `npm run build` (the production configuration) bakes in
 * the SCU cPanel API address, while `npm run build:local` bakes in
 * http://localhost:3000/api. Serving a production build here would look fine and
 * then talk to the deployed API - a confusing failure to debug, and easy to hit
 * because `npm run zip` legitimately leaves a production build in dist/.
 *
 * So the served build is checked for the local address, and a production build is
 * silently replaced by a local one.
 */
function servesLocalApi(appDist) {
  if (!existsSync(appDist)) return false;
  let entries = [];
  try {
    entries = readdirSync(appDist).filter((name) => name.endsWith('.js'));
  } catch {
    return false;
  }
  for (const name of entries) {
    try {
      if (readFileSync(join(appDist, name), 'utf8').includes('localhost:3000')) return true;
    } catch {
      // Unreadable file: treat the build as not local and rebuild.
    }
  }
  return false;
}

const productionBuildInPlace =
  !needsAppBuildBase && (!servesLocalApi(DIST_CLIENT) || !servesLocalApi(DIST_ADMIN));

if (productionBuildInPlace) {
  console.log('The existing build in dist/ targets the deployed API, not http://localhost:3000/api.');
  console.log('Rebuilding both applications with the development configuration for local use.');
  console.log('(Run `npm run build` when you are ready to produce the deployable bundles.)');
  console.log('');
}

const needsAppBuild = needsAppBuildBase || productionBuildInPlace;

if (!devMode && needsAppBuild) {
  // The development configuration is used on purpose: it points the applications
  // at http://localhost:3000/api (see clientside/src/environments/environment.ts),
  // which is the API this script starts.
  build('the client website', 'npm', ['run', 'build:client', '--', '--configuration', 'development']);
  build('the admin website', 'npm', ['run', 'build:admin', '--', '--configuration', 'development']);
}

/* -------------------------------------------------------------- 3. serving -- */

console.log('Starting the API...');
start('api', node, [join(API_DIR, 'dist', 'server.js')], API_DIR);

if (devMode) {
  console.log('Starting the Angular development servers (live reload)...');
  start('client', node, [NG_CLI, 'serve', 'clientside', '--port', String(PORTS.client)]);
  start('admin', node, [NG_CLI, 'serve', 'adminside', '--port', String(PORTS.admin)]);
} else {
  console.log('Serving the built websites...');
  start('client', node, [join(HERE, 'serve-spa.mjs'), DIST_CLIENT, String(PORTS.client)]);
  start('admin', node, [join(HERE, 'serve-spa.mjs'), DIST_ADMIN, String(PORTS.admin)]);
}

/* ---------------------------------------------------------------- 4. report -- */

await new Promise((done) => setTimeout(done, 2500));

console.log('');
console.log('----------------------------------------------------------');
console.log(`  Client website   http://localhost:${PORTS.client}/`);
console.log(`  Search page      http://localhost:${PORTS.client}/search`);
console.log(`  Event detail     http://localhost:${PORTS.client}/events/2`);
console.log(`  Registration     http://localhost:${PORTS.client}/register/2`);
console.log(`  Admin website    http://localhost:${PORTS.admin}/`);
console.log(`  API health       http://localhost:${PORTS.api}/api/health`);
console.log(`  API events       http://localhost:${PORTS.api}/api/events`);
console.log(`  Data source      ${dataSource}`);
console.log('');
console.log('  Press Ctrl+C to stop everything.');
console.log('----------------------------------------------------------');
console.log('');

if (!noBrowser && process.platform === 'win32') {
  // "start" hands the URL to the default browser without waiting for it.
  spawn('cmd', ['/c', 'start', '', `http://localhost:${PORTS.client}/`], {
    detached: true,
    stdio: 'ignore',
  }).unref();
}

/* -------------------------------------------------------------- 5. shutdown -- */

let stopping = false;
function stopAll(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`\nReceived ${signal}, stopping the servers...`);
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  setTimeout(() => process.exit(0), 400);
}

process.on('SIGINT', () => stopAll('Ctrl+C'));
process.on('SIGTERM', () => stopAll('SIGTERM'));
