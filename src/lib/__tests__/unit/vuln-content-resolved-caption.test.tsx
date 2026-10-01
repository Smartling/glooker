/** @jest-environment jsdom */
// src/lib/__tests__/unit/vuln-content-resolved-caption.test.tsx
// the "Resolved critical …" KPI tile on vulnerabilities-content.tsx renders
// through format.ts's resolvedCaption — this covers its three caption states. (TeamPivot and
// PolicyPanel's own caption states are covered by vuln-team-pivot.test.tsx and
// vuln-policy-panel.test.tsx.) Mocking approach copied from vuln-content-b1.test.tsx (mocks `swr`
// directly, keyed by request URL, rather than a real fetch).
import React from 'react';
import { render, screen, within } from '@testing-library/react';

const urlStore: Record<string, unknown> = { codebase: 'backend', baseline: 'last', team: null, sev: 'critical' };
jest.mock('@/lib/url-state', () => ({
  __esModule: true,
  useUrlState: (schema: { key: string; default: unknown }) => [
    urlStore[schema.key] ?? schema.default,
    (next: unknown) => { urlStore[schema.key] = next; },
  ],
}));

type SwrEntry = { data?: unknown; error?: unknown; isLoading?: boolean };
let swrData: Record<string, SwrEntry> = {};
jest.mock('swr', () => ({
  __esModule: true,
  default: (key: string | null) => {
    if (!key) return { data: undefined, error: undefined, isLoading: false };
    const entry = swrData[Object.keys(swrData).find(k => key.startsWith(k)) ?? ''] ?? {};
    return { data: entry.data, error: entry.error, isLoading: entry.isLoading ?? false };
  },
}));

jest.mock('@/app/vulnerabilities/team-pivot', () => ({ __esModule: true, default: () => null }));
jest.mock('@/app/vulnerabilities/trend-chart', () => ({ __esModule: true, default: () => null }));
jest.mock('@/app/vulnerabilities/coverage-panel', () => ({ __esModule: true, default: () => null }));
jest.mock('@/app/vulnerabilities/policy-panel', () => ({ __esModule: true, default: () => null }));

import VulnerabilitiesContent from '@/app/vulnerabilities/vulnerabilities-content';

const baseSummary = {
  available: true, org: 'acme',
  sync: { stale: false, lastSuccessfulAt: '2026-09-22T06:00:00Z', lastStatus: 'succeeded', issues: [] },
  resolvedCountStartDate: '2020-01-08',
  resolvedCountInvalid: false,
  resolvedSince: { date: '2020-01-08', invalid: false },
  policy: [],
  slaStatus: { critical: 'none', high: 'none' },
  pivot: {
    rows: [],
    total: { team: 'Total', critical: { open: 12, resolved: 5, dismissed: 1, pctClosed: 30, overdue: null, dueSoon: null }, high: { open: 3, resolved: 1, dismissed: 0, pctClosed: 25, overdue: null, dueSoon: null }, unmeasuredRepos: 0 },
  },
  kpi: { openCriticalOtherCodebases: null },
  delta: { critical: { available: false }, high: { available: false } },
  knownTeams: [],
};

const alertsData = { rows: [], totalCount: 0, truncated: false };
const trendData = { series: [] };
const coverageData = { needsTagging: [] };

function setSummary(overrides: Record<string, unknown>) {
  swrData = {
    '/api/vulnerabilities/summary': { data: { ...baseSummary, ...overrides } },
    '/api/vulnerabilities/trend': { data: trendData },
    '/api/vulnerabilities/alerts': { data: alertsData },
    '/api/vulnerabilities/coverage': { data: coverageData },
  };
}

it('a real date renders "Resolved critical since <date>"', () => {
  setSummary({ resolvedSince: { date: '2020-01-08', invalid: false } });
  render(<VulnerabilitiesContent />);
  expect(screen.getByText('Resolved critical since 2020-01-08')).toBeTruthy();
});

it('date: null (VULN_RESOLVED_SINCE unset) renders "Resolved critical all time"', () => {
  setSummary({ resolvedSince: { date: null, invalid: false } });
  render(<VulnerabilitiesContent />);
  expect(screen.getByText('Resolved critical all time')).toBeTruthy();
});

it('invalid renders "Resolved critical since —", with the KPI tile\'s value, % closed and dismissed cells each pinned to —', () => {
  setSummary({
    resolvedSince: { date: null, invalid: true },
    // Mocks the real shape getSummary() returns when resolvedSinceInvalid: resolved, pctClosed
    // AND dismissed are all null (aggregate.ts's finish(), Finding 4 / fix round 2 — dismissed is a
    // subset of resolved, so an untrustworthy resolved count makes it untrustworthy too).
    pivot: { rows: [], total: { team: 'Total', critical: { open: 12, resolved: null, dismissed: null, pctClosed: null, overdue: null, dueSoon: null }, high: { open: 3, resolved: null, dismissed: null, pctClosed: null, overdue: null, dueSoon: null }, unmeasuredRepos: 0 } },
  });
  render(<VulnerabilitiesContent />);
  const caption = screen.getByText('Resolved critical since —');
  // The caption, the value line and the "% closed · N dismissed" line are the three direct
  // children of the same KPI tile <div> (vulnerabilities-content.tsx) — scope to that one tile
  // rather than the whole page, so this can't pass by matching a "—" that belongs to some other
  // panel.
  const tile = caption.parentElement as HTMLElement;
  // dash(crit.resolved) for the value line; dash(crit.pctClosed, '%') + dash(crit.dismissed) for
  // the sub-line. Pinning the exact strings proves both render through dash(), not a loose "some
  // — exists somewhere" check.
  expect(within(tile).getByText('—')).toBeTruthy();
  expect(within(tile).getByText('— closed · — dismissed')).toBeTruthy();
});

describe('delta baseline caption on the two critical KPI tiles', () => {
  const baseline = (takenOn: string) => ({ source: 'sync' as const, key: 'sync:1', takenOn, measuredAt: `${takenOn}T06:00:00Z` });
  const deltaTeam = { team: 'Total', deltaOpen: 2, new: 2, resolved: 0, dismissed: 0, reopened: 0, other: 0 };

  it('shows "vs <date>" on the Open critical alerts tile and the new/resolved/reopened tile when the delta is available', () => {
    setSummary({
      delta: {
        critical: { available: true, baseline: baseline('2099-01-01'), reposNotInBaseline: 0, teams: [], total: deltaTeam },
        high: { available: false },
      },
    });
    render(<VulnerabilitiesContent />);
    expect(screen.getAllByText('vs 2099-01-01').length).toBe(2);
  });

  it('shows no caption on either tile when the delta is unavailable', () => {
    setSummary({ delta: { critical: { available: false }, high: { available: false } } });
    render(<VulnerabilitiesContent />);
    expect(screen.queryByText(/^vs /)).toBeNull();
  });
});

it('carriedResolved > 0 but resolved null (invalid start date) never shows the † carried-over marker', () => {
  setSummary({
    resolvedSince: { date: null, invalid: true },
    // aggregate.ts's finish() nulls resolved/pctClosed/dismissed on resolvedSinceInvalid but
    // leaves carriedResolved a real number — the marker must key off resolved, not carriedResolved,
    // or an invalid start date would still show a carried-over count nobody can trust.
    pivot: { rows: [], total: { team: 'Total', critical: { open: 12, resolved: null, dismissed: null, pctClosed: null, overdue: null, dueSoon: null, carriedResolved: 7 }, high: { open: 3, resolved: null, dismissed: null, pctClosed: null, overdue: null, dueSoon: null, carriedResolved: 0 }, unmeasuredRepos: 0 } },
  });
  render(<VulnerabilitiesContent />);
  expect(screen.queryByText('†')).toBeNull();
});

// ---------------------------------------------------------------------------------------------
// Layout stability: KPI tiles 1 and 2 keep a fixed shape whether or not a delta exists. jsdom has
// no layout, so these guard structure and copy only; the acceptance harness (KPI grid row height
// per baseline switch) is the real check.
// ---------------------------------------------------------------------------------------------
describe('KPI tiles keep a fixed shape (caption slots always present)', () => {
  const baseline = (takenOn: string) => ({ source: 'sync' as const, key: 'sync:1', takenOn, measuredAt: `${takenOn}T06:00:00Z` });
  const deltaTeam = { team: 'Total', deltaOpen: 2, new: 2, resolved: 1, dismissed: 0, reopened: 0, other: 0 };
  const avail = (reposNotInBaseline: number, total: unknown = deltaTeam) => ({ available: true, baseline: baseline('2099-01-01'), reposNotInBaseline, teams: [], total });

  // Revert: render the tile-1 caption only when there is one (`{dcCaption && <div>…</div>}`).
  it('tile 1: kpi1-caption renders as an aria-hidden non-breaking space when the delta is unavailable, and holds "vs <date>" when it is available', () => {
    setSummary({ delta: { critical: { available: false }, high: { available: false } } });
    const { unmount } = render(<VulnerabilitiesContent />);
    const empty = screen.getByTestId('kpi1-caption');
    expect(empty.textContent).toBe('\u00a0');
    expect(empty.getAttribute('aria-hidden')).toBe('true');
    unmount();
    setSummary({ delta: { critical: avail(0), high: { available: false } } });
    render(<VulnerabilitiesContent />);
    expect(screen.getByTestId('kpi1-caption').textContent).toBe('vs 2099-01-01');
    expect(screen.getByTestId('kpi1-caption').hasAttribute('aria-hidden')).toBe(false);
  });

  // Case 1. Revert: join "N repos not in baseline" back onto the caption, or render the line
  // conditionally.
  it('tile 2, available with 0 repos not in baseline: the caption is exactly "vs 2099-01-01" and the baseline-repos line holds only a non-breaking space', () => {
    setSummary({ delta: { critical: avail(0), high: { available: false } } });
    render(<VulnerabilitiesContent />);
    expect(screen.getByTestId('kpi2-caption').textContent).toBe('vs 2099-01-01');
    expect(screen.getAllByText('vs 2099-01-01').length).toBe(2); // tile 1 and tile 2
    const repos = screen.getByTestId('kpi2-baseline-repos');
    expect(repos.textContent).toBe('\u00a0');
    expect(repos.getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByText('2 / 1 (0) / 0')).toBeTruthy();
  });

  // Case 2. Revert: fold the count back into the caption ("vs 2099-01-01 · 3 repos not in baseline")
  // or stop rendering it on its own line: the caption is no longer exactly "vs 2099-01-01".
  it('tile 2, available with 3 repos not in baseline: the caption is unchanged and the count sits on its own line', () => {
    setSummary({ delta: { critical: avail(3), high: { available: false } } });
    render(<VulnerabilitiesContent />);
    expect(screen.getByTestId('kpi2-caption').textContent).toBe('vs 2099-01-01');
    expect(screen.getByTestId('kpi2-baseline-repos').textContent).toBe('3 repos not in baseline');
    expect(screen.getByTestId('kpi2-baseline-repos').hasAttribute('aria-hidden')).toBe(false);
  });

  // Case 3. COPY CHANGE: the sentence moved from the tile body (with a leading "— ") into the caption slot.
  // Revert: put the sentence back in the tile body (the figure line then reads "— no measurement …",
  // not "—") or drop the caption's `title`.
  it('tile 2, unavailable with a baseline: figure "—" and caption "no measurement for this view before 2099-01-01"', () => {
    setSummary({ delta: { critical: { available: false, baseline: baseline('2099-01-01'), reposNotInBaseline: 0, teams: [], total: null }, high: { available: false } } });
    render(<VulnerabilitiesContent />);
    expect(screen.getByTestId('kpi2-caption').textContent).toBe('no measurement for this view before 2099-01-01');
    expect(screen.getByTestId('kpi2-caption').getAttribute('title')).toBe('no measurement for this view before 2099-01-01');
    const figure = screen.getByTestId('kpi2-caption').previousElementSibling as HTMLElement;
    expect(figure.textContent).toBe('—');
    expect(figure.className).toContain('truncate');
    expect(screen.getByTestId('kpi2-baseline-repos').textContent).toBe('\u00a0');
  });

  // Case 4. Revert: drop the `?? 'the chosen baseline'` fallback: the caption then reads
  // "no measurement for this view before undefined".
  it('tile 2, unavailable with baseline null: caption "no measurement for this view before the chosen baseline"', () => {
    setSummary({ delta: { critical: { available: false, baseline: null }, high: { available: false } } });
    render(<VulnerabilitiesContent />);
    expect(screen.getByTestId('kpi2-caption').textContent).toBe('no measurement for this view before the chosen baseline');
  });

  // Revert: choose the available branch on `dc.available` alone and dereference `dc.total`: a null
  // total then throws while rendering instead of taking the unavailable branch.
  it('tile 2, available but with a null total: takes the unavailable branch, using the baseline date', () => {
    setSummary({ delta: { critical: avail(0, null), high: { available: false } } });
    render(<VulnerabilitiesContent />);
    expect(screen.getByTestId('kpi2-caption').textContent).toBe('no measurement for this view before 2099-01-01');
    expect((screen.getByTestId('kpi2-caption').previousElementSibling as HTMLElement).textContent).toBe('—');
  });

  // REFACTOR GUARD, not a behaviour test: both branches render the same JSX, so this only fails if a
  // later refactor splits them and lets the classes drift (e.g. a different size class or dropped fixed
  // height on one branch). It cannot prove the tile does not resize; the acceptance harness does.
  it('tile 2: the figure line and both reserved lines have the same classes in the available and unavailable branches', () => {
    setSummary({ delta: { critical: avail(3), high: { available: false } } });
    const { unmount } = render(<VulnerabilitiesContent />);
    const cls = () => ['kpi2-caption', 'kpi2-baseline-repos'].map(id => screen.getByTestId(id).className)
      .concat([(screen.getByTestId('kpi2-caption').previousElementSibling as HTMLElement).className.replace(/text-(white|gray-500)/, '')]);
    const availableClasses = cls();
    unmount();
    setSummary({ delta: { critical: { available: false }, high: { available: false } } });
    render(<VulnerabilitiesContent />);
    expect(cls()).toEqual(availableClasses);
    for (const c of availableClasses) expect(c).toMatch(/h-(4|7)/);
  });

  // Revert: drop `truncate` (or the `title`) from the figure line, or render "· other ±N" outside it.
  it('tile 2: "· other ±N" cannot force a second line: the figure line truncates and its title holds the full text', () => {
    setSummary({ delta: { critical: avail(0, { ...deltaTeam, other: 4 }), high: { available: false } } });
    render(<VulnerabilitiesContent />);
    const figure = screen.getByTestId('kpi2-caption').previousElementSibling as HTMLElement;
    expect(figure.className).toContain('truncate');
    expect(figure.getAttribute('title')).toBe('2 / 1 (0) / 0 · other +4');
    expect(figure.textContent).toBe('2 / 1 (0) / 0 · other +4');
  });
});
