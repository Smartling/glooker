/** @jest-environment jsdom */
// src/lib/__tests__/unit/vuln-content-team-line.test.tsx
// Layout stability (GLOOK-43 follow-up): the "Filtered to team" line used to render only when a team
// was set, pushing everything below it down (and, near the bottom of the page, making the browser
// clamp the scroll position) on every team change. It now always renders, at a fixed height, with
// identical classes in both states. jsdom has no layout engine, so this guards structure and copy;
// the acceptance harness (scrollHeight per team change) is the real check. Reactive next/navigation
// mock copied from vuln-content-scroll.test.tsx.
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { SWRConfig } from 'swr';
import VulnerabilitiesContent from '@/app/vulnerabilities/vulnerabilities-content';

const wrap = (ui: React.ReactNode) => <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig>;

jest.mock('next/navigation', () => {
  const ReactLib = require('react');
  let currentSearch = '';
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((l: () => void) => l());
  const navigate = (url: string) => { currentSearch = url.includes('?') ? url.split('?')[1] : ''; notify(); };
  return {
    useRouter: () => ({
      push: (url: string) => navigate(url),
      replace: (url: string) => navigate(url),
    }),
    useSearchParams: () => {
      const [, force] = ReactLib.useReducer((c: number) => c + 1, 0);
      ReactLib.useEffect(() => { listeners.add(force); return () => { listeners.delete(force); }; }, []);
      return new URLSearchParams(currentSearch);
    },
    usePathname: () => '/vulnerabilities',
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
  (jest.requireMock('next/navigation') as any).__resetSearch('');
  (global as any).fetch = makeFetchMock();
});

// Revert: render the line only when a team is set (`{team && <div …>}`).
it('with no team the line reads "Showing all teams" and has no clear button', async () => {
  render(wrap(<VulnerabilitiesContent />));
  const line = await screen.findByTestId('team-line');
  expect(line.textContent).toBe('Showing all teams');
  expect(within(line).queryByRole('button')).toBeNull();
});

// COPY CHANGE: "Showing all teams" is new; "Filtered to team X" + clear is the old text, now inline
// in a fixed-height line. Revert: drop the `h-4` / nowrap classes or the always-on line.
it('with a team the line reads "Filtered to team Team A" plus a clear button, with the same className as the no-team line', async () => {
  render(wrap(<VulnerabilitiesContent />));
  const line = await screen.findByTestId('team-line');
  const noTeamClass = line.className;
  fireEvent.change(await screen.findByLabelText('Team'), { target: { value: 'Team A' } });
  await waitFor(() => expect(screen.getByTestId('team-line').textContent).toBe('Filtered to team Team Aclear'));
  const withTeam = screen.getByTestId('team-line');
  expect(withTeam.textContent).toContain('Filtered to team Team A');
  expect(within(withTeam).getByRole('button', { name: 'clear' })).toBeTruthy();
  expect(withTeam.className).toBe(noTeamClass);
  expect(withTeam.className).toContain('h-4');
  expect(withTeam.className).toContain('whitespace-nowrap');
});

// Revert: drop `truncate` from the team name, or `shrink-0` from the clear button (a long name would
// then wrap the line, or squeeze the button out).
it('the team name truncates (title holds the full name) and the clear button never shrinks', async () => {
  render(wrap(<VulnerabilitiesContent />));
  fireEvent.change(await screen.findByLabelText('Team'), { target: { value: 'Team A' } });
  await waitFor(() => expect(screen.getByTestId('team-line').textContent).toContain('Filtered to team'));
  const line = screen.getByTestId('team-line');
  const name = within(line).getByText('Team A');
  expect(name.className).toContain('truncate');
  expect(name.getAttribute('title')).toBe('Team A');
  expect(within(line).getByRole('button', { name: 'clear' }).className).toContain('shrink-0');
});

// Revert: make the clear button a no-op, or drop it from the team branch of the line (the line then
// stays on "Filtered to team Team A", or the button is never found).
it('the clear button returns the line to "Showing all teams"', async () => {
  render(wrap(<VulnerabilitiesContent />));
  fireEvent.change(await screen.findByLabelText('Team'), { target: { value: 'Team A' } });
  const clear = await waitFor(() => within(screen.getByTestId('team-line')).getByRole('button', { name: 'clear' }));
  fireEvent.click(clear);
  await waitFor(() => expect(screen.getByTestId('team-line').textContent).toBe('Showing all teams'));
});
