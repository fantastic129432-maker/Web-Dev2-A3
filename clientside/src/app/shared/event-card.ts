import { Component, computed, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { APP_CONFIG } from '@charity/shared/config/app-config';
import { TranslatePipe } from '@charity/shared/i18n/translate.pipe';
import type { Event } from '@charity/shared/models/event.model';
import {
  formatDateRange,
  formatPrice,
  formatTime,
  imageUrl,
  stateKey,
} from '@charity/shared/util/format';

import { ProgressBarComponent } from './progress-bar';

/**
 * One event card, shared by the home page's "upcoming events" grid and the search
 * page's results.
 *
 * This is a direct port of the legacy `eventCard()` in js/dom.js, which both pages
 * called too - the markup, the class names and therefore the styling are
 * identical to the pre-Angular site.
 *
 * WHAT THE CARD SHOWS, AND WHY
 *   * artwork, with the derived state badge ("Past event" / "On now") overlaid WHEN
 *     THE EVENT IS NOT UPCOMING, so a state that differs from the ordinary one is
 *     visible before anything is read
 *   * category chip and a price pill
 *   * title, carrying the card's ONE link to the event's own page - a link that
 *     covers the whole card, so the artwork and the empty space around the text
 *     are part of the same target (see WHY THE WHOLE CARD IS ONE LINK NOW)
 *   * short description
 *   * a three-row list of When / Where / Cause - the three questions a visitor
 *     asks before clicking
 *   * the compact fundraising bar
 *   * a "View details" affordance, drawn with the button's own appearance and read
 *     as decoration: the card is already the control it appears to be
 *
 * WHY THE STATE BADGE IS SHOWN ONLY FOR A NON-UPCOMING EVENT
 *   This card is shared, so the rule lives in the card and not behind a per-page
 *   flag: one page must never be able to disagree with the other about what the
 *   same event is. The home page lists upcoming events only, so an "Upcoming" badge
 *   there sat directly above the brown category chip and told the visitor nothing
 *   the listing had not already told them - two pills competing for the same glance.
 *   The information that actually differs is "this one has finished" or "this one is
 *   on now", and that is what the badge now marks. The search page can return past
 *   events, so the same rule keeps it honest there: past results still carry
 *   "Past event". A missing state is treated as upcoming - the same default
 *   `cardClass` uses, and the same assumption the API's own "upcoming" listing
 *   makes - so it never invents a "Past event" badge for an event that has not
 *   happened.
 *
 * WHY THE WHOLE CARD IS ONE LINK NOW
 *   This used to be the opposite decision, and the paragraph that recorded it is
 *   kept here because the trade-off it named is still real: "only the artwork and
 *   the title are links, and the button is a third. Nesting them would produce
 *   nested anchors, which is invalid HTML, and it would also stop a visitor from
 *   selecting the summary text." The review asked for the whole card to be a
 *   target, so the three anchors became ONE - the title's, stretched over the card
 *   by `.event-card__link` in styles.css - which is what removes the nesting
 *   problem the old note was about rather than working around it. The cost the
 *   note named is accepted and is now the card's documented behaviour: the overlay
 *   sits above the summary, so selecting that text by dragging takes a modifier
 *   key. Nothing else about the card changed: the artwork is still a described
 *   <img>, the button is still drawn with its visible words, and every link still
 *   carries an accessible name that names the event.
 *
 * WHY REGISTRATION IS NOT OFFERED HERE
 *   Registering is per event, so it starts from the event's own page where the
 *   event is unambiguous. A Register button on every card would also mean twelve
 *   destinations with identical accessible names in one list.
 */
@Component({
  selector: 'app-event-card',
  imports: [RouterLink, ProgressBarComponent, TranslatePipe],
  templateUrl: './event-card.html',
})
export class EventCardComponent {
  /** The event to render. Required, so a card can never appear without one. */
  readonly event = input.required<Event>();

  /**
   * Set once the artwork has failed to load.
   *
   * The component's only piece of state, and it exists because a photograph that
   * 404s is not the same thing as an event with no image at all: `imageUrl()`
   * already resolves the second case to the project's fallback artwork, while the
   * first left the browser's broken-image glyph in the media box. One-way, because
   * a dead URL stays dead for the life of the page - see `image()`.
   */
  private readonly imageFailed = signal(false);

  /** `event-card event-card--upcoming`, matching the legacy class convention. */
  protected readonly cardClass = computed(() => `event-card event-card--${this.event().eventState ?? 'upcoming'}`);

  /**
   * Whether the state badge is rendered at all.
   *
   * True only when the event is NOT upcoming, which is the one case where the badge
   * carries information of its own - see the class comment. A null or missing state
   * counts as upcoming, so an endpoint that omits the field cannot produce a
   * misleading badge.
   */
  protected readonly showStateBadge = computed(() => (this.event().eventState ?? 'upcoming') !== 'upcoming');

  /**
   * The state badge's classes, e.g. `badge badge--past`.
   *
   * Built here because the modifier the stylesheet knows is `badge--<state>`, and
   * the state is nullable on the shared `Event` type - a badge with no modifier
   * would be invisible, so 'upcoming' is the fallback. Only read while
   * `showStateBadge()` is true.
   */
  protected readonly badgeClass = computed(
    () => `badge badge--${this.event().eventState ?? 'upcoming'}`
  );

  /**
   * The artwork the media box shows.
   *
   * Normally whatever `imageUrl()` resolves - a bundled illustration, or an
   * absolute photograph URL an administrator pasted. If that photograph failed to
   * load, the project's fallback artwork is used instead, built from the same two
   * values `imageUrl()` falls back to (APP_CONFIG.imageBaseUrl + fallbackImage) so
   * the two paths cannot point at different pictures.
   *
   * Both cases fill the same 16:9 box and neither changes its height: the box is
   * sized by `.event-card__media`, and the image inside is `object-fit: cover`, so
   * a portrait photograph is cropped rather than squashed and the grid below it
   * never moves.
   */
  protected readonly image = computed(() =>
    this.imageFailed() ? `${APP_CONFIG.imageBaseUrl}${APP_CONFIG.fallbackImage}` : imageUrl(this.event())
  );

  /**
   * Swap in the fallback artwork after a failed load.
   *
   * Bound to the <img>'s `(error)`, which is how a photograph whose host is down
   * or whose file was moved reaches the same picture an event with no image gets.
   */
  protected onImageError(): void {
    this.imageFailed.set(true);
  }

  /**
   * "On now" / "Past event", as a translation key.
   *
   * Only rendered when `showStateBadge()` is true; `stateKey` still knows the
   * upcoming label, because the shared helper is used by pages that do show it.
   */
  protected readonly stateLabelKey = computed(() => stateKey(this.event().eventState));

  /** The category name, or a neutral "Charity event" when none is joined in. */
  protected readonly categoryName = computed(() => this.event().categoryName ?? '');

  /** The event's route, e.g. /events/2. */
  protected readonly detailLink = computed(() => `/events/${this.event().eventId}`);

  /** "11 Oct 2026, 7:30 am" - the date range plus the start time. */
  protected readonly when = computed(() => {
    const current = this.event();
    const date = formatDateRange(current);
    const time = formatTime(current.startTime);
    return time ? `${date}, ${time}` : date;
  });

  /** "Coffs Harbour Jetty Foreshore, Coffs Harbour NSW" */
  protected readonly where = computed(() => {
    const current = this.event();
    return `${current.venueName ?? ''}, ${current.city ?? ''} ${current.state ?? ''}`.trim();
  });

  /** The organisation running the event, or an empty string when not joined. */
  protected readonly cause = computed(() => this.event().organizationName ?? '');

  /**
   * The price pill: "Free", "From $185.00" or "Tickets closed".
   *
   * Three different questions are being answered, and the legacy card answered
   * them in this order for a reason: a past event cannot be bought at all, so
   * "Tickets closed" beats "From $185"; a free event should not say "From $0.00",
   * which reads like a bug; and when no tier has a price the visitor is pointed
   * at the event page rather than shown a made-up figure.
   */
  protected readonly priceText = computed(() => {
    const current = this.event();
    if (current.eventState === 'past') return 'event.ticketsClosed';
    if (current.isFree) return 'event.freeEntry';
    if (current.primaryPrice === null || current.primaryPrice === undefined) {
      return 'event.seeEventPage';
    }
    return 'event.fromPrice';
  });

  /** The price pill's modifier class, for the colours the stylesheet defines. */
  protected readonly priceClass = computed(() => {
    const current = this.event();
    if (current.eventState === 'past') return 'price price--closed';
    if (current.isFree) return 'price price--free';
    return 'price';
  });

  /** The formatted amount substituted into `event.fromPrice`, when needed. */
  protected readonly primaryPrice = computed(() => formatPrice(this.event().primaryPrice));
}
