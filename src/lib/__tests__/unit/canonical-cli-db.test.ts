jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));

import fs from 'fs';
import os from 'os';
import path from 'path';

let dbPath: string;
let db: any;
let cli: any;

// process.env is shared across test files in a worker; restore in afterAll.
const priorSqlitePath = process.env.SQLITE_PATH;
const priorDbType = process.env.DB_TYPE;

const TABLES = ['commit_canonical', 'jira_canonical', 'canonical_builds', 'canonical_rebuild_lock'];

async function counts() {
  const out: Record<string, number> = {};
  for (const t of TABLES) {
    const [rows] = await db.execute(`SELECT COUNT(*) AS n FROM ${t}`);
    out[t] = Number(rows[0].n);
  }
  return out;
}
async function run(argv: string[]) {
  const lines: string[] = [];
  const code: number = await cli.runCanonicalCli(argv, (l: string) => lines.push(l));
  return { code, lines };
}

beforeAll(async () => {
  dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'glooker-cli-')), 'test.db');
  process.env.SQLITE_PATH = dbPath;
  process.env.DB_TYPE = 'sqlite';
  db = (await import('@/lib/db')).default;
  cli = await import('@/lib/canonical/cli');

  await db.execute(`INSERT INTO reports (id, org, period_days, status) VALUES ('r1', 'acme', 14, 'completed')`);
  await db.execute(
    `INSERT INTO commit_analyses (report_id, github_login, repo, commit_sha, complexity, committed_at)
     VALUES ('r1', 'u', 'repo', 'a1', 2, '2026-10-01 00:00:00')`,
  );
  await db.execute(`INSERT INTO jira_issues (report_id, github_login, project_key, issue_key) VALUES ('r1', 'alice', 'J', 'J-1')`);
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

it('--check reports not built and exits 1 before the first build', async () => {
  const { code, lines } = await run(['--check']);
  expect(code).toBe(1);
  expect(lines[0]).toBe('acme: not built');
  expect(lines[1]).toBe('  commits stored=0 expected=1 differ=1');
  expect(lines[2]).toMatch(/^    e\.g\. /);
  expect(lines).toContain('  jira    stored=0 expected=1 differ=1');
});

it('--check writes nothing', async () => {
  const before = await counts();
  await run(['--check']);
  expect(await counts()).toEqual(before);
});

it('rebuild prints ok per org and exits 0, then --check exits 0', async () => {
  const { code, lines } = await run([]);
  expect(code).toBe(0);
  expect(lines[0]).toMatch(/^acme: ok \(1 commits, 1 issues, \d+ms\)$/);
  const check = await run(['--check']);
  expect(check.code).toBe(0);
  expect(check.lines[0]).toMatch(/^acme: \d{4}-/);
  expect(check.lines).toContain('  commits stored=1 expected=1 differ=0');
  expect(check.lines).toContain('  jira    stored=1 expected=1 differ=0');
});

it('exits 3 with rebuild already running when the lock is held', async () => {
  await db.execute(
    `INSERT INTO canonical_rebuild_lock (id, started_at, holder) VALUES (1, ?, 'other')`,
    [new Date().toISOString()],
  );
  const { code, lines } = await run([]);
  expect(code).toBe(3);
  expect(lines.join('\n')).toContain('rebuild already running');
});
