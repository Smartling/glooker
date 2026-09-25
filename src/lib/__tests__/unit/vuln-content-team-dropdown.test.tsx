/** @jest-environment jsdom */
// src/lib/__tests__/unit/vuln-content-team-dropdown.test.tsx
// the page-wide `team` URL state (set by clicking a pivot row) already filters alerts, but
// the alerts panel had no control for it. A <select> in the alerts filter bar is now bound to the
// SAME `team` state — no separate alerts-only team state — via `setTeam`/`useUrlState`.
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import VulnerabilitiesContent from '@/app/vulnerabilities/vulnerabilities-content';

const wrap = (ui: React.ReactNode) => <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig>;

const mockPathname = '/vulnerabilities';

// Same reactive next/navigation mock used by vuln-content-error.test.tsx: push/replace record the
// new query string and notify subscribers, so a setTeam() call actually swaps the SWR keys.
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

function urlTeam(u: string): string | null {
  return new URL(u, 'http://x').searchParams.get('team');
}

function makeFetchMock() {
  return jest.fn((url: string) => {
    if (url.includes('/summary')) return Promise.resolve({ ok: true, status: 200, json: async () => validSummary } as any);
    if (url.includes('/trend')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ series: [] }) } as any);
    if (url.includes('/alerts')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ rows: [], totalCount: 0, truncated: false, repos: [] }) } as any);
    if (url.includes('/coverage')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ needsTagging: [], excludedByPolicy: [], unmeasured: [] }) } as any);
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) } as any);
  });
}

beforeEach(() => {
  (jest.requireMock('next/navigation') as any).__resetSearch('');
});

it('choosing a team in the dropdown puts team=<name> into the alerts, summary and coverage requests', async () => {
  const fetchMock = makeFetchMock();
  (global as any).fetch = fetchMock;
  render(wrap(<VulnerabilitiesContent />));

  const select = await screen.findByLabelText('Team') as HTMLSelectElement;
  fireEvent.change(select, { target: { value: 'Team A' } });

  await waitFor(() => {
    const alertsUrls = fetchMock.mock.calls.map(([u]) => u as string).filter(u => u.includes('/alerts'));
    expect(alertsUrls.some(u => urlTeam(u) === 'Team A')).toBe(true);
  });
  const summaryUrls = fetchMock.mock.calls.map(([u]) => u as string).filter(u => u.includes('/summary'));
  const coverageUrls = fetchMock.mock.calls.map(([u]) => u as string).filter(u => u.includes('/coverage'));
  expect(summaryUrls.some(u => urlTeam(u) === 'Team A')).toBe(true);
  expect(coverageUrls.some(u => urlTeam(u) === 'Team A')).toBe(true);
});

it('"All teams" removes the team filter, the same effect as clicking "clear" after a pivot-row click', async () => {
  (jest.requireMock('next/navigation') as any).__resetSearch('team=Team+A');
  const fetchMock = makeFetchMock();
  (global as any).fetch = fetchMock;
  render(wrap(<VulnerabilitiesContent />));

  const select = await screen.findByLabelText('Team') as HTMLSelectElement;
  expect(select.value).toBe('Team A');
  fireEvent.change(select, { target: { value: '' } });

  await waitFor(() => {
    const alertsUrls = fetchMock.mock.calls.map(([u]) => u as string).filter(u => u.includes('/alerts'));
    expect(alertsUrls.some(u => urlTeam(u) === null)).toBe(true);
  });
});

it('the dropdown shows the team already selected via the URL', async () => {
  (jest.requireMock('next/navigation') as any).__resetSearch('team=Team+B');
  const fetchMock = makeFetchMock();
  (global as any).fetch = fetchMock;
  render(wrap(<VulnerabilitiesContent />));

  const select = await screen.findByLabelText('Team') as HTMLSelectElement;
  expect(select.value).toBe('Team B');
});
