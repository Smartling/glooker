// GLOOK-63: getReport/getDevReport range overlay through the real SQLite driver.
jest.mock('@octokit/rest', () => ({ Octokit: jest.fn().mockImplementation(() => ({})) }));
jest.mock('@/lib/report-runner', () => ({ runReport: jest.fn().mockResolvedValue(undefined), requestStop: jest.fn() }));
jest.mock('@/lib/progress-store', () => ({ initProgress: jest.fn(), updateProgress: jest.fn(), getProgress: jest.fn() }));

import fs from 'fs';
import os from 'os';
import path from 'path';

let dbPath: string;
let db: any;
let getReport: any;
let getDevReport: any;
const priorSqlitePath = process.env.SQLITE_PATH;
const priorDbType = process.env.DB_TYPE;

beforeAll(async () => {
  dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'glooker-range-svc-')), 'test.db');
  process.env.SQLITE_PATH = dbPath;
  process.env.DB_TYPE = 'sqlite';
  db = (await import('@/lib/db')).default;
  ({ getReport } = await import('@/lib/report/service'));
  ({ getDevReport } = await import('@/lib/report/dev'));
  for (const [id, created, completed] of [['r1', '2026-09-20T12:00:00Z', '2026-09-20T13:00:00Z'], ['r2', '2026-10-03T12:00:00Z', '2026-10-03T13:00:00Z']]) {
    await db.execute(`INSERT INTO reports (id, org, period_days, status, created_at, completed_at) VALUES (?, 'acme', 14, 'completed', ?, ?)`, [id, created, completed]);
  }
  // carol only exists in the older r1; alice in both, with spend on r2.
  await db.execute(`INSERT INTO developer_stats (report_id, github_login, github_name, total_commits, impact_score) VALUES ('r1', 'carol', 'Carol', 1, 1)`);
  await db.execute(`INSERT INTO developer_stats (report_id, github_login, github_name, total_commits, impact_score) VALUES ('r1', 'alice', 'Alice', 1, 1)`);
  await db.execute(`INSERT INTO developer_stats (report_id, github_login, github_name, total_commits, impact_score, cc_total_cost, cc_requests, cc_skills_used) VALUES ('r2', 'alice', 'Alice', 1, 1, 250, 9, 4)`);
  await db.execute(`INSERT INTO commit_analyses (report_id, github_login, repo, commit_sha, lines_added, lines_removed, committed_at) VALUES ('r1', 'alice', 'app', 's1', 1, 0, '2026-09-10T10:00:00Z')`);
  await db.execute(`INSERT INTO commit_analyses (report_id, github_login, repo, commit_sha, lines_added, lines_removed, committed_at) VALUES ('r2', 'alice', 'app', 's2', 1, 0, '2026-09-30T10:00:00Z')`);
});
afterAll(() => {
  if (priorSqlitePath === undefined) delete process.env.SQLITE_PATH; else process.env.SQLITE_PATH = priorSqlitePath;
  if (priorDbType === undefined) delete process.env.DB_TYPE; else process.env.DB_TYPE = priorDbType;
  try { fs.rmSync(path.dirname(dbPath), { recursive: true, force: true }); } catch { /* gone */ }
});

it('current report: no range block and today\'s developer rows', async () => {
  const res = await getReport('r2');
  expect(res.range).toBeUndefined();
  expect(res.developers.map((d: any) => d.github_login)).toEqual(['alice']);
});

it('90d: range figures, current-report spend kept, absentee gets no cc fields', async () => {
  const res = await getReport('r2', '90d');
  expect(res.range).toMatchObject({ key: '90d', until: '2026-10-04', days: 90, prCoveredSince: null });
  expect(res.range.measuredDays).toBeGreaterThan(0);
  const alice = res.developers.find((d: any) => d.github_login === 'alice');
  const carol = res.developers.find((d: any) => d.github_login === 'carol');
  expect(alice).toMatchObject({ total_commits: 2, cc_total_cost: 250, cc_requests: 9 });
  expect(carol).toBeDefined();
  expect(carol).not.toHaveProperty('cc_total_cost');
});

it('getDevReport 90d: range KPIs, range commits, percentiles over range developers, spend from current', async () => {
  const res = await getDevReport('r2', 'alice', '90d');
  expect(res.developer).toMatchObject({ total_commits: 2, cc_total_cost: 250, cc_skills_used: 4 });
  expect(res.commits.map((c: any) => c.commit_sha)).toEqual(['s2', 's1']);
  expect(res.allDevelopers.map((d: any) => d.github_login).sort()).toEqual(['alice', 'carol']);
  expect(res.range.key).toBe('90d');
});

it('getDevReport current: unchanged (one report\'s commits, no range)', async () => {
  const res = await getDevReport('r2', 'alice');
  expect(res.commits.map((c: any) => c.commit_sha)).toEqual(['s2']);
  expect(res.range).toBeUndefined();
});

it('getDevReport 90d: a range-only developer resolves, with no cc fields and no borrowed coverage', async () => {
  const res = await getDevReport('r2', 'carol', '90d');
  expect(res.developer.github_login).toBe('carol');
  expect(res.developer).not.toHaveProperty('cc_total_cost');
  expect(res.range.prCoveredSince).toBeNull();
});

it('getDevReport: a login with no current row and no range stats is not found', async () => {
  await expect(getDevReport('r2', 'nobody', '90d')).rejects.toThrow(/Developer not found/);
  await expect(getDevReport('r2', 'carol')).rejects.toThrow(/Developer not found/);
});
