// GLOOK-63: range figures through the REAL SQLite driver. Each source counts an item once across
// overlapping reports and excludes items outside the range.
jest.mock('@octokit/rest', () => ({ Octokit: jest.fn().mockImplementation(() => ({})) }));

import fs from 'fs';
import os from 'os';
import path from 'path';
import { computeImpactScore } from '@/lib/impact-score';

let dbPath: string;
let db: any;
let range: typeof import('@/lib/report/range');
let store: typeof import('@/lib/pr-activity/store');
const priorSqlitePath = process.env.SQLITE_PATH;
const priorDbType = process.env.DB_TYPE;
const WINDOW = { since: '2026-07-30', until: '2026-10-28', days: 90 };

beforeAll(async () => {
  dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'glooker-range-')), 'test.db');
  process.env.SQLITE_PATH = dbPath;
  process.env.DB_TYPE = 'sqlite';
  db = (await import('@/lib/db')).default;
  range = await import('@/lib/report/range');
  store = await import('@/lib/pr-activity/store');

  // Three overlapping daily reports inside the range, one old report outside it, one other org.
  const reports: Array<[string, string, string, string]> = [
    ['r0', 'acme', '2026-05-01T12:00:00Z', '2026-05-01T13:00:00Z'],
    ['r1', 'acme', '2026-10-01T12:00:00Z', '2026-10-01T13:00:00Z'],
    ['r2', 'acme', '2026-10-02T12:00:00Z', '2026-10-02T13:00:00Z'],
    ['r3', 'acme', '2026-10-03T12:00:00Z', '2026-10-03T13:00:00Z'],
    ['x1', 'other', '2026-10-03T12:00:00Z', '2026-10-03T13:00:00Z'],
  ];
  for (const [id, org, created, completed] of reports) {
    await db.execute(
      `INSERT INTO reports (id, org, period_days, status, created_at, completed_at) VALUES (?, ?, 14, 'completed', ?, ?)`,
      [id, org, created, completed],
    );
  }
  await db.execute(`INSERT INTO developer_stats (report_id, github_login, github_name, avatar_url) VALUES ('r0', 'bob', 'Bob', '')`);
  await db.execute(`INSERT INTO developer_stats (report_id, github_login, github_name, avatar_url) VALUES ('r0', 'alice', 'Old Alice', '')`);
  for (const id of ['r1', 'r2', 'r3']) {
    await db.execute(`INSERT INTO developer_stats (report_id, github_login, github_name, avatar_url) VALUES (?, 'alice', ?, 'a.png')`, [id, `Alice ${id}`]);
  }
  await db.execute(`INSERT INTO developer_stats (report_id, github_login, github_name) VALUES ('x1', 'alice', 'Other')`);
  // Failed and running reports in the range: their rows must never be counted.
  for (const [id, status] of [['f1', 'failed'], ['p1', 'running']]) {
    await db.execute(
      `INSERT INTO reports (id, org, period_days, status, created_at, completed_at) VALUES (?, 'acme', 14, ?, '2026-10-04T12:00:00Z', '2026-10-04T13:00:00Z')`,
      [id, status],
    );
    await db.execute(
      `INSERT INTO commit_analyses (report_id, github_login, repo, commit_sha, complexity, type, lines_added, lines_removed, committed_at, pr_number, ai_co_authored, maybe_ai)
       VALUES (?, 'alice', 'app', ?, 4, 'feature', 10, 2, '2026-09-25T10:00:00Z', 7, 0, 1)`, [id, `bad-${id}`]);
    await db.execute(
      `INSERT INTO jira_issues (report_id, github_login, jira_account_id, issue_key, project_key, story_points, resolved_at)
       VALUES (?, 'alice', 'acc', ?, 'J', 3, '2026-09-26T10:00:00Z')`, [id, `J-BAD-${id}`]);
  }

  const commit = (rid: string, sha: string, at: string) => db.execute(
    `INSERT INTO commit_analyses (report_id, github_login, repo, commit_sha, complexity, type, lines_added, lines_removed, committed_at, pr_number, ai_co_authored, maybe_ai)
     VALUES (?, 'alice', 'app', ?, 4, 'feature', 10, 2, ?, 7, 0, 1)`, [rid, sha, at]);
  for (const id of ['r1', 'r2', 'r3']) await commit(id, 'aaa', '2026-09-20T10:00:00Z');
  await commit('r0', 'old', '2026-04-20T10:00:00Z');
  await commit('x1', 'zzz', '2026-09-20T10:00:00Z');

  const issue = (rid: string, key: string, at: string) => db.execute(
    `INSERT INTO jira_issues (report_id, github_login, jira_account_id, issue_key, project_key, story_points, resolved_at)
     VALUES (?, 'alice', 'acc', ?, 'J', 3, ?)`, [rid, key, at]);
  for (const id of ['r1', 'r2', 'r3']) await issue(id, 'J-1', '2026-09-21T10:00:00Z');
  await issue('r0', 'J-OLD', '2026-04-21T10:00:00Z');

  const pr = (n: number, at: string) => ({ number: n, title: 't', repo: 'app', mergedAt: at });
  for (let i = 0; i < 3; i++) await store.upsertPrActivity('acme', 'alice', 'authored', [pr(1, '2026-09-20T10:00:00Z')]);
  await store.upsertPrActivity('acme', 'alice', 'authored', [pr(2, '2026-04-01T10:00:00Z')]);
  // In range but outside every coverage slice: must not count (controller ruling P3).
  await store.upsertPrActivity('acme', 'alice', 'authored', [pr(3, '2026-08-15T10:00:00Z')]);
  await store.upsertPrActivity('acme', 'alice', 'reviewed', [pr(6, '2026-08-16T10:00:00Z')]);
  await store.upsertPrActivity('acme', 'alice', 'reviewed', [pr(5, '2026-09-22T10:00:00Z')]);
  await store.upsertPrActivity('other', 'alice', 'authored', [pr(1, '2026-09-20T10:00:00Z')]);
  await store.recordPrCoverage('acme', 'alice', '2026-09-18', '2026-10-03', 'report');
});
afterAll(() => {
  if (priorSqlitePath === undefined) delete process.env.SQLITE_PATH; else process.env.SQLITE_PATH = priorSqlitePath;
  if (priorDbType === undefined) delete process.env.DB_TYPE; else process.env.DB_TYPE = priorDbType;
  try { fs.rmSync(path.dirname(dbPath), { recursive: true, force: true }); } catch { /* gone */ }
});

describe('getRangeDeveloperStats', () => {
  it('lists only developers in a report whose window overlaps the range', async () => {
    const rows = await range.getRangeDeveloperStats('acme', WINDOW);
    expect(rows.map(r => r.github_login)).toEqual(['alice']);
    expect(rows[0].github_name).toBe('Alice r3'); // latest report's name
  });

  it('counts each commit, issue and PR once across three overlapping reports, excluding out-of-range items', async () => {
    const [a] = await range.getRangeDeveloperStats('acme', WINDOW);
    expect(a).toMatchObject({
      total_commits: 1, lines_added: 10, lines_removed: 2, avg_complexity: 4,
      pr_percentage: 100, ai_percentage: 100, type_breakdown: { feature: 1 }, active_repos: ['app'],
      total_jira_issues: 1, total_story_points: 3,
      total_prs: 1, total_reviews: 1,
      measured_days: 15, pr_covered_days: 15, pr_covered_since: '2026-09-18',
    });
  });

  it('ignores PR rows merged in the range but outside every PR coverage slice', async () => {
    const [a] = await range.getRangeDeveloperStats('acme', { since: '2026-08-01', until: '2026-10-28', days: 88 });
    expect(a.total_prs).toBe(1);
    expect(a.total_reviews).toBe(1);
  });

  it('scores with measured days for volume and PR-covered days for PR/review caps', async () => {
    const [a] = await range.getRangeDeveloperStats('acme', WINDOW);
    expect(a.impact_score).toBe(computeImpactScore({
      totalCommits: 1, totalPRs: 1, avgComplexity: 4, prPercentage: 100,
      totalStoryPoints: 3, totalJiraIssues: 1, totalReviews: 1, periodDays: 15, prPeriodDays: 15,
    }));
  });

  it('a range with no measured days still scores finitely', async () => {
    // r0's window ends 2026-05-01 12:00, so it overlaps this one-day range but covers no whole day.
    const rows = await range.getRangeDeveloperStats('acme', { since: '2026-05-01', until: '2026-05-02', days: 1 });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].measured_days).toBe(0);
    expect(rows.every(r => Number.isFinite(r.impact_score))).toBe(true);
  });
});

describe('range drill-downs', () => {
  it('getRangeCommits returns one row per commit, in range only', async () => {
    const rows = await range.getRangeCommits('acme', 'alice', WINDOW);
    expect(rows.map((r: any) => r.commit_sha)).toEqual(['aaa']);
  });
  it('ignores commits and issues that exist only in failed or running reports', async () => {
    const commits = await range.getRangeCommits('acme', 'alice', WINDOW);
    expect(commits.map((r: any) => r.commit_sha)).not.toEqual(expect.arrayContaining(['bad-f1']));
    expect(commits.map((r: any) => r.commit_sha)).toEqual(['aaa']);
    const issues = await range.getRangeJiraIssues('acme', 'alice', WINDOW);
    expect(issues.map((r: any) => r.issue_key)).toEqual(['J-1']);
    const [a] = await range.getRangeDeveloperStats('acme', WINDOW);
    expect(a.total_commits).toBe(1);
    expect(a.total_jira_issues).toBe(1);
  });
  it('getRangeJiraIssues returns one row per issue key, in range only', async () => {
    const rows = await range.getRangeJiraIssues('acme', 'alice', WINDOW);
    expect(rows.map((r: any) => r.issue_key)).toEqual(['J-1']);
    expect(rows[0].story_points).toBe(3);
    expect(Array.isArray(rows[0].labels)).toBe(true);
  });
  it('loadReportRangeWindow resolves the org and window from a report id', async () => {
    expect(await range.loadReportRangeWindow('r3', '90d')).toEqual({
      org: 'acme', window: range.rangeWindow({ completed_at: '2026-10-03T13:00:00Z' }, '90d'),
    });
    expect(await range.loadReportRangeWindow('missing', '90d')).toBeNull();
  });
});
