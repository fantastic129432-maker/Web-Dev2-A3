/**
 * Throwaway screenshot helper (deleted before the work is finished).
 *
 * Usage: node tmp-shot.mjs <url> <lang> <theme> <width> <height> <outfile> [scrollY] [full]
 */
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((candidate) => fs.existsSync(candidate));

const [url, language, theme, width, height, outfile, scrollY, full] = process.argv.slice(2);

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
});
const page = await browser.newPage();
await page.setViewport({ width: Number(width), height: Number(height) });
await page.evaluateOnNewDocument(
  (lang, chosenTheme) => {
    localStorage.setItem('charity-events:language', lang);
    localStorage.setItem('charity-events:theme', chosenTheme);
  },
  language,
  theme
);
await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
await new Promise((done) => setTimeout(done, 1500));
if (scrollY) {
  await page.evaluate((y) => window.scrollTo(0, Number(y)), scrollY);
  await new Promise((done) => setTimeout(done, 400));
}
await page.screenshot({ path: outfile, fullPage: full === 'full' });
console.log(outfile);
await browser.close();
