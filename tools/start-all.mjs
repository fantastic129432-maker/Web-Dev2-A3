/**
 * start-all.mjs
 * ---------------------------------------------------------------------------
 * Starts the whole PROG2002 A2 project from one terminal:
 *
 *   1. checks that MySQL   is answering on 127.0.0.1:3306
 *   2. starts the API      (Node.js + Express, http://localhost:3000)
 *   3. starts the website  (static client server, http://localhost:5500)
 *
 * Usage (from the project root):
 *   node tools/start-all.mjs
 *   node tools/start-all.mjs --no-browser    do not open the browser
 *
 * Both servers run as children of this process and their output is prefixed, so
 * one terminal shows everything and Ctrl+C stops both. MySQL is not started or
 * stopped here: on this machine it is the Windows service MySQL84, which starts
 * with Windows.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const API_DIR = join(ROOT, 'api');
const CLIENT_DIR = join(ROOT, 'clientside');
const noBrowser = process.argv.includes('--no-browser');

/* -------------------------------------------------------- locate the MySQL */
function hasServer(home) {
  return Boolean(home) && existsSync(join(home, 'bin', process.platform === 'win32' ? 'mysqld.exe' : 'mysqld'));
}

function findMysqlHome() {
  if (hasServer(process.env.MYSQL_HOME)) return process.env.MYSQL_HOME;
  for (const base of [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean)) {
    const mysqlDir = join(base, 'MySQL');
    if (!existsSync(mysqlDir)) continue;
    const found = readdirSync(mysqlDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(mysqlDir, entry.name))
      .filter(hasServer)
      .sort()
      .reverse();
    if (found.length) return found[0];
  }
  for (const candidate of [join(homedir(), 'mysql'), join(ROOT, 'mysql')]) {
    if (hasServer(candidate)) return candidate;
  }
  return null;
}

function readEnvFileValue(file, key) {
  if (!existsSync(file)) return null;
  const line = readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .find((entry) => new RegExp(`^\\s*${key}\\s*=`).test(entry));
  return line ? line.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '') : null;
}

/* ---------------------------------------------------------- 1. MySQL check */
function checkMysql() {
  const home = findMysqlHome();
  if (!home) {
    console.log('!  MySQL client tools were not found, so the API cannot be checked.');
    console.log('   Install MySQL: https://dev.mysql.com/downloads/installer/');
    return;
  }

  const envFile = join(API_DIR, '.env');
  const user = readEnvFileValue(envFile, 'DB_USER') || 'root';
  const password = readEnvFileValue(envFile, 'DB_PASSWORD') || '';

  const ping = spawnSync(
    join(home, 'bin', 'mysqladmin.exe'),
    ['-u', user, '--protocol=TCP', '-h', '127.0.0.1', 'ping'],
    { env: { ...process.env, MYSQL_PWD: password }, encoding: 'utf8' },
  );

  if (ping.status === 0) {
    console.log(`MySQL is up (${home}).`);
    return;
  }

  console.log('MySQL is not answering on 127.0.0.1:3306.');
  console.log('It runs as the Windows service MySQL84. To start it, open an');
  console.log('administrator terminal and run:  net start MySQL84');
  console.log('');
  console.log('Continuing anyway: the website will load but show no events.');
  console.log('');
}

/* ------------------------------------------------------ 2. prerequisites */
if (!existsSync(join(API_DIR, '.env'))) {
  console.log('!  api/.env does not exist, so the API will try MySQL as "root" with an');
  console.log('   empty password and will probably fail. Copy api/.env.example to');
  console.log('   api/.env and set the DB_ values.');
  console.log('');
}

if (!existsSync(join(API_DIR, 'node_modules'))) {
  console.log('Installing API dependencies (first run only)...');
  const install = spawnSync('npm', ['install'], { cwd: API_DIR, stdio: 'inherit', shell: true });
  if (install.status !== 0) {
    console.error('npm install failed. Fix that first.');
    process.exit(1);
  }
  console.log('');
}

/* ------------------------------------------------------------- 3. start up */
checkMysql();

const children = [];

/** Start one server and prefix each of its lines so the log stays readable. */
function startServer(label, cwd, script) {
  const child = spawn(process.execPath, [script], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);

  const prefix = `[${label}] `;
  for (const stream of [child.stdout, child.stderr]) {
    let buffered = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      buffered += chunk;
      const lines = buffered.split(/\r?\n/);
      buffered = lines.pop();
      for (const line of lines) console.log(prefix + line);
    });
  }

  child.on('exit', (code) => {
    if (code !== 0 && code !== null) console.log(`${prefix}stopped with exit code ${code}`);
  });

  return child;
}

console.log('Starting the API...');
startServer('api', API_DIR, 'server.js');

console.log('Starting the website...');
startServer('web', CLIENT_DIR, 'serve-clientside.js');

/* ------------------------------------------------------------ 4. tell them */
await new Promise((done) => setTimeout(done, 2500));

console.log('');
console.log('----------------------------------------------------------');
console.log('  Website      http://localhost:5500/index.html');
console.log('  API health   http://localhost:3000/api/health');
console.log('  API events   http://localhost:3000/api/events');
console.log('');
console.log('  Press Ctrl+C to stop both servers.');
console.log('----------------------------------------------------------');
console.log('');

if (!noBrowser && process.platform === 'win32') {
  // "start" hands the URL to the default browser without waiting for it.
  spawn('cmd', ['/c', 'start', '', 'http://localhost:5500/index.html'], {
    detached: true,
    stdio: 'ignore',
  }).unref();
}

/* -------------------------------------------------------- 5. tidy shutdown */
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
