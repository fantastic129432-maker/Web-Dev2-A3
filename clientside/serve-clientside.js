/**
 * serve-clientside.js
 * ---------------------------------------------------------------------------
 * Tiny static web server for the client-side website (no dependencies).
 *
 * Why it is needed: the pages use ES modules (import/export) and fetch(), and
 * browsers block both when a page is opened directly from the file system
 * (file://), because that is treated as a different origin from the API.
 * Serving the folder over http:// solves both problems.
 *
 * Run from the clientside folder:
 *     node ../serve-clientside.js
 * or from the project root:
 *     node serve-clientside.js
 *
 * Then open http://localhost:5500/index.html
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.CLIENT_PORT || 5500);
const ROOT = path.resolve(__dirname);

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
  '.txt': 'text/plain; charset=utf-8',
};

const server = http.createServer((request, response) => {
  const requestedUrl = decodeURIComponent(request.url.split('?')[0]);
  const relativePath = requestedUrl === '/' ? '/index.html' : requestedUrl;
  const filePath = path.join(ROOT, relativePath);

  // Never serve anything outside the clientside folder.
  if (!filePath.startsWith(ROOT)) {
    response.writeHead(403).end('Forbidden');
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(
        `<h1>404 - not found</h1><p>${relativePath} does not exist in the clientside folder.</p>`
      );
      return;
    }

    const type = CONTENT_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    response.writeHead(200, {
      'Content-Type': type,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(content);
  });
});

server.listen(PORT, () => {
  console.log('----------------------------------------------------------');
  console.log(' Charity events client-side website');
  console.log(` Serving folder : ${ROOT}`);
  console.log(` Open           : http://localhost:${PORT}/index.html`);
  console.log(' The API must also be running on http://localhost:3000');
  console.log('----------------------------------------------------------');
});
