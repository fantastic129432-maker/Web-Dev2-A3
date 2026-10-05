/**
 * find-encoding-damage.mjs
 * ---------------------------------------------------------------------------
 * Finds text that was mangled by a round trip through Windows PowerShell's
 * Set-Content, which reads a UTF-8 file as ANSI and writes the mojibake back.
 *
 * The signature is the UTF-8 byte sequence for a character being decoded as
 * GBK/CP936, which turns box drawing and CJK characters into runs of characters
 * from the CJK block and Latin-1 punctuation. A box-drawing "tree branch"
 * character, for example, comes back as a pair of CJK characters, and a short
 * Chinese phrase comes back as a run of unrelated ones. The characters to look
 * for are listed by code point below rather than shown here, because writing
 * them in this comment would make the file flag itself.
 *
 * It reports every line that contains such a pattern, with the file and line
 * number, so the damage can be repaired rather than guessed at.
 *
 * Usage: node tools/find-encoding-damage.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

/** Files worth scanning: markdown, JavaScript, HTML, CSS, SQL, batch, YAML. */
const EXTENSIONS = new Set([
  '.md', '.js', '.mjs', '.html', '.css', '.sql', '.cmd', '.ps1', '.json', '.yaml', '.yml', '.txt',
]);

/** Directories to skip. */
const SKIP = new Set(['node_modules', '.git', '.shots', 'mysql', '.mysql-install']);

/**
 * Mojibake markers.
 *
 * The characters below belong to the CJK blocks and appear only when UTF-8 bytes
 * have been read as GBK and written back, so a box-drawing character or a short
 * Chinese word is replaced by a run of them.
 *
 * They are written as code points rather than literals for two reasons: a file
 * that contains the marker sequences would flag itself (which is exactly what
 * happened on the first run of this tool), and the intent is clearer when the
 * characters are named.
 */
const DAMAGE_CODEPOINTS = [
  0x9239, 0x923a, 0x923b, 0x9249, 0x9225, 0x9227, 0x9229, 0x922b, // the box-drawing family
  0x922d, 0x922f, 0x9231, 0x9233, 0x9235, 0x9237, 0x923c, 0x923f,
  0x93c7, 0x93cf, 0x93d3, 0x93d5, 0x93d7, 0x93d9, 0x93db, 0x94a2, // and its neighbours
  0x9522, 0x9523, 0x9524, 0x9525, 0x9527, 0x9529, 0x952b, 0x9531,
  0x9573, 0x94ee, 0x94ef, 0x94f1, 0x94f3, 0x94f6, 0x94fa, 0x94fc,
  // Frequently mangled Chinese words, written as escapes so this file does not
  // contain the sequences it looks for: \u9382 \u935c \u9a9e \u93c8 \u93c3
  // \u945b \u9428 \u6d93 (tree, with, thousand, chain, clan, and so on).
  0x9382, 0x935c, 0x9a9e, 0x93c8, 0x93c3, 0x945b, 0x9428, 0x6d93,
  0x9476, 0x6d5c, 0x93c4, 0x93e2, 0x9499, 0x94dc, 0x7ecb, 0x9374,
  0x9314, 0x9275,
];

/** Vietnamese and Japanese text is legitimate here, so only the test above is used. */
const DAMAGE_PATTERN = new RegExp(
  `[${DAMAGE_CODEPOINTS.map((code) => `\\u{${code.toString(16)}}`).join('')}]`,
  'u'
);

const problems = [];

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      walk(full);
      continue;
    }
    if (!EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;

    const buffer = fs.readFileSync(full);

    // A UTF-8 BOM is harmless but worth knowing about for .md and .js.
    const text = buffer.toString('utf8');
    const lines = text.split(/\r?\n/);

    lines.forEach((line, index) => {
      if (DAMAGE_PATTERN.test(line)) {
        problems.push({
          file: path.relative(process.cwd(), full),
          line: index + 1,
          text: line.trim().slice(0, 100),
        });
      }
    });
  }
}

walk(process.cwd());

console.log(`scanned extensions: ${[...EXTENSIONS].join(' ')}`);
console.log(`damaged lines found: ${problems.length}\n`);

for (const problem of problems) {
  console.log(`${problem.file}:${problem.line}`);
  console.log(`    ${problem.text}`);
}

if (problems.length > 0) {
  process.exitCode = 1;
}
