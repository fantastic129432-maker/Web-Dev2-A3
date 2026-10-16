/**
 * tmp-space-probe.mjs  (temporary verification harness - deleted after use)
 * ---------------------------------------------------------------------------
 * Measures the "space before the content" on the public pages at 1920x1080 in
 * both themes, so the reviewer's claim can be checked with numbers rather than
 * with a screenshot. Run AFTER `npm run build:local`; it reads the served
 * dist/ on http://127.0.0.1:4200.
 *
 * Usage: node tmp-space-probe.mjs <label> [theme] [lang]
 *   label   free text printed with every row ("before" / "after")
 */
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((candidate) => fs.existsSync(candidate));

const label = process.argv[2] ?? 'run';
const onlyTheme = process.argv[3] ?? null;
const onlyLang = process.argv[4] ?? null;

const PAGES = [
  {
    name: '/register/2',
    url: 'http://127.0.0.1:4200/register/2',
    banner: '.page-header',
    card: '.registration-form-card',
    control: '#registration-form input',
    form: '#registration-form',
  },
  {
    name: '/search',
    url: 'http://127.0.0.1:4200/search',
    banner: 'section.page-header',
    card: '.filter-panel',
    control: '#filter-from',
    form: '.filter-panel form',
  },
  {
    name: '/events/2',
    url: 'http://127.0.0.1:4200/events/2',
    banner: '.event-hero',
    card: '.side-column .panel',
    control: '#tickets a, #tickets button',
    form: '#tickets',
  },
  {
    name: '/',
    url: 'http://127.0.0.1:4200/',
    banner: '.hero',
    card: '.stat',
    control: null,
    form: null,
  },
];

const THEMES = onlyTheme ? [onlyTheme] : ['light', 'dark'];
const LANGS = onlyLang === 'all' ? ['en', 'zh', 'vi', 'ja'] : onlyLang ? [onlyLang] : ['en'];

const MEASURE = (config) => {
  const round = (value) => Math.round(value * 100) / 100;

  const parse = (value) => {
    const match = String(value).match(/rgba?\(([^)]+)\)/);
    if (!match) return null;
    const parts = match[1].split(',').map((n) => parseFloat(n));
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
  };
  const over = (top, bottom) => ({
    r: top.r * top.a + bottom.r * (1 - top.a),
    g: top.g * top.a + bottom.g * (1 - top.a),
    b: top.b * top.a + bottom.b * (1 - top.a),
    a: 1,
  });
  const luminance = ({ r, g, b }) => {
    const channel = (v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };
  const ratio = (a, b) => {
    const la = luminance(a);
    const lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };
  const effectiveBackground = (element) => {
    let node = element;
    let result = { r: 255, g: 255, b: 255, a: 1 };
    const stack = [];
    while (node) {
      const bg = parse(getComputedStyle(node).backgroundColor);
      if (bg && bg.a > 0) stack.push(bg);
      if (bg && bg.a === 1) break;
      node = node.parentElement;
    }
    if (node === null) {
      const rootBg = parse(getComputedStyle(document.documentElement).backgroundColor);
      if (rootBg && rootBg.a > 0) stack.push(rootBg);
    }
    for (let i = stack.length - 1; i >= 0; i -= 1) result = over(stack[i], result);
    return result;
  };
  const box = (element) => {
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      top: round(rect.top + window.scrollY),
      bottom: round(rect.bottom + window.scrollY),
      height: round(rect.height),
      width: round(rect.width),
      paddingTop: style.paddingTop,
      paddingBottom: style.paddingBottom,
      marginTop: style.marginTop,
      marginBottom: style.marginBottom,
      background: style.backgroundColor,
      text: (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60),
    };
  };

  const out = { url: location.pathname, title: document.title };
  out.viewport = { width: window.innerWidth, height: window.innerHeight };
  out.scrollHeight = document.documentElement.scrollHeight;
  out.overflowX = document.documentElement.scrollWidth - document.documentElement.clientWidth;
  out.htmlLang = document.documentElement.lang;
  out.theme = document.documentElement.getAttribute('data-theme');

  const banner = document.querySelector(config.banner);
  const card = document.querySelector(config.card);
  const control = config.control ? document.querySelector(config.control) : null;

  out.bannerSelector = config.banner;
  out.bannerFound = Boolean(banner);
  out.banner = box(banner);
  out.cardSelector = config.card;
  out.card = box(card);

  // Where the first form control sits, and how much of the form is on screen.
  out.control = box(control);
  if (config.form) {
    const form = document.querySelector(config.form);
    const controls = [...(form?.querySelectorAll('input, select, textarea, button') ?? [])].filter(
      (node) => node.getBoundingClientRect().height > 0
    );
    const visible = controls.filter((node) => {
      const rect = node.getBoundingClientRect();
      return rect.top >= 0 && rect.top < window.innerHeight;
    });
    out.formControls = controls.length;
    out.formControlsVisibleWithoutScroll = visible.length;
    out.formFirstControlId = controls[0]?.id || controls[0]?.className || '';
    out.controlTops = controls.map((node) => ({
      id: node.id || node.getAttribute('name') || node.className,
      top: round(node.getBoundingClientRect().top + window.scrollY),
    }));
    out.formVisibleHeight = Math.max(
      0,
      Math.min(window.innerHeight, (form?.getBoundingClientRect().bottom ?? 0) + window.scrollY) -
        Math.max(0, form?.getBoundingClientRect().top ?? 0)
    );
    out.formHeight = round(form?.getBoundingClientRect().height ?? 0);
    out.formLabelsVisible = [...(form?.querySelectorAll('label') ?? [])].filter((node) => {
      const rect = node.getBoundingClientRect();
      return rect.top >= 0 && rect.top < window.innerHeight;
    }).length;
  }

  const crumb = document.querySelector('.breadcrumb');
  if (crumb) {
    const crumbBox = box(crumb);
    const colour = parse(getComputedStyle(crumb).color);
    const background = effectiveBackground(crumb);
    const link = crumb.querySelector('a');
    const linkColour = link ? parse(getComputedStyle(link).color) : null;
    out.breadcrumb = {
      ...crumbBox,
      insideBanner: banner ? banner.contains(crumb) : false,
      nav: crumb.tagName,
      ariaLabel: crumb.getAttribute('aria-label'),
      olItems: crumb.querySelectorAll('ol > li').length,
      links: crumb.querySelectorAll('a').length,
      currentPageMarked: crumb.querySelectorAll('[aria-current="page"]').length,
      colour: getComputedStyle(crumb).color,
      linkColour: link ? getComputedStyle(link).color : null,
      backgroundBehind: `rgb(${Math.round(background.r)}, ${Math.round(background.g)}, ${Math.round(background.b)})`,
      selfRatio: round(ratio(colour, background)),
      linkRatio: linkColour ? round(ratio(linkColour, background)) : null,
    };
  } else {
    out.breadcrumb = null;
  }

  // The whole vertical stack above the card, so nothing moves unnoticed.
  out.stack = [...document.querySelectorAll('body > app-root > *, main > *')]
    .slice(0, 8)
    .map((node) => {
      const rect = node.getBoundingClientRect();
      return {
        tag: node.tagName.toLowerCase(),
        cls: String(node.className || '').slice(0, 40),
        top: round(rect.top + window.scrollY),
        height: round(rect.height),
      };
    });

  out.header = box(document.querySelector('.site-header'));
  return out;
};

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
});

const rows = [];
for (const theme of THEMES) {
  for (const lang of LANGS) {
    for (const page of PAGES) {
      const tab = await browser.newPage();
      await tab.setViewport({ width: 1920, height: 1080 });
      await tab.evaluateOnNewDocument(
        (chosenTheme, chosenLang) => {
          try {
            localStorage.setItem('charity-events:theme', chosenTheme);
            localStorage.setItem('charity-events:language', chosenLang);
          } catch {
            /* storage unavailable */
          }
        },
        theme,
        lang
      );
      const errors = [];
      tab.on('pageerror', (error) => errors.push(String(error)));
      await tab.goto(page.url, { waitUntil: 'networkidle2', timeout: 45_000 });
      await new Promise((done) => setTimeout(done, 1200));
      const measured = await tab.evaluate(MEASURE, page);
      rows.push({ label, theme, lang, page: page.name, ...measured, errors });
      await tab.close();
    }
  }
}

await browser.close();

for (const row of rows) {
  const b = row.banner;
  const crumb = row.breadcrumb;
  console.log(
    [
      `[${row.label}] ${row.theme}/${row.lang} ${row.page}`,
      `banner=${b ? `${b.height}px h, top ${b.top}, pad ${b.paddingTop}/${b.paddingBottom}` : 'none'}`,
      `cardTop=${row.card ? row.card.top : 'n/a'}`,
      `controlTop=${row.control ? row.control.top : 'n/a'}`,
      `controlsVisible=${row.formControlsVisibleWithoutScroll ?? 'n/a'}/${row.formControls ?? 'n/a'}`,
      `crumb=${crumb ? `top ${crumb.top} h ${crumb.height} inBanner=${crumb.insideBanner} ratio ${crumb.selfRatio}/${crumb.linkRatio}` : 'none'}`,
      `overflowX=${row.overflowX}`,
      `scrollH=${row.scrollHeight}`,
      row.errors.length ? `ERRORS=${row.errors.join('|')}` : '',
    ]
      .filter(Boolean)
      .join('  |  ')
  );
  if (crumb) {
    console.log(
      `        crumb detail: nav=${crumb.nav} aria-label="${crumb.ariaLabel}" li=${crumb.olItems} links=${crumb.links} aria-current=${crumb.currentPageMarked} colour=${crumb.colour} on ${crumb.backgroundBehind}`
    );
  }
  if (row.stack?.length) {
    console.log(`        stack: ${row.stack.map((s) => `${s.tag}.${s.cls.split(' ')[0]}@${s.top}+${s.height}`).join('  ')}`);
  }
}

const outFile = `tmp-space-probe-${label}.json`;
fs.writeFileSync(outFile, JSON.stringify(rows, null, 2));
console.log(`\nwrote ${outFile}`);
