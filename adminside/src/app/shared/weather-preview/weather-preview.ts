/**
 * adminside/src/app/shared/weather-preview/weather-preview.ts
 * ---------------------------------------------------------------------------
 * The live Open-Meteo forecast for the venue and date the administrator has
 * chosen - the optional external API from Assessment 3, shown BEFORE the event
 * exists in the database.
 *
 * WHY THIS DISTINGUISHES THE ADMIN FORM FROM A PLAIN CRUD FORM
 *   A create/edit form only needs the database. This panel needs a second, public
 *   API: the venue's latitude/longitude (which GET /api/admin/reference-data
 *   returns) plus the event date are turned into a `WeatherTarget`, and
 *   WeatherService.forecastFor() asks Open-Meteo for exactly that day at exactly
 *   those coordinates. The staff member can therefore see that a beach fun run
 *   is forecast to be wet on the day, and move it, while it is still a draft.
 *
 * IT MUST NEVER BREAK THE FORM (the important part)
 *   A venue with no coordinates (the "Online" pseudo-venue), a date beyond
 *   Open-Meteo's 16-day window, a machine with no internet or a slow answer must
 *   not stop an event from being created. WeatherService.forecastFor() therefore
 *   resolves `null` instead of rejecting, and this component renders one of three
 *   states - loading, a forecast, or "not available" - and never an error.
 *
 * Re-fetching: the target arrives as a signal input, and `toObservable` +
 * `switchMap` means a change of venue or date cancels the request in flight and
 * issues the new one, so a slow answer for the old venue can never overwrite the
 * forecast for the new one.
 */
import { Component, computed, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { finalize, switchMap } from 'rxjs';

import { TranslatePipe } from '@charity/shared/i18n/translate.pipe';
import { TranslationService } from '@charity/shared/i18n/translation.service';
import { formatShortDate } from '@charity/shared/util/format';
import {
  isWetWeather,
  weatherCodeKey,
  weatherGlyph,
  type WeatherForecast,
  type WeatherTarget,
} from '@charity/shared/weather/weather.model';
import { WeatherService } from '@charity/shared/weather/weather.service';

@Component({
  selector: 'admin-weather-preview',
  imports: [TranslatePipe],
  styleUrl: './weather-preview.css',
  templateUrl: './weather-preview.html',
})
export class WeatherPreview {
  private readonly weather = inject(WeatherService);
  private readonly i18n = inject(TranslationService);

  /**
   * Where and when. Built by the event form from the chosen venue and date, so
   * the panel updates as those two controls change.
   */
  readonly target = input<WeatherTarget | null>(null);

  /** The resolved forecast, or null when there is none to show. */
  protected readonly forecast = signal<WeatherForecast | null>(null);

  /** True while a request is in flight. */
  protected readonly loading = signal(false);

  /** The summary line: venue, city and the day the forecast is for. */
  protected readonly lead = computed(() => {
    const value = this.forecast();
    if (!value) return '';
    return this.i18n.t('weather.lead', {
      venue: value.venueName,
      city: value.city,
      date: formatShortDate(value.date),
    });
  });

  /** A glyph for the WMO code, so the panel reads at a glance. */
  protected readonly glyph = computed(() => {
    const value = this.forecast();
    return value ? weatherGlyph(value.weatherCode) : '';
  });

  /**
   * The description of the WMO code. weatherCodeKey() returns a translation KEY
   * ('weather.code61'), which the template renders with the `t` pipe - which is
   * what makes the description follow the language switcher.
   */
  protected readonly codeKey = computed(() => {
    const value = this.forecast();
    return value ? weatherCodeKey(value.weatherCode) : '';
  });

  /** Rain, drizzle, showers or a thunderstorm: the panel changes accent. */
  protected readonly wet = computed(() => {
    const value = this.forecast();
    return value ? isWetWeather(value.weatherCode) : false;
  });

  constructor() {
    toObservable(this.target)
      .pipe(
        switchMap((target) => {
          this.loading.set(true);
          // forecastFor() itself answers `of(null)` for a venue with no
          // coordinates or a date outside the window, so there is no need to
          // duplicate that rule here - the panel just gets no forecast.
          return this.weather.forecastFor(target).pipe(finalize(() => this.loading.set(false)));
        }),
        takeUntilDestroyed()
      )
      .subscribe((forecast) => this.forecast.set(forecast));
  }
}
