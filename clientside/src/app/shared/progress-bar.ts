import { Component, computed, inject, input } from '@angular/core';

import { TranslationService } from '@charity/shared/i18n/translation.service';
import { TranslatePipe } from '@charity/shared/i18n/translate.pipe';
import type { Event } from '@charity/shared/models/event.model';
import { formatCurrency } from '@charity/shared/util/format';

/**
 * The "Goal vs progress" bar required by the assessment brief.
 *
 * Used twice, at two sizes:
 *   * on every event card, `[compact]="true"` - a thin bar under the summary
 *   * on the event detail page, full size, with the donation count underneath
 *
 * Inputs are the whole `Event` rather than the four numbers it needs, because
 * every caller already has one and the four fields only ever travel together.
 * Angular's signal `input.required` is used so a missing event is a compile error
 * in the caller's template rather than a bar that silently renders 0%.
 *
 * WHY THE PERCENTAGE IS CLAMPED
 *   `progressPercent` is computed by the API from the donations table, so it can
 *   exceed 100 when an event beats its goal. A CSS width above 100% would push
 *   the fill outside its track, and a negative one is impossible but cheap to
 *   guard. The DISPLAYED percentage is the clamped value too, so the number and
 *   the bar never disagree.
 *
 * The track is a real `role="progressbar"` with aria-valuenow/min/max, which is
 * what makes the figure readable to a screen reader instead of being just a
 * coloured rectangle.
 */
@Component({
  selector: 'app-progress-bar',
  imports: [TranslatePipe],
  templateUrl: './progress-bar.html',
})
export class ProgressBarComponent {
  private readonly i18n = inject(TranslationService);

  /** The event whose goal and donations are shown. */
  readonly event = input.required<Event>();

  /** True on event cards: a thinner bar with no donation count. */
  readonly compact = input(false);

  /** The clamped 0-100 percentage, as an integer. */
  protected readonly percent = computed(() => {
    const raw = Number(this.event().progressPercent ?? 0);
    if (!Number.isFinite(raw)) return 0;
    return Math.max(0, Math.min(raw, 100));
  });

  /** Rounded for display, e.g. "25% of goal". */
  protected readonly percentText = computed(() => this.percent().toFixed(0));

  /** "$14,830" - whole dollars, which is how the legacy page showed it. */
  protected readonly raised = computed(() => formatCurrency(this.event().raisedAmount));

  /** The fundraising target, formatted the same way as the amount raised. */
  protected readonly goal = computed(() => formatCurrency(this.event().goalAmount));

  /** How many donations the figure is based on, or 0 when the API sent none. */
  protected readonly donationCount = computed(() => Number(this.event().donationCount ?? 0));

  /**
   * The aria-label for the progress track.
   *
   * Built through TranslationService rather than the `t` pipe because it is an
   * attribute value computed from the event, and because reading `i18n.t` inside
   * a `computed` is what makes the label re-render in the new language when the
   * visitor switches - `this.event()` and the active language are both tracked
   * dependencies.
   */
  protected readonly ariaLabel = computed(() =>
    this.i18n.t('a11y.progressFor', { name: this.event().eventName })
  );
}
