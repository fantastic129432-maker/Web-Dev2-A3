/**
 * Throwaway measurement (deleted before the work is finished).
 *
 * Steps the scroll from the top of the page to the bottom and, at every step,
 * measures the intersection between the registration page's left summary card
 * and every other element on the page that is neither its ancestor nor its
 * descendant. Prints the maximum overlap and the sticky card's travel.
 *
 * Usage: node tmp-sticky-probe.mjs [url] [width] [height]
 */
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((candidate) => fs.existsSync(candidate));

const url = process.argv[2] ?? 'http://localhost:4200/register/6';
const width = Number(process.argv[3] ?? 1400);
const height = Number(process.argv[4] ?? 1000);

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
});

const page = await browser.newPage();
await page.setViewport({ width, height });
await page.evaluateOnNewDocument(() => {
  localStorage.setItem('charity-events:language', 'en');
  localStorage.setItem('charity-events:theme', 'light');
});
await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
await new Promise((done) => setTimeout(done, 1200));

const report = await page.evaluate(async () => {
  const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
  const card = document.querySelector('.registration-summary');
  if (!card) return { error: 'no .registration-summary found' };
  const layout = document.querySelector('.registration-layout');

  const style = getComputedStyle(card);
  const info = {
    position: style.position,
    top: style.top,
    cardHeight: card.getBoundingClientRect().height,
    cardWidth: card.getBoundingClientRect().width,
    layoutHeight: layout?.getBoundingClientRect().height ?? 0,
    formHeight: document.querySelector('.registration-form-card')?.getBoundingClientRect().height ?? 0,
    rail: Boolean(document.querySelector('.registration-layout .registration-summary')?.parentElement?.classList.contains('rail')),
    maxScroll: document.documentElement.scrollHeight - window.innerHeight,
  };

  const isAncestorOrSelf = (element) => {
    let node = card;
    while (node) {
      if (node === element) return true;
      node = node.parentElement;
    }
    return false;
  };

  const candidates = [...document.querySelectorAll('body *')].filter((element) => {
    if (isAncestorOrSelf(element)) return false; // ancestors and the card itself
    if (card.contains(element)) return false; // descendants of the card
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });

  const steps = [];
  let maxOverlap = 0;
  let worst = null;

  for (let y = 0; y <= info.maxScroll; y += 25) {
    window.scrollTo(0, y);
    await sleep(16);
    const cardRect = card.getBoundingClientRect();
    const step = { y, cardTop: Math.round(cardRect.top * 100) / 100, visible: cardRect.bottom > 0 && cardRect.top < window.innerHeight };

    for (const element of candidates) {
      const rect = element.getBoundingClientRect();
      const overlapX = Math.min(cardRect.right, rect.right) - Math.max(cardRect.left, rect.left);
      const overlapY = Math.min(cardRect.bottom, rect.bottom) - Math.max(cardRect.top, rect.top);
      const area = overlapX > 0 && overlapY > 0 ? overlapX * overlapY : 0;
      if (area > maxOverlap) {
        maxOverlap = area;
        worst = {
          y,
          area: Math.round(area * 100) / 100,
          box: `${(Math.round(overlapX * 100) / 100)} x ${(Math.round(overlapY * 100) / 100)}`,
          tag: element.tagName.toLowerCase(),
          cls: String(element.className || '').slice(0, 60),
          text: (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40),
        };
      }
    }
    steps.push(step);
  }

  const pinned = steps.filter((step) => Math.abs(step.cardTop - 96) < 0.5);
  const visible = steps.filter((step) => step.visible);

  return {
    ...info,
    steps: steps.length,
    maxOverlapArea: Math.round(maxOverlap * 100) / 100,
    worst,
    pinnedFrom: pinned.length ? pinned[0].y : null,
    pinnedTo: pinned.length ? pinned[pinned.length - 1].y : null,
    visibleFrom: visible.length ? visible[0].y : null,
    visibleTo: visible.length ? visible[visible.length - 1].y : null,
    lastCardTop: steps.length ? steps[steps.length - 1].cardTop : null,
  };
});

console.log(JSON.stringify({ url, width, height, report }, null, 2));
await browser.close();
