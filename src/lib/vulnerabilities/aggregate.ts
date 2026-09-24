// Pure aggregation. Every number the UI and MCP show is computed here, from stored rows.
import { getVulnConfig } from './config';
import { computeDue, daysRemaining, slaStatus, resolvedTiming } from './sla';
import { inCodebaseView, isInScope } from './codebase';
import { diffDays, utcDate, toIsoSecond } from './time';
import type { AlertFact, RepoFact, CodebaseGroup, Severity, AlertState, SnapshotRow, DependabotStatus } from './types';

export const UNASSIGNED = 'Unassigned';

export function teamOf(r: RepoFact): string { return r.team ?? UNASSIGNED; }
export function isOpen(a: AlertFact, r: RepoFact): boolean { return a.state === 'open' && !a.missing && !r.archived; }
/** GLOOK-43: a repo is unmeasured when its Dependabot status can't be trusted —
 * either GitHub's status check errored, or the repo has Dependabot alerts turned off. Both leave
 * whatever alerts are stored counted (they just can't be trusted to be complete), and both must
 * agree everywhere unmeasured is counted (the pivot's unmeasuredRepos and coverage's unmeasured
 * list), so this is the one place that decides it. */
export function isUnmeasured(r: RepoFact): boolean { return r.dependabotStatus === 'error' || r.dependabotStatus === 'dependabot-off'; }
/**
 * `since = null` (VULN_RESOLVED_SINCE unset, or invalid — config.ts folds both to `null`) means
 * "count every resolution, all time": there is no start date to compare against. This is also why
 * an invalid date never disqualifies a resolution from *listing* — only the pivot/KPI figures
 * (below) go null on an invalid date; the alert list isn't a progress figure.
 */
export function isResolvedSinceStart(a: AlertFact, since: string | null = getVulnConfig().resolvedSince): boolean {
  return a.state !== 'open' && !a.withdrawn && a.resolvedAt !== null && (since === null || a.resolvedAt >= since);
}
const isDismissed = (a: AlertFact) => a.state === 'dismissed' || a.state === 'auto_dismissed';

export function knownTeams(repos: RepoFact[]): string[] {
  return [...new Set(repos.filter(r => isInScope(r.serviceTier)).map(teamOf))].sort();
}

function viewRepos(repos: RepoFact[], codebase: CodebaseGroup, team?: string): Map<number, RepoFact> {
  return new Map(repos
    .filter(r => isInScope(r.serviceTier) && inCodebaseView(r.codebaseType, codebase) && (!team || teamOf(r) === team))
    .map(r => [r.repoId, r]));
}

export interface SevCell {
  open: number;
  /** null only when getVulnConfig().resolvedSinceInvalid — an unresolvable "since" date means this
   * figure can't be trusted, so the UI shows "—" (via dash()) rather than a wrong number. */
  resolved: number | null;
  /** null under the same condition as `resolved` — `dismissed` is a subset of `resolved`, so an
   * untrustworthy resolved count makes dismissed untrustworthy too (spec: resolved counts and %
   * closed render as "—", never an all-time figure that would overstate progress). */
  dismissed: number | null;
  pctClosed: number | null;   // null when open + resolved = 0, or when resolved is null (see above)
  overdue: number | null;     // null unless the severity's SLA is active
  dueSoon: number | null;
  /** How much of `resolved` is carried over from imported CSV history for an archived
   * repo Glooker never synced any alerts for (included in `resolved`, not on top of it). Always 0
   * on `high` — the CSVs never measured high. */
  carriedResolved: number;
}
/**
 * Internal accumulator (GLOOK-43 Wave P): `resolved` and every other field stay plain `number`
 * here so the accumulation loop below can keep using `++`/`+=` without touching a nullable field
 * (SevCell.resolved is `number | null`) — tsc would otherwise reject every increment. The
 * resolvedSinceInvalid substitution to `null` happens exactly once, in `finish()`, after
 * accumulation (including the carried-resolved fold-in) is done.
 */
interface SevAcc { open: number; resolved: number; dismissed: number; overdue: number; dueSoon: number; carriedResolved: number }
export interface TeamRow { team: string; critical: SevCell; high: SevCell; unmeasuredRepos: number }
interface TeamAcc { team: string; critical: SevAcc; high: SevAcc; unmeasuredRepos: number }

const emptyAcc = (): SevAcc => ({ open: 0, resolved: 0, dismissed: 0, overdue: 0, dueSoon: 0, carriedResolved: 0 });

function finish(cell: SevAcc, sev: Severity, now: Date, resolvedInvalid: boolean): SevCell {
  const denom = cell.open + cell.resolved;
  const active = slaStatus(sev, now) === 'active';
  return {
    open: cell.open,
    resolved: resolvedInvalid ? null : cell.resolved,
    dismissed: resolvedInvalid ? null : cell.dismissed,
    pctClosed: resolvedInvalid ? null : (denom === 0 ? null : Math.round((cell.resolved / denom) * 100)),
    overdue: active ? cell.overdue : null,
    dueSoon: active ? cell.dueSoon : null,
    carriedResolved: cell.carriedResolved,
  };
}

export function computePivot(alerts: AlertFact[], repos: RepoFact[], opts: { codebase: CodebaseGroup; team?: string; now: Date }):
  { rows: TeamRow[]; total: TeamRow } {
  const resolvedInvalid = getVulnConfig().resolvedSinceInvalid;
  const inView = viewRepos(repos, opts.codebase, opts.team);
  const rows = new Map<string, TeamAcc>();
  const row = (team: string) => {
    if (!rows.has(team)) rows.set(team, { team, critical: emptyAcc(), high: emptyAcc(), unmeasuredRepos: 0 });
    return rows.get(team)!;
  };
  // "zero rows in vulnerability_alerts" re-checked here from the full (not view-scoped)
  // alerts array — defense in depth against a RepoFact whose carriedResolvedCritical was wrongly
  // set upstream, independent of whatever `alerts` this call happens to be scoped to. Any stored
  // row disqualifies a repo regardless of its state (open, resolved, missing, withheld).
  const reposWithAlerts = new Set(alerts.map(a => a.repoId));
  for (const r of inView.values()) {
    const tr = row(teamOf(r));
    if (isUnmeasured(r)) tr.unmeasuredRepos++;
    if (r.archived && r.carriedResolvedCritical > 0 && !reposWithAlerts.has(r.repoId)) {
      tr.critical.resolved += r.carriedResolvedCritical;
      tr.critical.carriedResolved += r.carriedResolvedCritical;
    }
  }
  for (const a of alerts) {
    const r = inView.get(a.repoId);
    if (!r) continue;
    const cell = row(teamOf(r))[a.severity];
    if (isOpen(a, r)) {
      cell.open++;
      const due = computeDue(a);
      if (due) {
        const d = daysRemaining(due.dueDate, opts.now);
        if (d < 0) cell.overdue++;
        else if (d <= 7) cell.dueSoon++;
      }
    } else if (isResolvedSinceStart(a)) {
      cell.resolved++;
      if (isDismissed(a)) cell.dismissed++;
    }
  }
  const accs = [...rows.values()];
  const list: TeamRow[] = accs
    .map(r => ({ team: r.team, unmeasuredRepos: r.unmeasuredRepos, critical: finish(r.critical, 'critical', opts.now, resolvedInvalid), high: finish(r.high, 'high', opts.now, resolvedInvalid) }))
    .sort((a, b) => b.critical.open - a.critical.open || a.team.localeCompare(b.team));
  const sumAcc = (sev: Severity): SevAcc => accs.reduce((acc, r) => ({
    open: acc.open + r[sev].open, resolved: acc.resolved + r[sev].resolved, dismissed: acc.dismissed + r[sev].dismissed,
    overdue: acc.overdue + r[sev].overdue, dueSoon: acc.dueSoon + r[sev].dueSoon, carriedResolved: acc.carriedResolved + r[sev].carriedResolved,
  }), emptyAcc());
  const total: TeamRow = {
    team: 'Total',
    critical: finish(sumAcc('critical'), 'critical', opts.now, resolvedInvalid),
    high: finish(sumAcc('high'), 'high', opts.now, resolvedInvalid),
    unmeasuredRepos: list.reduce((n, r) => n + r.unmeasuredRepos, 0),
  };
  return { rows: list, total };
}

export interface Kpi { openCriticalOtherCodebases: number | null }

export function computeKpi(alerts: AlertFact[], repos: RepoFact[], opts: { codebase: CodebaseGroup; team?: string; now: Date }): Kpi {
  if (opts.codebase === 'all') return { openCriticalOtherCodebases: null };
  const byId = new Map(repos.map(r => [r.repoId, r]));
  let n = 0;
  for (const a of alerts) {
    const r = byId.get(a.repoId);
    if (!r || !isInScope(r.serviceTier) || inCodebaseView(r.codebaseType, opts.codebase)) continue;
    if (opts.team && teamOf(r) !== opts.team) continue;
    if (a.severity === 'critical' && isOpen(a, r)) n++;
  }
  return { openCriticalOtherCodebases: n };
}

export interface CoverageRow {
  repoId: number; fullName: string; serviceTier: string | null; codebaseType: string | null; team: string | null;
  openCritical: number; openHigh: number; detail?: string | null;
  /** GLOOK-43: additive, so the UI can label a `dependabot-off` row distinctly from
   * an `error` row instead of both reading as a bare "unmeasured" with a detail string. */
  dependabotStatus?: DependabotStatus;
}
export interface Coverage { needsTagging: CoverageRow[]; excludedByPolicy: CoverageRow[]; unmeasured: CoverageRow[] }

export function computeCoverage(alerts: AlertFact[], repos: RepoFact[], opts: { team?: string }): Coverage {
  const open = new Map<number, { c: number; h: number }>();
  const byId = new Map(repos.map(r => [r.repoId, r]));
  for (const a of alerts) {
    const r = byId.get(a.repoId);
    if (!r || !isOpen(a, r)) continue;
    const o = open.get(a.repoId) ?? { c: 0, h: 0 };
    if (a.severity === 'critical') o.c++; else o.h++;
    open.set(a.repoId, o);
  }
  const toRow = (r: RepoFact): CoverageRow => ({
    repoId: r.repoId, fullName: r.fullName, serviceTier: r.serviceTier, codebaseType: r.codebaseType, team: r.team,
    openCritical: open.get(r.repoId)?.c ?? 0, openHigh: open.get(r.repoId)?.h ?? 0, detail: r.dependabotStatusDetail,
    dependabotStatus: r.dependabotStatus,
  });
  const teamOk = (r: RepoFact) => !opts.team || teamOf(r) === opts.team;
  const byOpen = (a: CoverageRow, b: CoverageRow) => b.openCritical - a.openCritical || b.openHigh - a.openHigh || a.fullName.localeCompare(b.fullName);
  const hasOpen = (r: RepoFact) => open.has(r.repoId);
  return {
    needsTagging: repos.filter(r => teamOk(r) && hasOpen(r) && (!r.serviceTier || !r.codebaseType || !r.team)).map(toRow).sort(byOpen),
    excludedByPolicy: repos.filter(r => teamOk(r) && hasOpen(r) && r.serviceTier !== null && !isInScope(r.serviceTier)).map(toRow).sort(byOpen),
    unmeasured: repos.filter(r => teamOk(r) && isInScope(r.serviceTier) && isUnmeasured(r)).map(toRow).sort(byOpen),
  };
}

export interface AlertFilters {
  codebase: CodebaseGroup;
  state: 'open' | 'resolved' | 'all';
  team?: string; repo?: string; severity?: Severity;
  overdue?: boolean; dueSoon?: boolean; dueBefore?: string; createdSince?: string; resolvedSince?: string;
  dependencyScope?: string; cve?: string; ghsa?: string; packageName?: string; q?: string; reopened?: boolean;
  limit?: number;
}
export interface AlertRow {
  repo: string; team: string; severity: Severity; severityChangedAt: string | null;
  cveId: string | null; ghsaId: string | null; summary: string | null; cvss: number | null; epss: number | null;
  packageName: string | null; ecosystem: string | null; manifestPath: string | null; relationship: string | null; scope: string | null;
  createdAt: string; ageDays: number; clockStart: string | null; dueDate: string | null; daysRemaining: number | null;
  slaPolicyId: string | null; state: AlertState; dismissedReason: string | null; resolvedAt: string | null;
  resolvedOnTime: boolean | null; resolvedDaysLate: number | null; reopenedCount: number; htmlUrl: string;
}
/** GLOOK-43: distinct repos (with counts) matching every filter except `repo`
 * itself, ignoring `limit` — so a repo dropdown's options don't come from the (possibly
 * truncated) loaded rows. A single team can have far more open alerts than any sane page size. */
export interface RepoFacetRow { repo: string; count: number }
export interface AlertListResult { rows: AlertRow[]; totalCount: number; truncated: boolean; excludedByCodebase: number; repos: RepoFacetRow[] }

function matches(a: AlertFact, r: RepoFact, f: AlertFilters, now: Date, ignoreCodebase: boolean): boolean {
  if (!isInScope(r.serviceTier)) return false;
  if (!ignoreCodebase && !inCodebaseView(r.codebaseType, f.codebase)) return false;
  if (f.team && teamOf(r) !== f.team) return false;
  if (f.repo && r.fullName !== f.repo) return false;
  if (f.severity && a.severity !== f.severity) return false;
  const open = isOpen(a, r);
  if (f.state === 'open' && !open) return false;
  if (f.state === 'resolved' && !isResolvedSinceStart(a)) return false;
  if (f.state === 'all' && !open && !isResolvedSinceStart(a)) return false;
  const due = computeDue(a);
  if (f.overdue !== undefined) {
    const od = open && !!due && daysRemaining(due.dueDate, now) < 0;
    if (od !== f.overdue) return false;
  }
  if (f.dueSoon !== undefined) {
    // Same definition as the pivot's dueSoon: open, with a due date 0-7 days out. An overdue
    // alert (negative daysRemaining) does NOT count as due soon.
    const ds = open && !!due && daysRemaining(due.dueDate, now) >= 0 && daysRemaining(due.dueDate, now) <= 7;
    if (ds !== f.dueSoon) return false;
  }
  if (f.dueBefore && !(open && due && due.dueDate < f.dueBefore)) return false;
  if (f.createdSince && utcDate(a.createdAt) < f.createdSince) return false;
  if (f.resolvedSince && !(a.resolvedAt && utcDate(a.resolvedAt) >= f.resolvedSince)) return false;
  if (f.dependencyScope && (a.scope ?? 'unknown') !== f.dependencyScope) return false;
  if (f.cve && a.cveId !== f.cve) return false;
  if (f.ghsa && a.ghsaId !== f.ghsa) return false;
  if (f.packageName && a.packageName !== f.packageName) return false;
  if (f.reopened && a.reopenedCount === 0) return false;
  if (f.q) {
    const q = f.q.toLowerCase();
    if (![a.cveId, a.ghsaId, a.packageName, r.fullName].some(v => v?.toLowerCase().includes(q))) return false;
  }
  return true;
}

function toAlertRow(a: AlertFact, r: RepoFact, now: Date): AlertRow {
  const due = computeDue(a);
  const open = isOpen(a, r);
  const timing = !open && due && a.resolvedAt ? resolvedTiming(due.dueDate, a.resolvedAt) : null;
  const ageEnd = open ? now.toISOString().slice(0, 10) : utcDate(a.resolvedAt ?? now.toISOString());
  return {
    repo: r.fullName, team: teamOf(r), severity: a.severity, severityChangedAt: a.severityChangedAt,
    cveId: a.cveId, ghsaId: a.ghsaId, summary: a.summary, cvss: a.cvssScore, epss: a.epssPercentage,
    packageName: a.packageName, ecosystem: a.ecosystem, manifestPath: a.manifestPath, relationship: a.relationship, scope: a.scope,
    createdAt: a.createdAt, ageDays: Math.max(0, diffDays(ageEnd, utcDate(a.createdAt))),
    clockStart: due?.clockStart ?? null, dueDate: due?.dueDate ?? null,
    daysRemaining: open && due ? daysRemaining(due.dueDate, now) : null, slaPolicyId: due?.policyId ?? null,
    state: a.state, dismissedReason: a.dismissedReason, resolvedAt: a.resolvedAt,
    resolvedOnTime: timing ? timing.onTime : null, resolvedDaysLate: timing ? timing.daysLate : null,
    reopenedCount: a.reopenedCount, htmlUrl: a.htmlUrl,
  };
}

/** GLOOK-43: same `matches()` every alert row is tested against, minus the `repo`
 * filter — so a repo whose alerts are currently filtered out by `f.repo` still shows up as an
 * option with its true count under every other active filter. `limit` never applies here; the
 * facet counts every match, not just the page the caller asked for. */
function repoFacet(alerts: AlertFact[], byId: Map<number, RepoFact>, f: AlertFilters, now: Date): RepoFacetRow[] {
  const withoutRepo: AlertFilters = { ...f, repo: undefined };
  const counts = new Map<string, number>();
  for (const a of alerts) {
    const r = byId.get(a.repoId);
    if (!r) continue;
    if (!matches(a, r, withoutRepo, now, false)) continue;
    counts.set(r.fullName, (counts.get(r.fullName) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([repo, count]) => ({ repo, count }))
    .sort((a, b) => b.count - a.count || a.repo.localeCompare(b.repo));
}

export function listAlerts(alerts: AlertFact[], repos: RepoFact[], f: AlertFilters, now: Date): AlertListResult {
  const byId = new Map(repos.map(r => [r.repoId, r]));
  const limit = Math.min(Math.max(f.limit ?? 100, 1), 500);
  const hits: AlertRow[] = [];
  let excludedByCodebase = 0;
  for (const a of alerts) {
    const r = byId.get(a.repoId);
    if (!r) continue;
    if (matches(a, r, f, now, false)) hits.push(toAlertRow(a, r, now));
    else if (f.codebase !== 'all' && matches(a, r, f, now, true)) excludedByCodebase++;
  }
  // Most urgent first: soonest due, then severity, then newest.
  hits.sort((x, y) => (x.daysRemaining ?? 1e9) - (y.daysRemaining ?? 1e9)
    || (x.severity === y.severity ? 0 : x.severity === 'critical' ? -1 : 1)
    || y.createdAt.localeCompare(x.createdAt));
  return {
    rows: hits.slice(0, limit), totalCount: hits.length, truncated: hits.length > limit, excludedByCodebase,
    repos: repoFacet(alerts, byId, f, now),
  };
}

// ---------- Baseline, delta, trend ----------

export interface SnapshotSet { source: 'sync' | 'csv-import'; key: string; takenOn: string; measuredAt: string }
export type Baseline = 'last' | '7d' | '30d' | string;

/**
 * Only the fields that identify a snapshot *set* (a sync run, or one imported CSV file) — not the
 * per-repo count columns. queries.ts builds a set index with exactly these columns (GLOOK-43 final
 * review G6, so getSummary doesn't have to load every snapshot row just to pick a baseline), and a
 * full SnapshotRow[] (used by computeTrend) satisfies this structurally too.
 */
export type SnapshotSetRow = Pick<SnapshotRow, 'source' | 'syncId' | 'sourceFile' | 'takenOn' | 'measuredAt'>;

export const setKey = (r: SnapshotSetRow) => (r.source === 'sync' ? `sync:${r.syncId}` : `csv:${r.sourceFile}`);

export function snapshotSets(rows: SnapshotSetRow[]): SnapshotSet[] {
  const m = new Map<string, SnapshotSet>();
  for (const r of rows) {
    const key = setKey(r);
    if (!m.has(key)) m.set(key, { source: r.source, key, takenOn: r.takenOn, measuredAt: r.measuredAt });
  }
  return [...m.values()].sort((a, b) => a.measuredAt.localeCompare(b.measuredAt));
}

export function pickBaseline(sets: SnapshotSet[], baseline: Baseline, now: Date): SnapshotSet | null {
  if (baseline === 'last') return sets.length >= 2 ? sets[sets.length - 2] : null;
  let point: string;
  if (baseline === '7d' || baseline === '30d') {
    const days = baseline === '7d' ? 7 : 30;
    point = toIsoSecond(new Date(now.getTime() - days * 86_400_000));
  } else {
    point = `${baseline}T23:59:59Z`;
  }
  const eligible = sets.filter(s => s.measuredAt <= point);
  return eligible.length ? eligible[eligible.length - 1] : null;
}

/** CSV snapshots measure only the Backend view, only critical (spec: Delta and trend). */
function setMeasures(set: SnapshotSet, codebase: CodebaseGroup, severity: Severity): boolean {
  return set.source === 'sync' || (codebase === 'backend' && severity === 'critical');
}

/**
 * Picks exactly one snapshot set per day that computeTrend will plot: sync beats CSV on the same
 * day, and later measured_at wins between two sets of the same source. Exported (GLOOK-43) so
 * queries.ts can load only the chosen sets' rows instead of every snapshot row an org has
 * ever accumulated — computeTrend re-derives the same choice from whatever rows it's handed, so the
 * two can never drift apart.
 */
export function pickTrendSets(
  index: SnapshotSetRow[], opts: { codebase: CodebaseGroup; severity: Severity; since?: string },
): SnapshotSet[] {
  const perDay = new Map<string, SnapshotSet>();
  for (const s of snapshotSets(index)) {
    if (opts.since && s.takenOn < opts.since) continue;
    if (!setMeasures(s, opts.codebase, opts.severity)) continue;
    const cur = perDay.get(s.takenOn);
    if (!cur || (cur.source === 'csv-import' && s.source === 'sync') || (cur.source === s.source && s.measuredAt > cur.measuredAt)) perDay.set(s.takenOn, s);
  }
  return [...perDay.values()];
}

export interface DeltaTeam { team: string; deltaOpen: number; new: number; resolved: number; dismissed: number; reopened: number; other: number }
export interface DeltaResult { available: boolean; baseline: SnapshotSet | null; reposNotInBaseline: number; teams: DeltaTeam[]; total: DeltaTeam | null }

export function computeDelta(
  alerts: AlertFact[], repos: RepoFact[], baselineRows: SnapshotRow[], set: SnapshotSet | null,
  opts: { codebase: CodebaseGroup; team?: string; severity: Severity },
): DeltaResult {
  if (!set || !setMeasures(set, opts.codebase, opts.severity)) {
    return { available: false, baseline: set, reposNotInBaseline: 0, teams: [], total: null };
  }
  const inView = viewRepos(repos, opts.codebase, opts.team);
  const base = new Map(baselineRows.map(r => [r.repoId, r]));
  // A sync snapshot always computes open_high (never null — see sync.ts's aggregate query). A null
  // here therefore means a data error, not "zero high alerts", so this repo is treated as not in
  // the baseline at all (GLOOK-43) rather than silently coalesced to 0.
  const compared = [...inView.values()].filter(r => {
    const b = base.get(r.repoId);
    if (!b) return false;
    if (opts.severity === 'high' && b.openHigh === null) return false;
    return true;
  });
  const comparedIds = new Set(compared.map(r => r.repoId));
  const teams = new Map<string, DeltaTeam>();
  const t = (name: string) => {
    if (!teams.has(name)) teams.set(name, { team: name, deltaOpen: 0, new: 0, resolved: 0, dismissed: 0, reopened: 0, other: 0 });
    return teams.get(name)!;
  };
  for (const r of compared) {
    const b = base.get(r.repoId)!;
    t(teamOf(r)).deltaOpen -= Number((opts.severity === 'critical' ? b.openCritical : b.openHigh) ?? 0);
  }
  const since = set.measuredAt;
  for (const a of alerts) {
    if (a.severity !== opts.severity || !comparedIds.has(a.repoId)) continue;
    const r = inView.get(a.repoId)!;
    const row = t(teamOf(r));
    if (isOpen(a, r)) row.deltaOpen++;
    if (a.createdAt > since) row.new++;
    if (a.resolvedAt && a.resolvedAt > since && !a.withdrawn) { row.resolved++; if (isDismissed(a)) row.dismissed++; }
    if (a.lastReopenedAt && a.lastReopenedAt > since) row.reopened++;
  }
  const list = [...teams.values()].map(x => ({ ...x, other: x.deltaOpen - (x.new - x.resolved + x.reopened) }))
    .sort((a, b) => a.team.localeCompare(b.team));
  const total = list.reduce((acc, x) => ({
    team: 'Total', deltaOpen: acc.deltaOpen + x.deltaOpen, new: acc.new + x.new, resolved: acc.resolved + x.resolved,
    dismissed: acc.dismissed + x.dismissed, reopened: acc.reopened + x.reopened, other: acc.other + x.other,
  }), { team: 'Total', deltaOpen: 0, new: 0, resolved: 0, dismissed: 0, reopened: 0, other: 0 });
  return { available: true, baseline: set, reposNotInBaseline: inView.size - compared.length, teams: list, total };
}

export interface TrendSeries { team: string; points: Array<{ date: string; open: number }> }

export function computeTrend(
  rows: SnapshotRow[], repos: RepoFact[], opts: { codebase: CodebaseGroup; team?: string; severity: Severity; since?: string },
): TrendSeries[] {
  const inView = viewRepos(repos, opts.codebase, opts.team);
  const chosen = new Set(pickTrendSets(rows, { codebase: opts.codebase, severity: opts.severity, since: opts.since }).map(s => s.key));
  const acc = new Map<string, Map<string, number>>(); // team → date → open
  for (const r of rows) {
    if (!chosen.has(setKey(r))) continue;
    const repo = inView.get(r.repoId);
    if (!repo) continue;
    const v = opts.severity === 'critical' ? r.openCritical : r.openHigh;
    if (v === null || v === undefined) continue;
    const team = teamOf(repo);
    if (!acc.has(team)) acc.set(team, new Map());
    const m = acc.get(team)!;
    m.set(r.takenOn, (m.get(r.takenOn) ?? 0) + Number(v));
  }
  return [...acc.entries()].map(([team, m]) => ({
    team, points: [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, open]) => ({ date, open })),
  })).sort((a, b) => a.team.localeCompare(b.team));
}
