import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, forkJoin, map, of } from 'rxjs';

import { ApiError } from '@charity/shared/api/api-error';
import { ApiService } from '@charity/shared/api/api.service';
import { TranslationService } from '@charity/shared/i18n/translation.service';
import { TranslatePipe } from '@charity/shared/i18n/translate.pipe';
import type { Event, EventQuery } from '@charity/shared/models/event.model';
import type { Category, Venue } from '@charity/shared/models/reference.model';

import { EventCardComponent } from '../../shared/event-card';
import { useDocumentTitle } from '../../shared/page-title';

/** The event-state selector's three values, which map onto the API's `state`. */
type StateChoice = 'all' | 'upcoming' | 'past';

/** The sort orders the results dropdown offers. */
type SortChoice =
  | 'date-asc'
  | 'date-desc'
  | 'name-asc'
  | 'name-desc'
  | 'goal-desc'
  | 'progress-desc';

/**
 * The complete filter form as one value.
 *
 * A single object rather than eight signals, because every filter is submitted
 * together and reset together: `activeFilters()` and `clearFilters()` can then
 * read and write one thing instead of enumerating fields, and there is no way to
 * reset seven of eight controls.
 */
interface FilterForm {
  keyword: string;
  categories: number[];
  /**
   * The chosen venue, as the <select>'s value: '' means "any venue" and
   * 'city:<name>' means every venue in that city.
   *
   * A single control answers two different questions ("which venue" and "which
   * town") because the visitor is really asking one: where. Keeping it as one
   * string means the two halves cannot both be set, which would produce an
   * impossible filter ("Lismore City Hall" AND "Sydney").
   */
  location: string;
  from: string;
  to: string;
  isFree: boolean;
  state: StateChoice;
}

/** What the results panel is currently doing. */
interface ResultsState {
  /** 'idle' before the first search, then one of the three outcomes. */
  status: 'idle' | 'loading' | 'done' | 'error';
  /** Readonly: these rows came from the API and are never modified in place. */
  events: readonly Event[];
  total: number;
  message: string | null;
}

/** One removable "active filter" chip. */
interface FilterChip {
  label: string;
  clear: () => void;
}

/** An empty form, used both as the initial value and by "Clear filters". */
function emptyForm(): FilterForm {
  return {
    keyword: '',
    categories: [],
    location: '',
    from: '',
    to: '',
    isFree: false,
    state: 'upcoming',
  };
}

/**
 * One entry of the "where" dropdown.
 *
 * The list holds two kinds of entry and the value string says which it is:
 * `city:Lismore` filters by town, `12` filters by venue id. The API accepts both
 * (`city` and `location`), and a single control avoids the impossible
 * combination of a chosen venue plus a different town.
 */
interface LocationOption {
  /** The <option> value: '' | 'city:<name>' | '<locationId>'. */
  value: string;
  /** The already-translated label. */
  label: string;
}

/**
 * The search page.
 *
 * ENDPOINTS USED
 *   `GET /api/categories`  the category checkboxes, each with its event count
 *   `GET /api/locations`   the venue picker and the city suggestion list
 *   `GET /api/events`      the search itself, with whichever filters were chosen
 *
 * THREE DECISIONS WORTH EXPLAINING
 *
 * 1. Client-side validation runs BEFORE the API is called.
 *    A "to" date earlier than the "from" date can never match anything, so
 *    sending it wastes a round trip and produces a confusing "no results" screen
 *    when the real problem is the form. `validate()` returns a message key, the
 *    results panel is replaced by the "please correct the highlighted filter"
 *    state, and no request is issued. The API validates the same rule again - which
 *    is the point: client-side validation improves the experience, server-side
 *    validation protects the data.
 *
 * 2. The filters live in the URL.
 *    After every search the query string is rewritten with `replaceState`, so the
 *    result is shareable and a reload reproduces it. The component also READS the
 *    query string on load and re-runs the search if anything was set, which is
 *    what makes a link like /search?city=Lismore&isFree=true work. Only `from`,
 *    `to`, `city`, `keyword`, `isFree`, `state`, `category`, `sort` and
 *    `direction` are read back - `limit` is an implementation detail.
 *
 * 3. The whole result set is requested in one page.
 *    `limit: 60` rather than the default 20, so a visitor filtering by category
 *    sees everything that matched instead of a first page with no paging control
 *    to reach the rest. The count shown above the grid is the total the API
 *    reports, not just the number of rows received.
 *
 * The category and venue lists are loaded with `forkJoin` so both requests are in
 * flight at the same time; each half also has its own `catchError`, so a failed
 * category lookup still leaves a usable city and date search rather than an empty
 * page.
 */
@Component({
  selector: 'app-search-page',
  imports: [RouterLink, EventCardComponent, TranslatePipe],
  templateUrl: './search.html',
})
export class SearchPage {
  private readonly api = inject(ApiService);
  private readonly i18n = inject(TranslationService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  /** Tab title, from the route's `data.titleKey` ('search.title'). */
  private readonly title = useDocumentTitle();

  /** The live form contents. */
  protected readonly form = signal<FilterForm>(emptyForm());

  /** The category checkboxes, each with its active event count. */
  protected readonly categories = signal<Category[]>([]);

  /** Every venue that currently hosts an active event. */
  protected readonly locations = signal<Venue[]>([]);

  /** True when the category list itself could not be loaded. */
  protected readonly categoriesFailed = signal(false);

  /** The results panel's state. */
  protected readonly results = signal<ResultsState>({
    status: 'idle',
    events: [],
    total: 0,
    message: null,
  });

  /** The selected sort order. */
  protected readonly sort = signal<SortChoice>('date-asc');

  /**
   * The validation message, or null when the form is acceptable.
   *
   * Set by `runSearch()` and cleared by `clearFilters()`. It is shown next to the
   * two date fields (the only rule that can fail) and announced through
   * `role="status"` so a screen reader hears the reason the search did not run.
   */
  protected readonly validationMessage = signal<string | null>(null);

  /** Which date field the message belongs to, so it can be marked invalid. */
  protected readonly invalidField = signal<'from' | 'to' | null>(null);

  /**
   * The "where" dropdown's options.
   *
   * Towns come first (alphabetically) and then the individual venues, because a
   * visitor who is willing to travel usually picks the town, and one who is not
   * picks the venue. Both are derived from GET /api/locations: a town only exists
   * in this project because a venue is in it, so a Set over the venues is the
   * authoritative list and no extra endpoint is needed.
   */
  protected readonly locationOptions = computed<LocationOption[]>(() => {
    const venues = this.locations();
    const towns = [...new Set(venues.map((venue) => venue.city ?? '').filter(Boolean))].sort();

    return [
      ...towns.map((town) => ({ value: `city:${town}`, label: town })),
      ...venues
        .slice()
        .sort((a, b) => a.venueName.localeCompare(b.venueName))
        .map((venue) => ({ value: String(venue.locationId), label: venue.venueName })),
    ];
  });

  /** True when at least one filter is set, which drives the chip list. */
  protected readonly hasActiveFilters = computed(() => this.activeFilters().length > 0);

  /**
   * The active filters as removable chips.
   *
   * The dates are read from the form rather than from the URL, because a date
   * input only exposes a value in its own format and the URL is written as a side
   * effect of searching - reading the form keeps the two in step.
   */
  protected readonly activeFilters = computed<FilterChip[]>(() => {
    const current = this.form();
    const chips: FilterChip[] = [];

    if (current.from || current.to) {
      chips.push({
        label: `${this.i18n.t('search.filterDates')}: ${current.from || '-'} - ${current.to || '-'}`,
        clear: () => this.update({ from: '', to: '' }),
      });
    }

    if (current.location) {
      const chosen =
        this.locationOptions().find((option) => option.value === current.location)?.label ??
        current.location;
      chips.push({
        label: `${this.i18n.t('search.filterLocation')}: ${chosen}`,
        clear: () => this.update({ location: '' }),
      });
    }

    // The name is looked up so the chip reads "Fun Run" rather than "1".
    for (const categoryId of current.categories) {
      const name =
        this.categories().find((category) => category.categoryId === categoryId)?.categoryName ??
        String(categoryId);
      chips.push({
        label: `${this.i18n.t('search.filterCategory')}: ${name}`,
        clear: () => this.toggleCategory(categoryId, false),
      });
    }

    if (current.isFree) {
      chips.push({
        label: this.i18n.t('search.filterFree'),
        clear: () => this.update({ isFree: false }),
      });
    }

    if (current.state !== 'upcoming') {
      chips.push({
        label:
          current.state === 'past'
            ? this.i18n.t('search.filterPast')
            : this.i18n.t('search.stateAll'),
        clear: () => this.update({ state: 'upcoming' }),
      });
    }

    if (current.keyword) {
      chips.push({
        label: `${this.i18n.t('search.filterKeyword')}: ${current.keyword}`,
        clear: () => this.update({ keyword: '' }),
      });
    }

    return chips;
  });

  constructor() {
    this.title.set();

    this.loadFilterOptions();
    this.applyFiltersFromUrl();
  }

  /* ==================================================================
   * Filter options (GET /api/categories, GET /api/locations)
   * ================================================================== */

  /**
   * Load both filter option lists at once.
   *
   * `forkJoin` rather than two chained requests: the form needs both before it is
   * complete, and running them in parallel halves the wait. The catchError blocks
   * inside mean a failure on either side is converted to an empty list plus a
   * flag, so `forkJoin` never errors and the form always renders.
   */
  private loadFilterOptions(): void {
    forkJoin({
      categories: this.api.getCategories().pipe(
        catchError(() => {
          this.categoriesFailed.set(true);
          return of<Category[]>([]);
        })
      ),
      // A city search does not need the venue list, so a failure here is silent:
      // the datalist is simply empty and the visitor can still type a city.
      locations: this.api.getLocations().pipe(catchError(() => of<Venue[]>([]))),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(({ categories, locations }) => {
        this.categories.set(categories);
        this.locations.set(locations);
      });
  }

  /* ==================================================================
   * Form reading and writing
   * ================================================================== */

  /**
   * Merge one or more changed fields into the form.
   *
   * Merge rather than replace, so a control only has to name the field it owns.
   * That is what makes a chip's `clear()` a one-liner.
   */
  private update(changes: Partial<FilterForm>): void {
    this.form.update((current) => ({ ...current, ...changes }));
  }

  /** Text inputs: keyword, from, to. Bound with (input). */
  protected setTextField(field: 'keyword' | 'from' | 'to', value: string): void {
    this.update({ [field]: value } as Partial<FilterForm>);
  }

  /** The "where" dropdown. */
  protected setLocation(value: string): void {
    this.update({ location: value });
  }

  /**
   * A category checkbox.
   *
   * `checked` is passed explicitly rather than toggled, because a chip's clear()
   * and the checkbox both change the same list and a toggle would flip the wrong
   * way if they ever disagreed with the DOM.
   */
  protected toggleCategory(categoryId: number, checked: boolean): void {
    this.form.update((current) => {
      const without = current.categories.filter((id) => id !== categoryId);
      return {
        ...current,
        categories: checked ? [...without, categoryId] : without,
      };
    });
  }

  /** True when the given category's checkbox should be ticked. */
  protected isCategoryChecked(categoryId: number): boolean {
    return this.form().categories.includes(categoryId);
  }

  protected setFreeOnly(checked: boolean): void {
    this.update({ isFree: checked });
  }

  /** The event-state radio group. */
  protected setState(state: StateChoice): void {
    this.update({ state });
  }

  protected setSort(value: string): void {
    const allowed: readonly SortChoice[] = [
      'date-asc',
      'date-desc',
      'name-asc',
      'name-desc',
      'goal-desc',
      'progress-desc',
    ];
    this.sort.set(allowed.find((choice) => choice === value) ?? 'date-asc');
  }

  /* ==================================================================
   * Searching
   * ================================================================== */

  /**
   * Validate, then search.
   *
   * Called from the form's submit handler, from a chip being removed, and from a
   * category being ticked - a category toggle re-runs the search because the
   * visitor has narrowed the result set, and leaving the previous list on screen
   * would make the checkbox look broken.
   */
  protected runSearch(): void {
    const problem = this.validate();
    if (problem !== null) {
      const message = this.i18n.t(problem.key);
      // The same sentence goes to two places on purpose: next to the date field it
      // belongs to (so the visitor knows WHERE the problem is) and into the results
      // panel (so the reason there are no results is visible where they were
      // looking). The legacy page did exactly this.
      this.validationMessage.set(message);
      this.results.set({ status: 'error', events: [], total: 0, message });
      return;
    }

    // A valid search clears the previous problem, so a fixed field stops showing
    // an error message.
    this.validationMessage.set(null);
    this.invalidField.set(null);

    const query = this.buildQuery();
    this.syncUrl(query);

    this.results.set({ status: 'loading', events: [], total: 0, message: null });

    this.api
      .getEvents(query)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (page) => {
          this.results.set({
            status: 'done',
            events: page.items,
            total: page.meta.total,
            // A completed search with no rows is not an error: the message below
            // the form explains it in the same tone as a successful search.
            message: this.i18n.t(
              page.items.length === 1 ? 'search.eventCountOne' : 'search.eventCountMany',
              { count: page.meta.total }
            ),
          });
        },
        error: (error: unknown) => {
          const message =
            error instanceof ApiError
              ? error.friendlyMessage((key) => this.i18n.t(key))
              : this.i18n.t('error.searchFailed');
          this.results.set({ status: 'error', events: [], total: 0, message });
        },
      });
  }

  /**
   * The one client-side rule, plus the date-format guard.
   *
   * Returns the dictionary key of the problem, or null. The format check matters
   * because a `type="date"` field can be typed into: a half-entered date leaves
   * `value` empty in most browsers, but "2026-13-45" style values can survive in
   * some, and the API would reject them with a less helpful message.
   */
  private validate(): { key: string } | null {
    const current = this.form();
    this.invalidField.set(null);

    const isIsoDate = (value: string) => value === '' || /^\d{4}-\d{2}-\d{2}$/.test(value);

    if (!isIsoDate(current.from)) {
      this.invalidField.set('from');
      return { key: 'search.invalidFrom' };
    }
    if (!isIsoDate(current.to)) {
      this.invalidField.set('to');
      return { key: 'search.invalidTo' };
    }

    // A plain string comparison is correct for ISO dates, and it is deliberately
    // NOT a Date subtraction: parsing "2026-10-01" as a Date goes through UTC
    // midnight, so a visitor in a negative-offset timezone would compare the
    // previous day and get a different answer from the API.
    if (current.from && current.to && current.to < current.from) {
      this.invalidField.set('to');
      return { key: 'search.reversedRange' };
    }

    return null;
  }

  /**
   * Turn the form into the API's query parameters.
   *
   * Every empty value is left out rather than sent as an empty string, so the API
   * applies its own default for an unset filter. `limit: 60` as explained in the
   * class comment.
   */
  private buildQuery(): EventQuery {
    const current = this.form();
    const { sort, direction } = this.sortParams();
    const { location, city } = this.locationParams(current.location);

    return {
      category: current.categories.length > 0 ? current.categories : undefined,
      city,
      location,
      from: current.from || undefined,
      to: current.to || undefined,
      keyword: current.keyword || undefined,
      isFree: current.isFree ? true : undefined,
      state: current.state,
      sort,
      direction,
      limit: 60,
    };
  }

  /**
   * Split the "where" dropdown's value into the API parameters it means.
   *
   * `'city:Lismore'` becomes `{ city: 'Lismore' }` - which matches every venue in
   * that town - while `'12'` becomes `{ location: [12] }`, the venue id. An empty
   * selection becomes neither, and the API then applies no location filter.
   */
  private locationParams(value: string): { location?: number[]; city?: string } {
    if (value === '') return {};
    if (value.startsWith('city:')) return { city: value.slice('city:'.length) };

    const locationId = Number(value);
    return Number.isInteger(locationId) ? { location: [locationId] } : {};
  }

  /** "progress-desc" -> { sort: 'progress', direction: 'desc' }. */
  private sortParams(): { sort: string; direction: 'asc' | 'desc' } {
    const [sort, direction] = this.sort().split('-');
    return { sort, direction: direction === 'desc' ? 'desc' : 'asc' };
  }

  /* ==================================================================
   * URL synchronisation
   * ================================================================== */

  /**
   * Write the current filters into the address bar.
   *
   * `replaceState` through the Router rather than `pushState`: a search is a
   * refinement of the same page, and pushing an entry would fill the back button
   * with one step per checkbox click. The route's query params are replaced, so
   * the history entry for /search is updated rather than a new one added.
   */
  private syncUrl(query: EventQuery): void {
    const params: Record<string, string | string[]> = {};
    if (query.keyword) params['keyword'] = query.keyword;
    if (query.city) params['city'] = query.city;
    if (query.location && query.location.length > 0) {
      params['location'] = query.location.map((id) => String(id));
    }
    if (query.from) params['from'] = query.from;
    if (query.to) params['to'] = query.to;
    if (query.isFree) params['isFree'] = 'true';
    if (query.state) params['state'] = query.state;
    if (query.category && query.category.length > 0) {
      params['category'] = query.category.map((id) => String(id));
    }
    const { sort, direction } = this.sortParams();
    params['sort'] = sort;
    params['direction'] = direction;

    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: params,
      replaceUrl: true,
    });
  }

  /**
   * Restore the form from the query string, then search if anything was set.
   *
   * Arriving at /search with no query string leaves the form empty and the
   * results panel in its "nothing searched yet" state, which is what the legacy
   * page did - pressing Search with no filters is what lists everything.
   */
  private applyFiltersFromUrl(): void {
    const params = this.route.snapshot.queryParamMap;
    let hasFilter = false;

    const restored: Partial<FilterForm> = {};

    const from = params.get('from');
    if (from) {
      restored.from = from;
      hasFilter = true;
    }
    const to = params.get('to');
    if (to) {
      restored.to = to;
      hasFilter = true;
    }
    // `location` (a venue id) wins over `city`, because that is the more specific
    // instruction and it is the one the dropdown writes for a single venue.
    const locationIds = params.getAll('location').map((value) => Number(value));
    const locationId = locationIds.find((value) => Number.isInteger(value));
    if (locationId !== undefined) {
      restored.location = String(locationId);
      hasFilter = true;
    } else {
      const city = params.get('city');
      if (city) {
        restored.location = `city:${city}`;
        hasFilter = true;
      }
    }

    const keyword = params.get('keyword');
    if (keyword) {
      restored.keyword = keyword;
      hasFilter = true;
    }
    if (params.get('isFree') === 'true') {
      restored.isFree = true;
      hasFilter = true;
    }

    const state = params.get('state');
    if (state === 'all' || state === 'past') {
      restored.state = state;
      hasFilter = true;
    } else if (state === 'upcoming') {
      // Explicitly upcoming is the default, so it is not itself "a filter".
      restored.state = 'upcoming';
    } else if (params.get('includePast') === 'true') {
      // Backwards compatibility with the legacy query string, which used
      // includePast=true for the same thing the state selector now expresses.
      restored.state = 'all';
      hasFilter = true;
    }

    // A repeated parameter arrives as several values; Number() drops anything
    // that is not a number, and NaN ids are filtered out below.
    const categoryValues = params.getAll('category').map((value) => Number(value));
    const categoryIds = categoryValues.filter((value) => Number.isInteger(value));
    if (categoryIds.length > 0) {
      restored.categories = categoryIds;
      hasFilter = true;
    }

    const sort = params.get('sort');
    const direction = params.get('direction');
    if (sort && direction) {
      this.setSort(`${sort}-${direction}`);
    }

    this.update(restored);

    if (hasFilter) this.runSearch();
  }

  /* ==================================================================
   * Clear filters
   * ================================================================== */

  /**
   * Reset the form, the chips, the URL and the results panel.
   *
   * Written as one reset of the whole form value rather than a loop over the DOM
   * (which is what the legacy version needed): with the form held in a signal,
   * clearing it is a single write, and every control follows because they all read
   * the same signal.
   */
  protected clearFilters(): void {
    this.form.set(emptyForm());
    this.sort.set('date-asc');
    this.validationMessage.set(null);
    this.invalidField.set(null);
    this.results.set({ status: 'idle', events: [], total: 0, message: null });

    // The URL is emptied too, so a reload after clearing does not resurrect the
    // filters that were just removed.
    void this.router.navigate([], { relativeTo: this.route, queryParams: {}, replaceUrl: true });
  }

  /* ==================================================================
   * Template helpers
   * ================================================================== */

  /** The validation message currently attached to a given date field, if any. */
  protected messageFor(field: 'from' | 'to'): string | null {
    return this.invalidField() === field ? this.validationMessage() : null;
  }
}
