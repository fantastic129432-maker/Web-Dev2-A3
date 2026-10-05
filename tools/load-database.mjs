/**
 * load-database.mjs
 * ---------------------------------------------------------------------------
 * Loads database/charityevents_db.sql into the local MySQL server and verifies
 * the result. Run it AFTER the MySQL server is running.
 *
 * Usage (from the project root):
 *   node tools/load-database.mjs
 *   node tools/load-database.mjs --mysql-home "C:\Program Files\MySQL\MySQL Server 8.4"
 *   node tools/load-database.mjs --user root --password secret
 *   node tools/load-database.mjs --skip-verify
 *
 * Credentials, in order of precedence:
 *   1. --user / --password
 *   2. DB_USER / DB_PASSWORD in the environment
 *   3. the values in api/.env
 *   4. root with an empty password
 *
 * This drops and recreates charityevents_db, so it needs an account with CREATE
 * privileges (root or equivalent). The API itself uses the least-privilege
 * account stored in api/.env: SELECT, INSERT, UPDATE and DELETE on this one
 * database, which is what Assessment 3 needs and no more.
 *
 * If Assessment 3 writes start failing with MySQL error 1142, the API account is
 * still SELECT-only. Grant the write privileges once with:
 *
 *   GRANT SELECT, INSERT, UPDATE, DELETE ON charityevents_db.*
 *     TO 'charity_app'@'127.0.0.1';
 *
 * The host must match DB_HOST in api/.env: in MySQL,
 * 'charity_app'@'localhost' and 'charity_app'@'127.0.0.1' are different accounts.
 *
 * The password is passed through the MYSQL_PWD environment variable, so it never
 * appears in the process command line or in this script's output.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, openSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const SQL_FILE = join(ROOT, 'database', 'charityevents_db.sql');

/* ---------------------------------------------------------------- options */
function parseArgs(argv) {
  const options = { skipVerify: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--skip-verify') options.skipVerify = true;
    else if (arg === '--mysql-home') options.mysqlHome = argv[++i];
    else if (arg === '--user') options.user = argv[++i];
    else if (arg === '--password') options.password = argv[++i];
    else if (arg === '--help' || arg === '-h') options.help = true;
    else {
      console.error(`Unknown option: ${arg}`);
      console.error('Try: node tools/load-database.mjs --help');
      process.exit(2);
    }
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  console.log(readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0].replace(/^\/\*\*?/, ''));
  process.exit(0);
}

if (!existsSync(SQL_FILE)) {
  console.error(`SQL file not found: ${SQL_FILE}`);
  process.exit(1);
}

/* --------------------------------------------------- locate the MySQL home */
function hasServer(home) {
  return Boolean(home) && existsSync(join(home, 'bin', process.platform === 'win32' ? 'mysqld.exe' : 'mysqld'));
}

function findMysqlHome(explicit) {
  if (hasServer(explicit)) return explicit;
  if (hasServer(process.env.MYSQL_HOME)) return process.env.MYSQL_HOME;

  // The official installer layout: "Program Files\MySQL\MySQL Server <version>".
  // Newest version wins when several are installed.
  const programFiles = [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean);
  for (const base of programFiles) {
    const mysqlDir = join(base, 'MySQL');
    if (!existsSync(mysqlDir)) continue;
    const versions = readdirSync(mysqlDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(mysqlDir, entry.name))
      .filter(hasServer)
      .sort()
      .reverse();
    if (versions.length) return versions[0];
  }

  const userLocal = join(homedir(), 'mysql');
  if (hasServer(userLocal)) return userLocal;
  const inProject = join(ROOT, 'mysql');
  if (hasServer(inProject)) return inProject;

  return null;
}

const mysqlHome = findMysqlHome(options.mysqlHome);
if (!mysqlHome) {
  console.error('MySQL was not found.');
  console.error('Install it with the official installer, or pass --mysql-home "C:\\path\\to\\mysql".');
  process.exit(1);
}
const bin = join(mysqlHome, 'bin');

/** The official installer keeps my.ini under ProgramData, in a versioned folder. */
function findMyIni() {
  for (const candidate of [join(mysqlHome, 'my.ini'), join(mysqlHome, 'my.cnf')]) {
    if (existsSync(candidate)) return candidate;
  }
  const programData = process.env.ProgramData ? join(process.env.ProgramData, 'MySQL') : null;
  if (programData && existsSync(programData)) {
    const stack = [programData];
    while (stack.length) {
      const dir = stack.pop();
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) stack.push(full);
        else if (entry.name === 'my.ini') return full;
      }
    }
  }
  return null;
}

const myIni = findMyIni();

/* ------------------------------------------------------------ credentials */
function readEnvFileValue(file, key) {
  if (!existsSync(file)) return null;
  const line = readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .find((entry) => new RegExp(`^\\s*${key}\\s*=`).test(entry));
  if (!line) return null;
  return line.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '');
}

const envFile = join(ROOT, 'api', '.env');
const user = options.user || process.env.DB_USER || readEnvFileValue(envFile, 'DB_USER') || 'root';
const password =
  options.password ?? process.env.DB_PASSWORD ?? readEnvFileValue(envFile, 'DB_PASSWORD') ?? '';

const defaultsArgs = myIni ? [`--defaults-file=${myIni}`] : [];
const credentialArgs = ['-u', user, '--protocol=TCP', '-h', '127.0.0.1'];

console.log(`MySQL home : ${mysqlHome}`);
if (myIni) console.log(`my.ini     : ${myIni}`);
console.log(`Account    : ${user}`);
console.log(`SQL file   : ${SQL_FILE}`);
console.log('');

function mysqlEnv() {
  return { ...process.env, MYSQL_PWD: password };
}

/* --------------------------------------------------- wait for the server up */
console.log('Waiting for MySQL to accept connections...');
let ready = false;
for (let attempt = 1; attempt <= 30; attempt++) {
  const ping = spawnSync(join(bin, 'mysqladmin.exe'), [...defaultsArgs, ...credentialArgs, 'ping'], {
    env: mysqlEnv(),
    encoding: 'utf8',
  });
  if (ping.status === 0) {
    ready = true;
    break;
  }
  await new Promise((done) => setTimeout(done, 1000));
}

if (!ready) {
  console.error(`MySQL is not responding on 127.0.0.1:3306, or the credentials for '${user}' are rejected.`);
  console.error('Start the server (the Windows service MySQL84) and check the DB_ values in api/.env.');
  process.exit(1);
}
console.log('MySQL is up.');

/* --------------------------------------------------------------- load it in */
console.log('Loading the database (this drops and recreates charityevents_db)...');

// The SQL file goes in on stdin, which is what "< file" did before but without
// needing a shell to do the redirection.
const sqlFd = openSync(SQL_FILE, 'r');
const load = spawnSync(join(bin, 'mysql.exe'), [...defaultsArgs, ...credentialArgs], {
  env: mysqlEnv(),
  stdio: [sqlFd, 'inherit', 'inherit'],
});

if (load.status !== 0) {
  console.error(`Loading the SQL file failed (exit code ${load.status}).`);
  process.exit(1);
}

if (options.skipVerify) {
  console.log('Loaded. Verification skipped.');
  process.exit(0);
}

/* ------------------------------------------------------------------ verify */
console.log('Loaded. Verifying...');
const verify = spawnSync(
  join(bin, 'mysql.exe'),
  [
    ...defaultsArgs,
    ...credentialArgs,
    '-t',
    '-e',
    [
      'USE charityevents_db;',
      'SELECT COUNT(*) AS events_total FROM events;',
      'SELECT event_state, COUNT(*) AS how_many FROM vw_public_events GROUP BY event_state;',
      'SELECT event_name, raised_amount, goal_amount, progress_percent',
      '  FROM vw_public_events ORDER BY progress_percent DESC LIMIT 4;',
    ].join('\n'),
  ],
  { env: mysqlEnv(), stdio: ['ignore', 'inherit', 'inherit'] },
);

if (verify.status !== 0) {
  console.error('The database loaded but the verification query failed.');
  process.exit(1);
}

console.log('');
console.log(`Database charityevents_db is ready on ${mysqlHome}`);
