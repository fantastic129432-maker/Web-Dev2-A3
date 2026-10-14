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
  // Deleted with the vanilla frontend when the project moved to Angular v22 and
  // a TypeScript API. The architecture guard that replaced check-no-frameworks
  // is tools/check-angular-architecture.mjs, and the inline <head> theme script
  // is now verified by that same guard instead of by a sync tool.
  'check-no-frameworks.mjs',
  'sync-theme-snippet.mjs',
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

  // --- commands and paths: tools/x.mjs, api/server.ts, clientside/src/app/app.ts ---
  //
  // 两个 lookbehind 共同保证：匹配到的是"独立的、以仓库根目录为起点的路径"，
  // 而不是别的路径的尾巴，也不是模块说明符。
  //
  // (?<![\w@-])        紧邻的前一个字符不能是单词字符、`@` 或 `-`。
  //   为什么不用 \b: \b 只把"单词字符 vs 非单词字符"当作边界，而连字符 `-` 是非单词
  //   字符，所以 `charity-events-api/tmp/restart.txt` 里的 `api/tmp/restart.txt` 会被
  //   当成一个独立的路径引用，去项目里找 api/tmp/restart.txt，当然找不到。
  //   `@` 则用于排除模块说明符的起始位置。
  //
  // (?<![\w-][/\\])    紧邻的前两个字符不能是"路径字符 + 分隔符"。
  //   这一条修掉的是同一类误报的另一种写法：路径前面还有一层目录时，正则会把尾巴
  //   当成仓库路径。`legacy/clientside/js/translations.js` 会被从 `clientside/` 处截成
  //   `clientside/js/translations.js`（真正的文件在 legacy/ 下，而 legacy/ 不在本检查的
  //   前缀范围内），`@charity/shared/api/api.service` 会被截成 `api/api.service`
  //   （那是 shared 库的裸模块说明符，根本不是文件路径）。
  //   注意它只在分隔符前面是单词字符或 `-` 时才排除，所以真正写在行首的绝对路径
  //   `/tools/x.mjs` 仍然会被检查。`\` 让 Windows 风格的路径同样按整体处理。
  //
  // 另外，下面的 replace 把显式写出的 `./tools/x.mjs` 归一化成 `tools/x.mjs`，
  // 所以这种写法不会被漏掉。
  const searchable = text.replace(
    /(?<![\w./\\-])\.\/(?=(?:tools|api|clientside|database|tests|docs)\/)/g,
    ''
  );

  for (const match of searchable.matchAll(
    /(?<![\w@-])(?<![\w-][/\\])((?:tools|api|clientside|database|tests|docs)\/[\w./-]+\.\w+)/g
  )) {
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
