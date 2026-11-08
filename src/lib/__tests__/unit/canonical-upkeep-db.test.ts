jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));

import fs from 'fs';
import os from 'os';
import path from 'path';

let dbPath: string;
let db: any;
let rb: any;
let upkeep: any;
let svc: any;

const priorSqlitePath = process.env.SQLITE_PATH;
const priorDbType = process.env.DB_TYPE;

async function report(id: string, org: string, status = 'completed') {
  await db.execute('INSERT INTO reports (id, org, period_days, status) VALUES (?, ?, 14, ?)', [id, org, status]);
}
async function commit(rep: string, sha: string, complexity: number | null) {
  await db.execute(
    `INSERT INTO commit_analyses (report_id, github_login, repo, commit_sha, complexity, committed_at)
     VALUES (?, 'u', 'repo', ?, ?, '2026-10-01 00:00:00')`,
    [rep, sha, complexity],
  );
}
async function jira(rep: string, key: string, login: string) {
  await db.execute(
    `INSERT INTO jira_issues (report_id, github_login, project_key, issue_key) VALUES (?, ?, 'J', ?)`,
    [rep, login, key],
  );
}
async function pickRep(org: string, sha: string): Promise<string | undefined> {
  const [rows] = await db.execute('SELECT report_id FROM commit_canonical WHERE org = ? AND commit_sha = ?', [org, sha]);
  return rows[0]?.report_id;
}
async function jiraRep(org: string, key: string): Promise<string | undefined> {
  const [rows] = await db.execute('SELECT report_id FROM jira_canonical WHERE org = ? AND issue_key = ?', [org, key]);
  return rows[0]?.report_id;
}
async function expectClean() {
  const res: any[] = await rb.checkCanonical();
  for (const r of res) {
    expect(r.commits.differ).toBe(0);
    expect(r.jira.differ).toBe(0);
  }
}

beforeAll(async () => {
  dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'glooker-upkeep-')), 'test.db');
  process.env.SQLITE_PATH = dbPath;
  process.env.DB_TYPE = 'sqlite';
  db = (await import('@/lib/db')).default;
  rb = await import('@/lib/canonical/rebuild');
  upkeep = await import('@/lib/canonical/upkeep');
  svc = await import('@/lib/report/service');
});

beforeEach(async () => {
  for (const t of ['commit_canonical', 'jira_canonical', 'canonical_builds', 'canonical_rebuild_lock', 'commit_analyses', 'jira_issues', 'reports']) {
    await db.execute(`DELETE FROM ${t}`);
  }
  await report('r1', 'acme'); await report('r2', 'acme'); await report('r3', 'acme');
  await report('f1', 'acme', 'failed'); await report('p1', 'acme', 'running');
  await commit('r1', 'dup', 4); await commit('r2', 'dup', 6); await commit('r3', 'dup', null);
  await commit('f1', 'dup', 9); await commit('p1', 'dup', 8);
  await commit('r1', 'a1', 2);
  await jira('r1', 'J-1', 'alice'); await jira('r2', 'J-1', 'bob'); await jira('r3', 'J-1', 'cy');
  await report('fresh1', 'fresh', 'running');
  await commit('fresh1', 's1', 1);
  await rb.rebuildCanonical();
});
afterAll(() => {
  try { fs.unlinkSync(dbPath); } catch {}
  if (priorSqlitePath === undefined) delete process.env.SQLITE_PATH;
  else process.env.SQLITE_PATH = priorSqlitePath;
  if (priorDbType === undefined) delete process.env.DB_TYPE;
  else process.env.DB_TYPE = priorDbType;
});

it('completing a report adds new keys and re-picks existing ones', async () => {
  await report('r4', 'acme', 'running');
  await commit('r4', 'new1', 3); await commit('r4', 'dup', 7);
  await upkeep.completeReport('r4', '{}');
  const [rows] = await db.execute(`SELECT status FROM reports WHERE id = 'r4'`);
  expect(rows[0].status).toBe('completed');
  expect(await pickRep('acme', 'new1')).toBe('r4');
  expect(await pickRep('acme', 'dup')).toBe('r4');
  await expectClean();
});

it('newer copy without complexity does not replace one with complexity', async () => {
  const before = await pickRep('acme', 'dup');
  expect(before).toBe('r2');
  await report('r5', 'acme', 'running');
  await commit('r5', 'dup', null);
  await upkeep.completeReport('r5', '{}');
  expect(await pickRep('acme', 'dup')).toBe('r2');
  await expectClean();
});

it('does not write canonical rows for an org that was never built', async () => {
  await upkeep.completeReport('fresh1', '{}');
  const [rows] = await db.execute(`SELECT * FROM commit_canonical WHERE org = 'fresh'`);
  expect(rows).toHaveLength(0);
  const [rep] = await db.execute(`SELECT status FROM reports WHERE id = 'fresh1'`);
  expect(rep[0].status).toBe('completed');
});

it('deleting a report re-points to a remaining copy', async () => {
  expect(await pickRep('acme', 'dup')).toBe('r2');
  expect(await jiraRep('acme', 'J-1')).toBe('r3');
  await svc.deleteReport('r2');
  expect(await pickRep('acme', 'dup')).toBe('r1');
  expect(await jiraRep('acme', 'J-1')).toBe('r3');
  await svc.deleteReport('r3');
  expect(await jiraRep('acme', 'J-1')).toBe('r1');
  await expectClean();
});

it('deleting the last completed copy removes the key', async () => {
  expect(await pickRep('acme', 'a1')).toBe('r1');
  await svc.deleteReport('r1');
  expect(await pickRep('acme', 'a1')).toBeUndefined();
  await expectClean();
});

it('failed or running reports never contribute', async () => {
  await svc.deleteReport('r1'); await svc.deleteReport('r2'); await svc.deleteReport('r3');
  expect(await pickRep('acme', 'dup')).toBeUndefined();
  const [rows] = await db.execute(`SELECT COUNT(*) AS n FROM commit_analyses WHERE commit_sha = 'dup'`);
  expect(Number(rows[0].n)).toBe(2);
  await expectClean();
});

it('deleteReport still throws ReportNotFoundError for an unknown id', async () => {
  await expect(svc.deleteReport('nope')).rejects.toBeInstanceOf(svc.ReportNotFoundError);
});

it('Check reads 0 differ after a sequence of completions and deletions', async () => {
  await report('r6', 'acme', 'running'); await commit('r6', 'x6', 2); await commit('r6', 'dup', 5);
  await jira('r6', 'J-1', 'dee'); await jira('r6', 'J-9', 'dee');
  await upkeep.completeReport('r6', '{}');
  await svc.deleteReport('r2');
  await report('r7', 'acme', 'running'); await commit('r7', 'a1', 9);
  await upkeep.completeReport('r7', '{}');
  await svc.deleteReport('r6');
  await expectClean();
});
