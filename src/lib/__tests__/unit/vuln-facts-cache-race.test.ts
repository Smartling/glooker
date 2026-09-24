// the facts cache race. queries.ts's loadFacts() used to write
// `factsCache.alerts = await loadAlerts(org)` onto whatever `factsCache` currently was, then
// re-read the module variable — a caller that started the load could find its own entry replaced
// by a later caller's before it got back around to reading it. This test controls the DB response
// ordering by hand (deferred promises) to force three concurrent readers to interleave on a cold
// cache, then asserts every caller gets real data and the alerts table is queried once, not three
// times.
jest.mock('@octokit/rest', () => ({ Octokit: jest.fn().mockImplementation(() => ({})) })); // queries → scheduler → github.ts
jest.mock('@/lib/db/index', () => ({ __esModule: true, default: { execute: jest.fn(), transaction: jest.fn() } }));

import db from '@/lib/db/index';

const priorOrg = process.env.VULNERABILITIES_ORG;

let queries: any;
beforeAll(async () => {
  process.env.VULNERABILITIES_ORG = 'o';
  queries = await import('@/lib/vulnerabilities/queries');
});
afterAll(() => {
  if (priorOrg === undefined) delete process.env.VULNERABILITIES_ORG; else process.env.VULNERABILITIES_ORG = priorOrg;
});
beforeEach(() => {
  (db.execute as jest.Mock).mockReset();
  queries.__clearVulnFactsCache();
});

const REPO_ROW = {
  repo_id: 1, full_name: 'o/r1', team: null, service_tier: 'production', codebase_type: 'backend',
  archived: 0, dependabot_status: 'ok', dependabot_status_detail: null,
};
const ALERT_ROW = {
  repo_id: 1, number: 1, html_url: 'u', state: 'open', severity: 'critical', severity_changed_at: null,
  ghsa_id: null, cve_id: null, summary: null, cvss_score: null, epss_percentage: null, advisory_withdrawn_at: null,
  package_name: null, ecosystem: null, manifest_path: null, relationship: null, scope: null,
  created_at: '2026-09-01T00:00:00Z', fixed_at: null, dismissed_at: null, auto_dismissed_at: null,
  dismissed_reason: null, reopened_count: 0, last_reopened_at: null, missing_since: null,
};

interface Deferred<T> { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void; }
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
async function flushUntil(predicate: () => boolean, maxTicks = 100) {
  for (let i = 0; i < maxTicks && !predicate(); i++) await Promise.resolve();
}

/** Wires the mocked db.execute to hand back canned rows for every query EXCEPT the two
 * whole-table loads (repos, alerts), which are handed out as controllable deferred promises so
 * the test can choose the resolution order by hand. */
function wireExecute() {
  const repoLoads: Deferred<[any[], any]>[] = [];
  const alertLoads: Deferred<[any[], any]>[] = [];
  (db.execute as jest.Mock).mockImplementation((sql: string) => {
    // Order matters: the factsCacheKey COUNT query and the whole-table repo load both end in
    // "FROM vulnerability_repos WHERE org = ?", so the more specific patterns must be checked first.
    if (/SELECT status, issues FROM vulnerability_syncs/.test(sql)) return Promise.resolve([[{ status: 'succeeded', issues: '[]' }], null]);
    // prepare()'s configErrors channel reads the latest succeeded/partial sync's
    // issues via syncConfigErrors — a distinct query from the plain "finished_at only" one below
    // (more specific pattern checked first), answered with "no rows" so it falls out to [].
    if (/SELECT finished_at, issues FROM vulnerability_syncs/.test(sql)) return Promise.resolve([[], null]);
    if (/SELECT finished_at FROM vulnerability_syncs/.test(sql)) return Promise.resolve([[{ finished_at: '2026-09-22T10:00:00Z' }], null]);
    if (/SELECT MAX\(id\) AS m/.test(sql)) return Promise.resolve([[{ m: 1 }], null]);
    if (/SELECT COUNT\(\*\) AS n FROM vulnerability_repos/.test(sql)) return Promise.resolve([[{ n: 1 }], null]);
    if (/DISTINCT source, sync_id/.test(sql)) return Promise.resolve([[], null]);
    // loadRepos also runs a carried-resolved-critical query (a JOIN against
    // vulnerability_repo_snapshots) as part of the same call — answer it with "no carries" so it
    // doesn't fall through to the reject-unknown-query branch below.
    if (/JOIN vulnerability_repo_snapshots/.test(sql)) return Promise.resolve([[], null]);
    if (/^SELECT \* FROM vulnerability_repos WHERE org = \?$/.test(sql)) {
      const d = deferred<[any[], any]>(); repoLoads.push(d); return d.promise;
    }
    if (/^SELECT \* FROM vulnerability_alerts WHERE org = \?$/.test(sql)) {
      const d = deferred<[any[], any]>(); alertLoads.push(d); return d.promise;
    }
    return Promise.reject(new Error(`vuln-facts-cache-race test: unexpected query: ${sql}`));
  });
  return { repoLoads, alertLoads };
}

const NOW = new Date('2026-09-22T12:00:00Z');
const f = { codebase: 'backend', state: 'open', baseline: 'last' } as any;

it('three concurrent readers on a cold cache all resolve with real data, and the alerts table is queried once', async () => {
  const { repoLoads, alertLoads } = wireExecute();

  const p1 = queries.getSummary(f, NOW);
  const p2 = queries.getAlerts(f, NOW);
  const p3 = queries.getCoverage(f, NOW);

  // Let every caller run its (pre-resolved) getSyncStatus + factsCacheKey queries and reach the
  // point of deciding whether to load repos.
  await flushUntil(() => repoLoads.length >= 3);
  expect(repoLoads.length).toBeGreaterThanOrEqual(1); // sanity: at least one caller started a repo load

  // Resolve the repo loads in reverse order, so whichever caller issued its repo query LAST ends
  // up being the last to write `factsCache`, and therefore "owns" the entry the others may have
  // already started building on.
  for (let i = repoLoads.length - 1; i >= 0; i--) {
    repoLoads[i].resolve([[REPO_ROW], null]);
    await flushUntil(() => true, 3);
  }
  await flushUntil(() => alertLoads.length >= 1);

  // Resolve the FIRST caller's alerts load while later ones may still be pending, then drain the
  // rest — the exact shape of the bug (mixed data vs. a bare null) depends on interleaving, but a
  // fixed single-flight cache should only ever have issued one alerts query in the first place.
  for (let i = 0; i < alertLoads.length; i++) {
    alertLoads[i].resolve([[ALERT_ROW], null]);
    await flushUntil(() => true, 3);
  }

  const [summary, alerts, coverage] = await Promise.all([p1, p2, p3]);

  expect(summary.available).toBe(true);
  expect(summary.pivot).toBeTruthy();
  expect(alerts.available).toBe(true);
  expect(Array.isArray(alerts.rows)).toBe(true);
  expect(coverage.available).toBe(true);

  const alertQueryCount = (db.execute as jest.Mock).mock.calls
    .filter((c: any[]) => /FROM vulnerability_alerts WHERE org = \?$/.test(String(c[0]))).length;
  expect(alertQueryCount).toBe(1);

  // the same single-flight cache applies to the whole-table repos load, not
  // just alerts — three concurrent callers on a cold cache must load repos once, not once each.
  // Anchored to the exact whole-table load query so it can't accidentally also count the
  // factsCacheKey COUNT(*) query above, which also reads FROM vulnerability_repos WHERE org = ?.
  const repoQueryCount = (db.execute as jest.Mock).mock.calls
    .filter((c: any[]) => /^SELECT \* FROM vulnerability_repos WHERE org = \?$/.test(String(c[0]))).length;
  expect(repoQueryCount).toBe(1);
});

it('a rejected alerts load evicts the cache entry, and the next call reloads from the DB', async () => {
  const { repoLoads, alertLoads } = wireExecute();

  const p1 = queries.getSummary(f, NOW);
  await flushUntil(() => repoLoads.length >= 1);
  repoLoads[0].resolve([[REPO_ROW], null]);
  await flushUntil(() => alertLoads.length >= 1);
  alertLoads[0].reject(new Error('boom'));
  await expect(p1).rejects.toBeTruthy();

  // A fresh call after the rejection must reload the WHOLE entry from the DB, not just alerts —
  // the spec calls for evicting the entry, not patching around a poisoned one.
  const { repoLoads: repoLoads2, alertLoads: alertLoads2 } = wireExecute();
  const p2 = queries.getSummary(f, NOW);
  await flushUntil(() => repoLoads2.length >= 1);
  expect(repoLoads2.length).toBeGreaterThanOrEqual(1); // the evicted entry forces a fresh repo load too
  repoLoads2[0].resolve([[REPO_ROW], null]);
  await flushUntil(() => alertLoads2.length >= 1);
  alertLoads2[0].resolve([[ALERT_ROW], null]);
  const summary2 = await p2;
  expect(summary2.available).toBe(true);
});
