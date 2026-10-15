/**
 * @file The project's autodoc tool: checks the comment standard and generates
 * reference documentation from it.
 *
 * Assessment 2 feedback asked for comments in "the autodoc style, for ease of
 * automatic doc generation through your code", so the style is only half the work:
 * something has to read the comments. This one file does both jobs.
 *
 *   node tools/doc-comments.mjs --check   fail if a documented symbol breaks the
 *                                        standard in docs/code-comments.md
 *   node tools/doc-comments.mjs --write   regenerate docs/api-reference.md
 *
 * The rules implemented here are exactly the ones written down in
 * docs/code-comments.md, so the document and the check cannot drift apart.
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const TARGETS = ['api/server.ts', 'api/src', 'shared/src', 'clientside/src', 'adminside/src'];
const SKIP_DIRS = new Set(['node_modules', 'dist', '.angular', 'assets']);
const TAG_ORDER = ['param', 'returns', 'throws', 'example', 'see'];
const BANNED_TAGS = ['author', 'date', 'version', 'since'];

/** Every .ts file under a target that is not a test or a declaration file. */
function collectFiles(target) {
  const full = path.join(ROOT, target);
  if (!fs.existsSync(full)) return [];
  if (fs.statSync(full).isFile()) return [full];
  const found = [];
  for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      found.push(...collectFiles(path.join(target, entry.name)));
    } else if (entry.name.endsWith('.ts') && !/\.(spec|d)\.ts$/.test(entry.name)) {
      found.push(path.join(full, entry.name));
    }
  }
  return found;
}

/** Lines that belong to a decorator call, so the doc block above a class is still adjacent. */
function decoratorLines(lines) {
  const marked = new Set();
  for (let index = 0; index < lines.length; index += 1) {
    if (!/^\s*@[A-Za-z]/.test(lines[index])) continue;
    let depth = 0;
    let cursor = index;
    do {
      depth += (lines[cursor].match(/[({[]/g) ?? []).length;
      depth -= (lines[cursor].match(/[)}\]]/g) ?? []).length;
      marked.add(cursor);
      cursor += 1;
    } while (depth > 0 && cursor < lines.length);
    index = cursor - 1;
  }
  return marked;
}

/** The `/** ... *\/` block immediately above a line, or null. */
function blockAbove(lines, lineIndex, decorators) {
  let cursor = lineIndex - 1;
  while (cursor >= 0 && (lines[cursor].trim() === '' || decorators.has(cursor))) cursor -= 1;
  if (cursor < 0 || !lines[cursor].trim().endsWith('*/')) return null;
  let start = cursor;
  while (start >= 0 && !lines[start].trim().startsWith('/*')) start -= 1;
  if (start < 0) return null;
  return { start, end: cursor, lines: lines.slice(start, cursor + 1) };
}

/** Split a parameter list on top-level commas and keep each parameter's name. */
function parameterNames(text) {
  const names = [];
  let depth = 0;
  let current = '';
  for (const character of text) {
    if ('([{<'.includes(character)) depth += 1;
    if (')]}>'.includes(character)) depth -= 1;
    if (character === ',' && depth === 0) {
      names.push(current);
      current = '';
      continue;
    }
    current += character;
  }
  if (current.trim()) names.push(current);
  return names
    .map((entry) => entry.trim().replace(/^(public|private|protected|readonly)\s+/g, ''))
    .filter(Boolean)
    .map((entry) => (/^([A-Za-z_$][\w$]*)/.exec(entry.replace(/^\.\.\./, '')) ?? [])[1])
    .filter(Boolean);
}

/** The text of a balanced `( ... )` list starting at `from`. */
function balanced(lines, from, open, close) {
  let depth = 0;
  let text = '';
  for (let index = from.line; index < lines.length; index += 1) {
    const slice = index === from.line ? lines[index].slice(from.column) : lines[index];
    for (const character of slice) {
      text += character;
      if (character === open) depth += 1;
      else if (character === close) {
        depth -= 1;
        if (depth === 0) return text;
      }
    }
    text += ' ';
  }
  return text;
}

const DECLARATION =
  /^\s*export\s+(?:default\s+)?(?:abstract\s+)?(class|interface|type|enum|const|let|function|async\s+function)\s+([A-Za-z_$][\w$]*)/;

const problems = [];
const documented = [];

function report(file, line, message, snippet) {
  problems.push({ file: path.relative(ROOT, file).replace(/\\/g, '/'), line, message, snippet: (snippet ?? '').trim().slice(0, 96) });
}

function checkBlock(file, lines, block, lineIndex, { kind, name, params = null, returns = null }) {
  const relative = path.relative(ROOT, file).replace(/\\/g, '/');
  const snippet = lines[lineIndex];
  if (!block) {
    report(file, lineIndex + 1, `exported ${kind} "${name}" has no /** */ doc block`, snippet);
    return;
  }

  const body = block.lines.join('\n');
  const stripped = block.lines.map((line, index) => {
    let text = line;
    if (index === 0) text = text.replace(/^\s*\/\*\*?/, '');
    if (index === block.lines.length - 1) text = text.replace(/\*\/\s*$/, '');
    return text.replace(/^\s*\*\s?/, '').trim();
  });

  // The summary is the FIRST PARAGRAPH, so a summary the author wrapped over two
  // lines is still read as one sentence. Reading only the first line reported every
  // wrapped summary as missing its full stop.
  //
  // A block may also open with `@file` (docs/code-comments.md section 4 allows either
  // order), so the summary is the first line that is not a tag rather than literally
  // the first line.
  const paragraph = [];
  for (const line of stripped) {
    if (line.startsWith('@')) {
      if (paragraph.length) break;
      continue;
    }
    if (line === '') {
      if (paragraph.length) break;
      continue;
    }
    paragraph.push(line);
  }
  const summary = paragraph.join(' ');

  const content = stripped.filter(Boolean);

  if (!summary) {
    report(file, block.start + 1, `doc block for "${name}" has no summary line`, snippet);
    return;
  }
  if (!/[.!?]$/.test(summary)) {
    report(file, block.start + 1, `summary for "${name}" does not end in a full stop: "${summary.slice(0, 60)}"`, snippet);
  }

  const tags = [...body.matchAll(/@([a-z]+)/g)].map((match) => match[1]);
  for (const tag of tags) {
    if (BANNED_TAGS.includes(tag)) {
      report(file, block.start + 1, `"${name}" uses @${tag}, which docs/code-comments.md forbids`, snippet);
    }
  }

  const known = tags.filter((tag) => TAG_ORDER.includes(tag));
  const positions = known.map((tag) => TAG_ORDER.indexOf(tag));
  for (let index = 1; index < positions.length; index += 1) {
    if (positions[index] < positions[index - 1]) {
      report(file, block.start + 1, `"${name}" has tags out of order (@${known[index]} after @${known[index - 1]})`, snippet);
      break;
    }
  }

  for (const match of body.matchAll(/@param\s+(\{[^}]*\})?\s*([\w$]*)/g)) {
    if (match[1]) report(file, block.start + 1, `"${name}" writes a {type} in @param; the signature already carries it`, snippet);
    if (!/-\s/.test(body.slice(match.index, match.index + 120))) {
      report(file, block.start + 1, `"${name}" documents @param ${match[2]} without " - " before the description`, snippet);
    }
  }

  const documentedParams = [...body.matchAll(/@param\s+([\w$]+)/g)].map((match) => match[1]);
  if (params) {
    for (const parameter of params) {
      if (!documentedParams.includes(parameter)) {
        report(file, lineIndex + 1, `"${name}" does not document parameter "${parameter}"`, snippet);
      }
    }
    for (const documentedName of documentedParams) {
      if (!params.includes(documentedName)) {
        report(file, block.start + 1, `"${name}" documents @param ${documentedName}, which is not a parameter`, snippet);
      }
    }
  }

  if (returns && !/@returns/.test(body)) {
    report(file, lineIndex + 1, `"${name}" returns ${returns} but has no @returns`, snippet);
  }

  documented.push({ file: relative, line: lineIndex + 1, kind, name, summary, body: content });
}

function checkFile(file) {
  const source = fs.readFileSync(file, 'utf8');
  const lines = source.split(/\r?\n/);
  const decorators = decoratorLines(lines);

  for (let index = 0; index < lines.length; index += 1) {
    const match = DECLARATION.exec(lines[index]);
    if (!match) continue;
    const kind = match[1].replace(/\s+/g, ' ');
    const name = match[2];

    if (kind === 'const' || kind === 'let') {
      // A const is only a documented symbol when it is an object, array or function
      // value; a single primitive does not need a block and would only add noise.
      const declaration = lines.slice(index, index + 3).join(' ');
      if (!/=\s*[{([]|=>/.test(declaration)) continue;
    }

    let params = null;
    let returns = null;
    if (kind.includes('function')) {
      const open = lines[index].indexOf('(', lines[index].indexOf(name) + name.length);
      if (open !== -1) {
        // Start the scan ON the opening parenthesis so the captured text is the whole
        // "(a, b)" list; starting one character later chopped the first parameter's
        // first letter, which reported `req` as an undocumented parameter named `eq`.
        const list = balanced(lines, { line: index, column: open }, '(', ')');
        params = parameterNames(list.slice(1, -1));
        const after = lines.slice(index, index + 6).join(' ');
        const typed = /\)\s*:\s*([^{=]+)/.exec(after.slice(after.indexOf(list)));
        if (typed) {
          // A function with no value to return must NOT be asked for @returns -
          // Express handlers all return void, and demanding a tag for them reported
          // every handler in the API as undocumented.
          const type = typed[1].trim();
          returns = /^(void|undefined|Promise<void>|Promise<undefined>)$/.test(type) ? null : type;
        }
      }
    }

    checkBlock(file, lines, blockAbove(lines, index, decorators), index, { kind, name, params, returns });
  }

  /*
   * Second pass: the names this file publishes on its own module object.
   *
   * Most of the API is CommonJS-shaped - `export = { listEvents, createEvent, ... }`
   * or `Object.assign(...)` - so its functions are declared with a plain `function`
   * and are only "exported" through that object. A collector that matched just
   * `export <decl>` therefore saw 36 of roughly 160 public API members: the comments
   * were all there (396 blocks in api/ alone) but `npm run docs` silently published
   * a fraction of them, which defeats the point of documenting in autodoc style.
   *
   * Only names that are DECLARED IN THIS FILE are considered, so a re-export from
   * another module is never demanded a block it should not have here.
   */
  const published = new Set();
  const addNames = (text) => {
    for (const entry of text.split(',')) {
      const cleaned = entry.replace(/\/\/.*$/gm, '').trim();
      if (!cleaned) continue;
      const local = /\bas\s+([A-Za-z_$][\w$]*)\s*$/.exec(cleaned);
      const name = local ? local[1] : /^([A-Za-z_$][\w$]*)/.exec(cleaned)?.[1];
      if (name && name !== 'exports') published.add(name);
    }
  };
  for (const match of source.matchAll(/export\s*=\s*\{([\s\S]*?)\n\}/g)) addNames(match[1]);
  for (const match of source.matchAll(/Object\.assign\([^,]+,\s*\{([\s\S]*?)\n\}\)/g)) addNames(match[1]);
  for (const match of source.matchAll(/export\s*\{([^}]*)\}/g)) addNames(match[1]);

  const alreadyDocumented = new Set(documented.filter((entry) => entry.file === path.relative(ROOT, file).replace(/\\/g, '/')).map((entry) => entry.name));
  for (const name of published) {
    if (alreadyDocumented.has(name)) continue;
    const declared = lines.findIndex((line) =>
      new RegExp(`^\\s*(?:export\\s+)?(?:async\\s+)?(?:function|const|let|class|interface|type|enum)\\s+${name}\\b`).test(line)
    );
    if (declared === -1) continue;
    const kind = /\bclass\b/.test(lines[declared]) ? 'class' : /\b(interface|type|enum)\b/.test(lines[declared]) ? 'interface' : 'function';
    checkBlock(file, lines, blockAbove(lines, declared, decorators), declared, { kind, name });
  }
}

/* ------------------------------------------------------------------- modes */

const mode = process.argv.includes('--write') ? 'write' : 'check';

for (const target of TARGETS) {
  for (const file of collectFiles(target)) checkFile(file);
}

if (mode === 'check') {
  console.log(`scanned ${TARGETS.join(', ')}`);
  console.log(`documented symbols found: ${documented.length}`);
  if (problems.length === 0) {
    console.log('\ndoc comments: no problems');
    process.exit(0);
  }
  const byFile = new Map();
  for (const problem of problems) {
    if (!byFile.has(problem.file)) byFile.set(problem.file, []);
    byFile.get(problem.file).push(problem);
  }
  console.log(`\n${problems.length} problem(s) in ${byFile.size} file(s):\n`);
  for (const [file, entries] of [...byFile].slice(0, 40)) {
    console.log(`  ${file}`);
    for (const entry of entries.slice(0, 4)) {
      console.log(`    L${entry.line}: ${entry.message}`);
    }
    if (entries.length > 4) console.log(`    ... and ${entries.length - 4} more`);
  }
  process.exit(1);
}

/* --------------------------------------------------- docs/api-reference.md */

const groups = new Map();
for (const entry of documented) {
  const top = entry.file.split('/').slice(0, 2).join('/');
  if (!groups.has(top)) groups.set(top, []);
  groups.get(top).push(entry);
}

const out = [
  '# API reference',
  '',
  '> Generated by `npm run docs` from the TSDoc blocks in the source. Do not edit this',
  '> file by hand: run the command again after changing a comment.',
  '',
  `Generated from ${documented.length} documented symbols in ${new Set(documented.map((entry) => entry.file)).size} files.`,
  '',
];

for (const [group, entries] of [...groups].sort()) {
  out.push(`## ${group}`, '');
  let currentFile = '';
  for (const entry of entries.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)) {
    if (entry.file !== currentFile) {
      currentFile = entry.file;
      out.push(`### \`${entry.file}\``, '');
    }
    out.push(`#### ${entry.kind} \`${entry.name}\``, '');
    // Tags become list items; the prose stays as prose, so a wrapped sentence is one
    // paragraph rather than one line per line.
    for (const line of entry.body) out.push(line.startsWith('@') ? `- \`${line}\`` : line);
    out.push('');
  }
}

const target = path.join(ROOT, 'docs/api-reference.md');
fs.writeFileSync(target, `${out.join('\n').trimEnd()}\n`, 'utf8');
console.log(`wrote ${path.relative(ROOT, target).replace(/\\/g, '/')} (${documented.length} symbols)`);
