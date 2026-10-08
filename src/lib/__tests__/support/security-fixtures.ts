// src/lib/__tests__/support/security-fixtures.ts
// Shared fixtures for the Security page tests. Invented names only (acme/..., Payments, Search,
// Platform): this repository is public. Every builder returns the real response type from
// api-types.ts, so a test fixture that drifts from the API fails `tsc` instead of passing quietly.
import React from 'react';
import { SWRConfig, type SWRConfiguration } from 'swr';
import type { AlertRow, CoverageRow, DeltaResult, RepoRow, RepoSevCell, SevCell, TeamRow } from '@/lib/vulnerabilities/aggregate';
import type { SyncStatusInfo } from '@/lib/vulnerabilities/queries';
import type { CodebaseGroup } from '@/lib/vulnerabilities/types';
import { parseVulnFilters } from '@/lib/vulnerabilities/filters';
import type { AlertsData, CoverageData, ReposData, Slot, SummaryData, TrendData } from '@/app/vulnerabilities/api-types';
import { DEFAULT_ALERT_LIST } from '@/app/vulnerabilities/security-state';
import type { SecurityData } from '@/app/vulnerabilities/use-security-data';
import type { SecurityViewProps } from '@/app/vulnerabilities/view-props';

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

/** A fresh SWR cache per test, with no dedupe window (otherwise a second test sees the first one's data).
 * `config` overrides it: a test that depends on the app's real SWR settings passes them here. */
export function SwrFresh({ children, config }: { children: React.ReactNode; config?: SWRConfiguration }) {
  return React.createElement(SWRConfig, { value: { provider: () => new Map(), dedupingInterval: 0, ...config } }, children);
}

export type RouteName = 'summary' | 'repos' | 'coverage' | 'trend' | 'alerts';
export type Reply = { status?: number; body: unknown };
export type Route = Reply | ((url: URL) => Reply | Promise<Reply>);

/** The request's query string as the real routes read it, through the one shared parser. */
const parseRequest = (url: URL) => parseVulnFilters(Object.fromEntries(url.searchParams.entries()));

/** What the real routes answer for a request the parser rejects. */
const rejected = (error: string): Reply => ({ status: 400, body: { error } });

/** queries.ts's pickApplied: only keys that are set, only the keys the route echoes. */
const pick = <T extends object>(f: T, keys: readonly (keyof T)[]): Partial<T> => {
  const out: Partial<T> = {};
  for (const k of keys) if (f[k] !== undefined) out[k] = f[k];
  return out;
};

/** The key list getAlerts echoes (ALERT_FILTER_KEYS in queries.ts; vuln-security-fixture-keys.test.ts pins them equal). */
export const ALERT_ECHO_KEYS = [
  'codebase', 'state', 'team', 'repo', 'severity', 'overdue', 'dueSoon', 'dueBefore', 'createdSince',
  'resolvedSince', 'dependencyScope', 'cve', 'ghsa', 'packageName', 'q', 'reopened', 'limit', 'offset', 'sort',
] as const;

/** The codebase and team a request carried, as the summary, repos and coverage routes echo them (through the shared parser, like alerts and trend). */
const scopeReply = (url: URL, keys: readonly ('codebase' | 'team' | 'baseline')[], build: (applied: Record<string, unknown>) => unknown): Reply => {
  const p = parseRequest(url);
  return p.ok ? { body: build(pick(p.value, keys)) } : rejected(p.error);
};

/** What the alerts route echoes: the parsed request, picked to the same key list as the real route,
 * so defaults (codebase, state), camelCase names, numbers and booleans all match what the server sends. */
const alertsReply = (url: URL): Reply => {
  const p = parseRequest(url);
  return p.ok ? { body: alertsFixture([], 0, pick(p.value, ALERT_ECHO_KEYS)) } : rejected(p.error);
};

/** What the trend route echoes: codebase, team, severity (default critical) and, when sent, since. */
const trendReply = (url: URL): Reply => {
  const p = parseRequest(url);
  if (!p.ok) return rejected(p.error);
  const applied = pick({ ...p.value, severity: p.value.severity ?? 'critical' }, ['codebase', 'team', 'severity', 'since'] as const);
  return { body: trendFixture([], applied) };
};

/**
 * A fetch mock that answers /api/vulnerabilities/<name> by route name. Defaults are healthy
 * responses; pass a route to override one. A route may be a { status, body } or a function of the
 * request URL (sync or async), which is how a test serves different answers per key or holds a
 * response back until it releases a gate.
 */
export function fetchRouter(routes: Partial<Record<RouteName, Route>> = {}) {
  const defaults: Record<RouteName, Route> = {
    summary: url => {
      // The real route validates the team against the repositories it knows.
      const team = url.searchParams.get('team');
      const known = summaryFixture().knownTeams;
      if (team && !known.includes(team)) return { status: 400, body: { error: 'unknown team', known_teams: known } };
      return scopeReply(url, ['codebase', 'team', 'baseline'], applied => summaryFixture({ appliedFilters: applied as SummaryData['appliedFilters'] }));
    },
    // The real route answers only the repositories in the codebase view and, with a team, that team's.
    repos: url => scopeReply(url, ['codebase', 'team'], applied => {
      const a = applied as ReposData['appliedFilters'];
      const rows = REPO_ROWS.filter(r => (a.codebase === 'all' || r.codebaseGroup === a.codebase) && (!a.team || r.team === a.team));
      return reposFixture(rows, a);
    }),
    coverage: url => scopeReply(url, ['codebase', 'team'], applied => coverageFixture({ appliedFilters: applied as CoverageData['appliedFilters'] })),
    trend: trendReply,
    alerts: alertsReply,
  };
  const merged = { ...defaults };
  for (const [k, v] of Object.entries(routes)) if (v !== undefined) merged[k as RouteName] = v;
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

/**
 * A complete SecurityViewProps for slot tests: healthy data in every slot, no alert-list filters,
 * and a jest.fn() for every handler, so a test asserts a call without wiring a router or a hook.
 * Pass `over` to replace any top-level member (for example a `data` with a loading slot).
 */
export function viewProps(over: Partial<SecurityViewProps> = {}): SecurityViewProps {
  const summary = summaryFixture();
  const data: SecurityData = {
    summary: slot(summary), teamSummary: slot(summary), coverage: slot(coverageFixture()),
    repos: slot(reposFixture(REPO_ROWS)), metaRepos: slot(reposFixture(REPO_ROWS)), trend: slot(trendFixture()), sparkline: slot(trendFixture()),
    alerts: slot(alertsFixture()), repoStatus: 'none', effectiveRepo: null, effectiveList: DEFAULT_ALERT_LIST,
    keys: { summary: '', teamSummary: '', coverage: '', repos: '', metaRepos: '', trend: '', sparkline: '', alerts: null },
  };
  return {
    summary,
    data,
    url: {
      view: 'overview', own: 'teams', codebase: 'backend', team: null, repo: null, severity: 'both', baseline: 'last',
      range: 'all', kSev: 'critical',
      setView: jest.fn(), setOwn: jest.fn(), setSeverity: jest.fn(), setBaseline: jest.fn(), setRange: jest.fn(),
      setCodebase: jest.fn(), setTeam: jest.fn(), setRepo: jest.fn(), clearRepo: jest.fn(),
      selectTeamRow: jest.fn(), selectRepoRow: jest.fn(), resetFilters: jest.fn(),
      isDefault: { codebase: true, team: true, severity: true, baseline: true, repo: true, all: true },
    },
    list: {
      list: DEFAULT_ALERT_LIST,
      setStatus: jest.fn(), toggleOverdue: jest.fn(), toggleDueSoon: jest.fn(), toggleReopened: jest.fn(),
      toggleRuntimeOnly: jest.fn(), setQuery: jest.fn(), setSort: jest.fn(), setPage: jest.fn(),
    },
    openDrawer: jest.fn(),
    ...over,
  };
}

// ── Wave 3 (Overview) fixtures: every name starts with `ov` ───────────────────────────────────────
import type { DeltaTeam, SnapshotSet } from '@/lib/vulnerabilities/aggregate';

/** A stored measurement taken on `takenOn` (a sync). */
export const ovBaseline = (takenOn = '2026-09-15'): SnapshotSet => ({
  source: 'sync', key: `sync:${takenOn}`, takenOn, measuredAt: `${takenOn}T06:00:00Z`,
});

export const ovDeltaTeam = (team: string, deltaOpen: number, over: Partial<DeltaTeam> = {}): DeltaTeam => ({
  team, deltaOpen, new: 0, resolved: 0, dismissed: 0, reopened: 0, other: 0, ...over,
});

/** An available delta with the given total (or, with null, one that has a baseline but no total). */
export const ovDelta = (total: DeltaTeam | null, over: Partial<DeltaResult> = {}): DeltaResult => ({
  available: total !== null, baseline: ovBaseline(), reposNotInBaseline: 0, teams: [], total, ...over,
});

/** A delta with no baseline at all (nothing is old enough to compare against). */
export const ovNoBaseline = (): DeltaResult => ({ available: false, baseline: null, reposNotInBaseline: 0, teams: [], total: null });

import type { TrendSeries } from '@/lib/vulnerabilities/aggregate';

/** A severity cell for a team or total row. Only `open` is required; the rest default to zero or null. */
export const ovCell = (open: number, over: Partial<SevCell> = {}): SevCell => ({
  open, resolved: 0, dismissed: 0, pctClosed: null, overdue: null, dueSoon: null, carriedResolved: 0, ...over,
});

/** A team (or Total) row built from two cells. */
export const ovTeam = (team: string, critical: SevCell, high: SevCell, unmeasuredRepos = 0): TeamRow => ({
  team, critical, high, unmeasuredRepos,
});

/** One team's trend series from [date, open] pairs. */
export const ovSeries = (team: string, points: Array<[string, number]>): TrendSeries => ({
  team, points: points.map(([date, open]) => ({ date, open })),
});

/**
 * SecurityViewProps for the Overview slots. `summary` overrides the scoped summary (and the team
 * table's, unless `teamSummary` is given), `url` overrides URL values, `repos` replaces the repository
 * rows, `data` replaces any slot (for example a loading `sparkline`).
 */
export function ovProps(o: {
  summary?: Partial<SummaryData>;
  teamSummary?: Slot<SummaryData>;
  repos?: RepoRow[];
  url?: Partial<SecurityViewProps['url']>;
  data?: Partial<SecurityData>;
} = {}): SecurityViewProps {
  const summary = summaryFixture(o.summary);
  const base = viewProps();
  return viewProps({
    summary,
    url: { ...base.url, ...o.url },
    data: {
      ...base.data,
      summary: slot(summary),
      teamSummary: o.teamSummary ?? slot(summary),
      ...(o.repos ? { repos: slot(reposFixture(o.repos)), metaRepos: slot(reposFixture(o.repos)) } : {}),
      ...o.data,
    },
  });
}

// ── Wave 4 (Alerts view) fixtures. Every name starts with `al`; Wave 3 appends `ov` names below its own marker. ──

/** The four SLA states of one severity, as the summary reports them. `invalid` is a policy that cannot be read. */
export type AlSlaKind = 'active' | 'pending' | 'none' | 'invalid';

/**
 * A summary whose critical and high SLA states are the given ones. `pending` starts on 2099-02-01
 * (the date the UI prints); `invalid` sets `slaPolicyInvalid`, which makes both severities invalid
 * (an unreadable policy parses to no entries, so the real summary reports 'none' for both).
 */
export function alSummary(states: { critical: AlSlaKind; high: AlSlaKind }, over: Partial<SummaryData> = {}): SummaryData {
  const invalid = states.critical === 'invalid' || states.high === 'invalid';
  const status = (k: AlSlaKind): 'active' | 'pending' | 'none' => (k === 'active' || k === 'pending' ? k : 'none');
  const policy: SummaryData['policy'] = invalid ? [] : (['critical', 'high'] as const).flatMap(sev => {
    const k = states[sev];
    if (k !== 'active' && k !== 'pending') return [];
    return [{ id: `${sev}-policy`, severity: sev, days: sev === 'critical' ? 7 : 9, effectiveFrom: k === 'active' ? '2020-01-08' : '2099-02-01', until: null, pending: k === 'pending' }];
  });
  return summaryFixture({
    slaStatus: { critical: status(states.critical), high: status(states.high) },
    slaPolicyInvalid: invalid,
    policy,
    ...over,
  });
}

/**
 * An open/overdue/due-soon cell for a severity whose SLA is active. Whatever is open and not overdue is due next on 2026-10-05
 * (5 days after the 2026-09-30 clock the Alerts tests pin); with nothing left to come due there is no next due.
 */
const alActive = (open: number, overdue: number) => cell({
  open, overdue, dueSoon: 0, oldestOpenDays: open ? 30 : null,
  nextDue: open > overdue ? { date: '2026-10-05', daysRemaining: 5 } : null,
});

/**
 * Rail rows whose SERVER order (critical open desc, high open desc, name) differs from the RAIL order
 * (overdue, then open critical, then open high, then name). Both SLAs active.
 *   server: ledger-service, checkout-api, audit-log, zeta-jobs, billing-worker, quiet-service, then unmeasured
 *   rail:   checkout-api (4 overdue), billing-worker (1), ledger-service, audit-log, zeta-jobs, quiet-service, then unmeasured
 * The unmeasured tail is invoice-render, then legacy-batch (by name), and both carry stored counts.
 * NOT reconciled with `summaryFixture`'s team pivot: the strip, the rail and the Alerts tab read these rows, never the pivot, so a test
 * that compares the two (the Overview's team table against these rows) would be comparing unrelated numbers. Use REPO_ROWS there.
 */
export const AL_RAIL_ROWS: RepoRow[] = [
  repoRow('acme/ledger-service', 'Payments', { critical: alActive(5, 0), high: alActive(0, 0) }),
  repoRow('acme/checkout-api', 'Payments', { critical: alActive(3, 1), high: alActive(2, 3) }),
  repoRow('acme/audit-log', 'Platform', { critical: alActive(2, 0), high: alActive(5, 0) }),
  repoRow('acme/zeta-jobs', 'Platform', { critical: alActive(2, 0), high: alActive(5, 0) }),
  repoRow('acme/billing-worker', 'Payments', { critical: alActive(2, 1), high: alActive(1, 0) }),
  repoRow('acme/quiet-service', 'Search', { critical: alActive(0, 0), high: alActive(0, 0) }),
  repoRow('acme/invoice-render', 'Payments', {
    critical: alActive(7, 2), high: alActive(0, 0), unmeasured: { status: 'dependabot-off', detail: null },
  }),
  repoRow('acme/legacy-batch', 'Platform', {
    critical: alActive(4, 0), high: alActive(1, 0), unmeasured: { status: 'error', detail: 'HTTP 500: status check failed' },
  }),
];

/** One alert row; `n` makes the advisory id, the package and the alert distinct. */
export const alAlertRow = (n: number, over: Partial<AlertRow> = {}): AlertRow => alertRow({
  cveId: `CVE-2026-${String(1000 + n)}`, ghsaId: `GHSA-${n}`, packageName: `pkg-${n}`, ageDays: 10 + n,
  htmlUrl: `https://example.invalid/acme/checkout-api/security/dependabot/${n}`, ...over,
});

/** `n` distinct open alerts, newest advisory last. */
export const alAlertRows = (n: number, over: Partial<AlertRow> = {}): AlertRow[] =>
  Array.from({ length: n }, (_, i) => alAlertRow(i + 1, over));

/**
 * An open critical alert 71 days past its due date, read on 2026-09-30. The clock started when it was created (2026-07-14), the critical
 * policy in `alSummary` allows 7 days, so it fell due on 2026-07-21; it is 78 days old.
 */
export const AL_OVERDUE_ROW: AlertRow = alAlertRow(1, {
  cveId: 'CVE-2026-43102', cvss: 9.1, packageName: 'golang.org/x/net', ecosystem: 'go', scope: 'runtime',
  createdAt: '2026-07-14T20:00:00Z', clockStart: '2026-07-14T20:00:00Z',
  ageDays: 78, dueDate: '2026-07-21', daysRemaining: -71, state: 'open',
});

/**
 * A fixed alert, resolved on time, that was reopened once. Created on 2026-08-10 and reopened on 08-14; its severity was raised on 08-28,
 * which restarted the clock, so the 7-day critical policy made it due 2026-09-04 and the fix on 09-03 was on time. Its age is counted to the
 * fix (24 days), and a resolved alert has no days remaining.
 */
export const AL_RESOLVED_ROW: AlertRow = alAlertRow(2, {
  cveId: 'CVE-2026-41871', cvss: 7.5, packageName: 'semver', ecosystem: 'npm', scope: 'development',
  createdAt: '2026-08-10T09:00:00Z', severityChangedAt: '2026-08-28T09:00:00Z', clockStart: '2026-08-28T09:00:00Z', ageDays: 24,
  state: 'fixed', dueDate: '2026-09-04', daysRemaining: null, resolvedAt: '2026-09-03T08:00:00Z', resolvedOnTime: true, resolvedDaysLate: null,
  reopenedCount: 1, lastReopenedAt: '2026-08-14T10:30:00Z',
});

/**
 * An alerts route that serves `all` as the server would: it honours `limit` and `offset`, reports the
 * full `totalCount`, and echoes limit, offset and sort. Pass it to `fetchRouter({ alerts: alAlertsRoute(all) })`.
 */
export const alAlertsRoute = (all: AlertRow[]) => (url: URL) => {
  const limit = Number(url.searchParams.get('limit') ?? 10);
  const offset = Number(url.searchParams.get('offset') ?? 0);
  const sort = url.searchParams.get('sort');
  const applied: AlertsData['appliedFilters'] = {
    codebase: (url.searchParams.get('codebase') ?? 'backend') as ReposData['appliedFilters']['codebase'],
    state: (url.searchParams.get('state') ?? 'open') as 'open', limit, offset,
    ...(sort ? { sort: sort as NonNullable<AlertsData['appliedFilters']['sort']> } : {}),
  };
  return { body: alertsFixture(all.slice(offset, offset + limit), all.length, applied) };
};
