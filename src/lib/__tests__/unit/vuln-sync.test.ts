import fs from 'fs';
import os from 'os';
import path from 'path';
import type { FetchedAlert, VulnerabilitySource } from '@/lib/vulnerabilities/types';
import { __clearVulnConfigCache } from '@/lib/vulnerabilities/config';
import { mapPropertyRows } from '@/lib/vulnerabilities/properties';

let db: any; let insertRunningSync: any; let runSync: any; let permissionMessage: any; let rowToAlertFact: any; let dbPath: string;
const priorSqlitePath = process.env.SQLITE_PATH; const priorDbType = process.env.DB_TYPE;
const priorResolvedSince = process.env.VULN_RESOLVED_SINCE;

beforeAll(async () => {
  dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'glooker-vsync-')), 'test.db');
  process.env.SQLITE_PATH = dbPath; process.env.DB_TYPE = 'sqlite';
  db = (await import('@/lib/db')).default;
  ({ insertRunningSync, runSync, permissionMessage } = await import('@/lib/vulnerabilities/sync'));
  ({ rowToAlertFact } = await import('@/lib/vulnerabilities/db-helpers'));
});
afterAll(() => {
  if (priorSqlitePath === undefined) delete process.env.SQLITE_PATH; else process.env.SQLITE_PATH = priorSqlitePath;
  if (priorDbType === undefined) delete process.env.DB_TYPE; else process.env.DB_TYPE = priorDbType;
  // Safety net: every test below that sets VULN_RESOLVED_SINCE also restores it itself (in a
  // finally), but this catches a test that throws before its finally runs.
  if (priorResolvedSince === undefined) delete process.env.VULN_RESOLVED_SINCE; else process.env.VULN_RESOLVED_SINCE = priorResolvedSince;
  __clearVulnConfigCache();
  try { fs.unlinkSync(dbPath); } catch {}
});
beforeEach(async () => {
  for (const t of ['vulnerability_alerts', 'vulnerability_repos', 'vulnerability_syncs', 'vulnerability_repo_snapshots']) await db.execute(`DELETE FROM ${t}`);
});

const A = (repoId: number, n: number, over: Partial<FetchedAlert> = {}): FetchedAlert => ({
  repoId, repoFullName: `o/r${repoId}`, number: n, htmlUrl: `u/${repoId}/${n}`, state: 'open', severity: 'critical',
  ghsaId: `G${n}`, cveId: null, summary: null, cvssScore: 9.1, epssPercentage: null, advisoryWithdrawnAt: null,
  packageName: 'p', ecosystem: 'npm', manifestPath: 'm', relationship: 'direct', scope: null, firstPatchedVersion: null,
  createdAt: '2026-09-01T00:00:00Z', updatedAt: null, fixedAt: null, dismissedAt: null, autoDismissedAt: null, dismissedReason: null,
  ...over,
});

function source(alerts: FetchedAlert[] | (() => Promise<FetchedAlert[]>), over: Partial<VulnerabilitySource> = {}): VulnerabilitySource {
  return {
    listOrgReposForVulns: async () => [
      { repoId: 1, fullName: 'o/r1', archived: false }, { repoId: 2, fullName: 'o/r2', archived: false },
      { repoId: 3, fullName: 'o/r3', archived: true }, { repoId: 4, fullName: 'o/r4', archived: false },
    ],
    listOrgRepoProperties: async () => ({
      rows: [
        { repoId: 1, fullName: 'o/r1', team: 'T1', serviceTier: 'production', codebaseType: 'backend' },
        { repoId: 2, fullName: 'o/r2', team: 'T2', serviceTier: 'production', codebaseType: 'frontend' },
        { repoId: 3, fullName: 'o/r3', team: 'T1', serviceTier: 'production', codebaseType: 'backend' },
        { repoId: 4, fullName: 'o/r4', team: 'T2', serviceTier: 'production', codebaseType: 'backend' },
      ],
      keysSeen: { team: true, tier: true, codebase: true },
    }),
    listOrgDependabotAlerts: typeof alerts === 'function' ? alerts : async () => alerts,
    getRepoDependabotStatus: async () => ({ status: 'ok' }),
    ...over,
  };
}

async function sync(src: VulnerabilitySource, iso = '2026-09-22T10:00:00Z') {
  const id = await insertRunningSync('o', 'manual', 'a@x', new Date(iso));
  const out = await runSync(id, 'o', src, { now: () => new Date(iso) });
  const [[row]] = await db.execute('SELECT * FROM vulnerability_syncs WHERE id = ?', [id]);
  return { id, out, row };
}

it('first sync: stores alerts, writes snapshots, counters are null, succeeded', async () => {
  const { row, out } = await sync(source([A(1, 1), A(1, 2, { state: 'fixed', fixedAt: '2026-09-10T00:00:00Z' }), A(2, 1, { severity: 'high' })]));
  expect(out.status).toBe('succeeded');
  expect(row).toMatchObject({ status: 'succeeded', finished_at: '2026-09-22T10:00:00Z', alerts_fetched: 3, new_count: null, resolved_count: null, reopened_count: null, missing_count: null });
  const [snaps] = await db.execute('SELECT repo_id, open_critical, open_high, resolved_critical_since_start, measured_at, taken_on FROM vulnerability_repo_snapshots ORDER BY repo_id');
  expect(snaps).toEqual([
    { repo_id: 1, open_critical: 1, open_high: 0, resolved_critical_since_start: 1, measured_at: '2026-09-22T10:00:00Z', taken_on: '2026-09-22' },
    { repo_id: 2, open_critical: 0, open_high: 1, resolved_critical_since_start: 0, measured_at: '2026-09-22T10:00:00Z', taken_on: '2026-09-22' },
    { repo_id: 3, open_critical: 0, open_high: 0, resolved_critical_since_start: 0, measured_at: '2026-09-22T10:00:00Z', taken_on: '2026-09-22' },
    { repo_id: 4, open_critical: 0, open_high: 0, resolved_critical_since_start: 0, measured_at: '2026-09-22T10:00:00Z', taken_on: '2026-09-22' },
  ]);
});

it('with VULN_RESOLVED_SINCE unset, a snapshot counts an old resolution (all time)', async () => {
  const { row } = await sync(source([A(1, 1, { state: 'fixed', fixedAt: '2001-01-01T00:00:00Z' })]));
  expect(row.status).toBe('succeeded');
  const [[s]] = await db.execute('SELECT resolved_critical_since_start FROM vulnerability_repo_snapshots WHERE repo_id = 1');
  expect(s.resolved_critical_since_start).toBe(1);
});

it('with VULN_RESOLVED_SINCE set to a date later than the resolution, the snapshot excludes it', async () => {
  process.env.VULN_RESOLVED_SINCE = '2099-01-01';
  __clearVulnConfigCache();
  try {
    const { row } = await sync(source([A(1, 1, { state: 'fixed', fixedAt: '2001-01-01T00:00:00Z' })]));
    expect(row.status).toBe('succeeded');
    const [[s]] = await db.execute('SELECT resolved_critical_since_start FROM vulnerability_repo_snapshots WHERE repo_id = 1');
    expect(s.resolved_critical_since_start).toBe(0);
  } finally {
    delete process.env.VULN_RESOLVED_SINCE;
    __clearVulnConfigCache();
  }
});

// Amendment #2 (binding, overrides the original plan's NULL/resolvedExpr text): an invalid
// VULN_RESOLVED_SINCE must never write NULL into the NOT NULL resolved_critical_since_start /
// resolved_high_since_start columns. It omits the "since" predicate instead (same as unset),
// storing the all-time count, and the sync still succeeds — the "—" the dashboard shows for an
// invalid date comes from the config flag (resolvedSinceInvalid), not from this snapshot.
it('with VULN_RESOLVED_SINCE invalid, the sync still succeeds and the snapshot stores the all-time count (never NULL)', async () => {
  process.env.VULN_RESOLVED_SINCE = 'not-a-date';
  __clearVulnConfigCache();
  try {
    const { row, out } = await sync(source([A(1, 1, { state: 'fixed', fixedAt: '2001-01-01T00:00:00Z' })]));
    expect(out.status).toBe('succeeded');
    expect(row.status).toBe('succeeded');
    const [[s]] = await db.execute('SELECT resolved_critical_since_start FROM vulnerability_repo_snapshots WHERE repo_id = 1');
    expect(s.resolved_critical_since_start).toBe(1);
    expect(s.resolved_critical_since_start).not.toBeNull();
  } finally {
    delete process.env.VULN_RESOLVED_SINCE;
    __clearVulnConfigCache();
  }
});

it('second sync: counts new/resolved/reopened as per-run transitions and detects a reopen', async () => {
  await sync(source([A(1, 1), A(1, 2, { state: 'fixed', fixedAt: '2026-09-10T00:00:00Z' })]), '2026-09-21T10:00:00Z');
  const { row } = await sync(source([A(1, 1, { state: 'fixed', fixedAt: '2026-09-21T12:00:00Z' }), A(1, 2), A(1, 3)]), '2026-09-22T10:00:00Z');
  expect(row).toMatchObject({ new_count: 1, resolved_count: 1, reopened_count: 1, missing_count: 0 });
  const [[a2]] = await db.execute('SELECT state, reopened_count, last_reopened_at FROM vulnerability_alerts WHERE repo_id = 1 AND number = 2');
  expect(a2).toEqual({ state: 'open', reopened_count: 1, last_reopened_at: '2026-09-22T10:00:00Z' });
});

it('marks an open alert missing only after a complete sweep, and clears it when seen again', async () => {
  await sync(source([A(1, 1), A(1, 2)]), '2026-09-20T10:00:00Z');
  const { row } = await sync(source([A(1, 1)]), '2026-09-21T10:00:00Z');
  expect(row.missing_count).toBe(1);
  const [[m]] = await db.execute('SELECT missing_since FROM vulnerability_alerts WHERE number = 2');
  expect(m.missing_since).toBe('2026-09-21T10:00:00Z');
  await sync(source([A(1, 1), A(1, 2)]), '2026-09-22T10:00:00Z');
  const [[m2]] = await db.execute('SELECT missing_since FROM vulnerability_alerts WHERE number = 2');
  expect(m2.missing_since).toBeNull();
});

it('a fetch failure writes nothing but the failed sync row', async () => {
  await sync(source([A(1, 1)]), '2026-09-21T10:00:00Z');
  const failing = source(async () => { throw Object.assign(new Error('boom'), { status: 502 }); });
  const { row, out } = await sync(failing, '2026-09-22T10:00:00Z');
  expect(out.status).toBe('failed');
  expect(row.status).toBe('failed');
  const [[n]] = await db.execute('SELECT COUNT(*) AS n FROM vulnerability_repo_snapshots');
  expect(n.n).toBe(4); // only the first sync's snapshots
  const [[a]] = await db.execute('SELECT missing_since FROM vulnerability_alerts WHERE number = 1');
  expect(a.missing_since).toBeNull();
});

it('a permission 403 fails with a plain message', async () => {
  const denied = source(async () => { throw Object.assign(new Error('Resource not accessible'), { status: 403 }); });
  const { row, out } = await sync(denied);
  expect(out.status).toBe('failed');
  expect(row.status).toBe('failed');
  expect(JSON.parse(row.issues)[0].message).toMatch(/token cannot read org Dependabot alerts/);
});

it('a write-phase failure rolls back everything (rename + NOT NULL violation in one run), and reports the fatal write issue first', async () => {
  const { id: firstId } = await sync(source([A(1, 1)]), '2026-09-21T10:00:00Z');
  // getRepoDependabotStatus errors on o/r4 too, so `issues` is non-empty *before* the write fails —
  // this is what proves the fatal write issue is placed first, not appended.
  const renamed = source([A(1, 1), A(1, 2, { htmlUrl: null as any })], {
    listOrgReposForVulns: async () => [
      { repoId: 1, fullName: 'o/r1-RENAMED', archived: false }, { repoId: 2, fullName: 'o/r2', archived: false },
      { repoId: 3, fullName: 'o/r3', archived: true }, { repoId: 4, fullName: 'o/r4', archived: false },
    ],
    getRepoDependabotStatus: async (name: string) => (name === 'o/r4' ? { status: 'error', detail: 'HTTP 500: x' } : { status: 'ok' }),
  });
  const { out, row } = await sync(renamed, '2026-09-22T10:00:00Z');
  expect(out.status).toBe('failed');
  expect(row.status).toBe('failed');
  const [[r1]] = await db.execute('SELECT full_name FROM vulnerability_repos WHERE repo_id = 1');
  expect(r1.full_name).toBe('o/r1');                    // the repo upsert (step 1 of the write) was rolled back
  const [[n]] = await db.execute('SELECT COUNT(*) AS n FROM vulnerability_repo_snapshots');
  expect(n.n).toBe(4);                                   // only the first sync's snapshots
  // the alert upsert (step 2 of the write) was rolled back too — alert 1 still points at the
  // first sync, not the failed second one.
  const [[a1]] = await db.execute('SELECT last_seen_sync_id FROM vulnerability_alerts WHERE repo_id = 1 AND number = 1');
  expect(a1.last_seen_sync_id).toBe(firstId);
  const issues = JSON.parse(row.issues);
  expect(issues[0].kind).toBe('write');                  // fatal issue first, so issues[0] never blames a repo
  expect(issues.some((i: any) => i.kind === 'repo-status')).toBe(true);
});

it('records severity_changed_at on a re-rating', async () => {
  await sync(source([A(1, 1, { severity: 'high' })]), '2026-09-21T10:00:00Z');
  await sync(source([A(1, 1, { severity: 'critical' })]), '2026-09-22T10:00:00Z');
  const [[a]] = await db.execute('SELECT severity, severity_changed_at FROM vulnerability_alerts WHERE number = 1');
  expect(a).toEqual({ severity: 'critical', severity_changed_at: '2026-09-22T10:00:00Z' });
});

it('a failed first run followed by a success is still treated as the first sync — counters stay null', async () => {
  const failing = source(async () => { throw Object.assign(new Error('boom'), { status: 502 }); });
  await sync(failing, '2026-09-20T10:00:00Z'); // fails before any succeeded/partial sync exists
  const { row, out } = await sync(source([A(1, 1)]), '2026-09-21T10:00:00Z');
  expect(out.status).toBe('succeeded');
  expect(row).toMatchObject({ new_count: null, resolved_count: null, reopened_count: null, missing_count: null });
});

it('a snapshot excludes a missing alert from its open count', async () => {
  await sync(source([A(1, 1), A(1, 2)]), '2026-09-20T10:00:00Z');
  const { id } = await sync(source([A(1, 1)]), '2026-09-21T10:00:00Z'); // alert 2 marked missing (below threshold)
  const [[s]] = await db.execute('SELECT open_critical FROM vulnerability_repo_snapshots WHERE repo_id = 1 AND sync_id = ?', [id]);
  expect(s.open_critical).toBe(1);
});

it('an out-of-scope zero-alert repo is never status-checked', async () => {
  const statusSpy = jest.fn(async () => ({ status: 'ok' as const }));
  const src = source([], {
    listOrgReposForVulns: async () => [{ repoId: 9, fullName: 'o/r9', archived: false }],
    listOrgRepoProperties: async () => ({
      rows: [{ repoId: 9, fullName: 'o/r9', team: 'T9', serviceTier: 'non-production', codebaseType: 'backend' }],
      keysSeen: { team: true, tier: true, codebase: true },
    }),
    getRepoDependabotStatus: statusSpy,
  });
  await sync(src);
  expect(statusSpy).not.toHaveBeenCalled();
});

it('archived repos: open alerts excluded from snapshot open counts, resolved kept', async () => {
  await sync(source([A(3, 1), A(3, 2, { state: 'fixed', fixedAt: '2026-09-10T00:00:00Z' })]));
  const [[s]] = await db.execute('SELECT open_critical, resolved_critical_since_start, archived FROM vulnerability_repo_snapshots WHERE repo_id = 3');
  expect(s).toEqual({ open_critical: 0, resolved_critical_since_start: 1, archived: 1 });
});

it('classifies zero-alert in-scope repos; an error makes the run partial', async () => {
  const src = source([A(1, 1)], {
    getRepoDependabotStatus: async (name: string) => (name === 'o/r4' ? { status: 'error', detail: 'HTTP 500: x' } : { status: 'ok' }),
  });
  const { row, out } = await sync(src);
  expect(out.status).toBe('partial');
  const [repos] = await db.execute('SELECT repo_id, dependabot_status FROM vulnerability_repos ORDER BY repo_id');
  expect(repos).toEqual([
    { repo_id: 1, dependabot_status: 'ok' }, { repo_id: 2, dependabot_status: 'ok' },
    { repo_id: 3, dependabot_status: 'archived' }, { repo_id: 4, dependabot_status: 'error' },
  ]);
  expect(JSON.parse(row.issues)).toEqual([{ repo: 'o/r4', kind: 'repo-status', message: 'HTTP 500: x' }]);
});

it('a repo whose only problem is dependabot-off is succeeded, with no repo-status issue', async () => {
  const src = source([A(1, 1)], {
    getRepoDependabotStatus: async (name: string) =>
      (name === 'o/r4' ? { status: 'dependabot-off', detail: 'Dependabot alerts are disabled for this repository.' } : { status: 'ok' }),
  });
  const { row, out } = await sync(src);
  expect(out.status).toBe('succeeded');
  expect(out.issues).toEqual([]);
  const [[r4]] = await db.execute('SELECT dependabot_status, dependabot_status_detail FROM vulnerability_repos WHERE repo_id = 4');
  expect(r4).toEqual({ dependabot_status: 'dependabot-off', dependabot_status_detail: 'Dependabot alerts are disabled for this repository.' });
  expect(JSON.parse(row.issues)).toEqual([]);
});

it('logs step lines and exactly one completion line with the status', async () => {
  const log = jest.fn();
  const id = await insertRunningSync('o', 'manual', 'a@x', new Date('2026-09-22T10:00:00Z'));
  const out = await runSync(id, 'o', source([A(1, 1)]), { now: () => new Date('2026-09-22T10:00:00Z'), log });
  expect(out.status).toBe('succeeded');
  expect(log).toHaveBeenCalledWith('fetching repos');
  expect(log).toHaveBeenCalledWith('fetching properties');
  expect(log).toHaveBeenCalledWith('fetching alerts');
  expect(log).toHaveBeenCalledWith(expect.stringMatching(/^checking Dependabot status of \d+ repos$/));
  const completionLines = log.mock.calls.map(c => String(c[0])).filter(m => m.startsWith('sync '));
  expect(completionLines).toHaveLength(1); // don't assert on the timing value itself
  expect(completionLines[0]).toMatch(new RegExp(`^sync ${id} succeeded in \\d+m\\d{2}s: \\d+ alerts, \\d+ repos, \\d+ issues$`));
});

it('withdrawn advisories are not counted as resolved', async () => {
  await sync(source([A(1, 1, { state: 'fixed', fixedAt: '2026-09-10T00:00:00Z', advisoryWithdrawnAt: '2026-09-11T00:00:00Z' })]));
  const [[s]] = await db.execute('SELECT resolved_critical_since_start FROM vulnerability_repo_snapshots WHERE repo_id = 1');
  expect(s.resolved_critical_since_start).toBe(0);
});

it('completeness guard: withholds missing marks when a sweep returns far fewer open alerts than prior open, and reports a partial run', async () => {
  const hundred = Array.from({ length: 100 }, (_, i) => A(1, i + 1));
  await sync(source(hundred), '2026-09-20T10:00:00Z');
  const forty = Array.from({ length: 40 }, (_, i) => A(1, i + 1)); // 60 missing
  const { row, out } = await sync(source(forty), '2026-09-21T10:00:00Z');
  expect(out.status).toBe('partial');
  expect(row.status).toBe('partial');
  expect(row.missing_count).toBe(0);
  // message text changed to name the recovery step, and withheld_since is now recorded
  // on the withheld candidates instead of leaving them with no trace.
  expect(JSON.parse(row.issues)).toContainEqual({
    kind: 'completeness',
    message: 'sweep returned 60 fewer open alerts than expected (100 prior open); missing marks withheld — check GitHub pagination. '
      + 'An alert still missing on the next eligible run will be marked missing automatically.',
  });
  const [[n]] = await db.execute('SELECT COUNT(*) AS n FROM vulnerability_alerts WHERE missing_since IS NOT NULL');
  expect(n.n).toBe(0);
  const [[w]] = await db.execute('SELECT COUNT(*) AS n FROM vulnerability_alerts WHERE withheld_since IS NOT NULL');
  expect(w.n).toBe(60);
});

it('recovery — the same 60 withheld alerts persisting a second run are all marked missing, without re-tripping the guard', async () => {
  const hundred = Array.from({ length: 100 }, (_, i) => A(1, i + 1));
  await sync(source(hundred), '2026-09-20T10:00:00Z');
  const forty = Array.from({ length: 40 }, (_, i) => A(1, i + 1));
  await sync(source(forty), '2026-09-21T10:00:00Z'); // guard trips: 60 withheld, none missing
  const { row, out } = await sync(source(forty), '2026-09-22T10:00:00Z'); // same 40 again
  expect(out.status).toBe('succeeded');
  expect(row.status).toBe('succeeded');
  expect(row.missing_count).toBe(60);
  expect(JSON.parse(row.issues).some((i: any) => i.kind === 'completeness')).toBe(false);
  // the two-consecutive-sweep recovery is recorded as an informational issue — it doesn't
  // make the run partial (asserted above via out.status/row.status), but it's not silent either.
  expect(JSON.parse(row.issues)).toContainEqual({
    kind: 'completeness-recovered',
    message: '60 previously withheld alerts marked missing after two consecutive sweeps without them',
  });
  const [[n]] = await db.execute('SELECT COUNT(*) AS n FROM vulnerability_alerts WHERE missing_since IS NOT NULL');
  expect(n.n).toBe(60);
});

it('a withheld alert that reappears clears both withheld_since and missing_since', async () => {
  const hundred = Array.from({ length: 100 }, (_, i) => A(1, i + 1));
  await sync(source(hundred), '2026-09-20T10:00:00Z');
  const forty = Array.from({ length: 40 }, (_, i) => A(1, i + 1));
  await sync(source(forty), '2026-09-21T10:00:00Z'); // withheld_since set on alerts 41-100
  await sync(source(hundred), '2026-09-22T10:00:00Z'); // all 100 reappear
  const [[a]] = await db.execute('SELECT missing_since, withheld_since FROM vulnerability_alerts WHERE repo_id = 1 AND number = 41');
  expect(a).toEqual({ missing_since: null, withheld_since: null });
});

it('archiving a repo marks all its open alerts missing immediately (explainable), no guard needed', async () => {
  const sixty = Array.from({ length: 60 }, (_, i) => A(5, i + 1));
  const liveRepo5 = {
    listOrgReposForVulns: async () => [{ repoId: 5, fullName: 'o/r5', archived: false }],
    listOrgRepoProperties: async () => ({
      rows: [{ repoId: 5, fullName: 'o/r5', team: 'T1', serviceTier: 'production', codebaseType: 'backend' }],
      keysSeen: { team: true, tier: true, codebase: true },
    }),
  };
  await sync(source(sixty, liveRepo5), '2026-09-20T10:00:00Z');
  const { row, out } = await sync(source([], {
    listOrgReposForVulns: async () => [{ repoId: 5, fullName: 'o/r5', archived: true }],
    listOrgRepoProperties: liveRepo5.listOrgRepoProperties,
  }), '2026-09-21T10:00:00Z');
  expect(out.status).toBe('succeeded');
  expect(row.status).toBe('succeeded');
  expect(row.missing_count).toBe(60);
  const [[n]] = await db.execute('SELECT COUNT(*) AS n FROM vulnerability_alerts WHERE missing_since IS NOT NULL');
  expect(n.n).toBe(60);
});

it('completeness guard boundary: 51 missing of 100 prior open still triggers the guard', async () => {
  const hundred = Array.from({ length: 100 }, (_, i) => A(1, i + 1));
  await sync(source(hundred), '2026-09-20T10:00:00Z');
  const fortyNine = Array.from({ length: 49 }, (_, i) => A(1, i + 1)); // 51 missing
  const { row } = await sync(source(fortyNine), '2026-09-21T10:00:00Z');
  expect(row.status).toBe('partial');
  expect(JSON.parse(row.issues).some((i: any) => i.kind === 'completeness')).toBe(true);
});

it('completeness guard boundary: 5 missing of 100 prior open marks all 5, no guard', async () => {
  const hundred = Array.from({ length: 100 }, (_, i) => A(1, i + 1));
  await sync(source(hundred), '2026-09-20T10:00:00Z');
  const ninetyFive = Array.from({ length: 95 }, (_, i) => A(1, i + 1)); // 5 missing
  const { row } = await sync(source(ninetyFive), '2026-09-21T10:00:00Z');
  expect(row.status).toBe('succeeded');
  expect(row.missing_count).toBe(5);
  const [missingRows] = await db.execute('SELECT number FROM vulnerability_alerts WHERE missing_since IS NOT NULL ORDER BY number');
  expect(missingRows.map((r: any) => r.number)).toEqual([96, 97, 98, 99, 100]);
});

it('a data-sanitized issue from the fetch phase is informational — it reaches the sync but does not make the run partial', async () => {
  const src = source([A(1, 1)], {
    listOrgDependabotAlerts: async (_org: string, _log?: any, onDataNotice?: any) => {
      onDataNotice?.('sanitized', 2);
      onDataNotice?.('clipped', 1);
      return [A(1, 1)];
    },
  });
  const { row, out } = await sync(src);
  expect(out.status).toBe('succeeded');
  expect(row.status).toBe('succeeded');
  expect(JSON.parse(row.issues)).toContainEqual({
    kind: 'data-sanitized',
    message: '2 values had 4-byte characters replaced and 1 were clipped to column limits',
  });
});

it('a run whose only issue is data-sanitized (informational) is succeeded, not partial', async () => {
  const src = source([A(1, 1)], {
    listOrgDependabotAlerts: async (_org: string, _log?: any, onDataNotice?: any) => {
      onDataNotice?.('sanitized', 3);
      return [A(1, 1)];
    },
  });
  const { row, out } = await sync(src);
  expect(out.status).toBe('succeeded');
  expect(row.status).toBe('succeeded');
  expect(JSON.parse(row.issues)).toEqual([{ kind: 'data-sanitized', message: '3 values had 4-byte characters replaced and 0 were clipped to column limits' }]);
});

it('a write failure alongside an informational issue still reports the fatal write issue first', async () => {
  const renamed = source([A(1, 1, { htmlUrl: null as any })], {
    listOrgDependabotAlerts: async (_org: string, _log?: any, onDataNotice?: any) => {
      onDataNotice?.('sanitized', 1);
      return [A(1, 1, { htmlUrl: null as any })];
    },
  });
  const { out, row } = await sync(renamed);
  expect(out.status).toBe('failed');
  expect(row.status).toBe('failed');
  const issues = JSON.parse(row.issues);
  expect(issues[0].kind).toBe('write');
  expect(issues.some((i: any) => i.kind === 'data-sanitized')).toBe(true);
});

it('repo-listing incompleteness — an alert whose repo is absent from the listing makes absent-repo candidates unexplained, so they are withheld and not marked missing', async () => {
  const hundred = Array.from({ length: 100 }, (_, i) => A(1, i + 1));
  const reposV1 = {
    listOrgReposForVulns: async () => [{ repoId: 1, fullName: 'o/r1', archived: false }, { repoId: 99, fullName: 'o/r99', archived: false }],
    listOrgRepoProperties: async () => ({
      rows: [
        { repoId: 1, fullName: 'o/r1', team: 'T1', serviceTier: 'production', codebaseType: 'backend' },
        { repoId: 99, fullName: 'o/r99', team: 'T9', serviceTier: 'production', codebaseType: 'backend' },
      ],
      keysSeen: { team: true, tier: true, codebase: true },
    }),
  };
  await sync(source([...hundred, A(99, 1)], reposV1), '2026-09-20T10:00:00Z');

  const forty = Array.from({ length: 40 }, (_, i) => A(1, i + 1)); // 60 of repo1's alerts vanish, unrelated reason
  const reposV2 = {
    listOrgReposForVulns: async () => [{ repoId: 1, fullName: 'o/r1', archived: false }], // repo 99 dropped from the listing…
    listOrgRepoProperties: async () => ({
      rows: [{ repoId: 1, fullName: 'o/r1', team: 'T1', serviceTier: 'production', codebaseType: 'backend' }],
      keysSeen: { team: true, tier: true, codebase: true },
    }),
  };
  // …yet a fetched alert still references repo 99 — proof the repo listing itself is incomplete
  // this sweep, not that repo 99 genuinely disappeared.
  const { row, out } = await sync(source([...forty, A(99, 2)], reposV2), '2026-09-21T10:00:00Z');

  expect(out.status).toBe('partial');
  const issues = JSON.parse(row.issues);
  expect(issues.some((i: any) => i.kind === 'completeness')).toBe(true);
  expect(issues.some((i: any) => i.kind === 'repo-list-incomplete')).toBe(true);

  // the issue message names the offending repos (up to 10) and the total
  // count, rather than only saying "a repo" was missing — repo 99 is the only one the listing
  // dropped this sweep, referenced by its alert's repoFullName.
  const repoListIssue = issues.find((i: any) => i.kind === 'repo-list-incomplete');
  expect(repoListIssue.message).toBe(
    'repo listing incomplete: 1 repos seen in alerts/properties but absent from /orgs/o/repos (o/r99) — absent-repo misses treated as unexplained',
  );

  // repo 99's alert #1 is withheld, not marked missing — the repo-list-incomplete signal makes
  // its "absent from the listing" reason unexplained instead of explainable.
  const [[a99]] = await db.execute('SELECT missing_since, withheld_since FROM vulnerability_alerts WHERE repo_id = 99 AND number = 1');
  expect(a99).toEqual({ missing_since: null, withheld_since: '2026-09-21T10:00:00Z' });
});

it('the normal absent-repo case (repo listing genuinely complete) still marks the candidate missing immediately', async () => {
  const reposV1 = {
    listOrgReposForVulns: async () => [{ repoId: 1, fullName: 'o/r1', archived: false }, { repoId: 5, fullName: 'o/r5', archived: false }],
    listOrgRepoProperties: async () => ({
      rows: [
        { repoId: 1, fullName: 'o/r1', team: 'T1', serviceTier: 'production', codebaseType: 'backend' },
        { repoId: 5, fullName: 'o/r5', team: 'T5', serviceTier: 'production', codebaseType: 'backend' },
      ],
      keysSeen: { team: true, tier: true, codebase: true },
    }),
  };
  await sync(source([A(1, 1), A(5, 1)], reposV1), '2026-09-20T10:00:00Z');

  const reposV2 = {
    listOrgReposForVulns: async () => [{ repoId: 1, fullName: 'o/r1', archived: false }], // repo 5 genuinely gone; nothing references it
    listOrgRepoProperties: async () => ({
      rows: [{ repoId: 1, fullName: 'o/r1', team: 'T1', serviceTier: 'production', codebaseType: 'backend' }],
      keysSeen: { team: true, tier: true, codebase: true },
    }),
  };
  const { row, out } = await sync(source([A(1, 1)], reposV2), '2026-09-21T10:00:00Z');

  expect(out.status).toBe('succeeded');
  expect(row.missing_count).toBe(1);
  const issues = JSON.parse(row.issues);
  expect(issues.some((i: any) => i.kind === 'repo-list-incomplete')).toBe(false);
  const [[a5]] = await db.execute('SELECT missing_since FROM vulnerability_alerts WHERE repo_id = 5 AND number = 1');
  expect(a5.missing_since).toBe('2026-09-21T10:00:00Z');
});

it('an offending repo known only from the properties listing is named by the property row\'s fullName', async () => {
  const reposV1 = {
    listOrgReposForVulns: async () => [{ repoId: 1, fullName: 'o/r1', archived: false }],
    listOrgRepoProperties: async () => ({
      rows: [{ repoId: 1, fullName: 'o/r1', team: 'T1', serviceTier: 'production', codebaseType: 'backend' }],
      keysSeen: { team: true, tier: true, codebase: true },
    }),
  };
  await sync(source([A(1, 1)], reposV1), '2026-09-20T10:00:00Z');

  const reposV2 = {
    listOrgReposForVulns: async () => [{ repoId: 1, fullName: 'o/r1', archived: false }], // repo 88 never appears in the listing…
    listOrgRepoProperties: async () => ({
      rows: [
        { repoId: 1, fullName: 'o/r1', team: 'T1', serviceTier: 'production', codebaseType: 'backend' },
        { repoId: 88, fullName: 'o/r88', team: 'T1', serviceTier: 'production', codebaseType: 'backend' }, // …only in the properties listing, never in any alert
      ],
      keysSeen: { team: true, tier: true, codebase: true },
    }),
  };
  const { row } = await sync(source([A(1, 1)], reposV2), '2026-09-21T10:00:00Z');
  const issues = JSON.parse(row.issues);
  const repoListIssue = issues.find((i: any) => i.kind === 'repo-list-incomplete');
  expect(repoListIssue.message).toBe(
    'repo listing incomplete: 1 repos seen in alerts/properties but absent from /orgs/o/repos (o/r88) — absent-repo misses treated as unexplained',
  );
});

it('a repo known only from an alert with no repoFullName is named by its bare id', async () => {
  const reposV1 = {
    listOrgReposForVulns: async () => [{ repoId: 1, fullName: 'o/r1', archived: false }, { repoId: 7, fullName: 'o/r7', archived: false }],
    listOrgRepoProperties: async () => ({
      rows: [
        { repoId: 1, fullName: 'o/r1', team: 'T1', serviceTier: 'production', codebaseType: 'backend' },
        { repoId: 7, fullName: 'o/r7', team: 'T7', serviceTier: 'production', codebaseType: 'backend' },
      ],
      keysSeen: { team: true, tier: true, codebase: true },
    }),
  };
  await sync(source([A(1, 1), A(7, 1)], reposV1), '2026-09-20T10:00:00Z');

  const reposV2 = {
    listOrgReposForVulns: async () => [{ repoId: 1, fullName: 'o/r1', archived: false }], // repo 7 dropped from the listing…
    listOrgRepoProperties: async () => ({
      rows: [{ repoId: 1, fullName: 'o/r1', team: 'T1', serviceTier: 'production', codebaseType: 'backend' }], // …and from properties
      keysSeen: { team: true, tier: true, codebase: true },
    }),
  };
  // …yet a fetched alert (same number, so it's "seen" — no completeness candidate involved) still
  // references repo 7, with repoFullName missing this sweep — proof neither the listing nor the
  // alert can name it, so nameFor falls all the way back to the bare id.
  const { row } = await sync(source([A(1, 1), A(7, 1, { repoFullName: undefined })], reposV2), '2026-09-21T10:00:00Z');
  const issues = JSON.parse(row.issues);
  const repoListIssue = issues.find((i: any) => i.kind === 'repo-list-incomplete');
  expect(repoListIssue.message).toBe(
    'repo listing incomplete: 1 repos seen in alerts/properties but absent from /orgs/o/repos (7) — absent-repo misses treated as unexplained',
  );
});

it('permissionMessage: a 401 reports a token-invalid message, distinct from the 403 texts', () => {
  const err = Object.assign(new Error('Bad credentials'), { status: 401 });
  expect(permissionMessage(err)).toBe('token invalid or expired (GitHub said: Bad credentials)');
});

it('permissionMessage: a 404 on the repos/properties/alerts steps reports an org-not-found message', () => {
  for (const step of ['repos', 'properties', 'alerts']) {
    const err = Object.assign(new Error('Not Found'), { status: 404, vulnStep: step });
    expect(permissionMessage(err)).toBe('org not found or not visible to the token — check VULNERABILITIES_ORG (GitHub said: Not Found)');
  }
});

it('a rate limit exhausted on the alerts fetch is reported as a rate limit, not a permission problem', async () => {
  const rateLimited = source(async () => {
    const err = Object.assign(new Error('You have exceeded a secondary rate limit'), { status: 403 });
    (err as any).response = { headers: { 'x-ratelimit-remaining': '0' } };
    throw err;
  });
  const { row, out } = await sync(rateLimited);
  expect(out.status).toBe('failed');
  expect(row.status).toBe('failed');
  const message = JSON.parse(row.issues)[0].message;
  expect(message).toMatch(/rate limit exhausted/);
  expect(message).not.toMatch(/token cannot read/);
});

it('a 403 on the properties fetch is reported as a custom-properties permission problem', async () => {
  const denied = source([A(1, 1)], {
    listOrgRepoProperties: async () => { throw Object.assign(new Error('Resource not accessible'), { status: 403 }); },
  });
  const { row, out } = await sync(denied);
  expect(out.status).toBe('failed');
  expect(row.status).toBe('failed');
  const message = JSON.parse(row.issues)[0].message;
  expect(message).toMatch(/custom properties/);
  expect(message).not.toMatch(/Dependabot alerts/);
});

it('permissionMessage: a rate limit without a step says "during the sync", not "during fetch fetch"', () => {
  const err = Object.assign(new Error('You have exceeded a rate limit'), { status: 403 });
  (err as any).response = { headers: { 'x-ratelimit-remaining': '0' } };
  const message = permissionMessage(err);
  expect(message).toMatch(/during the sync/);
  expect(message).not.toMatch(/fetch fetch/);
});

it("a resolved alert's snapshot count agrees with rowToAlertFact(...).resolvedAt for the same row (COALESCE precedence)", async () => {
  // dismissed_at must win over auto_dismissed_at in the COALESCE — both the SQL snapshot aggregate
  // and rowToAlertFact must agree the alert is NOT counted as resolved-since-start, using the same
  // fixed_at > dismissed_at > auto_dismissed_at order. With the deployment-configured
  // VULN_RESOLVED_SINCE (not a checked-in constant), a synthetic value set between
  // the two timestamps below is what still makes this test load-bearing — without it, the default
  // "since = null" (all time) would count the alert either way and the COALESCE precedence
  // wouldn't matter to the outcome.
  process.env.VULN_RESOLVED_SINCE = '2020-01-01';
  __clearVulnConfigCache();
  try {
    await sync(source([
      A(1, 1, { state: 'auto_dismissed', fixedAt: null, dismissedAt: '2019-09-01T00:00:00Z', autoDismissedAt: '2026-09-05T00:00:00Z' }),
    ]));
    const [[s]] = await db.execute('SELECT resolved_critical_since_start FROM vulnerability_repo_snapshots WHERE repo_id = 1');
    expect(s.resolved_critical_since_start).toBe(0);
    const [[row]] = await db.execute('SELECT * FROM vulnerability_alerts WHERE repo_id = 1 AND number = 1');
    const fact = rowToAlertFact(row);
    expect(fact.resolvedAt).toBe('2019-09-01T00:00:00Z');
    expect(fact.resolvedAt! >= '2020-01-01').toBe(false); // agrees with the snapshot: not counted
  } finally {
    delete process.env.VULN_RESOLVED_SINCE;
    __clearVulnConfigCache();
  }
});

// the sync-time taxonomy guard. Unlike the `source()` helper above (which hands
// runSync already-mapped FetchedRepoProperties and a hardcoded keysSeen), this fixture runs the
// raw property rows through the real mapPropertyRows, so a misconfigured VULN_*_PROPERTY/
// VULN_TIER_IN_SCOPE/VULN_CODEBASE_GROUPS actually changes what keysSeen and the mapped fields
// come out as — exercising the guard the way a real deployment would trip it.
describe('sync-time taxonomy guard', () => {
  function taxonomySource(): VulnerabilitySource {
    return {
      listOrgReposForVulns: async () => [{ repoId: 1, fullName: 'o/r1', archived: false }],
      listOrgRepoProperties: async (_org, keys) => {
        return mapPropertyRows([{
          repoId: 1, fullName: 'o/r1',
          properties: [
            { property_name: 'team', value: 'T1' },
            { property_name: 'service_tier', value: 'production' },
            { property_name: 'codebase_type', value: 'backend' },
          ],
        }], keys);
      },
      listOrgDependabotAlerts: async () => [],
      getRepoDependabotStatus: async () => ({ status: 'ok' }),
    };
  }

  const withEnv = async (vars: Record<string, string>, fn: () => Promise<void>) => {
    const prior: Record<string, string | undefined> = {};
    for (const k of Object.keys(vars)) { prior[k] = process.env[k]; process.env[k] = vars[k]; }
    __clearVulnConfigCache();
    try {
      await fn();
    } finally {
      for (const k of Object.keys(vars)) { if (prior[k] === undefined) delete process.env[k]; else process.env[k] = prior[k]; }
      __clearVulnConfigCache();
    }
  };

  // A `partial` run still does real work — this fixture's one in-scope repo (repoId 1) must have
  // been written to vulnerability_repos and produced a snapshot row for this sync, same as a clean
  // run. A guard that trips must never come at the cost of silently dropping the write.
  async function expectRepoAndSnapshotWritten(id: number): Promise<void> {
    const [repoRows] = await db.execute('SELECT repo_id FROM vulnerability_repos WHERE org = ?', ['o']);
    expect((repoRows as any[]).map(r => r.repo_id)).toEqual([1]);
    const [snapRows] = await db.execute('SELECT repo_id FROM vulnerability_repo_snapshots WHERE sync_id = ?', [id]);
    expect((snapRows as any[]).map(r => r.repo_id)).toEqual([1]);
  }

  it('clean baseline: default config with fixtures under the default keys raises no config issue', async () => {
    const { id, row, out } = await sync(taxonomySource());
    expect(out.status).toBe('succeeded');
    const issues = JSON.parse(row.issues);
    expect(issues.some((i: any) => i.kind === 'config')).toBe(false);
    await expectRepoAndSnapshotWritten(id);
  });

  it('missing key: a mistyped VULN_TIER_PROPERTY makes the run partial with a config issue naming it, and never echoes the value', async () => {
    await withEnv({ VULN_TIER_PROPERTY: 'nope' }, async () => {
      const { id, row, out } = await sync(taxonomySource());
      expect(out.status).toBe('partial');
      const issues = JSON.parse(row.issues);
      expect(issues).toContainEqual({
        kind: 'config', variable: 'VULN_TIER_PROPERTY',
        message: 'VULN_TIER_PROPERTY: the configured property key appears on no repo',
      });
      expect(JSON.stringify(issues)).not.toContain('nope');
      await expectRepoAndSnapshotWritten(id);
    });
  });

  it('missing key: a mistyped VULN_CODEBASE_PROPERTY makes the run partial with a config issue naming it, and never echoes the value', async () => {
    await withEnv({ VULN_CODEBASE_PROPERTY: 'nope' }, async () => {
      const { id, row, out } = await sync(taxonomySource());
      expect(out.status).toBe('partial');
      const issues = JSON.parse(row.issues);
      expect(issues).toContainEqual({
        kind: 'config', variable: 'VULN_CODEBASE_PROPERTY',
        message: 'VULN_CODEBASE_PROPERTY: the configured property key appears on no repo',
      });
      expect(JSON.stringify(issues)).not.toContain('nope');
      await expectRepoAndSnapshotWritten(id);
    });
  });

  it('no in-scope repo: an in-scope tier matching no repo makes the run partial with a config issue, and never echoes the value', async () => {
    await withEnv({ VULN_TIER_IN_SCOPE: 'nothing-matches' }, async () => {
      const { id, row, out } = await sync(taxonomySource());
      expect(out.status).toBe('partial');
      const issues = JSON.parse(row.issues);
      expect(issues).toContainEqual({
        kind: 'config', variable: 'VULN_TIER_IN_SCOPE',
        message: 'VULN_TIER_IN_SCOPE: no repo has the configured in-scope tier',
      });
      expect(JSON.stringify(issues)).not.toContain('nothing-matches');
      await expectRepoAndSnapshotWritten(id);
    });
  });

  it('no matching group: in-scope repos present but none matching any configured group makes the run partial with a config issue, and never echoes the value', async () => {
    await withEnv({ VULN_CODEBASE_GROUPS: '{"backend":["zzz"]}' }, async () => {
      const { id, row, out } = await sync(taxonomySource());
      expect(out.status).toBe('partial');
      const issues = JSON.parse(row.issues);
      expect(issues).toContainEqual({
        kind: 'config', variable: 'VULN_CODEBASE_GROUPS',
        message: 'VULN_CODEBASE_GROUPS: no in-scope repo matches any configured group',
      });
      expect(JSON.stringify(issues)).not.toContain('zzz');
      await expectRepoAndSnapshotWritten(id);
    });
  });
});
