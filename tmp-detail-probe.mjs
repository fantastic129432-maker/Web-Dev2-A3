/**
 * tmp-detail-probe.mjs  (temporary verification harness - deleted after use)
 * Dumps the exact vertical stack on /register/2 and /search so the fix can be
 * designed against measured numbers, and writes full-page and above-the-fold
 * screenshots at 1920x1080.
 *
 * Usage: node tmp-detail-probe.mjs <label>
 */
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((candidate) => fs.existsSync(candidate));

const label = process.argv[2] ?? 'detail';
const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
});

const PAGES = [
  { name: 'register', url: 'http://127.0.0.1:4200/register/2' },
  { name: 'search', url: 'http://127.0.0.1:4200/search' },
  { name: 'event', url: 'http://127.0.0.1:4200/events/2' },
];

for (const page of PAGES) {
  const tab = await browser.newPage();
  await tab.setViewport({ width: 1920, height: 1080 });
  await tab.evaluateOnNewDocument(() => {
    try {
      localStorage.setItem('charity-events:theme', 'light');
      localStorage.setItem('charity-events:language', 'en');
    } catch {
      /* ignore */
    }
  });
  await tab.goto(page.url, { waitUntil: 'networkidle2', timeout: 45_000 });
  await new Promise((done) => setTimeout(done, 1200));

  const dump = await tab.evaluate(() => {
    const round = (v) => Math.round(v * 100) / 100;
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return {
        sel: `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${String(el.className || '').split(' ').filter(Boolean).join('.')}`,
        top: round(r.top + window.scrollY),
        height: round(r.height),
        mb: s.marginBottom,
        mt: s.marginTop,
        pt: s.paddingTop,
        pb: s.paddingBottom,
        fs: s.fontSize,
        lh: s.lineHeight,
        text: (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40),
      };
    };

    const out = {};
    const banner = document.querySelector('.page-header') ?? document.querySelector('.event-hero');
    out.bannerChain = [];
    if (banner) {
      out.bannerChain.push(box(banner));
      for (const child of banner.children) {
        out.bannerChain.push(box(child));
        for (const grand of child.children) out.bannerChain.push(box(grand));
      }
    }
    out.beforeBanner = [...document.querySelectorAll('main > *')].map(box);
    out.firstBlock = box(document.querySelector('app-register-page > div, app-search-page > section, app-event-detail-page > div'));
    return out;
  });

  console.log(`\n===== ${page.name} =====`);
  for (const row of dump.bannerChain ?? []) {
    console.log(
      `  ${row.top.toString().padStart(8)}  h=${String(row.height).padStart(7)}  mt=${String(row.mt).padStart(6)} mb=${String(row.mb).padStart(6)} pt=${String(row.pt).padStart(6)} pb=${String(row.pb).padStart(6)} fs=${row.fs.padStart(6)} lh=${row.lh.padStart(7)}  ${row.sel}  "${row.text}"`
    );
  }
  console.log('  --- main children ---');
  for (const row of dump.beforeBanner ?? []) {
    console.log(`  ${row.top.toString().padStart(8)}  h=${String(row.height).padStart(7)}  ${row.sel}`);
  }

  await tab.screenshot({ path: `tmp-shots/${label}-${page.name}-fold.png`, clip: { x: 0, y: 0, width: 1920, height: 1080 } });
  await tab.screenshot({ path: `tmp-shots/${label}-${page.name}-full.png`, fullPage: true });
  await tab.close();
}

await browser.close();
console.log(`\nwrote tmp-shots/${label}-*.png`);
