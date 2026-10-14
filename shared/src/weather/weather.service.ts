/**
 * shared/src/weather/weather.service.ts
 * ---------------------------------------------------------------------------
 * The optional external API from Assessment 3: a forecast for the day of the
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
 *   resolves to `null` and the UI simply shows nothing - see
 *   canShowForecast() for the two conditions that must hold before a request is
 *   even attempted.
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

@Injectable({ providedIn: 'root' })
export class WeatherService {
  private readonly http = inject(HttpClient);

  /**
   * Can a forecast be shown for this event at all?
   *
   * Two conditions:
   *   * the venue must have coordinates (the "Online" pseudo-venue has none),
   *   * the event date must be inside Open-Meteo's daily forecast window.
   *
   * A past event gets no forecast: there is nothing useful in telling a visitor
   * what the weather was.
   */
  canShowForecast(target: WeatherTarget | null | undefined): boolean {
    if (!target) return false;
    if (typeof target.latitude !== 'number' || typeof target.longitude !== 'number') return false;
    const offset = daysUntil(target.eventDate ?? target.dateStart);
    if (offset === null) return false;
    return offset >= 0 && offset <= APP_CONFIG.weatherForecastDays;
  }

  /** The ISO date the forecast is requested for. */
  forecastDate(target: WeatherTarget): string {
    return String(target.eventDate ?? target.dateStart ?? '');
  }

  /**
   * Fetch the daily forecast for the event's own date, at the event's own
   * coordinates.
   *
   * Resolves to `null` (never rejects) whenever a forecast is unavailable, so the
   * caller can render the panel unconditionally.
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
