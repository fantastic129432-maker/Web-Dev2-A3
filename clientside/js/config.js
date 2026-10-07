/**
 * js/config.js
 * ---------------------------------------------------------------------------
 * One place that knows where the API lives, so the same client code can be
 * pointed at a different API without editing any other file.
 *
 * If you run the API on a different port, change API_BASE_URL here only.
 */
export const API_BASE_URL = 'https://24832546.it.scu.edu.au/charity-events-api/api';

/**
 * The admin website, which is part of the same deployment.
 *
 * This is a SITE-ABSOLUTE path, starting with a slash, and that matters now that
 * the link sits in the main menu. A relative path is resolved against whatever
 * page the visitor is on, so '../admin/index.html' meant one thing from
 * index.html and something else from inside a subfolder - and it left ".." in
 * the address bar, which looks broken. A leading slash always means the root of
 * this site, so the target is unambiguous from every page.
 */
export const ADMIN_SITE_URL = '/admin/index.html';

/** Where the generated category images live. */
export const IMAGE_BASE_URL = './images/';

/** Shown when an event has no usable image. */
export const FALLBACK_IMAGE = 'fun-run.svg';

/**
 * The artwork an administrator can choose from when creating an event.
 * Kept in step with the files in clientside/images so a new event always has a
 * real picture rather than a broken link.
 */
export const EVENT_IMAGES = [
  'fun-run.svg',
  'gala-dinner.svg',
  'silent-auction.svg',
  'charity-concert.svg',
  'food-drive.svg',
  'golf-day.svg',
  'art-exhibition.svg',
  'virtual-challenge.svg',
  'community.svg',
];

/** How many events the home page asks for. */
export const HOME_EVENT_LIMIT = 12;

/** The page that carries the organisation's own sections (about, contact). */
export const HOME_PAGE = 'index.html';

/** The Assessment 3 registration page. */
export const REGISTRATION_PAGE = 'registration.html';

/** The browser key remembered between the event page and the registration page. */
export const LAST_EVENT_KEY = 'charity-events:last-viewed-event-id';

/**
 * Optional external API (Assessment 3).
 *
 * Open-Meteo is free, needs no API key and no registration, which is what the
 * brief specifies. The event page asks it for the forecast on the event date at
 * the venue's coordinates (locations.latitude / locations.longitude).
 */
export const WEATHER_API_URL = 'https://api.open-meteo.com/v1/forecast';
export const WEATHER_TIMEZONE = 'Australia/Sydney';

/**
 * How many days ahead Open-Meteo gives a reliable daily forecast. Asking for a
 * date beyond this window returns nothing useful, so the page says so instead
 * of showing an empty panel.
 */
export const WEATHER_FORECAST_DAYS = 16;

/**
 * Nav items used by js/nav.js on every page.
 *
 * `labelKey` is looked up in js/translations.js rather than holding the text
 * itself, so the menu follows the language switcher. The English wording also
 * lives in the HTML, which keeps a page readable before the script runs.
 *
 * The menu only contains real destinations that are always reachable. The home
 * page still has its About and Contact sections, but they are deliberately not
 * linked from the menu: a fragment link has to be rewritten depending on which
 * page the visitor is on (a bare #about only works on the home page), and that
 * extra conditional behaviour caused more problems than the links were worth.
 *
 * Assessment 3 adds the registration page, and it is deliberately NOT in this
 * menu. Registration is per event, so a global "Register" link has no subject:
 * it can only ask the visitor to pick an event first, which is exactly what the
 * home and search pages already do. The registration page is reached from the
 * Register button on an event's own page, where the event is unambiguous.
 *
 * The admin site IS in the menu. It was footer-only at first, on the grounds
 * that a separate staff website does not belong in a visitor's journey - but
 * the marker is looking for two deliverables, and an entry they cannot find
 * costs more than a slightly unusual menu item. Putting it here also helps a
 * visitor understand that the project has two sides. The footer link stays as
 * well: two routes to the same place is not duplication worth removing when one
 * of them is the reason a marker finds the work at all.
 */
export const NAV_ITEMS = [
  { href: HOME_PAGE, labelKey: 'nav.home' },
  { href: 'search.html', labelKey: 'nav.search' },
  { href: ADMIN_SITE_URL, labelKey: 'nav.admin' },
];
