/** @jest-environment jsdom */
// src/lib/__tests__/unit/vuln-content-config-errors.test.tsx
// one configErrors channel — a red banner on vulnerabilities-content.tsx lists
// each entry's rule (a sync-sourced entry also names when it clears), on both the available and
// Unavailable pages; and the KPI SLA tile's placeholder text ("none" / "SLA not yet active") must
// read as an invalid policy, never as merely empty, when slaPolicyInvalid is set. Mocking approach
// copied from vuln-content-b1.test.tsx (mocks `swr` directly, keyed by request URL).
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
  scope: { property: 'service_tier', value: 'production' },
  policy: [],
  slaPolicyInvalid: false,
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

describe('config-errors banner', () => {
  it('renders no banner when configErrors is empty/absent', () => {
    setSummary({});
    render(<VulnerabilitiesContent />);
    expect(screen.queryByText(/env var/)).toBeNull();
  });

  it('lists a startup entry\'s rule, with no "clears after" text', () => {
    setSummary({ configErrors: [{ source: 'startup', variable: 'VULNERABILITIES_SLA_POLICY', rule: 'Invalid JSON in VULNERABILITIES_SLA_POLICY env var' }] });
    render(<VulnerabilitiesContent />);
    expect(screen.getByText('Invalid JSON in VULNERABILITIES_SLA_POLICY env var')).toBeTruthy();
    expect(screen.queryByText(/clears after/)).toBeNull();
  });

  it('adds "clears after the next successful sync (as of …)" for a sync-sourced entry', () => {
    setSummary({
      configErrors: [{ source: 'sync', variable: 'VULN_TIER_IN_SCOPE', rule: 'VULN_TIER_IN_SCOPE: no repo has the configured in-scope tier', at: '2026-09-22T10:00:00Z' }],
    });
    render(<VulnerabilitiesContent />);
    expect(screen.getByText(/VULN_TIER_IN_SCOPE: no repo has the configured in-scope tier/)).toBeTruthy();
    expect(screen.getByText(/clears after the next successful sync \(as of 2026-09-22T10:00:00Z\)/)).toBeTruthy();
  });
});

describe('config-errors banner on the Unavailable screen', () => {
  it('renders the banner from summary.configErrors when unavailable', () => {
    swrData = {
      '/api/vulnerabilities/summary': { data: { available: false, reason: 'No successful vulnerability sync yet.', configErrors: [{ source: 'startup', variable: 'VULN_RESOLVED_SINCE', rule: 'VULN_RESOLVED_SINCE: must be a valid YYYY-MM-DD date' }] } },
      '/api/vulnerabilities/trend': { data: trendData },
      '/api/vulnerabilities/alerts': { data: alertsData },
      '/api/vulnerabilities/coverage': { data: coverageData },
    };
    render(<VulnerabilitiesContent />);
    expect(screen.getByText('VULN_RESOLVED_SINCE: must be a valid YYYY-MM-DD date')).toBeTruthy();
  });

  it('renders nothing extra when unavailable with no configErrors', () => {
    swrData = {
      '/api/vulnerabilities/summary': { data: { available: false, reason: 'No successful vulnerability sync yet.' } },
      '/api/vulnerabilities/trend': { data: trendData },
      '/api/vulnerabilities/alerts': { data: alertsData },
      '/api/vulnerabilities/coverage': { data: coverageData },
    };
    render(<VulnerabilitiesContent />);
    expect(screen.getByText('No successful vulnerability sync yet.')).toBeTruthy();
    expect(screen.queryByText(/env var/)).toBeNull();
  });
});

describe('KPI SLA tile: an invalid policy never reads as merely empty', () => {
  it('an empty (not invalid) policy shows the existing "none" / "SLA not yet active" text', () => {
    setSummary({});
    render(<VulnerabilitiesContent />);
    const tile = screen.getByText('Critical SLA').parentElement as HTMLElement;
    expect(within(tile).getByText('none')).toBeTruthy();
    expect(within(tile).getByText(/SLA not yet active/)).toBeTruthy();
  });

  it('an invalid policy shows "SLA policy configuration is invalid" in both lines, never "none" or "SLA not yet active"', () => {
    setSummary({ slaPolicyInvalid: true });
    render(<VulnerabilitiesContent />);
    const tile = screen.getByText('Critical SLA').parentElement as HTMLElement;
    expect(within(tile).queryByText('none')).toBeNull();
    expect(within(tile).queryByText(/SLA not yet active/)).toBeNull();
    // The High line reads "High: SLA policy configuration is invalid" — one text node together
    // with its "High: " prefix — so a regex match (not an exact-string match) is needed to catch
    // both the critical value line and this one.
    expect(within(tile).getAllByText(/SLA policy configuration is invalid/).length).toBe(2);
  });
});
