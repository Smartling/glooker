/** @jest-environment jsdom */
// Org in the header, deltaClass on the KPI-1 delta, the
// alerts-panel subtitle, and the stale-rows indicator while `alerts` is isValidating.
//
// Mocks `swr` directly (keyed by the exact request URL) rather than letting real SWR run
// against a mocked `fetch`, because item 4 needs precise control over `isValidating` that a
// real fetch/timing dance can't give cheaply. Precedent: projects-board-transition.test.tsx.
import React from 'react';
import { render, screen } from '@testing-library/react';

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
  policy: [{ id: 'critical-2020-01', severity: 'critical', effectiveFrom: '2020-01-08', days: 9 }],
  slaStatus: { critical: 'active', high: 'none' },
  pivot: {
    rows: [],
    total: { team: 'Total', critical: { open: 12, resolved: 5, dismissed: 1, pctClosed: 30, overdue: 2, dueSoon: 1 }, high: { open: 3, resolved: 1, dismissed: 0, pctClosed: 25, overdue: null, dueSoon: null }, unmeasuredRepos: 0 },
  },
  kpi: { openCriticalOtherCodebases: null },
  delta: { critical: { available: false }, high: { available: false } },
  knownTeams: [],
};

const alertsData = { rows: [], totalCount: 0, truncated: false };
const trendData = { series: [] };
const coverageData = { needsTagging: [] };

beforeEach(() => {
  swrData = {
    '/api/vulnerabilities/summary': { data: baseSummary },
    '/api/vulnerabilities/trend': { data: trendData },
    '/api/vulnerabilities/alerts': { data: alertsData },
    '/api/vulnerabilities/coverage': { data: coverageData },
  };
});

it('header shows the org', () => {
  render(<VulnerabilitiesContent />);
  expect(screen.getByText('Vulnerabilities · acme')).toBeTruthy();
});

it('alerts panel subtitle names the codebase chips and team row', () => {
  render(<VulnerabilitiesContent />);
  expect(screen.getByText('· filtered by the codebase chips and team row above')).toBeTruthy();
});

it('KPI-1 delta is colored red for a positive delta', () => {
  swrData['/api/vulnerabilities/summary'] = {
    data: { ...baseSummary, delta: { critical: { available: true, baseline: { takenOn: '2026-09-15' }, reposNotInBaseline: 0, teams: [], total: { team: 'Total', deltaOpen: 5, new: 2, resolved: 1, dismissed: 0, reopened: 0, other: 0 } }, high: { available: false } } },
  };
  render(<VulnerabilitiesContent />);
  const el = screen.getByText('+5');
  expect(el.className).toContain('text-red-400');
});

it('KPI-1 delta is colored green for a negative delta', () => {
  swrData['/api/vulnerabilities/summary'] = {
    data: { ...baseSummary, delta: { critical: { available: true, baseline: { takenOn: '2026-09-15' }, reposNotInBaseline: 0, teams: [], total: { team: 'Total', deltaOpen: -3, new: 0, resolved: 3, dismissed: 0, reopened: 0, other: 0 } }, high: { available: false } } },
  };
  render(<VulnerabilitiesContent />);
  const el = screen.getByText('-3');
  expect(el.className).toContain('text-green-400');
});

it('KPI-1 delta is colored grey for a zero delta', () => {
  swrData['/api/vulnerabilities/summary'] = {
    data: { ...baseSummary, delta: { critical: { available: true, baseline: { takenOn: '2026-09-15' }, reposNotInBaseline: 0, teams: [], total: { team: 'Total', deltaOpen: 0, new: 0, resolved: 0, dismissed: 0, reopened: 0, other: 0 } }, high: { available: false } } },
  };
  render(<VulnerabilitiesContent />);
  const el = screen.getByText('0');
  expect(el.className).toContain('text-gray-500');
});

it("the 'Resolved critical since' KPI tile shows the † marker and tooltip when the total's critical carriedResolved > 0", () => {
  swrData['/api/vulnerabilities/summary'] = {
    data: {
      ...baseSummary,
      pivot: { rows: [], total: { team: 'Total', critical: { open: 12, resolved: 8, dismissed: 1, pctClosed: 40, overdue: 2, dueSoon: 1, carriedResolved: 3 }, high: { open: 3, resolved: 1, dismissed: 0, pctClosed: 25, overdue: null, dueSoon: null, carriedResolved: 0 }, unmeasuredRepos: 0 } },
    },
  };
  render(<VulnerabilitiesContent />);
  expect(screen.getByTitle('Includes 3 carried over from imported CSV history (archived repo with no alert data)')).toBeTruthy();
});

it("the 'Resolved critical since' KPI tile shows no marker when carriedResolved is 0", () => {
  render(<VulnerabilitiesContent />);
  expect(screen.queryByText('†')).toBeNull();
});

// the stale signal moved from SWR's isValidating (fires on every revalidation, including a
// same-key refresh on window refocus, which used to flash the dimming) to isLoading && data
// (true only while a key that's never resolved before is loading, which combined with
// keepPreviousData means "these rows belong to the previous key" — see alerts-table.tsx's
// AlertsPanel).
it('dims the alerts table and shows an Updating… label while isLoading with existing data', () => {
  swrData['/api/vulnerabilities/alerts'] = { data: alertsData, isLoading: true };
  render(<VulnerabilitiesContent />);
  expect(screen.getByText('Updating…')).toBeTruthy();
  const table = screen.getByRole('table');
  expect(table.closest('.opacity-60')).toBeTruthy();
});

it('no dimming or label while alerts is not loading', () => {
  render(<VulnerabilitiesContent />);
  expect(screen.queryByText('Updating…')).toBeNull();
});
