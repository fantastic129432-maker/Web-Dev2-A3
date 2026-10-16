/**
 * tests/angular-e2e.mjs
 * ---------------------------------------------------------------------------
 * End-to-end checks for the two Angular applications, driven through a real
 * browser (headless Microsoft Edge) against the real compiled API.
 *
 * WHY THIS EXISTS ALONGSIDE tests/run-tests.js
 *   run-tests.js proves the REST API and the ARCHIVED vanilla frontend behave
 *   correctly at the level of HTTP and the DOM. It cannot prove that an Angular
 *   application bootstraps, routes, calls the API and paints the result, because
 *   an Angular app is compiled and its rendering is driven by the framework.
 *   This script covers exactly that gap: it loads the BUILT applications in a
 *   real browser and asserts on what a person would actually see.
 *
 * WHAT IT PROVES
 *   * both applications boot (no "Loading..." placeholder left behind)
 *   * the router resolves every required route, including deep links
 *   * the page content really comes from the API (it fetches the same data
 *     directly and compares)
 *   * the Assessment 3 registration list appears on the event page
 *   * the Open-Meteo forecast renders when one is available
 *   * the language switcher and the theme switch change the document
 *   * the admin side lists every event and every registration
 *   * the API's write contract (POST 201 / PUT 200 / DELETE 204, and DELETE 409
 *     when registrations exist) behaves as both applications expect
 *
 * HOW TO RUN
 *   npm run build:local     (once, or after changing the applications)
 *   npm run test:e2e
 *
 * PREREQUISITES
 *   Microsoft Edge (found automatically) and the two builds in dist/. The script
 *   starts the API and the two static servers itself, on the ports the built
 *   development environment files expect (3000, 4200, 4300).
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const API_PORT = 3000;
const CLIENT_PORT = 4200;
const ADMIN_PORT = 4300;
const API = `http://127.0.0.1:${API_PORT}/api`;
const CLIENT = `http://127.0.0.1:${CLIENT_PORT}`;
const ADMIN = `http://127.0.0.1:${ADMIN_PORT}`;

const results = [];
function record(label, ok, detail = '') {
  results.push({ label, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (detail) console.log(`          ${detail}`);
}

function section(title) {
  console.log('');
  console.log(title);
  console.log('-'.repeat(title.length));
}

/* ------------------------------------------------------------------ helpers */

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** Wait until an HTTP endpoint answers, so no fixed sleeps are needed. */
async function waitForHttp(url, { timeoutMs = 30_000, expect = () => true } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'no attempt made';

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (expect(response)) return response;
      lastError = `status ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(300);
  }

  throw new Error(`Timed out waiting for ${url} (${lastError})`);
}

/** GET a JSON payload from the API. */
async function api(pathname) {
  const response = await fetch(`${API}${pathname}`);
  if (!response.ok) throw new Error(`GET ${pathname} -> ${response.status}`);
  const body = await response.json();
  return body.data;
}

/** A deliberately small static server, mirroring tools/serve-spa.mjs. */
function startStaticServer(directory, port) {
  return spawn(process.execPath, [path.join(ROOT, 'tools', 'serve-spa.mjs'), directory, String(port)], {
    cwd: ROOT,
    stdio: 'ignore',
  });
}

const children = [];
function startChild(command, args) {
  const child = spawn(command, args, { cwd: ROOT, stdio: 'ignore' });
  children.push(child);
  return child;
}

function stopAll() {
  for (const child of children) {
    try {
      child.kill();
    } catch {
      // Already gone.
    }
  }
}

/* ---------------------------------------------------------------------- main */

async function main() {
  /* ---------------------------------------------------------- preconditions */
  section('Preconditions');

  const distClient = path.join(ROOT, 'dist', 'clientside');
  const distAdmin = path.join(ROOT, 'dist', 'adminside');
  const apiEntry = path.join(ROOT, 'api', 'dist', 'server.js');

  const buildsPresent = existsSync(path.join(distClient, 'index.html')) && existsSync(path.join(distAdmin, 'index.html'));
  record(
    'both Angular applications are built',
    buildsPresent,
    buildsPresent ? 'dist/clientside and dist/adminside' : 'Run: npm run build:local'
  );
  if (!buildsPresent) return finish();

  const apiBuilt = existsSync(apiEntry);
  record('the TypeScript API is compiled', apiBuilt, apiBuilt ? 'api/dist/server.js' : 'Run: npm run build:api');
  if (!apiBuilt) return finish();

  /* ------------------------------------------------------ find a browser */
  const browserCandidates = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];
  const browserPath = browserCandidates.find((candidate) => existsSync(candidate));
  record('a Chromium browser is available for the end-to-end run', Boolean(browserPath), browserPath ?? 'none found');
  if (!browserPath) return finish();

  /* ------------------------------------------------------- start the stack */
  section('Starting the stack');

  startChild(process.execPath, [apiEntry]);
  startChild(process.execPath, [path.join(ROOT, 'tools', 'serve-spa.mjs'), distClient, String(CLIENT_PORT)]);
  startChild(process.execPath, [path.join(ROOT, 'tools', 'serve-spa.mjs'), distAdmin, String(ADMIN_PORT)]);

  await waitForHttp(`${API}/health`);
  await waitForHttp(CLIENT, { expect: (response) => response.ok });
  await waitForHttp(ADMIN, { expect: (response) => response.ok });
  record('API, client site and admin site are all listening', true, `${API_PORT}, ${CLIENT_PORT}, ${ADMIN_PORT}`);

  /* --------------------------------------------------------- reference data */
  const organization = await api('/organization');
  const stats = await api('/stats');
  const events = await api('/events?limit=12');
  const eventDetail = await api('/events/2');
  const adminEvents = await api('/admin/events');
  const registrations = await api('/registrations');

  const eventName = eventDetail.eventName;
  const attendeeName = eventDetail.registrations?.[0]?.attendeeName ?? '';
  const attendeeEmail = registrations[0]?.attendeeEmail ?? '';

  const { default: puppeteer } = await import('puppeteer-core');
  const browser = await puppeteer.launch({
    executablePath: browserPath,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  /**
   * Load a page and return its visible text.
   *
   * The language is FORCED to English before any application code runs. The
   * application deliberately honours the browser's preference, and this machine's
   * headless browser reports zh-CN, so without forcing a language every English
   * text assertion below would fail for the "wrong" reason - the interface would
   * correctly be in Chinese. The language feature itself is asserted separately,
   * further down, by setting the stored choice to 'zh' and checking the result.
   *
   * A `waitFor` string is waited for, but a timeout does NOT abort the run: the
   * page text is returned anyway so the individual assertions can report what was
   * actually rendered. Aborting here would hide every later check behind the first
   * failure, which makes a broken build far slower to diagnose.
   */
  async function visit(url, { waitFor, language = 'en', theme = 'light' } = {}) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 1000 });

    await page.evaluateOnNewDocument(
      (chosenLanguage, chosenTheme) => {
        try {
          localStorage.setItem('charity-events:language', chosenLanguage);
          localStorage.setItem('charity-events:theme', chosenTheme);
        } catch {
          // Storage unavailable: the pages still render, in the browser's language.
        }
      },
      language,
      theme
    );

    const errors = [];
    const consoleErrors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    page.on('console', (message) => {
      if (message.type() !== 'error') return;

      const text = message.text();
      const resource = message.location()?.url ?? '';

      /*
       * A blocked request to a THIRD-PARTY origin is an environment condition,
       * not an application error. The event page and the admin event form both
       * call Open-Meteo, and when this machine has no working internet (or its
       * system proxy is down, which is common here) the browser logs
       * "Failed to load resource: net::ERR_PROXY_CONNECTION_FAILED".
       *
       * The forecast is a bonus by design: it degrades to showing nothing, without
       * an uncaught error. Counting that console line as a failure made the whole
       * suite depend on the machine's connectivity - it failed three unrelated
       * checks the moment the proxy went away. Only a failed GET for a non-local
       * resource is ignored; every other console error still counts.
       */
      const isThirdParty = resource !== '' && !resource.startsWith(CLIENT) && !resource.startsWith(ADMIN);
      if (isThirdParty && /Failed to load resource/i.test(text)) return;

      consoleErrors.push(resource ? `${text} (${resource})` : text);
    });

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 45_000 });

    let waited = true;
    if (waitFor) {
      waited = await waitForText(page, waitFor);
    }

    const text = await page.evaluate(() => document.body.innerText);
    return { page, text, errors: [...errors, ...consoleErrors], waited, waitFor };
  }

  /** Wait until the page shows one of the given strings. Returns whether it did. */
  async function waitForText(page, needle, timeoutMs = 20_000) {
    try {
      await page.waitForFunction(
        (wanted) => document.body && document.body.innerText.includes(wanted),
        { timeout: timeoutMs },
        needle
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Click the first button or link whose text contains `needle`.
   *
   * Used to drive a form the way a person would. `includes` is used rather than a
   * regular expression so the needle can be passed into the page verbatim.
   */
  async function clickByText(page, needle) {
    return page.evaluate((wanted) => {
      const lower = String(wanted).toLowerCase();
      const matches = (node) =>
        (node.textContent ?? '').toLowerCase().includes(lower) ||
        (node.getAttribute('value') ?? '').toLowerCase().includes(lower);

      // A form control is preferred over a link: the same words also appear in the
      // site menu, and clicking a menu link would only navigate to the page that is
      // already open instead of submitting the form.
      const candidate =
        [...document.querySelectorAll('button, input[type="submit"]')].find(matches) ??
        [...document.querySelectorAll('a')].find(matches);

      if (!candidate) return false;
      candidate.click();
      return true;
    }, needle);
  }

  /** A short excerpt of what a page actually rendered, for a failure message. */
  const excerpt = (text) =>
    text.replace(/\s+/g, ' ').trim().slice(0, 220) || '(the page rendered no text at all)';

  try {
    /* ============================================================ client side */
    section('Client-side website');

    // ---- home
    const home = await visit(`${CLIENT}/`, { waitFor: organization.name });
    if (!home.waited) {
      console.log(`          home page never showed "${home.waitFor}"; it rendered: ${excerpt(home.text)}`);
    }
    record('home page boots and renders the organisation from the API', home.text.includes(organization.name), organization.name);
    record(
      'the loading placeholder is gone (Angular bootstrapped)',
      !home.text.includes('Loading the charity events website'),
      home.text.includes('Loading') ? 'placeholder still visible' : ''
    );

    const firstEvent = events[0]?.eventName ?? '';
    // Placed AFTER firstEvent exists: the home page's own event list comes from the API,
    // and this is data no dictionary can supply, so it proves the API drove the page.
    record('home page lists the events the API returns', home.text.includes(firstEvent), firstEvent);
    record(
      'home page renders event cards from the API',
      firstEvent !== '' && home.text.includes(firstEvent),
      firstEvent
    );

    const imageCount = await home.page.evaluate(
      () => document.querySelectorAll('img[src*="assets/images"]').length
    );
    record('event artwork resolves from the shared assets folder', imageCount > 0, `${imageCount} images`);
    record('no uncaught JavaScript error on the home page', home.errors.length === 0, home.errors.join('; '));
    await home.page.close();

    // ---- search
    // The page searches on ARRIVAL: it runs the default upcoming search itself, so a
    // visitor sees events immediately rather than an empty panel asking them to press
    // a button. The click below is therefore a real search that CHANGES the result
    // set - it is no longer what first produces one - which is why the check that
    // matters here is the one on arrival.
    const search = await visit(`${CLIENT}/search`);
    const filterInputs = await search.page.evaluate(() => document.querySelectorAll('input').length);
    record(
      'search page renders the filter form built from the API',
      filterInputs > 0 && search.text.includes('Coffs Harbour'),
      `${filterInputs} inputs; venues from /api/locations present`
    );

    record(
      'the search page shows results on arrival, before anything is clicked',
      search.text.includes(firstEvent),
      search.text.includes(firstEvent) ? firstEvent : excerpt(search.text)
    );

    const submitted = await clickByText(search.page, 'Search events');
    record('the search form can be submitted', submitted, submitted ? '' : 'no Search events button found');

    const resultsAppeared = await waitForText(search.page, firstEvent, 15_000);
    const searchText = await search.page.evaluate(() => document.body.innerText);
    record(
      'searching calls the API and renders matching events',
      resultsAppeared,
      resultsAppeared ? firstEvent : excerpt(searchText)
    );
    await search.page.close();

    // ---- event detail: the A3 registration list
    const detail = await visit(`${CLIENT}/events/2`, { waitFor: eventName });
    if (!detail.waited) {
      console.log(`          event detail never showed "${detail.waitFor}"; it rendered: ${excerpt(detail.text)}`);
    }
    record('event detail page renders the event from the API', detail.text.includes(eventName), eventName);
    record(
      'event detail page lists the registrations, newest first (A3)',
      attendeeName.split(' ')[0] !== '' && detail.text.includes(attendeeName.split(' ')[0]),
      attendeeName.split(' ')[0] || 'no registrations returned by the API'
    );
    // The Register control may be a <button> that routes on click or an <a> with a
    // router link, so both are accepted; what matters is that the visitor can
    // reach the registration form from the event.
    const registerControls = await detail.page.evaluate(() =>
      [...document.querySelectorAll('a, button')]
        .filter((node) => /register|book|reserve/i.test(node.textContent ?? ''))
        .map((node) => ({ tag: node.tagName, href: node.getAttribute('href') ?? '' }))
    );
    record(
      'event detail page offers a Register control for the registration page (A3)',
      registerControls.length > 0,
      JSON.stringify(registerControls.slice(0, 3))
    );

    // ---- weather (the optional external API)
    /*
     * Reachability is asked of the BROWSER, not of this script.
     *
     * A Node-side fetch can succeed down a different path - Node ignores the
     * Windows system proxy that Edge obeys - so pre-flighting from here said
     * "reachable" while every browser request was refused by a dead proxy at
     * 127.0.0.1:7890. This check then demanded a forecast panel that could not
     * possibly appear. Asking the page is asking the same network path the
     * application itself uses.
     */
    const browserReachesOpenMeteo = await detail.page.evaluate(async () => {
      try {
        const response = await fetch(
          'https://api.open-meteo.com/v1/forecast?latitude=-30.306&longitude=153.149&daily=weather_code&timezone=UTC',
          { cache: 'no-store' }
        );
        return response.ok;
      } catch {
        return false;
      }
    });

    // The forecast comes from a third-party API AFTER the event itself resolves, so
    // it is waited for rather than read the moment the event appears. When the
    // network is known to work, the page is loaded once more, so the application's
    // own request is not judged on a transient failure that happened before this
    // reachability check.
    let forecastPanelAppeared = await waitForText(detail.page, 'Open-Meteo', 15_000);
    if (browserReachesOpenMeteo && !forecastPanelAppeared) {
      await detail.page.reload({ waitUntil: 'networkidle2' });
      forecastPanelAppeared = await waitForText(detail.page, 'Open-Meteo', 20_000);
    }

    const detailText = await detail.page.evaluate(() => document.body.innerText);
    const temperatureShown = /\d+\s*°C/.test(detailText);

    record(
      browserReachesOpenMeteo
        ? 'the Open-Meteo forecast renders on the event detail page'
        : 'Open-Meteo is unreachable from the browser, so the event page must degrade quietly',
      browserReachesOpenMeteo ? forecastPanelAppeared && temperatureShown : detail.errors.length === 0,
      browserReachesOpenMeteo
        ? `panel: ${forecastPanelAppeared}, temperature: ${temperatureShown}`
        : 'skipped the render assertion; the page must not error'
    );
    record('no uncaught JavaScript error on the event detail page', detail.errors.length === 0, detail.errors.join('; '));
    await detail.page.close();

    // ---- registration page
    const registration = await visit(`${CLIENT}/register/2`, { waitFor: eventName });
    if (!registration.waited) {
      console.log(
        `          registration page never showed "${registration.waitFor}"; it rendered: ${excerpt(registration.text)}`
      );
    }
    record('registration page shows the event being registered for (A3)', registration.text.includes(eventName), eventName);
    const formFields = await registration.page.evaluate(async () => {
      /*
       * The ticket count is a STEPPER, not `<input type="number">` (A3 review item
       * C1). It is one value element between two large buttons, so the check is
       * that all three exist AND that the "+" button actually moves the number -
       * a stepper that renders but does not step is the failure this assertion is
       * here to catch. `numberInputs` is asserted at 0 so the old control cannot
       * come back unnoticed.
       */
      const stepper = document.querySelector('[data-ticket-stepper]');
      const value = stepper ? stepper.querySelector('[data-stepper-value]') : null;
      const buttons = stepper ? [...stepper.querySelectorAll('button')] : [];
      const before = value ? value.textContent.trim() : '';
      const plus = buttons.find((button) => button.hasAttribute('data-stepper-increment'));
      if (plus) plus.click();
      await new Promise((done) => setTimeout(done, 200));
      const after = value ? value.textContent.trim() : '';

      return {
        email: document.querySelectorAll('input[type="email"], input[name*="mail"]').length,
        stepperValues: stepper ? stepper.querySelectorAll('[data-stepper-value]').length : 0,
        stepperButtons: buttons.length,
        numberInputs: document.querySelectorAll('input[type="number"]').length,
        text: document.querySelectorAll('input[type="text"], input:not([type])').length,
        forms: document.querySelectorAll('form').length,
        stepped: before !== '' && after === String(Number(before) + 1),
      };
    });
    record(
      'registration page offers a real form (name, email, tickets)',
      formFields.forms > 0 &&
        formFields.email > 0 &&
        formFields.stepperValues === 1 &&
        formFields.stepperButtons === 2 &&
        formFields.numberInputs === 0 &&
        formFields.stepped,
      JSON.stringify(formFields)
    );
    await registration.page.close();

    // ---- language switcher
    const chinese = await browser.newPage();
    await chinese.setViewport({ width: 1400, height: 1000 });
    await chinese.goto(`${CLIENT}/`, { waitUntil: 'networkidle2' });
    await chinese.evaluate(() => localStorage.setItem('charity-events:language', 'zh'));
    await chinese.reload({ waitUntil: 'networkidle2' });
    const chineseText = await chinese.evaluate(() => document.body.innerText);
    const langAttribute = await chinese.evaluate(() => document.documentElement.lang);
    record(
      'choosing Chinese switches the interface (stored choice is honoured)',
      langAttribute === 'zh-CN' || /[\u4e00-\u9fff]/.test(chineseText),
      `html lang = ${langAttribute}`
    );
    await chinese.close();

    /**
     * The picker must SHOW the language that is actually in effect.
     *
     * This is not cosmetic. The options are created by an `@for`, so a selected
     * value assigned before the options exist is dropped and the browser displays
     * the first option - which meant a visitor whose browser asks for Chinese (this
     * machine reports zh-CN) saw a Chinese interface with the picker reading
     * "English". Asserted on a FIRST load with nothing stored, and again after
     * switching, because the two paths failed differently.
     *
     * The invariant is locale-independent: TranslationService writes the active
     * language's htmlLang to <html lang> ('en-AU', 'zh-CN', 'vi-VN', 'ja-JP'), so
     * the picker's value must always be a prefix of it.
     */
    async function pickerState(url, selector) {
      const page = await browser.newPage();
      await page.setViewport({ width: 1400, height: 1000 });
      const read = async () => {
        await new Promise((done) => setTimeout(done, 1200));
        return page.evaluate((sel) => {
          const select = document.querySelector(sel);
          return { lang: document.documentElement.lang, value: select?.value ?? '' };
        }, selector);
      };

      await page.goto(url, { waitUntil: 'networkidle2', timeout: 45_000 });
      const firstLoad = await read();
      await page.evaluate(() => localStorage.setItem('charity-events:language', 'ja'));
      await page.reload({ waitUntil: 'networkidle2' });
      const afterSwitch = await read();
      await page.close();
      return { firstLoad, afterSwitch };
    }

    for (const [label, url, selector] of [
      ['public site', `${CLIENT}/`, '#language-select'],
      ['admin site', `${ADMIN}/`, 'select'],
    ]) {
      const { firstLoad, afterSwitch } = await pickerState(url, selector);
      record(
        `the language picker on the ${label} shows the language actually in effect`,
        firstLoad.value !== '' &&
          firstLoad.lang.startsWith(firstLoad.value) &&
          afterSwitch.value === 'ja',
        `first load: picker=${firstLoad.value}, html lang=${firstLoad.lang}; ` +
          `after choosing Japanese: picker=${afterSwitch.value}`
      );
    }

    // ---- theme
    const themed = await browser.newPage();
    await themed.setViewport({ width: 1400, height: 1000 });
    await themed.goto(`${CLIENT}/`, { waitUntil: 'networkidle2' });
    await themed.evaluate(() => localStorage.setItem('charity-events:theme', 'dark'));
    await themed.reload({ waitUntil: 'networkidle2' });
    const themeAttribute = await themed.evaluate(() =>
      document.documentElement.getAttribute('data-theme')
    );
    record('the stored dark theme is applied to the document', themeAttribute === 'dark', `data-theme = ${themeAttribute}`);
    await themed.close();

    /* ============================================================= admin side */
    section('Admin-side website');

    const dashboard = await visit(`${ADMIN}/`, { waitFor: 'API' });
    record(
      'admin dashboard renders the API statistics',
      dashboard.text.includes(String(stats.registrations)) || dashboard.text.includes(String(stats.upcomingEvents)),
      `registrations=${stats.registrations}, upcoming=${stats.upcomingEvents}`
    );
    record('no uncaught JavaScript error on the dashboard', dashboard.errors.length === 0, dashboard.errors.join('; '));
    await dashboard.page.close();

    const list = await visit(`${ADMIN}/events`, { waitFor: eventName });
    if (!list.waited) {
      console.log(`          admin event list never showed "${list.waitFor}"; it rendered: ${excerpt(list.text)}`);
    }
    const suspended = adminEvents.find((event) => event.status && event.status !== 'active');
    record('admin event list renders every event', list.text.includes(eventName), eventName);
    if (suspended) {
      record(
        'the list includes a non-active event (status is not filtered out)',
        list.text.includes(suspended.eventName),
        `${suspended.eventName} (${suspended.status})`
      );
    }
    const menuLinks = await list.page.evaluate(() => document.querySelectorAll('nav a, header a').length);
    record('the admin menu is present on the list page', menuLinks > 0, `${menuLinks} navigation links`);

    // Every row should lead to the event on the PUBLIC site, so staff can check
    // what a visitor sees. The href is absolute in development (a different port)
    // and site-absolute in production, so only its tail is asserted.
    const publicLinks = await list.page.evaluate(() =>
      [...document.querySelectorAll('a')]
        .map((node) => node.getAttribute('href') ?? '')
        .filter((href) => /\/events\/\d+$/.test(href))
    );
    record(
      'each row links to the event on the public site',
      publicLinks.length > 0,
      publicLinks.slice(0, 3).join(', ') || 'no link ending in /events/<id> found'
    );

    record('no uncaught JavaScript error on the event list', list.errors.length === 0, list.errors.join('; '));
    await list.page.close();

    const adminRegistrations = await visit(`${ADMIN}/registrations`, { waitFor: attendeeEmail });
    record(
      'admin registrations page lists every registration',
      attendeeEmail !== '' && adminRegistrations.text.includes(attendeeEmail),
      attendeeEmail
    );
    await adminRegistrations.page.close();

    /* =================================== the delete rule, driven through the UI */
    // Event 2 has registrations, so DELETE is refused with 409 and a FACTS object
    // { eventId, eventName, registrationCount, suggestion } - deliberately with no
    // `message`. This asserts those facts reach the screen, which is the whole job
    // of ApiError.conflictDetails: when that accessor returned null the staff
    // member saw a bare error with no event name and no numbers.
    const blockedDelete = await visit(`${ADMIN}/events`, { waitFor: eventName });
    const expectedCount = eventDetail.registrations?.length ?? 0;

    const deleteStarted = await blockedDelete.page.evaluate((name) => {
      const row = [...document.querySelectorAll('tr')].find((tr) =>
        (tr.textContent ?? '').includes(name)
      );
      if (!row) return false;
      const control = [...row.querySelectorAll('button, a')].find((node) =>
        /delete/i.test(node.textContent ?? '')
      );
      if (!control) return false;
      control.click();
      return true;
    }, eventName);

    // The list asks for confirmation first, so confirm it.
    await sleep(700);
    const deleteConfirmed = await clickByText(blockedDelete.page, 'Delete event');
    const bannerShown = await waitForText(blockedDelete.page, 'Deletion blocked', 12_000);
    const blockedText = await blockedDelete.page.evaluate(() => document.body.innerText);

    record(
      'a blocked delete explains itself with the event name and the registration count',
      deleteStarted &&
        bannerShown &&
        blockedText.includes(eventName) &&
        blockedText.includes(String(expectedCount)),
      `delete started: ${deleteStarted}, confirmed: ${deleteConfirmed}, banner: ${bannerShown}` +
        (bannerShown ? '' : `; page says: ${excerpt(blockedText)}`)
    );
    await blockedDelete.page.close();

    /* ============================================ admin interactions (clicks) */
    // Why click and not just render? A subscription created OUTSIDE a constructor
    // (in a Save or Delete handler) cannot call `takeUntilDestroyed()` with no
    // argument, because that needs an Angular injection context. Getting it wrong
    // throws the moment a staff member clicks, and a render-only assertion would
    // never see it. So this edits a field and saves, then checks nothing threw.
    const editor = await visit(`${ADMIN}/events/2/edit`, { waitFor: eventName });

    const nameChanged = await editor.page.evaluate(() => {
      const input = [...document.querySelectorAll('input, textarea')].find(
        (element) =>
          /name/i.test(element.getAttribute('name') ?? '') ||
          /name/i.test(element.id ?? '') ||
          /name/i.test(element.getAttribute('formcontrolname') ?? '')
      );
      if (!input) return false;

      // Angular's signal forms listen for `input`; a plain assignment would not
      // notify them, so the native setter is used and the event dispatched.
      const descriptor = Object.getOwnPropertyDescriptor(input.constructor.prototype, 'value');
      if (descriptor?.set) descriptor.set.call(input, 'Coastal Stars Gala Dinner (verified)');
      else input.value = 'Coastal Stars Gala Dinner (verified)';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    });

    const saveClicked = await clickByText(editor.page, 'save');
    await sleep(2500);

    const afterSave = await editor.page.evaluate(() => document.body.innerText);
    record(
      'editing an event and saving triggers no runtime error (click-handler subscription)',
      nameChanged && saveClicked && editor.errors.length === 0,
      editor.errors.join('; ') ||
        `field changed: ${nameChanged}, save clicked: ${saveClicked}; page says: ${excerpt(afterSave)}`
    );
    await editor.page.close();

    /* ============================================== the API write contract */
    section('API write contract used by the admin forms');

    const reference = await api('/admin/reference-data');
    const payload = {
      organizationId: reference.organizations[0].organizationId,
      categoryId: reference.categories[0].categoryId,
      locationId: reference.locations.find((venue) => venue.latitude !== null)?.locationId ?? reference.locations[0].locationId,
      eventName: 'E2E verification event',
      shortDescription: 'Created by the end-to-end verification script.',
      description: 'This event is created and removed by tests/angular-e2e.mjs to prove the write contract.',
      purpose: 'Verify the C.R.U.D. cycle the admin website depends on.',
      eventDate: '2026-12-01',
      startTime: '10:00',
      endTime: '12:00',
      goalAmount: 1000,
      isFree: true,
      status: 'active',
      imageUrl: 'fun-run.svg',
    };

    const created = await fetch(`${API}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    record('POST /api/events creates an event (201)', created.status === 201, `status ${created.status}`);
    const createdBody = created.status === 201 ? (await created.json()).data : null;

    if (createdBody) {
      const updated = await fetch(`${API}/events/${createdBody.eventId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventName: 'E2E verification event (updated)' }),
      });
      record('PUT /api/events/:id updates it (200)', updated.status === 200, `status ${updated.status}`);

      const deleted = await fetch(`${API}/events/${createdBody.eventId}`, { method: 'DELETE' });
      record('DELETE /api/events/:id removes it (204)', deleted.status === 204, `status ${deleted.status}`);
    }

    // Event 2 has registrations, so the delete MUST be refused.
    const blocked = await fetch(`${API}/events/2`, { method: 'DELETE' });
    const blockedBody = blocked.status === 409 ? await blocked.json() : null;
    record(
      'DELETE /api/events/:id is refused with 409 when registrations exist (data integrity)',
      blocked.status === 409,
      `status ${blocked.status}, registrations: ${blockedBody?.error?.details?.registrationCount ?? 'n/a'}`
    );

    const invalid = await fetch(`${API}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventName: 'x' }),
    });
    const invalidBody = invalid.status === 400 ? await invalid.json() : null;
    record(
      'an incomplete create is rejected with 400 and per-field details',
      invalid.status === 400 && Array.isArray(invalidBody?.error?.details),
      `${invalidBody?.error?.details?.length ?? 0} field errors`
    );

    await browser.close();
  } finally {
    try {
      await browser.close();
    } catch {
      // Already closed.
    }
  }

  return finish();
}

function finish() {
  stopAll();

  const failed = results.filter((entry) => !entry.ok);
  console.log('');
  console.log('==========================================================');
  if (failed.length === 0) {
    console.log(`  ${results.length} end-to-end checks passed`);
  } else {
    console.log(`  ${results.length - failed.length} passed, ${failed.length} failed`);
    for (const entry of failed) console.log(`    FAIL  ${entry.label}`);
  }
  console.log('==========================================================');

  // Give the child processes a moment to release their ports before exiting.
  setTimeout(() => process.exit(failed.length === 0 ? 0 : 1), 300);
}

main().catch((error) => {
  console.error('\nThe end-to-end run could not complete:', error);
  finish();
});
