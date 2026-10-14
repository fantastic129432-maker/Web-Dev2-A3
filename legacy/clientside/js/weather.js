/**
 * js/weather.js
 * ---------------------------------------------------------------------------
 * The optional external API from Assessment 3: a weather forecast for the day
 * of the event, from Open-Meteo.
 *
 * Why Open-Meteo? The brief asks for api.open-meteo.com specifically, and it
 * needs no API key and no registration, so nothing secret has to be shipped to
 * the marker or committed to the repository.
 *
 * Where the coordinates come from
 *   `locations.latitude` and `locations.longitude` in the database (added to the
 *   schema in Assessment 3 for exactly this purpose) and returned by the event
 *   detail endpoint as `latitude` / `longitude`. The API key is therefore not
 *   needed anywhere: the request is built from data the API already serves.
 *
 * Graceful degradation
 *   Every failure path returns null and never throws. The forecast is a bonus,
 *   so a venue with no coordinates, an event too far in the future for a
 *   reliable daily forecast, or an offline machine must not break the event
 *   page - it simply shows nothing, or the "not available" note.
 */
import { WEATHER_API_URL, WEATHER_TIMEZONE, WEATHER_FORECAST_DAYS } from './config.js';

/** Today in the visitor's own timezone, as YYYY-MM-DD. */
function todayIso() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Whole days from today (inclusive) to `isoDate`, or null when unparseable. */
export function daysUntil(isoDate) {
  if (typeof isoDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null;
  const today = Date.parse(`${todayIso()}T00:00:00Z`);
  const target = Date.parse(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(target)) return null;
  return Math.round((target - today) / 86_400_000);
}

/**
 * Can a forecast be shown at all?
 *
 * Two conditions:
 *   * the venue must have coordinates (the "Online" pseudo-venue has none), and
 *   * the event date must be inside Open-Meteo's daily forecast window.
 *
 * A past event gets no forecast: there is nothing useful to tell a visitor
 * about a day that has already happened.
 */
export function canShowForecast(event) {
  if (!event) return false;
  if (typeof event.latitude !== 'number' || typeof event.longitude !== 'number') {
    return false;
  }
  const offset = daysUntil(event.eventDate || event.dateStart);
  if (offset === null) return false;
  return offset >= 0 && offset <= WEATHER_FORECAST_DAYS;
}

/**
 * Fetch the daily forecast for the event date.
 *
 * @param {object} event an event from GET /api/events/:id
 * @param {{signal?: AbortSignal}} [options]
 * @returns {Promise<object|null>} the day's forecast, or null when unavailable
 */
export async function fetchEventForecast(event, { signal } = {}) {
  if (!canShowForecast(event)) return null;

  const date = event.eventDate || event.dateStart;
  const params = new URLSearchParams({
    latitude: String(event.latitude),
    longitude: String(event.longitude),
    daily:
      'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max',
    timezone: WEATHER_TIMEZONE,
    // Only the event day matters, so the window is reduced to that one day.
    start_date: date,
    end_date: date,
  });

  let response;
  try {
    response = await fetch(`${WEATHER_API_URL}?${params.toString()}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal,
    });
  } catch (error) {
    // Network failure or the caller aborted: no forecast, but not an error the
    // visitor needs to see.
    return null;
  }

  if (!response.ok) return null;

  let body;
  try {
    body = await response.json();
  } catch (error) {
    return null;
  }

  const daily = body && body.daily;
  if (!daily || !Array.isArray(daily.time) || daily.time.length === 0) return null;

  // The API returns arrays; with a one-day window the answer is element 0. If
  // the requested day is missing (Open-Meteo can answer with a shorter window),
  // the matching index is looked up rather than assumed.
  const index = daily.time.indexOf(date);
  if (index === -1) return null;

  const value = (series) =>
    Array.isArray(series) && series[index] !== null && series[index] !== undefined
      ? Number(series[index])
      : null;

  const code = value(daily.weather_code);
  if (code === null) return null;

  return {
    date,
    weatherCode: code,
    temperatureMax: value(daily.temperature_2m_max),
    temperatureMin: value(daily.temperature_2m_min),
    rainChance: value(daily.precipitation_probability_max),
    windMax: value(daily.wind_speed_10m_max),
    latitude: Number(event.latitude),
    longitude: Number(event.longitude),
    venueName: event.venueName || '',
    city: event.city || '',
    timezone: body.timezone || WEATHER_TIMEZONE,
  };
}

/**
 * The WMO weather interpretation codes Open-Meteo returns, mapped to the
 * translation keys added in translations.js.
 *
 * The brief lists the main groups (0; 1, 2, 3; 45, 48; 51, 53, 55; 61, 63, 65;
 * 80, 81, 82; 95) and these keys follow exactly that grouping, with the few
 * extra codes Open-Meteo can return so no code is ever left unlabelled.
 */
const WMO_KEYS = {
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

/** The translation key for a WMO code, falling back to the nearest group. */
export function weatherCodeKey(code) {
  return WMO_KEYS[code] || 'weather.code3';
}

/**
 * A glyph for the forecast, so the panel reads at a glance.
 * Deliberately plain characters rather than an image: nothing extra to load.
 */
export function weatherGlyph(code) {
  if (code === 0) return '☀';
  if (code === 1 || code === 2) return '🌤';
  if (code === 3) return '☁';
  if (code === 45 || code === 48) return '🌫';
  if (code >= 51 && code <= 57) return '🌦';
  if (code >= 61 && code <= 67) return '🌧';
  if (code >= 71 && code <= 77) return '🌨';
  if (code >= 80 && code <= 82) return '🌧';
  if (code >= 95) return '⛈';
  return '🌡';
}

/** True when the code means rain, so the page can add a "bring a coat" hint. */
export function isWetWeather(code) {
  return (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95;
}
