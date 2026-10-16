import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { API_BASE_URL, OTHER_SITE_URL } from '@charity/shared/di/tokens';
import { CLIENT_DICTIONARIES } from '@charity/shared/i18n/client-translations';
import { APP_DICTIONARIES } from '@charity/shared/i18n/translation.service';

import { App } from './app';

/**
 * A smoke test for the application shell only.
 *
 * It used to assert on the Angular CLI placeholder ("Hello, clientside"), which no
 * longer exists. What is worth asserting now is that the shell can be created with
 * the same providers the real application uses - the router (for the header's
 * links), the values the shared library asks for through a token, and the
 * dictionary - and that the header and footer are in the rendered document. The
 * page-specific behaviour is covered by the project's own end-to-end suite, which
 * drives a real browser against the running API (tests/angular-e2e.mjs).
 *
 * BOTH TOKENS ARE PROVIDED, AND BOTH ARE NEEDED. `API_BASE_URL` is what ApiService
 * builds its URLs from, and `OTHER_SITE_URL` is the cross-site link the footer
 * renders as its admin link; a test module that omits either one fails in the
 * component that injects it (NG0201) rather than in the assertion, which is what
 * happened here while the footer's admin link was added and this list was not
 * updated with it. They are test values: nothing asserts on either string.
 */
describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: 'http://localhost:3000/api' },
        { provide: OTHER_SITE_URL, useValue: 'http://localhost:4300/' },
        { provide: APP_DICTIONARIES, useValue: CLIENT_DICTIONARIES },
      ],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should render the site chrome around the routed page', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    // The language and theme controls live in the header on every page, and the
    // live API indicator in the footer, so both are proof the shell rendered.
    expect(compiled.querySelector('app-site-header')).toBeTruthy();
    expect(compiled.querySelector('app-site-footer')).toBeTruthy();
    expect(compiled.querySelector('#language-select')).toBeTruthy();
    expect(compiled.querySelector('router-outlet')).toBeTruthy();
  });
});
