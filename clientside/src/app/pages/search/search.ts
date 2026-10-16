import { Component, DestroyRef, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, ParamMap, Router, RouterLink } from '@angular/router';
import { Observable, Subject, catchError, forkJoin, map, of, switchMap } from 'rxjs';

import { ApiError } from '@charity/shared/api/api-error';
import { ApiService } from '@charity/shared/api/api.service';
import { TranslationService } from '@charity/shared/i18n/translation.service';
import { TranslatePipe } from '@charity/shared/i18n/translate.pipe';
import type { Event, EventQuery } from '@charity/shared/models/event.model';
import type { Paged } from '@charity/shared/models/api.model';
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
 * Which request a search is: the small one the page opens with, or a full one.
 *
 * Named so `runSearch()` reads at its call sites - `runSearch('arrival')` in the
 * constructor, the bare `runSearch()` everywhere the visitor drives the search -
 * without either of them having to know what the two row counts are.
 */
type SearchScope = 'arrival' | 'full';

/**
 * How many events the arrival request asks for.
 *
 * Nine is a ceiling rather than a target, and it is deliberately just above one
 * screenful: it fills the results grid's two columns several rows deep without
 * turning the first paint into a long download, and it leaves room for the whole
 * set to be clearly "more than one page" when a wider state is selected. In the
 * development data there are six upcoming events, so the arrival request returns
 * six rows - measured `app-event-card` count 6, reported total 6 - which fills
 * the column on arrival, and that is the outcome this constant exists for. See
 * decision 4 in the class comment.
 */
const ARRIVAL_LIMIT = 9;

/** How many events a visitor-driven search asks for. See decision 3. */
const FULL_LIMIT = 60;

/**
 * How long a typed control waits before its search runs. See `runSearchSoon`.
 *
 * Long enough to include a whole word rather than a keystroke, short enough that
 * the results feel like they follow the typing: the loading state is shown at once,
 * so this is the only delay a visitor sees.
 */
const TYPING_DEBOUNCE_MS = 350;

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
   * The chosen venue or town, as the combobox's committed value: '' means "any
   * venue", 'city:<name>' means every venue in that city.
   *
   * A single control answers two different questions ("which venue" and "which
   * town") because the visitor is really asking one: where. Keeping it as one
   * string means the two halves cannot both be set, which would produce an
   * impossible filter ("Lismore City Hall" AND "Sydney").
   *
   * The VALUE did not change when the control stopped being a `<select>`: the
   * combobox's input shows a label for this string, but the string itself is still
   * what the query, the URL and the chips are built from.
   */
  location: string;
  from: string;
  to: string;
  isFree: boolean;
  state: StateChoice;
}

/** What the results panel is currently doing. */
interface ResultsState {
  /**
   * 'loading' while a request is in flight, then one of the two outcomes.
   *
   * There is no 'idle': the page searches as soon as it opens, so the results
   * panel is never in a "nothing asked for yet" state that would leave the right
   * column empty.
   */
  status: 'loading' | 'done' | 'error';
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

/**
 * What one search settled as, seen by the search pipeline's single subscription.
 *
 * A tagged value rather than a raw success or a raw error, because a failed
 * request has to arrive as a VALUE: an error on the stream is terminal, and the
 * pipeline that writes `results` has to survive it (see the comment on the
 * subscription in the constructor). `Paged<Event>` carries `meta`, the error arm
 * carries a `message`, and the `status` tag is what tells them apart.
 */
type SearchOutcome =
  | { status: 'done'; page: Paged<Event> }
  | { status: 'error'; message: string };

/**
 * The six sort orders the results dropdown offers, in the order it offers them.
 *
 * One list rather than one per reader: `setSort()` narrows a `<select>`'s value
 * against it and `formFromUrl()` narrows a URL's `sort`/`direction` pair against it,
 * and two copies of the same six literals is how a URL restores a sort order the
 * dropdown cannot show.
 */
const SORT_CHOICES: readonly SortChoice[] = [
  'date-asc',
  'date-desc',
  'name-asc',
  'name-desc',
  'goal-desc',
  'progress-desc',
];

/**
 * Whether two filter forms hold the same filter.
 *
 * Used to tell "the URL now describes something else" from "this page has just
 * written the URL its form already describes" - see watchUrl(). The category list is
 * compared element by element, because it is an array: without that, every URL would
 * look different from the form and every search would run twice.
 *
 * @param a - The form currently in the panel.
 * @param b - The form the URL describes.
 * @returns True when every filter is the same value.
 */
function sameForm(a: FilterForm, b: FilterForm): boolean {
  return (
    a.keyword === b.keyword &&
    a.location === b.location &&
    a.from === b.from &&
    a.to === b.to &&
    a.isFree === b.isFree &&
    a.state === b.state &&
    a.categories.length === b.categories.length &&
    a.categories.every((id, index) => id === b.categories[index])
  );
}

/**
 * An empty form, used both as the initial value and by "Clear filters".
 *
 * @returns A fresh form with only the default event state set.
 */
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
 * One entry of the "where" combobox.
 *
 * The list holds two kinds of entry and the value string says which it is:
 * `city:Lismore` filters by town, `12` filters by venue id. The API accepts both
 * (`city` and `location`), and a single control avoids the impossible
 * combination of a chosen venue plus a different town.
 *
 * `kind` exists because the list is GROUPED (review item: whole cities and
 * individual venues sat in one flat run). It is derived, not fetched: see
 * `locationOptions`.
 */
interface LocationOption {
  /** The committed value: 'city:<name>' | '<locationId>'. Never ''. */
  value: string;
  /** The already-translated label. */
  label: string;
  /** Which heading the entry belongs under. */
  kind: 'city' | 'venue';
}

/**
 * One heading of the combobox's listbox, with the options under it.
 *
 * A group with no options is never produced, so a search that matches only venues
 * does not leave an empty "Cities" heading behind.
 */
interface LocationGroup {
  kind: 'city' | 'venue';
  /** The translated heading, which is also the group's accessible name. */
  label: string;
  options: LocationOption[];
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
 * 4. The page searches on arrival, with a deliberately small first request.
 *    Opening /search issues a real GET /api/events for the default "upcoming"
 *    state with `limit: 9`, so the results column is full the moment the page
 *    renders instead of showing a dashed box that asks the visitor to press a
 *    button before anything appears. Nine rows fill two grid columns without
 *    turning the first paint into a long download; pressing Search events then
 *    runs the same query with the full `limit: 60` documented above. The API's
 *    reported total drives the count either way, so the number shown is the
 *    number that matched and not the number of rows requested - and when the
 *    arrival request came back with fewer rows than matched, the heading drops the
 *    number rather than name a total the grid contradicts. See `resultsHeading`.
 *
 * 5. A native date input paints its own placeholder, and no attribute can change
 *    it.
 *    The two date fields are `<input type="date">`, whose internal
 *    `yyyy/mm/日`-style placeholder is drawn by the browser in the BROWSER's own
 *    locale and not the document's. Measured with puppeteer against the running
 *    build in the Edge used for testing: launched with `--lang=zh-CN` the empty
 *    field paints `yyyy/mm/日` even when the input carries `lang="en-AU"` and
 *    `<html lang="en-AU">`; launched with `--lang=en-US` the very same markup
 *    paints `mm/dd/yyyy`. Removing the `lang` attribute, or moving it to the
 *    fieldset or to `<html>`, changed nothing. So the page cannot make the
 *    control display `yyyy-mm-dd`, and the hard-coded "Format: yyyy-mm-dd" line
 *    that used to sit above each field was removed rather than left to contradict
 *    the control - the `search.dateHint` line beneath still shows a valid
 *    example, which is true in every locale. The submitted value format IS
 *    guaranteed by the spec (`yyyy-mm-dd`, checked by `validate()` below), and
 *    that is the part the page is responsible for.
 *
 *    THAT REMOVAL WAS COMPLETE, which a later review of the gap between the two
 *    date fields required proving rather than assuming: the rendered page holds
 *    zero `.field__format` elements and no stylesheet matches the class, so no
 *    wrapper, margin or reserved height survived it. The 69.59px the review
 *    measured between "From date" and "To date" was the empty `.field-message`
 *    slot under the first field (41.6px of it) plus that field's own bottom
 *    margin and the row's gap. Both are fixed in styles.css - see THE FORM RHYTHM
 *    there - and the message slots now bind their text with `[textContent]` so
 *    `.field-message:empty` can collapse them.
 *
 * 6. The filter panel filters as the visitor changes it, and it says so.
 *    Every control in the panel applies itself: a tick, a radio, a picked
 *    suggestion in the venue combobox or the sort order runs the search at once, and
 *    the two date fields and the keyword box run it 350ms after the last keystroke
 *    (`runSearchSoon`) so a word is searched once rather than once per letter. The
 *    rule is stated in the panel's action row through `search.resultsHint`, in all
 *    four languages.
 *
 *    THE VENUE COMBOBOX IS THE ONE CONTROL WITH TWO GESTURES, and it treats them
 *    differently on purpose: TYPING filters its own suggestion list and asks the API
 *    for nothing, because the value this field sends is a chosen town or venue and a
 *    half-typed word is not a filter the visitor has chosen; PICKING a suggestion is
 *    the commit and applies at once, exactly as the `<select>`'s `change` did. So the
 *    "filters as you change it" rule still holds for every change of the FILTER, and
 *    no other control on the page changed its timing.
 *
 *    WHY THIS RATHER THAN AN EXPLICIT SUBMIT WITH A PINNED ACTION ROW - which is
 *    the other model the review offered - is a measured decision, not a preference.
 *    The pinned row was built first: `position: sticky; bottom: 0` on the action
 *    row, with the model sentence inside it. Sweeping every scroll position at 60px
 *    steps and measuring the overlap between the pinned row's box and every control
 *    in the panel, the worst case was 100% - the bar FULLY covered `category-7` at
 *    1440x900 and the venue field at 390x844, on first paint, which is exactly the
 *    "it floated over the form it belongs to and covered the City field on first
 *    paint" the previous round recorded against pinning this row. A row pinned to
 *    the viewport bottom overlays whatever the panel has at that height, at every
 *    scroll offset, and no amount of trimming its height fixes that. So the panel
 *    applies itself instead, nothing floats, and the page still scrolls once.
 *
 *    THE SUBMIT BUTTON STAYS, as the explicit "search now" control at the end of the
 *    panel: pressing it re-runs the query the live model has already applied, which
 *    is idempotent for a GET, and the end-to-end suite finds it by its text
 *    (tests/angular-e2e.mjs, read-only). Before this round the panel was a mixture -
 *    the category boxes, the chips and the sort dropdown re-ran the search as they
 *    changed while the dates, the venue, the keyword, the free-events box and the
 *    event-state radios waited for the button - which is what made the model
 *    unanswerable from the outside. The sort dropdown and a chip's remove button act
 *    on the result set already on screen and behave exactly as they did; the chips
 *    describe the applied set rather than the form (see `applied`), so a search still
 *    in its debounce window cannot leave the chips describing results they did not
 *    produce.
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

  /**
   * One entry per search the visitor asks for, carrying that search's query.
   *
   * This exists so two searches can never arrive out of order. Every trigger of
   * `runSearch()` used to subscribe to its own `getEvents()` call, and nothing
   * cancelled the previous one: ticking two category checkboxes in quick
   * succession left two requests in flight, and if the FIRST one happened to
   * answer last its rows replaced the newer search's rows - the grid then showed
   * events that did not match the ticked boxes while the chips above it named
   * them. Measured against this build with the first request delayed by 2.5s:
   * chips read "Category: Fun Run, Category: Gala Dinner" while the single card
   * on screen was the Fun Run response. The subscription set up in the
   * constructor pipes this through `switchMap`, which unsubscribes the in-flight
   * request the moment a newer one is emitted - so the LAST search is the one
   * that fills the grid, whatever order the answers come back in.
   */
  private readonly searchTrigger = new Subject<EventQuery>();

  /** Tab title, from the route's `data.titleKey` ('search.title'). */
  private readonly title = useDocumentTitle();

  /** The live form contents. */
  protected readonly form = signal<FilterForm>(emptyForm());

  /**
   * Queue the search a TYPED control asks for, 350ms after the last keystroke.
   *
   * WHY TYPED CONTROLS ARE DEBOUNCED AND TICKS ARE NOT. The panel filters as the
   * visitor changes it (see decision 6 in the class comment), and a date field or
   * the keyword box fires `input` once per keystroke: without this, typing "Lismore"
   * would issue eight searches, each one cancelled by the next through the
   * pipeline's `switchMap` - correct, but eight round trips to answer a question
   * the visitor has not finished asking. A checkbox, a radio, a picked suggestion in
   * the venue combobox and the sort dropdown commit their answer in one event, so
   * they call `runSearch()` and apply at once - and the combobox's own TYPING path
   * calls neither, because it searches nothing: it narrows the suggestion list and
   * the request waits for a pick (see `onLocationInput`).
   *
   * 350ms is the usual "pause in typing" figure and is deliberately longer than the
   * pipeline's own latency: the `results` panel goes to its loading state
   * immediately, so the visitor always has feedback that a search is coming, and
   * the request itself is held back just long enough to include the whole word.
   *
   * The timer is cleared on destroy, so a search cannot run after the page has
   * gone; it is a plain `setTimeout` rather than an rxjs `debounceTime` because it
   * belongs to the TEMPLATE's event handling (which control was touched), not to the
   * query stream, and the stream's own `switchMap` already guarantees that only the
   * newest search can paint.
   */
  protected runSearchSoon(): void {
    if (this.typingTimer !== null) clearTimeout(this.typingTimer);
    this.typingTimer = setTimeout(() => {
      this.typingTimer = null;
      this.runSearch();
    }, TYPING_DEBOUNCE_MS);
  }

  /** The pending debounced search from a typed control, or null. */
  private typingTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * The filters the results on screen were actually produced by.
   *
   * WHY THERE ARE TWO, WITH A LIVE PANEL. Every control applies itself, so the form
   * and the applied set differ for only two windows: the 350ms a typed control waits
   * before its search runs (`runSearchSoon`), and the time a request is in flight. In
   * both of those windows the results below are still the PREVIOUS search's, and
   * anything that DESCRIBES those results must not read the half-typed form. The
   * "active filters" chips are exactly that description ("these are the filters the
   * results below use"), so they read `applied`, which is written in `runSearch()` at
   * the moment the query is sent.
   *
   * It is written for every search, including the arrival one and a restored deep
   * link, because every one of those paths goes through `runSearch()`. A failed
   * search still writes it: the visitor did ask for those filters, and the panel
   * says so while the error is displayed.
   */
  private readonly applied = signal<FilterForm>(emptyForm());

  /** The category checkboxes, each with its active event count. */
  protected readonly categories = signal<Category[]>([]);

  /** Every venue that currently hosts an active event. */
  protected readonly locations = signal<Venue[]>([]);

  /** True when the category list itself could not be loaded. */
  protected readonly categoriesFailed = signal(false);

  /**
   * The results panel's state.
   *
   * Starts as 'loading' because the constructor immediately runs a search: the
   * first thing the visitor sees is the spinner and then real events, never an
   * empty panel.
   */
  protected readonly results = signal<ResultsState>({
    status: 'loading',
    events: [],
    total: 0,
    message: null,
  });

  /** The selected sort order. */
  protected readonly sort = signal<SortChoice>('date-asc');

  /**
   * The results heading, with the number of matching events folded in.
   *
   * The count used to be a `<p>` of its own beside the heading, rendering
   * `{{ results().total }}` with no label and no unit - a bare "6" pushed to the
   * far right of the header, which reads as a template variable that escaped its
   * wrapper. The heading now carries it as a labelled quantity, "Matching events
   * (6)", so the number has a subject and a unit without the dictionary needing
   * plural forms (it has none, and a rule invented for it would be wrong in three
   * of the four languages).
   *
   * Two things this buys beyond the wording: the heading is a real `<h2>`, and the
   * results region is `aria-labelledby="results-heading"`, so the count is part of
   * the accessible name of the region instead of a floating element beside it.
   *
   * While a request is in flight, or after one has failed, the plain heading is
   * used: the page never states a count it does not have. Reading `results()` and
   * calling `i18n.t` (which reads the language signal) makes this recompute on
   * both a new result set and a language switch.
   *
   * THE COUNT IS ONLY FOLDED IN WHEN THE WHOLE RESULT SET IS ON SCREEN
   *   `state.total` is the API's count of everything that matched, while
   *   `state.events` is what the search asked for - and a search can legitimately
   *   be cut short by its own row limit. The page opens with the deliberately small
   *   arrival search (ARRIVAL_LIMIT), so any event list longer than nine rows used
   *   to produce a heading that contradicted the grid underneath it: measured
   *   against this build with a mocked response reporting 30 matches and returning
   *   nine rows, the heading read "Matching events (30)" above exactly nine cards,
   *   and nothing on the page said why. A visitor reading "30" and counting nine
   *   cards has been told that seven tenths of their results are missing without
   *   being told how to reach them, which is worse than no number at all. So the
   *   total is stated only when every matching event was received and rendered;
   *   when the list was truncated, the plain heading is shown instead, because
   *   "Matching events" is true either way and a number that disagrees with the
   *   cards is not. Pressing "Search events" asks for FULL_LIMIT rows, which is
   *   where the number comes back for every result set the seeded data can produce.
   *
   * @returns The translated heading, with the API's reported total in parentheses
   *   once the search has finished and every matching event is on screen.
   */
  protected readonly resultsHeading = computed(() => {
    const state = this.results();
    const complete = state.events.length >= state.total;
    return state.status === 'done' && complete
      ? this.i18n.t('search.resultsHeadingCount', { count: state.total })
      : this.i18n.t('search.resultsHeading');
  });

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
   * The "where" combobox's options, towns first.
   *
   * Towns come first (alphabetically) and then the individual venues, because a
   * visitor who is willing to travel usually picks the town, and one who is not
   * picks the venue - and since this round the two runs are also LABELLED as
   * "Cities" and "Venues" instead of being one flat list. The order and the
   * membership are unchanged from the select this replaced: the same seven towns
   * and the same eight venues.
   *
   * Both are derived from GET /api/locations, WHICH DOES NOT DISTINGUISH THE TWO:
   * the endpoint returns flat venue rows (`locationId`, `venueName`, `city`,
   * `state`, `latitude`, `longitude`, `eventCount` - see shared/src/models/
   * reference.model.ts) with no type flag, no separate towns resource and no
   * "city" entity at all. A town exists in this project only because a venue is in
   * it, so a Set over the venues' `city` column is the authoritative list and no
   * extra endpoint is needed. `kind` below is therefore derived from the row's
   * SHAPE - a town is a distinct `city` value, a venue is the row itself - and any
   * entry that is one must never also be listed as the other.
   */
  protected readonly locationOptions = computed<LocationOption[]>(() => {
    const venues = this.locations();
    const towns = [...new Set(venues.map((venue) => venue.city ?? '').filter(Boolean))].sort();

    return [
      ...towns.map((town) => ({ value: `city:${town}`, label: town, kind: 'city' as const })),
      ...venues
        .slice()
        .sort((a, b) => a.venueName.localeCompare(b.venueName))
        .map((venue) => ({
          value: String(venue.locationId),
          label: venue.venueName,
          kind: 'venue' as const,
        })),
    ];
  });

  /**
   * What the visitor has typed into the combobox's box.
   *
   * SEPARATE FROM `form().location` ON PURPOSE. The form holds the committed
   * filter - the value the API, the URL and the chips are built from - while this
   * holds the free text that narrows the suggestion list. Typing writes only this,
   * so an unfinished word can never become a filter (see the field's comment in
   * search.html for why the API's substring matching is not an invitation to send
   * one), and the two are reconciled only when a suggestion is picked, when the
   * panel closes, or when the filter changes from outside the box (a deep link, a
   * chip, "Clear filters").
   */
  protected readonly locationQuery = signal('');

  /** Whether the suggestion panel is open. */
  protected readonly locationOpen = signal(false);

  /** Which entry of `filteredLocations()` the keyboard is on, or -1 for none. */
  protected readonly locationActive = signal(-1);

  /** The combobox's input, so its text can be written without fighting the caret. */
  private readonly locationInput = viewChild<ElementRef<HTMLInputElement>>('locationInput');

  /**
   * The last text written into the box, so the sync effect below can tell "the
   * filter changed" from "the visitor is typing".
   */
  private lastLocationText = '';

  /**
   * The label for the committed filter, i.e. what the box shows when it is not
   * being typed into.
   *
   * THIS IS THE REPLACEMENT FOR THE `[selected]` FIX the old `<select>` needed. A
   * select's value had to be re-asserted on every option because a value written
   * before the options existed was discarded and the browser showed the first
   * option - so a deep link looked unfiltered. A computed label has nothing to
   * discard: `form().location` is the truth, the label is derived from it on every
   * read, and the box is written from this value.
   *
   * A `city:` value can be named before the venues arrive (the town name is in the
   * value itself); a bare venue id cannot be named without the list, and is
   * deliberately shown as an empty box rather than as "7" - the chip above the
   * results names the filter in the meantime, which is what it did before this
   * round too.
   */
  protected readonly committedLocationLabel = computed(() => {
    const value = this.form().location;
    if (!value) return '';

    const known = this.locationOptions().find((option) => option.value === value)?.label;
    if (known) return known;

    return value.startsWith('city:') ? value.slice('city:'.length) : '';
  });

  /**
   * The options the box's text leaves, in list order.
   *
   * A plain case-insensitive substring test against the LABEL, which is the same
   * test the placeholder has always advertised: typing "Lis" leaves Lismore and
   * the two Lismore venues, typing "syd" leaves Sydney. An empty box leaves
   * everything, so clicking the field offers the full list the select used to open.
   */
  protected readonly filteredLocations = computed<LocationOption[]>(() => {
    const needle = this.locationQuery().trim().toLocaleLowerCase();
    const all = this.locationOptions();
    if (needle === '') return all;
    return all.filter((option) => option.label.toLocaleLowerCase().includes(needle));
  });

  /**
   * The listbox's contents: the filtered options, split into the two headings.
   *
   * Empty groups are dropped, so typing "brisbane" shows one "Cities" heading (for
   * Brisbane) and one "Venues" heading (for Brisbane Botanic Gardens) rather than
   * two headings with a gap between them.
   */
  protected readonly locationGroups = computed<LocationGroup[]>(() => {
    const options = this.filteredLocations();
    const groups: LocationGroup[] = [];

    const cities = options.filter((option) => option.kind === 'city');
    if (cities.length > 0) {
      groups.push({ kind: 'city', label: this.i18n.t('search.cityGroupCities'), options: cities });
    }

    const venues = options.filter((option) => option.kind === 'venue');
    if (venues.length > 0) {
      groups.push({ kind: 'venue', label: this.i18n.t('search.cityGroupVenues'), options: venues });
    }

    return groups;
  });

  /**
   * The DOM id of one option.
   *
   * The id carries the option's position in the FLAT filtered list, because that
   * is the index `locationActive` holds; the render walks the grouped view, so
   * both have to agree on one numbering. `aria-activedescendant` points at these
   * ids, which is what lets a screen reader announce the highlighted suggestion
   * while the caret stays in the box.
   */
  protected locationOptionId(option: LocationOption): string {
    return `location-option-${this.filteredLocations().indexOf(option)}`;
  }

  /** The id of the highlighted option, or null when the list is closed or idle. */
  protected readonly activeLocationId = computed(() => {
    const index = this.locationActive();
    if (index < 0 || index >= this.filteredLocations().length) return null;
    return `location-option-${index}`;
  });

  /** True when at least one filter is set, which drives the chip list. */
  protected readonly hasActiveFilters = computed(() => this.activeFilters().length > 0);

  /**
   * The active filters as removable chips.
   *
   * The dates are read from the APPLIED filters rather than straight from the live
   * form, because the chips describe the results underneath them: with a live panel
   * the two can differ for the 350ms a typed control waits (and while a request is
   * in flight), and a chip list built from the form announced "Category: Fun Run"
   * the moment the box was ticked while the grid beside it still held the previous
   * search's events. See `applied` above.
   *
   * The URL is written as a side effect of searching, so reading the applied set
   * keeps the chips, the address bar and the results in step with one another.
   */
  protected readonly activeFilters = computed<FilterChip[]>(() => {
    const current = this.applied();
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

    /*
     * THE COMBOBOX'S BOX FOLLOWS THE FILTER, NOT THE OTHER WAY ROUND.
     *
     * The input is deliberately uncontrolled - the visitor types into it, and a
     * `[value]` binding would rewrite the field on every keystroke and move the
     * caret - so this effect is the ONE place the page writes it. It writes the
     * label of the committed filter, which means it fires exactly when the filter
     * changes from OUTSIDE the box: a deep link restored from the query string, a
     * chip being removed, "Clear filters", or the venue list arriving and making a
     * venue id nameable. That is also the replacement for the `[selected]` repair
     * the old `<select>` needed - see `committedLocationLabel`.
     *
     * IT DOES NOT WRITE WHILE THE PANEL IS OPEN, and that guard is the whole reason
     * this is an effect with a condition rather than a binding: the venue list can
     * answer 200ms after the visitor starts typing, and a late answer must not
     * erase the word they are in the middle of.
     */
    effect(() => {
      const label = this.committedLocationLabel();
      if (this.locationOpen()) return;
      if (label === this.lastLocationText) return;
      this.writeLocationText(label);
    });

    /*
     * The single search pipeline: every query `runSearch()` accepts is pushed
     * through the trigger below, and `switchMap` cancels whatever request is still
     * in flight, so only the newest search can write to `results`. Subscribing once
     * here rather than once per search is also what makes the cancellation
     * possible - see `searchTrigger`.
     *
     * A FAILED SEARCH MUST NOT KILL THE PIPELINE, so `catchError` sits INSIDE the
     * `switchMap`, where it converts one failed request into one failed result:
     *
     *     switchMap((query) => getEvents(query).pipe(catchError(...)))
     *
     * It used to sit outside, as an `error` callback on the subscription, and that
     * ended the subscription itself: an error is terminal for the observable it
     * arrives on, so after the first failure the `Subject` had no subscriber left.
     * `runSearch()` still cleared `results` to 'loading' and pushed the new query,
     * but nothing was listening - so pressing "Search events", ticking a category
     * or clearing the filters did nothing at all and left the results panel empty
     * until the visitor reloaded the page. Measured against this build with the
     * first search answered by a 500: the panel reported the failure, the second
     * search (a category checkbox) issued NO request at all, and the grid held no
     * cards, no spinner and no message afterwards. Caught inside the `switchMap`,
     * the outer subscription survives every failure, so the next search runs
     * normally.
     */
    this.searchTrigger
      .pipe(
        switchMap(
          (query): Observable<SearchOutcome> =>
            this.api.getEvents(query).pipe(
              map((page): SearchOutcome => ({ status: 'done', page })),
              catchError((error: unknown): Observable<SearchOutcome> =>
                of<SearchOutcome>({ status: 'error', message: this.describeFailure(error) })
              )
            )
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        // Exactly one callback: `catchError` guarantees that every search settles
        // here, whether it answered with rows or with a message, so there is no
        // second error path that could end the subscription.
        next: (outcome) => {
          if (outcome.status === 'error') {
            this.results.set({
              status: 'error',
              events: [],
              total: 0,
              message: outcome.message,
            });
            return;
          }

          this.results.set({
            status: 'done',
            events: outcome.page.items,
            total: outcome.page.meta.total,
            // A completed search with no rows is not an error: the message below
            // the form explains it in the same tone as a successful search. The
            // count is the number of rows that arrived, not `meta.total`, so this
            // sentence agrees with the cards on screen when a search was cut short
            // by its own row limit - which the results heading also reports.
            message: this.i18n.t(
              outcome.page.items.length === 1 ? 'search.eventCountOne' : 'search.eventCountMany',
              { count: outcome.page.items.length }
            ),
          });
        },
      });

    /*
     * THE QUERY STRING IS FOLLOWED FOR AS LONG AS THE PAGE IS OPEN, NOT READ ONCE.
     *
     * Decision 2 above is that the filters live in the URL, which makes the URL the
     * description of the result set on screen. That description was only read in this
     * constructor, and the router REUSES this component when only the query string
     * changes - so a later navigation to /search left the page describing a URL that no
     * longer existed. Measured against this build: opening
     * /search?city=Lismore&keyword=gala shows the two chips and "Matching events (0)",
     * and clicking the header menu's own "Search events" link then puts /search in the
     * address bar while the page still shows Location: Lismore, Keyword: gala and the
     * same empty result set. A reload showed something else entirely, which is the
     * defect stated plainly: the page and its own URL disagreed, and the visitor had no
     * way to tell which one the events belonged to. The same link is also the ordinary
     * way out of a search that found nothing.
     *
     * `watchUrl()` re-applies the URL whenever it differs from the form, and does
     * nothing when it does not - the second half is what stops this page's OWN writes
     * from starting a second search: `syncUrl()` runs after the form has been set, so
     * the echo of our own navigation matches the form and stops there.
     */
    this.watchUrl();

    // A pending debounced search must not outlive the page that queued it.
    this.destroyRef.onDestroy(() => {
      if (this.typingTimer !== null) clearTimeout(this.typingTimer);
    });
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
      // A city or venue search does not need the venue list, so a failure here is
      // silent: the suggestion list is simply empty, and the visitor can still
      // search by date, category, keyword and event state. The box stays usable -
      // it is a normal text input - but nothing can be PICKED, so no location
      // filter can be applied; a word typed into it stays a word until the list
      // arrives, which is why the panel says "no matching city or venue" rather
      // than pretending the search is filtered.
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

  /**
   * Write one value into the "where" filter and apply it - the ONE write path for
   * this control.
   *
   * Called when a suggestion is picked (click or Enter) and when the box is emptied
   * and left, which is the combobox's version of the select's "Any location"
   * option. It applies AT ONCE rather than through `runSearchSoon`, because a pick
   * is one committed decision and not a keystroke: the select it replaced applied
   * on `change`, and the panel's own typing path never reaches this method (typing
   * filters the list and issues no request - see `onLocationInput`).
   *
   * Writing the value and applying the search happen in the same turn, because the
   * query, the URL and the chips are all built from `form()`.
   */
  protected setLocation(value: string): void {
    this.locationOpen.set(false);
    this.locationActive.set(-1);

    const changed = this.form().location !== value;
    if (changed) this.update({ location: value });

    // Re-read rather than reuse: the label belongs to the value that is now in the
    // form, whether or not it changed.
    this.writeLocationText(this.committedLocationLabel());

    // Picking the option that is already applied is not a new filter - a select
    // fires no `change` for it either - so nothing is re-requested.
    if (!changed) return;

    this.runSearch();
  }

  /**
   * The visitor typed in the box: narrow the list, and ask the API for nothing.
   *
   * THE WHOLE POINT OF THE CONTROL. "Start typing, e.g. Lis" used to describe a
   * `<select>` that could not be typed into; this filters the suggestions the way
   * the placeholder always promised. It deliberately does NOT search: the value the
   * API receives is a chosen town (`city:Lismore`) or a venue id, and a half-typed
   * word is neither - sending it would filter the results by something the visitor
   * has not chosen and, for an unfinished word, replace the list below with "no
   * events matched" while they are still typing.
   *
   * The first match is highlighted so Enter has something to commit and so the
   * highlighted option is announced through `aria-activedescendant` as it changes.
   */
  protected onLocationInput(text: string): void {
    this.locationQuery.set(text);
    this.locationActive.set(text.trim() === '' ? -1 : 0);
    this.locationOpen.set(true);
  }

  /**
   * A click in the box opens the list without changing the filter.
   *
   * The text is read back first: the box is uncontrolled (the visitor types in it),
   * so the signal can lag behind it if the browser itself ever writes the field.
   */
  protected openLocations(): void {
    if (this.locationOpen()) return;
    const text = this.locationInput()?.nativeElement.value ?? '';
    if (text !== this.locationQuery()) this.locationQuery.set(text);
    this.locationOpen.set(true);
    this.locationActive.set(-1);
  }

  /**
   * Close the list and put the box back in step with the applied filter.
   *
   * THREE THINGS CAN HAPPEN WHEN THE LIST CLOSES, and they are the three ways out
   * of this control:
   *   * the box was left EMPTY after one was applied - that is the visitor asking
   *     for every location, so the filter is cleared and the search re-runs (the
   *     select's empty option did exactly this);
   *   * the box holds a word that was never picked - it is restored to the label of
   *     the applied filter, so the box can never show a filter that is not applied;
   *   * the box already names the applied filter - nothing to do.
   *
   * `wasOpen` keeps a stray blur (tabbing through a field that was never opened)
   * from rewriting anything.
   */
  protected closeLocations(): void {
    const wasOpen = this.locationOpen();
    this.locationOpen.set(false);
    this.locationActive.set(-1);
    if (!wasOpen) return;

    if (this.locationQuery().trim() === '' && this.form().location !== '') {
      this.setLocation('');
      return;
    }

    const label = this.committedLocationLabel();
    if (this.locationQuery() !== label) this.writeLocationText(label);
  }

  /**
   * The combobox's keyboard path: Down/Up open and move, Enter picks, Escape puts
   * the box back, Tab leaves.
   *
   * The caret never leaves the input - the listbox is not focusable and each option
   * is pointed at by `aria-activedescendant` - so typing, arrowing and picking are
   * one continuous gesture, which is the whole difference between this and the
   * select it replaced. Home/End are included because fifteen suggestions is long
   * enough for them to be worth having.
   */
  protected onLocationKeydown(event: KeyboardEvent): void {
    const options = this.filteredLocations();

    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        // The first arrow key opens the list, which is what makes it reachable
        // without a mouse: focusing the box alone does not open it.
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        if (!this.locationOpen()) {
          this.locationOpen.set(true);
          this.locationActive.set(step === 1 ? 0 : options.length - 1);
        } else {
          const next = this.locationActive() + step;
          this.locationActive.set(Math.min(Math.max(next, 0), options.length - 1));
        }
        this.scrollActiveLocationIntoView();
        return;
      }

      case 'Home':
      case 'End': {
        if (!this.locationOpen() || options.length === 0) return;
        event.preventDefault();
        this.locationActive.set(event.key === 'Home' ? 0 : options.length - 1);
        this.scrollActiveLocationIntoView();
        return;
      }

      case 'Enter': {
        // A highlight means "pick this one". With no highlight the event is left
        // alone so the form's own submit handler runs, which is what Enter does in
        // the keyword box beside this field.
        const index = this.locationActive();
        if (!this.locationOpen() || index < 0 || index >= options.length) return;
        event.preventDefault();
        this.setLocation(options[index].value);
        return;
      }

      case 'Escape': {
        if (!this.locationOpen()) return;
        event.preventDefault();
        this.closeLocations();
        return;
      }

      case 'Tab': {
        // Focus is about to move on: close the list and reconcile the box now, so
        // an uncommitted word is not left sitting in a field that looks applied.
        this.closeLocations();
        return;
      }

      default:
        return;
    }
  }

  /** Put one option's text into the box, leaving the caret alone when it matches. */
  private writeLocationText(text: string): void {
    this.locationQuery.set(text);
    this.lastLocationText = text;

    const input = this.locationInput()?.nativeElement;
    if (input && input.value !== text) input.value = text;
  }

  /**
   * Keep the highlighted option visible while the arrows walk a scrolling list.
   *
   * `ownerDocument` rather than a global `document`: the option's id is already the
   * handle the template gave it, and it may be under either group heading.
   */
  private scrollActiveLocationIntoView(): void {
    const id = this.activeLocationId();
    if (id === null) return;
    this.locationInput()?.nativeElement.ownerDocument.getElementById(id)?.scrollIntoView({ block: 'nearest' });
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

  /** The "free events only" toggle. */
  protected setFreeOnly(checked: boolean): void {
    this.update({ isFree: checked });
  }

  /** The event-state radio group. */
  protected setState(state: StateChoice): void {
    this.update({ state });
  }

  /**
   * The sort dropdown.
   *
   * Narrowed back to the union the signal is typed with, exactly as the home page
   * does: the <select> can only carry the six literals, so anything else is a bug
   * in the template rather than user input.
   */
  protected setSort(value: string): void {
    this.sort.set(SORT_CHOICES.find((choice) => choice === value) ?? 'date-asc');
  }

  /* ==================================================================
   * Searching
   * ================================================================== */

  /**
   * Validate, then search.
   *
   * WHO CALLS IT: every control in the filter panel (the typed ones through
   * `runSearchSoon`, and the venue combobox through `setLocation` when a suggestion
   * is picked), the form's submit handler, a chip being removed, and the sort
   * dropdown. That is the point of decision 6 in the class comment: the panel has no
   * "pending" state, so a caller is never asking "should this apply now?" - it
   * applies.
   *
   * It also writes `applied`, the filter set the results belong to, which is what
   * the chips describe - see the field's own comment.
   *
   * @param scope - `'arrival'` for the first, deliberately small request that
   *   fills the page when it opens; `'full'` for every search the visitor drives,
   *   which asks for the whole result set. May be omitted, in which case the full
   *   request is made - so the existing call sites keep the behaviour they had
   *   before the arrival search existed.
   */
  protected runSearch(scope: SearchScope = 'full'): void {
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

    const current = this.form();
    const query = this.buildQuery(scope === 'arrival' ? ARRIVAL_LIMIT : FULL_LIMIT);
    this.syncUrl(query);

    // The results this search is about to produce belong to THIS filter set, so the
    // chips stop describing the form the moment the request is issued - a search
    // that then fails still leaves the panel naming the filters the visitor asked
    // for.
    this.applied.set(current);

    // Hand the query to the one search subscription set up in the constructor,
    // which cancels the request this one supersedes. The subscriber writes the
    // result, so this method issues the request and nothing else.
    this.results.set({ status: 'loading', events: [], total: 0, message: null });
    this.searchTrigger.next(query);
  }

  /**
   * The sentence a failed search shows, in the active language.
   *
   * Called from the `catchError` inside the search pipeline, which is why it is a
   * method here rather than an `error` callback on the subscription: the failure
   * has to become a value (`SearchOutcome`) so the subscription itself survives it.
   *
   * `ApiError` already carries a status-appropriate sentence (timeout, offline,
   * 5xx), so it is preferred; anything else falls back to the generic search key.
   * Reading `i18n.t` here is also what makes the message fluent in the language
   * active when the request failed.
   *
   * @param error - Whatever the request failed with.
   * @returns The translated sentence to show in the results panel.
   */
  private describeFailure(error: unknown): string {
    return error instanceof ApiError
      ? error.friendlyMessage((key) => this.i18n.t(key))
      : this.i18n.t('error.searchFailed');
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
   * applies its own default for an unset filter.
   *
   * @param limit - How many rows to ask for: `ARRIVAL_LIMIT` for the first request
   *   or `FULL_LIMIT` for a search the visitor drove, as explained in decisions 3
   *   and 4 of the class comment.
   * @returns The query `GET /api/events` receives.
   */
  private buildQuery(limit: number): EventQuery {
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
      limit,
    };
  }

  /**
   * Split the "where" combobox's committed value into the API parameters it means.
   *
   * `'city:Lismore'` becomes `{ city: 'Lismore' }` - which matches every venue in
   * that town - while `'12'` becomes `{ location: [12] }`, the venue id. An empty
   * selection becomes neither, and the API then applies no location filter. Both
   * shapes are exactly what this field sent when it was a `<select>`.
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
   * Follow the address bar for the length of the page's life.
   *
   * THE DEFECT THIS EXISTS FOR is recorded on the call site in the constructor: the
   * query string was read once, so a same-route navigation (the menu's own "Search
   * events" link, a footer link, a browser Back) changed the URL while the form, the
   * chips and the grid stayed on the previous filters. The subscription re-applies the
   * URL whenever it differs from the form and does nothing when it does not, which is
   * what keeps the page's own `syncUrl()` writes from starting a second search.
   *
   * WHICH SCOPE EACH EMISSION ASKS FOR. A deep link is the visitor stating a filter, so
   * it asks for the whole result set (`'full'`); so does any later navigation, because
   * it is a deliberate act rather than the page's own first paint. Only the opening
   * emission of an unfiltered /search takes the small arrival request
   * (`ARRIVAL_LIMIT`), which is decision 4 above and is what fills the results column
   * before the visitor touches anything.
   *
   * `route.queryParamMap` emits the CURRENT url immediately on subscribe, so this one
   * subscription replaces both the constructor's old `applyFiltersFromUrl()` call and
   * the arrival search that followed it.
   */
  private watchUrl(): void {
    let first = true;

    this.route.queryParamMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        const restored = this.formFromUrl(params);
        const opening = first;
        first = false;

        const changed =
          restored.sort !== this.sort() || !sameForm(this.form(), restored.form);
        if (!opening && !changed) return;

        if (changed) {
          this.sort.set(restored.sort);
          this.form.set(restored.form);
        }

        this.runSearch(opening && !restored.hasFilter ? 'arrival' : 'full');
      });
  }

  /**
   * Build the complete form, sort order and "was anything asked for" flag from a URL.
   *
   * The whole form comes back rather than a patch of it, because the URL is now the
   * authority on every control: a navigation that drops a parameter has to drop the
   * filter too, and merging into whatever the form happened to hold could not express
   * that.
   *
   * `location` (a venue id) wins over `city`, because that is the more specific
   * instruction and it is the one the combobox writes for a single venue. An explicit
   * `state=upcoming` is the default rather than a filter, so it does not count as one,
   * while the legacy `includePast=true` does.
   *
   * @param params - The query parameters of the URL being applied.
   * @returns The form and sort order the URL describes, and whether it asked for any filter.
   */
  private formFromUrl(params: ParamMap): {
    form: FilterForm;
    sort: SortChoice;
    hasFilter: boolean;
  } {
    const restored = emptyForm();
    let hasFilter = false;

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
    let sortChoice: SortChoice = 'date-asc';
    if (sort && direction) {
      const candidate = `${sort}-${direction}`;
      sortChoice =
        SORT_CHOICES.find((choice) => choice === candidate) ?? 'date-asc';
    }

    return { form: restored, sort: sortChoice, hasFilter };
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
   *
   * The clear does not leave the results panel empty. It re-runs the default
   * search, so "Clear filters" returns the visitor to the same upcoming-events
   * list the page opened with - an empty right-hand column would read as a
   * failure, which is the state this page no longer has.
   */
  protected clearFilters(): void {
    this.form.set(emptyForm());
    this.sort.set('date-asc');
    this.validationMessage.set(null);
    this.invalidField.set(null);

    // The URL is emptied too, so a reload after clearing does not resurrect the
    // filters that were just removed.
    void this.router.navigate([], { relativeTo: this.route, queryParams: {}, replaceUrl: true });

    this.runSearch();
  }

  /* ==================================================================
   * Template helpers
   * ================================================================== */

  /** The validation message currently attached to a given date field, if any. */
  protected messageFor(field: 'from' | 'to'): string | null {
    return this.invalidField() === field ? this.validationMessage() : null;
  }
}
