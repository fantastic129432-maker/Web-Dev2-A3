/**
 * check-contrast.mjs
 * ---------------------------------------------------------------------------
 * Measures the real text contrast of every page in both themes, in a real
 * Chromium browser, and reports anything below the WCAG 2.1 minimum.
 *
 * Why this exists: the dark theme works by inverting brand tokens. A component
 * that used a brand token as a BACKGROUND while painting light text was
 * therefore designed for a dark surface, and becomes unreadable once the token
 * flips. The footer was one such case; buttons were another. Eyeballing a
 * screenshot misses the rest, so this walks the rendered DOM instead.
 *
 * Thresholds (WCAG 2.1 AA):
 *   4.5:1  normal text
 *   3.0:1  large text (>= 24px, or >= 18.66px bold) and user interface graphics
 *
 * Usage:
 *   node tools/check-contrast.mjs                 all pages, both themes
 *   node tools/check-contrast.mjs --theme dark    one theme
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const onlyTheme = args.includes('--theme') ? args[args.indexOf('--theme') + 1] : null;
const PAGES = [
  { name: 'index.html', url: 'http://127.0.0.1:5500/index.html' },
  { name: 'search.html', url: 'http://127.0.0.1:5500/search.html' },
  { name: 'event.html', url: 'http://127.0.0.1:5500/event.html?id=1' },
  // A3: the new public page and the admin site. Both draw on the same tokens
  // and the same components, so a token that flips badly shows up here too - and
  // the admin pages are the ones most likely to be missed, because they are not
  // part of the visitor journey.
  { name: 'registration.html', url: 'http://127.0.0.1:5500/registration.html?id=1' },
  { name: 'admin/index.html', url: 'http://127.0.0.1:5500/admin/index.html' },
  { name: 'admin/events.html', url: 'http://127.0.0.1:5500/admin/events.html' },
  { name: 'admin/update.html', url: 'http://127.0.0.1:5500/admin/update.html?id=7' },
];
const THEMES = onlyTheme ? [onlyTheme] : ['light', 'dark'];

const PORT = 9500 + (process.pid % 80);
const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((candidate) => fs.existsSync(candidate));

if (!EDGE) {
  console.error('Edge not found');
  process.exit(1);
}

const profile = path.join(os.tmpdir(), `dsh-contrast-${Date.now()}`);
const child = spawn(
  EDGE,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--force-device-scale-factor=1',
    '--window-size=1400,1000',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    'about:blank',
  ],
  { stdio: 'ignore' }
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForDevTools() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (response.ok) return;
    } catch {
      /* not ready */
    }
    await sleep(250);
  }
  throw new Error('DevTools did not start');
}

async function connect(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  const pending = new Map();
  let nextId = 1;
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    }
  });
  return {
    send: (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      }),
    close: () => socket.close(),
  };
}

/**
 * Runs inside the page. For every element that directly contains visible text it
 * resolves the effective background by walking up the tree, then applies the
 * WCAG contrast formula.
 */
const MEASURE = `(() => {
  const parse = (value) => {
    const match = String(value).match(/rgba?\\(([^)]+)\\)/);
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

  /**
   * Walk up until an opaque background is found.
   *
   * The document element is the starting fallback, not white: in the dark theme
   * the page background is set on body (and html can stay transparent), so
   * assuming white reported text as sitting on white when it was on dark - which
   * produced false failures and hid real ones.
   */
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
    // Reached the top without an opaque colour: fall back to the document
    // element's own computed background, which respects the theme.
    if (node === null) {
      const rootBg = parse(getComputedStyle(document.documentElement).backgroundColor);
      if (rootBg && rootBg.a > 0) stack.push(rootBg);
    }
    for (let i = stack.length - 1; i >= 0; i -= 1) result = over(stack[i], result);
    return result;
  };

  const results = [];
  const seen = new Set();

  for (const element of document.querySelectorAll('body *')) {
    // Only elements that directly hold text.
    const ownText = [...element.childNodes]
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent.trim())
      .join('')
      .trim();
    if (!ownText) continue;

    const style = getComputedStyle(element);
    if (style.visibility === 'hidden' || style.display === 'none' || parseFloat(style.opacity) === 0) continue;

    const rect = element.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    // Elements positioned off screen (screen-reader only) are excluded.
    if (rect.width <= 2 && rect.height <= 2) continue;

    const colour = parse(style.color);
    if (!colour) continue;

    const background = effectiveBackground(element);
    const text = colour.a < 1 ? over(colour, background) : colour;
    const value = ratio(text, background);

    const fontSize = parseFloat(style.fontSize);
    const bold = parseInt(style.fontWeight, 10) >= 700;
    const large = fontSize >= 24 || (bold && fontSize >= 18.66);
    const required = large ? 3 : 4.5;

    const key = element.tagName + '.' + element.className + '|' + Math.round(value * 100);
    if (seen.has(key)) continue;
    seen.add(key);

    results.push({
      tag: element.tagName.toLowerCase(),
      cls: String(element.className || '').slice(0, 40),
      text: ownText.slice(0, 34),
      colour: style.color,
      background: 'rgb(' + Math.round(background.r) + ', ' + Math.round(background.g) + ', ' + Math.round(background.b) + ')',
      size: fontSize,
      bold,
      ratio: Math.round(value * 100) / 100,
      required,
      pass: value >= required,
    });
  }

  return JSON.stringify(results);
})()`;

try {
  await waitForDevTools();
  const target = await (
    await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })
  ).json();
  const { send, close } = await connect(target.webSocketDebuggerUrl);
  await send('Page.enable');

  let failures = 0;
  let checked = 0;

  for (const theme of THEMES) {
    for (const page of PAGES) {
      await send('Page.addScriptToEvaluateOnNewDocument', {
        source: `localStorage.setItem('charity-events:theme', ${JSON.stringify(theme)});`,
      });
      await send('Page.navigate', { url: page.url });
      await sleep(3800);

      const measured = await send('Runtime.evaluate', { expression: MEASURE, returnByValue: true });
      const rows = JSON.parse(measured.result.value);
      const bad = rows.filter((row) => !row.pass);

      checked += rows.length;
      failures += bad.length;

      console.log(`\n=== ${theme} / ${page.name} : ${rows.length} text elements, ${bad.length} below the minimum ===`);
      for (const row of bad) {
        console.log(
          `  ${row.ratio.toFixed(2)}:1 (needs ${row.required})  ` +
            `${row.tag}.${row.cls.split(' ')[0]}  colour ${row.colour} on ${row.background}  ` +
            `${row.size}px${row.bold ? ' bold' : ''}  "${row.text}"`
        );
      }
      if (bad.length === 0) console.log('  (none)');
    }
  }

  console.log(`\n${checked} text elements checked, ${failures} below the WCAG AA minimum.`);
  close();
  if (failures > 0) process.exitCode = 1;
} catch (error) {
  console.error('Contrast check failed:', error.message);
  process.exitCode = 1;
} finally {
  child.kill();
  await sleep(500);
  fs.rmSync(profile, { recursive: true, force: true });
}
