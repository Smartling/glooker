/** @jest-environment jsdom */
// src/lib/__tests__/unit/vuln-content-trend-range.test.tsx
// timeframe chips (30 days · 90 days · 1 year · All) next to Critical | High on the trend
// panel. The choice lives in URL state `range` (default 'all', history: 'replace'); anything
// other than 'all' adds `&since=YYYY-MM-DD` (today minus 30/90/365 days, UTC) to the trend
// request. `all` sends nothing.
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import VulnerabilitiesContent, { trendSince } from '@/app/vulnerabilities/vulnerabilities-content';

const wrap = (ui: React.ReactNode) => <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig>;

const mockPathname = '/vulnerabilities';

jest.mock('next/navigation', () => {
  const ReactLib = require('react');
  let currentSearch = '';
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((l: () => void) => l());
  const navigate = (url: string) => { currentSearch = url.includes('?') ? url.split('?')[1] : ''; notify(); };
  const replaceSpy = jest.fn((url: string) => { navigate(url); });
  return {
    useRouter: () => ({
      push: (url: string) => { navigate(url); },
      replace: replaceSpy,
    }),
    useSearchParams: () => {
      const [, force] = ReactLib.useReducer((c: number) => c + 1, 0);
      ReactLib.useEffect(() => { listeners.add(force); return () => { listeners.delete(force); }; }, []);
      return new URLSearchParams(currentSearch);
    },
    usePathname: () => mockPathname,
    __resetSearch: (qs: string) => { currentSearch = qs; notify(); },
    __replaceSpy: replaceSpy,
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
  knownTeams: [],
};

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

it('trendSince: "all" is null; 30d/90d/1y are today minus 30/90/365 days, UTC', () => {
  const now = new Date('2026-09-23T12:34:56Z');
  expect(trendSince('all', now)).toBeNull();
  expect(trendSince('30d', now)).toBe('2026-08-24');
  expect(trendSince('90d', now)).toBe('2026-06-25');
  expect(trendSince('1y', now)).toBe('2025-09-23');
});

it('defaults to "all" and sends no since on the trend request', async () => {
  const fetchMock = makeFetchMock();
  (global as any).fetch = fetchMock;
  render(wrap(<VulnerabilitiesContent />));
  await screen.findByText('90 days');
  await waitFor(() => {
    const trendUrls = fetchMock.mock.calls.map(([u]) => u as string).filter(u => u.includes('/trend'));
    expect(trendUrls.length).toBeGreaterThan(0);
  });
  const trendUrls = fetchMock.mock.calls.map(([u]) => u as string).filter(u => u.includes('/trend'));
  expect(trendUrls.every(u => !u.includes('since='))).toBe(true);
});

it('clicking "90 days" sends since=<today-90d, UTC> and sets range=90d in the URL', async () => {
  const fetchMock = makeFetchMock();
  (global as any).fetch = fetchMock;
  render(wrap(<VulnerabilitiesContent />));
  const btn = await screen.findByText('90 days');
  // Computed the same way vulnerabilities-content.tsx computes it, at test time — avoids fake
  // timers interacting with SWR/RTL's async waiting.
  const expectedSince = trendSince('90d', new Date());
  fireEvent.click(btn);

  await waitFor(() => {
    const trendUrls = fetchMock.mock.calls.map(([u]) => u as string).filter(u => u.includes('/trend'));
    expect(trendUrls.some(u => u.includes(`since=${expectedSince}`))).toBe(true);
  });
  const { __replaceSpy } = jest.requireMock('next/navigation') as any;
  expect(__replaceSpy.mock.calls.some(([u]: [string]) => u.includes('range=90d'))).toBe(true);
});
