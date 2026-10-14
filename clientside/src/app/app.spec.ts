import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { CLIENT_DICTIONARIES } from '@charity/shared/i18n/client-translations';
import { APP_DICTIONARIES } from '@charity/shared/i18n/translation.service';

import { App } from './app';

/**
 * A smoke test for the application shell only.
 *
 * It used to assert on the Angular CLI placeholder ("Hello, clientside"), which no
 * longer exists. What is worth asserting now is that the shell can be created with
 * the same providers the real application uses - the router (for the header's
 * links) and the two tokens the shared services need - and that the header and
 * footer are in the rendered document. The page-specific behaviour is covered by
 * the project's own end-to-end suite, which drives a real browser against the
 * running API (tests/angular-e2e.mjs).
 */
describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
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
