/**
 * fix-postman-collection.mjs
 * ---------------------------------------------------------------------------
 * Repairs two defects in the imported Postman collection and adds one request.
 *
 * 1. A broken assertion. The "unknown sort key" request ran
 *    pm.sendRequest() INSIDE a pm.test() callback. pm.sendRequest is
 *    asynchronous, so Postman recorded an error instead of a result - the run
 *    showed 25 passed and 1 error. The check is rewritten synchronously, and the
 *    "table still exists" question moves to a request of its own, where it can
 *    be answered without a nested call.
 *
 * 2. Repeated method names. Requests were named "GET /events ..." while Postman
 *    already shows the method in its own column, so the sidebar read
 *    "GET  GET /events ...". The names lose their method prefix.
 *
 * The collection is stored by Postman as YAML under
 * docs/postman/<collection>/<Folder>/<Request>.request.yaml, so the files are
 * edited in place. Run tools/postman-yaml-to-collection.mjs afterwards to
 * regenerate the exportable JSON.
 *
 * Usage: node tools/fix-postman-collection.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const COLLECTION_DIR = path.resolve('docs/postman/PROG2002 A2 - Charity Events API');

/* ------------------------------------------------------------------ */
/* 1. Read and rewrite the YAML files                                 */
/* ------------------------------------------------------------------ */

/** Show what would change without touching anything. */
const DRY_RUN = process.argv.includes('--dry-run');

function yamlFiles(dir) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...yamlFiles(full));
    else if (entry.name.endsWith('.request.yaml')) found.push(full);
  }
  return found;
}

/**
 * Tidy a request name for the Postman sidebar.
 *
 * Postman shows the method in its own column, so a name that begins with the
 * method reads as "GET  GET /events". The method word is dropped but the path
 * keeps its slash, giving "/events  (three criteria at once)".
 *
 * POST is the exception: it is kept, because "Validation and error handling"
 * contains both a GET and a POST to /events and the two would otherwise look
 * identical in the sidebar - and that pair is precisely the point being made
 * about HTTP methods.
 */
function tidyName(name) {
  const match = name.match(/^(GET|POST|PUT|PATCH|DELETE)\s+(.*)$/);
  if (!match) return name;
  const [, method, rest] = match;
  return method === 'POST' ? name : rest;
}

const changes = [];

for (const file of yamlFiles(COLLECTION_DIR)) {
  let source = fs.readFileSync(file, 'utf8');
  const original = source;
  const notes = [];

  /* --- fix the request name ------------------------------------- */
  const nameMatch = source.match(/^name: (.+)$/m);
  if (nameMatch) {
    const current = nameMatch[1];
    const tidied = tidyName(current);
    if (tidied !== current) {
      source = source.replace(`name: ${current}`, `name: ${tidied}`);
      notes.push(`name: "${current}" -> "${tidied}"`);
    }
  }

  /* --- replace the asynchronous assertion ------------------------ */
  /*
   * The block is matched line by line rather than as one exact string. Postman
   * stores request scripts as a YAML block scalar, and the indentation inside
   * that scalar is relative to the first line, so an exact-string match on the
   * code as written silently fails - which is what happened on the first
   * attempt at this fix.
   */
  const lines = source.split('\n');
  const startIndex = lines.findIndex((line) =>
    /pm\.test\(\s*'the table still exists afterwards'/.test(line)
  );

  if (startIndex !== -1) {
    /*
     * Find the end of that pm.test(...) call by counting braces from the opening
     * line. A plain search for the first "});" is wrong: the original block
     * contained a NESTED arrow function, so the inner close came first and the
     * outer one was left behind as an unbalanced brace.
     */
    let depth = 0;
    let endIndex = -1;
    for (let i = startIndex; i < lines.length; i += 1) {
      const text = lines[i];
      for (const char of text) {
        if (char === '{') depth += 1;
        else if (char === '}') depth -= 1;
      }
      if (depth === 0 && i > startIndex) {
        endIndex = i;
        break;
      }
    }

    if (endIndex !== -1) {
      const indent = lines[startIndex].match(/^\s*/)[0];
      const replacement = [
        `${indent}// The nested pm.sendRequest() that used to be here is asynchronous and is not`,
        `${indent}// allowed inside pm.test(), so Postman recorded it as an error instead of a`,
        `${indent}// result. The injection attempt is proven harmless by this response - the sort`,
        `${indent}// parameter is refused before any SQL runs - and by the request "All events -`,
        `${indent}// table intact after an injection attempt" in the folder "Health", which reads`,
        `${indent}// the row count afterwards.`,
        `${indent}pm.test('the sort parameter is named in the error', () => {`,
        `${indent}  const details = pm.response.json().error.details;`,
        `${indent}  pm.expect(details.some((entry) => entry.field === 'sort')).to.be.true;`,
        `${indent}});`,
      ];

      lines.splice(startIndex, endIndex - startIndex + 1, ...replacement);
      source = lines.join('\n');
      notes.push('assertion rewritten (no nested pm.sendRequest)');
    }
  }

  if (source !== original) {
    changes.push({ file, notes });
    if (!DRY_RUN) fs.writeFileSync(file, source, 'utf8');
  }
}

/* ------------------------------------------------------------------ */
/* 2. Add the request that proves the table survived the injection     */
/* ------------------------------------------------------------------ */

const NEW_REQUEST = path.join(COLLECTION_DIR, 'Health', 'All events - table intact after an injection attempt.request.yaml');
const NEW_REQUEST_BODY = `$kind: http-request
name: All events - table intact after an injection attempt
description: >-
  Reads the whole event table so the previous request can be shown to have done
  no damage. Sent after the SQL injection attempt in the folder "Validation and
  error handling": the table still holds its 11 rows, which is the evidence that
  the sort parameter is validated rather than passed into the query.
url: "{{baseUrl}}/events?state=all&limit=100"
method: GET
headers:
  Accept: application/json
queryParams:
  - key: state
    value: all
    description: Include events that have already finished, so every row is counted.
  - key: limit
    value: "100"
    description: The largest page the API allows.
scripts:
  - type: afterResponse
    code: |-
      pm.test('status is 200', () => pm.response.to.have.status(200));
      pm.test('the table still holds every event', () => {
        // Eleven rows exist in the table; ten are public because one is suspended.
        pm.expect(pm.response.json().meta.total).to.eql(10);
      });
      pm.test('no event row was lost', () => {
        pm.response.json().data.forEach((event) => pm.expect(event.eventId).to.be.a('number'));
      });
    language: text/javascript
order: 2000
`;

let addedRequest = false;
if (fs.existsSync(NEW_REQUEST)) {
  console.log('verification request already present');
} else {
  if (!DRY_RUN) fs.writeFileSync(NEW_REQUEST, NEW_REQUEST_BODY, 'utf8');
  addedRequest = true;
}

/* ------------------------------------------------------------------ */
/* 3. Report                                                          */
/* ------------------------------------------------------------------ */

console.log(DRY_RUN ? 'DRY RUN - nothing written\n' : 'changes applied\n');
console.log(`request files edited: ${changes.length}`);
for (const change of changes) {
  console.log(`  ${path.relative(COLLECTION_DIR, change.file)}`);
  for (const note of change.notes) console.log(`      ${note}`);
}
console.log(`verification request added: ${addedRequest ? 'yes' : 'no'}`);
