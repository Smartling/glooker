/** @jest-environment jsdom */
// src/lib/__tests__/unit/vuln-content-repo-reset.test.tsx
// alertFilters.repo is local alert-filter state (not URL, not page-wide), but it must be
// reset whenever the page-wide `team` or `codebase` changes — and the very NEXT alerts request
// already has to reflect that, not one request later (an effect-based reset would let a stale
// `team=<new>&repo=<old>` request go out first).
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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

const validSummary = {
  available: true, org: 'o',
  sync: { stale: false, lastSuccessfulAt: '2026-09-22T06:00:00Z', lastStatus: 'succeeded', issues: [] },
  resolvedCountStartDate: '2020-01-08',
  resolvedCountInvalid: false,
  resolvedSince: { date: '2020-01-08', invalid: false },
  scope: { property: 'service_tier', value: 'production' },
  slaPolicyInvalid: false,
  policy: [{ id: 'critical-2020-01', severity: 'critical', effectiveFrom: '2020-01-08', days: 9, pending: false, until: null }],
  slaStatus: { critical: 'active', high: 'none' },
  pivot: {
    rows: [],
    total: { team: 'Total', critical: { open: 1, resolved: 0, dismissed: 0, pctClosed: 0, overdue: 0, dueSoon: 0 }, high: { open: 0, resolved: 0, dismissed: 0, pctClosed: 0, overdue: 0, dueSoon: 0 }, unmeasuredRepos: 0 },
  },
  kpi: { openCriticalOtherCodebases: null },
  delta: { critical: { available: false }, high: { available: false } },
  knownTeams: ['Team A', 'Team B'],
};

function urlParam(u: string, name: string): string | null {
  return new URL(u, 'http://x').searchParams.get(name);
}

beforeEach(() => {
  (jest.requireMock('next/navigation') as any).__resetSearch('');
});

it('changing the team clears repo from the very next alerts request', async () => {
  const fetchMock = jest.fn((url: string) => {
    if (url.includes('/summary')) return Promise.resolve({ ok: true, status: 200, json: async () => validSummary } as any);
    if (url.includes('/trend')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ series: [] }) } as any);
    if (url.includes('/alerts')) {
      return Promise.resolve({
        ok: true, status: 200,
        json: async () => ({ rows: [], totalCount: 0, truncated: false, repos: [{ repo: 'acme/one', count: 1 }] }),
      } as any);
    }
    if (url.includes('/coverage')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ needsTagging: [], excludedByPolicy: [], unmeasured: [] }) } as any);
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) } as any);
  });
  (global as any).fetch = fetchMock;
  render(wrap(<VulnerabilitiesContent />));

  const repoSelect = await screen.findByLabelText('Repo') as HTMLSelectElement;
  await waitFor(() => expect(repoSelect.options.length).toBeGreaterThan(1));
  fireEvent.change(repoSelect, { target: { value: 'acme/one' } });
  await waitFor(() => {
    const alertsUrls = fetchMock.mock.calls.map(([u]) => u as string).filter(u => u.includes('/alerts'));
    expect(alertsUrls.some(u => urlParam(u, 'repo') === 'acme/one')).toBe(true);
  });

  const teamSelect = screen.getByLabelText('Team') as HTMLSelectElement;
  fireEvent.change(teamSelect, { target: { value: 'Team A' } });

  await waitFor(() => {
    const alertsUrls = fetchMock.mock.calls.map(([u]) => u as string).filter(u => u.includes('/alerts'));
    expect(alertsUrls.some(u => urlParam(u, 'team') === 'Team A')).toBe(true);
  });
  const alertsUrls = fetchMock.mock.calls.map(([u]) => u as string).filter(u => u.includes('/alerts'));
  // The FIRST alerts request whose team is the new one must already have no repo — an
  // effect-based reset would let this one still carry the stale repo, only clearing it a request
  // later.
  const firstWithNewTeam = alertsUrls.find(u => urlParam(u, 'team') === 'Team A');
  expect(firstWithNewTeam).toBeTruthy();
  expect(urlParam(firstWithNewTeam as string, 'repo')).toBeNull();
});
