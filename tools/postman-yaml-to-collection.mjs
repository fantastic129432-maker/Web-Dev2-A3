/**
 * postman-yaml-to-collection.mjs
 * ---------------------------------------------------------------------------
 * Turns Postman 12's local YAML layout back into a standard Postman Collection
 * v2.1 JSON file.
 *
 * Why this exists: importing the collection into Postman converts it to the
 * YAML format shown below and REMOVES the source JSON. That JSON is a submission
 * artefact - the brief asks for an exported collection in the zip - so it has to
 * be regenerated. Rebuilding it from the files on disk (rather than retyping it)
 * keeps the export faithful to what Postman actually holds.
 *
 * The layout it reads:
 *   <collection>/.resources/definition.yaml          description, variables
 *   <collection>/<Folder>/.resources/definition.yaml description, order
 *   <collection>/<Folder>/<Request>.request.yaml     the request itself
 *
 * Usage:
 *   node tools/postman-yaml-to-collection.mjs <collectionDir> <outFile>
 */
import fs from 'node:fs';
import path from 'node:path';

/* =====================================================================
 * A small YAML reader, covering only what Postman writes:
 * nested block mappings, block sequences, literal blocks (|- and |),
 * quoted and plain scalars, flow sequences, and comments.
 * ===================================================================== */

/** Strip a trailing comment that is not inside quotes. */
function stripComment(line) {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === "'" && !inDouble) inSingle = !inSingle;
    else if (char === '"' && !inSingle) inDouble = !inDouble;
    else if (char === '#' && !inSingle && !inDouble && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(0, i);
    }
  }
  return line;
}

function parseScalar(text) {
  const value = text.trim();
  if (value === '' || value === '~' || value === 'null') return null;
  if (value === '""') return '';

  if (value.startsWith('"') && value.endsWith('"') && value.length > 1) {
    return value
      .slice(1, -1)
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }
  if (value.startsWith("'") && value.endsWith("'") && value.length > 1) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1).trim();
    if (inner === '') return [];
    return inner.split(',').map((part) => parseScalar(part));
  }
  if (/^-?\d+$/.test(value)) return Number(value);
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}

function parseYaml(source) {
  const lines = source.split(/\r?\n/);

  /** Read a block scalar (|, |-, >, >-) starting after the marker line. */
  function readBlockScalar(startIndex, indent, chomp) {
    const collected = [];
    let i = startIndex;
    while (i < lines.length) {
      const raw = lines[i];
      if (raw.trim() === '') {
        collected.push('');
        i += 1;
        continue;
      }
      const currentIndent = raw.length - raw.trimStart().length;
      if (currentIndent <= indent) break;
      collected.push(raw.slice(indent + 2));
      i += 1;
    }
    let text = collected.join('\n');
    if (chomp !== '-') text += '\n';
    return { value: text.replace(/\n+$/, chomp === '-' ? '' : '\n'), next: i };
  }

  function parseBlock(index, indent) {
    let i = index;
    const container = { isArray: null, items: [], entries: [] };

    while (i < lines.length) {
      const rawLine = lines[i];
      const withoutComment = stripComment(rawLine);
      if (withoutComment.trim() === '') {
        i += 1;
        continue;
      }

      const lineIndent = withoutComment.length - withoutComment.trimStart().length;
      if (lineIndent < indent) break;
      if (lineIndent > indent) {
        // A nested block is consumed by its parent key handler.
        i += 1;
        continue;
      }

      const line = withoutComment.trim();

      // Sequence entry: "- something"
      if (line.startsWith('- ') || line === '-') {
        if (container.isArray === null) container.isArray = true;
        const rest = line === '-' ? '' : line.slice(2).trim();

        if (rest === '') {
          const nested = parseBlock(i + 1, indent + 2);
          container.items.push(nested.isArray ? nested.items : Object.fromEntries(nested.entries));
          i = nested.next;
          continue;
        }

        const inlineKey = rest.match(/^([A-Za-z0-9_$.\-]+):\s*(.*)$/);
        if (inlineKey) {
          // A mapping that begins on the dash line.
          const entry = {};
          const nestedForValue = parseBlockFromValue(i, indent + 2, inlineKey[1], inlineKey[2], entry);
          i = nestedForValue.next;
          container.items.push(entry);
          continue;
        }

        container.items.push(parseScalar(rest));
        i += 1;
        continue;
      }

      // Mapping entry: "key: value" or "key:"
      const keyMatch = line.match(/^([A-Za-z0-9_$.\-]+):\s*(.*)$/);
      if (keyMatch) {
        if (container.isArray === null) container.isArray = false;
        const key = keyMatch[1];
        const rawValue = keyMatch[2].trim();

        if (rawValue === '' || rawValue === '|' || rawValue === '|-' || rawValue === '>' || rawValue === '>-') {
          if (rawValue.startsWith('|') || rawValue.startsWith('>')) {
            const folded = rawValue.startsWith('>');
            const chomp = rawValue.endsWith('-') ? '-' : '';
            const block = readBlockScalar(i + 1, indent, chomp);
            container.entries.push([
              key,
              folded ? block.value.replace(/\n/g, ' ') : block.value,
            ]);
            i = block.next;
            continue;
          }
          // Nested block, or nothing at all.
          const nested = parseBlock(i + 1, indent + 2);
          const value =
            nested.isArray === null
              ? null
              : nested.isArray
                ? nested.items
                : Object.fromEntries(nested.entries);
          container.entries.push([key, value]);
          i = nested.next;
          continue;
        }

        container.entries.push([key, parseScalar(rawValue)]);
        i += 1;
        continue;
      }

      i += 1;
    }

    return { isArray: container.isArray, items: container.items, entries: container.entries, next: i };
  }

  /**
   * Handle a "- key: value" line where the value may itself be a nested block
   * spanning the following, more indented lines.
   */
  function parseBlockFromValue(dashIndex, indent, firstKey, firstValue, target) {
    const collected = parseBlock(dashIndex + 1, indent);
    if (firstValue !== '') {
      target[firstKey] = parseScalar(firstValue);
    } else {
      target[firstKey] =
        collected.isArray === null
          ? null
          : collected.isArray
            ? collected.items
            : Object.fromEntries(collected.entries);
      for (const [key, value] of collected.entries) {
        if (!(key in target)) target[key] = value;
      }
      return { next: collected.next };
    }
    for (const [key, value] of collected.entries) {
      if (!(key in target)) target[key] = value;
    }
    return { next: collected.next };
  }

  const root = parseBlock(0, 0);
  return root.isArray ? root.items : Object.fromEntries(root.entries);
}

/* =====================================================================
 * Convert the Postman layout into Collection v2.1
 * ===================================================================== */

function readYamlFile(file) {
  if (!fs.existsSync(file)) return null;
  return parseYaml(fs.readFileSync(file, 'utf8'));
}

/** Build one request item from a .request.yaml file. */
function buildRequest(request) {
  const rawUrl = request.url || '';
  const withoutOrigin = rawUrl.replace(/^\{\{baseUrl\}\}/, '');
  const [pathPart, queryPart] = withoutOrigin.split('?');

  const query = (request.queryParams || []).map((param) => ({
    key: String(param.key),
    value: String(param.value ?? ''),
    ...(param.description ? { description: String(param.description) } : {}),
  }));

  // If the query string carries parameters the structured list missed, derive
  // them so nothing is lost on a re-import.
  if (queryPart && query.length === 0) {
    for (const pair of queryPart.split('&')) {
      const [key, value = ''] = pair.split('=');
      if (key) query.push({ key, value });
    }
  }

  const header = Object.entries(request.headers || {}).map(([key, value]) => ({
    key,
    value: String(value),
    type: 'text',
  }));

  /*
   * Every script block is carried over, in the order Postman wrote them.
   *
   * Only afterResponse blocks were copied at first, which was invisible while
   * the collection had no pre-request script: the generated JSON matched what
   * Postman held. The Assessment 3 requests need one (the run id that makes the
   * attendee email unique), and a beforeRequest block that is dropped here
   * would make the exported collection behave differently from the one that was
   * tested - the body would keep a literal {{postmanRunId}} and the API would
   * answer 400.
   */
  const SCRIPT_LISTENERS = {
    beforeRequest: 'prerequest',
    afterResponse: 'test',
  };

  const events = (request.scripts || [])
    .filter((script) => SCRIPT_LISTENERS[script.type])
    .map((script) => ({
      listen: SCRIPT_LISTENERS[script.type],
      script: {
        type: script.language || 'text/javascript',
        exec: String(script.code || '').replace(/\n$/, '').split('\n'),
      },
    }));

  return {
    name: request.name,
    ...(request.description ? { description: String(request.description) } : {}),
    request: {
      method: request.method || 'GET',
      header,
      ...(request.body ? { body: request.body } : {}),
      url: {
        raw: rawUrl,
        host: ['{{baseUrl}}'],
        path: pathPart.split('/').filter(Boolean),
        ...(query.length ? { query } : {}),
      },
      ...(request.description ? { description: String(request.description) } : {}),
    },
    ...(events.length ? { event: events } : {}),
    ...(request.order !== undefined ? { _order: request.order } : {}),
  };
}

/** Walk one folder of the Postman layout. */
function buildFolder(folderPath, name) {
  const definition = readYamlFile(path.join(folderPath, '.resources', 'definition.yaml')) || {};
  const items = [];

  for (const entry of fs.readdirSync(folderPath, { withFileTypes: true })) {
    if (entry.name === '.resources') continue;
    const full = path.join(folderPath, entry.name);

    if (entry.isDirectory()) {
      items.push(buildFolder(full, entry.name));
      continue;
    }
    if (entry.name.endsWith('.request.yaml')) {
      const request = readYamlFile(full);
      if (request) items.push(buildRequest(request));
    }
  }

  items.sort((a, b) => (a._order ?? 0) - (b._order ?? 0));

  return {
    name,
    ...(definition.description ? { description: String(definition.description) } : {}),
    item: items.map((item) => {
      if (item._order !== undefined) {
        const { _order, ...rest } = item;
        return rest;
      }
      return item;
    }),
    ...(definition.order !== undefined ? { _order: definition.order } : {}),
  };
}

/* =====================================================================
 * Entry point
 * ===================================================================== */

const collectionDir = process.argv[2];
const outFile = process.argv[3];
if (!collectionDir || !outFile) {
  console.error('usage: node tools/postman-yaml-to-collection.mjs <collectionDir> <outFile>');
  process.exit(1);
}

const rootDefinition = readYamlFile(path.join(collectionDir, '.resources', 'definition.yaml'));
if (!rootDefinition) {
  console.error(`no .resources/definition.yaml inside ${collectionDir}`);
  process.exit(1);
}

const folders = [];
for (const entry of fs.readdirSync(collectionDir, { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.name === '.resources') continue;
  folders.push(buildFolder(path.join(collectionDir, entry.name), entry.name));
}
folders.sort((a, b) => (a._order ?? 0) - (b._order ?? 0));

const collection = {
  info: {
    name: path.basename(collectionDir),
    ...(rootDefinition.description ? { description: String(rootDefinition.description) } : {}),
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  variable: Object.entries(rootDefinition.variables || {}).map(([key, value]) => ({
    key,
    value: String(value ?? ''),
    type: 'string',
  })),
  item: folders.map((folder) => {
    const { _order, ...rest } = folder;
    return rest;
  }),
};

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, `${JSON.stringify(collection, null, 2)}\n`, 'utf8');

/* ---- report what was produced ------------------------------------- */
let requests = 0;
let assertions = 0;
const count = (items) => {
  for (const item of items) {
    if (item.item) {
      count(item.item);
      continue;
    }
    requests += 1;
    for (const event of item.event || []) {
      assertions += (event.script.exec || []).filter((line) => line.includes('pm.test')).length;
    }
  }
};
count(collection.item);

console.log(`collection : ${collection.info.name}`);
console.log(`folders    : ${collection.item.length}`);
console.log(`variables  : ${collection.variable.map((v) => v.key).join(', ')}`);
console.log(`requests   : ${requests}`);
console.log(`assertions : ${assertions}`);
console.log(`written    : ${outFile}`);

/*
 * The report walks the tree rather than assuming one level of folders.
 * Assessment 3 groups its requests under a folder of its own, so a shallow
 * walk met a folder where it expected a request and threw
 * "Cannot read properties of undefined (reading 'method')" - after the JSON had
 * already been written, which made it look as though the export had failed.
 */
const describe = (items, depth) => {
  const indent = '  '.repeat(depth);
  for (const item of items) {
    if (item.item) {
      console.log(`${indent}[${item.name}] ${item.item.length} item(s)`);
      describe(item.item, depth + 1);
      continue;
    }
    const n = (item.event || []).reduce(
      (sum, e) => sum + (e.script.exec || []).filter((l) => l.includes('pm.test')).length,
      0
    );
    console.log(`${indent}  ${item.request.method.padEnd(5)} ${item.name}${n ? `  (${n} assertions)` : ''}`);
  }
};
describe(collection.item, 0);
