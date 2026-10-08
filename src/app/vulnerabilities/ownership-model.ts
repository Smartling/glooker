// src/app/vulnerabilities/ownership-model.ts
// GLOOK-64: the ownership card's pure logic. Which severities are visible, how the two tables sort,
// and what each repository row shows once Severity is applied. No React and no server imports, so
// the rules are tested without a DOM and the two table components stay thin.
import type { DeltaResult, RepoRow, TeamRow } from '@/lib/vulnerabilities/aggregate';
import type { Severity } from '@/lib/vulnerabilities/types';
import type { SeverityFilter } from './security-state';
import { OWNERSHIP_BODY_H, TEAM_FOOTNOTE_H, TEAM_HEAD_H, TEAM_ROW_H } from './dimensions';

export type SortDir = 'asc' | 'desc';
export interface SortState<K extends string> { key: K; dir: SortDir }

/** A header click: the active key flips direction, any other key starts in its own first direction. */
export function nextSort<K extends string>(cur: SortState<K> | null, key: K, first: SortDir): SortState<K> {
  if (cur && cur.key === key) return { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' };
  return { key, dir: first };
}

/**
 * The glyph beside a sortable header: ↕ when it is not the active sort, ↑ or ↓ when it is. The
 * variation selector (U+FE0E) keeps ↕ a text glyph: without it macOS draws it as a coloured emoji.
 */
export const sortGlyph = (active: SortState<string> | null): string => (active ? (active.dir === 'asc' ? '↑' : '↓') : '↕\uFE0E');

/** A severity is shown unless the Severity filter names the other one. */
export const sevShown = (filter: SeverityFilter, sev: Severity): boolean => filter === 'both' || filter === sev;

/** null last in both directions, then the caller's tie-break. */
function compareValues(a: string | number | null, b: string | number | null, dir: SortDir): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  const c = typeof a === 'string' || typeof b === 'string' ? String(a).localeCompare(String(b)) : a - b;
  return dir === 'asc' ? c : -c;
}

// ── Team table ─────────────────────────────────────────────────────────────────────────────────────

/**
 * True when `rowCount` team rows do not all fit between the pinned header and the pinned Total row (and the † footnote
 * under it, when there is one), so the body scrolls. The card appends "· scroll for more" to its hint then.
 */
export function teamRowsOverflow(rowCount: number, hasFootnote: boolean): boolean {
  return rowCount * TEAM_ROW_H > teamRowsRoom(hasFootnote);
}

/** The height in px the team rows may fill: the body minus the pinned header and Total row, and the † footnote when there is one. */
export const teamRowsRoom = (hasFootnote: boolean): number =>
  OWNERSHIP_BODY_H - TEAM_HEAD_H - TEAM_ROW_H - (hasFootnote ? TEAM_FOOTNOTE_H : 0);

export type TeamSortKey =
  | 'name'
  | 'cOpen' | 'cChange' | 'cResolved' | 'cPct' | 'cOverdue'
  | 'hOpen' | 'hChange' | 'hResolved' | 'hPct' | 'hOverdue';

/** Names start ascending; every number column starts with its largest value first. */
export const TEAM_SORT_FIRST: Record<TeamSortKey, SortDir> = {
  name: 'asc',
  cOpen: 'desc', cChange: 'desc', cResolved: 'desc', cPct: 'desc', cOverdue: 'desc',
  hOpen: 'desc', hChange: 'desc', hResolved: 'desc', hPct: 'desc', hOverdue: 'desc',
};

/** The severity a sort key belongs to; null for the name column. */
export const teamKeySeverity = (key: TeamSortKey): Severity | null => (key === 'name' ? null : key[0] === 'c' ? 'critical' : 'high');

/** A team's change in open alerts since the baseline, or null when the delta has none for it. */
export function deltaOpenFor(d: DeltaResult | null | undefined, team: string): number | null {
  if (!d || !d.available) return null;
  const t = team === 'Total' ? d.total : d.teams.find(x => x.team === team);
  return t ? t.deltaOpen : null;
}

export interface TeamDeltas { critical: DeltaResult | null | undefined; high: DeltaResult | null | undefined }

function teamValue(r: TeamRow, key: TeamSortKey, deltas: TeamDeltas): string | number | null {
  const cell = key[0] === 'h' ? r.high : r.critical;
  const d = key[0] === 'h' ? deltas.high : deltas.critical;
  switch (key) {
    case 'name': return r.team;
    case 'cOpen': case 'hOpen': return cell.open;
    case 'cChange': case 'hChange': return deltaOpenFor(d, r.team);
    case 'cResolved': case 'hResolved': return cell.resolved;
    case 'cPct': case 'hPct': return cell.pctClosed;
    case 'cOverdue': case 'hOverdue': return cell.overdue;
  }
}

/** A sort on a column of a hidden severity is ignored, because that column reads "–". */
const teamSortApplies = (sort: SortState<TeamSortKey>, severity: SeverityFilter): boolean => {
  const sev = teamKeySeverity(sort.key);
  return sev === null || sevShown(severity, sev);
};

/** The order the server gives with no active header (open count of the severity the tiles follow, largest first), as a sort. */
export const defaultTeamSort = (severity: SeverityFilter): SortState<TeamSortKey> => ({ key: severity === 'high' ? 'hOpen' : 'cOpen', dir: 'desc' });

/**
 * The sort the rows are really in, for the headers to draw: the user's, when it applies; otherwise the server's order, which
 * is a sort on Open (drawn "Open ↓" like the alert list draws "Due ↑"), so a header is always active.
 */
export const shownTeamSort = (sort: SortState<TeamSortKey> | null, severity: SeverityFilter): SortState<TeamSortKey> =>
  sort && teamSortApplies(sort, severity) ? sort : defaultTeamSort(severity);

/**
 * The team rows in display order. With no active header the order is the server's (critical open
 * descending), except under "High only", where it is high open descending.
 */
export function orderTeamRows(rows: readonly TeamRow[], sort: SortState<TeamSortKey> | null, deltas: TeamDeltas, severity: SeverityFilter): TeamRow[] {
  const active = sort && teamSortApplies(sort, severity) ? sort : null;
  const out = [...rows];
  if (active) {
    return out.sort((a, b) => compareValues(teamValue(a, active.key, deltas), teamValue(b, active.key, deltas), active.dir) || a.team.localeCompare(b.team));
  }
  if (severity === 'high') return out.sort((a, b) => b.high.open - a.high.open || a.team.localeCompare(b.team));
  return out;
}

// ── Repositories table ─────────────────────────────────────────────────────────────────────────────

export type RepoSortKey = 'name' | 'team' | 'openCrit' | 'overCrit' | 'openHigh' | 'overHigh' | 'oldest' | 'next';

export const REPO_SORT_FIRST: Record<RepoSortKey, SortDir> = {
  name: 'asc', team: 'asc', next: 'asc',
  openCrit: 'desc', overCrit: 'desc', openHigh: 'desc', overHigh: 'desc', oldest: 'desc',
};

export const repoKeySeverity = (key: RepoSortKey): Severity | null =>
  key === 'openCrit' || key === 'overCrit' ? 'critical' : key === 'openHigh' || key === 'overHigh' ? 'high' : null;

const repoSortApplies = (sort: SortState<RepoSortKey>, severity: SeverityFilter): boolean => {
  const sev = repoKeySeverity(sort.key);
  return sev === null || sevShown(severity, sev);
};

/** The order the server gives with no active header, as a sort: open critical first, or open high under "High only". */
export const defaultRepoSort = (severity: SeverityFilter): SortState<RepoSortKey> => ({ key: severity === 'high' ? 'openHigh' : 'openCrit', dir: 'desc' });

/** The sort the rows are really in, for the headers to draw (see shownTeamSort). */
export const shownRepoSort = (sort: SortState<RepoSortKey> | null, severity: SeverityFilter): SortState<RepoSortKey> =>
  sort && repoSortApplies(sort, severity) ? sort : defaultRepoSort(severity);

export interface NextDue { date: string; daysRemaining: number }

/** One measured repository, with Severity applied: what its row and the footer totals read. */
export interface RepoDisplay {
  row: RepoRow;
  /** Open alerts under Severity: the sum over the shown severities. Zero greys the row. */
  open: number;
  openCrit: number;
  openHigh: number;
  /** Null unless that severity's SLA is active. */
  overCrit: number | null;
  overHigh: number | null;
  /** Oldest open alert in days, over the shown severities; null when none. */
  oldest: number | null;
  /** The earliest upcoming due date, over the shown severities with an active SLA; null when none. */
  next: NextDue | null;
}

export function repoDisplay(row: RepoRow, severity: SeverityFilter): RepoDisplay {
  const crit = sevShown(severity, 'critical');
  const high = sevShown(severity, 'high');
  const shown = [crit ? row.critical : null, high ? row.high : null].filter((c): c is NonNullable<typeof c> => c !== null);
  const ages = shown.map(c => c.oldestOpenDays).filter((n): n is number => n !== null);
  const dues = shown.map(c => c.nextDue).filter((n): n is NextDue => n !== null).sort((a, b) => a.date.localeCompare(b.date));
  return {
    row,
    open: shown.reduce((n, c) => n + c.open, 0),
    openCrit: row.critical.open,
    openHigh: row.high.open,
    overCrit: row.critical.overdue,
    overHigh: row.high.overdue,
    oldest: ages.length ? Math.max(...ages) : null,
    next: dues[0] ?? null,
  };
}

export interface RepoView {
  /** Measured rows, in display order. */
  measured: RepoDisplay[];
  /** Unmeasured rows: always last, by name, never sorted. */
  unmeasured: RepoRow[];
}

function repoValue(d: RepoDisplay, key: RepoSortKey): string | number | null {
  switch (key) {
    case 'name': return d.row.fullName;
    case 'team': return d.row.team;
    case 'openCrit': return d.openCrit;
    case 'overCrit': return d.overCrit;
    case 'openHigh': return d.openHigh;
    case 'overHigh': return d.overHigh;
    case 'oldest': return d.oldest;
    case 'next': return d.next ? d.next.date : null;
  }
}

/**
 * Filter by name, apply Severity and sort. Unmeasured rows ignore sorting and come last. With no
 * active header the order is the server's (critical open, high open, name), except that a single
 * shown severity orders by that severity alone, so a hidden column never decides the order.
 */
export function buildRepoView(rows: readonly RepoRow[], severity: SeverityFilter, sort: SortState<RepoSortKey> | null, nameFilter: string): RepoView {
  const q = nameFilter.trim().toLowerCase();
  const matched = rows.filter(r => !q || r.fullName.toLowerCase().includes(q));
  const unmeasured = matched.filter(r => r.unmeasured).sort((a, b) => a.fullName.localeCompare(b.fullName));
  const measured = matched.filter(r => !r.unmeasured).map(r => repoDisplay(r, severity));
  const active = sort && repoSortApplies(sort, severity) ? sort : null;
  if (active) {
    measured.sort((a, b) => compareValues(repoValue(a, active.key), repoValue(b, active.key), active.dir) || a.row.fullName.localeCompare(b.row.fullName));
  } else if (severity === 'high') {
    measured.sort((a, b) => b.openHigh - a.openHigh || a.row.fullName.localeCompare(b.row.fullName));
  } else if (severity === 'critical') {
    measured.sort((a, b) => b.openCrit - a.openCrit || a.row.fullName.localeCompare(b.row.fullName));
  } else {
    measured.sort((a, b) => b.openCrit - a.openCrit || b.openHigh - a.openHigh || a.row.fullName.localeCompare(b.row.fullName));
  }
  return { measured, unmeasured };
}

export interface RepoTotals {
  count: number;
  openCrit: number;
  openHigh: number;
  overCrit: number | null;
  overHigh: number | null;
  oldest: number | null;
  next: NextDue | null;
}

const sumOrNull = (vals: Array<number | null>): number | null => (vals.every(v => v === null) ? null : vals.reduce<number>((n, v) => n + (v ?? 0), 0));

/**
 * The footer row. Open and overdue sum EVERY row in view, unmeasured rows' stored counts included, so
 * the footer agrees with the team table, the Alerts strip, the rail and the Alerts tab. The rows
 * themselves still show an unmeasured count as unknown. `count`, oldest and next due are measured
 * rows only: they are not part of the sum invariant and a stored age or date may be out of date.
 */
export function repoTotals(measured: readonly RepoDisplay[], unmeasured: readonly RepoDisplay[] = []): RepoTotals {
  const all = [...measured, ...unmeasured];
  const ages = measured.map(d => d.oldest).filter((n): n is number => n !== null);
  const dues = measured.map(d => d.next).filter((n): n is NextDue => n !== null).sort((a, b) => a.date.localeCompare(b.date));
  return {
    count: measured.length,
    openCrit: all.reduce((n, d) => n + d.openCrit, 0),
    openHigh: all.reduce((n, d) => n + d.openHigh, 0),
    overCrit: sumOrNull(all.map(d => d.overCrit)),
    overHigh: sumOrNull(all.map(d => d.overHigh)),
    oldest: ages.length ? Math.max(...ages) : null,
    next: dues[0] ?? null,
  };
}

/**
 * What a repository with nothing open reads: "no open alerts", or, when Severity narrows the view, "no open critical
 * alerts" / "no open high alerts". A repository that only has the hidden severity open is not clean, and must not read so.
 */
export function noOpenText(severity: SeverityFilter): string {
  return severity === 'both' ? 'no open alerts' : `no open ${severity} alerts`;
}
