/** @jest-environment jsdom */
// src/lib/__tests__/unit/vuln-content-scroll.test.tsx
// GLOOK-43 follow-up: every URL-state write on this page opted into `scroll: false` (see
// url-state.ts), because Next's default `router.push`/`replace` scrolls the window to the top —
// selecting a team via the alerts dropdown or the "By team" pivot row used to jump the page up. A
// hook-level test alone can't prove the page actually opted in, so this records the second
// argument the page's setters pass to push/replace. Reactive next/navigation mock copied from
// vuln-content-team-dropdown.test.tsx, extended to also record push/replace's second argument.
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import VulnerabilitiesContent from '@/app/vulnerabilities/vulnerabilities-content';

const wrap = (ui: React.ReactNode) => <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig>;

const mockPathname = '/vulnerabilities';
const pushMock = jest.fn();
const replaceMock = jest.fn();

jest.mock('next/navigation', () => {
  const ReactLib = require('react');
  let currentSearch = '';
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((l: () => void) => l());
  const navigate = (url: string) => { currentSearch = url.includes('?') ? url.split('?')[1] : ''; notify(); };
  return {
    useRouter: () => ({
      push: (url: string, opts?: unknown) => { pushMock(url, opts); navigate(url); },
      replace: (url: string, opts?: unknown) => { replaceMock(url, opts); navigate(url); },
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
    rows: [
      { team: 'Team A', critical: { open: 3, resolved: 1, dismissed: 0, pctClosed: 25, overdue: 0, dueSoon: 0, carriedResolved: 0 }, high: { open: 1, resolved: 0, dismissed: 0, pctClosed: 0, overdue: null, dueSoon: null, carriedResolved: 0 }, unmeasuredRepos: 0 },
    ],
    total: { team: 'Total', critical: { open: 3, resolved: 1, dismissed: 0, pctClosed: 25, overdue: 0, dueSoon: 0, carriedResolved: 0 }, high: { open: 1, resolved: 0, dismissed: 0, pctClosed: 0, overdue: null, dueSoon: null, carriedResolved: 0 }, unmeasuredRepos: 0 },
  },
  kpi: { openCriticalOtherCodebases: null },
  delta: { critical: { available: false }, high: { available: false } },
  knownTeams: ['Team A', 'Team B'],
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
  pushMock.mockClear();
  replaceMock.mockClear();
  (jest.requireMock('next/navigation') as any).__resetSearch('');
});

it('choosing a team in the alerts Team dropdown replaces the URL with scroll: false', async () => {
  const fetchMock = makeFetchMock();
  (global as any).fetch = fetchMock;
  render(wrap(<VulnerabilitiesContent />));

  const select = await screen.findByLabelText('Team') as HTMLSelectElement;
  fireEvent.change(select, { target: { value: 'Team A' } });

  await waitFor(() => {
    expect(replaceMock).toHaveBeenCalledWith(expect.stringContaining('team=Team'), { scroll: false });
  });
});

it('clicking a team row in the "By team" pivot replaces the URL with scroll: false', async () => {
  const fetchMock = makeFetchMock();
  (global as any).fetch = fetchMock;
  render(wrap(<VulnerabilitiesContent />));

  // 'Team A' also appears as an <option> in the alerts Team <select> — scope to the pivot table's <td>.
  const teamCell = await waitFor(() => {
    const matches = screen.getAllByText('Team A').filter(el => el.tagName === 'TD');
    expect(matches.length).toBe(1);
    return matches[0];
  });
  fireEvent.click(teamCell);

  await waitFor(() => {
    expect(replaceMock).toHaveBeenCalledWith(expect.stringContaining('team=Team'), { scroll: false });
  });
});

/**
 * One replace call per control, keyed to that control's own query param — never "the last call" or
 * "any call" — since another control's write earlier in the same test could otherwise satisfy the
 * assertion. Each picks a non-default value so its key actually appears in the URL (the default is
 * omitted by writeValueIntoParams). "30 days" is ambiguous (both a baseline and a range chip label),
 * so baseline uses "7 days" and range uses "90 days"; "High" collides with the "HIGH" band header
 * text, so severity is queried by role.
 */
it('choosing a non-default codebase chip replaces the URL with scroll: false', async () => {
  const fetchMock = makeFetchMock();
  (global as any).fetch = fetchMock;
  render(wrap(<VulnerabilitiesContent />));

  const frontendChip = await screen.findByRole('button', { name: 'Frontend' });
  fireEvent.click(frontendChip);

  await waitFor(() => {
    const call = replaceMock.mock.calls.find(([url]) => (url as string).includes('codebase=frontend'));
    expect(call).toBeTruthy();
    expect(call![1]).toEqual({ scroll: false });
  });
});

it('choosing a non-default baseline chip ("7 days") replaces the URL with scroll: false', async () => {
  const fetchMock = makeFetchMock();
  (global as any).fetch = fetchMock;
  render(wrap(<VulnerabilitiesContent />));

  const sevenDaysChip = await screen.findByRole('button', { name: '7 days' });
  fireEvent.click(sevenDaysChip);

  await waitFor(() => {
    const call = replaceMock.mock.calls.find(([url]) => (url as string).includes('baseline=7d'));
    expect(call).toBeTruthy();
    expect(call![1]).toEqual({ scroll: false });
  });
});

it('choosing the non-default "High" severity chip replaces the URL with scroll: false', async () => {
  const fetchMock = makeFetchMock();
  (global as any).fetch = fetchMock;
  render(wrap(<VulnerabilitiesContent />));

  const highChip = await screen.findByRole('button', { name: 'High' });
  fireEvent.click(highChip);

  await waitFor(() => {
    const call = replaceMock.mock.calls.find(([url]) => (url as string).includes('sev=high'));
    expect(call).toBeTruthy();
    expect(call![1]).toEqual({ scroll: false });
  });
});

it('choosing a non-default range chip ("90 days") replaces the URL with scroll: false', async () => {
  const fetchMock = makeFetchMock();
  (global as any).fetch = fetchMock;
  render(wrap(<VulnerabilitiesContent />));

  const ninetyDaysChip = await screen.findByRole('button', { name: '90 days' });
  fireEvent.click(ninetyDaysChip);

  await waitFor(() => {
    const call = replaceMock.mock.calls.find(([url]) => (url as string).includes('range=90d'));
    expect(call).toBeTruthy();
    expect(call![1]).toEqual({ scroll: false });
  });
});
