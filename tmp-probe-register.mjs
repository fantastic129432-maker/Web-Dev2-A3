/**
 * Throwaway probe (deleted before the work is finished): loads one page of the
 * running public site in headless Edge and prints what it rendered.
 *
 * Usage: node tmp-probe-register.mjs <url> [language] [theme]
 */
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((candidate) => fs.existsSync(candidate));

const url = process.argv[2] ?? 'http://localhost:4200/register/6';
const language = process.argv[3] ?? 'en';
const theme = process.argv[4] ?? 'light';

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
});

const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 1000 });
await page.evaluateOnNewDocument(
  (lang, chosenTheme) => {
    localStorage.setItem('charity-events:language', lang);
    localStorage.setItem('charity-events:theme', chosenTheme);
  },
  language,
  theme
);

const consoleMessages = [];
page.on('pageerror', (error) => consoleMessages.push(`pageerror: ${error}`));
page.on('console', (message) => {
  if (message.type() === 'error') consoleMessages.push(`console: ${message.text()}`);
});

await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
await new Promise((done) => setTimeout(done, 1500));

const info = await page.evaluate(() => {
  const inputs = [...document.querySelectorAll('input, select, textarea')].map((element) => ({
    tag: element.tagName.toLowerCase(),
    type: element.getAttribute('type'),
    id: element.id,
    name: element.getAttribute('name'),
  }));
  return {
    title: document.title,
    innerText: document.body.innerText,
    inputs,
    dateInputs: document.querySelectorAll('input[type="date"]').length,
    requiredNoticeCount: (document.body.innerText.match(/Please correct the highlighted fields|请修正标出的字段/g) ?? []).length,
  };
});

console.log(JSON.stringify({ url, language, theme, ...info, consoleMessages }, null, 2));
await browser.close();
