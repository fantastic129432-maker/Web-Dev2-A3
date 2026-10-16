import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { ApiService } from '@charity/shared/api/api.service';
import { TranslatePipe } from '@charity/shared/i18n/translate.pipe';

/** What the indicator is currently saying. */
type ApiState = 'checking' | 'online' | 'warning' | 'offline';

/**
 * The live API status indicator in the site footer.
 *
 * It reports three states rather than two, and a failure is informational rather
 * than an error message.
 *
 * Endpoint: `GET /api/health` (ApiService.getHealth()).
 *
 * WHY IT LIVES IN ITS OWN COMPONENT
 *   The footer is rendered on every route, so this is a request that runs on
 *   every page. Keeping it separate means the footer template stays static and
 *   this is the only thing that changes once the response arrives.
 *
 * WHY THE THREE STATES RATHER THAN TWO
 *   The legacy footer distinguished `database.connected === false` ("the API is
 *   up but the database is not") from a failed request ("the API is offline").
 *   Those are different problems with different fixes, and collapsing them into
 *   one red label would hide the more confusing case - an API that answers with
 *   valid JSON but cannot read any events. `database.connected` is `null` when
 *   the local data source is in use, which is why the test is `!== false` rather
 *   than `=== true`.
 *
 * WHY A FAILURE IS NOT AN ERROR MESSAGE
 *   The status line is informational. A visitor does not need a red error panel
 *   because a health check failed; the pages themselves already report their own
 *   loading failures in context.
 *
 * The request is issued ONCE, from the constructor, and `takeUntilDestroyed` ends it
 * with the component - see the note on the constructor for why that lifetime is the
 * point rather than a formality.
 */
@Component({
  selector: 'app-api-status',
  imports: [TranslatePipe],
  templateUrl: './api-status.html',
})
export class ApiStatusComponent {
  private readonly api = inject(ApiService);

  /**
   * The component's lifetime, handed to `takeUntilDestroyed()` explicitly.
   *
   * `takeUntilDestroyed()` with no argument only works inside an injection context,
   * i.e. in a field initialiser or the constructor; the request below is subscribed
   * to in the constructor either way, but the reference is injected once and handed
   * over so the subscription's end is stated at the call site - the same shape the
   * home page uses for its two one-off requests.
   */
  private readonly destroyRef = inject(DestroyRef);

  /** Never null: 'checking' is a real state the template renders. */
  protected readonly state = signal<ApiState>('checking');

  /**
   * Issue the one health request, with the component's lifetime attached.
   *
   * ENDED WITH THE COMPONENT, AND THAT IS THE POINT. `GET /api/health` can settle
   * after this component has been destroyed, and both handlers below write to
   * `state`, so a request with no teardown leaves a destroyed component being
   * written to. Nothing on screen can show that today: the footer that renders this
   * indicator lives for the whole application and is never destroyed. That is the
   * reason to fix it rather than tolerate it - the moment the indicator is used
   * somewhere with a shorter life (a TestBed case, or a status card on a page of its
   * own) the write lands on a signal nobody is reading.
   *
   * WHAT THIS REPLACES. The request used to be issued from an `effect` wrapping the
   * subscription in `untracked()`. It behaved the same way - an effect that reads no
   * signal never re-runs, so the request was still issued exactly once - but an
   * effect has no teardown for the SUBSCRIPTION it starts, so the request outlived
   * the component it belonged to. The subscription is now explicit, and
   * `takeUntilDestroyed(this.destroyRef)` - the convention the home page's two
   * one-off requests already use - ends it on destroy.
   */
  constructor() {
    this.api
      .getHealth()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (health) => {
          // `!== false` on purpose: null means "no database to check".
          const databaseOk = health.database?.connected !== false;
          this.state.set(databaseOk ? 'online' : 'warning');
        },
        error: () => this.state.set('offline'),
      });
  }

  /** The translation key for the current state. */
  protected readonly labelKey = computed(() => {
    switch (this.state()) {
      case 'online':
        return 'api.online';
      case 'warning':
        return 'api.dbDown';
      case 'offline':
        return 'api.offline';
      default:
        return 'api.checking';
    }
  });
}
