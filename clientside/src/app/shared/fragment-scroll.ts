import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, NavigationSkipped, NavigationStart, Router } from '@angular/router';

/**
 * How long a fragment link keeps being re-checked after the navigation that
 * carried it.
 *
 * Not "until the page stops changing": the page's own data has no deadline, so
 * neither does its arrival, and a watcher with no end would be the endless
 * re-scroll this exists to avoid. Four seconds is long enough for the home page's
 * listing - a loopback API answers in single-digit milliseconds, and the delayed
 * case measured in the class comment below answered in 600ms - and short enough
 * that a visitor who has started reading something else is never moved after it.
 */
const SETTLE_WINDOW_MS = 4000;

/**
 * How far below its resting line a fragment may sit before it is moved.
 *
 * A landed fragment's top is its resting line exactly, but layout reports
 * fractions (`-0.5px` measured) and the sticky header's own height is a fraction,
 * so the test is "more than this far below", not "not equal".
 */
const LANDING_TOLERANCE_PX = 2;

/**
 * Frames left to the router before this watch makes its first attempt.
 *
 * The router's own anchor scroll is scheduled after a `setTimeout` and a frame
 * (`RouterScroller.scheduleScrollEvent`), so it lands about a millisecond after
 * `NavigationEnd` - before the next animation frame, but not before a listener
 * that reacts to `NavigationEnd` synchronously. Checking first would be harmful
 * rather than merely redundant: scrolling brings a `position: sticky` element onto
 * its sticky line, and the router's own computation (`rect.top + scrollY`) then
 * measures that displaced position and scrolls the page a second time. Measured on
 * the event page's "Get tickets" click: the card was moved to its sticky line by
 * this watch and the router then followed it 96.31px further down the page - the
 * same card in the same place, but a scroll position the router alone does not
 * produce. Two frames of patience leave the router's attempt exactly as it was.
 */
const FRAMES_LEFT_TO_THE_ROUTER = 2;

/**
 * @file Makes a cross-route fragment link land once the page under it exists.
 *
 * THE DEFECT THIS EXISTS FOR
 *   A `routerLink="/"` carrying `fragment="about"` navigates correctly - the URL
 *   lands on `/#about` - but the router scrolls to the anchor about a frame after
 *   `NavigationEnd`, while the home page's event listing is still being fetched,
 *   so that scroll is made against a page that is still SHORT: the anchor is where
 *   the About section is at that instant, not where it ends up. Measured in
 *   headless Edge at 1400x1000 with `GET /api/events/upcoming` delayed 600ms:
 *   `BrowserViewportScroller.scrollToAnchor` asked for top 1274.95 - the section's
 *   position at that moment, 1px inside the page's whole scroll range of 1276 -
 *   and the section finished at document y 2469.5 once the twelve event cards had
 *   rendered, leaving the visitor 1149px short of the section the link named.
 *   Touching the wheel before the listing arrives makes that short landing
 *   permanent (measured 1226.5px short, and still short a second later), which is
 *   the 1183px shortfall the review recorded at 1440x1080 - scrollY 1287 against
 *   the section's y 2470 - and the reason a previous round removed the footer link
 *   rather than shipping it.
 *
 * WHY THE PAGE HAS TO MAKE THE SECOND ATTEMPT ITSELF
 *   The router's `anchorScrolling` (`withInMemoryScrolling` in app.config.ts) is
 *   one attempt, made when the route activates, and there is nothing in the router
 *   for it to wait on. Chromium does keep a "fragment anchor" alive after a
 *   fragment navigation and re-scrolls to the element as the document grows, which
 *   hides the defect while the visitor touches nothing - measured: the same click
 *   with no input ends at scrollY 2470 with no code of ours involved. That is a
 *   browser heuristic rather than a contract: the first scroll gesture releases it,
 *   and a visitor who so much as nudges the wheel is left where the short page
 *   stopped. So the second attempt is made here, from the page that knows when its
 *   own content has arrived.
 *
 * WHAT IT DOES, AND WHAT STOPS IT
 *   After a navigation that names a fragment, one frame in every animation frame
 *   asks whether the fragment has actually landed: the element is measured against
 *   its own resting line - the top of the viewport, or its `position: sticky` `top`
 *   for an element the stylesheet holds there - and scrolled to exactly the way the
 *   router scrolls to it (`rect.top + scrollY`, the element's top at the top of the
 *   viewport) when it is more than
 *   {@link LANDING_TOLERANCE_PX} below that line. A landed fragment is therefore
 *   left alone, which is every same-route fragment click on a finished page: the
 *   router's single attempt is already correct there and this service never touches
 *   the scroll. The watch also stops on a new navigation (a URL without a fragment
 *   cancels it outright), at the end of {@link SETTLE_WINDOW_MS}, and when the
 *   component that owns it is destroyed.
 *
 * WHY IT CANNOT LOOP
 *   Each pass ends when the fragment is at its resting line, and scrolling to a
 *   fragment that is already there is never requested again. The one page where the
 *   line cannot be reached - a fragment on the LAST element, the footer's
 *   `#contact`, which no scroll can bring to the top of the viewport - is left
 *   alone as soon as the page is scrolled as far as it goes, so the browser's own
 *   clamp is not re-issued every frame.
 *
 * WHY A NAVIGATION FROM THE BROWSER'S HISTORY IS LEFT ALONE
 *   The router restores a Back/Forward position itself, and scrolling to an anchor
 *   the visitor has just navigated away from would fight it: the `popstate` trigger
 *   is therefore skipped, so history restoration behaves exactly as it did before
 *   this service existed.
 */
@Injectable({ providedIn: 'root' })
export class FragmentScrollService {
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);

  /** The fragment being watched; empty when nothing is. */
  private fragment = '';

  /** `performance.now()` after which the watch gives up. */
  private deadline = 0;

  /** The pending frame, so a new navigation can cancel it. 0 means "none". */
  private frame = 0;

  /** Frames still owed to the router before this watch may scroll. */
  private routerFrames = 0;

  /** Whether the navigation being handled came from the browser's own history. */
  private fromBrowserHistory = false;

  constructor() {
    this.router.events.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((event) => {
      if (event instanceof NavigationStart) {
        // Read at the START of the navigation: this is the only event that carries
        // the trigger, and the flag is what keeps history restoration untouched
        // (see the class comment).
        this.fromBrowserHistory = event.navigationTrigger === 'popstate';
        return;
      }

      if (event instanceof NavigationEnd) {
        this.follow(this.fragmentOf(event.urlAfterRedirects));
        return;
      }

      // A click on a link to the URL that is already open is skipped rather than
      // ended, and the router still scrolls to its fragment; the page can grow
      // after that click exactly as it can after any other.
      if (event instanceof NavigationSkipped) {
        this.follow(this.fragmentOf(event.url));
      }
    });

    // The initial navigation can complete before this service is constructed - the
    // shell is created around the router's first resolution - so the fragment
    // already in the address bar is picked up here as well. A URL without one
    // cancels nothing, because nothing is running yet.
    this.follow(this.fragmentOf(this.router.url));
  }

  /** The fragment of a URL, or an empty string when it carries none. */
  private fragmentOf(url: string): string {
    return this.router.parseUrl(url).fragment ?? '';
  }

  /**
   * Watch one fragment, replacing whatever was being watched before.
   *
   * @param fragment - The element id to land on; an empty string stops the watch.
   */
  private follow(fragment: string): void {
    this.stop();
    if (fragment === '' || this.fromBrowserHistory) return;

    this.fragment = fragment;
    this.deadline = performance.now() + SETTLE_WINDOW_MS;
    this.routerFrames = FRAMES_LEFT_TO_THE_ROUTER;
    this.frame = requestAnimationFrame(this.settle);
  }

  /** Cancel the pending frame and forget the fragment being watched. */
  private stop(): void {
    if (this.frame !== 0) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.fragment = '';
  }

  /**
   * One frame of the watch: land the fragment if the page has moved it away.
   *
   * An arrow-function field so the frame callback keeps `this`, and the only place
   * that requests a scroll - which is what makes "it cannot fire endlessly"
   * checkable by reading one method.
   */
  private readonly settle = (): void => {
    this.frame = 0;

    if (this.routerFrames > 0) {
      // The router's own attempt is still in flight; see the constant above.
      this.routerFrames -= 1;
    } else {
      const target = this.document.getElementById(this.fragment);
      if (target && this.isBelowRestingLine(target)) this.scrollTo(target);
    }

    if (performance.now() < this.deadline) this.frame = requestAnimationFrame(this.settle);
  };

  /**
   * Whether the fragment is sitting lower than the line it should come to rest on.
   *
   * The line is the top of the viewport for an ordinary element, and the element's
   * own sticky `top` for one the stylesheet pins - which is how the ticket card and
   * the register page's summary card are held clear of the header. An element
   * pushed ABOVE its line (a sticky card whose rail has ended, or one the visitor
   * has scrolled past) answers false on purpose: it is visible, and moving it would
   * be overriding a deliberate scroll.
   *
   * @param target - The fragment element being watched.
   * @returns True when the element needs to be brought back up to its line.
   */
  private isBelowRestingLine(target: HTMLElement): boolean {
    const view = this.document.defaultView;
    if (!view) return false;

    const style = view.getComputedStyle(target);
    const restingTop = style.position === 'sticky' ? Number.parseFloat(style.top) || 0 : 0;
    if (target.getBoundingClientRect().top <= restingTop + LANDING_TOLERANCE_PX) return false;

    // The document is scrolled as far as it goes, so the line cannot be reached:
    // a fragment on the last element (the footer's `#contact`) and a page that has
    // not finished growing both look like this, and only the second is fixed by
    // scrolling - which happens by itself as soon as there is more page below.
    const scrollable = this.document.documentElement.scrollHeight - view.innerHeight;
    return scrollable - view.scrollY > LANDING_TOLERANCE_PX;
  }

  /**
   * Put the element's top at its resting line, as the router does.
   *
   * The same computation as `BrowserViewportScroller.scrollToElement` with its
   * default offset: the element's current document position, with no allowance for
   * the sticky header. A sticky element is then held at its own `top` by the
   * stylesheet, which is where every sticky card on this site is meant to rest.
   *
   * @param target - The element to bring to the top of the viewport.
   */
  private scrollTo(target: HTMLElement): void {
    const view = this.document.defaultView;
    if (!view) return;
    const rect = target.getBoundingClientRect();
    view.scrollTo({ left: rect.left + view.scrollX, top: rect.top + view.scrollY });
  }
}
