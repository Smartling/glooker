/** @jest-environment jsdom */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { SWRConfig } from 'swr';
import VulnerabilitiesContent from '@/app/vulnerabilities/vulnerabilities-content';

// A fresh SWR cache per test — otherwise the second test below would see the first test's
// still-cached `/summary` response for the identical key before its own mock ever runs.
const wrap = (ui: React.ReactNode) => <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig>;

const mockPathname = '/vulnerabilities';

// TeamPivot's onSelectTeam calls setTeam (useUrlState), which calls router.replace(newUrl).
// The previous mock's useSearchParams() returned a fixed value, so a click in a test could never
// actually swap the summary SWR key — replace() ran, but the component never saw a new `team`.
// This mock makes navigation reactive: push/replace record the new query string and notify
// subscribers, and useSearchParams itself subscribes via useReducer so the owning component
// re-renders with the new params — the same round trip Next.js's real router does, just
// synchronous. `__resetSearch` lets `beforeEach` restore the shared default between tests.
jest.mock('next/navigation', () => {
  const ReactLib = require('react');
  let currentSearch = 'team=Z';
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((l: () => void) => l());
  const navigate = (url: string) => { currentSearch = url.includes('?') ? url.split('?')[1] : ''; notify(); };
  return {
    useRouter: () => ({
      push: (url: string) => { navigate(url); },
      replace: (url: string) => { navigate(url); },
    }),
    useSearchParams: () => {
      const [, force] = ReactLib.useReducer((c: number) => c + 1, 0);
      ReactLib.useEffect(() => { listeners.add(force); return () => { listeners.delete(force); }; }, []);
      return new URLSearchParams(currentSearch);
    },
    usePathname: () => mockPathname,
    __resetSearch: (qs: string) => { currentSearch = qs; notify(); },
  };
});

// the shared fetcher (format.ts) throws on a non-ok response, so `withFilters`'s 400
// `{ error, known_teams }` now arrives as an SWR-level error, not as `summary` data. The mock
// below carries `ok: false, status: 400` to match the real route.
const fetchMock = jest.fn((url: string) => {
  if (url.includes('/summary')) {
    return Promise.resolve({ ok: false, status: 400, json: async () => ({ error: 'unknown team', known_teams: ['T1'] }) } as any);
  }
  // trend/alerts/coverage are irrelevant to this test — the summary error branch
  // returns before any of them render — but SWR still fires the requests, so
  // every URL needs a response to avoid an unhandled rejection.
  return Promise.resolve({ ok: true, status: 200, json: async () => ({ available: false, reason: 'unused in this test' }) } as any);
});

beforeEach(() => {
  fetchMock.mockClear();
  (global as any).fetch = fetchMock;
  (jest.requireMock('next/navigation') as any).__resetSearch('team=Z');
});

it('shows "Clear team filter" and the known teams when summary rejects an unknown team', async () => {
  render(wrap(<VulnerabilitiesContent />));
  expect(await screen.findByText('unknown team')).toBeTruthy();
  expect(screen.getByText(/Known teams: T1/)).toBeTruthy();
  expect(screen.getByText('Clear team filter')).toBeTruthy();
});

// a route exception (withRequestLog's catch-all) returns 500 { error: 'Internal Server
// Error' }. Before the shared fetcher threw on !r.ok, that body arrived as SWR `data`, so
// `alerts?.rows` was falsy and AlertsPanel rendered "Loading…" forever instead of the error.
const validSummary = {
  available: true, org: 'o',
  sync: { stale: false, lastSuccessfulAt: '2026-09-22T06:00:00Z', lastStatus: 'succeeded', issues: [] },
  resolvedCountStartDate: '2020-01-08',
  resolvedCountInvalid: false,
  resolvedSince: { date: '2020-01-08', invalid: false },
  scope: { property: 'service_tier', value: 'production' },
  slaPolicyInvalid: false,
  policy: [{ id: 'critical-2020-01', severity: 'critical', effectiveFrom: '2020-01-08', days: 9 }],
  slaStatus: { critical: 'active', high: 'none' },
  pivot: {
    rows: [],
    total: { team: 'Total', critical: { open: 1, resolved: 0, dismissed: 0, pctClosed: 0, overdue: 0, dueSoon: 0 }, high: { open: 0, resolved: 0, dismissed: 0, pctClosed: 0, overdue: 0, dueSoon: 0 }, unmeasuredRepos: 0 },
  },
  kpi: { openCriticalOtherCodebases: null },
  delta: { critical: { available: false }, high: { available: false } },
};

it('alerts panel shows the error instead of "Loading…" forever when the alerts endpoint 500s', async () => {
  const alertsFetchMock = jest.fn((url: string) => {
    if (url.includes('/summary')) return Promise.resolve({ ok: true, status: 200, json: async () => validSummary } as any);
    if (url.includes('/alerts')) return Promise.resolve({ ok: false, status: 500, json: async () => ({ error: 'Internal Server Error' }) } as any);
    if (url.includes('/trend')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ series: [] }) } as any);
    if (url.includes('/coverage')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ needsTagging: [], excludedByPolicy: [], unmeasured: [] }) } as any);
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) } as any);
  });
  (global as any).fetch = alertsFetchMock;
  render(wrap(<VulnerabilitiesContent />));
  expect(await screen.findByText("Couldn't load alerts: Internal Server Error")).toBeTruthy();
  // the error swaps only the rows/count area, not the whole AlertsTable — the
  // search input and the chips (e.g. the Overdue chip; team-pivot.tsx also has an "Overdue" column
  // header, so this is scoped to the button role) stay rendered and interactive so the user can
  // undo the filter that caused a 400 or retry after a 500.
  expect(screen.getByPlaceholderText('Search CVE, GHSA, package, repo')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Overdue' })).toBeTruthy();
  expect(screen.queryAllByText('Loading…')).toHaveLength(0);
});

// after the first alerts load fails (the test above), changing a filter swaps
// the SWR key to one that has no data AND no error until its own fetch settles —
// `keepPreviousData` only carries forward the last good *data*, never an error, and here there was
// never a good data to carry. The old code's `err || data` gate in AlertsPanel was both false in
// that gap, so it rendered a bare "Loading…" <p> in AlertsTable's place, unmounting it and
// dropping focus, sort state, and (per the unmount-flush behavior) reverting a chip click made within
// 300ms of typing, because the flush merges onto the stale `filtersRef.current`. The fetch behind
// the *next* key must be held pending with a deferred promise — an immediately-resolving mock
// would let the key settle before we can observe the gap, hiding the bug.
it('the search input and its typed value survive a filter change while the next alerts fetch is still pending', async () => {
  jest.useFakeTimers();
  try {
    let alertsCalls = 0;
    // Deferred promises for every alerts fetch after the first (failed) one, so the test can hold
    // each one pending and later resolve it by hand — an immediately-resolving mock would let the
    // key settle before the assertions below can observe the true in-flight gap.
    const pendingAlerts: Array<(v: unknown) => void> = [];
    const alertsFetchMock = jest.fn((url: string) => {
      if (url.includes('/summary')) return Promise.resolve({ ok: true, status: 200, json: async () => validSummary } as any);
      if (url.includes('/trend')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ series: [] }) } as any);
      if (url.includes('/coverage')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ needsTagging: [], excludedByPolicy: [], unmeasured: [] }) } as any);
      if (url.includes('/alerts')) {
        alertsCalls += 1;
        if (alertsCalls === 1) {
          // The first load fails, exactly like the test above.
          return Promise.resolve({ ok: false, status: 500, json: async () => ({ error: 'Internal Server Error' }) } as any);
        }
        return new Promise((resolve) => { pendingAlerts.push(resolve); });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) } as any);
    });
    (global as any).fetch = alertsFetchMock;

    render(wrap(<VulnerabilitiesContent />));
    expect(await screen.findByText("Couldn't load alerts: Internal Server Error")).toBeTruthy();

    const input = screen.getByPlaceholderText('Search CVE, GHSA, package, repo') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'abc' } });
    // Within 300ms of typing — no timer advance between the keystroke and the chip click.
    fireEvent.click(screen.getByRole('button', { name: 'Overdue' }));
    act(() => { jest.advanceTimersByTime(300); });

    // The next alerts fetch (triggered by the filter change) is still pending here.
    // getByPlaceholderText itself throws if the input isn't in the document, so its return alone
    // proves AlertsTable (and therefore the input) stayed mounted through the gap.
    const inputNow = screen.getByPlaceholderText('Search CVE, GHSA, package, repo') as HTMLInputElement;
    expect(inputNow.value).toBe('abc');
    // this is the "never resolved yet" case AlertsTable's `loading` prop
    // exists for — prove it actually renders "Loading…" here, not just that the input survived.
    expect(screen.getByText('Loading…')).toBeTruthy();

    const lastAlertsUrl = alertsFetchMock.mock.calls
      .map(([u]) => u as string)
      .filter(u => u.includes('/alerts'))
      .pop();
    expect(lastAlertsUrl).toContain('overdue=true');
    expect(lastAlertsUrl).toContain('q=abc');

    // the pending fetch resolves with one distinguishable row and
    // totalCount: 1 — `{ rows: [], totalCount: 0, truncated: false }` (the old payload) is
    // identical to the loading fallback's implicit state, so `loading={false}` would have passed
    // this test too. Resolving with real content makes the post-resolution assertions below
    // load-bearing against that mutation (see the report for the RED proof).
    await act(async () => {
      pendingAlerts[pendingAlerts.length - 1]({
        ok: true, status: 200,
        json: async () => ({
          rows: [{
            repo: 'acme/distinctive-repo', team: 'T1', severity: 'critical', severityChangedAt: null,
            cveId: 'CVE-2026-9999', ghsaId: 'GHSA-xxxx', summary: null, cvss: 9.1, epss: null,
            packageName: 'left-pad', ecosystem: 'npm', manifestPath: 'package.json', relationship: 'direct', scope: 'runtime',
            createdAt: '2026-09-01T00:00:00Z', ageDays: 22, clockStart: '2026-09-01', dueDate: '2020-01-17', daysRemaining: 5,
            slaPolicyId: 'critical-2020-01', state: 'open', dismissedReason: null, resolvedAt: null,
            resolvedOnTime: null, resolvedDaysLate: null, reopenedCount: 0, htmlUrl: 'https://example/distinctive',
          }],
          totalCount: 1, truncated: false,
        }),
      });
    });
    expect(await screen.findByText('distinctive-repo')).toBeTruthy();
    expect(await screen.findByText(/1 alerts\./)).toBeTruthy();
    expect((screen.getByPlaceholderText('Search CVE, GHSA, package, repo') as HTMLInputElement).value).toBe('abc');
  } finally {
    jest.useRealTimers();
  }
});

// Commit b728f8b made a summary error fall through to the normal page with a
// banner when `summary` still held data from a previous key — keepPreviousData survives a
// codebase/team/baseline change (e.g. clicking a pivot team row swaps team into the summary SWR
// key). (Tab-refocus revalidation is not a trigger here: `src/lib/swr-provider.tsx` sets
// `revalidateOnFocus: false` app-wide.) The user reverted that decision (2026-09-23): a summary error other than the
// unknown-team case now fails the page visibly again, even with data already in hand — keeping the
// page up and showing the previous key's figures under a new team/codebase/baseline label risked
// stale numbers, and a reload recovers. The tests below cover the reverted behavior and the
// ordering (unknown-team first) it still depends on.
const summaryWithPivotRow = {
  ...validSummary,
  pivot: {
    rows: [{
      team: 'T1',
      critical: { open: 5, resolved: 0, dismissed: 0, pctClosed: 0, overdue: 0, dueSoon: 0 },
      high: { open: 0, resolved: 0, dismissed: 0, pctClosed: 0, overdue: 0, dueSoon: 0 },
      unmeasuredRepos: 0,
    }],
    total: validSummary.pivot.total,
  },
};

it('a summary error with data in hand fails the page visibly, not a banner over stale figures', async () => {
  const g1FetchMock = jest.fn((url: string) => {
    if (url.includes('/summary')) {
      // The initial load (team=Z, the mock's default — see __resetSearch above) succeeds; the
      // pivot-row click below moves the summary key to team=T1, which 500s.
      if (url.includes('team=T1')) {
        return Promise.resolve({ ok: false, status: 500, json: async () => ({ error: 'Internal Server Error' }) } as any);
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => summaryWithPivotRow } as any);
    }
    if (url.includes('/trend')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ series: [] }) } as any);
    if (url.includes('/alerts')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ rows: [], totalCount: 0, truncated: false }) } as any);
    if (url.includes('/coverage')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ needsTagging: [], excludedByPolicy: [], unmeasured: [] }) } as any);
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) } as any);
  });
  (global as any).fetch = g1FetchMock;

  render(wrap(<VulnerabilitiesContent />));
  // Summary, trend, alerts and coverage all load first.
  expect(await screen.findByText('T1')).toBeTruthy();
  expect(await screen.findByText(/0 alerts\./)).toBeTruthy();
  // The pivot figure from the first load — asserted present now so its absence after the click
  // below is proof of something, not a probe that was never there.
  expect(screen.getByText('Open critical alerts')).toBeTruthy();

  fireEvent.click(screen.getByText('T1'));

  expect(await screen.findByText("Couldn't load summary: Internal Server Error")).toBeTruthy();
  expect(screen.queryByText(/showing the last loaded figures/)).toBeNull();
  expect(screen.queryByText('Open critical alerts')).toBeNull();
});

// the unknown-team check must still run before the plain-error return — a
// pivot-team click can hit either outcome depending on what the backend says about the new key,
// and only the unknown-team 400 gets its own explanatory page.
it('the unknown-team page still wins over the plain error line when both could apply', async () => {
  const orderFetchMock = jest.fn((url: string) => {
    if (url.includes('/summary')) {
      // The initial load (team=Z) succeeds; the pivot-row click below moves the summary key to
      // team=T1, which now 400s as an unknown team rather than 500ing.
      if (url.includes('team=T1')) {
        return Promise.resolve({ ok: false, status: 400, json: async () => ({ error: 'unknown team', known_teams: ['T1', 'T2'] }) } as any);
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => summaryWithPivotRow } as any);
    }
    if (url.includes('/trend')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ series: [] }) } as any);
    if (url.includes('/alerts')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ rows: [], totalCount: 0, truncated: false }) } as any);
    if (url.includes('/coverage')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ needsTagging: [], excludedByPolicy: [], unmeasured: [] }) } as any);
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) } as any);
  });
  (global as any).fetch = orderFetchMock;

  render(wrap(<VulnerabilitiesContent />));
  expect(await screen.findByText('T1')).toBeTruthy();
  expect(await screen.findByText(/0 alerts\./)).toBeTruthy();

  fireEvent.click(screen.getByText('T1'));

  expect(await screen.findByText('unknown team')).toBeTruthy();
  expect(screen.getByText(/Known teams: T1, T2/)).toBeTruthy();
  expect(screen.getByText('Clear team filter')).toBeTruthy();
});

it('a summary error with no data yet still shows the plain error line, not the normal page', async () => {
  const alwaysFailFetchMock = jest.fn((url: string) => {
    if (url.includes('/summary')) return Promise.resolve({ ok: false, status: 500, json: async () => ({ error: 'Internal Server Error' }) } as any);
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) } as any);
  });
  (global as any).fetch = alwaysFailFetchMock;
  render(wrap(<VulnerabilitiesContent />));
  expect(await screen.findByText("Couldn't load summary: Internal Server Error")).toBeTruthy();
  expect(screen.queryByPlaceholderText('Search CVE, GHSA, package, repo')).toBeNull();
});
