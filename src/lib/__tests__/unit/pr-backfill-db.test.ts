jest.mock('@octokit/rest', () => ({ Octokit: jest.fn().mockImplementation(() => ({})) }));
const mockFetchMergedPRs = jest.fn();
const mockCountReviewedPRs = jest.fn();
jest.mock('@/lib/github', () => ({
  getGitHubProvider: () => ({ fetchMergedPRs: mockFetchMergedPRs, countReviewedPRs: mockCountReviewedPRs }),
}));

import fs from 'fs';
import os from 'os';
import path from 'path';

let dbPath: string;
let db: any;
let backfill: typeof import('@/lib/pr-activity/backfill');
let store: typeof import('@/lib/pr-activity/store');
const priorSqlitePath = process.env.SQLITE_PATH;
const priorDbType = process.env.DB_TYPE;
const NOW = new Date('2026-10-27T12:00:00Z');

beforeAll(async () => {
  dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'glooker-bf-')), 'test.db');
  process.env.SQLITE_PATH = dbPath;
  process.env.DB_TYPE = 'sqlite';
  db = (await import('@/lib/db')).default;
  backfill = await import('@/lib/pr-activity/backfill');
  store = await import('@/lib/pr-activity/store');
  await db.execute(`INSERT INTO reports (id, org, period_days, status, created_at, completed_at) VALUES ('r1', 'acme', 14, 'completed', '2026-10-01T10:00:00Z', '2026-10-01T11:00:00Z')`);
  await db.execute(`INSERT INTO reports (id, org, period_days, status, created_at, completed_at) VALUES ('r0', 'acme', 14, 'completed', '2025-01-01T10:00:00Z', '2025-01-01T11:00:00Z')`);
  // After the period (window Oct 6–20) and not completed: neither's developers are in scope.
  await db.execute(`INSERT INTO reports (id, org, period_days, status, created_at, completed_at) VALUES ('r2', 'acme', 14, 'completed', '2026-10-20T10:00:00Z', '2026-10-20T11:00:00Z')`);
  await db.execute(`INSERT INTO reports (id, org, period_days, status, created_at, completed_at) VALUES ('rf', 'acme', 14, 'failed', '2026-09-20T10:00:00Z', '2026-09-20T11:00:00Z')`);
  await db.execute(`INSERT INTO developer_stats (report_id, github_login) VALUES ('r1', 'alice'), ('r1', 'bob'), ('r0', 'ancient'), ('r2', 'late'), ('rf', 'failedonly')`);
});
afterAll(() => {
  if (priorSqlitePath === undefined) delete process.env.SQLITE_PATH; else process.env.SQLITE_PATH = priorSqlitePath;
  if (priorDbType === undefined) delete process.env.DB_TYPE; else process.env.DB_TYPE = priorDbType;
  try { fs.rmSync(path.dirname(dbPath), { recursive: true, force: true }); } catch { /* gone */ }
});
beforeEach(() => {
  mockFetchMergedPRs.mockReset().mockResolvedValue({ prs: [{ number: 1, title: 't', repo: 'app', mergedAt: '2026-09-10T10:00:00Z' }] });
  mockCountReviewedPRs.mockReset().mockResolvedValue({ reviews: 0, prs: [], itemsComplete: true });
});

it('monthSlices: last N complete months, oldest first, until exclusive', () => {
  expect(backfill.monthSlices(3, NOW)).toEqual([
    { since: '2026-07-01', until: '2026-08-01' },
    { since: '2026-08-01', until: '2026-09-01' },
    { since: '2026-09-01', until: '2026-10-01' },
  ]);
  expect(backfill.monthSlices(1, new Date('2026-01-15T00:00:00Z'))).toEqual([{ since: '2025-12-01', until: '2026-01-01' }]);
});

it('searches each in-period login month by month with an inclusive bounded window', async () => {
  const res = await backfill.backfillPrs({ org: 'acme', months: 1, now: NOW });
  expect(res).toEqual({ done: 2, skipped: 0, failed: [] });
  const [org, login, since, , until] = mockFetchMergedPRs.mock.calls[0];
  expect([org, login, since.toISOString(), until.toISOString()]).toEqual(['acme', 'alice', '2026-09-01T00:00:00.000Z', '2026-09-30T00:00:00.000Z']);
  // 'ancient' ends before the period, 'late' starts after it, 'failedonly' is in a failed report.
  expect(mockFetchMergedPRs.mock.calls.map(c => c[1]).sort()).toEqual(['alice', 'bob']);
  expect(await store.hasPrCoverage('acme', 'alice', '2026-09-01', '2026-10-01')).toBe(true);
});

it('resumes: a slice already in coverage is skipped without searching', async () => {
  const res = await backfill.backfillPrs({ org: 'acme', months: 1, now: NOW });
  expect(res).toEqual({ done: 0, skipped: 2, failed: [] });
  expect(mockFetchMergedPRs).not.toHaveBeenCalled();
});

it('a failed or unproven slice writes no coverage and is listed; others continue', async () => {
  mockFetchMergedPRs.mockImplementation(async (_o: string, login: string) => {
    if (login === 'alice') throw new Error('rate limited');
    return { prs: [] };
  });
  mockCountReviewedPRs.mockResolvedValue({ reviews: 2, prs: [], itemsComplete: false });
  const res = await backfill.backfillPrs({ org: 'acme', months: 2, now: NOW });
  expect(res.failed.map(f => [f.login, f.since])).toEqual(expect.arrayContaining([['alice', '2026-08-01'], ['bob', '2026-08-01']]));
  expect(res.failed.find(f => f.login === 'alice')!.error).toMatch(/rate limited/);
  expect(await store.hasPrCoverage('acme', 'alice', '2026-08-01', '2026-09-01')).toBe(false);
  expect(await store.hasPrCoverage('acme', 'bob', '2026-08-01', '2026-09-01')).toBe(false);
  expect(res.skipped).toBe(2); // September slices from the earlier run
});

it('authored rows truncated at the search cap write no coverage', async () => {
  mockFetchMergedPRs.mockResolvedValue({ prs: [], itemsComplete: false });
  const res = await backfill.backfillPrs({ org: 'acme', months: 3, now: NOW });
  const jul = res.failed.filter(f => f.since === '2026-07-01');
  expect(jul.map(f => f.login).sort()).toEqual(['alice', 'bob']);
  expect(jul[0].error).toMatch(/truncated at the search cap/);
  expect(await store.hasPrCoverage('acme', 'alice', '2026-07-01', '2026-08-01')).toBe(false);
});
