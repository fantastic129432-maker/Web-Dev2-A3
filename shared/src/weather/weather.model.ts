/**
 * @file The shape of a forecast, and the translation of Open-Meteo's WMO codes.
 *
 * The numeric codes are turned into something a visitor can read.
 *
 * Background: the optional external API in Assessment 3. Open-Meteo returns a
 * numeric `weather_code` (the WMO 4677 code table) rather than a description, so
 * the numbers have to be mapped to text. The brief prints the mapping it expects
 * (0; 1,2,3; 45,48; 51,53,55; 61,63,65; 80,81,82; 95) and that grouping is
 * followed exactly, with the few extra codes Open-Meteo can return added so no
 * code is ever left unlabelled.
 */

/**
 * The minimum a forecast needs: where the event is and when it happens.
 *
 * A full `Event` satisfies this structurally, and so does the draft an
 * administrator is still filling in on the "new event" form - which is what
 * lets the admin site preview the venue's weather before the event exists in the
 * database.
 */
export interface WeatherTarget {
  latitude?: number | null;
  longitude?: number | null;
  /** The day of the event; `dateStart` is used when this is absent. */
  eventDate?: string | null;
  dateStart?: string | null;
  venueName?: string | null;
  city?: string | null;
}

/** A resolved forecast for one day at one venue. */
export interface WeatherForecast {
  /** The day the forecast is for, YYYY-MM-DD. */
  date: string;
  /** The raw WMO code, kept so the UI can pick a glyph. */
  weatherCode: number;
  /** Degrees Celsius; null when Open-Meteo had no value for the day. */
  temperatureMax: number | null;
  temperatureMin: number | null;
  /** Percent, 0-100; null when unavailable. */
  rainChance: number | null;
  /** km/h; null when unavailable. */
  windMax: number | null;
  latitude: number;
  longitude: number;
  /** Copied from the event so the panel can name the place. */
  venueName: string;
  city: string;
  timezone: string;
}

/**
 * The WMO code -> translation key map.
 *
 * The keys below must exist in BOTH dictionaries (shared/src/i18n); the project's
 * translation completeness checks compare them, so a missing label is a test
 * failure rather than a blank panel.
 */
const WMO_KEYS: Readonly<Record<number, string>> = {
  0: 'weather.code0',
  1: 'weather.code1',
  2: 'weather.code2',
  3: 'weather.code3',
  45: 'weather.code45',
  48: 'weather.code48',
  51: 'weather.code51',
  53: 'weather.code53',
  55: 'weather.code55',
  61: 'weather.code61',
  63: 'weather.code63',
  65: 'weather.code65',
  71: 'weather.code71',
  73: 'weather.code73',
  75: 'weather.code75',
  80: 'weather.code80',
  81: 'weather.code81',
  82: 'weather.code82',
  95: 'weather.code95',
  96: 'weather.code96',
  99: 'weather.code99',
};

/**
 * The translation key for a WMO code.
 *
 * @param code - The numeric `weather_code` Open-Meteo returned.
 * @returns The key for that code's label, and 'weather.code3' (overcast) for a code the
 *   map does not list, so the panel never shows a blank condition.
 */
export function weatherCodeKey(code: number): string {
  return WMO_KEYS[code] ?? 'weather.code3';
}

/**
 * A glyph for the forecast, so the panel reads at a glance.
 *
 * Deliberately plain characters rather than an image: nothing extra to download,
 * and it cannot break when an asset path changes.
 *
 * @param code - The numeric `weather_code` Open-Meteo returned.
 * @returns A single weather symbol, or the thermometer character used for a code with no
 *   glyph of its own.
 */
export function weatherGlyph(code: number): string {
  if (code === 0) return '\u2600'; // clear
  if (code === 1 || code === 2) return '\u{1F324}'; // mainly clear / partly cloudy
  if (code === 3) return '\u2601'; // overcast
  if (code === 45 || code === 48) return '\u{1F32B}'; // fog
  if (code >= 51 && code <= 57) return '\u{1F326}'; // drizzle
  if (code >= 61 && code <= 67) return '\u{1F327}'; // rain
  if (code >= 71 && code <= 77) return '\u{1F328}'; // snow
  if (code >= 80 && code <= 82) return '\u{1F327}'; // rain showers
  if (code >= 95) return '\u26C8'; // thunderstorm
  return '\u{1F321}'; // unknown
}

/**
 * Whether a WMO code means rain or worse.
 *
 * The event page uses this to add a "bring a coat" hint, so it deliberately
 * covers every wet code the map knows, not only the ones the brief lists.
 *
 * @param code - The numeric `weather_code` Open-Meteo returned.
 * @returns True for drizzle, rain, rain showers and thunderstorms.
 */
export function isWetWeather(code: number): boolean {
  return (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95;
}

/**
 * Today's date in the visitor's own timezone.
 *
 * @param now - The instant to read the date from. May be omitted, in which case the
 *   current time is used; a test passes a fixed instant so the result is stable.
 * @returns The date as `YYYY-MM-DD`, built from the local date parts so the day does not
 *   shift for a visitor east or west of the server.
 */
export function todayIso(now: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * Whole days from today to a date, counting today as day zero.
 *
 * @param isoDate - A `YYYY-MM-DD` date, for example an event's `eventDate`.
 * @param now - The instant to compare against. May be omitted, in which case the current
 *   time is used.
 * @returns The day offset, negative for a date that has passed, or null when the input is
 *   missing or cannot be read as a calendar date.
 */
export function daysUntil(isoDate: string | null | undefined, now: Date = new Date()): number | null {
  if (typeof isoDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null;
  const today = Date.parse(`${todayIso(now)}T00:00:00Z`);
  const target = Date.parse(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(target)) return null;
  return Math.round((target - today) / 86_400_000);
}
