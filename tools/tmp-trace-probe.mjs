/**
 * tools/tmp-trace-probe.mjs -- TEMPORARY (delete when done).
 * Reads the temporary TMPTRACE lines the service logs, around a wheel gesture.
 */
import { existsSync } from 'node:fs';
const EDGE = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find((p) => existsSync(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await (await import('puppeteer-core')).default.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 1000 });
await page.evaluateOnNewDocument(() => {
  try { localStorage.setItem('charity-events:language', 'en'); localStorage.setItem('charity-events:theme', 'light'); } catch {}
  window.__traces = [];
  window.addEventListener('wheel', () => window.__traces.push({ t: Math.round(performance.now()), kind: 'WHEEL', y: window.scrollY, h: document.documentElement.scrollHeight }), { passive: true, capture: true });
  window.__log = (line) => window.__traces.push({ t: Math.round(performance.now()), kind: 'line', line });
});
page.on('console', (m) => {
  const text = m.text();
  if (text.startsWith('TMPTRACE')) page.evaluate((line) => window.__log(line), text);
});

await page.goto('http://127.0.0.1:4200/events/2', { waitUntil: 'networkidle2', timeout: 45000 });
await page.waitForFunction(() => document.getElementById('tickets') !== null, { timeout: 15000 });
await sleep(700);
await page.evaluate(() => { window.__traces = []; });
await page.evaluate(() => {
  const el = [...document.querySelectorAll('a')].find((a) => /get tickets/i.test(a.textContent ?? ''));
  el.click();
});
await sleep(1500);
await page.mouse.move(700, 500);
for (let i = 0; i < 3; i += 1) { await page.mouse.wheel({ deltaY: -120 }); await sleep(60); }
await sleep(1500);
const rows = await page.evaluate(() => window.__traces.map((r) => (r.kind === 'line' ? r.line : `>>> WHEEL y=${r.y} h=${r.h}`)));
// Interleave by parsing the timestamp out of each line.
const parsed = rows.map((line) => {
  const m = /t=(\d+)/.exec(line);
  const w = /WHEEL y=(\d+) h=(\d+)/.exec(line);
  return { t: m ? Number(m[1]) : null, line };
});
for (const r of parsed) console.log(r.line);
console.log('final scrollY', await page.evaluate(() => window.scrollY));
await browser.close();
