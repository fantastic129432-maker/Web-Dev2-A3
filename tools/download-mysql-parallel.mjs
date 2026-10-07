/**
 * download-mysql-parallel.mjs
 * ---------------------------------------------------------------------------
 * Downloads the official MySQL Community Server ZIP from cdn.mysql.com using
 * several range requests at once.
 *
 * Why: this network throttles a single connection to roughly 0.1-0.3 MB/s, but
 * allows about 0.9 MB/s across eight connections, which turns a 90 minute
 * download into a few minutes. Chunks are written at their exact offsets, so
 * the result is a byte-identical copy of the official archive.
 *
 * Usage:  node tools/download-mysql-parallel.mjs [url] [outputFile]
 */
import fs from 'node:fs';
import path from 'node:path';

const URL =
  process.argv[2] ||
  'https://cdn.mysql.com/Downloads/MySQL-26.7/mysql-26.7.0-winx64.zip';
const OUT_FILE = path.resolve(
  process.argv[3] || '.mysql-install/mysql-26.7.0-winx64.zip'
);

const CONNECTIONS = Number(process.env.DOWNLOAD_CONNECTIONS || 8);
const CHUNK_SIZE = 8 * 1024 * 1024; // 8 MB per request
const MAX_RETRIES = 6;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';

fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });

/* ---------------------------------------------------------------- */
/* 1. Ask the server how big the file is                            */
/* ---------------------------------------------------------------- */
async function probe(url) {
  const response = await fetch(url, {
    headers: { ...{ 'User-Agent': USER_AGENT }, Range: 'bytes=0-0' },
  });
  const contentRange = response.headers.get('content-range') || '';
  if (!response.ok || !contentRange.includes('/')) {
    throw new Error(
      `Server did not answer a range request (HTTP ${response.status}).`
    );
  }
  const total = Number(contentRange.split('/')[1]);
  const acceptRanges = response.headers.get('accept-ranges');
  console.log(`File size     : ${(total / 1048576).toFixed(1)} MB`);
  console.log(`Accept-Ranges : ${acceptRanges || '(not advertised, but ranges work)'}`);
  return total;
}

/* ---------------------------------------------------------------- */
/* 2. Download one chunk, retrying on failure                       */
/* ---------------------------------------------------------------- */
async function downloadChunk(url, start, end, attempt = 1) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Range: `bytes=${start}-${end}` },
      signal: controller.signal,
    });
    if (!response.ok && response.status !== 206) {
      throw new Error(`HTTP ${response.status}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    clearTimeout(timeout);

    if (buffer.length !== end - start + 1) {
      throw new Error(
        `short read: got ${buffer.length} of ${end - start + 1} bytes`
      );
    }
    return buffer;
  } catch (error) {
    clearTimeout(timeout);
    if (attempt >= MAX_RETRIES) {
      throw new Error(
        `chunk ${start}-${end} failed after ${MAX_RETRIES} attempts: ${error.message}`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    return downloadChunk(url, start, end, attempt + 1);
  }
}

/* ---------------------------------------------------------------- */
/* 3. Run the chunks through a small worker pool                    */
/* ---------------------------------------------------------------- */
async function download(url, total, outFile) {
  fs.writeFileSync(outFile, Buffer.alloc(0));
  const handle = fs.openSync(outFile, 'r+');
  fs.ftruncateSync(handle, total);

  const ranges = [];
  for (let start = 0; start < total; start += CHUNK_SIZE) {
    ranges.push({ start, end: Math.min(start + CHUNK_SIZE - 1, total - 1) });
  }

  let nextIndex = 0;
  let completed = 0;
  let bytesDone = 0;
  const startedAt = Date.now();
  let lastReport = 0;
  const failures = [];

  async function worker(workerId) {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= ranges.length) return;

      const { start, end } = ranges[index];
      try {
        const buffer = await downloadChunk(url, start, end);
        fs.writeSync(handle, buffer, 0, buffer.length, start);
        completed += 1;
        bytesDone += buffer.length;

        const now = Date.now();
        if (now - lastReport > 3000 || completed === ranges.length) {
          lastReport = now;
          const secs = (now - startedAt) / 1000;
          const speed = bytesDone / 1048576 / secs;
          const pct = ((bytesDone / total) * 100).toFixed(1);
          const eta = ((total - bytesDone) / 1048576 / (speed || 0.01)) / 60;
          console.log(
            `  ${pct}%  ${(bytesDone / 1048576).toFixed(1)}/${(total / 1048576).toFixed(1)} MB` +
              `  ${speed.toFixed(2)} MB/s  ETA ${eta.toFixed(1)} min`
          );
        }
      } catch (error) {
        failures.push(error.message);
        console.error(`  worker ${workerId}: ${error.message}`);
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONNECTIONS, ranges.length) }, (_, i) => worker(i + 1))
  );
  fs.closeSync(handle);

  if (failures.length > 0) {
    throw new Error(
      `${failures.length} chunk(s) failed. Re-run the script to retry.\n` +
        failures.slice(0, 5).join('\n')
    );
  }

  const secs = (Date.now() - startedAt) / 1000;
  console.log(
    `\nDownloaded ${(total / 1048576).toFixed(1)} MB in ${(secs / 60).toFixed(1)} minutes.`
  );
}

/* ---------------------------------------------------------------- */
/* 4. Verify the ZIP                                                */
/* ---------------------------------------------------------------- */
function verify(file) {
  const stat = fs.statSync(file);
  const handle = fs.openSync(file, 'r');
  const head = Buffer.alloc(4);
  fs.readSync(handle, head, 0, 4, 0);
  const tail = Buffer.alloc(22);
  fs.readSync(handle, tail, 0, 22, Math.max(stat.size - 22, 0));
  fs.closeSync(handle);

  const isZip = head[0] === 0x50 && head[1] === 0x4b;
  // End of central directory record signature.
  const hasEndRecord = tail.readUInt32LE(0) === 0x06054b50;

  console.log(`\nSaved : ${file}`);
  console.log(`Size  : ${(stat.size / 1048576).toFixed(1)} MB`);
  console.log(`Header: ${head.toString('utf8').replace(/[^\x20-\x7e]/g, '.')} (expect PK..)`);
  console.log(`End record present: ${hasEndRecord ? 'yes' : 'NO - file is incomplete'}`);

  if (!isZip || !hasEndRecord) {
    console.error('\nVerification failed. Delete the file and run the script again.');
    process.exit(1);
  }
  console.log('\nVerification passed.');
}

const total = await probe(URL);
await download(URL, total, OUT_FILE);
verify(OUT_FILE);
