jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));

import fs from 'fs';
import os from 'os';
import path from 'path';

let dbPath: string;
let db: any;
let state: any;

// process.env is shared across test files in a worker; restore in afterAll.
const priorSqlitePath = process.env.SQLITE_PATH;
const priorDbType = process.env.DB_TYPE;

beforeAll(async () => {
  dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'glooker-canon-')), 'test.db');
  process.env.SQLITE_PATH = dbPath;
  process.env.DB_TYPE = 'sqlite';
  db = (await import('@/lib/db')).default;
  state = await import('@/lib/canonical/state');
});
afterAll(() => {
  if (priorSqlitePath === undefined) delete process.env.SQLITE_PATH;
  else process.env.SQLITE_PATH = priorSqlitePath;
  if (priorDbType === undefined) delete process.env.DB_TYPE;
  else process.env.DB_TYPE = priorDbType;
  try { fs.unlinkSync(dbPath); } catch {}
});

const TABLES = ['commit_canonical', 'jira_canonical', 'canonical_builds', 'canonical_rebuild_lock'];

it('creates the four canonical tables', async () => {
  const [rows] = await db.execute(`SELECT name FROM sqlite_master WHERE type='table'`);
  const names = rows.map((r: any) => r.name);
  for (const t of TABLES) expect(names).toContain(t);
});

it('reports an org as not built until a build row exists', async () => {
  expect(await state.isCanonicalBuilt('acme')).toBe(false);
  expect(await state.getCanonicalBuild('acme')).toBeNull();
  const b = { org: 'acme', builtAt: '2026-11-06T10:00:00.000Z', durationMs: 1200, commitRows: 3, jiraRows: 1 };
  await db.transaction((tx: any) => state.recordCanonicalBuild(tx, b));
  expect(await state.isCanonicalBuilt('acme')).toBe(true);
  expect(await state.getCanonicalBuild('acme')).toEqual(b);
});

it('recordCanonicalBuild replaces the previous row', async () => {
  const base = { org: 'beta', builtAt: '2026-11-06T10:00:00.000Z', commitRows: 1, jiraRows: 1 };
  await db.transaction((tx: any) => state.recordCanonicalBuild(tx, { ...base, durationMs: 100 }));
  await db.transaction((tx: any) => state.recordCanonicalBuild(tx, { ...base, durationMs: 200 }));
  const all = (await state.listCanonicalBuilds()).filter((b: any) => b.org === 'beta');
  expect(all).toHaveLength(1);
  expect(all[0].durationMs).toBe(200);
});

it('declares the new tables in schema.sql and mysql.ts', () => {
  for (const f of ['schema.sql', 'src/lib/db/mysql.ts']) {
    const src = fs.readFileSync(path.join(process.cwd(), f), 'utf8');
    for (const t of TABLES) expect(src).toContain(`CREATE TABLE IF NOT EXISTS ${t}`);
  }
});
