// GLOOK-63: range readers give the same figures from the canonical tables as from the per-report
// fallback, through the REAL SQLite driver. The one allowed difference is documented below.
jest.mock('@octokit/rest', () => ({ Octokit: jest.fn().mockImplementation(() => ({})) }));

import fs from 'fs';
import os from 'os';
import path from 'path';

let dbPath: string;
let db: any;
let range: typeof import('@/lib/report/range');
let rb: typeof import('@/lib/canonical/rebuild');
let service: typeof import('@/lib/report/service');
const priorSqlitePath = process.env.SQLITE_PATH;
const priorDbType = process.env.DB_TYPE;

const R3 = { created_at: '2026-10-03T12:00:00Z', completed_at: '2026-10-03T13:00:00Z' };

async function snapshot() {
  const w90 = range.rangeWindow(R3, '90d');
  const w12 = range.rangeWindow(R3, '12m');
  return {
    dev90: await range.getRangeDeveloperStats('acme', w90),
    dev12: await range.getRangeDeveloperStats('acme', w12),
    commits90: await range.getRangeCommits('acme', 'alice', w90),
    commits12: await range.getRangeCommits('acme', 'alice', w12),
    jira90: await range.getRangeJiraIssues('acme', undefined, w90),
    jira12: await range.getRangeJiraIssues('acme', undefined, w12),
    current: await service.getReport('r3', 'current'),
  };
}

const commit = (rid: string, sha: string, at: string, complexity: number | null = 4, login = 'alice') => db.execute(
  `INSERT INTO commit_analyses (report_id, github_login, repo, commit_sha, commit_message, complexity, type, lines_added, lines_removed, committed_at, pr_number, ai_co_authored, maybe_ai)
   VALUES (?, ?, 'app', ?, 'msg', ?, 'feature', 10, 2, ?, 7, 0, 1)`, [rid, login, sha, complexity, at]);
const issue = (rid: string, key: string, login: string, at: string) => db.execute(
  `INSERT INTO jira_issues (report_id, github_login, jira_account_id, issue_key, project_key, summary, labels, story_points, resolved_at)
   VALUES (?, ?, 'acc', ?, 'J', 's', '["x"]', 2.5, ?)`, [rid, login, key, at]);

beforeAll(async () => {
  dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'glooker-equiv-')), 'test.db');
  process.env.SQLITE_PATH = dbPath;
  process.env.DB_TYPE = 'sqlite';
  db = (await import('@/lib/db')).default;
  range = await import('@/lib/report/range');
  rb = await import('@/lib/canonical/rebuild');
  service = await import('@/lib/report/service');

  const reports: Array<[string, string, string]> = [
    ['r0', 'completed', '2026-05-01'],
    ['r1', 'completed', '2026-10-01'],
    ['r2', 'completed', '2026-10-02'],
    ['r3', 'completed', '2026-10-03'],
    ['f1', 'failed', '2026-10-04'],
  ];
  for (const [id, status, day] of reports) {
    await db.execute(
      `INSERT INTO reports (id, org, period_days, status, created_at, completed_at) VALUES (?, 'acme', 14, ?, ?, ?)`,
      [id, status, `${day}T12:00:00Z`, `${day}T13:00:00Z`],
    );
  }
  for (const id of ['r0', 'r1', 'r2', 'r3']) {
    for (const login of ['alice', 'bob']) {
      await db.execute(
        `INSERT INTO developer_stats (report_id, github_login, github_name, avatar_url, total_commits) VALUES (?, ?, ?, 'a.png', 3)`,
        [id, login, `${login} ${id}`]);
    }
  }
  await commit('r1', 'dup', '2026-09-20T10:00:00Z', 4);
  await commit('r2', 'dup', '2026-09-20T10:00:00Z', 6);
  await commit('r3', 'dup', '2026-09-20T10:00:00Z', null);
  await commit('r1', 'c1', '2026-09-28T10:00:00Z', 3);
  await commit('r2', 'c2', '2026-09-29T10:00:00Z', 5, 'bob');
  await commit('r3', 'c3', '2026-10-02T10:00:00Z', 2);
  await commit('r0', 'old', '2026-04-20T10:00:00Z', 7);
  await commit('f1', 'fx', '2026-10-03T10:00:00Z', 9);
  await issue('r1', 'J-1', 'alice', '2026-09-21T10:00:00Z');
  await issue('r2', 'J-1', 'alice', '2026-09-21T10:00:00Z');
  await issue('r3', 'J-1', 'bob', '2026-09-21T10:00:00Z');
  await issue('r0', 'J-OLD', 'alice', '2026-04-21T10:00:00Z');
});
afterAll(() => {
  if (priorSqlitePath === undefined) delete process.env.SQLITE_PATH;
  else process.env.SQLITE_PATH = priorSqlitePath;
  if (priorDbType === undefined) delete process.env.DB_TYPE;
  else process.env.DB_TYPE = priorDbType;
  try { fs.unlinkSync(dbPath); } catch {}
});
beforeEach(() => range.clearRangeCache());

let before: any;
let after: any;

it('fallback (not built) matches the canonical tables after a rebuild', async () => {
  before = await snapshot();
  expect(before.commits12.map((c: any) => c.commit_sha)).toEqual(['c3', 'c1', 'dup', 'old']);
  await rb.rebuildCanonical();
  range.clearRangeCache();
  after = await snapshot();
  expect(after).toEqual(before);
});

it('current-report figures are unchanged by a build', () => {
  expect(after.current).toEqual(before.current);
});

it('a commit found only by a non-overlapping report is counted after the build (documented difference)', async () => {
  await db.execute(`DELETE FROM canonical_builds WHERE org = 'acme'`);
  await commit('r0', 'rebased', '2026-09-25T10:00:00Z', 1);
  const w90 = range.rangeWindow(R3, '90d');
  const pre = await range.getRangeCommits('acme', 'alice', w90);
  expect(pre.map((c: any) => c.commit_sha)).not.toContain('rebased');
  await rb.rebuildCanonical();
  range.clearRangeCache();
  const post = await range.getRangeCommits('acme', 'alice', w90);
  expect(post.map((c: any) => c.commit_sha)).toContain('rebased');
});

it('cache key changes when built_at changes', async () => {
  const w90 = range.rangeWindow(R3, '90d');
  const first = await range.getRangeDeveloperStats('acme', w90);
  const alice = first.find((d) => d.github_login === 'alice')!;
  await db.execute(`UPDATE commit_canonical SET lines_added = lines_added + 1000 WHERE org = 'acme' AND commit_sha = 'c1'`);
  await db.execute(`UPDATE canonical_builds SET built_at = '2099-01-01 00:00:00' WHERE org = 'acme'`);
  const second = await range.getRangeDeveloperStats('acme', w90);
  expect(second.find((d) => d.github_login === 'alice')!.lines_added).toBe(alice.lines_added + 1000);
});
