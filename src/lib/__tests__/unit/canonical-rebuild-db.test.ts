jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));

import fs from 'fs';
import os from 'os';
import path from 'path';

let dbPath: string;
let db: any;
let rb: any;
let state: any;

// process.env is shared across test files in a worker; restore in afterAll.
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
  const [rows] = await db.execute('SELECT id FROM commit_analyses WHERE report_id = ? AND commit_sha = ?', [rep, sha]);
  return rows[0].id as number;
}
async function jira(rep: string, key: string, login: string) {
  await db.execute(
    `INSERT INTO jira_issues (report_id, github_login, project_key, issue_key) VALUES (?, ?, 'J', ?)`,
    [rep, login, key],
  );
}
const byOrg = async () => {
  const res: any[] = await rb.checkCanonical();
  return Object.fromEntries(res.map((r) => [r.org, r]));
};

beforeAll(async () => {
  dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'glooker-rebuild-')), 'test.db');
  process.env.SQLITE_PATH = dbPath;
  process.env.DB_TYPE = 'sqlite';
  db = (await import('@/lib/db')).default;
  rb = await import('@/lib/canonical/rebuild');
  state = await import('@/lib/canonical/state');

  await report('r1', 'acme'); await report('r2', 'acme'); await report('r3', 'acme');
  await report('f1', 'acme', 'failed');
  await report('b1', 'beta'); await report('b2', 'beta');
  await commit('r1', 'dup', 4); await commit('r2', 'dup', 6); await commit('r3', 'dup', null);
  await commit('f1', 'dup', 9); await commit('f1', 'fx', 3);
  await commit('r1', 'a1', 2); await commit('r2', 'a2', 3); await commit('r3', 'a3', 1);
  await commit('b1', 'b-1', 2); await commit('b2', 'b-1', 5); await commit('b2', 'b-2', 1);
  await jira('r1', 'J-1', 'alice'); await jira('r2', 'J-1', 'bob'); await jira('r2', 'J-2', 'bob');
  await jira('b1', 'B-1', 'zed');
});
afterAll(() => {
  if (priorSqlitePath === undefined) delete process.env.SQLITE_PATH;
  else process.env.SQLITE_PATH = priorSqlitePath;
  if (priorDbType === undefined) delete process.env.DB_TYPE;
  else process.env.DB_TYPE = priorDbType;
  try { fs.unlinkSync(dbPath); } catch {}
});
afterEach(async () => {
  await db.execute('DELETE FROM canonical_rebuild_lock');
});

it('check reports not built and full differ before the first rebuild', async () => {
  const c = await byOrg();
  expect(c.acme.builtAt).toBeNull();
  expect(c.acme.commits.stored).toBe(0);
  expect(c.acme.commits.expected).toBe(4); // dup, a1, a2, a3
  expect(c.acme.commits.differ).toBe(4);
  expect(c.acme.jira.expected).toBe(2);
});

it('rebuild fills both tables and records the build', async () => {
  const res = await rb.rebuildCanonical();
  expect(res.every((r: any) => r.ok)).toBe(true);
  const c = await byOrg();
  for (const o of Object.values(c) as any[]) {
    expect(o.commits.differ).toBe(0);
    expect(o.jira.differ).toBe(0);
  }
  expect((await state.getCanonicalBuild('acme')).commitRows).toBe(c.acme.commits.expected);
});

it('rebuild restores a corrupted table', async () => {
  await rb.rebuildCanonical();
  await db.execute(`DELETE FROM commit_canonical WHERE org = 'acme' AND commit_sha = 'a1'`);
  await db.execute(
    `INSERT INTO commit_canonical (org, commit_sha, analysis_id, report_id, github_login, repo)
     VALUES ('acme', 'fx', 1, 'f1', 'u', 'bogus')`);
  const [r1] = await db.execute(`SELECT id FROM commit_analyses WHERE report_id = 'r1' AND commit_sha = 'dup'`);
  await db.execute(`UPDATE commit_canonical SET analysis_id = ? WHERE org = 'acme' AND commit_sha = 'dup'`, [r1[0].id]);
  const c = await byOrg();
  expect(c.acme.commits.differ).toBe(3);
  expect(c.acme.commits.examples).toEqual(expect.arrayContaining(['a1', 'fx', 'dup']));
  await rb.rebuildCanonical();
  expect((await byOrg()).acme.commits.differ).toBe(0);
});

it('a rebuild that fails part-way leaves the previous table intact', async () => {
  await rb.rebuildCanonical();
  const [before] = await db.execute('SELECT * FROM commit_canonical ORDER BY org, commit_sha');
  const buildBefore = await state.getCanonicalBuild('acme');
  const res = await rb.rebuildCanonical({
    onBatch: (org: string, t: string) => { if (org === 'acme' && t === 'jira') throw new Error('boom'); },
  });
  const r = Object.fromEntries(res.map((x: any) => [x.org, x]));
  expect(r.acme).toMatchObject({ ok: false, error: 'boom' });
  expect(r.beta.ok).toBe(true);
  const [after] = await db.execute('SELECT * FROM commit_canonical ORDER BY org, commit_sha');
  expect(after.filter((x: any) => x.org === 'acme')).toEqual(before.filter((x: any) => x.org === 'acme'));
  expect(await state.getCanonicalBuild('acme')).toEqual(buildBefore);
});

it('concurrent rebuilds are refused', async () => {
  await expect(rb.acquireRebuildLock('a')).resolves.toBeDefined();
  const err = await rb.acquireRebuildLock('b').catch((e: any) => e);
  expect(err).toBeInstanceOf(rb.RebuildRunningError);
  expect(err.message).toBe('rebuild already running');
  expect(await rb.getRebuildLock()).toMatchObject({ holder: 'a' });
  await rb.releaseRebuildLock('a');
  await expect(rb.acquireRebuildLock('b')).resolves.toBeDefined();
});

it('a lock with no heartbeat for 30 minutes is broken', async () => {
  const old = new Date(Date.now() - 31 * 60_000).toISOString();
  await db.execute('INSERT INTO canonical_rebuild_lock (id, started_at, holder) VALUES (1, ?, ?)', [old, 'dead']);
  await expect(rb.acquireRebuildLock('c')).resolves.toBeDefined();
  expect(await rb.getRebuildLock()).toMatchObject({ holder: 'c' });
});

it('a lock with a recent heartbeat is not broken', async () => {
  const recent = new Date(Date.now() - 20 * 60_000).toISOString();
  await db.execute('INSERT INTO canonical_rebuild_lock (id, started_at, holder) VALUES (1, ?, ?)', [recent, 'alive']);
  await expect(rb.acquireRebuildLock('d')).rejects.toBeInstanceOf(rb.RebuildRunningError);
  await rb.releaseRebuildLock('alive');
});

it('a report completed during a rebuild is applied after the swap', async () => {
  const snap = await rb.acquireRebuildLock('h');
  await report('r9', 'acme');
  await commit('r9', 'late', 2);
  const r9dup = await commit('r9', 'dup', 7);
  await rb.runRebuild('h', snap);
  const [rows] = await db.execute(`SELECT commit_sha, analysis_id FROM commit_canonical WHERE org = 'acme'`);
  const m = Object.fromEntries(rows.map((x: any) => [x.commit_sha, x.analysis_id]));
  expect(m.late).toBeDefined();
  expect(m.dup).toBe(r9dup);
  expect(await rb.getRebuildLock()).toBeNull();
});

it('rebuild re-runs an org whose snapshot report was deleted mid-rebuild', async () => {
  const snap = await rb.acquireRebuildLock('h');
  // Delete r2 after acme has been swapped, so the first pass still included it.
  await rb.runRebuild('h', snap, {
    onProgress: async (org: string) => {
      if (org === 'acme') await db.execute(`DELETE FROM reports WHERE id = 'r2'`);
    },
  });
  expect((await byOrg()).acme.commits.differ).toBe(0);
  const [gone] = await db.execute(`SELECT commit_sha FROM commit_canonical WHERE org = 'acme' AND commit_sha = 'a2'`);
  expect(gone).toHaveLength(0);
  const [goneJ] = await db.execute(`SELECT issue_key FROM jira_canonical WHERE org = 'acme' AND issue_key = 'J-2'`);
  expect(goneJ).toHaveLength(0);
  expect((await byOrg()).acme.jira.differ).toBe(0);
});

it('rebuild clears an org that has a build row but no completed reports', async () => {
  await rb.rebuildCanonical();
  await db.execute(`DELETE FROM reports WHERE org = 'beta'`);
  await rb.rebuildCanonical();
  const [rows] = await db.execute(`SELECT COUNT(*) AS c FROM commit_canonical WHERE org = 'beta'`);
  expect(Number(rows[0].c)).toBe(0);
  expect((await state.getCanonicalBuild('beta')).commitRows).toBe(0);
});
