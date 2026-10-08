// src/lib/__tests__/support/security-fixtures.ts
// Shared fixtures for the Security page tests. Invented names only (acme/..., Payments, Search,
// Platform): this repository is public. Every builder returns the real response type from
// api-types.ts, so a test fixture that drifts from the API fails `tsc` instead of passing quietly.
import React from 'react';
import { SWRConfig } from 'swr';
import type { AlertRow, CoverageRow, DeltaResult, RepoRow, RepoSevCell, SevCell, TeamRow } from '@/lib/vulnerabilities/aggregate';
import type { SyncStatusInfo } from '@/lib/vulnerabilities/queries';
import type { CodebaseGroup } from '@/lib/vulnerabilities/types';
import type { AlertsData, CoverageData, ReposData, Slot, SummaryData, TrendData } from '@/app/vulnerabilities/api-types';

export const SYNC_AT = '2026-09-22T06:00:00Z';

export const cell = (over: Partial<RepoSevCell> = {}): RepoSevCell => ({
  open: 0, overdue: null, dueSoon: null, oldestOpenDays: null, nextDue: null, ...over,
});

export const repoRow = (fullName: string, team: string, over: Partial<RepoRow> = {}): RepoRow => ({
  fullName, team, codebaseGroup: 'backend', critical: cell(), high: cell(), unmeasured: null, ...over,
});

/** Open totals: critical 3+2+1+4 = 10, high 1+0+2+0 = 3 (the unmeasured row's stored 4 is included). */
export const REPO_ROWS: RepoRow[] = [
  repoRow('acme/checkout-api', 'Payments', { critical: cell({ open: 3, overdue: 1, dueSoon: 0 }), high: cell({ open: 1 }) }),
  repoRow('acme/ledger', 'Payments', { critical: cell({ open: 2, overdue: 0, dueSoon: 1 }), high: cell({ open: 0 }) }),
  repoRow('acme/search-index', 'Search', { critical: cell({ open: 1, overdue: 0, dueSoon: 0 }), high: cell({ open: 2 }) }),
  repoRow('acme/legacy-batch', 'Platform', {
    critical: cell({ open: 4 }), high: cell(), unmeasured: { status: 'error', detail: 'HTTP 500: status check failed' },
  }),
];

export const syncInfo = (over: Partial<SyncStatusInfo> = {}): SyncStatusInfo => ({
  stale: false, lastSuccessfulAt: SYNC_AT, lastStatus: 'succeeded', running: false, issuesCount: 0, issues: [], ...over,
});

const sevCell = (open: number, over: Partial<SevCell> = {}): SevCell => ({
  open, resolved: 0, dismissed: 0, pctClosed: null, overdue: null, dueSoon: null, carriedResolved: 0, ...over,
});
export const teamRow = (team: string, critical: number, high: number): TeamRow => ({
  team, critical: sevCell(critical), high: sevCell(high), unmeasuredRepos: 0,
});

/** A delta with no baseline to compare against. */
const NO_DELTA: DeltaResult = { available: false, baseline: null, reposNotInBaseline: 0, teams: [], total: null };

export function summaryFixture(over: Partial<SummaryData> = {}): SummaryData {
  return {
    available: true, org: 'acme', sync: syncInfo(), appliedFilters: { codebase: 'backend', baseline: 'last' }, configErrors: [],
    resolvedCountStartDate: '2020-01-08', resolvedCountInvalid: false, resolvedSince: { date: '2020-01-08', invalid: false },
    scope: { property: 'service_tier', value: 'production' },
    policy: [{ id: 'critical-2020-01', severity: 'critical', days: 9, effectiveFrom: '2020-01-08', until: null, pending: false }],
    slaPolicyInvalid: false,
    slaStatus: { critical: 'active', high: 'none' },
    pivot: { rows: [teamRow('Payments', 5, 1), teamRow('Search', 1, 2)], total: teamRow('Total', 10, 3) },
    kpi: { openCriticalOtherCodebases: null },
    delta: { critical: NO_DELTA, high: NO_DELTA },
    knownTeams: ['Payments', 'Platform', 'Search', 'Unassigned'],
    codebaseCounts: {
      backend: { critical: 10, high: 3 }, frontend: { critical: 2, high: 1 }, shared: { critical: 0, high: 0 },
      other: { critical: 0, high: 0 }, all: { critical: 12, high: 4 },
    },
    ...over,
  };
}

export const reposFixture = (
  rows: RepoRow[], applied: ReposData['appliedFilters'] = { codebase: 'backend' }, over: Partial<ReposData> = {},
): ReposData => ({
  available: true, sync: syncInfo(), appliedFilters: applied, configErrors: [], rows, ...over,
});

export const coverageFixture = (over: Partial<CoverageData> = {}): CoverageData => ({
  available: true, sync: syncInfo(), appliedFilters: { codebase: 'backend' }, configErrors: [],
  needsTagging: [], excludedByPolicy: [], unmeasured: [], ...over,
});

/** A coverage-list row. The defaults describe an unmeasured repository; override what a test needs. */
export const coverageRow = (over: Partial<CoverageRow> = {}): CoverageRow => ({
  repoId: 1, fullName: 'acme/legacy-batch', serviceTier: 'production', codebaseType: 'backend', team: 'Platform',
  openCritical: 0, openHigh: 0, detail: null, dependabotStatus: 'error', ...over,
});

export const trendFixture = (
  series: TrendData['series'] = [], applied: TrendData['appliedFilters'] = { codebase: 'backend', severity: 'critical' },
): TrendData => ({
  available: true, sync: syncInfo(), appliedFilters: applied, configErrors: [], series,
});

/** An alert-list row (a critical, open, not yet due alert). Override what a test needs. */
export const alertRow = (over: Partial<AlertRow> = {}): AlertRow => ({
  repo: 'acme/checkout-api', team: 'Payments', severity: 'critical', severityChangedAt: null,
  cveId: 'CVE-2026-0001', ghsaId: 'GHSA-aaaa-bbbb-cccc', summary: 'Prototype pollution in lodash', cvss: 9.8, epss: null,
  packageName: 'lodash', ecosystem: 'npm', manifestPath: 'package.json', relationship: 'direct', scope: 'runtime',
  createdAt: '2026-09-10T00:00:00Z', ageDays: 12, clockStart: '2026-09-10T00:00:00Z', dueDate: '2026-09-19', daysRemaining: 4,
  slaPolicyId: 'critical-2020-01', state: 'open', dismissedReason: null, resolvedAt: null,
  resolvedOnTime: null, resolvedDaysLate: null, reopenedCount: 0, lastReopenedAt: null,
  htmlUrl: 'https://example.invalid/acme/checkout-api/security/dependabot/1', ...over,
});

export const alertsFixture = (
  rows: AlertRow[] = [], totalCount: number = rows.length,
  applied: AlertsData['appliedFilters'] = { codebase: 'backend', state: 'open', limit: 10, offset: 0 },
): AlertsData => ({
  available: true, sync: syncInfo(), appliedFilters: applied, configErrors: [],
  rows, totalCount, truncated: false, excludedByCodebase: 0, repos: [],
});

/** A data slot as useSecurityData returns it (Task 2.7), for component tests that pass slots directly. */
export function slot<T>(data: T | undefined, over: Partial<Slot<T>> = {}): Slot<T> {
  return { data, unavailable: undefined, error: undefined, errorText: null, loading: data === undefined, stale: false, ...over };
}

/** A fresh SWR cache per test, with no dedupe window (otherwise a second test sees the first one's data). */
export function SwrFresh({ children }: { children: React.ReactNode }) {
  return React.createElement(SWRConfig, { value: { provider: () => new Map(), dedupingInterval: 0 } }, children);
}

export type RouteName = 'summary' | 'repos' | 'coverage' | 'trend' | 'alerts';
export type Reply = { status?: number; body: unknown };
export type Route = Reply | ((url: URL) => Reply | Promise<Reply>);

/** The codebase and team a request carried, as the repos and coverage routes echo them. */
const scopeApplied = (url: URL): ReposData['appliedFilters'] => {
  const a: ReposData['appliedFilters'] = { codebase: (url.searchParams.get('codebase') ?? 'backend') as CodebaseGroup };
  const team = url.searchParams.get('team');
  if (team) a.team = team;
  return a;
};

/** What the alerts route echoes: every request parameter under its camelCase name, with the
 * numeric ones as numbers and the flags as booleans. The one cast stands for the server's parser. */
const alertsApplied = (url: URL): AlertsData['appliedFilters'] => {
  const out: Record<string, unknown> = {};
  const camel: Record<string, string> = { due_soon: 'dueSoon', dependency_scope: 'dependencyScope' };
  url.searchParams.forEach((v, k) => {
    out[camel[k] ?? k] = k === 'limit' || k === 'offset' ? Number(v) : v === 'true' ? true : v;
  });
  return out as AlertsData['appliedFilters'];
};

/** What the trend route echoes: codebase, severity and, when sent, since. */
const trendApplied = (url: URL): TrendData['appliedFilters'] => {
  const a: TrendData['appliedFilters'] = {
    codebase: (url.searchParams.get('codebase') ?? 'backend') as CodebaseGroup,
    severity: url.searchParams.get('severity') === 'high' ? 'high' : 'critical',
  };
  const since = url.searchParams.get('since');
  if (since) a.since = since;
  return a;
};

/**
 * A fetch mock that answers /api/vulnerabilities/<name> by route name. Defaults are healthy
 * responses; pass a route to override one. A route may be a { status, body } or a function of the
 * request URL (sync or async), which is how a test serves different answers per key or holds a
 * response back until it releases a gate.
 */
export function fetchRouter(routes: Partial<Record<RouteName, Route>> = {}) {
  const defaults: Record<RouteName, Route> = {
    summary: url => ({ body: summaryFixture({ appliedFilters: { ...scopeApplied(url), baseline: url.searchParams.get('baseline') ?? 'last' } }) }),
    repos: url => ({ body: reposFixture(REPO_ROWS, scopeApplied(url)) }),
    coverage: url => ({ body: coverageFixture({ appliedFilters: scopeApplied(url) }) }),
    trend: url => ({ body: trendFixture([], trendApplied(url)) }),
    alerts: url => ({ body: alertsFixture([], 0, alertsApplied(url)) }),
  };
  const merged = { ...defaults, ...routes };
  return jest.fn(async (input: string) => {
    const url = new URL(String(input), 'http://localhost');
    const name = url.pathname.split('/').pop() as RouteName;
    const route = merged[name];
    if (!route) return { ok: false, status: 404, json: async () => ({ error: 'not found' }) } as unknown as Response;
    const reply = typeof route === 'function' ? await route(url) : route;
    const status = reply.status ?? 200;
    return { ok: status >= 200 && status < 300, status, json: async () => reply.body } as unknown as Response;
  });
}

/** The URLs a fetch mock received for one route, parsed. */
export const callsTo = (fetchMock: jest.Mock, name: RouteName): URL[] =>
  fetchMock.mock.calls
    .map(([u]) => new URL(String(u), 'http://localhost'))
    .filter(u => u.pathname.endsWith(`/${name}`));
