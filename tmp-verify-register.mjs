/**
 * Throwaway verification harness (deleted before the work is finished).
 *
 * Drives the running public site in headless Edge and reports measurements for
 * the eight defects the review found on /register/:id.
 *
 * Usage:
 *   node tmp-verify-register.mjs layout <url> <lang> <theme> <width> <height>
 *   node tmp-verify-register.mjs submit-empty <url> <lang> <theme>
 *   node tmp-verify-register.mjs register <url> <lang> <theme> <name> <email>
 */
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((candidate) => fs.existsSync(candidate));

const [mode, url, language = 'en', theme = 'light', width = '1400', height = '1000', name = '', email = ''] =
  process.argv.slice(2);

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

const consoleMessages = [];
page.on('pageerror', (error) => consoleMessages.push(`pageerror: ${error}`));
page.on('console', (message) => {
  if (message.type() === 'error') consoleMessages.push(`console: ${message.text()}`);
});

/** Every POST body the page sends, so the wire payload can be inspected. */
const posts = [];
page.on('request', (request) => {
  if (request.method() === 'POST') {
    posts.push({ url: request.url(), body: request.postData() ?? '' });
  }
});

await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
await new Promise((done) => setTimeout(done, 1500));

/* ------------------------------------------------------------------ layout */

if (mode === 'layout') {
  const report = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
    const card = document.querySelector('.registration-summary');
    const formCard = document.querySelector('.registration-form-card');
    const layout = document.querySelector('.registration-layout');
    const quantity = document.querySelector('#reg-ticketsPurchased');
    const phone = document.querySelector('#reg-attendeePhone');
    const phoneField = phone?.closest('.field');
    const box = (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        width: Math.round(rect.width * 100) / 100,
        height: Math.round(rect.height * 100) / 100,
        left: Math.round(rect.left * 100) / 100,
        right: Math.round(rect.right * 100) / 100,
        position: style.position,
        top: style.top,
      };
    };

    const headings = formCard ? [...formCard.querySelectorAll('h1, h2, h3')].map((h) => h.textContent.trim()) : [];

    const chrome = [document.querySelector('.site-header'), document.querySelector('.site-footer')].filter(Boolean);
    const inChrome = (element) => chrome.some((node) => node.contains(element));

    const isAncestorOrSelf = (element) => {
      let node = card;
      while (node) {
        if (node === element) return true;
        node = node.parentElement;
      }
      return false;
    };

    let maxOverlapInColumn = 0;
    let worstInColumn = null;
    let maxOverlapOutsideChrome = 0;
    let worstOutsideChrome = null;
    let maxOverlapWithHeader = 0;
    let worstHeader = null;
    const cardTops = [];
    let visibleSteps = 0;

    const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
    for (let y = 0; y <= maxScroll; y += 25) {
      window.scrollTo(0, y);
      await sleep(16);
      const cardRect = card.getBoundingClientRect();
      cardTops.push(Math.round(cardRect.top * 100) / 100);
      if (cardRect.bottom > 0 && cardRect.top < window.innerHeight) visibleSteps += 1;

      for (const element of document.querySelectorAll('body *')) {
        if (isAncestorOrSelf(element)) continue;
        if (card.contains(element)) continue;
        if (element.classList.contains('site-header') || element.classList.contains('site-footer')) continue;
        if (element.closest('.site-header') || element.closest('.site-footer')) continue;
        if (!layout.contains(element)) continue;
        const rect = element.getBoundingClientRect();
        const ox = Math.min(cardRect.right, rect.right) - Math.max(cardRect.left, rect.left);
        const oy = Math.min(cardRect.bottom, rect.bottom) - Math.max(cardRect.top, rect.top);
        const area = ox > 0 && oy > 0 ? ox * oy : 0;
        if (area > maxOverlapInColumn) {
          maxOverlapInColumn = area;
          worstInColumn = `${element.tagName.toLowerCase()}.${element.className}`;
        }
      }

      for (const element of document.querySelectorAll('body *')) {
        if (isAncestorOrSelf(element) || card.contains(element)) continue;
        if (inChrome(element)) continue;
        const rect = element.getBoundingClientRect();
        const ox = Math.min(cardRect.right, rect.right) - Math.max(cardRect.left, rect.left);
        const oy = Math.min(cardRect.bottom, rect.bottom) - Math.max(cardRect.top, rect.top);
        const area = ox > 0 && oy > 0 ? ox * oy : 0;
        if (area > maxOverlapOutsideChrome) {
          maxOverlapOutsideChrome = area;
          worstOutsideChrome = `${element.tagName.toLowerCase()}.${element.className}`;
        }
      }

      const header = document.querySelector('.site-header');
      if (header) {
        const rect = header.getBoundingClientRect();
        const ox = Math.min(cardRect.right, rect.right) - Math.max(cardRect.left, rect.left);
        const oy = Math.min(cardRect.bottom, rect.bottom) - Math.max(cardRect.top, rect.top);
        const area = ox > 0 && oy > 0 ? ox * oy : 0;
        if (area > maxOverlapWithHeader) {
          maxOverlapWithHeader = area;
          worstHeader = `${Math.round(ox * 100) / 100} x ${Math.round(oy * 100) / 100} at scrollY ${y}`;
        }
      }
    }
    window.scrollTo(0, 0);

    const pinned = cardTops.filter((value) => Math.abs(value - 96) < 0.5).length;
    const header = document.querySelector('.site-header');
    const banner = document.querySelector('.page-header h1');
    const cardText = formCard?.innerText ?? '';
    const pageText = document.body.innerText;

    return {
      hasSummary: Boolean(card),
      summaryIsSticky: card ? getComputedStyle(card).position : null,
      summaryTop: card ? getComputedStyle(card).top : null,
      summaryParent: card?.parentElement?.className ?? null,
      cardBox: card ? box(card) : null,
      formBox: formCard ? box(formCard) : null,
      layoutBox: layout ? box(layout) : null,
      headerBox: header ? box(header) : null,
      bannerTitle: banner?.textContent?.trim() ?? null,
      cardHeadings: headings,
      duplicateTitleInCard: headings.some((text) => text === banner?.textContent?.trim()),
      alertsOnLoad: document.querySelectorAll('.registration-form-card [role="alert"]').length,
      fieldErrorParagraphsOnLoad: [...document.querySelectorAll('.registration-form-card .field-message--error')].filter(
        (element) => element.textContent.trim() !== ''
      ).length,
      dateInputs: document.querySelectorAll('input[type="date"]').length,
      dateControlsInText: /Date of registration|Defaults to today|报名日期|Ngày đăng ký|登録日/.test(pageText),
      quantityBox: quantity ? box(quantity) : null,
      phoneBox: phone ? box(phone) : null,
      phoneFieldBox: phoneField ? box(phoneField) : null,
      phoneFieldIsInRow: Boolean(phoneField?.parentElement?.classList.contains('form-row')),
      columnWidthOfPhone: phoneField ? Math.round(phoneField.getBoundingClientRect().width * 100) / 100 : null,
      horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
      scrollHeight: document.documentElement.scrollHeight,
      maxScroll,
      steps: cardTops.length,
      pinnedSteps: pinned,
      visibleSteps,
      maxOverlapInColumn: Math.round(maxOverlapInColumn * 100) / 100,
      worstInColumn,
      maxOverlapOutsideChrome: Math.round(maxOverlapOutsideChrome * 100) / 100,
      worstOutsideChrome,
      maxOverlapWithHeader: Math.round(maxOverlapWithHeader * 100) / 100,
      worstHeader,
      cardTextHasErrorSentence: /Please correct the highlighted fields|请修正标出的字段|Vui lòng sửa các trường|印の付いた項目を修正/.test(
        cardText
      ),
      summaryVisibleAtEnd: cardTops[cardTops.length - 1] > -card.getBoundingClientRect().height,
    };
  });
  console.log(JSON.stringify({ mode, url, language, theme, width, height, report, consoleMessages }, null, 2));
}

/* ------------------------------------------------------ failed empty submit */

if (mode === 'submit-empty') {
  const before = await page.evaluate(() => ({
    alerts: document.querySelectorAll('.registration-form-card [role="alert"]').length,
    text: document.querySelector('.registration-form-card')?.innerText ?? '',
  }));

  await page.click('#registration-submit');
  await new Promise((done) => setTimeout(done, 1200));

  const after = await page.evaluate(() => {
    const alerts = [...document.querySelectorAll('.registration-form-card [role="alert"]')];
    const button = document.querySelector('#registration-submit');
    const alertBox = alerts[0]?.getBoundingClientRect();
    const buttonBox = button?.getBoundingClientRect();
    return {
      alertCount: alerts.length,
      alertTexts: alerts.map((element) => element.textContent.trim()),
      alertBelowButton: alertBox && buttonBox ? alertBox.top >= buttonBox.bottom - 1 : null,
      fieldMessages: [...document.querySelectorAll('.registration-form-card .field-message--error')]
        .map((element) => element.textContent.trim())
        .filter(Boolean),
      focused: document.activeElement?.id ?? null,
      scrolled: Math.round(window.scrollY),
      posts: 0,
    };
  });

  console.log(
    JSON.stringify(
      { mode, url, language, theme, before, after, posts: posts.length, consoleMessages },
      null,
      2
    )
  );
}

/* ------------------------------------------------------ successful register */

if (mode === 'register') {
  await page.evaluate(
    (attendeeName, attendeeEmail) => {
      const setValue = (selector, value) => {
        const input = document.querySelector(selector);
        const descriptor = Object.getOwnPropertyDescriptor(input.constructor.prototype, 'value');
        if (descriptor?.set) descriptor.set.call(input, value);
        else input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      };
      setValue('#reg-attendeeName', attendeeName);
      setValue('#reg-attendeeEmail', attendeeEmail);
      setValue('#reg-attendeePhone', '0400 000 123');
      setValue('#reg-ticketsPurchased', '1');
    },
    name,
    email
  );
  await new Promise((done) => setTimeout(done, 300));
  await page.click('#registration-submit');

  let confirmed = false;
  try {
    await page.waitForFunction(() => Boolean(document.querySelector('.confirmation')), { timeout: 20000 });
    confirmed = true;
  } catch {
    confirmed = false;
  }
  await new Promise((done) => setTimeout(done, 600));

  const result = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.confirmation__receipt li')].map((element) => element.innerText.trim());
    return {
      heading: document.querySelector('.confirmation h1')?.textContent?.trim() ?? null,
      lead: document.querySelector('.confirmation__lead')?.textContent?.trim() ?? null,
      receipt: rows,
      problem: document.querySelector('.state--error')?.innerText?.trim() ?? null,
      bodyHasRequiredNotice: /Please correct the highlighted fields/.test(document.body.innerText),
    };
  });

  console.log(
    JSON.stringify(
      {
        mode,
        url,
        language,
        theme,
        name,
        email,
        confirmed,
        result,
        posts: posts.map((entry) => ({ url: entry.url, body: entry.body })),
        consoleMessages,
      },
      null,
      2
    )
  );
}

await browser.close();
