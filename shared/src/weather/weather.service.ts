/**
 * @file The optional external API from Assessment 3: a forecast for the day of the
 * event, from Open-Meteo (https://api.open-meteo.com/v1/forecast).
 *
 * Why Open-Meteo?
 *   The brief names api.open-meteo.com specifically, and it needs no API key and
 *   no registration - so nothing secret has to be committed or shipped to a
 *   marker. That is also why the call is made from the BROWSER rather than
 *   proxied through the Express API: there is no credential to protect, and the
 *   free endpoint allows it.
 *
 * Where the coordinates come from
 *   `locations.latitude` / `locations.longitude`, added to the database schema in
 *   Assessment 3 for exactly this purpose and returned by the event endpoints as
 *   `latitude` / `longitude`. The request is therefore built entirely from data
 *   the API already serves.
 *
 * Graceful degradation (important)
 *   The forecast is a bonus. A venue with no coordinates ("Online"), an event
 *   too far ahead for a reliable daily forecast, a machine with no internet, or
 *   Open-Meteo being slow must NOT break the event page. Every failure path
 *   resolves to `null`, so the visitor never meets an error.
 *
 *   "Resolves to null" is NOT "says nothing", though. The event page keeps the
 *   weather module on EVERY event, so a visitor who sees no forecast is told
 *   why: forecastUnavailableReason() is the one place that decides which of
 *   those cases applies (past event, venue without coordinates, unreadable date,
 *   date beyond the forecast window), and canShowForecast() is now just
 *   "that answered null". Keeping the two together is what stops the page and
 *   the service from disagreeing about whether a request should even be made.
 */
import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, map, of, timeout } from 'rxjs';

import { APP_CONFIG } from '../config/app-config';
import { daysUntil, type WeatherForecast, type WeatherTarget } from './weather.model';

/** The subset of Open-Meteo's response this application reads. */
interface OpenMeteoResponse {
  timezone?: string;
  daily?: {
    time?: string[];
    weather_code?: Array<number | null>;
    temperature_2m_max?: Array<number | null>;
    temperature_2m_min?: Array<number | null>;
    precipitation_probability_max?: Array<number | null>;
    wind_speed_10m_max?: Array<number | null>;
  };
}

/**
 * Why an event cannot have a forecast, for a panel that has to say so.
 *
 * The four cases are the honest answers to "why is there no forecast here?", and
 * the event page renders one translated sentence per case. They are a union
 * rather than free text so the reason cannot drift into an English sentence
 * inside the shared library, where no dictionary could translate it.
 *
 *   noCoordinates   the venue publishes no latitude/longitude ("Online")
 *   noDate          the event carries no readable YYYY-MM-DD date, or no target
 *                   was handed over at all
 *   past            the day has gone; what the weather WAS helps nobody
 *   beyondHorizon   the day is further ahead than the daily forecast reaches
 */
export type ForecastUnavailableReason = 'noCoordinates' | 'noDate' | 'past' | 'beyondHorizon';

/**
 * Fetch the daily forecast for an event, from the browser.
 *
 * The forecast is a bonus, so this service is deliberately quiet: every failure
 * resolves to null instead of rejecting, and the caller renders the panel
 * unconditionally. The coordinates come from the event itself, which the API
 * serves from `locations.latitude` / `locations.longitude`.
 */
@Injectable({ providedIn: 'root' })
export class WeatherService {
  /** The Angular HTTP client used for the Open-Meteo request. */
  private readonly http = inject(HttpClient);

  /**
   * Why a forecast cannot be shown for this event, or null when one can.
   *
   * The conditions are tested in the order `noCoordinates`, `noDate`, `past`,
   * `beyondHorizon`, and the order is deliberate where two of them are true at
   * once - an event that is both past AND held at a venue without coordinates
   * reports `noCoordinates`, because that is the fact about the EVENT, while "it
   * is over" is a fact about the calendar. The seeded "Move for Climate Virtual
   * Challenge" is exactly that pair the other way round (no coordinates and far
   * ahead), and it reports `noCoordinates` for the same reason: the Online
   * pseudo-venue can never have a local forecast, however close the date gets.
   *
   * `noDate` is the fallback for a target that cannot be asked about at all - a
   * missing object, or a date that is not `YYYY-MM-DD`. It is rare against the
   * database (the column is NOT NULL) but reachable from the admin form's draft
   * and from a malformed row, and it must not be reported as one of the other
   * three: "the event is beyond the forecast window" would be a lie.
   *
   * @param target - The event, or the draft an administrator is still filling in. May be
   *   null or undefined.
   * @returns The reason, or null when a request is worth making.
   */
  forecastUnavailableReason(
    target: WeatherTarget | null | undefined
  ): ForecastUnavailableReason | null {
    if (!target) return 'noDate';
    if (!Number.isFinite(target.latitude) || !Number.isFinite(target.longitude)) {
      return 'noCoordinates';
    }

    const offset = daysUntil(target.eventDate ?? target.dateStart);
    if (offset === null) return 'noDate';
    if (offset < 0) return 'past';
    if (offset > APP_CONFIG.weatherForecastDays) return 'beyondHorizon';
    return null;
  }

  /**
   * Decide whether a forecast can be shown for this event at all.
   *
   * Kept as the yes/no form of forecastUnavailableReason() for the callers that
   * only need to branch (and for the admin preview, which has its own
   * "nothing chosen yet" state), so the rule itself lives in exactly one place.
   *
   * @param target - The event, or the draft an administrator is still filling in. May be
   *   null or undefined, in which case no forecast is possible.
   * @returns True when a request is worth making, false for an event with no
   *   coordinates, no usable date, a past date or a date beyond the forecast window.
   */
  canShowForecast(target: WeatherTarget | null | undefined): boolean {
    return this.forecastUnavailableReason(target) === null;
  }

  /**
   * The ISO date the forecast is requested for.
   *
   * @param target - The event whose date is wanted.
   * @returns `eventDate` when the API sent one, otherwise `dateStart`, and an empty
   *   string when the event carries neither.
   */
  forecastDate(target: WeatherTarget): string {
    return String(target.eventDate ?? target.dateStart ?? '');
  }

  /**
   * Fetch the daily forecast for the event's own date and coordinates.
   *
   * Resolves to `null` (never rejects) whenever a forecast is unavailable, so the
   * caller can render the panel unconditionally.
   *
   * @param target - The event to forecast for. May be null or undefined, in which case
   *   the result is an immediate null rather than a request.
   * @returns An Observable that emits the forecast, or null when the event cannot have
   *   one, when Open-Meteo has no value for the day, or when the request fails or times
   *   out.
   */
  forecastFor(target: WeatherTarget | null | undefined): Observable<WeatherForecast | null> {
    if (!target || !this.canShowForecast(target)) return of(null);

    const date = this.forecastDate(target);
    const latitude = Number(target.latitude);
    const longitude = Number(target.longitude);

    const params = new HttpParams()
      .set('latitude', String(latitude))
      .set('longitude', String(longitude))
      .set(
        'daily',
        'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max'
      )
      .set('timezone', APP_CONFIG.weatherTimezone)
      // Only the event day matters, so the window is reduced to that one day.
      .set('start_date', date)
      .set('end_date', date);

    return this.http
      .get<OpenMeteoResponse>(APP_CONFIG.weatherApiUrl, { params })
      .pipe(
        timeout({ each: APP_CONFIG.requestTimeoutMs }),
        map((body) => this.toForecast(body, date, latitude, longitude, target)),
        // Network failure, timeout, an unexpected status or a non-JSON body: no
        // forecast, but not an error the visitor needs to see.
        catchError(() => of(null))
      );
  }

  /**
   * Convert Open-Meteo's parallel arrays into one day's forecast.
   *
   * The API answers with arrays; with a one-day window the answer is element 0.
   * If the requested day is missing (Open-Meteo can shorten its window) the
   * matching index is looked up rather than assumed, and a missing code makes the
   * whole forecast unavailable.
   */
  private toForecast(
    body: OpenMeteoResponse,
    date: string,
    latitude: number,
    longitude: number,
    target: WeatherTarget
  ): WeatherForecast | null {
    const daily = body?.daily;
    if (!daily || !Array.isArray(daily.time) || daily.time.length === 0) return null;

    const index = daily.time.indexOf(date);
    if (index === -1) return null;

    const value = (series: Array<number | null> | undefined): number | null => {
      if (!Array.isArray(series)) return null;
      const raw = series[index];
      return raw === null || raw === undefined ? null : Number(raw);
    };

    const code = value(daily.weather_code);
    if (code === null) return null;

    return {
      date,
      weatherCode: code,
      temperatureMax: value(daily.temperature_2m_max),
      temperatureMin: value(daily.temperature_2m_min),
      rainChance: value(daily.precipitation_probability_max),
      windMax: value(daily.wind_speed_10m_max),
      latitude,
      longitude,
      venueName: target.venueName ?? '',
      city: target.city ?? '',
      timezone: body.timezone ?? APP_CONFIG.weatherTimezone,
    };
  }
}
