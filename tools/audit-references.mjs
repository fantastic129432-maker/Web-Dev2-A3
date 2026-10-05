/**
 * audit-references.mjs
 * ---------------------------------------------------------------------------
 * Checks that everything the documentation tells a reader to run or consult
 * actually exists.
 *
 * This matters because tools/ was trimmed from 26 files to 12, and a command in
 * the README that points at a deleted script is worse than no command at all.
 *
 * It verifies:
 *   * every tools/… and ./path reference in the markdown resolves to a real file
 *   * every npm script in package.json points at a real file
 *   * every relative markdown link between documentation files resolves
 *   * no document still names a tool that was removed
 *
 * Usage: node tools/audit-references.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('.');
const DOC_FILES = [
  'README.md',
  ...fs
    .readdirSync(path.join(ROOT, 'docs'))
    .filter((name) => name.endsWith('.md'))
    .map((name) => path.join('docs', name)),
];

/** Tools that were deliberately removed; naming one is now an error. */
const REMOVED_TOOLS = [
  'audit-theme-contrast',
  'capture-element',
  'compare-caret-on-text',
  'find-element-at',
  'find-overflow',
  'inspect-focus',
  'inventory-strings',
  'probe-caret',
  'probe-caret-browsing',
  'probe-nav-state',
  'probe-settings',
  'sample-pixels',
  'scan-accent-edges',
  'stage-commits',
];

const problems = [];
const checkedPaths = new Set();
const checkedLinks = new Set();

/** Collect every path-looking token that begins with a known prefix. */
for (const docFile of DOC_FILES) {
  const full = path.join(ROOT, docFile);
  if (!fs.existsSync(full)) {
    problems.push(`${docFile}: file does not exist`);
    continue;
  }
  const text = fs.readFileSync(full, 'utf8');
  const docDir = path.dirname(full);

  // --- commands and paths: tools/x.mjs, api/server.js, clientside/js/api.js ---
  //
  // 前缀前用 (?<![\w-]) 而不是 \b。
  //
  // 为什么: \b 只把"单词字符 vs 非单词字符"当作边界，而连字符 `-` 是非单词字符，
  // 所以 `charity-events-api/tmp/restart.txt` 里的 `api/tmp/restart.txt` 会被
  // 当成一个独立的路径引用，去项目里找 api/tmp/restart.txt，当然找不到。
  // 这个误报出现过两次（部署文档里写了 cPanel 上的 Passenger 重启路径）。
  // 加上对连字符的排除后，只有真正独立的 `api/...` 才会被检查。
  for (const match of text.matchAll(/(?<![\w-])((?:tools|api|clientside|database|tests|docs)\/[\w./-]+\.\w+)/g)) {
    const reference = match[1];
    checkedPaths.add(reference);
    if (!fs.existsSync(path.join(ROOT, reference))) {
      problems.push(`${docFile}: references a missing file -> ${reference}`);
    }
  }

  // --- removed tools named anywhere ---
  for (const removed of REMOVED_TOOLS) {
    if (text.includes(removed)) {
      problems.push(`${docFile}: still names the removed tool ${removed}`);
    }
  }

  // --- relative markdown links ---
  for (const match of text.matchAll(/\]\(([^)#\s]+\.md)(#[^)]*)?\)/g)) {
    const target = match[1];
    checkedLinks.add(target);
    const resolved = path.resolve(docDir, target);
    if (!fs.existsSync(resolved)) {
      problems.push(`${docFile}: broken markdown link -> ${target}`);
    }
  }
}

/* ---------------------------------------------------------------- */
/* npm scripts                                                       */
/* ---------------------------------------------------------------- */

const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
for (const [name, command] of Object.entries(packageJson.scripts || {})) {
  const fileMatch = command.match(/node\s+([\w./-]+\.(?:js|mjs))/);
  if (!fileMatch) continue;
  checkedPaths.add(fileMatch[1]);
  if (!fs.existsSync(path.join(ROOT, fileMatch[1]))) {
    problems.push(`package.json: script "${name}" points at a missing file -> ${fileMatch[1]}`);
  }
}

/* ---------------------------------------------------------------- */
/* Every tool file should be mentioned somewhere, or be obviously    */
/* part of a documented workflow                                     */
/* ---------------------------------------------------------------- */

const toolFiles = fs
  .readdirSync(path.join(ROOT, 'tools'))
  .filter((name) => /\.(mjs|js|ps1)$/.test(name));

const allDocs = DOC_FILES.map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');

/* ---------------------------------------------------------------- */
/* Report                                                            */
/* ---------------------------------------------------------------- */

console.log(`documents scanned : ${DOC_FILES.length}`);
console.log(`paths verified    : ${checkedPaths.size}`);
console.log(`markdown links    : ${checkedLinks.size}`);
console.log(`tool files        : ${toolFiles.length}`);

const undocumented = toolFiles.filter((name) => !allDocs.includes(name));
if (undocumented.length > 0) {
  console.log(`\ntools not mentioned in any document (${undocumented.length}):`);
  for (const name of undocumented) console.log(`  ${name}`);
}

console.log('');
if (problems.length > 0) {
  console.log(`${problems.length} problem(s) found:`);
  for (const problem of problems) console.log(`  ${problem}`);
  process.exitCode = 1;
} else {
  console.log('All references resolve.');
}
