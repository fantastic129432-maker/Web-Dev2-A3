/**
 * tools/make-submission-zips.mjs
 * ---------------------------------------------------------------------------
 * Builds the three source-code archives Assessment 3 asks for:
 *
 *     <username>A3-clientside.zip
 *     <username>A3-adminside.zip
 *     <username>A3-api.zip
 *
 * A3 turned one website into two, so the client archive no longer contains the
 * admin site and vice versa. Each archive is self-contained for its marker:
 *
 *   clientside  the public website PLUS the shared assets it needs. The admin
 *               pages live in clientside/admin because the browser has to be
 *               able to reach them with a relative URL, and reusing js/api.js,
 *               js/dom.js, js/theme.js and css/styles.css from the client site
 *               is what keeps one copy of each. The admin zip therefore contains
 *               those shared files too, under the same relative paths, so it can
 *               be extracted and opened on its own.
 *   adminside   the same tree, with the admin pages as the entry point.
 *   api         api/ without node_modules or the .env holding a real password.
 *
 * What is never included: node_modules, .git, api/.env (the real credentials),
 * the generated report and any local scratch file. api/.env.example IS included,
 * because that is the template the marker copies.
 *
 * Usage (from the project root):
 *     node tools/make-submission-zips.mjs
 *     node tools/make-submission-zips.mjs --username LiuXu --out dist
 *     node tools/make-submission-zips.mjs --dry-run
 *
 * The username defaults to the one recorded in the root package.json author
 * field, so a student only edits it in one place.
 */
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

/* ----------------------------------------------------------------- options */
function parseArgs(argv) {
  const options = { out: 'dist', dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--username') options.username = argv[++i];
    else if (arg === '--out') options.out = argv[++i];
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else {
      console.error(`Unknown option: ${arg}`);
      console.error('Try: node tools/make-submission-zips.mjs --help');
      process.exit(2);
    }
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));

if (options.help) {
  console.log(
    readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0].replace(/^\/\*\*?/, '')
  );
  process.exit(0);
}

/**
 * The SCU username, taken from package.json so it is edited in one place.
 *
 * Returns null when the author field is still the shipped placeholder
 * ("<your name> (<your SCU username>)"). That case is treated as a hard error
 * rather than a fallback: an archive named `usernameA3-clientside.zip` is not a
 * submission the marker can match to a student, and silently producing one would
 * waste the upload. Filling in the author field once fixes it for every future
 * run, which is why the error message names that field first.
 */
function readUsernameFromPackage() {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const author = String(pkg.author || '');

  // The placeholder ships with angle brackets, so their presence is the signal.
  if (author.includes('<') || author.includes('>')) return null;

  const match = author.match(/\(([^)]+)\)/);
  const candidate = (match ? match[1] : author).trim();
  return /^[A-Za-z][\w.-]*$/.test(candidate) ? candidate : null;
}

const username = options.username || readUsernameFromPackage();

if (!username) {
  console.error('No SCU username available.\n');
  console.error('The archives must be named <username>A3-clientside.zip and so on, so the');
  console.error('username has to be known. Do one of these:\n');
  console.error('  1. edit package.json and replace');
  console.error('         "author": "<your name> (<your SCU username>)"');
  console.error('     with your real name and username, then run this again; or');
  console.error('  2. pass it for this run only:');
  console.error('         node tools/make-submission-zips.mjs --username YourUsername\n');
  console.error('Nothing was written.');
  process.exit(1);
}

/* --------------------------------------------------------- what to include */

/** Directories that are never part of a submission. */
const EXCLUDED_DIRS = new Set(['node_modules', '.git', '.vscode', '.idea', 'dist', 'mysql']);
/** Files that are never part of a submission (real credentials, scratch work). */
const EXCLUDED_FILES = new Set([
  '.env',
  '.DS_Store',
  'Thumbs.db',
  'npm-debug.log',
  'package-lock.json',
]);
/** Report drafts the student keeps locally but does not submit inside the zips. */
const EXCLUDED_SUFFIXES = ['.tmp', '.bak', '.orig', '.log'];

function isExcluded(name, isDirectory) {
  if (isDirectory) return EXCLUDED_DIRS.has(name);
  if (EXCLUDED_FILES.has(name)) return true;
  return EXCLUDED_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

/**
 * Collect every file under `directory`, as paths relative to `directory`.
 * `zipPrefix` is prepended inside the archive so the marker sees a folder name
 * rather than a loose pile of files.
 */
function collect(directory, { zipPrefix, filter = () => true } = {}) {
  const entries = [];

  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name)
    )) {
      if (isExcluded(entry.name, entry.isDirectory())) continue;
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      const inside = relative(directory, full).split(sep).join('/');
      if (!filter(inside)) continue;
      entries.push({ full, inside });
    }
  };

  walk(directory);
  return entries.map((entry) => ({
    ...entry,
    zipPath: `${zipPrefix}/${entry.inside}`,
  }));
}

/**
 * The archives. `files` is a function because the client and admin archives
 * share the clientside tree but pick different subsets of it.
 */
const CLIENT_SHARED = [
  'css/',
  'images/',
  'js/',
  'index.html',
  'search.html',
  'event.html',
  'registration.html',
  'serve-clientside.js',
];

const archives = [
  {
    file: `${username}A3-clientside.zip`,
    prefix: `${username}A3-clientside`,
    description: 'The public website (home, search, event detail, registration)',
    files: () =>
      collect(join(ROOT, 'clientside'), {
        zipPrefix: `${username}A3-clientside`,
        // The admin pages are a separate deliverable, so they are excluded here
        // and shipped in the admin archive instead.
        filter: (inside) => !inside.startsWith('admin/'),
      }),
  },
  {
    file: `${username}A3-adminside.zip`,
    prefix: `${username}A3-adminside`,
    description: 'The staff website, with the shared modules it reuses',
    files: () => {
      const clientDir = join(ROOT, 'clientside');
      const adminEntries = collect(join(clientDir, 'admin'), {
        zipPrefix: `${username}A3-adminside/admin`,
      });

      /*
       * The admin pages import ../../js/api.js, ../../js/dom.js and
       * ../../js/theme.js, and link ../css/styles.css. Those shared files are
       * therefore part of the admin archive too, under the paths the imports
       * expect: if they were omitted, extracting the admin zip alone would give
       * a site whose JavaScript cannot load.
       */
      const sharedEntries = [];
      const wanted = ['css/styles.css'];
      for (const file of readdirSync(join(clientDir, 'js'))) {
        if (file.endsWith('.js')) wanted.push(`js/${file}`);
      }
      // The three public pages are reachable from the admin menu, so a marker
      // can check the public site without a second extraction.
      wanted.push('index.html', 'search.html', 'event.html', 'registration.html');
      // The artwork the shared modules reference.
      for (const file of readdirSync(join(clientDir, 'images'))) {
        wanted.push(`images/${file}`);
      }

      for (const inside of wanted) {
        const full = join(clientDir, inside);
        if (!existsSync(full)) continue;
        sharedEntries.push({
          full,
          inside,
          zipPath: `${username}A3-adminside/${inside}`,
        });
      }

      return [...adminEntries, ...sharedEntries];
    },
  },
  {
    file: `${username}A3-api.zip`,
    prefix: `${username}A3-api`,
    description: 'The Node.js/Express REST API',
    files: () =>
      collect(join(ROOT, 'api'), { zipPrefix: `${username}A3-api` }),
  },
];

/* ------------------------------------------------------------------ zip it */

/**
 * Write a ZIP archive.
 *
 * Implemented directly rather than shelling out to `Compress-Archive` or
 * `zip`, because neither is guaranteed to exist (Compress-Archive is Windows
 * only, zip is not installed by default) and a submission tool that only works
 * on one machine is worse than no tool. The format is small enough to write by
 * hand: a local header and data per file, then a central directory and an
 * end-of-central-directory record.
 */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buffer[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

/** Convert a JS Date into the DOS date/time pair a ZIP entry stores. */
function dosDateTime(date) {
  const time =
    (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day =
    ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

function buildZip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  const now = dosDateTime(new Date());

  for (const entry of entries) {
    const data = readFileSync(entry.full);
    const nameBuffer = Buffer.from(entry.zipPath, 'utf8');
    const crc = crc32(data);
    const compressed = deflateRawSync(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header signature
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // flags: UTF-8 names
    local.writeUInt16LE(8, 8); // method: deflate
    local.writeUInt16LE(now.time, 10);
    local.writeUInt16LE(now.day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    local.writeUInt16LE(0, 28); // extra field length

    chunks.push(local, nameBuffer, compressed);

    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0); // central directory signature
    record.writeUInt16LE(20, 4); // version made by
    record.writeUInt16LE(20, 6); // version needed
    record.writeUInt16LE(0x0800, 8);
    record.writeUInt16LE(8, 10);
    record.writeUInt16LE(now.time, 12);
    record.writeUInt16LE(now.day, 14);
    record.writeUInt32LE(crc, 16);
    record.writeUInt32LE(compressed.length, 20);
    record.writeUInt32LE(data.length, 24);
    record.writeUInt16LE(nameBuffer.length, 28);
    record.writeUInt16LE(0, 30); // extra
    record.writeUInt16LE(0, 32); // comment
    record.writeUInt16LE(0, 34); // disk number
    record.writeUInt16LE(0, 36); // internal attributes
    record.writeUInt32LE(0, 38); // external attributes
    record.writeUInt32LE(offset, 42);

    central.push(record, nameBuffer);
    offset += local.length + nameBuffer.length + compressed.length;
  }

  const centralBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // end of central directory
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...chunks, centralBuffer, end]);
}

/* -------------------------------------------------------------------- run */

const outDir = resolve(ROOT, options.out);
if (!options.dryRun) mkdirSync(outDir, { recursive: true });

console.log(`Submission archives for ${username}`);
console.log(`Project root : ${ROOT}`);
console.log(`Output folder: ${outDir}`);
console.log('');

let totalFiles = 0;
let totalBytes = 0;

for (const archive of archives) {
  const entries = archive.files();
  totalFiles += entries.length;

  const bytes = entries.reduce((sum, entry) => sum + statSync(entry.full).size, 0);
  totalBytes += bytes;

  console.log(`${archive.file}`);
  console.log(`  ${archive.description}`);
  console.log(`  ${entries.length} files, ${(bytes / 1024).toFixed(1)} KiB uncompressed`);

  // A submission that silently contains no files is worse than one that fails,
  // so each archive declares what it must contain and this checks it.
  //
  // The comparison uses the path INSIDE the archive with the archive's own
  // folder prefix stripped, because that is the path a marker sees after
  // extracting. Comparing `inside` directly would compare prefixed paths such as
  // "LiuXuA3-adminside/admin/index.html" against unprefixed expectations.
  const inArchive = entries.map((entry) =>
    entry.zipPath.slice(`${archive.prefix}/`.length)
  );
  const required =
    archive.file.includes('api')
      ? ['server.js', 'src/db/event_db.js', '.env.example']
      : archive.file.includes('admin')
        ? ['admin/index.html', 'admin/js/events.js', 'js/api.js', 'css/styles.css']
        : ['index.html', 'registration.html', 'js/event.js', 'js/weather.js'];

  for (const want of required) {
    if (!inArchive.includes(want)) {
      console.error(`  ERROR: ${want} is missing from this archive`);
      process.exitCode = 1;
    }
  }

  if (options.dryRun) {
    console.log('  (dry run - nothing written)');
  } else {
    const zip = buildZip(entries);
    const target = join(outDir, archive.file);
    const stream = createWriteStream(target);
    stream.end(zip);
    console.log(`  written: ${target} (${(zip.length / 1024).toFixed(1)} KiB)`);
  }
  console.log('');
}

console.log(`${archives.length} archives, ${totalFiles} files, ${(totalBytes / 1024).toFixed(1)} KiB total`);

if (process.exitCode === 1) {
  console.error('\nOne or more archives are incomplete.');
} else {
  console.log('\nDone. Upload these three files with the GitHub link and the video link.');
}
