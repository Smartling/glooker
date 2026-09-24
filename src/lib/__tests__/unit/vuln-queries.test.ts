jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() })); // queries → scheduler → github.ts
import fs from 'fs'; import os from 'os'; import path from 'path';
import { __clearVulnConfigCache } from '@/lib/vulnerabilities/config';

let db: any; let q: any; let dbPath: string;
const prior = { SQLITE_PATH: process.env.SQLITE_PATH, DB_TYPE: process.env.DB_TYPE, VULNERABILITIES_ORG: process.env.VULNERABILITIES_ORG };
const restore = (k: keyof typeof prior) => { if (prior[k] === undefined) delete process.env[k]; else process.env[k] = prior[k]; };

beforeAll(async () => {
  dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'glooker-vq-')), 'test.db');
  process.env.SQLITE_PATH = dbPath; process.env.DB_TYPE = 'sqlite'; process.env.VULNERABILITIES_ORG = 'o';
  db = (await import('@/lib/db')).default;
  q = await import('@/lib/vulnerabilities/queries');
});
afterAll(() => { restore('SQLITE_PATH'); restore('DB_TYPE'); restore('VULNERABILITIES_ORG'); try { fs.unlinkSync(dbPath); } catch {} });
beforeEach(async () => {
  for (const t of ['vulnerability_alerts', 'vulnerability_repos', 'vulnerability_syncs', 'vulnerability_repo_snapshots']) await db.execute(`DELETE FROM ${t}`);
  // The facts cache is module-level; each test starts from a clean slate so a coincidental
  // cache-key match across tests can't serve stale repos/alerts.
  q.__clearVulnFactsCache();
});

const NOW = new Date('2026-09-22T12:00:00Z');
const f = (over: any = {}) => ({ codebase: 'backend', state: 'open', baseline: 'last', ...over });

async function seedOk(finished = '2026-09-22T10:00:00Z', status = 'succeeded') {
  await db.execute(`INSERT INTO vulnerability_syncs (org, trigger_kind, status, started_at, finished_at, issues) VALUES ('o','schedule',?,?,?, '[]')`, [status, finished, finished]);
  await db.execute(`INSERT INTO vulnerability_repos (repo_id, org, full_name, team, service_tier, codebase_type, archived, dependabot_status, first_seen_at, last_seen_at) VALUES (1,'o','o/r1','T1','production','backend',0,'ok',?,?)`, [finished, finished]);
  await db.execute(`INSERT INTO vulnerability_alerts (repo_id, number, org, html_url, state, severity, created_at, first_seen_sync_id, last_seen_sync_id) VALUES (1,1,'o','u','open','critical','2026-09-01T00:00:00Z',1,1)`);
}

it('is unavailable before any successful sync, and reports the last status', async () => {
  await db.execute(`INSERT INTO vulnerability_syncs (org, trigger_kind, status, started_at, finished_at, issues) VALUES ('o','manual','failed','2026-09-22T09:00:00Z','2026-09-22T09:00:05Z','[{"kind":"fetch","message":"x"}]')`);
  const r = await q.getSummary(f(), NOW);
  expect(r).toMatchObject({ available: false, reason: 'No successful vulnerability sync yet.', sync: { lastStatus: 'failed', lastSuccessfulAt: null } });
});

it('summary: data with the sync block, applied filters and default (neutral) config-derived fields', async () => {
  await seedOk();
  const r = await q.getSummary(f(), NOW);
  expect(r.available).toBe(true);
  expect(r.org).toBe('o'); // the page header renders this org value
  expect(r.sync).toMatchObject({ lastSuccessfulAt: '2026-09-22T10:00:00Z', stale: false, lastStatus: 'succeeded', issuesCount: 0 });
  expect(r.appliedFilters).toMatchObject({ codebase: 'backend', baseline: 'last' });
  // resolvedCountStartDate/scope/policy now come from deployment configuration
  // (getVulnConfig()), not the deleted policy.ts constants. With no env set, VULN_RESOLVED_SINCE is
  // unset (null = all time) and the SLA policy is empty — the neutral defaults.
  expect(r.resolvedCountStartDate).toBeNull();
  expect(r.resolvedCountInvalid).toBe(false);
  expect(r.resolvedSince).toEqual({ date: null, invalid: false });
  expect(r.scope).toEqual({ property: 'service_tier', value: 'production' });
  expect(r.policy).toEqual([]);
  expect(r.pivot.total.critical.open).toBe(1);
});

it('summary: with a synthetic SLA policy in env, policy[0] reflects it', async () => {
  const PRIOR = process.env.VULNERABILITIES_SLA_POLICY;
  process.env.VULNERABILITIES_SLA_POLICY = JSON.stringify([{ id: 'critical-2020-01', severity: 'critical', effectiveFrom: '2020-01-08', days: 9 }]);
  __clearVulnConfigCache();
  try {
    await seedOk();
    const r = await q.getSummary(f(), NOW);
    expect(r.policy[0]).toMatchObject({ id: 'critical-2020-01', pending: false });
  } finally {
    if (PRIOR === undefined) delete process.env.VULNERABILITIES_SLA_POLICY; else process.env.VULNERABILITIES_SLA_POLICY = PRIOR;
    __clearVulnConfigCache();
  }
});

it('stale boundary is 36 hours; partial counts as successful', async () => {
  await seedOk('2026-09-21T01:00:00Z', 'partial');            // NOW − 35h
  expect((await q.getSummary(f(), NOW)).sync).toMatchObject({ lastStatus: 'partial', stale: false });
  await db.execute(`UPDATE vulnerability_syncs SET finished_at = '2026-09-20T23:00:00Z'`); // NOW − 37h
  expect((await q.getSummary(f(), NOW)).sync).toMatchObject({ stale: true });
});

it('latest run failed → still available, serving the last good run, with lastStatus failed', async () => {
  await seedOk();
  await db.execute(`INSERT INTO vulnerability_syncs (org, trigger_kind, status, started_at, finished_at, issues) VALUES ('o','schedule','failed','2026-09-22T11:00:00Z','2026-09-22T11:00:05Z','[{"kind":"fetch","message":"boom"}]')`);
  const r = await q.getSummary(f(), NOW);
  expect(r).toMatchObject({ available: true, sync: { lastStatus: 'failed', lastSuccessfulAt: '2026-09-22T10:00:00Z', issuesCount: 1 } });
  expect(r.pivot.total.critical.open).toBe(1);
});

it('delta through getSummary picks the previous snapshot set as the "last" baseline', async () => {
  await seedOk();
  const snap = (syncId: number, at: string, open: number) => db.execute(
    `INSERT INTO vulnerability_repo_snapshots (org, source, sync_id, taken_on, measured_at, repo_id, full_name, archived, open_critical, open_high, resolved_critical_since_start, resolved_high_since_start)
     VALUES ('o','sync',?,?,?,1,'o/r1',0,?,0,0,0)`, [syncId, at.slice(0, 10), at, open]);
  await snap(1, '2026-09-21T10:00:00Z', 3);
  await snap(2, '2026-09-22T10:00:00Z', 1);
  const r = await q.getSummary(f(), NOW);
  expect(r.delta.critical.baseline.key).toBe('sync:1');
  expect(r.delta.critical.total.deltaOpen).toBe(-2); // now 1 open vs 3
});

it('unknown team → error with known teams', async () => {
  await seedOk();
  expect(await q.getAlerts(f({ team: 'Nope' }), NOW)).toEqual({ error: 'unknown team', known_teams: ['T1'] });
});

it('coverage validates team against ALL repos, and alerts distinguishes an out-of-scope repo from an unknown one', async () => {
  await seedOk();
  await db.execute(`INSERT INTO vulnerability_repos (repo_id, org, full_name, team, service_tier, codebase_type, archived, dependabot_status, first_seen_at, last_seen_at) VALUES (2,'o','o/internal','T-Internal','non-production','backend',0,'ok','2026-09-22T10:00:00Z','2026-09-22T10:00:00Z')`);
  await db.execute(`INSERT INTO vulnerability_alerts (repo_id, number, org, html_url, state, severity, created_at, first_seen_sync_id, last_seen_sync_id) VALUES (2,1,'o','u2','open','critical','2026-09-01T00:00:00Z',1,1)`);

  // T-Internal's only repo is out of scope (service_tier !== 'production'), so it's absent from
  // knownTeams (in-scope only) — but coverage validates against ALL repos' teams and must not
  // reject it as "unknown team".
  const cov = await q.getCoverage(f({ team: 'T-Internal' }), NOW);
  expect(cov).not.toHaveProperty('error');
  expect(cov.excludedByPolicy.some((r: any) => r.fullName === 'o/internal')).toBe(true);

  // Alerts: a repo that exists but is out of scope is a distinct error from an unknown repo.
  expect(await q.getAlerts(f({ repo: 'o/internal' }), NOW)).toEqual({ error: 'repo not tracked', repo: 'o/internal', service_tier: 'non-production' });
  expect(await q.getAlerts(f({ repo: 'o/does-not-exist' }), NOW)).toEqual({ error: 'unknown repo' });
});

it('appliedFilters echoes only the fields each endpoint consumes', async () => {
  await seedOk();
  expect((await q.getSummary(f(), NOW)).appliedFilters).toEqual({ codebase: 'backend', baseline: 'last' });
  expect((await q.getTrend(f(), NOW)).appliedFilters).toEqual({ codebase: 'backend', severity: 'critical' });
  expect((await q.getCoverage(f({ codebase: 'frontend', team: 'T1' }), NOW)).appliedFilters).toEqual({ team: 'T1' });
});

it('listSyncs binds LIMIT as a string (mysql2 execute() rejects a numeric LIMIT), newest first', async () => {
  await db.execute(`INSERT INTO vulnerability_syncs (org, trigger_kind, status, started_at, finished_at, issues) VALUES ('o','manual','succeeded','2026-09-20T10:00:00Z','2026-09-20T10:00:05Z','[]')`);
  await db.execute(`INSERT INTO vulnerability_syncs (org, trigger_kind, status, started_at, finished_at, issues) VALUES ('o','manual','succeeded','2026-09-21T10:00:00Z','2026-09-21T10:00:05Z','[]')`);
  await db.execute(`INSERT INTO vulnerability_syncs (org, trigger_kind, status, started_at, finished_at, issues) VALUES ('o','manual','succeeded','2026-09-22T10:00:00Z','2026-09-22T10:00:05Z','[]')`);
  const r = await q.listSyncs(2);
  expect(r.available).toBe(true);
  expect(r.syncs).toHaveLength(2);
  expect(r.syncs.map((s: any) => s.startedAt)).toEqual(['2026-09-22T10:00:00Z', '2026-09-21T10:00:00Z']);
  expect(r.schedule.cron).toBeTruthy();
  const r2 = await q.listSyncs(2.7);
  expect(r2.syncs).toHaveLength(2);
});

it("getSummary loads only the snapshot-set index and the picked baseline set's rows, not every snapshot row", async () => {
  await seedOk();
  const snap = (syncId: number, at: string, open: number) => db.execute(
    `INSERT INTO vulnerability_repo_snapshots (org, source, sync_id, taken_on, measured_at, repo_id, full_name, archived, open_critical, open_high, resolved_critical_since_start, resolved_high_since_start)
     VALUES ('o','sync',?,?,?,1,'o/r1',0,?,0,0,0)`, [syncId, at.slice(0, 10), at, open]);
  await snap(1, '2026-09-20T10:00:00Z', 5);
  await snap(2, '2026-09-21T10:00:00Z', 3);
  await snap(3, '2026-09-22T10:00:00Z', 1);
  const spy = jest.spyOn(db, 'execute');
  spy.mockClear();
  const r = await q.getSummary(f(), NOW);
  expect(r.delta.critical.baseline.key).toBe('sync:2'); // 'last' = second-to-last by measuredAt
  const snapshotQueries = spy.mock.calls
    .map((c: any[]) => ({ sql: String(c[0]), params: c[1] }))
    // The carried-resolved query (loadRepos) also mentions vulnerability_repo_snapshots, via a
    // JOIN — excluded here because this assertion is specifically about the snapshot-set index and
    // baseline-rows queries, not every query that happens to touch the table.
    .filter((c: any) => /vulnerability_repo_snapshots/.test(c.sql) && !/JOIN vulnerability_repo_snapshots/.test(c.sql));
  expect(snapshotQueries).toHaveLength(2);           // the distinct index, then just the baseline set's rows
  expect(snapshotQueries[0].sql).toMatch(/DISTINCT/i);
  expect(snapshotQueries[1].sql).toMatch(/sync_id\s*=\s*\?/);
  expect(snapshotQueries[1].params).toContain(2);
  spy.mockRestore();
});

it('getTrend does not load alert rows it never uses (only repos and snapshots)', async () => {
  await seedOk();
  const spy = jest.spyOn(db, 'execute');
  spy.mockClear();
  const r = await q.getTrend(f(), NOW);
  expect(r.available).toBe(true);
  const queried = spy.mock.calls.map((c: any[]) => String(c[0]));
  // Anchored to the whole-table alerts load specifically: the carried-resolved query (part of
  // loadRepos, which always runs) references vulnerability_alerts too, in a NOT EXISTS subquery —
  // this assertion is about the alerts SELECT that loadAlerts: false is meant to skip, not every
  // query that mentions the table.
  expect(queried.some(sql => /^SELECT \* FROM vulnerability_alerts WHERE org = \?$/.test(sql))).toBe(false);
  spy.mockRestore();
});

it('facts cache — two getSummary calls with no new sync run the alerts SELECT once; a new successful sync reloads it', async () => {
  await seedOk();
  const spy = jest.spyOn(db, 'execute');
  spy.mockClear();
  await q.getSummary(f(), NOW);
  await q.getSummary(f(), NOW);
  // Anchored to the whole-table alerts load: the carried-resolved query (part of loadRepos)
  // also references vulnerability_alerts, in a NOT EXISTS subquery, so a loose match would count it too.
  const alertSelectMatcher = (c: any[]) => /^SELECT \* FROM vulnerability_alerts WHERE org = \?$/.test(String(c[0]));
  const alertSelects = spy.mock.calls.filter(alertSelectMatcher);
  expect(alertSelects).toHaveLength(1);
  spy.mockClear();
  await db.execute(`INSERT INTO vulnerability_syncs (org, trigger_kind, status, started_at, finished_at, issues) VALUES ('o','schedule','succeeded','2026-09-22T11:00:00Z','2026-09-22T11:00:05Z','[]')`);
  await q.getSummary(f(), NOW);
  const alertSelectsAfter = spy.mock.calls.filter(alertSelectMatcher);
  expect(alertSelectsAfter).toHaveLength(1);
  spy.mockRestore();
});

it("getTrend loads snapshot rows only for the sets it plots, not every set the org has", async () => {
  await seedOk();
  const snap = (syncId: number, at: string, open: number) => db.execute(
    `INSERT INTO vulnerability_repo_snapshots (org, source, sync_id, taken_on, measured_at, repo_id, full_name, archived, open_critical, open_high, resolved_critical_since_start, resolved_high_since_start)
     VALUES ('o','sync',?,?,?,1,'o/r1',0,?,0,0,0)`, [syncId, at.slice(0, 10), at, open]);
  // Two sync ids the same day: only the later one (id 2) is chosen for 2026-09-21.
  await snap(1, '2026-09-21T09:00:00Z', 9);
  await snap(2, '2026-09-21T15:00:00Z', 3);
  await snap(3, '2026-09-22T10:00:00Z', 1);
  const spy = jest.spyOn(db, 'execute');
  spy.mockClear();
  const r = await q.getTrend(f(), NOW);
  expect(r.available).toBe(true);
  const snapQuery = spy.mock.calls.find((c: any[]) => /FROM vulnerability_repo_snapshots\b/.test(String(c[0])) && /sync_id IN/.test(String(c[0])));
  expect(snapQuery).toBeTruthy();
  expect(snapQuery![1]).toEqual(expect.arrayContaining([2, 3]));
  expect(snapQuery![1]).not.toEqual(expect.arrayContaining([1]));
  spy.mockRestore();
});

it('getTrend success path returns a series with a real value', async () => {
  await seedOk();
  await db.execute(`INSERT INTO vulnerability_repo_snapshots (org, source, sync_id, taken_on, measured_at, repo_id, full_name, archived, open_critical, open_high, resolved_critical_since_start, resolved_high_since_start) VALUES ('o','sync',1,'2026-09-22','2026-09-22T10:00:00Z',1,'o/r1',0,1,0,0,0)`);
  const r = await q.getTrend(f(), NOW);
  expect(r.available).toBe(true);
  expect(r.series.find((s: any) => s.team === 'T1')?.points).toEqual([{ date: '2026-09-22', open: 1 }]);
});

it('getAlerts success path returns a real row', async () => {
  await seedOk();
  const r = await q.getAlerts(f(), NOW);
  expect(r.available).toBe(true);
  expect(r.rows).toHaveLength(1);
  expect(r.rows[0]).toMatchObject({ repo: 'o/r1', team: 'T1', severity: 'critical', state: 'open' });
});

it('getCoverage success path flags an untagged repo needing tagging', async () => {
  await seedOk();
  await db.execute(`INSERT INTO vulnerability_repos (repo_id, org, full_name, team, service_tier, codebase_type, archived, dependabot_status, first_seen_at, last_seen_at) VALUES (3,'o','o/r3',NULL,'production',NULL,0,'ok','2026-09-22T10:00:00Z','2026-09-22T10:00:00Z')`);
  await db.execute(`INSERT INTO vulnerability_alerts (repo_id, number, org, html_url, state, severity, created_at, first_seen_sync_id, last_seen_sync_id) VALUES (3,1,'o','u3','open','critical','2026-09-01T00:00:00Z',1,1)`);
  const r = await q.getCoverage(f(), NOW);
  expect(r.available).toBe(true);
  expect(r.needsTagging.map((x: any) => x.fullName)).toEqual(['o/r3']);
});

it('carried resolved — latest CSV snapshot wins, a repo with no snapshot gets 0, an archived repo with a stored alert or a non-archived repo does not qualify', async () => {
  await seedOk(); // repo 1: 'o/r1', T1, not archived, one open critical alert
  const snap = (repoId: number, takenOn: string, sourceFile: string, resolvedCritical: number) => db.execute(
    `INSERT INTO vulnerability_repo_snapshots (org, source, sync_id, source_file, taken_on, measured_at, repo_id, full_name, archived, open_critical, open_high, resolved_critical_since_start, resolved_high_since_start)
     VALUES ('o','csv-import',NULL,?,?,?,?, 'x',1,0,NULL,?,NULL)`, [sourceFile, takenOn, `${takenOn}T00:00:00Z`, repoId, resolvedCritical]);
  const repoRow = (id: number, fullName: string, archived: number) => db.execute(
    `INSERT INTO vulnerability_repos (repo_id, org, full_name, team, service_tier, codebase_type, archived, dependabot_status, first_seen_at, last_seen_at)
     VALUES (?,'o',?, 'T1','production','backend',?, 'ok','2026-08-01T00:00:00Z','2026-08-01T00:00:00Z')`, [id, fullName, archived]);

  // repo 2: archived, zero stored alerts, two CSV snapshots — the later taken_on (7) must win over the earlier (3).
  await repoRow(2, 'o/legacy-app', 1);
  await snap(2, '2026-08-01', 'snap-1.csv', 3);
  await snap(2, '2026-09-01', 'snap-2.csv', 7);

  // repo 3: archived, no CSV snapshot at all — gets 0, contributes nothing.
  await repoRow(3, 'o/no-history', 1);

  // repo 4: archived, has a CSV snapshot, but also has a stored alert — disqualified from the carry;
  // its own alert still resolves normally through the regular alert-based path.
  await repoRow(4, 'o/has-alert', 1);
  await snap(4, '2026-08-01', 'snap-3.csv', 9);
  await db.execute(`INSERT INTO vulnerability_alerts (repo_id, number, org, html_url, state, severity, created_at, fixed_at, first_seen_sync_id, last_seen_sync_id)
    VALUES (4,1,'o','u4','fixed','critical','2026-07-01T00:00:00Z','2026-07-02T00:00:00Z',1,1)`);

  // repo 5: NOT archived, has a CSV snapshot and no stored alerts — still disqualified (archived is required).
  await repoRow(5, 'o/still-active', 0);
  await snap(5, '2026-08-01', 'snap-4.csv', 99);

  const r = await q.getSummary(f(), NOW);
  expect(r.pivot.total.critical.carriedResolved).toBe(7);      // only repo 2's latest snapshot (7), not 3, not 9, not 99
  expect(r.pivot.total.critical.resolved).toBe(8);              // 7 (carry) + repo 4's own resolved alert (1)
});

// The carry query on its own. computePivot re-checks "archived" and "no stored alerts", so the
// getSummary-level test above would still pass if the SQL lost those clauses; this one wouldn't.
it('the carry query alone applies archived, no-alerts and latest-snapshot rules, with a deterministic tie-break', async () => {
  await seedOk();
  const repoRow = (id: number, fullName: string, archived: number) => db.execute(
    `INSERT INTO vulnerability_repos (repo_id, org, full_name, team, service_tier, codebase_type, archived, dependabot_status, first_seen_at, last_seen_at)
     VALUES (?,'o',?, 'T1','production','backend',?, 'ok','2026-08-01T00:00:00Z','2026-08-01T00:00:00Z')`, [id, fullName, archived]);
  const snap = (repoId: number, takenOn: string, sourceFile: string, resolvedCritical: number) => db.execute(
    `INSERT INTO vulnerability_repo_snapshots (org, source, sync_id, source_file, taken_on, measured_at, repo_id, full_name, archived, open_critical, open_high, resolved_critical_since_start, resolved_high_since_start)
     VALUES ('o','csv-import',NULL,?,?,?,?, 'x',1,0,NULL,?,NULL)`, [sourceFile, takenOn, `${takenOn}T00:00:00Z`, repoId, resolvedCritical]);

  await repoRow(2, 'o/legacy-app', 1);
  await snap(2, '2026-08-01', 'snap-1.csv', 3);
  await snap(2, '2026-09-01', 'snap-2.csv', 7);
  await repoRow(4, 'o/has-alert', 1);
  await snap(4, '2026-08-01', 'snap-3.csv', 9);
  await db.execute(`INSERT INTO vulnerability_alerts (repo_id, number, org, html_url, state, severity, created_at, first_seen_sync_id, last_seen_sync_id)
    VALUES (4,1,'o','u4','open','critical','2026-07-01T00:00:00Z',1,1)`);
  await repoRow(5, 'o/still-active', 0);
  await snap(5, '2026-08-01', 'snap-4.csv', 99);
  // Two snapshots with the same taken_on and measured_at: the later-inserted row (higher id) wins.
  // This documents the rule. It is not a regression guard for the id clause: without that clause,
  // SQLite returns both rows in insertion order and the Map keeps the last, which is the same answer.
  await repoRow(6, 'o/tied', 1);
  await snap(6, '2026-08-01', 'snap-5.csv', 11);
  await snap(6, '2026-08-01', 'snap-6.csv', 12);

  const m: Map<number, number> = await q.__loadCarriedResolvedCritical('o');
  expect([...m.entries()].sort((a, b) => a[0] - b[0])).toEqual([[2, 7], [6, 12]]);
});

it('feature off → unavailable with the fixed reason', async () => {
  delete process.env.VULNERABILITIES_ORG;
  try {
    expect(await q.getSummary(f(), NOW)).toEqual({ available: false, reason: 'Vulnerability tracking is not enabled on this Glooker instance.', configErrors: [] });
  } finally {
    process.env.VULNERABILITIES_ORG = 'o';
  }
});

// the one configErrors channel. getVulnConfig().errors (startup) and the latest
// succeeded/partial sync's `kind: 'config'` issues (queries.ts's syncConfigErrors) concatenate
// onto every prepare()-based response — data responses and the Unavailable response alike — but
// never onto the unknown-team/unknown-repo/repo-not-tracked payloads, which are the caller's
// parameter to fix and retry, not a config problem.
describe('configErrors channel', () => {
  let PRIOR: string | undefined;
  beforeEach(() => { PRIOR = process.env.VULNERABILITIES_SLA_POLICY; });
  afterEach(() => {
    if (PRIOR === undefined) delete process.env.VULNERABILITIES_SLA_POLICY; else process.env.VULNERABILITIES_SLA_POLICY = PRIOR;
    __clearVulnConfigCache();
  });

  it('a startup config error (invalid SLA policy JSON) surfaces on every data response', async () => {
    process.env.VULNERABILITIES_SLA_POLICY = '{';
    __clearVulnConfigCache();
    await seedOk();
    const expected = [{ source: 'startup', variable: 'VULNERABILITIES_SLA_POLICY', rule: 'Invalid JSON in VULNERABILITIES_SLA_POLICY env var' }];
    expect((await q.getSummary(f(), NOW)).configErrors).toEqual(expected);
    expect((await q.getAlerts(f(), NOW)).configErrors).toEqual(expected);
    expect((await q.getCoverage(f(), NOW)).configErrors).toEqual(expected);
    expect((await q.getTrend(f(), NOW)).configErrors).toEqual(expected);
  });

  it('a sync-kind config issue on the latest succeeded sync is listed after the startup entries', async () => {
    process.env.VULNERABILITIES_SLA_POLICY = '{';
    __clearVulnConfigCache();
    const finished = '2026-09-22T10:00:00Z';
    await db.execute(
      `INSERT INTO vulnerability_syncs (org, trigger_kind, status, started_at, finished_at, issues) VALUES ('o','schedule','succeeded',?,?,?)`,
      [finished, finished, JSON.stringify([{ kind: 'config', variable: 'VULN_TIER_IN_SCOPE', message: 'VULN_TIER_IN_SCOPE: no repo has the configured in-scope tier' }])],
    );
    await db.execute(
      `INSERT INTO vulnerability_repos (repo_id, org, full_name, team, service_tier, codebase_type, archived, dependabot_status, first_seen_at, last_seen_at) VALUES (1,'o','o/r1','T1','production','backend',0,'ok',?,?)`,
      [finished, finished],
    );
    const r = await q.getSummary(f(), NOW);
    expect(r.configErrors).toEqual([
      { source: 'startup', variable: 'VULNERABILITIES_SLA_POLICY', rule: 'Invalid JSON in VULNERABILITIES_SLA_POLICY env var' },
      { source: 'sync', variable: 'VULN_TIER_IN_SCOPE', rule: 'VULN_TIER_IN_SCOPE: no repo has the configured in-scope tier', at: finished },
    ]);
  });

  it('a later failed run does not clear the sync-sourced config error', async () => {
    const finished = '2026-09-22T10:00:00Z';
    await db.execute(
      `INSERT INTO vulnerability_syncs (org, trigger_kind, status, started_at, finished_at, issues) VALUES ('o','schedule','succeeded',?,?,?)`,
      [finished, finished, JSON.stringify([{ kind: 'config', variable: 'VULN_TIER_IN_SCOPE', message: 'VULN_TIER_IN_SCOPE: no repo has the configured in-scope tier' }])],
    );
    await db.execute(
      `INSERT INTO vulnerability_repos (repo_id, org, full_name, team, service_tier, codebase_type, archived, dependabot_status, first_seen_at, last_seen_at) VALUES (1,'o','o/r1','T1','production','backend',0,'ok',?,?)`,
      [finished, finished],
    );
    // A later run fails — status 'failed' is excluded by syncConfigErrors' status filter, so the
    // last succeeded run's config error must still be the one reported.
    await db.execute(
      `INSERT INTO vulnerability_syncs (org, trigger_kind, status, started_at, finished_at, issues) VALUES ('o','schedule','failed','2026-09-22T11:00:00Z','2026-09-22T11:00:05Z','[]')`,
    );
    const r = await q.getSummary(f(), NOW);
    expect(r.configErrors).toEqual([{ source: 'sync', variable: 'VULN_TIER_IN_SCOPE', rule: 'VULN_TIER_IN_SCOPE: no repo has the configured in-scope tier', at: finished }]);
  });

  it('with no successful sync yet, the Unavailable response still carries the startup entries', async () => {
    process.env.VULNERABILITIES_SLA_POLICY = '{';
    __clearVulnConfigCache();
    await db.execute(`INSERT INTO vulnerability_syncs (org, trigger_kind, status, started_at, finished_at, issues) VALUES ('o','manual','failed','2026-09-22T09:00:00Z','2026-09-22T09:00:05Z','[]')`);
    const r = await q.getSummary(f(), NOW);
    expect(r.available).toBe(false);
    expect(r.configErrors).toEqual([{ source: 'startup', variable: 'VULNERABILITIES_SLA_POLICY', rule: 'Invalid JSON in VULNERABILITIES_SLA_POLICY env var' }]);
  });

  it('a later clean succeeded sync with no config issue clears a sync-sourced config error', async () => {
    const finished1 = '2026-09-22T10:00:00Z';
    await db.execute(
      `INSERT INTO vulnerability_syncs (org, trigger_kind, status, started_at, finished_at, issues) VALUES ('o','schedule','succeeded',?,?,?)`,
      [finished1, finished1, JSON.stringify([{ kind: 'config', variable: 'VULN_TIER_IN_SCOPE', message: 'VULN_TIER_IN_SCOPE: no repo has the configured in-scope tier' }])],
    );
    await db.execute(
      `INSERT INTO vulnerability_repos (repo_id, org, full_name, team, service_tier, codebase_type, archived, dependabot_status, first_seen_at, last_seen_at) VALUES (1,'o','o/r1','T1','production','backend',0,'ok',?,?)`,
      [finished1, finished1],
    );
    // A later succeeded run with no config issue — syncConfigErrors reads only the LATEST
    // succeeded/partial run's issues, so this one's clean issues must replace, not add to, the
    // earlier run's sync-sourced entry.
    const finished2 = '2026-09-22T12:00:00Z';
    await db.execute(
      `INSERT INTO vulnerability_syncs (org, trigger_kind, status, started_at, finished_at, issues) VALUES ('o','schedule','succeeded',?,?,'[]')`,
      [finished2, finished2],
    );
    const r = await q.getSummary(f(), NOW);
    expect(r.configErrors.some((e: any) => e.source === 'sync')).toBe(false);
  });

  it('never attaches configErrors to the unknown-team, unknown-repo or repo-not-tracked payloads', async () => {
    process.env.VULNERABILITIES_SLA_POLICY = '{';
    __clearVulnConfigCache();
    await seedOk();
    await db.execute(`INSERT INTO vulnerability_repos (repo_id, org, full_name, team, service_tier, codebase_type, archived, dependabot_status, first_seen_at, last_seen_at) VALUES (2,'o','o/internal','T-Internal','non-production','backend',0,'ok','2026-09-22T10:00:00Z','2026-09-22T10:00:00Z')`);
    const unknownTeam: any = await q.getAlerts(f({ team: 'Nope' }), NOW);
    expect(unknownTeam).not.toHaveProperty('configErrors');
    const repoNotTracked: any = await q.getAlerts(f({ repo: 'o/internal' }), NOW);
    expect(repoNotTracked).not.toHaveProperty('configErrors');
    const unknownRepo: any = await q.getAlerts(f({ repo: 'o/does-not-exist' }), NOW);
    expect(unknownRepo).not.toHaveProperty('configErrors');
  });
});
