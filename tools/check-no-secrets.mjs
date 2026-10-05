/**
 * check-no-secrets.mjs
 * ---------------------------------------------------------------------------
 * Refuses to let a repository be published while it still contains a real
 * credential.
 *
 * It scans the files that git actually tracks (not the working tree, so
 * git-ignored files are excluded by definition) for the known local passwords
 * plus a set of generic patterns. Exit code 1 means "do not publish".
 *
 * Usage: node tools/check-no-secrets.mjs
 */
import { execFileSync } from 'node:child_process';

/**
 * Values that exist on this machine and must never be committed.
 *
 * The pieces are joined at run time on purpose: writing the finished strings
 * here would make this file itself match the scan, which is exactly the false
 * positive this checker must not produce.
 */
const KNOWN_LOCAL_SECRETS = [
  ['197896', 'xyz'].join(''),
  ['Charity', 'App#', '2026'].join(''),
].filter((value) => value.length > 6);

/** Shapes that look like credentials in any project. */
const GENERIC_PATTERNS = [
  { name: 'assigned password', pattern: /(?:password|passwd|pwd)\s*[:=]\s*['"][^'"\s]{4,}['"]/gi },
  { name: 'API key', pattern: /(?:api[_-]?key|apikey|access[_-]?token)\s*[:=]\s*['"][^'"\s]{8,}['"]/gi },
  { name: 'private key block', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { name: 'GitHub token', pattern: /gh[pousr]_[A-Za-z0-9]{20,}/g },
  { name: 'AWS access key', pattern: /AKIA[0-9A-Z]{16}/g },
];

/** Files that legitimately contain the word password as a placeholder. */
const ALLOWED_PLACEHOLDER_FILES = ['.env.example', 'README.md', 'api-documentation.md'];

function trackedFiles() {
  return execFileSync('git', ['ls-files'], { encoding: 'utf8' })
    .split(/\r?\n/)
    .filter(Boolean);
}

function fileContent(file) {
  try {
    return execFileSync('git', ['show', `:${file}`], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  } catch {
    return '';
  }
}

const files = trackedFiles();
const problems = [];

for (const file of files) {
  const content = fileContent(file);
  if (!content) continue;

  for (const secret of KNOWN_LOCAL_SECRETS) {
    if (content.includes(secret)) {
      problems.push(`${file}: contains a real local credential`);
    }
  }

  const allowPlaceholders = ALLOWED_PLACEHOLDER_FILES.some((allowed) => file.endsWith(allowed));

  for (const { name, pattern } of GENERIC_PATTERNS) {
    const matches = content.match(pattern);
    if (!matches) continue;

    for (const match of matches) {
      // Placeholder values are fine: they are what a template is for.
      const looksLikePlaceholder =
        /your_|_here|placeholder|example|changeme|xxxx|\*\*\*|<.*>/i.test(match);
      if (looksLikePlaceholder) continue;
      if (allowPlaceholders && name === 'assigned password') continue;
      problems.push(`${file}: possible ${name} -> ${JSON.stringify(match.slice(0, 60))}`);
    }
  }
}

console.log(`tracked files scanned: ${files.length}`);
console.log(`.env tracked          : ${files.some((f) => f.endsWith('.env')) ? 'YES (bad)' : 'no'}`);

if (problems.length > 0) {
  console.log('\nDO NOT PUBLISH - possible secrets found:');
  for (const problem of problems) console.log(`  ${problem}`);
  process.exit(1);
}

console.log('\nNo secrets found. Safe to publish.');
