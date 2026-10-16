/**
 * tools/tmp-window-probe.mjs -- TEMPORARY (delete when done).
 * Repeated wheel-up gestures at increasing delays after the "Get tickets" click on
 * /events/2, so the whole reach of the old "frozen" window is characterised:
 * when does a wheel-up move the page and keep it?
 */
import { existsSync } from 'node:fs';
const EDGE = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find((p) => existsSync(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await (await import('puppeteer-core')).default.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 1000 });
await page.evaluateOnNewDocument(() => {
  try { localStorage.setItem('charity-events:language', 'en'); localStorage.setItem('charity-events:theme', 'light'); } catch {}
  window.__calls = [];
  const original = window.scrollTo;
  window.scrollTo = function (...args) {
    const top = typeof args[0] === 'number' ? args[1] : args[0]?.top;
    window.__calls.push({ t: Math.round(performance.now()), top, y: window.scrollY, stack: (new Error().stack || '').split('\n')[3]?.trim() });
    return original.apply(window, args);
  };
});

for (const delay of [600, 1500, 2500, 3500, 5000]) {
  await page.goto('http://127.0.0.1:4200/events/2', { waitUntil: 'networkidle2', timeout: 45000 });
  await page.waitForFunction(() => document.getElementById('tickets') !== null, { timeout: 15000 });
  await sleep(700);
  await page.evaluate(() => { window.__calls = []; });
  const box = await page.evaluate(() => {
    const el = [...document.querySelectorAll('a')].find((a) => /get tickets/i.test(a.textContent ?? ''));
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.click(box.x, box.y);
  await sleep(delay);
  const landed = await page.evaluate(() => window.scrollY);
  const heightAtGesture = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.mouse.move(700, 500);
  for (let i = 0; i < 3; i += 1) { await page.mouse.wheel({ deltaY: -120 }); await sleep(60); }
  const immediate = await page.evaluate(() => window.scrollY);
  await sleep(1200);
  const settled = await page.evaluate(() => window.scrollY);
  const calls = await page.evaluate(() => window.__calls.filter((c) => c.top > 0).map((c) => `${c.t}ms top=${c.top} from ${c.y}`));
  const heightEnd = await page.evaluate(() => document.documentElement.scrollHeight);
  console.log(
    `delay ${String(delay).padStart(4)}ms: landed ${landed} | height at gesture ${heightAtGesture} -> ${heightEnd} | wheel-up ${landed} -> ${immediate} immediate -> ${settled} settled | watcher scrolls: ${calls.length ? calls.join('; ') : 'none'}`
  );
}
await browser.close();
