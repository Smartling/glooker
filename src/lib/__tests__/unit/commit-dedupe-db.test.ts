// Overlapping reports each store their own copy of a commit. The timeline reads must count each
// commit once and, when copies disagree, use the latest ANALYSED copy (canonicalCommitIdsSql in
// report/timeline.ts) — through the REAL SQLite driver, since the choice is made in SQL.
// Env set/restore follows report-coverage-db.test.ts.
jest.mock('@octokit/rest', () => ({ Octokit: jest.fn().mockImplementation(() => ({})) }));
jest.mock('@/lib/report-runner', () => ({ runReport: jest.fn().mockResolvedValue(undefined), requestStop: jest.fn() }));
jest.mock('@/lib/progress-store', () => ({ initProgress: jest.fn(), updateProgress: jest.fn(), getProgress: jest.fn() }));

import fs from 'fs';
import os from 'os';
import path from 'path';

let dbPath: string;
let db: any;
let getOrgReport: any;
let getDevReport: any;
let queryCommits: any;

const priorSqlitePath = process.env.SQLITE_PATH;
const priorDbType = process.env.DB_TYPE;

// Insertion order sets the auto-increment id, so "latest copy" means later in this list.
// [report, login, sha, complexity, type, lines_added]
const COPIES: Array<[string, string, string, number | null, string | null, number]> = [
  ['r1', 'alice', 'aaa', 4, 'feature', 10],  // analysed, OLDER copy...
  ['r1', 'alice', 'bbb', 2, 'bug', 20],
  ['r1', 'bob', 'ccc', null, null, 30],      // only ever unanalysed
  ['r2', 'alice', 'aaa', null, null, 10],    // ...newer copy is unanalysed (backfill-style): keep the analysed one
  ['r2', 'alice', 'bbb', 5, 'feature', 20],  // both analysed: keep the latest
];

beforeAll(async () => {
  dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'glooker-dedupe-')), 'test.db');
  process.env.SQLITE_PATH = dbPath;
  process.env.DB_TYPE = 'sqlite';
  db = (await import('@/lib/db')).default;
  ({ getOrgReport } = await import('@/lib/report/org'));
  ({ getDevReport } = await import('@/lib/report/dev'));
  ({ queryCommits } = await import('@/lib/mcp/queries'));
  for (const id of ['r1', 'r2']) {
    await db.execute(
      `INSERT INTO reports (id, org, period_days, status, created_at, completed_at) VALUES (?, 'dup', 14, 'completed', ?, ?)`,
      [id, '2026-03-18T12:00:00Z', '2026-03-18T12:00:00Z'],
    );
    for (const login of ['alice', 'bob']) {
      await db.execute(`INSERT INTO developer_stats (report_id, github_login, github_name) VALUES (?, ?, ?)`, [id, login, login]);
    }
  }
  for (const [reportId, login, sha, complexity, type, added] of COPIES) {
    await db.execute(
      `INSERT INTO commit_analyses (report_id, github_login, repo, commit_sha, complexity, type, lines_added, lines_removed, committed_at)
       VALUES (?, ?, 'repo', ?, ?, ?, ?, 0, '2026-03-10T10:00:00Z')`,
      [reportId, login, sha, complexity, type, added],
    );
  }
});
afterAll(() => {
  if (priorSqlitePath === undefined) delete process.env.SQLITE_PATH;
  else process.env.SQLITE_PATH = priorSqlitePath;
  if (priorDbType === undefined) delete process.env.DB_TYPE;
  else process.env.DB_TYPE = priorDbType;
  try { fs.rmSync(path.dirname(dbPath), { recursive: true, force: true }); } catch { /* already gone */ }
});

const week = (timeline: any[]) => timeline.find((w: any) => w.week === '2026-03-09');

describe('timeline reads one copy per commit', () => {
  it('org timeline counts each commit once across overlapping reports', async () => {
    const w = week((await getOrgReport('r2')).timeline);
    expect(w.commits).toBe(3);
    expect(w.linesAdded).toBe(60);
  });

  it('prefers the analysed copy, then the latest one', async () => {
    // aaa → 4 (analysed, though older), bbb → 5 (latest), ccc → unanalysed and skipped in the average.
    expect(week((await getOrgReport('r2')).timeline).avgComplexity).toBe(4.5);
  });

  it('dev timeline applies the same rule for one developer', async () => {
    const w = week((await getDevReport('r2', 'alice')).timeline);
    expect(w.commits).toBe(2);
    expect(w.avgComplexity).toBe(4.5);
    expect(w.types).toEqual({ feature: 2 });
  });

  it('the same answer whichever report is selected, and no rows are removed', async () => {
    expect(week((await getOrgReport('r1')).timeline)).toEqual(week((await getOrgReport('r2')).timeline));
    const [[{ n }]] = await db.execute('SELECT COUNT(*) AS n FROM commit_analyses');
    expect(Number(n)).toBe(COPIES.length);
  });

  it('MCP query_commits (cross-report) returns the same copy as the timelines, whole', async () => {
    const out = await queryCommits({});
    const bySha = Object.fromEntries(out.commits.map((c: any) => [c.commit_sha, c]));
    expect(out.count).toBe(3);
    expect(bySha.aaa).toMatchObject({ complexity: 4, type: 'feature' });  // not MIN() across copies
    expect(bySha.bbb).toMatchObject({ complexity: 5, type: 'feature' });  // latest, not lowest (2)
    expect((await queryCommits({ type: 'bug' })).count).toBe(0);          // filters see the chosen copy
  });
});
