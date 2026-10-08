// GLOOK-64: the dev:mock fixtures. Runs the real seed (two syncs against the mock GitHub provider,
// then the unmeasured-with-alerts flag) into a throwaway SQLite database, and checks that the seeded
// data exercises every repository-row state AND that the repository rows still sum to the team pivot.
jest.mock('@octokit/rest', () => ({ Octokit: jest.fn().mockImplementation(() => ({})) })); // queries → scheduler → github.ts
import fs from 'fs'; import os from 'os'; import path from 'path';
import { __clearVulnConfigCache } from '@/lib/vulnerabilities/config';

// The values `npm run dev:mock` sets: both severities have an SLA that took effect in 2020, and the
// Backend group claims both `backend` and `api` repos.
const DEV_MOCK_ENV = {
  VULNERABILITIES_ORG: 'mock-org',
  VULNERABILITIES_SLA_POLICY: JSON.stringify([
    { id: 'critical-2020-01', severity: 'critical', effectiveFrom: '2020-01-08', days: 7 },
    { id: 'high-2020-01', severity: 'high', effectiveFrom: '2020-01-08', days: 9 },
  ]),
  VULN_CODEBASE_GROUPS: JSON.stringify({ backend: ['backend', 'api'], frontend: ['frontend'], shared: ['shared'] }),
  SQLITE_PATH: '', DB_TYPE: 'sqlite',
} as Record<string, string>;
const prior: Record<string, string | undefined> = {};
let dbPath: string;
let q: any;
const f = (over: object = {}) => ({ codebase: 'backend', state: 'open', baseline: 'last', ...over });

beforeAll(async () => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'glooker-seed-vuln-')), 'test.db');
  DEV_MOCK_ENV.SQLITE_PATH = dbPath;
  for (const k of Object.keys(DEV_MOCK_ENV)) { prior[k] = process.env[k]; process.env[k] = DEV_MOCK_ENV[k]; }
  __clearVulnConfigCache();
  const db = (await import('@/lib/db')).default;
  q = await import('@/lib/vulnerabilities/queries');
  const { seedVulnerabilities } = await import('../../../../scripts/seed-vulnerabilities');
  await seedVulnerabilities(db);
  q.__clearVulnFactsCache();
}, 60_000);
afterAll(() => {
  for (const k of Object.keys(DEV_MOCK_ENV)) { if (prior[k] === undefined) delete process.env[k]; else process.env[k] = prior[k]; }
  __clearVulnConfigCache();
  try { fs.unlinkSync(dbPath); } catch { /* the file may already be gone */ }
});

it('seeds every repository-row state the page needs', async () => {
  const { rows } = await q.getRepos(f({ codebase: 'all' }));
  const byName = (n: string) => rows.find((r: any) => r.fullName === `mock-org/${n}`);
  // a repo with nothing open: listed, with zero counts
  expect(byName('quiet-service')).toMatchObject({ critical: { open: 0 }, high: { open: 0 }, unmeasured: null });
  // an unmeasured repo that still has stored open alerts: the stored count is carried, the status says it may be stale
  const stale = byName('stale-scanner');
  expect(stale.unmeasured).toEqual({ status: 'dependabot-off', detail: 'Dependabot alerts are disabled for this repository.' });
  expect(stale.critical.open + stale.high.open).toBeGreaterThan(0);
  // an unmeasured repo with no alerts at all, and unmeasured rows come last
  expect(byName('flaky-service').unmeasured).toMatchObject({ status: 'error' });
  const firstUnmeasured = rows.findIndex((r: any) => r.unmeasured);
  expect(rows.slice(firstUnmeasured).every((r: any) => r.unmeasured)).toBe(true);
  // an archived repo is never a row
  expect(byName('legacy-billing')).toBeUndefined();
  // both SLAs are active in dev:mock, so the overdue columns exist
  expect(rows.some((r: any) => r.critical.overdue !== null && r.high.overdue !== null)).toBe(true);
});

it('seeds 13 owning teams plus Unassigned in the Backend view: 14 pivot rows, more than the 12 the page can colour', async () => {
  const { pivot } = await q.getSummary(f());
  expect(pivot.rows).toHaveLength(14);
  expect(pivot.rows.map((t: any) => t.team)).toEqual(expect.arrayContaining(['Payments', 'Compliance', 'Unassigned']));
});

describe('the seeded repository rows sum to the team pivot', () => {
  const combos = [['backend', undefined], ['all', undefined], ['backend', 'Search'], ['all', 'Platform'], ['all', 'Unassigned'], ['frontend', undefined]] as const;
  it.each(combos)('codebase=%s team=%s', async (codebase, team) => {
    const { rows: teams } = (await q.getSummary(f({ codebase, team }))).pivot;
    const repoRows = (await q.getRepos(f({ codebase, team }))).rows;
    expect(teams.length).toBeGreaterThan(0);
    for (const t of teams) {
      const mine = repoRows.filter((r: any) => r.team === t.team);
      for (const sev of ['critical', 'high'] as const) {
        for (const fig of ['open', 'overdue', 'dueSoon'] as const) {
          expect(t[sev][fig]).not.toBeNull(); // dev:mock activates both SLAs
          expect(mine.reduce((n: number, r: any) => n + r[sev][fig], 0)).toBe(t[sev][fig]);
        }
      }
      expect(mine.filter((r: any) => r.unmeasured).length).toBe(t.unmeasuredRepos);
    }
  });

  it("independent cross-check: each row's open equals getAlerts' open total for that repo, unmeasured repos included", async () => {
    const rows = (await q.getRepos(f({ codebase: 'all' }))).rows;
    for (const row of rows) {
      const listed = await q.getAlerts(f({ codebase: 'all', repo: row.fullName }));
      expect(listed.totalCount).toBe(row.critical.open + row.high.open);
    }
  });

  it('codebaseCounts[c] equals the pivot total open for codebase c', async () => {
    const { codebaseCounts } = await q.getSummary(f());
    for (const c of ['backend', 'frontend', 'shared', 'other', 'all']) {
      const { pivot } = await q.getSummary(f({ codebase: c }));
      expect(codebaseCounts[c]).toEqual({ critical: pivot.total.critical.open, high: pivot.total.high.open });
    }
  });
});
