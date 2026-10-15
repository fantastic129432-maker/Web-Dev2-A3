import { Component, computed, effect, inject, signal, untracked } from '@angular/core';

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
 * The request is issued from an `effect` wrapped in `untracked()` so it runs once
 * when the component is created and never re-fires because of a signal it reads.
 */
@Component({
  selector: 'app-api-status',
  imports: [TranslatePipe],
  templateUrl: './api-status.html',
})
export class ApiStatusComponent {
  private readonly api = inject(ApiService);

  /** Never null: 'checking' is a real state the template renders. */
  protected readonly state = signal<ApiState>('checking');

  constructor() {
    effect(() => {
      untracked(() => {
        this.api.getHealth().subscribe({
          next: (health) => {
            // `!== false` on purpose: null means "no database to check".
            const databaseOk = health.database?.connected !== false;
            this.state.set(databaseOk ? 'online' : 'warning');
          },
          error: () => this.state.set('offline'),
        });
      });
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
