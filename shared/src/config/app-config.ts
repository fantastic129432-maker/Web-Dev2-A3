/**
 * shared/src/config/app-config.ts
 * ---------------------------------------------------------------------------
 * Values that do not change between development and production, so they live
 * here instead of in an environment file.
 *
 * The two `environments/environment*.ts` files hold what DOES change (the API
 * address, the link to the other site); everything else is one shared truth so
 * the two websites cannot drift apart.
 */

/** Where the API and the external weather service live. */
export const APP_CONFIG = {
  /**
   * Request timeout in milliseconds. The legacy client used 10 seconds; a slow
   * or dead API must never leave a page spinning forever.
   */
  requestTimeoutMs: 10_000,

  /**
   * Optional external API (Assessment 3): the Open-Meteo daily forecast.
   *
   * Chosen because the brief names api.open-meteo.com and because it needs no
   * API key and no registration, so nothing secret has to be committed.
   */
  weatherApiUrl: 'https://api.open-meteo.com/v1/forecast',
  weatherTimezone: 'Australia/Sydney',

  /**
   * How many days ahead Open-Meteo gives a reliable daily forecast. Asking for
   * a date beyond this window returns nothing useful, so the event page says so
   * instead of showing an empty panel.
   */
  weatherForecastDays: 16,

  /** How many events the home page asks for. */
  homeEventLimit: 12,

  /** Where the generated category artwork lives in the built application. */
  imageBaseUrl: 'assets/images/',

  /** Shown when an event has no usable image. */
  fallbackImage: 'fun-run.svg',

  /**
   * localStorage keys. The language key is shared by BOTH websites on purpose:
   * choosing Chinese on the public site means the admin site also opens in
   * Chinese.
   */
  storageKeys: {
    language: 'charity-events:language',
    theme: 'charity-events:theme',
  },
} as const;

/**
 * The artwork an administrator can choose from when creating an event. Kept in
 * step with the files in assets/images so a new event always has a real picture
 * rather than a broken link, and in step with KNOWN_IMAGES in the API
 * (api/src/services/eventWriteService.ts).
 */
export const EVENT_IMAGES: readonly string[] = [
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

/** The publishing states events.status allows, mirroring PUBLISH_STATUSES in the API. */
export const PUBLISH_STATUSES: readonly string[] = ['active', 'suspended', 'cancelled'];
