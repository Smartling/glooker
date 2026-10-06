import { test, expect, type Page } from '@playwright/test';

/**
 * Real-browser smoke test. Every check here is one curl and Jest cannot do:
 * that the page HYDRATES and renders data. The Next 16 upgrade passed every
 * HTTP-level check while a CSP blocked the inline hydration scripts, leaving
 * each page as a static shell (React error #412).
 */
const FATAL = /Content Security Policy|Minified React error|Hydration failed|did not match/i;

function watchForFatalErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error' && FATAL.test(msg.text())) errors.push(`console: ${msg.text()}`);
  });
  return errors;
}

// Each expectText is content a page can only show after hydrating AND fetching
// seeded data (never nav or static headings, which a CSP-broken shell also has).
const PAGES: Array<{ path: string; expectText: RegExp }> = [
  // Not the "What's New" card (built from the checkout's own git history — empty in
  // CI's shallow clone) nor Highlights (needs two comparable reports). The nav's
  // summary link carries the seeded latest report's date, fetched client-side.
  { path: '/', expectText: /Team Summary \w{3} \d+/ }, // nav link to the seeded report
  { path: '/reports', expectText: /mock-org · \d+ days/ }, // seeded report cards
  { path: '/reports?tab=syncs', expectText: /mock-org · Dependabot critical \+ high/ }, // seeded sync runs
  { path: '/settings', expectText: /Commit Analyzer/ }, // per-service LLM table from /api
  { path: '/vulnerabilities', expectText: /By owning team/ }, // team pivot from seeded alerts
  { path: '/projects', expectText: /Implement rate limiting middleware/ }, // epic from mock Jira
];

// Run the visibility checks, then ALWAYS assert on browser errors. The errors are
// checked in `finally` so that when hydration is broken (the visibility checks
// time out) the failure names the cause — e.g. the blocked CSP — instead of only
// "element not found".
async function expectHydrated(page: Page, errors: string[], check: () => Promise<void>) {
  try {
    await check();
  } finally {
    expect(errors, 'fatal browser errors').toEqual([]);
  }
}

for (const { path, expectText } of PAGES) {
  test(`${path} hydrates and renders data`, async ({ page }) => {
    const errors = watchForFatalErrors(page);
    await page.goto(path);
    await expectHydrated(page, errors, async () => {
      // The nav is client-rendered from /api/llm-config: if it shows, hydration ran.
      await expect(page.getByRole('link', { name: 'Reports' })).toBeVisible();
      await expect(page.getByText(expectText).first()).toBeVisible();
    });
  });
}

test('the reports list shows seeded report cards, not just the page shell', async ({ page }) => {
  const errors = watchForFatalErrors(page);
  await page.goto('/reports');
  await expectHydrated(page, errors, async () => {
    // Seeded reports render as cards whose subject reads "<org> · <N> days".
    await expect(page.getByText(/· \d+ days/).first()).toBeVisible();
  });
});
