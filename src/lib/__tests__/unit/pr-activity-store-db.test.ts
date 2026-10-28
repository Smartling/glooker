// GLOOK-63: pr_activity / pr_activity_coverage through the REAL SQLite driver (translateSQL included).
jest.mock('@octokit/rest', () => ({ Octokit: jest.fn().mockImplementation(() => ({})) }));

import fs from 'fs';
import os from 'os';
import path from 'path';

let dbPath: string;
let db: any;
let store: typeof import('@/lib/pr-activity/store');
const priorSqlitePath = process.env.SQLITE_PATH;
const priorDbType = process.env.DB_TYPE;

beforeAll(async () => {
  dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'glooker-pra-')), 'test.db');
  process.env.SQLITE_PATH = dbPath;
  process.env.DB_TYPE = 'sqlite';
  db = (await import('@/lib/db')).default;
  store = await import('@/lib/pr-activity/store');
});
afterAll(() => {
  if (priorSqlitePath === undefined) delete process.env.SQLITE_PATH; else process.env.SQLITE_PATH = priorSqlitePath;
  if (priorDbType === undefined) delete process.env.DB_TYPE; else process.env.DB_TYPE = priorDbType;
  try { fs.rmSync(path.dirname(dbPath), { recursive: true, force: true }); } catch { /* gone */ }
});

const PR = { number: 7, title: 'x', repo: 'app', mergedAt: '2026-09-20T10:00:00Z' };

it('upserts one row per (org, login, kind, repo, pr_number), however often it is written', async () => {
  for (let i = 0; i < 3; i++) await store.upsertPrActivity('acme', 'alice', 'authored', [PR]);
  await store.upsertPrActivity('acme', 'alice', 'reviewed', [PR]);
  const [rows] = await db.execute(`SELECT kind, merged_at FROM pr_activity WHERE org = 'acme' ORDER BY kind`);
  expect(rows).toEqual([
    { kind: 'authored', merged_at: '2026-09-20T10:00:00.000Z' },
    { kind: 'reviewed', merged_at: '2026-09-20T10:00:00.000Z' },
  ]);
});

it('skips PRs with no repo or no merge time instead of writing junk rows', async () => {
  const n = await store.upsertPrActivity('acme', 'bob', 'authored', [
    { ...PR, repo: '' }, { ...PR, number: 8, mergedAt: '' }, { ...PR, number: 9 },
  ]);
  expect(n).toBe(1);
});

it('writes large sets in multi-row batches, updating merged_at on re-write and de-duplicating within a batch', async () => {
  const many = Array.from({ length: store.PR_ACTIVITY_BATCH * 2 + 7 }, (_, i) => ({ ...PR, number: 1000 + i }));
  const spy = jest.spyOn(db, 'transaction');
  expect(await store.upsertPrActivity('acme', 'carol', 'reviewed', [...many, many[0]])).toBe(many.length + 1);
  expect(spy).toHaveBeenCalledTimes(1);
  spy.mockRestore();
  const later = many.map(p => ({ ...p, mergedAt: '2026-09-21T10:00:00Z' }));
  await store.upsertPrActivity('acme', 'carol', 'reviewed', later);
  const [rows] = await db.execute(
    `SELECT COUNT(*) AS n, MIN(merged_at) AS lo FROM pr_activity WHERE org = 'acme' AND github_login = 'carol'`);
  expect(Number(rows[0].n)).toBe(many.length);
  expect(rows[0].lo).toBe('2026-09-21T10:00:00.000Z');
});

it('an empty set writes nothing and opens no transaction', async () => {
  const spy = jest.spyOn(db, 'transaction');
  expect(await store.upsertPrActivity('acme', 'dave', 'authored', [])).toBe(0);
  expect(spy).not.toHaveBeenCalled();
  spy.mockRestore();
});

it('records coverage idempotently and reports it back', async () => {
  await store.recordPrCoverage('acme', 'alice', '2026-09-01', '2026-10-01', 'backfill');
  await store.recordPrCoverage('acme', 'alice', '2026-09-01', '2026-10-01', 'backfill');
  const [rows] = await db.execute(`SELECT COUNT(*) AS n FROM pr_activity_coverage`);
  expect(Number(rows[0].n)).toBe(1);
  expect(await store.hasPrCoverage('acme', 'alice', '2026-09-01', '2026-10-01')).toBe(true);
  expect(await store.hasPrCoverage('acme', 'alice', '2026-08-01', '2026-09-01')).toBe(false);
});

describe('reportCoverageSlice', () => {
  it('trims to whole searched days: day after since, up to (excluding) the run-start day', () => {
    expect(store.reportCoverageSlice(new Date('2026-10-13T09:30:00Z'), new Date('2026-10-27T09:30:00Z')))
      .toEqual({ sinceDate: '2026-10-14', untilDate: '2026-10-27' });
  });
  it('returns null when no whole day was searched', () => {
    expect(store.reportCoverageSlice(new Date('2026-10-26T09:00:00Z'), new Date('2026-10-27T01:00:00Z'))).toBeNull();
  });
});
