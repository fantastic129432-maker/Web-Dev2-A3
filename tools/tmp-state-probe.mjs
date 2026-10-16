/**
 * tools/tmp-state-probe.mjs -- TEMPORARY (delete when done).
 * Finds the FragmentScrollService instance by its own shape and logs its internal
 * state around a wheel gesture after clicking "Get tickets".
 */
import { existsSync } from 'node:fs';
const EDGE = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find((p) => existsSync(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await (await import('puppeteer-core')).default.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 1000 });
await page.evaluateOnNewDocument(() => {
  try { localStorage.setItem('charity-events:language', 'en'); localStorage.setItem('charity-events:theme', 'light'); } catch {}
  window.__log = [];
  const originalScrollTo = window.scrollTo;
  window.scrollTo = function (...args) {
    const top = typeof args[0] === 'number' ? args[1] : args[0]?.top;
    window.__log.push({ t: Math.round(performance.now()), what: 'scrollTo', top, y: window.scrollY, h: document.documentElement.scrollHeight,
      stack: (new Error().stack || '').split('\n').slice(1, 4).map((s) => s.trim()).join(' | ') });
    return originalScrollTo.apply(window, args);
  };
  window.addEventListener('wheel', () => {
    window.__log.push({ t: Math.round(performance.now()), what: 'wheel', y: window.scrollY, h: document.documentElement.scrollHeight });
  }, { passive: true, capture: true });
  window.__findService = () => {
    const seen = new Set();
    const scan = (root, depth) => {
      if (!root || depth > 3) return null;
      for (const key of Object.keys(root)) {
        let value;
        try { value = root[key]; } catch { continue; }
        if (!value || typeof value !== 'object' || seen.has(value)) continue;
        seen.add(value);
        if (typeof value.settle === 'function' && 'hasAttempted' in value) return value;
        const found = scan(value, depth + 1);
        if (found) return found;
      }
      return null;
    };
    return scan(window, 0);
  };
});

await page.goto('http://127.0.0.1:4200/events/2', { waitUntil: 'networkidle2', timeout: 45000 });
await page.waitForFunction(() => document.getElementById('tickets') !== null, { timeout: 15000 });
await sleep(800);

const found = await page.evaluate(() => Boolean(window.__findService()));
console.log('service instance found in the page realm:', found);

const dump = () =>
  page.evaluate(() => {
    const s = window.__findService();
    return s
      ? {
          y: window.scrollY,
          h: document.documentElement.scrollHeight,
          t: Math.round(performance.now()),
          hasAttempted: s.hasAttempted,
          userMoved: s.userMoved,
          heightWhenUserMoved: s.heightWhenUserMoved,
          lastHeight: s.lastHeight,
          done: s.done,
          frame: s.frame,
          fragment: s.fragment,
        }
      : { missing: true };
  });

await page.evaluate(() => { window.__log = []; });
await page.evaluate(() => {
  const el = [...document.querySelectorAll('a')].find((a) => /get tickets/i.test(a.textContent ?? ''));
  el.click();
});
await sleep(1500);
console.log('--- after the click ---');
console.log('   ', JSON.stringify(await dump()));

await page.evaluate(() => { window.__log = []; });
await page.mouse.move(700, 500);
for (let i = 0; i < 3; i += 1) {
  await page.mouse.wheel({ deltaY: -120 });
  await sleep(60);
  console.log('   after wheel', i + 1, JSON.stringify(await dump()));
}
await sleep(1000);
console.log('   settled', JSON.stringify(await dump()));
console.log('--- events ---');
for (const e of await page.evaluate(() => window.__log)) console.log('   ', JSON.stringify(e));
await browser.close();
