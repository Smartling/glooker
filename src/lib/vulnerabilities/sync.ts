// One sync = a fetch phase (nothing written) + one write transaction. A run that fails
// before the transaction commits leaves every vulnerability table exactly as it was.
import db from '../db/index';
import type { DB } from '../db/index';
import { upsertRows, insertRows, bool, RESOLVED_AT_SQL } from './db-helpers';
import { isInScope, codebaseGroupOf } from './codebase';
import { getVulnConfig } from './config';
import { updateSyncProgress, addSyncLog } from './progress';
import { toIsoSecond } from './time';
import type {
  VulnerabilitySource, FetchedAlert, FetchedRepo, FetchedRepoProperties, RepoAlertStatus, TriggerKind,
} from './types';

export interface SyncIssue { repo?: string; kind: string; message: string; variable?: string }
export interface SyncOutcome { status: 'succeeded' | 'partial' | 'failed'; issues: SyncIssue[] }

/**
 * GLOOK-43: kinds that describe something worth surfacing but that never, by
 * themselves, make a run `partial` — the data written is still fully valid either way.
 * `data-sanitized` reports 4-byte characters replaced or values clipped; `completeness-
 * recovered` (C5) reports alerts marked missing by the two-consecutive-sweep recovery rule. Every
 * other kind (`repo-status`, `completeness`, `repo-list-incomplete`, `write`, `fetch`, `config`)
 * counts toward `status`. This mirrors the `COUNTABLE_SKIP_CLASSIFICATIONS` pattern in
 * report-runner/types.ts: one explicit set, not a scattered set of ad hoc checks, so a future
 * issue kind is a deliberate decision about whether it's informational, not a default.
 */
const INFORMATIONAL_ISSUE_KINDS = new Set(['data-sanitized', 'completeness-recovered']);
const isInformational = (i: SyncIssue): boolean => INFORMATIONAL_ISSUE_KINDS.has(i.kind);
/** Non-informational issues first (so a fatal issue set by the caller stays at index 0),
 * informational issues listed after all others. */
const assembleIssues = (issues: SyncIssue[]): SyncIssue[] =>
  [...issues.filter(i => !isInformational(i)), ...issues.filter(isInformational)];

interface FetchResult {
  repos: FetchedRepo[];
  props: Map<number, FetchedRepoProperties>;
  alerts: FetchedAlert[];
  statuses: Map<number, RepoAlertStatus>;
  /** GLOOK-43: how many string values were sanitized (bmpOnly) or clipped across the
   * repos/properties/alerts fetch calls this run, rolled into one informational issue below. */
  dataNotice: { sanitized: number; clipped: number };
  /** GLOOK-43 Wave P: whether each configured property key appeared on at least one repo this
   * sweep, for the sync-time taxonomy guard below. */
  keysSeen: { team: boolean; tier: boolean; codebase: boolean };
}

export async function insertRunningSync(org: string, trigger: TriggerKind, triggeredBy: string | null, now: Date = new Date()): Promise<number> {
  const [res] = await db.execute<any>(
    `INSERT INTO vulnerability_syncs (org, trigger_kind, triggered_by, status, started_at) VALUES (?, ?, ?, 'running', ?)`,
    [org, trigger, triggeredBy, toIsoSecond(now)],
  );
  return Number((res as any).insertId);
}

/**
 * True for a rate limit (primary or secondary) that withRetry (github.ts) has already
 * exhausted its budget on and rethrown — as opposed to a genuine permission denial.
 * Reads headers off err.response.headers (octokit shape) falling back to err.headers.
 */
function isRateLimited(err: unknown): boolean {
  const status = (err as any)?.status ?? (err as any)?.response?.status;
  if (status === 429) return true;
  if (status !== 403) return false;
  const headers = (err as any)?.response?.headers ?? (err as any)?.headers ?? {};
  const retryAfter = headers['retry-after'] ?? headers['Retry-After'];
  const remaining = headers['x-ratelimit-remaining'] ?? headers['X-RateLimit-Remaining'];
  const raw = err instanceof Error ? err.message : String(err);
  return retryAfter != null || remaining === '0' || /rate limit|abuse detection/i.test(raw);
}

/** GLOOK-43: `3m07s` style, for the completion log line. Minutes are never
 * omitted (even "0m05s"), so every completion line has the same shape to scan. */
function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}m${String(s).padStart(2, '0')}s`;
}

/** Wraps a fetch-phase call so a thrown error carries which step produced it. */
async function withStep<T>(step: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err && typeof err === 'object') (err as any).vulnStep = step;
    throw err;
  }
}

export function permissionMessage(err: unknown): string {
  const status = (err as any)?.status ?? (err as any)?.response?.status;
  const step = (err as any)?.vulnStep;
  const raw = err instanceof Error ? err.message : String(err);
  if (isRateLimited(err)) {
    const phase = step ? `${step} fetch` : 'the sync';
    return `GitHub rate limit exhausted after retries during ${phase} — the next sync will retry (GitHub said: ${raw})`;
  }
  if (status === 401) {
    return `token invalid or expired (GitHub said: ${raw})`;
  }
  if (status === 404 && (step === 'repos' || step === 'properties' || step === 'alerts')) {
    return `org not found or not visible to the token — check VULNERABILITIES_ORG (GitHub said: ${raw})`;
  }
  if (status === 403) {
    if (step === 'properties') {
      return `token cannot read org custom properties: needs org Custom properties: read (GitHub said: ${raw})`;
    }
    return `token cannot read org Dependabot alerts: the account must be an org owner or security manager, with Dependabot alerts: read (GitHub said: ${raw})`;
  }
  return raw;
}

async function fetchPhase(syncId: number, org: string, source: VulnerabilitySource, log: (m: string) => void): Promise<FetchResult> {
  let sanitized = 0, clipped = 0;
  const onDataNotice = (kind: 'sanitized' | 'clipped', count: number) => { if (kind === 'sanitized') sanitized += count; else clipped += count; };
  updateSyncProgress(syncId, { step: 'Fetching repos…', done: 0, total: 0 });
  log('fetching repos');
  const repos = await withStep('repos', () => source.listOrgReposForVulns(org, log, onDataNotice));
  updateSyncProgress(syncId, { step: 'Fetching custom properties…', done: 0, total: 0 });
  log('fetching properties');
  const propsResult = await withStep('properties', () => source.listOrgRepoProperties(org, getVulnConfig().keys, log, onDataNotice));
  const props = new Map(propsResult.rows.map(p => [p.repoId, p]));
  updateSyncProgress(syncId, { step: 'Fetching alerts…', done: 0, total: 0 });
  log('fetching alerts');
  const alerts = await withStep('alerts', () => source.listOrgDependabotAlerts(org, log, onDataNotice));
  const withAlerts = new Set(alerts.map(a => a.repoId));
  // GLOOK-43: a repo needs a status check only when it's zero-alert and in scope —
  // computed up front (before the loop mutates anything) purely so the count in the log line
  // matches exactly how many `getRepoDependabotStatus` calls the loop below is about to make.
  const toCheck = repos.filter(r => !r.archived && !withAlerts.has(r.repoId) && isInScope(props.get(r.repoId)?.serviceTier ?? null));
  log(`checking Dependabot status of ${toCheck.length} repos`);
  const statuses = new Map<number, RepoAlertStatus>();
  let checked = 0;
  for (const r of repos) {
    if (r.archived) { statuses.set(r.repoId, { status: 'archived' }); continue; }
    if (withAlerts.has(r.repoId)) { statuses.set(r.repoId, { status: 'ok' }); continue; }
    if (!isInScope(props.get(r.repoId)?.serviceTier ?? null)) { statuses.set(r.repoId, { status: 'ok' }); continue; }
    statuses.set(r.repoId, await withStep('repo-status', () => source.getRepoDependabotStatus(r.fullName, log)));
    checked++;
    updateSyncProgress(syncId, { step: `[${checked}/${toCheck.length}] Checking Dependabot status`, done: checked, total: toCheck.length });
    if (checked % 50 === 0) log(`status checks: ${checked}/${toCheck.length}`);
  }
  return { repos, props, alerts, statuses, dataNotice: { sanitized, clipped }, keysSeen: propsResult.keysSeen };
}

const REPO_COLS = ['repo_id', 'org', 'full_name', 'team', 'service_tier', 'codebase_type', 'archived',
  'dependabot_status', 'dependabot_status_detail', 'first_seen_at', 'last_seen_at'];
const ALERT_COLS = ['repo_id', 'number', 'org', 'html_url', 'state', 'severity', 'severity_changed_at', 'ghsa_id', 'cve_id',
  'summary', 'cvss_score', 'epss_percentage', 'advisory_withdrawn_at', 'package_name', 'ecosystem', 'manifest_path',
  'relationship', 'scope', 'first_patched_version', 'created_at', 'gh_updated_at', 'fixed_at', 'dismissed_at',
  'auto_dismissed_at', 'dismissed_reason', 'reopened_count', 'last_reopened_at', 'missing_since', 'withheld_since',
  'first_seen_sync_id', 'last_seen_sync_id'];
const SNAP_COLS = ['org', 'source', 'sync_id', 'source_file', 'taken_on', 'measured_at', 'repo_id', 'full_name',
  'team_at_time', 'service_tier_at_time', 'codebase_type_at_time', 'archived', 'open_critical', 'open_high',
  'resolved_critical_since_start', 'resolved_high_since_start'];

interface Prior {
  state: string; severity: string; severity_changed_at: string | null; reopened_count: number;
  last_reopened_at: string | null; missing_since: string | null; withheld_since: string | null; first_seen_sync_id: number;
}

async function writePhase(tx: DB, org: string, syncId: number, f: FetchResult, at: string) {
  const [prevOk] = await tx.execute<any>(
    `SELECT COUNT(*) AS n FROM vulnerability_syncs WHERE org = ? AND status IN ('succeeded', 'partial')`, [org]);
  const firstSync = Number(prevOk[0].n) === 0;

  // 1. repos
  await upsertRows(tx, 'vulnerability_repos', REPO_COLS, REPO_COLS.filter(c => c !== 'repo_id' && c !== 'first_seen_at'),
    f.repos.map(r => {
      const p = f.props.get(r.repoId);
      const st = f.statuses.get(r.repoId) ?? { status: 'ok' as const };
      return [r.repoId, org, r.fullName, p?.team ?? null, p?.serviceTier ?? null, p?.codebaseType ?? null, bool(r.archived),
        st.status, (st.status === 'error' || st.status === 'dependabot-off') ? st.detail : null, at, at];
    }));

  // 2. alerts, diffed against what's stored
  const [priorRows] = await tx.execute<any>(
    `SELECT repo_id, number, state, severity, severity_changed_at, reopened_count, last_reopened_at, missing_since, withheld_since, first_seen_sync_id
     FROM vulnerability_alerts WHERE org = ?`, [org]);
  const prior = new Map<string, Prior>(priorRows.map((r: any) => [`${r.repo_id}:${r.number}`, r]));
  let newCount = 0, resolvedCount = 0, reopenedCount = 0;
  const seen = new Set<string>();
  const rows = f.alerts.map(a => {
    const key = `${a.repoId}:${a.number}`;
    seen.add(key);
    const p = prior.get(key);
    if (!p) newCount++;
    const reopened = !!p && p.state !== 'open' && a.state === 'open';
    if (reopened) reopenedCount++;
    if (p && p.state === 'open' && a.state !== 'open') resolvedCount++;
    const sevChangedAt = p && p.severity !== a.severity ? at : (p?.severity_changed_at ?? null);
    return [a.repoId, a.number, org, a.htmlUrl, a.state, a.severity, sevChangedAt, a.ghsaId, a.cveId, a.summary,
      a.cvssScore, a.epssPercentage, a.advisoryWithdrawnAt, a.packageName, a.ecosystem, a.manifestPath,
      a.relationship, a.scope, a.firstPatchedVersion, a.createdAt, a.updatedAt, a.fixedAt, a.dismissedAt,
      a.autoDismissedAt, a.dismissedReason,
      Number(p?.reopened_count ?? 0) + (reopened ? 1 : 0), reopened ? at : (p?.last_reopened_at ?? null),
      null /* missing_since cleared when seen */, null /* withheld_since cleared when seen */,
      p ? Number(p.first_seen_sync_id) : syncId, syncId];
  });
  await upsertRows(tx, 'vulnerability_alerts', ALERT_COLS,
    ALERT_COLS.filter(c => !['repo_id', 'number', 'first_seen_sync_id'].includes(c)), rows);

  // 3. completeness (GLOOK-50 lesson): collect the newly-missing
  // candidates *before* writing anything. If a sweep comes back with far fewer open alerts than
  // the store already has, that's much more likely a broken/partial sweep (a paging bug, a
  // truncated response) than that many alerts genuinely closing between two syncs — so withhold
  // the missing marks rather than silently wipe out "open" state for repos GitHub simply didn't
  // report this time.
  //
  // A candidate is EXPLAINABLE (its repo was deleted/transferred out of this sweep, or is
  // archived in this sweep) — those are always marked missing immediately; an archival or a repo
  // vanishing from the org's repo list is a real, self-evident reason for its alerts to disappear,
  // not a sign of a broken sweep. Everything else is UNEXPLAINED and goes through the guard.
  //
  // Recovery: a candidate already carrying `withheld_since` from an earlier withheld run is forced
  // missing now regardless of this run's guard outcome — a real truncation almost never hides the
  // same alerts twice in a row, while a real mass re-rating/closure always does, so two consecutive
  // withholds of the *same* alert is treated as proof it's real. This is what keeps the guard from
  // wedging forever on a permanently-reduced count. Only FRESH (never-withheld) unexplained
  // candidates count toward the trip threshold — a candidate being resolved via recovery this run
  // isn't "still being withheld", so it must not re-trip the guard.
  const priorOpen = [...prior.values()].filter(p => p.state === 'open' && !p.missing_since).length;
  const sweepRepoIds = new Set(f.repos.map(r => r.repoId));
  const archivedRepoIds = new Set(f.repos.filter(r => r.archived).map(r => r.repoId));
  // GLOOK-43: the repo listing itself can be incomplete this sweep — proven by a
  // fetched alert or property row referencing a repo the listing didn't return. When that's true,
  // "this repo is absent from the listing" is no longer a trustworthy, self-evident reason for a
  // candidate's alerts to disappear — the repo could just be another casualty of the same
  // incomplete listing. So absent-repo candidates lose their explainable status (and go through
  // the guard like any other unexplained candidate) whenever the listing is proven incomplete;
  // an archived-in-this-sweep repo stays explainable regardless, since archival is observed
  // directly on the repo row, not inferred from its absence.
  const repoListIncomplete = f.alerts.some(a => !sweepRepoIds.has(a.repoId)) || [...f.props.keys()].some(id => !sweepRepoIds.has(id));
  // GLOOK-43: name the specific repos that proved the listing incomplete (up to 10,
  // plus the total count), so an operator debugging a `partial` run doesn't have to guess which
  // ones — preferring the fetched alert's repoFullName, falling back to the property row's
  // fullName, and finally the bare id if somehow neither is present.
  let repoListIncompleteDetail: { total: number; names: string[] } | null = null;
  if (repoListIncomplete) {
    const offendingIds: number[] = [];
    const seenOffending = new Set<number>();
    const addOffending = (id: number) => { if (!seenOffending.has(id)) { seenOffending.add(id); offendingIds.push(id); } };
    for (const a of f.alerts) if (!sweepRepoIds.has(a.repoId)) addOffending(a.repoId);
    for (const id of f.props.keys()) if (!sweepRepoIds.has(id)) addOffending(id);
    const nameFor = (id: number): string =>
      f.alerts.find(a => a.repoId === id)?.repoFullName ?? f.props.get(id)?.fullName ?? String(id);
    repoListIncompleteDetail = { total: offendingIds.length, names: offendingIds.slice(0, 10).map(nameFor) };
  }
  const candidates: Array<{ repoId: number; number: number; explainable: boolean; withheldSince: string | null }> = [];
  for (const [key, p] of prior) {
    if (seen.has(key) || p.state !== 'open' || p.missing_since) continue;
    const [repoId, number] = key.split(':').map(Number);
    const archived = archivedRepoIds.has(repoId);
    const absentFromListing = !sweepRepoIds.has(repoId);
    const explainable = archived || (absentFromListing && !repoListIncomplete);
    candidates.push({ repoId, number, explainable, withheldSince: p.withheld_since });
  }
  const explainableCandidates = candidates.filter(c => c.explainable);
  const unexplained = candidates.filter(c => !c.explainable);
  const freshUnexplained = unexplained.filter(c => !c.withheldSince);
  const recoveredUnexplained = unexplained.filter(c => c.withheldSince);

  let missingCount = 0;
  const markMissing = async (c: { repoId: number; number: number }) => {
    await tx.execute(
      'UPDATE vulnerability_alerts SET missing_since = ?, withheld_since = NULL WHERE repo_id = ? AND number = ?',
      [at, c.repoId, c.number]);
    missingCount++;
  };

  for (const c of explainableCandidates) await markMissing(c);

  const guardTrips = !firstSync && freshUnexplained.length > Math.max(50, Math.ceil(0.05 * priorOpen));
  if (guardTrips) {
    // Recovered candidates are resolved now, guard or no guard — they don't count toward the trip.
    for (const c of recoveredUnexplained) await markMissing(c);
    for (const c of freshUnexplained) {
      await tx.execute('UPDATE vulnerability_alerts SET withheld_since = ? WHERE repo_id = ? AND number = ?', [at, c.repoId, c.number]);
    }
  } else {
    for (const c of unexplained) await markMissing(c);
  }

  // 4. snapshots, computed from the stored rows.
  // GLOOK-43 Wave P: the "since" predicate is conditional on config, and — deliberately —
  // `resolved_critical_since_start`/`resolved_high_since_start` are NEVER written NULL, even when
  // VULN_RESOLVED_SINCE is invalid: both columns are NOT NULL in every schema (schema.sql,
  // db/mysql.ts, db/sqlite.ts). An invalid date just omits the predicate (same as "unset"), so the
  // snapshot stores the all-time count instead. No reader consumes a sync-sourced resolved count
  // (queries.ts's carried-resolved query only reads `csv-import` rows) — the dashboard's "—" comes
  // from the config flag (resolvedSinceInvalid), not from this snapshot, so storing a real number
  // here costs nothing and keeps the NOT NULL contract intact.
  const cfg = getVulnConfig();
  const sinceCond = cfg.resolvedSince ? ` AND ${RESOLVED_AT_SQL} >= ?` : '';
  const sinceParams = cfg.resolvedSince ? [cfg.resolvedSince, cfg.resolvedSince] : [];
  const [agg] = await tx.execute<any>(
    `SELECT repo_id,
       SUM(CASE WHEN severity = 'critical' AND state = 'open' AND missing_since IS NULL THEN 1 ELSE 0 END) AS oc,
       SUM(CASE WHEN severity = 'high' AND state = 'open' AND missing_since IS NULL THEN 1 ELSE 0 END) AS oh,
       SUM(CASE WHEN severity = 'critical' AND state <> 'open' AND advisory_withdrawn_at IS NULL${sinceCond} THEN 1 ELSE 0 END) AS rc,
       SUM(CASE WHEN severity = 'high' AND state <> 'open' AND advisory_withdrawn_at IS NULL${sinceCond} THEN 1 ELSE 0 END) AS rh
     FROM vulnerability_alerts WHERE org = ? GROUP BY repo_id`,
    [...sinceParams, org]);
  const byRepo = new Map<number, any>(agg.map((r: any) => [Number(r.repo_id), r]));
  const [repoRows] = await tx.execute<any>('SELECT * FROM vulnerability_repos WHERE org = ?', [org]);
  await insertRows(tx, 'vulnerability_repo_snapshots', SNAP_COLS, repoRows.map((r: any) => {
    const c = byRepo.get(Number(r.repo_id));
    const archived = Number(r.archived) === 1;
    return [org, 'sync', syncId, null, at.slice(0, 10), at, Number(r.repo_id), r.full_name, r.team, r.service_tier,
      r.codebase_type, bool(archived), archived ? 0 : Number(c?.oc ?? 0), archived ? 0 : Number(c?.oh ?? 0),
      Number(c?.rc ?? 0), Number(c?.rh ?? 0)];
  }));

  const withheld = guardTrips ? { candidates: freshUnexplained.length, priorOpen } : null;
  // recoveredUnexplained is always marked missing above, in either branch (explicitly when the
  // guard trips, via the `unexplained` loop when it doesn't) — so its length reflects exactly how
  // many alerts the two-consecutive-sweep recovery rule (C5) resolved this run.
  const recoveredCount = recoveredUnexplained.length;
  return firstSync
    ? { newCount: null, resolvedCount: null, reopenedCount: null, missingCount: null, withheld, recoveredCount, repoListIncomplete: repoListIncompleteDetail }
    : { newCount, resolvedCount, reopenedCount, missingCount, withheld, recoveredCount, repoListIncomplete: repoListIncompleteDetail };
}

export async function runSync(
  syncId: number, org: string, source: VulnerabilitySource,
  opts: { now?: () => Date; log?: (m: string) => void } = {},
): Promise<SyncOutcome> {
  const now = opts.now ?? (() => new Date());
  // GLOOK-43 follow-up: the default log writes into the progress store AND the server
  // console, same as report-runner.ts:45. A caller-supplied log (tests) is always called too, so
  // the store is populated either way — never made conditional on whether opts.log was passed.
  const log = opts.log
    ? (m: string) => { opts.log!(m); addSyncLog(syncId, m); }
    : (m: string) => { addSyncLog(syncId, m); console.log(`[vuln-sync] ${m}`); };
  const startedAt = now();
  let fetched: FetchResult;
  try {
    fetched = await fetchPhase(syncId, org, source, log);
  } catch (err) {
    const issues = [{ kind: 'fetch', message: permissionMessage(err) }];
    log(`sync failed: ${issues[0].message}`);
    await db.execute(`UPDATE vulnerability_syncs SET status = 'failed', finished_at = ?, issues = ? WHERE id = ?`,
      [toIsoSecond(now()), JSON.stringify(issues), syncId]);
    updateSyncProgress(syncId, { status: 'failed', step: 'Failed' });
    return { status: 'failed', issues };
  }

  const repoStatusIssues: SyncIssue[] = [];
  for (const r of fetched.repos) {
    const st = fetched.statuses.get(r.repoId);
    if (st?.status === 'error') repoStatusIssues.push({ repo: r.fullName, kind: 'repo-status', message: st.detail });
  }
  // GLOOK-43 Wave P: the taxonomy guard. A configured property key that appears on no repo, an
  // in-scope tier that matches no repo, or codebase groups that match no in-scope repo, all mean
  // the deployment configuration doesn't match the org's actual custom-property taxonomy — never
  // informational, since the data written this sweep (team/tier/codebase all null or all "other")
  // would otherwise look like a legitimately untagged org rather than a misconfiguration.
  const keyVar = { team: 'VULN_TEAM_PROPERTY', tier: 'VULN_TIER_PROPERTY', codebase: 'VULN_CODEBASE_PROPERTY' } as const;
  const configIssues: SyncIssue[] = [];
  for (const k of ['team', 'tier', 'codebase'] as const) {
    if (!fetched.keysSeen[k]) configIssues.push({ kind: 'config', variable: keyVar[k], message: `${keyVar[k]}: the configured property key appears on no repo` });
  }
  const inScopeRepos = fetched.repos.filter(r => isInScope(fetched.props.get(r.repoId)?.serviceTier ?? null));
  if (inScopeRepos.length === 0) {
    configIssues.push({ kind: 'config', variable: 'VULN_TIER_IN_SCOPE', message: 'VULN_TIER_IN_SCOPE: no repo has the configured in-scope tier' });
  } else if (inScopeRepos.every(r => codebaseGroupOf(fetched.props.get(r.repoId)?.codebaseType ?? null) === 'other')) {
    configIssues.push({ kind: 'config', variable: 'VULN_CODEBASE_GROUPS', message: 'VULN_CODEBASE_GROUPS: no in-scope repo matches any configured group' });
  }
  // GLOOK-43: how many string values the fetch phase sanitized (bmpOnly) or clipped.
  // Rolled into one informational issue below via INFORMATIONAL_ISSUE_KINDS/assembleIssues.
  const dataNoticeIssues: SyncIssue[] = [];
  const { sanitized, clipped } = fetched.dataNotice;
  if (sanitized + clipped > 0) {
    dataNoticeIssues.push({
      kind: 'data-sanitized',
      message: `${sanitized} values had 4-byte characters replaced and ${clipped} were clipped to column limits`,
    });
  }
  const at = toIsoSecond(now());
  // status/issues are finalized once, inside the transaction, once writePhase's outcome (the
  // completeness guard, repo-list-incompleteness, and the two-sweep recovery rule) is known. On a
  // write failure the catch block below rebuilds failIssues from repoStatusIssues/dataNoticeIssues
  // only, not from these, so a rolled-back run can never report an issue about data that was never
  // actually persisted.
  let status: 'succeeded' | 'partial' = 'succeeded';
  let issues: SyncIssue[] = [];
  updateSyncProgress(syncId, { step: 'Writing results…', done: 0, total: 0 });
  try {
    await db.transaction(async (tx) => {
      const c = await writePhase(tx, org, syncId, fetched, at);
      const writeIssues: SyncIssue[] = [];
      if (c.withheld) {
        writeIssues.push({
          kind: 'completeness',
          message: `sweep returned ${c.withheld.candidates} fewer open alerts than expected `
            + `(${c.withheld.priorOpen} prior open); missing marks withheld — check GitHub pagination. `
            + `An alert still missing on the next eligible run will be marked missing automatically.`,
        });
      }
      // GLOOK-43: NOT informational — a repo referenced by a fetched alert or
      // property, but missing from the repo listing itself, means the listing can't be trusted
      // this sweep, which is exactly the condition the completeness guard exists to catch.
      // Name the offending repos (up to 10) and the total count instead of only
      // saying "a repo" was missing, so an operator debugging a `partial` run can see which ones.
      if (c.repoListIncomplete) {
        const { total, names } = c.repoListIncomplete;
        writeIssues.push({
          kind: 'repo-list-incomplete',
          message: `repo listing incomplete: ${total} repos seen in alerts/properties but absent from `
            + `/orgs/${org}/repos (${names.join(', ')}) — absent-repo misses treated as unexplained`,
        });
      }
      // Informational (C4/C5): reports a real, already-applied recovery, not a problem with this run.
      if (c.recoveredCount > 0) {
        writeIssues.push({
          kind: 'completeness-recovered',
          message: `${c.recoveredCount} previously withheld alerts marked missing after two consecutive sweeps without them`,
        });
      }
      issues = assembleIssues([...repoStatusIssues, ...configIssues, ...writeIssues, ...dataNoticeIssues]);
      status = issues.some(i => !isInformational(i)) ? 'partial' : 'succeeded';
      await tx.execute(
        `UPDATE vulnerability_syncs SET status = ?, finished_at = ?, alerts_fetched = ?, repos_checked = ?,
           new_count = ?, resolved_count = ?, reopened_count = ?, missing_count = ?, issues = ? WHERE id = ?`,
        [status, at, fetched.alerts.length, fetched.repos.length, c.newCount, c.resolvedCount, c.reopenedCount,
          c.missingCount, JSON.stringify(issues), syncId]);
    });
    // GLOOK-43: one completion line once the final status is known, so an operator
    // watching the server console doesn't have to infer a multi-minute run finished from silence.
    log(`sync ${syncId} ${status} in ${formatDuration(now().getTime() - startedAt.getTime())}: `
      + `${fetched.alerts.length} alerts, ${fetched.repos.length} repos, ${issues.length} issues`);
    updateSyncProgress(syncId, { status, step: 'Done' });
  } catch (err) {
    // The fatal issue goes first: banners that show issues[0] must blame the write failure,
    // not whichever repo happened to be first in a repo-status issue collected earlier.
    // assembleIssues would otherwise be safe to use here too (it never moves a non-informational
    // issue behind another non-informational one), but the fatal 'write' issue is prepended
    // explicitly so it is always issues[0], regardless of assembleIssues' internal ordering.
    const failIssues = [{ kind: 'write', message: err instanceof Error ? err.message : String(err) },
      ...assembleIssues([...repoStatusIssues, ...configIssues, ...dataNoticeIssues])];
    log(`sync failed: ${failIssues[0].message}`);
    await db.execute(`UPDATE vulnerability_syncs SET status = 'failed', finished_at = ?, issues = ? WHERE id = ?`,
      [toIsoSecond(now()), JSON.stringify(failIssues), syncId]);
    updateSyncProgress(syncId, { status: 'failed', step: 'Failed' });
    return { status: 'failed', issues: failIssues };
  }
  return { status, issues };
}
