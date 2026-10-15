import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { ApiError } from '@charity/shared/api/api-error';
import { ApiService } from '@charity/shared/api/api.service';
import { TranslationService } from '@charity/shared/i18n/translation.service';
import { TranslatePipe } from '@charity/shared/i18n/translate.pipe';
import type { EventDetail, TicketType } from '@charity/shared/models/event.model';
import type { Registration } from '@charity/shared/models/registration.model';
import {
  formatCurrency,
  formatDate,
  formatDateRange,
  formatDateTime,
  formatPrice,
  formatTime,
  formatTimeRange,
  imageUrl,
  stateKey,
} from '@charity/shared/util/format';
import { WeatherService } from '@charity/shared/weather/weather.service';
import {
  isWetWeather,
  weatherCodeKey,
  weatherGlyph,
  type WeatherForecast,
} from '@charity/shared/weather/weather.model';

import { ProgressBarComponent } from '../../shared/progress-bar';
import { useDocumentTitle } from '../../shared/page-title';

/** The page's loading/loaded/failed state. */
interface DetailState {
  loading: boolean;
  event: EventDetail | null;
  error: string | null;
  /** Extra explanatory lines for a 404, which is a different problem from a failure. */
  details: string[];
}

/**
 * The event detail page.
 *
 * ENDPOINTS USED
 *   `GET /api/events/:id`  everything on this page.
 *
 * WHY ONE REQUEST IS ENOUGH
 *   Assessment 3 extended this endpoint to include the COMPLETE registration list
 *   for the event, so the registrations table (the key A3 requirement) needs no
 *   second call. That is also why there is no spinner inside the table: the rows
 *   arrive with the event itself.
 *
 * THE REGISTRATION LIST IS NOT RE-SORTED HERE
 *   The API orders it `registered_at DESC` - "newest purchase first", which is what
 *   the brief asks for. Sorting again in the browser would be a second source of
 *   truth for the same rule, and the two could disagree (a date-only sort in the
 *   browser cannot break a tie between two purchases on the same day, the way the
 *   database's timestamp ordering can). The array is rendered in the order it
 *   arrived.
 *
 * WHY THE WEATHER PANEL IS OPTIONAL AND CANNOT FAIL
 *   The forecast comes from a third-party API (Open-Meteo) using the venue's
 *   latitude/longitude, which the event response supplies. A venue with no
 *   coordinates ("Online (Australia-wide)"), an event more than 16 days away, or
 *   a machine with no internet must NOT break a page whose real content is the
 *   event. `WeatherService.forecastFor()` resolves `null` for every one of those
 *   cases instead of erroring, and this component simply renders nothing when it
 *   gets `null`. `canShowForecast()` is consulted first so no request is even
 *   attempted for a past event or a venue without coordinates.
 *
 * WHY A PAST EVENT SHOWS A DISABLED BUTTON
 *   There is nothing left to book, so a link to the registration form would only
 *   lead to a form that refuses to submit. A `<button disabled>` states the
 *   situation ("Registration closed") without inviting the click.
 */
@Component({
  selector: 'app-event-detail-page',
  imports: [RouterLink, ProgressBarComponent, TranslatePipe],
  templateUrl: './event-detail.html',
})
export class EventDetailPage {
  private readonly api = inject(ApiService);
  private readonly i18n = inject(TranslationService);
  private readonly weather = inject(WeatherService);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  /** Tab title: the route data names the page, then the event names itself. */
  private readonly title = useDocumentTitle();

  /** The page state. One object, because the three parts always move together. */
  protected readonly state = signal<DetailState>({
    loading: true,
    event: null,
    error: null,
    details: [],
  });

  /** The forecast for the event day, or null when there is none to show. */
  protected readonly forecast = signal<WeatherForecast | null>(null);

  /**
   * True once the forecast request has finished, whether it produced a forecast or
   * not.
   *
   * `forecast()` is null both WHILE the request is in flight and AFTER it has
   * definitively come back with nothing (WeatherService resolves null for every
   * failure instead of erroring, so the page degrades quietly). Without this flag
   * the panel could not tell the two apart and showed "Loading the forecast..."
   * forever on an event whose forecast was simply unavailable.
   */
  protected readonly forecastSettled = signal(false);

  /**
   * True when a forecast could be requested at all.
   *
   * Checked through the service rather than reimplementing the rule (coordinates
   * present AND the date inside Open-Meteo's 16-day window) so this page and the
   * service can never disagree about whether the panel should exist.
   */
  protected readonly weatherPossible = computed(() => {
    const event = this.state().event;
    return event !== null && this.weather.canShowForecast(event);
  });

  /** The event, or null. A named accessor keeps the template readable. */
  protected readonly event = computed(() => this.state().event);

  /** The registrations, newest first, exactly as the API ordered them. */
  protected readonly registrations = computed<Registration[]>(
    () => this.state().event?.registrations ?? []
  );

  /** The event's route param, read once in the constructor. */
  private readonly eventId = this.route.snapshot.paramMap.get('id') ?? '';

  constructor() {
    this.title.set();
    this.load();
  }

  /* ==================================================================
   * Loading
   * ================================================================== */

  /**
   * `GET /api/events/:id`, then the optional forecast.
   *
   * A 404 is reported differently from every other failure: the event may have
   * been suspended by the organisation since the link was shared, which is a
   * normal outcome rather than a fault, and the extra hint says so.
   */
  private load(): void {
    if (!this.eventId) {
      this.state.set({
        loading: false,
        event: null,
        error: this.i18n.t('event.noIdTitle'),
        details: [this.i18n.t('event.noIdHint')],
      });
      return;
    }

    this.api
      .getEventById(this.eventId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (event) => {
          this.state.set({ loading: false, event, error: null, details: [] });
          // The tab title names the event, which is what makes several open tabs
          // distinguishable - the same reason the legacy page set document.title.
          this.title.set('event.detailTitle', { name: event.eventName });
          this.loadForecast(event);
        },
        error: (error: unknown) => {
          const isNotFound = error instanceof ApiError && error.isNotFound;
          const message =
            error instanceof ApiError
              ? error.friendlyMessage((key) => this.i18n.t(key))
              : this.i18n.t('error.eventLoadFailed');
          this.state.set({
            loading: false,
            event: null,
            error: message,
            details: isNotFound ? [this.i18n.t('error.eventSuspendedHint')] : [],
          });
        },
      });
  }

  /**
   * Fetch the forecast, if one is possible.
   *
   * Kept out of the event request on purpose: the forecast is a bonus, so it must
   * not delay or break the details, and a language change must not trigger another
   * call to Open-Meteo.
   */
  private loadForecast(event: EventDetail): void {
    if (!this.weather.canShowForecast(event)) {
      this.forecast.set(null);
      this.forecastSettled.set(true);
      return;
    }

    this.weather
      .forecastFor(event)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((forecast) => {
        this.forecast.set(forecast);
        // forecastFor() never errors - it resolves null instead - so this callback
        // always runs and the panel can never be left in its loading state.
        this.forecastSettled.set(true);
      });
  }

  /* ==================================================================
   * Presentation helpers
   *
   * Every string the page shows is built here rather than in the template,
   * because they are all combinations of several fields (a date range plus a
   * time, a venue plus its address, two prices) and a template expression long
   * enough to do that is a template expression nobody can read.
   * ================================================================== */

  /** The artwork path, falling back to the shared default image. */
  protected readonly image = computed(() => {
    const event = this.event();
    return event ? imageUrl(event) : '';
  });

  /** The state badge's classes, e.g. `badge badge--upcoming`. */
  protected readonly badgeClass = computed(
    () => `badge badge--${this.event()?.eventState ?? 'upcoming'}`
  );

  /** "Upcoming" / "On now" / "Past event", as a dictionary key. */
  protected readonly stateLabelKey = computed(() => stateKey(this.event()?.eventState));

  /**
   * The price summary under the title.
   *
   * Three cases, in this order: every tier free (or the event flagged free) says
   * so; an event with no tiers points at the organiser rather than inventing a
   * price; otherwise the range from the cheapest paid tier to the dearest is
   * shown, collapsing to one price when they are equal.
   */
  protected readonly priceSummary = computed(() => {
    const event = this.event();
    if (!event) return '';
    const prices = (event.ticketTypes ?? []).map((tier) => Number(tier.price));

    if (event.isFree || (prices.length > 0 && prices.every((price) => price === 0))) {
      return this.i18n.t('event.freeEntry');
    }
    if (prices.length === 0) {
      return this.i18n.t('event.contactForPrices');
    }

    const min = Math.min(...prices.filter((price) => price > 0));
    const max = Math.max(...prices);
    if (min === max) return this.i18n.t('event.ticketsSingle', { price: formatPrice(min) });
    return this.i18n.t('event.ticketsFromTo', { min: formatPrice(min), max: formatPrice(max) });
  });

  /** "Sunday 24 October 2026" */
  protected readonly fullDate = computed(() => formatDate(this.event()?.dateStart));

  /** "6:30 pm - 11:00 pm" */
  protected readonly timeRange = computed(() => {
    const event = this.event();
    return event ? formatTimeRange(event) : '';
  });

  /** "Coffs Harbour Jetty Foreshore, Marina Dr" (the address is omitted when N/A). */
  protected readonly venueLine = computed(() => {
    const event = this.event();
    if (!event) return '';
    const address = event.address && event.address !== 'N/A' ? `, ${event.address}` : '';
    return `${event.venueName ?? ''}${address}`;
  });

  /** "Coffs Harbour NSW 2450" */
  protected readonly locationLine = computed(() => {
    const event = this.event();
    if (!event) return '';
    return `${event.city ?? ''} ${event.state ?? ''} ${event.postcode ?? ''}`.trim();
  });

  /**
   * The description, split into paragraphs.
   *
   * One paragraph per run of newlines, so a long description stays readable. The
   * text is rendered through Angular's normal interpolation, which escapes it -
   * the same protection the legacy code got from setting textContent.
   */
  protected readonly descriptionParagraphs = computed(() => {
    const description = this.event()?.description ?? '';
    return description
      .split(/\n+/)
      .map((paragraph) => paragraph.trim())
      .filter((paragraph) => paragraph !== '');
  });

  /** The availability line for one ticket tier: "12 available" or "Sold out". */
  protected tierAvailability(tier: TicketType): string {
    if (tier.quantityAvailable === null || tier.quantityAvailable === undefined) return '';
    return tier.quantityAvailable > 0
      ? this.i18n.t('event.availableCount', { count: tier.quantityAvailable })
      : this.i18n.t('event.soldOut');
  }

  /** "Free" or "$185.00" for one ticket tier. */
  protected tierPrice(tier: TicketType): string {
    return Number(tier.price) === 0 ? this.i18n.t('event.free') : formatPrice(tier.price);
  }

  /** "$370" - whole dollars, for the registrations table's Value column. */
  protected money(amount: number | null | undefined): string {
    return formatCurrency(amount);
  }

  /**
   * "14 Sep 2026, 8:57 am" for one purchase.
   *
   * The API sends "YYYY-MM-DD HH:MM:SS"; formatDateTime normalises the space to a
   * T first, which Safari requires. The exact timestamp is kept in the cell's
   * `title` so it is still available on hover without making the column too wide.
   */
  protected purchasedAt(registration: Registration): string {
    return formatDateTime(registration.registeredAt);
  }

  /** The sum of every registration's value, for the totals row. */
  protected readonly ticketsValue = computed(() =>
    this.registrations().reduce((sum, row) => sum + Number(row.totalAmount ?? 0), 0)
  );

  /** How many tickets have been sold in total, from the API's own total. */
  protected readonly ticketsSold = computed(
    () => this.state().event?.totalTicketsSold ?? this.state().event?.ticketsSold ?? 0
  );

  /** "This event finished on ..." / "takes place on ..." / "is taking place today." */
  protected readonly statusSentence = computed(() => {
    const event = this.event();
    if (!event) return '';
    if (event.eventState === 'past') {
      return this.i18n.t('event.statusPast', { date: formatDate(event.dateEnd) });
    }
    if (event.eventState === 'ongoing') return this.i18n.t('event.statusOngoing');
    return this.i18n.t('event.statusUpcoming', { date: formatDateRange(event) });
  });

  /** How much is still needed to reach the goal, floored at zero. */
  protected readonly remaining = computed(() => {
    const event = this.event();
    if (!event) return formatCurrency(0);
    return formatCurrency(Math.max(Number(event.goalAmount ?? 0) - Number(event.raisedAmount ?? 0), 0));
  });

  /* ==================================================================
   * Weather helpers
   * ================================================================== */

  /** The panel's heading line: venue, city and date, already substituted. */
  protected readonly weatherLead = computed(() => {
    const current = this.forecast();
    if (!current) return '';
    return this.i18n.t('weather.lead', {
      venue: current.venueName,
      city: current.city,
      date: formatDate(current.date),
    });
  });

  /** The WMO code described in the active language. */
  protected readonly weatherLabel = computed(() => {
    const current = this.forecast();
    return current ? this.i18n.t(weatherCodeKey(current.weatherCode)) : '';
  });

  /** The forecast glyph, e.g. a sun or a rain cloud. */
  protected readonly weatherIcon = computed(() => {
    const current = this.forecast();
    return current ? weatherGlyph(current.weatherCode) : '';
  });

  /** True when the forecast means rain, which adds the "bring a coat" hint. */
  protected readonly weatherWet = computed(() => {
    const current = this.forecast();
    return current ? isWetWeather(current.weatherCode) : false;
  });

  /** "High 24°C  ·  Low 15°C", omitting either half when Open-Meteo had no value. */
  protected readonly temperatures = computed(() => {
    const current = this.forecast();
    if (!current) return '';
    const parts: string[] = [];
    if (current.temperatureMax !== null) {
      parts.push(`${this.i18n.t('weather.high')} ${Math.round(current.temperatureMax)}\u00B0C`);
    }
    if (current.temperatureMin !== null) {
      parts.push(`${this.i18n.t('weather.low')} ${Math.round(current.temperatureMin)}\u00B0C`);
    }
    return parts.join('  \u00B7  ');
  });

  /** "Chance of rain: 40%" or null when Open-Meteo sent no probability. */
  protected readonly rainChance = computed(() => {
    const current = this.forecast();
    if (!current || current.rainChance === null) return null;
    return `${this.i18n.t('weather.rainChance')}: ${Math.round(current.rainChance)}%`;
  });

  /** "Max wind: 25 km/h" or null when Open-Meteo sent no wind figure. */
  protected readonly windMax = computed(() => {
    const current = this.forecast();
    if (!current || current.windMax === null) return null;
    return `${this.i18n.t('weather.wind')}: ${Math.round(current.windMax)} km/h`;
  });
}
