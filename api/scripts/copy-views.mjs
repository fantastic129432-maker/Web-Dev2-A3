/**
 * scripts/copy-views.mjs
 * ---------------------------------------------------------------------------
 * Build helper: tsc compiles TypeScript, it does not copy static assets, so the
 * landing page (src/views/api-index.html) would be missing from api/dist.
 *
 * This copies it next to the compiled entry point, i.e.
 * src/views/api-index.html -> dist/src/views/api-index.html.
 *
 * It is belt-and-braces only: server.ts resolves the page from the API root
 * (the folder holding package.json, found by walking up from the compiled
 * file), which is correct whether the app runs from api/ or from api/dist/.
 * The copy covers a deployment that ships api/dist on its own, without the
 * TypeScript sources beside it.
 */
import { cpSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const apiRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(apiRoot, 'src', 'views');
const to = join(apiRoot, 'dist', 'src', 'views');

if (existsSync(from)) {
  cpSync(from, to, { recursive: true });
  console.log(`Copied static views: ${from} -> ${to}`);
} else {
  console.warn(`No static views folder at ${from} - nothing to copy.`);
}
