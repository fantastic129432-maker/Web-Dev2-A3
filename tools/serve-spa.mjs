/**
 * tools/serve-spa.mjs
 * ---------------------------------------------------------------------------
 * A tiny static server for a BUILT Angular application (no dependencies).
 *
 * Why it is needed
 *   An Angular application is a single-page app: the browser requests
 *   /events/2, but no such FILE exists - the router resolves it in JavaScript.
 *   A plain file server answers 404 for every deep link, so a refresh or a
 *   pasted URL appears broken. This server falls back to index.html for a path
 *   that does not name a real file, which is exactly what the cPanel
 *   configuration does in production (see docs/deployment-cpanel.md).
 *
 * Why not `ng serve`?
 *   `ng serve` is the development server and is the right tool while editing.
 *   This one serves the ACTUAL build output, so what is demonstrated locally is
 *   the same artefact the cPanel receives - including baseHref, hashed asset
 *   names and the production/development environment file.
 *
 * Usage:
 *   node tools/serve-spa.mjs <directory> [port]
 *   node tools/serve-spa.mjs dist/clientside 4200
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const directory = process.argv[2];
const port = Number(process.argv[3] ?? 4200);

if (!directory) {
  console.error('Usage: node tools/serve-spa.mjs <directory> [port]');
  process.exit(1);
}

const ROOT = path.resolve(directory);

if (!fs.existsSync(ROOT)) {
  console.error(`The directory ${ROOT} does not exist. Build the application first.`);
  process.exit(1);
}

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

/** Send a file, or 404 when it is not there. */
function sendFile(response, filePath, status = 200) {
  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }
    const type = CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
    response.writeHead(status, {
      'Content-Type': type,
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(content);
  });
}

const server = http.createServer((request, response) => {
  const requestedPath = decodeURIComponent((request.url ?? '/').split('?')[0]);
  const candidate = path.join(ROOT, requestedPath);

  // Never serve anything outside the built application.
  //
  // The comparison is against ROOT PLUS A SEPARATOR. A plain
  // `candidate.startsWith(ROOT)` is a STRING prefix, not a directory boundary, and
  // path.join has already normalised away any `..` in the request - so a sibling
  // directory whose name merely begins with the served directory's name
  // ("site-secret" next to "site") passed the check and its files were served:
  //
  //   GET /../site-secret/secret.txt   -> 200, a file outside the application
  //
  // Demonstrated with a raw HTTP request, which - unlike a browser - sends the
  // path verbatim instead of normalising it first. This server is used only
  // locally and by the test suite, but the fix is one comparison.
  if (candidate !== ROOT && !candidate.startsWith(ROOT + path.sep)) {
    response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Forbidden');
    return;
  }

  // A directory (including "/") means its index.html.
  const target = fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()
    ? path.join(candidate, 'index.html')
    : candidate;

  if (fs.existsSync(target) && fs.statSync(target).isFile()) {
    sendFile(response, target);
    return;
  }

  // No such file. If the request looks like an application route rather than an
  // asset, hand back index.html and let the router resolve it.
  const looksLikeAnAsset = path.extname(requestedPath) !== '';
  if (looksLikeAnAsset) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end(`Not found: ${requestedPath}`);
    return;
  }

  sendFile(response, path.join(ROOT, 'index.html'));
});

server.listen(port, () => {
  console.log(`[web] serving ${ROOT} on http://localhost:${port}/`);
});
