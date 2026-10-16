/**
 * tools/tmp-height-probe.mjs -- TEMPORARY (delete when done).
 * Logs every change of documentElement.scrollHeight around the "Get tickets" click
 * and the following wheel gesture, so the growth timeline is a measurement.
 */
import { existsSync } from 'node:fs';
const EDGE = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find((p) => existsSync(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await (await import('puppeteer-core')).default.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 1000 });
await page.evaluateOnNewDocument(() => {
  try { localStorage.setItem('charity-events:language', 'en'); localStorage.setItem('charity-events:theme', 'light'); } catch {}
  window.__h = [];
  window.__mark = (what) => window.__h.push({ t: Math.round(performance.now()), what, h: document.documentElement.scrollHeight, y: window.scrollY });
  let last = document.documentElement.scrollHeight;
  window.__mark('start');
  const sample = () => {
    const h = document.documentElement.scrollHeight;
    if (h !== last) { last = h; window.__mark('HEIGHT'); }
    requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
  window.addEventListener('wheel', () => window.__mark('wheel'), { passive: true, capture: true });
  const original = window.scrollTo;
  window.scrollTo = function (...args) {
    const top = typeof args[0] === 'number' ? args[1] : args[0]?.top;
    window.__h.push({ t: Math.round(performance.now()), what: 'scrollTo', top, h: document.documentElement.scrollHeight, y: window.scrollY, stack: (new Error().stack || '').split('\n')[2]?.trim() });
    return original.apply(window, args);
  };
});

await page.goto('http://127.0.0.1:4200/events/2', { waitUntil: 'networkidle2', timeout: 45000 });
await page.waitForFunction(() => document.getElementById('tickets') !== null, { timeout: 15000 });
await sleep(800);
await page.evaluate(() => { window.__h = []; window.__mark('CLICK'); });
await page.evaluate(() => {
  const el = [...document.querySelectorAll('a')].find((a) => /get tickets/i.test(a.textContent ?? ''));
  el.click();
});
await sleep(1500);
await page.evaluate(() => window.__mark('WHEEL-GESTURE-START'));
await page.mouse.move(700, 500);
for (let i = 0; i < 3; i += 1) { await page.mouse.wheel({ deltaY: -120 }); await sleep(60); }
await sleep(1200);
await page.evaluate(() => window.__mark('END'));
for (const entry of await page.evaluate(() => window.__h)) console.log(JSON.stringify(entry));
await browser.close();
