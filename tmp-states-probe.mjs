/**
 * tmp-states-probe.mjs  (temporary verification harness - deleted after use)
 * Loads the registration page's non-form states, which the breadcrumb move
 * affects (the breadcrumb now renders inside the form banner only).
 *
 * Usage: node tmp-states-probe.mjs
 */
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((candidate) => fs.existsSync(candidate));

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
});

const URLS = [
  'http://127.0.0.1:4200/register',
  'http://127.0.0.1:4200/register/9999',
  'http://127.0.0.1:4200/events/9999',
  'http://127.0.0.1:4200/nope',
];

for (const url of URLS) {
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
  const errors = [];
  tab.on('pageerror', (error) => errors.push(String(error)));
  await tab.goto(url, { waitUntil: 'networkidle2', timeout: 45_000 });
  await new Promise((done) => setTimeout(done, 1200));
  const out = await tab.evaluate(() => ({
    h1: [...document.querySelectorAll('h1')].map((n) => n.textContent.trim()),
    breadcrumbs: document.querySelectorAll('.breadcrumb').length,
    banner: document.querySelectorAll('.page-header').length,
    forms: document.querySelectorAll('form').length,
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    firstHeadingTop: document.querySelector('.state, .confirmation')?.getBoundingClientRect().top ?? null,
    text: document.body.innerText.replace(/\s+/g, ' ').trim().slice(0, 130),
  }));
  console.log(url);
  console.log('   ', JSON.stringify(out));
  if (errors.length) console.log('    ERRORS', errors.join(' | '));
  await tab.close();
}

await browser.close();
