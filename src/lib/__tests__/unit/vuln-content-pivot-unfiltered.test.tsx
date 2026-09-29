/** @jest-environment jsdom */
// src/lib/__tests__/unit/vuln-content-pivot-unfiltered.test.tsx
// GLOOK-43 follow-up: selecting a team used to re-scope the "By team" pivot down to just that
// team's row + Total, which both defeated the point of the selected-row highlight (nothing else
// left to compare it against) and shrank the page enough to move the scroll position — the second
// contributor to the "page jumps on team select" bug, alongside the trend panel's empty-state
// collapse (covered in vuln-trend-chart.test.tsx). The pivot now fetches its own unfiltered
// (no `team` param) summary and renders from that, while every other panel stays team-scoped.
// Reactive next/navigation mock copied from vuln-content-scroll.test.tsx.
import React from 'react';
import { render, screen, waitFor, within, act } from '@testing-library/react';
import { SWRConfig } from 'swr';
import VulnerabilitiesContent from '@/app/vulnerabilities/vulnerabilities-content';

const wrap = (ui: React.ReactNode) => <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig>;

const mockPathname = '/vulnerabilities';

jest.mock('next/navigation', () => {
  const ReactLib = require('react');
  let currentSearch = '';
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

const baseFields = {
  sync: { stale: false, lastSuccessfulAt: '2026-09-22T06:00:00Z', lastStatus: 'succeeded', issues: [] },
  resolvedCountStartDate: '2020-01-08',
  resolvedCountInvalid: false,
  resolvedSince: { date: '2020-01-08', invalid: false },
  scope: { property: 'service_tier', value: 'production' },
  slaPolicyInvalid: false,
  policy: [{ id: 'critical-2020-01', severity: 'critical', effectiveFrom: '2020-01-08', days: 9, pending: false, until: null }],
  slaStatus: { critical: 'active', high: 'none' },
  kpi: { openCriticalOtherCodebases: null },
  delta: { critical: { available: false }, high: { available: false } },
  knownTeams: ['Team A', 'Team B'],
};

const cell = (open: number) => ({ open, resolved: 0, dismissed: 0, pctClosed: 0, overdue: 0, dueSoon: 0, carriedResolved: 0 });

// The two responses carry DIFFERENT deltas (different baseline dates and values), so a test can tell
// which response fed the pivot's Δ header and cells and which fed the KPI tile.
const baselineOf = (takenOn: string) => ({ source: 'sync' as const, key: `sync:${takenOn}`, takenOn, measuredAt: `${takenOn}T06:00:00Z` });
const deltaRow = (team: string, deltaOpen: number) => ({ team, deltaOpen, new: 0, resolved: 0, dismissed: 0, reopened: 0, other: 0 });
const unfilteredDelta = {
  critical: { available: true, baseline: baselineOf('2099-01-01'), reposNotInBaseline: 0, teams: [deltaRow('Team A', 5), deltaRow('Team B', 2)], total: deltaRow('Total', 7) },
  high: { available: false },
};
const teamScopedDelta = {
  critical: { available: true, baseline: baselineOf('2099-02-02'), reposNotInBaseline: 0, teams: [deltaRow('Team A', 1)], total: deltaRow('Total', 1) },
  high: { available: false },
};

// Unfiltered (no `team` param): every team's row.
const unfilteredSummary = {
  ...baseFields, available: true, org: 'o', delta: unfilteredDelta,
  pivot: {
    rows: [
      { team: 'Team A', critical: cell(3), high: cell(1), unmeasuredRepos: 0 },
      { team: 'Team B', critical: cell(7), high: cell(2), unmeasuredRepos: 0 },
    ],
    total: { team: 'Total', critical: cell(10), high: cell(3), unmeasuredRepos: 0 },
  },
};

// Team-scoped (?team=Team A): a single row, and a KPI figure distinct from the unfiltered total's
// so the test can tell which response fed the KPI tile vs. the pivot.
const teamScopedSummary = {
  ...baseFields, available: true, org: 'o', delta: teamScopedDelta,
  pivot: {
    rows: [{ team: 'Team A', critical: cell(3), high: cell(1), unmeasuredRepos: 0 }],
    total: { team: 'Total', critical: cell(3), high: cell(1), unmeasuredRepos: 0 },
  },
};

function makeFetchMock() {
  return jest.fn((url: string) => {
    if (url.includes('/summary')) {
      const body = url.includes('team=') ? teamScopedSummary : unfilteredSummary;
      return Promise.resolve({ ok: true, status: 200, json: async () => body } as any);
    }
    if (url.includes('/trend')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ series: [] }) } as any);
    if (url.includes('/alerts')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ rows: [], totalCount: 0, truncated: false, repos: [] }) } as any);
    if (url.includes('/coverage')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ needsTagging: [], excludedByPolicy: [], unmeasured: [] }) } as any);
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) } as any);
  });
}

beforeEach(() => {
  (jest.requireMock('next/navigation') as any).__resetSearch('');
});

// Revert: build the pivot from the team-scoped summary (`s`) instead of the unfiltered one: the
// pivot collapses to Team A's row and the Team B assertions fail.
it('with a team selected via the URL, the pivot still lists every team while the KPI tile shows the team-scoped number', async () => {
  (jest.requireMock('next/navigation') as any).__resetSearch('team=Team+A');
  const fetchMock = makeFetchMock();
  (global as any).fetch = fetchMock;
  render(wrap(<VulnerabilitiesContent />));

  // Pivot: both teams' rows present (unfiltered response), not collapsed to just Team A.
  // 'Team A'/'Team B' also render as <option>s in the alerts Team <select> — scope to the pivot
  // table's <td>.
  const pivotCell = (team: string) => waitFor(() => {
    const matches = screen.getAllByText(team).filter(el => el.tagName === 'TD');
    expect(matches.length).toBe(1);
    return matches[0];
  });
  const teamACell = await pivotCell('Team A');
  const teamBCell = await pivotCell('Team B');
  const teamARow = teamACell.closest('tr')!;
  const teamBRow = teamBCell.closest('tr')!;
  // Selected row highlighted (TeamPivot's selectedTeam styling).
  expect(teamARow.className).toContain('bg-indigo-500/10');
  expect(teamBRow.className).not.toContain('bg-indigo-500/10');

  // KPI tile: the team-scoped critical-open count (3), not the unfiltered total (10).
  const kpiTile = screen.getByText('Open critical alerts').parentElement!;
  expect(within(kpiTile).getByText('3')).toBeTruthy();
  expect(within(kpiTile).queryByText('10')).toBeNull();
});

// Revert: drop the `pivotSummary?.pivot ? pivotSummary : s` fallback (render nothing until the
// unfiltered request resolves): the pivot is empty and the Team A assertion fails.
// The pivot's Δ header and cells must come from the SAME unfiltered response as its rows. Revert: pass
// `s.delta` (the team-scoped summary's delta) to TeamPivot instead of `pivotView.delta`: the header reads
// "vs 2099-02-02" and Team A's Δ reads +1 (and Team B / Total lose theirs).
it('with a team selected, the pivot Δ caption and cells follow the unfiltered response while KPI tile 1 follows the team-scoped one', async () => {
  (jest.requireMock('next/navigation') as any).__resetSearch('team=Team+A');
  (global as any).fetch = makeFetchMock();
  render(wrap(<VulnerabilitiesContent />));

  const pivotRow = async (team: string) => (await waitFor(() => {
    const matches = screen.getAllByText(team).filter(el => el.tagName === 'TD');
    expect(matches.length).toBe(1);
    return matches[0];
  })).closest('tr')!;
  const rowA = await pivotRow('Team A');
  const rowB = await pivotRow('Team B');
  const rowTotal = await pivotRow('Total');
  // cells: [team, crit-open, crit-Δ, ...]
  await waitFor(() => expect(rowA.querySelectorAll('td')[2].textContent).toBe('+5'));
  expect(rowB.querySelectorAll('td')[2].textContent).toBe('+2');
  expect(rowTotal.querySelectorAll('td')[2].textContent).toBe('+7');
  expect(screen.getByTestId('pivot-delta-caption-critical').textContent).toBe('vs 2099-01-01');
  // KPI tile 1 is fed by the team-scoped summary: its own baseline date and Total delta
  expect(screen.getByTestId('kpi1-caption').textContent).toBe('vs 2099-02-02');
  const kpiTile = screen.getByText('Open critical alerts').parentElement!;
  expect(within(kpiTile).getByText('+1')).toBeTruthy();
});

it('deep link with ?team= already set: while the unfiltered request is still pending, the pivot falls back to the (team-scoped) main summary instead of showing nothing', async () => {
  (jest.requireMock('next/navigation') as any).__resetSearch('team=Team+A');
  const fetchMock = jest.fn((url: string) => {
    if (url.includes('/summary')) {
      // The unfiltered request never resolves in this test — simulates the window between mount
      // and its first response.
      if (!url.includes('team=')) return new Promise(() => {});
      return Promise.resolve({ ok: true, status: 200, json: async () => teamScopedSummary } as any);
    }
    if (url.includes('/trend')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ series: [] }) } as any);
    if (url.includes('/alerts')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ rows: [], totalCount: 0, truncated: false, repos: [] }) } as any);
    if (url.includes('/coverage')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ needsTagging: [], excludedByPolicy: [], unmeasured: [] }) } as any);
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) } as any);
  });
  (global as any).fetch = fetchMock;
  render(wrap(<VulnerabilitiesContent />));

  // The KPI tile (fed by the team-scoped main summary) has resolved…
  await waitFor(() => {
    const kpiTile = screen.getByText('Open critical alerts').parentElement!;
    expect(within(kpiTile).getByText('3')).toBeTruthy();
  });
  // …but the pivot (fed by the still-pending unfiltered summary) falls back to that same
  // team-scoped response: only Team A's row, not Team B's.
  expect(screen.getAllByText('Team A').filter(el => el.tagName === 'TD').length).toBe(1);
  expect(screen.queryAllByText('Team B').filter(el => el.tagName === 'TD').length).toBe(0);
});

it('when the unfiltered request errors, the pivot panel shows the error text and the rest of the page still renders', async () => {
  // A team must be selected so the main (team-scoped) summary key differs from the pivot's
  // unfiltered key — otherwise SWR would dedupe them to the one, erroring, key and the whole page
  // (not just the pivot) would fail.
  (jest.requireMock('next/navigation') as any).__resetSearch('team=Team+A');
  const fetchMock = jest.fn((url: string) => {
    if (url.includes('/summary')) {
      if (!url.includes('team=')) return Promise.resolve({ ok: false, status: 500, json: async () => ({ error: 'boom' }) } as any);
      return Promise.resolve({ ok: true, status: 200, json: async () => teamScopedSummary } as any);
    }
    if (url.includes('/trend')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ series: [] }) } as any);
    if (url.includes('/alerts')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ rows: [], totalCount: 0, truncated: false, repos: [] }) } as any);
    if (url.includes('/coverage')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ needsTagging: [], excludedByPolicy: [], unmeasured: [] }) } as any);
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) } as any);
  });
  (global as any).fetch = fetchMock;
  render(wrap(<VulnerabilitiesContent />));

  await waitFor(() => {
    expect(screen.getByText(/Couldn't load team table: boom/)).toBeTruthy();
  });
  // The rest of the page still renders — the KPI tile (fed by the main, unaffected summary) is up.
  expect(screen.getByText('Open critical alerts')).toBeTruthy();
});

// Revert: make the pivot's request key differ from the main summary's when no team is set (e.g. a
// different param order or extra param): two summary requests go out.
it('with no team selected, only one summary request is made (the two SWR keys are identical and dedupe)', async () => {
  const fetchMock = makeFetchMock();
  (global as any).fetch = fetchMock;
  render(wrap(<VulnerabilitiesContent />));

  await waitFor(() => {
    expect(screen.getAllByText('Team A').some(el => el.tagName === 'TD')).toBe(true);
  });
  // Flush a macrotask first: a duplicate summary request started in the same commit would otherwise
  // not have reached fetch yet when the calls are counted.
  await act(async () => { await new Promise(r => setTimeout(r, 0)); });
  const summaryUrls = fetchMock.mock.calls.map(([u]) => u as string).filter(u => u.includes('/summary'));
  expect(summaryUrls.length).toBe(1);
  expect(new Set(summaryUrls).size).toBe(1);
  expect(summaryUrls[0]).not.toContain('team=');
});
