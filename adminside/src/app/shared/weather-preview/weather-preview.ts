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

/**
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
 *   resolves `null` instead of rejecting, and this component renders one of FOUR
 *   states - nothing chosen yet, loading, a forecast, or "not available" - and
 *   never an error.
 *
 *   The first of those four is a review item rather than a nicety: before a venue
 *   and a date exist there is nothing to be unavailable ABOUT, and opening on the
 *   two-sentence "no forecast is available..." note made a working form look
 *   broken. `nothingChosen` below is what separates the two, and it is tested
 *   before `loading` and before the note - see the branch order in the template.
 *
 * Re-fetching: the target arrives as a signal input, and `toObservable` +
 * `switchMap` means a change of venue or date cancels the request in flight and
 * issues the new one, so a slow answer for the old venue can never overwrite the
 * forecast for the new one.
 */
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

  /**
   * Has the administrator chosen enough for a forecast to be asked for?
   *
   * `true` means "nothing chosen yet": no venue, or no date - the two facts
   * WeatherService needs. It is deliberately NOT "no forecast", which is the
   * state the long `weather.unavailable` note is about and which can only be
   * reached once both have been chosen (a venue with no coordinates, or a date
   * outside the 16-day window).
   *
   * WHY IT READS THE TARGET RATHER THAN THE FORECAST. `forecastFor()` answers
   * null for BOTH cases, so the resolved forecast cannot tell them apart; the
   * target can, because it carries exactly what the person has picked: the venue
   * NAME from the dropdown and the start date from the date box. The form's
   * `weatherTarget()` always builds a target object (with null coordinates and an
   * empty date before anything is chosen), so a null target is treated as
   * "nothing chosen" too rather than as a third state.
   */
  protected readonly nothingChosen = computed(() => {
    const value = this.target();
    if (!value) return true;

    const venue = (value.venueName ?? '').trim();
    const date = String(value.eventDate ?? value.dateStart ?? '').trim();
    return venue === '' || date === '';
  });

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
