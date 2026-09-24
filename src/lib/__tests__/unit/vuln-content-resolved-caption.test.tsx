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
