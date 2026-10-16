import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { API_BASE_URL } from '@charity/shared/di/tokens';
import { CLIENT_DICTIONARIES } from '@charity/shared/i18n/client-translations';
import { APP_DICTIONARIES } from '@charity/shared/i18n/translation.service';

import { ApiStatusComponent } from './api-status';

/**
 * The footer's API indicator, and the lifetime of its one request.
 *
 * WHY THIS TEST EXISTS. The request used to be subscribed to inside an `effect`
 * with no teardown, so a response that arrived after the component was destroyed
 * still ran its handler and wrote to `state`. Nothing on screen showed it, because
 * the footer that renders this indicator lives for the whole application - which is
 * exactly why it is worth a test rather than an eyeball: the second case below
 * destroys the component with the request still in flight and then offers the
 * response, which is the only way the write is observable at all.
 *
 * `state` is protected, because only this component's own template reads it, so it
 * is read through a cast rather than widened for the test.
 */
function stateOf(fixture: ComponentFixture<ApiStatusComponent>): string {
  return (fixture.componentInstance as unknown as { state: () => string }).state();
}

describe('ApiStatusComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ApiStatusComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        // Both values the shared library asks for through a token: the base URL
        // ApiService builds `/health` from, and the dictionary TranslatePipe reads.
        { provide: API_BASE_URL, useValue: 'http://localhost:3000/api' },
        { provide: APP_DICTIONARIES, useValue: CLIENT_DICTIONARIES },
      ],
    }).compileComponents();
  });

  it('reports the server as online once /api/health answers', async () => {
    const fixture = TestBed.createComponent(ApiStatusComponent);
    // `detectChanges` rather than relying on the constructor: the request has to be
    // issued by the time the test looks for it, however the component issues it.
    fixture.detectChanges();

    const http = TestBed.inject(HttpTestingController);
    const request = http.expectOne((candidate) => candidate.url.endsWith('/health'));
    expect(stateOf(fixture)).toBe('checking');

    request.flush({ success: true, data: { database: { connected: true } } });
    await fixture.whenStable();

    expect(stateOf(fixture)).toBe('online');
  });

  it('cannot write to its state when the response arrives after the component is destroyed', () => {
    const fixture = TestBed.createComponent(ApiStatusComponent);
    fixture.detectChanges();

    const http = TestBed.inject(HttpTestingController);
    const request = http.expectOne((candidate) => candidate.url.endsWith('/health'));

    fixture.destroy();

    /*
     * Offer the late response and record whether it could be delivered at all.
     *
     * Unsubscribing closes the HTTP observable, which cancels the request, so the
     * test backend refuses to deliver anything to it ("Cannot flush a cancelled
     * request"). The state assertion comes FIRST on purpose: it is the defect
     * itself - a response that settled after the component was gone writing to the
     * signal - so a failure reads as the write that must not happen rather than as
     * a missing cancellation.
     */
    let delivered = false;
    try {
      request.flush({ success: true, data: { database: { connected: true } } });
      delivered = true;
    } catch {
      delivered = false;
    }

    expect(stateOf(fixture)).toBe('checking');
    expect(delivered).toBe(false);
    expect(request.cancelled).toBe(true);
  });
});
