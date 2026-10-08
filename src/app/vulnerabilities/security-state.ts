// src/app/vulnerabilities/security-state.ts
'use client';
// GLOOK-64: the Security page's URL schemas, the severity rule, the sanitising rules for
// hand-edited input, and the alert-list query builder. This task is the pure half; Task 2.6 adds
// the two hooks (useSecurityUrl, useAlertList) to this file.
//
// Client-safe: type-only imports from aggregate.ts (it pulls in server config), and the calendar
// check below is re-implemented because filters.ts also imports server config.
import type { UrlSchema } from '@/lib/url-state';
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
 * The count on a Codebase option: the open count of `kSev` (critical, or high under "High only") and, server-side,
 * of the Owning team. It is the number the KPI tile reads, and the option writes its unit ("open crit" / "open high").
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
export function sanitiseAlertList(l: AlertListState, ctx: { anySlaActive: boolean }): AlertListState {
  const page = Number.isFinite(l.page) ? Math.max(1, Math.floor(l.page)) : 1;
  // Resolved has no due date, and with no active SLA there is nothing to be overdue against.
  const timeAllowed = l.status !== 'resolved' && ctx.anySlaActive;
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
  anySlaActive: boolean;
}

/** The alerts request's query string. `severity` is omitted for "both" (never `severity=both`). */
export function alertsQueryString(i: AlertsQueryInput): string {
  const l = sanitiseAlertList(i.list, { anySlaActive: i.anySlaActive });
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
