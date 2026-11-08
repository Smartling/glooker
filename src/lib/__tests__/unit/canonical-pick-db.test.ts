jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));

import fs from 'fs';
import os from 'os';
import path from 'path';

let dbPath: string;
let db: any;
let pick: any;
const ids: Record<string, number> = {};

// process.env is shared across test files in a worker; restore in afterAll.
const priorSqlitePath = process.env.SQLITE_PATH;
const priorDbType = process.env.DB_TYPE;

async function commit(report: string, sha: string, complexity: number | null, tag: string) {
  await db.execute(
    `INSERT INTO commit_analyses (report_id, github_login, repo, commit_sha, complexity, committed_at,
       commit_message, impact_summary, pr_title)
     VALUES (?, 'u', ?, ?, ?, '2026-10-01 00:00:00', ?, ?, ?)`,
    [report, `repo-${tag}`, sha, complexity, `msg-${tag}`, `impact-${tag}`, `pr-${tag}`],
  );
  const [rows] = await db.execute('SELECT id FROM commit_analyses WHERE report_id = ? AND commit_sha = ?', [report, sha]);
  return rows[0].id as number;
}

async function jira(report: string, key: string, login: string) {
  await db.execute(
    `INSERT INTO jira_issues (report_id, github_login, project_key, issue_key) VALUES (?, ?, 'J', ?)`,
    [report, login, key],
  );
}

beforeAll(async () => {
  dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'glooker-pick-')), 'test.db');
  process.env.SQLITE_PATH = dbPath;
  process.env.DB_TYPE = 'sqlite';
  db = (await import('@/lib/db')).default;
  pick = await import('@/lib/canonical/pick');

  const reps: [string, string, string][] = [
    ['r1', 'acme', 'completed'], ['r2', 'acme', 'completed'], ['r3', 'acme', 'completed'],
    ['f1', 'acme', 'failed'], ['p1', 'acme', 'running'], ['x1', 'other', 'completed'],
  ];
  for (const [id, org, status] of reps) {
    await db.execute('INSERT INTO reports (id, org, period_days, status) VALUES (?, ?, 14, ?)', [id, org, status]);
  }
  ids.r1 = await commit('r1', 'dup', 4, 'r1');
  ids.r2 = await commit('r2', 'dup', 6, 'r2');
  ids.r3 = await commit('r3', 'dup', null, 'r3');
  ids.f1 = await commit('f1', 'dup', 9, 'f1');
  await commit('f1', 'fx', 3, 'fx');
  await commit('x1', 'zzz', 3, 'zzz');
  await jira('r1', 'J-1', 'alice');
  await jira('r2', 'J-1', 'bob');
  await jira('f1', 'J-1', 'carol');
});
afterAll(() => {
  if (priorSqlitePath === undefined) delete process.env.SQLITE_PATH;
  else process.env.SQLITE_PATH = priorSqlitePath;
  if (priorDbType === undefined) delete process.env.DB_TYPE;
  else process.env.DB_TYPE = priorDbType;
  try { fs.unlinkSync(dbPath); } catch {}
});

it('pick prefers analysed, then highest id', async () => {
  expect((await pick.expectedCommitPicks('acme')).get('dup')).toBe(ids.r2);
});

it('ignores failed and running reports and other orgs', async () => {
  expect([...(await pick.expectedCommitPicks('acme')).keys()]).toEqual(['dup']);
  const [rows] = await db.execute(`SELECT id FROM jira_issues WHERE report_id = 'r2' AND issue_key = 'J-1'`);
  expect((await pick.expectedJiraPicks('acme')).get('J-1')).toBe(rows[0].id);
});

it('refreshCommitKeys inserts the picked row with every copied column', async () => {
  await db.transaction((tx: any) => pick.refreshCommitKeys(tx, 'acme', ['dup']));
  const [rows] = await db.execute(`SELECT * FROM commit_canonical WHERE org = 'acme'`);
  expect(rows).toHaveLength(1);
  const [src] = await db.execute('SELECT * FROM commit_analyses WHERE id = ?', [ids.r2]);
  expect(rows[0]).toMatchObject({
    org: 'acme', commit_sha: 'dup', analysis_id: ids.r2, report_id: 'r2', complexity: 6,
    repo: src[0].repo, committed_at: src[0].committed_at, commit_message: src[0].commit_message,
    impact_summary: src[0].impact_summary, pr_title: src[0].pr_title,
  });
});

it('refreshCommitKeys removes a key with no completed copy', async () => {
  await db.execute(
    `INSERT INTO commit_canonical (org, commit_sha, analysis_id, report_id, github_login, repo)
     VALUES ('acme', 'fx', 1, 'f1', 'u', 'bogus')`);
  await db.transaction((tx: any) => pick.refreshCommitKeys(tx, 'acme', ['fx']));
  const [rows] = await db.execute(`SELECT * FROM commit_canonical WHERE commit_sha = 'fx'`);
  expect(rows).toHaveLength(0);
});

it("refreshJiraKeys credits the latest copy's assignee", async () => {
  await db.transaction((tx: any) => pick.refreshJiraKeys(tx, 'acme', ['J-1']));
  const [rows] = await db.execute(`SELECT * FROM jira_canonical WHERE issue_key = 'J-1'`);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ github_login: 'bob', report_id: 'r2' });
});

it('batches keys beyond CANONICAL_BATCH', async () => {
  const shas: string[] = [];
  await db.transaction(async (tx: any) => {
    for (let i = 0; i < 1201; i++) {
      const sha = `bulk-${i}`;
      shas.push(sha);
      await tx.execute(
        `INSERT INTO commit_analyses (report_id, github_login, repo, commit_sha) VALUES ('r1', 'u', 'r', ?)`, [sha]);
    }
  });
  await db.transaction((tx: any) => pick.refreshCommitKeys(tx, 'acme', shas));
  const [rows] = await db.execute(`SELECT COUNT(*) AS c FROM commit_canonical WHERE commit_sha LIKE 'bulk-%'`);
  expect(Number(rows[0].c)).toBe(1201);
  expect(pick.CANONICAL_BATCH).toBe(500);
});
