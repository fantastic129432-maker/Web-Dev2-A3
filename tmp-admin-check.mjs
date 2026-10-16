import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const b = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox','--disable-gpu','--disable-dev-shm-usage'] });
for (const url of ['http://127.0.0.1:4300/', 'http://127.0.0.1:4300/events']) {
  const p = await b.newPage();
  await p.setViewport({ width: 1920, height: 1080 });
  await p.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
  await new Promise(r => setTimeout(r, 900));
  const o = await p.evaluate(() => {
    const el = document.querySelector('.page-header');
    const s = el ? getComputedStyle(el) : null;
    return { found: !!el, padding: s && `${s.paddingTop}/${s.paddingRight}/${s.paddingBottom}/${s.paddingLeft}`, bg: s && s.backgroundColor, h: el && Math.round(el.getBoundingClientRect().height*100)/100, w: el && Math.round(el.getBoundingClientRect().width) };
  });
  console.log(url, JSON.stringify(o));
  await p.close();
}
await b.close();
