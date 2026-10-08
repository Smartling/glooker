// src/app/vulnerabilities/security-state.ts
'use client';
// GLOOK-64: the Security page's client state. The pure half: URL schemas, the severity rule, the
// sanitising rules for hand-edited input, the trend date windows and the alert-list query builder.
// The hook half: useSecurityUrl (the filters, view and ownership tab, all in the URL) and
// useAlertList (the alert list's local state).
//
// Client-safe: type-only imports from aggregate.ts (it pulls in server config), and the calendar
// check below is re-implemented because filters.ts also imports server config.
import { useState } from 'react';
import { useUrlBatch, useUrlState, type UrlSchema } from '@/lib/url-state';
import type { CodebaseGroup, Severity } from '@/lib/vulnerabilities/types';
import type { CodebaseCounts, RepoRow } from '@/lib/vulnerabilities/aggregate';
import { ALERT_SORT_KEYS, type AlertSortDir, type AlertSortKey, type AlertSortSpec } from '@/lib/vulnerabilities/alert-sort';
import { addDays } from '@/lib/vulnerabilities/time';
import { CODEBASE_GROUPS } from '@/lib/vulnerabilities/codebase-labels';
import { ALERT_PAGE_SIZE } from './dimensions';

export type SecurityView = 'overview' | 'alerts';
export type OwnTab = 'teams' | 'repos';
export type SeverityFilter = 'both' | 'critical' | 'high';
export type TrendRange = '30d' | '90d' | '1y' | 'all';

// Wave 1 owns these names. They are re-exported so the page's modules import from one place; a
// local copy would drift from what the server validates against.
export { ALERT_SORT_KEYS };
export type { AlertSortKey, AlertSortDir, AlertSortSpec, CodebaseCounts };

// ── URL schemas (spec section 5). Module-level consts: useUrlState keys off schema fields, so the
// same object must be used at every call site. `scroll: false` on every key keeps the viewport still.
export const VIEW_SCHEMA: UrlSchema<SecurityView> = { key: 'view', type: 'enum', values: ['overview', 'alerts'], default: 'overview', history: 'push', scroll: false };
export const OWN_SCHEMA: UrlSchema<OwnTab> = { key: 'own', type: 'enum', values: ['teams', 'repos'], default: 'teams', history: 'push', scroll: false };
export const CODEBASE_SCHEMA: UrlSchema<CodebaseGroup> = { key: 'codebase', type: 'enum', values: CODEBASE_GROUPS, default: 'backend', history: 'replace', scroll: false };
export const TEAM_SCHEMA: UrlSchema<string | null> = { key: 'team', type: 'string', default: null, history: 'replace', scroll: false };
export const REPO_SCHEMA: UrlSchema<string | null> = { key: 'repo', type: 'string', default: null, history: 'replace', scroll: false };
export const SEVERITY_SCHEMA: UrlSchema<SeverityFilter> = { key: 'severity', type: 'enum', values: ['both', 'critical', 'high'], default: 'both', history: 'replace', scroll: false };
export const BASELINE_SCHEMA: UrlSchema<string> = { key: 'baseline', type: 'string', default: 'last', history: 'replace', scroll: false };
export const RANGE_SCHEMA: UrlSchema<TrendRange> = { key: 'range', type: 'enum', values: ['30d', '90d', '1y', 'all'], default: 'all', history: 'replace', scroll: false };

/** The severity the KPI tiles, sparkline and trend use: critical, unless Severity is "High only". */
export const kSev = (s: SeverityFilter): Severity => (s === 'high' ? 'high' : 'critical');

/**
 * The count on a Codebase option: the open count of `kSev` (critical, or high under "High only"). The counts arrive
 * already scoped to the Owning team by the server, so nothing here filters by team. It is the number the KPI tile
 * reads, and the option writes its unit ("open crit" / "open high").
 */
export function codebaseOptionCount(counts: CodebaseCounts | undefined, group: CodebaseGroup, severity: SeverityFilter): number | null {
  const c = counts?.[group];
  if (!c) return null;
  return kSev(severity) === 'high' ? c.high : c.critical;
}

/** Open alerts under Severity for the rows in scope (optionally one repository). An unmeasured
 * row's stored count is included on purpose: the alert list does not exclude unmeasured
 * repositories, so this equals the list's totalCount when status is open and no other list filter
 * is set. */
export function scopeOpenCount(rows: readonly RepoRow[], severity: SeverityFilter, repo: string | null): number {
  let n = 0;
  for (const r of rows) {
    if (repo && r.fullName !== repo) continue;
    if (severity !== 'high') n += r.critical.open;
    if (severity !== 'critical') n += r.high.open;
  }
  return n;
}

/**
 * True when a repository is selected and its figures cannot be read from `rows`: its row is not among them (the previous
 * scope's rows while a new one loads, a repository the response does not hold), or the rows are the previous key's
 * (`stale`), whose count for it belongs to another scope. The strip and the Alerts tab count both decide with this, so
 * neither shows a 0 for a repository whose figure is merely unknown.
 */
export function repoFiguresUnknown(rows: readonly RepoRow[], repo: string | null, stale: boolean): boolean {
  return repo !== null && (stale || !rows.some(r => r.fullName === repo));
}

const TREND_RANGE_DAYS = { '30d': 30, '90d': 90, '1y': 365 } as const;
/** `all` sends no `since`; every other range is today minus 30/90/365 days (UTC). */
export function trendSince(range: TrendRange, now: Date): string | null {
  if (range === 'all') return null;
  return addDays(now.toISOString().slice(0, 10), -TREND_RANGE_DAYS[range]);
}
/** The KPI sparkline is always the last 90 days, whatever the trend card's Range says. */
export const SPARKLINE_DAYS = 90;
export function sparklineSince(now: Date): string {
  return addDays(now.toISOString().slice(0, 10), -SPARKLINE_DAYS);
}

function isCalendarDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
/** A hand-edited baseline that the API would reject (HTTP 400, which blanks the page) becomes 'last'. */
export function sanitiseBaseline(raw: string): string {
  return raw === 'last' || raw === '7d' || raw === '30d' || isCalendarDate(raw) ? raw : 'last';
}

/** View switch: how far to scroll (always <= 0) so the content starts right under the sticky bar.
 * Both arguments are viewport-relative y positions from getBoundingClientRect. */
export function keepTopDelta(contentTop: number, barBottom: number): number {
  return contentTop < barBottom ? contentTop - barBottom : 0;
}

// ── Alert-list state. Local state, not URL (spec section 5); lives here because the data hook owns
// the alerts SWR key and needs it.
export type AlertStatus = 'open' | 'resolved' | 'all';

/** The direction a header starts in when it is first clicked. Age starts descending (oldest alert
 * first, the order a triage list wants); every other key starts ascending. Clicking the active
 * header again reverses it. */
export const ALERT_SORT_FIRST_DIR: Record<AlertSortKey, AlertSortDir> = {
  severity: 'asc', advisory: 'asc', repo: 'asc', age: 'desc', due: 'asc', state: 'asc',
};

export interface AlertListState {
  status: AlertStatus;
  overdue: boolean;
  dueSoon: boolean;
  reopened: boolean;
  runtimeOnly: boolean;
  q: string;
  /** null = the server's default order (soonest due, then severity, then newest), no active header. */
  sort: { key: AlertSortKey; dir: AlertSortDir } | null;
  /** 1-based. */
  page: number;
}
export const DEFAULT_ALERT_LIST: AlertListState = {
  status: 'open', overdue: false, dueSoon: false, reopened: false, runtimeOnly: false, q: '', sort: null, page: 1,
};

/** The list as it may actually be sent. Applied at request-build time, so a bad combination never
 * costs a wasted request. */
export function sanitiseAlertList(l: AlertListState, ctx: { shownSlaActive: boolean }): AlertListState {
  const page = Number.isFinite(l.page) ? Math.max(1, Math.floor(l.page)) : 1;
  // Resolved has no due date, and with no active SLA there is nothing to be overdue against.
  // `ctx.shownSlaActive` is true when a severity the Severity filter SHOWS has an active SLA (use-security-data decides it).
  const timeAllowed = l.status !== 'resolved' && ctx.shownSlaActive;
  const overdue = timeAllowed && l.overdue;
  // Overdue and Due ≤ 7d are disjoint buckets; the API rejects both together. Keep Overdue.
  const dueSoon = timeAllowed && l.dueSoon && !overdue;
  return { ...l, overdue, dueSoon, page };
}

export interface AlertsQueryInput {
  codebase: CodebaseGroup;
  team: string | null;
  repo: string | null;
  severity: SeverityFilter;
  list: AlertListState;
  shownSlaActive: boolean;
}

/** The alerts request's query string. `severity` is omitted for "both" (never `severity=both`). */
export function alertsQueryString(i: AlertsQueryInput): string {
  const l = sanitiseAlertList(i.list, { shownSlaActive: i.shownSlaActive });
  const p = new URLSearchParams({ codebase: i.codebase });
  if (i.team) p.set('team', i.team);
  if (i.repo) p.set('repo', i.repo);
  if (i.severity !== 'both') p.set('severity', i.severity);
  p.set('state', l.status);
  if (l.overdue) p.set('overdue', 'true');
  if (l.dueSoon) p.set('due_soon', 'true');
  if (l.reopened) p.set('reopened', 'true');
  if (l.runtimeOnly) p.set('dependency_scope', 'runtime');
  if (l.q) p.set('q', l.q);
  p.set('limit', String(ALERT_PAGE_SIZE));
  p.set('offset', String((l.page - 1) * ALERT_PAGE_SIZE));
  if (l.sort) {
    const sort: AlertSortSpec = `${l.sort.key}:${l.sort.dir}`;
    p.set('sort', sort);
  }
  return p.toString();
}

// ── Hooks ──────────────────────────────────────────────────────────────────────────────────────

export interface SecurityUrl {
  view: SecurityView;
  own: OwnTab;
  codebase: CodebaseGroup;
  team: string | null;
  repo: string | null;
  severity: SeverityFilter;
  /** Already sanitised: a hand-edited value the API would reject reads as 'last'. */
  baseline: string;
  range: TrendRange;
  kSev: Severity;
  setView(v: SecurityView): void;
  setOwn(o: OwnTab): void;
  setSeverity(s: SeverityFilter): void;
  setBaseline(b: string): void;
  setRange(r: TrendRange): void;
  /** Writes `repo: null` in the same URL write: the selected repository belongs to the old scope. */
  setCodebase(c: CodebaseGroup): void;
  /** Writes `repo: null` in the same URL write. */
  setTeam(t: string | null): void;
  /** Select (or clear, with null) a repository from INSIDE the Alerts view, i.e. a rail row. Writes only
   * `repo`, as a replace: no history entry, `view` and `team` untouched. Use selectRepoRow for the
   * Overview Repositories-tab rows instead (that one is a push to the Alerts view). */
  setRepo(repo: string | null): void;
  /** "Show all repositories". */
  clearRepo(): void;
  /** Overview team row. Selecting sets the team and switches the card to Repositories (a push);
   * clicking the selected team again clears it. Never changes the view. */
  selectTeamRow(team: string): void;
  /** Repository row: one push to the Alerts view with that repository and its owning team. */
  selectRepoRow(row: { fullName: string; team: string }): void;
  /** Codebase, Owning team, Severity, Compare to and the repository back to defaults. Never changes the view. */
  resetFilters(): void;
  isDefault: { codebase: boolean; team: boolean; severity: boolean; baseline: boolean; repo: boolean; all: boolean };
}

export type SecurityScope = Pick<SecurityUrl, 'codebase' | 'team' | 'repo' | 'severity' | 'baseline' | 'range'>;

/** Handlers are recreated on every render; consumers must not depend on their identity. */
export function useSecurityUrl(): SecurityUrl {
  const batch = useUrlBatch();
  const [view, setViewRaw] = useUrlState(VIEW_SCHEMA);
  const [own, setOwnRaw] = useUrlState(OWN_SCHEMA);
  const [codebase, setCodebaseRaw] = useUrlState(CODEBASE_SCHEMA);
  const [team, setTeamRaw] = useUrlState(TEAM_SCHEMA);
  const [repo, setRepoRaw] = useUrlState(REPO_SCHEMA);
  const [severity, setSeverityRaw] = useUrlState(SEVERITY_SCHEMA);
  const [rawBaseline, setBaselineRaw] = useUrlState(BASELINE_SCHEMA);
  const [range, setRangeRaw] = useUrlState(RANGE_SCHEMA);
  const baseline = sanitiseBaseline(rawBaseline);

  const isDefault = {
    codebase: codebase === 'backend',
    team: team === null,
    severity: severity === 'both',
    baseline: baseline === 'last',
    repo: repo === null,
    all: false,
  };
  isDefault.all = isDefault.codebase && isDefault.team && isDefault.severity && isDefault.baseline && isDefault.repo;

  return {
    view, own, codebase, team, repo, severity, baseline, range, kSev: kSev(severity),
    setView: setViewRaw,
    setOwn: setOwnRaw,
    setSeverity: setSeverityRaw,
    setBaseline: setBaselineRaw,
    setRange: setRangeRaw,
    setCodebase: c => batch(() => { setCodebaseRaw(c); setRepoRaw(null); }),
    setTeam: t => batch(() => { setTeamRaw(t); setRepoRaw(null); }),
    setRepo: setRepoRaw,
    clearRepo: () => setRepoRaw(null),
    selectTeamRow: next => batch(() => {
      if (team === next) {
        setTeamRaw(null);
      } else {
        setTeamRaw(next);
        setOwnRaw('repos'); // `own` is declared push, so this batch pushes a history entry
      }
      setRepoRaw(null);
    }),
    // Raw setters, in this order, on purpose: the wrapped setTeam above also writes repo: null.
    selectRepoRow: row => batch(() => {
      setViewRaw('alerts');
      setTeamRaw(row.team);
      setRepoRaw(row.fullName);
    }),
    resetFilters: () => batch(() => {
      setCodebaseRaw('backend');
      setTeamRaw(null);
      setSeverityRaw('both');
      setBaselineRaw('last');
      setRepoRaw(null);
    }),
    isDefault,
  };
}

export interface AlertListController {
  /** The list state. Via SecurityViewProps this is the EFFECTIVE (sanitised) state. */
  list: AlertListState;
  /** 'resolved' clears overdue and dueSoon. */
  setStatus(s: AlertStatus): void;
  /** Turning Overdue on turns Due ≤ 7d off. */
  toggleOverdue(): void;
  /** Turning Due ≤ 7d on turns Overdue off. */
  toggleDueSoon(): void;
  toggleReopened(): void;
  toggleRuntimeOnly(): void;
  /** Call after the caller's own debounce; this hook does not debounce. */
  setQuery(q: string): void;
  /** The same key flips the direction; a new key starts in its ALERT_SORT_FIRST_DIR direction, except that with no header chosen (and status Open) the first click on `due` sorts descending: only then does the list draw the default order as "Due ↑". */
  setSort(key: AlertSortKey): void;
  setPage(page: number): void;
}

/**
 * The alert list's local state (not URL). The page resets to 1 whenever the page-wide scope (codebase,
 * team, repo, severity) or any list filter (status, toggles, search text, sort) changes, and by that
 * one mechanism only: `scopeKey` below. It resets in the SAME render: the state is adjusted during
 * render rather than in an effect, so the very first alerts request after the change already has
 * offset=0 (an effect would let one request out with the new scope and the old page). The returned
 * `list.page` is already 1 in that render's own pass for the same reason. Only setPage moves it.
 */
export function useAlertList(scope: { codebase: CodebaseGroup; team: string | null; repo: string | null; severity: SeverityFilter }): AlertListController {
  const [stored, setStored] = useState<AlertListState>(DEFAULT_ALERT_LIST);
  const scopeKey = JSON.stringify([
    scope.codebase, scope.team, scope.repo, scope.severity,
    stored.status, stored.overdue, stored.dueSoon, stored.reopened, stored.runtimeOnly, stored.q, stored.sort,
  ]);
  const [prevKey, setPrevKey] = useState(scopeKey);
  const reset = prevKey !== scopeKey;
  if (reset) {
    setPrevKey(scopeKey);
    if (stored.page !== 1) setStored(s => (s.page === 1 ? s : { ...s, page: 1 }));
  }
  const list = reset && stored.page !== 1 ? { ...stored, page: 1 } : stored;

  // No setter touches `page` (except setPage): a changed filter changes `scopeKey`, and that is the one place the page resets.
  return {
    list,
    setStatus: status => setStored(s => ({
      ...s, status,
      ...(status === 'resolved' ? { overdue: false, dueSoon: false } : {}),
    })),
    toggleOverdue: () => setStored(s => ({ ...s, overdue: !s.overdue, dueSoon: s.overdue ? s.dueSoon : false })),
    toggleDueSoon: () => setStored(s => ({ ...s, dueSoon: !s.dueSoon, overdue: s.dueSoon ? s.overdue : false })),
    toggleReopened: () => setStored(s => ({ ...s, reopened: !s.reopened })),
    toggleRuntimeOnly: () => setStored(s => ({ ...s, runtimeOnly: !s.runtimeOnly })),
    setQuery: q => setStored(s => ({ ...s, q })),
    // With no header active the list is in the server's default order (soonest due first), and the list draws "Due ↑" as its
    // active header under Open only (Resolved has no due dates, and under Open + resolved the default order is not `due:asc`:
    // nothing is drawn). So the first click on Due reverses the drawn arrow (due:desc) only while "Due ↑" is drawn; any other
    // first click starts in the key's own direction.
    setSort: key => setStored(s => ({
      ...s,
      sort: s.sort?.key === key
        ? { key, dir: s.sort.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: s.sort === null && s.status === 'open' && key === 'due' ? 'desc' : ALERT_SORT_FIRST_DIR[key] },
    })),
    // A non-finite page (NaN from a bad input) is page 1, as sanitiseAlertList reads it.
    setPage: page => setStored(s => ({ ...s, page: Number.isFinite(page) ? Math.max(1, Math.floor(page)) : 1 })),
  };
}
