// Shared by /api/vulnerabilities/* and the MCP tools, so the dashboard and an agent can never disagree.
import db from '../db/index';
import { getVulnerabilitiesOrg, getSyncSchedule, getVulnConfig } from './config';
import { getSyncProgress, type SyncProgress } from './progress';
import { rowToAlertFact, rowToRepoFact } from './db-helpers';
import {
  computePivot, computeKpi, computeCoverage, listAlerts, computeDelta, computeTrend, snapshotSets, pickBaseline, knownTeams, teamOf, setKey,
  pickTrendSets,
} from './aggregate';
import { isInScope } from './codebase';
import { policyWindows, slaStatus } from './sla';
import { getNextSyncRun, isSyncRunning } from './scheduler';
import type { ParsedFilters } from './filters';
import type { AlertFact, ConfigError, RepoFact, ResolvedSince, SnapshotRow, TriggerKind } from './types';
import type { SnapshotSet, SnapshotSetRow } from './aggregate';
import type { SyncIssue } from './sync';

export const REASON_DISABLED = 'Vulnerability tracking is not enabled on this Glooker instance.';
export const REASON_NO_SYNC = 'No successful vulnerability sync yet.';
const STALE_MS = 36 * 3600 * 1000;

export interface SyncStatusInfo {
  lastSuccessfulAt: string | null; stale: boolean; lastStatus: string | null; running: boolean;
  issuesCount: number; issues: Array<{ repo?: string; kind: string; message: string }>;
}
export type Unavailable = { available: false; reason: string; sync?: SyncStatusInfo; configErrors?: ConfigError[] };
export type UnknownFilter =
  | { error: 'unknown team'; known_teams: string[] }
  | { error: 'unknown repo' }
  | { error: 'repo not tracked'; repo: string; service_tier: string | null };

export async function getSyncStatus(org: string, now: Date): Promise<SyncStatusInfo> {
  const [last] = await db.execute<any>(`SELECT status, issues FROM vulnerability_syncs WHERE org = ? ORDER BY id DESC LIMIT 1`, [org]);
  const [ok] = await db.execute<any>(
    `SELECT finished_at FROM vulnerability_syncs WHERE org = ? AND status IN ('succeeded','partial') ORDER BY id DESC LIMIT 1`, [org]);
  const lastSuccessfulAt: string | null = ok[0]?.finished_at ?? null;
  const issues = JSON.parse(last[0]?.issues ?? '[]');
  return {
    lastSuccessfulAt, lastStatus: last[0]?.status ?? null, running: isSyncRunning(),
    stale: lastSuccessfulAt === null || now.getTime() - Date.parse(lastSuccessfulAt) > STALE_MS,
    issuesCount: issues.length, issues: issues.slice(0, 5),
  };
}

/**
 * The carried-resolved-critical query. A repo qualifies when it's `archived`, has zero
 * rows in `vulnerability_alerts`, and has at least one `csv-import` snapshot — its carry is that
 * snapshot's `resolved_critical_since_start`, picking the latest by `taken_on` then `measured_at`
 * when more than one exists. Written as two correlated NOT EXISTS subqueries (rather than a
 * SQLite-only window function or a MySQL-only construct) so it runs unchanged on both DB backends.
 * There is no high counterpart — the CSVs never measured high.
 */
async function loadCarriedResolvedCritical(org: string): Promise<Map<number, number>> {
  const [rows] = await db.execute<any>(
    `SELECT r.repo_id AS repo_id, s.resolved_critical_since_start AS resolved_critical
     FROM vulnerability_repos r
     JOIN vulnerability_repo_snapshots s
       ON s.repo_id = r.repo_id AND s.org = r.org AND s.source = 'csv-import'
     WHERE r.org = ?
       AND r.archived = 1
       AND NOT EXISTS (
         SELECT 1 FROM vulnerability_alerts a WHERE a.repo_id = r.repo_id AND a.org = r.org
       )
       AND NOT EXISTS (
         SELECT 1 FROM vulnerability_repo_snapshots s2
         WHERE s2.repo_id = r.repo_id AND s2.org = r.org AND s2.source = 'csv-import'
           AND (s2.taken_on > s.taken_on
                OR (s2.taken_on = s.taken_on AND s2.measured_at > s.measured_at)
                OR (s2.taken_on = s.taken_on AND s2.measured_at = s.measured_at AND s2.id > s.id))
       )`,
    [org],
  );
  const m = new Map<number, number>();
  for (const row of rows) m.set(Number(row.repo_id), Number(row.resolved_critical));
  return m;
}

/** Test-only: lets a test check the SQL's qualification rules on their own, without computePivot's
 * own re-check of the same rules hiding a regression in the query. */
export const __loadCarriedResolvedCritical = loadCarriedResolvedCritical;

/**
 * GLOOK-43 Wave P: the sync side of the one `configErrors` channel. Reads the latest
 * succeeded/partial sync's `issues` for `kind: 'config'` entries (sync.ts's taxonomy guard —
 * e.g. VULN_TIER_IN_SCOPE matching no repo) and maps them to the same `ConfigError` shape the
 * startup side (`getVulnConfig().errors`) produces, so prepare() can concatenate the two without
 * the caller needing to know which side an entry came from. A later `failed` run is excluded by
 * the `status IN ('succeeded','partial')` filter, so it can never clear a still-standing config
 * error from the last good sync. `issues` is trusted, well-formed JSON written by sync.ts itself
 * (same convention as getSyncStatus above) — a malformed row is a bug worth a loud failure, not a
 * silently-dropped one, so JSON.parse is deliberately unguarded here.
 */
async function syncConfigErrors(org: string): Promise<ConfigError[]> {
  const [rows] = await db.execute<any>(
    `SELECT finished_at, issues FROM vulnerability_syncs WHERE org = ? AND status IN ('succeeded','partial') ORDER BY id DESC LIMIT 1`, [org]);
  const r = rows[0];
  if (!r) return [];
  return (JSON.parse(r.issues ?? '[]') as SyncIssue[])
    .filter(i => i.kind === 'config' && i.variable)
    .map(i => ({ source: 'sync' as const, variable: i.variable!, rule: i.message, at: r.finished_at }));
}

async function loadRepos(org: string): Promise<RepoFact[]> {
  const [repoRows] = await db.execute<any>('SELECT * FROM vulnerability_repos WHERE org = ?', [org]);
  // Loaded inside the same cached call as the repos themselves (never after loadFacts's cache-key
  // await), so it invalidates and refreshes exactly when the repos list does — no separate cache
  // entry to keep in sync. A CSV re-import that doesn't change the repo count (see the docs
  // caveat) only refreshes this on the next sync or a server restart, same as everything else
  // loadRepos returns.
  const carried = await loadCarriedResolvedCritical(org);
  return repoRows.map((r: any) => {
    const fact = rowToRepoFact(r);
    const c = carried.get(fact.repoId);
    return c === undefined ? fact : { ...fact, carriedResolvedCritical: c };
  });
}

async function loadAlerts(org: string): Promise<AlertFact[]> {
  const [alertRows] = await db.execute<any>('SELECT * FROM vulnerability_alerts WHERE org = ?', [org]);
  return alertRows.map(rowToAlertFact);
}

/**
 * Facts cache (GLOOK-43): repos and alerts don't change between two requests unless a
 * sync (or a CSV import, which also upserts vulnerability_repos) has run, so re-querying every
 * alert on every dashboard request is pure waste on a large org. The
 * cache key is two cheap queries — the newest succeeded/partial sync id, and the repo count — so a
 * sync (or a repo-adding CSV import) invalidates it without needing an explicit bust call from
 * sync.ts. A single module-level entry is enough: this module is per-process and (per the spec)
 * targets one org.
 *
 * Alerts are cached separately from the key computation so the trend endpoint's `loadAlerts: false`
 * path still never runs the alerts SELECT at all, not even once to warm
 * a cache entry it doesn't need.
 */
/**
 * The cache holds in-flight PROMISES, not resolved values (GLOOK-43, fixing a race in
 * the original design above). The old shape stored resolved arrays and wrote
 * `factsCache.alerts = await loadAlerts(org)` onto whatever the module variable pointed to *after*
 * the await — if a concurrent caller had already replaced `factsCache` with a different entry in
 * the meantime, that write (and the read right after it) landed on the wrong object, and a caller
 * could observe `alerts` still `null` where a plain array was expected, throwing deep inside
 * aggregate.ts. Caching the promise instead means every concurrent caller for the same key awaits
 * the *same* promise, so there's only ever one winner and no "old object, new object" split.
 */
let factsCache: { key: string; repos: Promise<RepoFact[]>; alerts: Promise<AlertFact[]> | null } | null = null;

/** Test-only: forces the next loadFacts call to reload from the DB. */
export function __clearVulnFactsCache(): void { factsCache = null; }

async function factsCacheKey(org: string): Promise<string> {
  const [[maxRow]] = await db.execute<any>(
    `SELECT MAX(id) AS m FROM vulnerability_syncs WHERE org = ? AND status IN ('succeeded', 'partial')`, [org]);
  const [[cntRow]] = await db.execute<any>(`SELECT COUNT(*) AS n FROM vulnerability_repos WHERE org = ?`, [org]);
  return `${org}:${maxRow?.m ?? 'none'}:${Number(cntRow?.n ?? 0)}`;
}

/** Evicts `entry` from the module-level cache, but only while it's still the current one — a
 * later, unrelated load (a new key, or a retry that already replaced this entry) must not be
 * wiped out by a rejection that belongs to a stale entry. */
function evictIfCurrent(entry: NonNullable<typeof factsCache>): void {
  if (factsCache === entry) factsCache = null;
}

async function loadFacts(org: string, opts: { loadAlerts: boolean }): Promise<{ repos: RepoFact[]; alerts: AlertFact[] }> {
  const key = await factsCacheKey(org);
  // Read/write through a single local `entry` reference for the rest of this call — never the
  // module variable again after this point — so a concurrent caller swapping `factsCache` out
  // from under us can't change which promises THIS call ends up awaiting.
  let entry = factsCache;
  if (!entry || entry.key !== key) {
    const repos = loadRepos(org);
    const newEntry = { key, repos, alerts: null as Promise<AlertFact[]> | null };
    repos.catch(() => evictIfCurrent(newEntry));
    entry = newEntry;
    factsCache = newEntry;
  }
  if (opts.loadAlerts && entry.alerts === null) {
    const alerts = loadAlerts(org);
    const currentEntry = entry;
    alerts.catch(() => evictIfCurrent(currentEntry));
    entry.alerts = alerts;
  }
  const [repos, alerts] = await Promise.all([entry.repos, opts.loadAlerts ? entry.alerts! : Promise.resolve([])]);
  return { repos, alerts };
}

function toSnapshotRow(r: any): SnapshotRow {
  return {
    source: r.source, syncId: r.sync_id === null ? null : Number(r.sync_id), sourceFile: r.source_file ?? null,
    takenOn: r.taken_on, measuredAt: r.measured_at, repoId: Number(r.repo_id),
    openCritical: Number(r.open_critical), openHigh: r.open_high === null ? null : Number(r.open_high),
  };
}

/** The set index (GLOOK-43): one row per snapshot *set* (a sync run or an
 * imported CSV file), not one row per repo — so picking a baseline doesn't require loading every
 * snapshot row an org has ever accumulated. */
async function loadSnapshotIndex(org: string): Promise<SnapshotSetRow[]> {
  const [rows] = await db.execute<any>(
    `SELECT DISTINCT source, sync_id, source_file, taken_on, measured_at FROM vulnerability_repo_snapshots WHERE org = ?`, [org]);
  return rows.map((r: any) => ({
    source: r.source, syncId: r.sync_id === null ? null : Number(r.sync_id), sourceFile: r.source_file ?? null,
    takenOn: r.taken_on, measuredAt: r.measured_at,
  }));
}

/**
 * Loads snapshot rows only for the sets computeTrend will actually plot (GLOOK-43),
 * rather than every snapshot row the org has ever accumulated. `chosen` comes from
 * aggregate.ts's pickTrendSets, so this can never disagree with what computeTrend itself would
 * pick given the same rows.
 */
async function loadTrendSnapshotRows(org: string, chosen: SnapshotSet[]): Promise<SnapshotRow[]> {
  if (chosen.length === 0) return [];
  // SnapshotSet only carries `key` (e.g. "sync:7" / "csv:a.csv"), not the raw syncId/sourceFile —
  // parse it back out rather than widening the shared aggregate.ts type just for this query.
  const syncIds = chosen.filter(s => s.source === 'sync').map(s => Number(s.key.slice('sync:'.length)));
  const csvFiles = chosen.filter(s => s.source === 'csv-import').map(s => s.key.slice('csv:'.length));
  const clauses: string[] = [];
  const params: unknown[] = [org];
  if (syncIds.length) { clauses.push(`sync_id IN (${syncIds.map(() => '?').join(', ')})`); params.push(...syncIds); }
  if (csvFiles.length) { clauses.push(`(source = 'csv-import' AND source_file IN (${csvFiles.map(() => '?').join(', ')}))`); params.push(...csvFiles); }
  const [rows] = await db.execute<any>(
    `SELECT source, sync_id, source_file, taken_on, measured_at, repo_id, open_critical, open_high
     FROM vulnerability_repo_snapshots WHERE org = ? AND (${clauses.join(' OR ')})`, params);
  return rows.map(toSnapshotRow);
}

/** Loads only the rows for one snapshot set, identified by its SnapshotSet.key via setKey(). */
async function loadSnapshotSetRows(org: string, index: SnapshotSetRow[], set: SnapshotSet): Promise<SnapshotRow[]> {
  const idx = index.find(r => setKey(r) === set.key);
  if (!idx) return [];
  const [rows] = idx.source === 'sync'
    ? await db.execute<any>(
        `SELECT source, sync_id, source_file, taken_on, measured_at, repo_id, open_critical, open_high
         FROM vulnerability_repo_snapshots WHERE org = ? AND sync_id = ?`, [org, idx.syncId])
    : await db.execute<any>(
        `SELECT source, sync_id, source_file, taken_on, measured_at, repo_id, open_critical, open_high
         FROM vulnerability_repo_snapshots WHERE org = ? AND source = 'csv-import' AND source_file = ?`, [org, idx.sourceFile]);
  return rows.map(toSnapshotRow);
}

/**
 * Resolves availability and validates team. Returns facts on success.
 * teamScope: 'in-scope' (default) validates team against in-scope repos only (summary/trend/alerts);
 * 'all' validates against every repo Glooker has ever seen (coverage — it deliberately surfaces
 * out-of-scope and untagged repos, so an out-of-scope team must not read as "unknown").
 * The repo check lives only in getAlerts, the one endpoint that filters by repo.
 * loadAlerts: false (trend only) skips the alerts query entirely — trend never reads p.alerts,
 * only p.repos, for team/codebase validation and view-scoping against the snapshot rows it loads
 * separately.
 */
async function prepare(f: ParsedFilters, now: Date, opts: { teamScope?: 'all' | 'in-scope'; loadAlerts?: boolean } = {}):
  Promise<{ org: string; sync: SyncStatusInfo; repos: RepoFact[]; alerts: AlertFact[]; configErrors: ConfigError[] } | Unavailable | UnknownFilter> {
  const org = getVulnerabilitiesOrg();
  // GLOOK-43 Wave P: computed before the org check, so both Unavailable responses carry the
  // startup errors; only the sync half needs a real org to query. The feature-off branch is
  // reachable only by direct callers of this module — the API routes (api/vulnerabilities/
  // _shared.ts) and the MCP tools (vulnCall) return before calling in when the feature is off, so
  // a misspelled org variable reaches operators through env-validation's startup warning, not
  // here. The no-sync-yet branch is the one users see. Never attached to an UnknownFilter payload (unknown team/repo, repo not
  // tracked) below: those are the caller's parameter to fix and retry, not a config problem.
  const configErrors = [...getVulnConfig().errors, ...(org ? await syncConfigErrors(org) : [])];
  if (!org) return { available: false, reason: REASON_DISABLED, configErrors };
  const sync = await getSyncStatus(org, now);
  if (!sync.lastSuccessfulAt) return { available: false, reason: REASON_NO_SYNC, sync, configErrors };
  const { repos, alerts } = await loadFacts(org, { loadAlerts: opts.loadAlerts !== false });
  const teams = opts.teamScope === 'all' ? [...new Set(repos.map(teamOf))].sort() : knownTeams(repos);
  if (f.team && !teams.includes(f.team)) return { error: 'unknown team', known_teams: teams };
  return { org, sync, repos, alerts, configErrors };
}
const failed = (p: any): p is Unavailable | UnknownFilter => 'error' in p || p.available === false;

/** Echoes only the fields the caller consumes, so appliedFilters can't imply a scope the endpoint doesn't apply. */
function pickApplied<T extends object>(f: T, keys: (keyof T)[]): Partial<T> {
  const out: Partial<T> = {};
  for (const k of keys) {
    const v = f[k];
    if (v !== undefined) out[k] = v;
  }
  return out;
}

export async function getSummary(f: ParsedFilters, now: Date = new Date()) {
  const p = await prepare(f, now);
  if (failed(p)) return p;
  const cfg = getVulnConfig();
  const index = await loadSnapshotIndex(p.org);
  const sets = snapshotSets(index);
  const baseline = pickBaseline(sets, f.baseline, now);
  const baselineRows = baseline ? await loadSnapshotSetRows(p.org, index, baseline) : [];
  const resolvedSince: ResolvedSince = { date: cfg.resolvedSince, invalid: cfg.resolvedSinceInvalid };
  return {
    available: true as const, org: p.org, sync: p.sync, appliedFilters: pickApplied(f, ['codebase', 'team', 'baseline']),
    configErrors: p.configErrors,
    // resolvedCountStartDate/resolvedCountInvalid kept for MCP compatibility; resolvedSince is the
    // shape the UI renders through (format.ts's resolvedCaption).
    resolvedCountStartDate: cfg.resolvedSince, resolvedCountInvalid: cfg.resolvedSinceInvalid, resolvedSince,
    scope: { property: cfg.keys.tier, value: cfg.tierInScope },
    policy: policyWindows(cfg.slaPolicy, now),
    slaPolicyInvalid: cfg.slaPolicyInvalid,
    slaStatus: { critical: slaStatus('critical', now), high: slaStatus('high', now) },
    pivot: computePivot(p.alerts, p.repos, { codebase: f.codebase, team: f.team, now }),
    kpi: computeKpi(p.alerts, p.repos, { codebase: f.codebase, team: f.team, now }),
    delta: {
      critical: computeDelta(p.alerts, p.repos, baselineRows, baseline, { codebase: f.codebase, team: f.team, severity: 'critical' }),
      high: computeDelta(p.alerts, p.repos, baselineRows, baseline, { codebase: f.codebase, team: f.team, severity: 'high' }),
    },
    knownTeams: knownTeams(p.repos),
  };
}

export async function getTrend(f: ParsedFilters, now: Date = new Date()) {
  const p = await prepare(f, now, { loadAlerts: false });
  if (failed(p)) return p;
  const severity = f.severity ?? 'critical';
  const index = await loadSnapshotIndex(p.org);
  const chosen = pickTrendSets(index, { codebase: f.codebase, severity, since: f.since });
  const snaps = await loadTrendSnapshotRows(p.org, chosen);
  return { available: true as const, sync: p.sync, appliedFilters: pickApplied({ ...f, severity }, ['codebase', 'team', 'severity', 'since']),
    configErrors: p.configErrors,
    series: computeTrend(snaps, p.repos, { codebase: f.codebase, team: f.team, severity, since: f.since }) };
}

const ALERT_FILTER_KEYS = [
  'codebase', 'state', 'team', 'repo', 'severity', 'overdue', 'dueSoon', 'dueBefore', 'createdSince',
  'resolvedSince', 'dependencyScope', 'cve', 'ghsa', 'packageName', 'q', 'reopened', 'limit',
] as const;

export async function getAlerts(f: ParsedFilters, now: Date = new Date()) {
  const p = await prepare(f, now);
  if (failed(p)) return p;
  if (f.repo) {
    const r = p.repos.find(r => r.fullName === f.repo);
    if (!r) return { error: 'unknown repo' };
    if (!isInScope(r.serviceTier)) return { error: 'repo not tracked', repo: f.repo, service_tier: r.serviceTier };
  }
  return { available: true as const, sync: p.sync, appliedFilters: pickApplied(f, [...ALERT_FILTER_KEYS]), configErrors: p.configErrors, ...listAlerts(p.alerts, p.repos, f, now) };
}

export async function getCoverage(f: ParsedFilters, now: Date = new Date()) {
  const p = await prepare(f, now, { teamScope: 'all' });
  if (failed(p)) return p;
  return { available: true as const, sync: p.sync, appliedFilters: pickApplied(f, ['team']), configErrors: p.configErrors, ...computeCoverage(p.alerts, p.repos, { team: f.team }) };
}

/** One row of `listSyncs`'s `syncs` array — also the shape the syncs tab (`vulnerability-syncs-tab.tsx`)
 * renders directly, so its `data.syncs.map(...)` isn't typed as `any` (GLOOK-43). */
export interface SyncRunRow {
  id: number; triggerKind: TriggerKind; triggeredBy: string | null; status: 'running' | 'succeeded' | 'partial' | 'failed';
  startedAt: string; finishedAt: string | null; alertsFetched: number | null; reposChecked: number | null;
  newCount: number | null; resolvedCount: number | null; reopenedCount: number | null; missingCount: number | null;
  issues: Array<{ repo?: string; kind: string; message: string }>;
}
export type ListSyncsResponse =
  | { available: false; reason: string }
  | { available: true; running: boolean; schedule: { cron: string; tz: string; next_run: string | null }; syncs: SyncRunRow[] };

export async function listSyncs(limit = 30): Promise<ListSyncsResponse> {
  const org = getVulnerabilitiesOrg();
  if (!org) return { available: false as const, reason: REASON_DISABLED };
  // Bound to a STRING: mysql2's execute() (prepared statements) fails on MySQL 8.0.22+ when LIMIT
  // is bound as a JS number — same convention as clampLimit in src/lib/mcp/queries.ts.
  const n = Number.isFinite(limit) ? limit : 30;
  const bound = String(Math.floor(Math.min(Math.max(n, 1), 200)));
  const [rows] = await db.execute<any>(
    `SELECT * FROM vulnerability_syncs WHERE org = ? ORDER BY id DESC LIMIT ?`, [org, bound]);
  const { cron, tz } = getSyncSchedule();
  return {
    available: true as const, running: isSyncRunning(),
    schedule: { cron, tz, next_run: getNextSyncRun() },
    syncs: rows.map((r: any) => ({
      id: Number(r.id), triggerKind: r.trigger_kind, triggeredBy: r.triggered_by, status: r.status,
      startedAt: r.started_at, finishedAt: r.finished_at, alertsFetched: r.alerts_fetched, reposChecked: r.repos_checked,
      newCount: r.new_count, resolvedCount: r.resolved_count, reopenedCount: r.reopened_count, missingCount: r.missing_count,
      issues: JSON.parse(r.issues ?? '[]'),
    })),
  };
}

export class SyncNotFoundError extends Error {
  constructor(id: number) {
    super(`Vulnerability sync not found: ${id}`);
    this.name = 'SyncNotFoundError';
  }
}

/**
 * GLOOK-43 follow-up: the syncs tab's per-card progress view, mirroring
 * `getReportProgress` (`src/lib/report/service.ts`). The in-process store (`progress.ts`) is the
 * live path while a sync is running in THIS process; a store miss falls back to the DB row so a
 * fresh process (after a restart) or a finished-but-never-observed sync still returns something
 * sensible rather than 404ing a real, finished sync.
 */
export async function getSyncProgressView(id: number): Promise<SyncProgress> {
  const stored = getSyncProgress(id);
  if (stored) return stored;

  const org = getVulnerabilitiesOrg();
  const [rows] = await db.execute<any>(
    `SELECT status FROM vulnerability_syncs WHERE id = ? AND org = ?`, [id, org]);
  const row = rows[0];
  if (!row) throw new SyncNotFoundError(id);
  if (row.status === 'running') return { status: 'running', step: 'Running…', done: 0, total: 0, logs: [] };
  return { status: row.status, step: row.status === 'failed' ? 'Failed' : 'Done', done: 0, total: 0, logs: [] };
}
