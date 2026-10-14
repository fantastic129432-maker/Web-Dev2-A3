import { TestBed } from '@angular/core/testing';

import { App } from './app';
import { appConfig } from './app.config';

/**
 * A smoke test for the application shell.
 *
 * The providers come from the real appConfig, so the test boots the same router,
 * HttpClient and dictionaries the application does. That matters: the shell
 * renders the header, which needs both injection tokens and the admin dictionary,
 * and a test with hand-written providers would pass while the real application
 * failed to start.
 */
describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: appConfig.providers,
    }).compileComponents();
  });

  it('creates the administration shell', () => {
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('renders the header, the menu and the footer on every page', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    // The menu is the brief's "present on all pages" requirement, so it is the
    // one thing worth asserting: four page links plus the link to the public site.
    expect(compiled.querySelectorAll('nav.admin-nav a').length).toBe(4);
    expect(compiled.querySelector('header.admin-header')).toBeTruthy();
    expect(compiled.querySelector('footer.admin-footer')).toBeTruthy();
  });

  it('marks the document as the admin body, which the stylesheet keys off', () => {
    TestBed.createComponent(App);
    expect(document.body.classList.contains('admin-body')).toBe(true);
  });
});
