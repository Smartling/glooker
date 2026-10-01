/** @jest-environment jsdom */
// GLOOK-58 Decision 11: VulnerabilitiesContent builds colorByTeam from the UNFILTERED trend
// series and passes it alongside the (possibly team-filtered) series, so a team keeps its colour
// when the page filter narrows the chart. Mocking approach copied from
// vuln-content-resolved-caption.test.tsx (mocks `swr` directly, keyed by request URL).
import React from 'react';
import { render } from '@testing-library/react';

const urlStore: Record<string, unknown> = { codebase: 'backend', baseline: 'last', team: 'TeamB', sev: 'critical' };
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

const trendProps: Array<{ series: Array<{ team: string }>; colorByTeam: Record<string, string> }> = [];
jest.mock('@/app/vulnerabilities/trend-chart', () => ({
  __esModule: true,
  default: (props: { series: Array<{ team: string }>; colorByTeam: Record<string, string> }) => { trendProps.push(props); return null; },
}));
jest.mock('@/app/vulnerabilities/team-pivot', () => ({ __esModule: true, default: () => null }));
jest.mock('@/app/vulnerabilities/coverage-panel', () => ({ __esModule: true, default: () => null }));
jest.mock('@/app/vulnerabilities/policy-panel', () => ({ __esModule: true, default: () => null }));

import VulnerabilitiesContent from '@/app/vulnerabilities/vulnerabilities-content';

const summary = {
  available: true, org: 'acme',
  sync: { stale: false, lastSuccessfulAt: '2026-09-22T06:00:00Z', lastStatus: 'succeeded', issues: [] },
  resolvedCountStartDate: '2020-01-08',
  resolvedCountInvalid: false,
  resolvedSince: { date: '2020-01-08', invalid: false },
  policy: [],
  slaStatus: { critical: 'none', high: 'none' },
  pivot: {
    rows: [],
    total: { team: 'Total', critical: { open: 0, resolved: 0, dismissed: 0, pctClosed: 0, overdue: null, dueSoon: null }, high: { open: 0, resolved: 0, dismissed: 0, pctClosed: 0, overdue: null, dueSoon: null }, unmeasuredRepos: 0 },
  },
  kpi: { openCriticalOtherCodebases: null },
  delta: { critical: { available: false }, high: { available: false } },
  knownTeams: ['TeamA', 'TeamB', 'TeamC'],
};

const series = [
  { team: 'TeamC', points: [{ date: '2026-09-01', open: 50 }] },
  { team: 'TeamA', points: [{ date: '2026-09-01', open: 1 }] },
  { team: 'TeamB', points: [{ date: '2026-09-01', open: 9 }] },
];

it('passes the filtered series with colours computed from every team', () => {
  swrData = {
    '/api/vulnerabilities/summary': { data: summary },
    '/api/vulnerabilities/trend': { data: { series } },
    '/api/vulnerabilities/alerts': { data: { rows: [], totalCount: 0, truncated: false } },
    '/api/vulnerabilities/coverage': { data: { needsTagging: [] } },
  };
  render(<VulnerabilitiesContent />);
  const last = trendProps[trendProps.length - 1];
  expect(last.series.map(s => s.team)).toEqual(['TeamB']);
  expect(last.colorByTeam).toEqual({
    TeamA: 'var(--vuln-series-1)',
    TeamB: 'var(--vuln-series-2)',
    TeamC: 'var(--vuln-series-3)',
  });
});
