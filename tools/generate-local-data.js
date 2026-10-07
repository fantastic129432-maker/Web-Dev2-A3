/**
 * tools/generate-local-data.js
 * ---------------------------------------------------------------------------
 * Developer utility (not part of the submitted runtime).
 *
 * It reads database/02_seed.sql and regenerates
 * api/src/repositories/local-data.js, so the offline data source can never
 * drift away from the SQL sample data that the marker runs. Re-run it with:
 *
 *     node tools/generate-local-data.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SEED_FILE = path.join(ROOT, 'database', '02_seed.sql');
const OUT_FILE = path.join(ROOT, 'api', 'src', 'repositories', 'local-data.js');

const WANTED_TABLES = [
  'organizations',
  'categories',
  'locations',
  'events',
  'ticket_types',
  'donations',
  // A3: the offline mirror has to carry the registration rows too, otherwise
  // DATA_SOURCE=local would show an empty registration list on the event page.
  'event_registrations',
];

/** Split "a, b, c" into ['a','b','c'] while ignoring commas inside quotes. */
function splitTopLevel(text) {
  const parts = [];
  let current = '';
  let inQuote = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (char === '\\') {
      current += char + (text[i + 1] || '');
      i += 1;
      continue;
    }

    if (char === "'") {
      inQuote = !inQuote;
      current += char;
      continue;
    }

    if (char === ',' && !inQuote) {
      parts.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  if (current.trim() !== '') parts.push(current.trim());
  return parts;
}

/** Convert one SQL literal into a JavaScript value. */
function parseLiteral(token) {
  const value = token.trim();
  if (/^null$/i.test(value)) return null;
  if (/^'.*'$/s.test(value)) {
    return value
      .slice(1, -1)
      .replace(/''/g, "'")
      .replace(/\\'/g, "'")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }
  const asNumber = Number(value);
  return Number.isNaN(asNumber) ? value : asNumber;
}

/** Find "INSERT INTO <table> (cols) VALUES" ... ";" blocks in the seed file. */
function parseInserts(sql) {
  const result = {};
  const insertPattern = /INSERT\s+INTO\s+([a-z_]+)\s*\(([^)]*)\)\s*VALUES/gi;
  let match;

  while ((match = insertPattern.exec(sql)) !== null) {
    const table = match[1].toLowerCase();
    if (!WANTED_TABLES.includes(table)) continue;

    const columns = splitTopLevel(match[2]).map((c) => c.trim());

    // Walk forward from the end of "VALUES" collecting "(...)" tuples.
    let i = insertPattern.lastIndex;
    const rows = [];
    let inQuote = false;

    while (i < sql.length) {
      const char = sql[i];

      if (char === "'") {
        inQuote = !inQuote;
        i += 1;
        continue;
      }

      if (!inQuote) {
        if (char === ';') break;
        if (char === '-') {
          // skip SQL comments
          if (sql[i + 1] === '-') {
            while (i < sql.length && sql[i] !== '\n') i += 1;
            continue;
          }
          if (sql[i + 1] === '/') {
            const end = sql.indexOf('*/', i);
            i = end === -1 ? sql.length : end + 2;
            continue;
          }
        }
        if (char === '(') {
          // find the matching closing bracket
          let depth = 0;
          let j = i;
          let quoted = false;
          for (; j < sql.length; j += 1) {
            const inner = sql[j];
            if (inner === "'") quoted = !quoted;
            if (!quoted && inner === '(') depth += 1;
            if (!quoted && inner === ')') {
              depth -= 1;
              if (depth === 0) break;
            }
          }
          const tupleText = sql.slice(i + 1, j);
          const values = splitTopLevel(tupleText).map(parseLiteral);
          const row = {};
          columns.forEach((column, index) => {
            row[column] = values[index];
          });
          rows.push(row);
          i = j + 1;
          continue;
        }
      }
      i += 1;
    }

    result[table] = rows;
    insertPattern.lastIndex = i;
  }

  return result;
}

const sql = fs.readFileSync(SEED_FILE, 'utf8');
const data = parseInserts(sql);

const counts = {};
for (const table of WANTED_TABLES) {
  counts[table] = (data[table] || []).length;
}
console.log('Parsed row counts:', counts);

if (counts.events < 8) {
  throw new Error(
    `Only ${counts.events} events parsed - the seed file must contain at least 8.`
  );
}

// A3, Part 1: "Populate the tables with a minimum of 10 registrations in any
// events to provide a realistic dataset for your website." Failing here is
// better than shipping an offline mirror that cannot demonstrate the feature.
if (counts.event_registrations < 10) {
  throw new Error(
    `Only ${counts.event_registrations} registrations parsed - ` +
      'Assessment 3 requires at least 10.'
  );
}

// Every registration must point at an event that exists, exactly as the
// foreign key enforces in MySQL.
{
  const eventIds = new Set((data.events || []).map((row) => row.event_id));
  const orphan = (data.event_registrations || []).find(
    (row) => !eventIds.has(row.event_id)
  );
  if (orphan) {
    throw new Error(
      `Registration ${orphan.registration_id} points at event ` +
        `${orphan.event_id}, which does not exist in the seed data.`
    );
  }
}

const banner = `/**
 * src/repositories/local-data.js
 * ---------------------------------------------------------------------------
 * GENERATED FILE - do not edit by hand.
 * Produced by: node tools/generate-local-data.js
 * Source     : database/02_seed.sql
 *
 * It mirrors the SQL sample data so that the API can run with
 * DATA_SOURCE=local on a machine without a MySQL server. The MySQL database
 * remains the submitted data source; this file exists only so the website can
 * still be demonstrated and marked offline.
 */
'use strict';

`;

const body = WANTED_TABLES.map(
  (table) => `const ${table} = ${JSON.stringify(data[table] || [], null, 2)};\n`
).join('\n');

const footer = `
module.exports = {
${WANTED_TABLES.map((table) => `  ${table},`).join('\n')}
};
`;

fs.writeFileSync(OUT_FILE, banner + body + footer, 'utf8');
console.log('Wrote', OUT_FILE);
