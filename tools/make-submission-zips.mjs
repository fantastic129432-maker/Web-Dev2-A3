/**
 * tools/make-submission-zips.mjs
 * ---------------------------------------------------------------------------
 * Builds the three source-code archives Assessment 3 asks for:
 *
 *     <username>A3-clientside.zip
 *     <username>A3-adminside.zip
 *     <username>A3-api.zip
 *
 * WHAT CHANGED SINCE ASSESSMENT 2 / THE EARLY A3 DRAFT
 *   The project used to be a vanilla HTML/CSS/JS frontend in clientside/ plus a
 *   JavaScript Express API in api/. It is now ONE Angular v22 workspace at the
 *   project root that defines TWO applications (clientside/ and adminside/), a
 *   plain TypeScript `shared/` folder compiled into both of them through the
 *   `@charity/shared/*` path alias, a shared `assets/` folder, and a TypeScript
 *   API that is compiled to api/dist before it runs.
 *
 *   That is why an archive is no longer "the clientside/ folder minus admin/".
 *   The two apps live in the same workspace, so neither app's folder can be
 *   built on its own: it needs the workspace root config files, the shared
 *   library and the shared assets. Each front-end archive therefore carries
 *
 *     site/     the BUILT application - exactly what goes on the web server
 *     source/   the workspace, trimmed to what that one app needs to rebuild
 *
 * WHICH APPLICATION GOES IN WHICH ARCHIVE
 *   clientside  the public website: home, /search, /events/:id, /register/:id
 *   adminside   the admin website:  dashboard, /events, /events/new,
 *               /events/:id/edit, /registrations  (built with baseHref /admin/)
 *
 *   Each archive carries ITS OWN application folder under source/ (plus the
 *   shared library and the shared artwork both apps depend on). The other app is
 *   deliberately absent: it is shipped in its own archive, and including it
 *   would mean submitting the same code three times over.
 *
 *   The one consequence of leaving the other app out is that source/tsconfig.json
 *   still lists a project reference to it. TypeScript resolves project
 *   references lazily - `ng build clientside` never looks at the adminside
 *   entry - so this is a stale line in a file, not a build failure. Verified by
 *   building a copy of the archive's source/ with the other app removed.
 *
 * What is never included: node_modules, .git, api/.env (the real credentials),
 * legacy/ (the archived Assessment 2 frontend), any dist/ build cache, and local
 * scratch files. api/.env.example IS included, because that is the template the
 * marker copies. If the built artefacts are missing, the tool refuses to write a
 * broken archive and tells you which command to run.
 *
 * Usage (from the project root):
 *     node tools/make-submission-zips.mjs
 *     node tools/make-submission-zips.mjs --username LiuXu --out dist
 *     node tools/make-submission-zips.mjs --dry-run
 *     node tools/make-submission-zips.mjs --skip-build-check
 *
 * The username defaults to the one recorded in the root package.json author
 * field, so a student only edits it in one place.
 *
 * --skip-build-check: see the section around `checkBuildOutputs` below. It is an
 * escape hatch for inspecting the archive layout when the project has not been
 * built yet, and it prints a loud warning because the archives it writes are NOT
 * the ones to submit.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

/* ----------------------------------------------------------------- options */
function parseArgs(argv) {
  const options = { out: 'dist', dryRun: false, skipBuildCheck: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--username') options.username = argv[++i];
    else if (arg === '--out') options.out = argv[++i];
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--skip-build-check') options.skipBuildCheck = true;
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

/**
 * Directories that are never part of a submission.
 *
 * `dist` is the Angular build cache and `node_modules` is reproducible from
 * package-lock.json, so both are out. `legacy` holds the Assessment 2 vanilla
 * frontend: it is kept on disk for the history, but it is not part of any A3
 * archive. `.angular` and `tmp` are build/tool scratch directories.
 */
const EXCLUDED_DIRS = new Set([
  'node_modules',
  '.git',
  '.angular',
  '.vscode',
  '.idea',
  'dist',
  'tmp',
  'legacy',
]);
/** Files that are never part of a submission (real credentials, scratch work). */
const EXCLUDED_FILES = new Set([
  '.env',
  '.DS_Store',
  'Thumbs.db',
  'npm-debug.log',
  '.angular',
]);
/** Local drafts and scratch files that must not travel inside a zip. */
const EXCLUDED_SUFFIXES = ['.tmp', '.bak', '.orig', '.log', '.tsbuildinfo'];

function isExcluded(name, isDirectory) {
  if (isDirectory) return EXCLUDED_DIRS.has(name);
  if (EXCLUDED_FILES.has(name)) return true;
  return EXCLUDED_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

/**
 * Collect every file under `source`, as paths relative to `source`.
 *
 * `zipPrefix` is prepended inside the archive, so a source directory can be
 * placed at any depth (`shared` -> `source/shared`).
 *
 * `filter` receives the path relative to `source`, which is what a caller wants
 * when it has to skip one subdirectory (the API's dist/ is collected separately,
 * for instance).
 */
function collect(source, { zipPrefix = '', filter = () => true } = {}) {
  const entries = [];
  if (!existsSync(source)) return entries;

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
      const inside = relative(source, full).split(sep).join('/');
      if (!filter(inside)) continue;
      entries.push(entryRecord(full, zipPrefix ? `${zipPrefix}/${inside}` : inside));
    }
  };

  walk(source);
  return entries;
}

/**
 * One file in an archive.
 *
 * `full` is read from disk at build time. An entry may instead carry `contents`
 * (a string) when the file is generated by this tool - the README the marker
 * reads first, which has to name the application it belongs to and therefore
 * cannot exist on disk once per archive.
 */
function entryRecord(full, zipPath, contents = null) {
  return { full, zipPath, contents };
}

/** A file this tool writes into the archive instead of reading from disk. */
function generatedEntry(zipPath, contents) {
  return { full: null, zipPath, contents };
}

function entryBytes(entry) {
  return entry.contents === null ? statSync(entry.full).size : Buffer.byteLength(entry.contents);
}

/**
 * The README that sits at the root of every archive.
 *
 * It is generated rather than copied so that it can name the archive it is in
 * and give the one build command that applies to it. A marker who extracts the
 * zip reads this file first, so it answers the three questions in order: what is
 * this, how do I build it, how do I deploy it.
 */
function submissionReadme({
  archiveName,
  title,
  kind,
  appName,
  sourceSummary,
  buildCommand,
  siteTarget,
  extra = '',
}) {
  const frontend = kind === 'frontend';
  const lines = [
    `# ${archiveName}`,
    '',
    `${title}`,
    '',
    'PROG2002 Web Development II - Assessment 3 submission archive.',
    '',
    '## What is in this archive',
    '',
    '```',
    frontend ? 'README-SUBMISSION.md   this file' : 'README-SUBMISSION.md   this file',
    frontend ? 'site/                  the BUILT application, ready to upload as-is' : 'api/dist/              the compiled JavaScript that actually runs',
    sourceSummary,
    '```',
    '',
    ...(frontend
      ? [
          '`site/` is the output of the Angular production build. It is what gets uploaded:',
          'the server never compiles TypeScript, so `source/` is there for the marker to read',
          'and to rebuild from, not to run.',
          '',
        ]
      : [
          '`api/dist/` is the output of `npm run build` inside `api/`. The server runs it',
          'directly: the SCU cPanel Node.js version is too old to run TypeScript, which is',
          'exactly why the sources are compiled locally / in the Terminal before the app is',
          'restarted.',
          '',
        ]),
    '## How to build it',
    '',
    '```bash',
    ...(frontend
      ? [
          'cd source',
          'npm install          # or: npm ci   (package-lock.json is included)',
          buildCommand,
          '# output: dist/',
        ]
      : ['cd api', 'npm install', 'npm run build', '# output: dist/  (npm start runs dist/server.js)']),
    '```',
    '',
    'Requires Node.js 22 or later (see the `engines` field of `package.json`).',
    '',
    '## How to deploy it',
    '',
    ...(frontend
      ? [
          `Upload the CONTENTS of \`site/\` to \`${siteTarget}\` - not the \`site/\` folder`,
          'itself, and not `source/`. `index.html` has to end up directly in that directory.',
          '',
          'The application is a single-page app, so deep links such as `/search` or',
          '`/events/2` need an Apache rewrite fallback to `index.html`. The `.htaccess`',
          'file for this is in `docs/deployment-cpanel.md` in the source repository.',
          '',
          'The API address is compiled into the bundle from',
          `\`source/${appName}/src/environments/environment.production.ts\``,
          '(`apiBaseUrl`). Change it there and rebuild if the API moves.',
        ]
      : [
          '1. Upload this archive into the Node.js application directory and extract it,',
          '   so that `api/package.json` and `api/dist/server.js` are in place.',
          '2. Create `api/.env` from `api/.env.example` and fill in the real database',
          '   password and the deployed site origin (`CORS_ORIGIN`).',
          '3. In the cPanel Terminal, activate the Node.js virtual environment, then',
          '   `cd api && npm install`. Compiling is not necessary on the host: `dist/` is',
          '   already in this archive.',
          '4. Set the Passenger **Application startup file** to `api/dist/server.js`',
          '   and restart the application.',
          '',
          'Full walkthrough: `docs/deployment-cpanel.md` in the source repository.',
        ]),
    '',
    '## Not included, on purpose',
    '',
    '- `node_modules/` - reproducible with `npm install` from `package-lock.json`.',
    '- `.git/` - the repository link is submitted separately.',
    ...(frontend
      ? ['- the other Angular application - it has its own archive.']
      : ['- `api/.env` - it holds the real database password. `api/.env.example` is the', '  template: copy it and fill in your own values.']),
    ...(extra ? ['', extra] : []),
    '',
  ];
  return lines.join('\n');
}

/* -------------------------------------------------------------- the archives */

const CLIENTEYE = {
  name: 'clientside',
  appLabel: 'client-side (public) website',
  buildCommand: 'npm run build:client',
  builtDir: 'dist/clientside',
  siteTarget: '`public_html/` (the site root)',
  pages: 'home, /search, /events/:id, /register/:id',
};

const ADMIN = {
  name: 'adminside',
  appLabel: 'admin-side website',
  buildCommand: 'npm run build:admin',
  builtDir: 'dist/adminside',
  siteTarget: '`public_html/admin/` (the build uses baseHref `/admin/`)',
  pages: 'dashboard, /events, /events/new, /events/:id/edit, /registrations',
};

/**
 * Build one front-end archive: the built application under `site/` and the
 * minimum workspace that can rebuild it under `source/`.
 *
 * The workspace files are the same for both apps on purpose - they ARE the
 * workspace. Only the application folder differs, which is why `app` is a
 * parameter.
 */
function frontendArchive(app) {
  const appDir = join(ROOT, app.name);
  if (!existsSync(appDir)) {
    console.error(`Missing application folder: ${relative(ROOT, appDir)}`);
    process.exit(1);
  }

  const builtDir = join(ROOT, 'dist', app.name);
  const siteEntries = () =>
    collect(builtDir).map((entry) => ({ ...entry, zipPath: `site/${entry.zipPath}` }));

  const workspaceFiles = [
    'angular.json',
    'tsconfig.json',
    'tsconfig.shared.json',
    'package.json',
    'package-lock.json',
    '.gitignore',
  ];

  const sourceEntries = () => {
    const entries = [];
    for (const file of workspaceFiles) {
      const full = join(ROOT, file);
      // .gitignore is a normal tracked file here, but tolerate its absence.
      if (!existsSync(full)) continue;
      entries.push(entryRecord(full, `source/${file}`));
    }
    entries.push(...collect(appDir, { zipPrefix: `source/${app.name}` }));
    entries.push(...collect(join(ROOT, 'shared'), { zipPrefix: 'source/shared' }));
    entries.push(...collect(join(ROOT, 'assets'), { zipPrefix: 'source/assets' }));
    return entries;
  };

  return {
    file: `${username}A3-${app.name}.zip`,
    description: `${app.appLabel} - built site plus a buildable workspace`,
    builtDir,
    missingBuiltMessage:
      `The built application is missing: ${relative(ROOT, builtDir)}/\n` +
      `  Build it first (from the project root):\n` +
      `      npm run build:${app.name === 'adminside' ? 'admin' : 'client'}\n` +
      `  (or skip the check with --skip-build-check, which produces an archive that is\n` +
      `   NOT submittable because site/ would be empty)`,
    required: [`site/index.html`, `source/${app.name}/src/main.ts`, 'source/shared/src/'],
    files: () => [
      generatedEntry(
        'README-SUBMISSION.md',
        submissionReadme({
          archiveName: `${username}A3-${app.name}.zip`,
          title: `${app.appLabel} (Angular application \`${app.name}\`)`,
          kind: 'frontend',
          appName: app.name,
          sourceSummary:
            `source/                the Angular workspace this app is built from\n` +
            `  angular.json  tsconfig.json  tsconfig.shared.json  package.json\n` +
            `  package-lock.json  .gitignore\n` +
            `  ${app.name}/            the ${app.appLabel} source\n` +
            `  shared/                the TypeScript library both apps compile in\n` +
            `  assets/                the shared event artwork`,
          buildCommand: app.buildCommand,
          siteTarget: app.siteTarget,
        })
      ),
      ...siteEntries(),
      ...sourceEntries(),
    ],
  };
}

const archives = [
  frontendArchive(CLIENTEYE),
  frontendArchive(ADMIN),
  (() => {
    const apiDir = join(ROOT, 'api');
    const distDir = join(apiDir, 'dist');
    return {
      file: `${username}A3-api.zip`,
      description: 'The Node.js/Express REST API - TypeScript source plus the compiled dist/',
      builtDir: distDir,
      missingBuiltMessage:
        `The compiled API is missing: ${relative(ROOT, distDir)}/\n` +
        `  Compile it first (from the project root):\n` +
        `      npm run build:api\n` +
        `  The SCU cPanel Node.js version cannot run TypeScript, so api/dist is what the\n` +
        `  server executes and the archive must carry it.`,
      required: [
        'api/server.ts',
        'api/dist/server.js',
        'api/dist/src/db/event_db.js',
        // The landing page tsc cannot compile; scripts/copy-views.mjs copies it
        // to dist/src/views so a deployment that ships only api/dist still has it.
        'api/dist/src/views/api-index.html',
        'api/package.json',
        'api/package-lock.json',
        'api/tsconfig.json',
        'api/scripts/copy-views.mjs',
        'api/.env.example',
        'api/src/',
      ],
      files: () => [
        generatedEntry(
          'README-SUBMISSION.md',
          submissionReadme({
            archiveName: `${username}A3-api.zip`,
            title: 'The REST API',
            kind: 'api',
            appName: 'api',
            sourceSummary:
              'api/                   the TypeScript source\n' +
              '  server.ts  src/**  scripts/**  package.json  tsconfig.json\n' +
              '  .env.example         the template (no real credentials)',
            buildCommand: 'npm run build',
            siteTarget: '',
          })
        ),
        // The sources, WITHOUT api/dist - that is collected separately below so it
        // lands at the archive root's api/dist path.
        ...collect(apiDir, {
          zipPrefix: 'api',
          filter: (inside) => !inside.startsWith('dist/'),
        }),
        // The compiled JavaScript that cPanel actually runs.
        ...collect(distDir, { zipPrefix: 'api/dist' }),
      ],
    };
  })(),
];

/* ---------------------------------------------------------- build presence */

/**
 * Refuse to write an archive whose build output is absent.
 *
 * The archives are meant to be "extract and it works": site/ is the deployed
 * application and api/dist is the code Passenger runs. Writing them without the
 * build products would produce a zip that looks complete, passes a file listing
 * and fails on the server - the worst possible failure mode for a submission, so
 * this is a hard error that names the exact command instead.
 *
 * `--skip-build-check` exists only for looking at the archive layout (for
 * example while the frontends are still being written). It does not make the
 * result submittable, and the warning below says so.
 */
function checkBuildOutputs(archive) {
  if (existsSync(archive.builtDir)) return true;
  console.error(`  ${archive.file}`);
  console.error(`  ${archive.missingBuiltMessage.split('\n').join('\n  ')}`);
  console.error('');
  return false;
}

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
    const data = entry.contents === null ? readFileSync(entry.full) : Buffer.from(entry.contents, 'utf8');
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

/**
 * A directory tree, printed as an indented summary.
 *
 * The marker sees the zip's contents first, and so should the student: a wrong
 * layout (an extra wrapping folder, site/ missing, source/ without shared/)
 * is obvious in a tree and invisible in a file count. Deep trees are collapsed
 * after a few entries so the summary stays readable.
 */
function tree(entries, { maxPerDirectory = 6 } = {}) {
  const rootNode = { children: new Map(), files: [], count: 0 };
  for (const entry of entries) {
    const parts = entry.zipPath.split('/');
    let node = rootNode;
    node.count += 1;
    for (const part of parts.slice(0, -1)) {
      const key = `${part}/`;
      if (!node.children.has(key)) node.children.set(key, { children: new Map(), files: [], count: 0 });
      node = node.children.get(key);
      node.count += 1;
    }
    node.files.push(parts[parts.length - 1]);
  }

  const lines = [];
  const render = (node, indent) => {
    // Directories first, then files - the order a file manager shows.
    const directories = [...node.children.keys()].sort((a, b) => a.localeCompare(b));
    const shown = directories.slice(0, maxPerDirectory);
    for (const key of shown) {
      const child = node.children.get(key);
      lines.push(`${indent}${key}  (${child.count} file${child.count === 1 ? '' : 's'})`);
      render(child, `${indent}  `);
    }
    if (directories.length > shown.length) {
      lines.push(`${indent}... ${directories.length - shown.length} more folders`);
    }
    const files = [...node.files].sort((a, b) => a.localeCompare(b));
    for (const file of files) lines.push(`${indent}${file}`);
  };
  render(rootNode, '  ');
  return lines;
}

/* -------------------------------------------------------------------- run */

const outDir = resolve(ROOT, options.out);

console.log(`Submission archives for ${username}`);
console.log(`Project root : ${ROOT}`);
console.log(`Output folder: ${outDir}`);
console.log('');

/* The build check runs before anything is written, so a missing build product
 * never leaves a half-written set of archives in dist/. */
let buildCheckFailed = false;
if (!options.skipBuildCheck) {
  for (const archive of archives) {
    if (!checkBuildOutputs(archive)) buildCheckFailed = true;
  }
} else {
  console.log('!! --skip-build-check: the build output is NOT verified.');
  console.log('!! Any archive whose site/ or api/dist/ is missing is not submittable.');
  console.log('');
}

if (buildCheckFailed) {
  console.error('Nothing was written. Build the project, or read the note below.\n');
  console.error('  Build everything at once:  npm run build');
  console.error('  Individually:              npm run build:api | npm run build:client | npm run build:admin');
  console.error('  Frontends only, for local use (development config, API on localhost):');
  console.error('                             npm run build:local');
  process.exit(1);
}

if (!options.dryRun) mkdirSync(outDir, { recursive: true });

let totalFiles = 0;
let totalBytes = 0;
let totalZipBytes = 0;
let incomplete = false;

for (const archive of archives) {
  const entries = archive.files();
  totalFiles += entries.length;

  const bytes = entries.reduce((sum, entry) => sum + entryBytes(entry), 0);
  totalBytes += bytes;

  console.log(`${archive.file}`);
  console.log(`  ${archive.description}`);
  console.log(`  ${entries.length} files, ${(bytes / 1024).toFixed(1)} KiB uncompressed`);
  for (const line of tree(entries)) console.log(line);
  console.log('');

  /*
   * A submission that silently misses a key file is worse than one that fails,
   * so each archive declares what it must contain. A trailing '/' means "at
   * least one file under this directory", which is how the shared library and
   * the built site are checked without listing every file.
   */
  const inArchive = entries.map((entry) => entry.zipPath);
  for (const want of archive.required) {
    const present = want.endsWith('/')
      ? inArchive.some((path) => path.startsWith(want))
      : inArchive.includes(want);
    if (!present) {
      console.error(`  ERROR: ${want} is missing from this archive`);
      incomplete = true;
    }
  }

  if (options.dryRun) {
    console.log('  (dry run - nothing written)');
  } else {
    const zip = buildZip(entries);
    totalZipBytes += zip.length;
    const target = join(outDir, archive.file);
    writeFileSync(target, zip);
    console.log(`  written: ${target} (${(zip.length / 1024).toFixed(1)} KiB compressed)`);
  }
  console.log('');
}

console.log(
  `${archives.length} archives, ${totalFiles} files, ${(totalBytes / 1024).toFixed(1)} KiB uncompressed` +
    (options.dryRun ? '' : `, ${(totalZipBytes / 1024).toFixed(1)} KiB compressed`)
);

if (incomplete) {
  // Say what actually happened: the archives above WERE written (unless this was a
  // dry run), they just did not contain everything they should. Claiming "nothing
  // usable was written" sent the reader looking for a problem that was not there.
  console.error(
    options.dryRun
      ? '\nOne or more archives would be incomplete. Nothing was written (dry run).'
      : '\nOne or more archives are incomplete: the files listed above are missing from them.\n' +
        'The archives were still written to disk, so do NOT submit them as they are.'
  );
  process.exitCode = 1;
} else if (options.skipBuildCheck) {
  console.log('\nWARNING: --skip-build-check was used, so the build output was not verified.');
  console.log('Re-run without it before uploading.');
} else {
  console.log('\nDone. Upload these three files with the GitHub link and the video link.');
}
