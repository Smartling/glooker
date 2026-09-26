// GLOOK-58 Decision 15: coveredWeeks and anchorWeek through the REAL SQLite driver, so the status
// filter, the per-login EXISTS and the timestamp parsing run against real rows, not positional
// mocks. Env set/restore copied from cc-apply-breakdowns.test.ts. Timestamps are inserted as
// absolute instants (…Z), so the expected keys hold on any host zone, CI's UTC included; the
// zone-less SQLite form is pinned in report-coverage.test.ts.
jest.mock('@octokit/rest', () => ({ Octokit: jest.fn().mockImplementation(() => ({})) }));
// org.ts / dev.ts → ./service → @/lib/report-runner pulls in the ESM-only p-limit package.
jest.mock('@/lib/report-runner', () => ({ runReport: jest.fn().mockResolvedValue(undefined), requestStop: jest.fn() }));
jest.mock('@/lib/progress-store', () => ({ initProgress: jest.fn(), updateProgress: jest.fn(), getProgress: jest.fn() }));

import fs from 'fs';
import os from 'os';
import path from 'path';

let dbPath: string;
let db: any;
let getOrgReport: any;
let getDevReport: any;

// process.env is shared across test files in a Jest worker: restore both in afterAll, or later
// files inherit a deleted DB path (CLAUDE.md).
const priorSqlitePath = process.env.SQLITE_PATH;
const priorDbType = process.env.DB_TYPE;

// id, org, period_days, status, created_at, completed_at — and what each window WOULD cover.
// GLOOK-58 Decision 15, corrected after the Task 12 review: the window is
// [completed_at - period_days, created_at], not [completed_at - period_days, completed_at]. A
// "quick" report (created_at == completed_at, an idealized zero-duration run) reproduces the old
// single-edge window exactly, which is why most fixtures below set them equal.
const REPORTS: Array<[string, string, number, string, string, string | null]> = [
  // Quick run: created_at == completed_at, so its window is [2026-03-04T12:00, 2026-03-18T12:00],
  // identical to the pre-fix single-edge window. Week of Mar 9.
  ['rA', 'acme', 14, 'completed', '2026-03-18T12:00:00Z', '2026-03-18T12:00:00Z'],
  // Resumed far later: created in January, completed in April. start = completed_at - 14d =
  // 2026-03-23, which is AFTER end = created_at = 2026-01-05. The window is inverted (empty), so
  // this report contributes NO coverage at all — neither the week near completed_at nor the week
  // near created_at.
  ['rB', 'acme', 14, 'completed', '2026-01-05T09:00:00Z', '2026-04-06T00:00:00Z'],
  ['rFailed', 'acme', 30, 'failed', '2026-01-31T00:00:00Z', '2026-03-02T00:00:00Z'], // would be Feb 2-23
  ['rStopped', 'acme', 14, 'stopped', '2026-01-05T00:00:00Z', '2026-01-19T00:00:00Z'], // would be Jan 5, 12
  // Resumed and running again: its old completed_at is still set. Would be Apr 20, Apr 27.
  ['rRunning', 'acme', 14, 'running', '2026-04-15T12:00:00Z', '2026-05-04T00:00:00Z'],
  ['rPending', 'acme', 14, 'pending', '2026-05-13T12:00:00Z', null],
  // Other org, quick run: other org: May 18, 25.
  ['rOther', 'beta', 14, 'completed', '2026-06-01T00:00:00Z', '2026-06-01T00:00:00Z'],
  // acme-adjoin: two quick, back-to-back completed reports whose windows meet at 2026-07-11T12:00Z.
  // Alone they cover Jun 29 and Jul 13; only their UNION holds Jul 11 whole, so only the union
  // lists Jul 6.
  ['rAdj1', 'acme-adjoin', 14, 'completed', '2026-07-11T12:00:00Z', '2026-07-11T12:00:00Z'],
  ['rAdj2', 'acme-adjoin', 14, 'completed', '2026-07-25T12:00:00Z', '2026-07-25T12:00:00Z'],
  // gamma: no completed report at all.
  ['rGammaFailed', 'gamma', 14, 'failed', '2026-02-01T00:00:00Z', '2026-02-20T00:00:00Z'],
];
// alice: rA (completed), rFailed (failed), rPending (pending). bob: rA and rB (both completed).
// carol: only rFailed, so no completed report holds her row.
const DEV_ROWS: Array<[string, string]> = [
  ['rA', 'alice'], ['rA', 'bob'], ['rB', 'bob'], ['rFailed', 'alice'], ['rPending', 'alice'], ['rFailed', 'carol'],
];

beforeAll(async () => {
  dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'glooker-coverage-')), 'test.db');
  process.env.SQLITE_PATH = dbPath;
  process.env.DB_TYPE = 'sqlite';
  db = (await import('@/lib/db')).default;
  ({ getOrgReport } = await import('@/lib/report/org'));
  ({ getDevReport } = await import('@/lib/report/dev'));
  for (const r of REPORTS) {
    await db.execute(
      `INSERT INTO reports (id, org, period_days, status, created_at, completed_at) VALUES (?, ?, ?, ?, ?, ?)`,
      r,
    );
  }
  for (const [reportId, login] of DEV_ROWS) {
    await db.execute(
      `INSERT INTO developer_stats (report_id, github_login, github_name) VALUES (?, ?, ?)`,
      [reportId, login, login],
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

describe('getOrgReport coverage', () => {
  it("lists exactly the fully covered weeks of this org's completed reports", async () => {
    // Only rA contributes: rB's window is empty (see below), so its week doesn't appear.
    expect((await getOrgReport('rA')).coveredWeeks).toEqual(['2026-03-09']);
  });

  it("leaves the week right after rA's own window out, even though nothing else is between", async () => {
    // Mar 16 directly follows rA's window (which ends 2026-03-18T12:00Z, partway through Mar 18),
    // but Mar 16-17 alone isn't a whole week, so it's excluded on its own account, not because a
    // second report used to sit past it.
    expect((await getOrgReport('rA')).coveredWeeks).not.toContain('2026-03-16');
  });

  it('failed, stopped, running and pending reports add nothing, even when they carry a completed_at', async () => {
    const { coveredWeeks } = await getOrgReport('rA');
    const fromIgnored = ['2026-01-05', '2026-01-12', '2026-02-02', '2026-02-09', '2026-02-16', '2026-02-23', '2026-04-20', '2026-04-27'];
    expect(coveredWeeks.filter((w: string) => fromIgnored.includes(w))).toEqual([]);
  });

  it('a report resumed long after it was created contributes no coverage at all', async () => {
    // rB: created 2026-01-05, completed 2026-04-06. start (completed_at - 14d) = 2026-03-23, which
    // is AFTER end (created_at) = 2026-01-05: the window is inverted, so it contributes nothing —
    // not the week near its completed_at, and not the week near its created_at either.
    const { coveredWeeks } = await getOrgReport('rA');
    const nearRB = ['2025-12-29', '2026-01-05', '2026-01-12', '2026-03-23', '2026-03-30'];
    expect(coveredWeeks.filter((w: string) => nearRB.includes(w))).toEqual([]);
  });

  it('two completed reports whose windows meet mid-day leave no hole, through the real service', async () => {
    const { coveredWeeks } = await getOrgReport('rAdj1');
    expect(coveredWeeks).toContain('2026-07-06'); // the week holding the shared day, Jul 11
    expect(coveredWeeks).toEqual(['2026-06-29', '2026-07-06', '2026-07-13']);
  });

  it('an org with no completed reports has no covered weeks', async () => {
    expect((await getOrgReport('rGammaFailed')).coveredWeeks).toEqual([]);
  });

  it("another org's reports add nothing", async () => {
    const { coveredWeeks } = await getOrgReport('rA');
    expect(coveredWeeks.filter((w: string) => ['2026-05-18', '2026-05-25'].includes(w))).toEqual([]);
  });

  it("anchorWeek is a completed report's completed_at week", async () => {
    expect((await getOrgReport('rA')).anchorWeek).toBe('2026-03-16');
  });

  it("anchorWeek is created_at's week for every other status, even with a completed_at set", async () => {
    expect((await getOrgReport('rPending')).anchorWeek).toBe('2026-05-11'); // completed_at null
    expect((await getOrgReport('rRunning')).anchorWeek).toBe('2026-04-13'); // resumed; stale completed_at 2026-05-04
    expect((await getOrgReport('rFailed')).anchorWeek).toBe('2026-01-26'); // failed runs set completed_at 2026-03-02
  });
});

describe('getDevReport coverage', () => {
  it('counts only completed reports that hold a developer_stats row for this login', async () => {
    // alice's failed and pending reports add nothing; bob's rB is not hers.
    expect((await getDevReport('rA', 'alice')).coveredWeeks).toEqual(['2026-03-09']);
  });

  it("a login's row in a report resumed far later adds no extra weeks, even though bob has a row there too", async () => {
    // bob has developer_stats rows in both rA (quick, contributes the week of Mar 9) and rB
    // (resumed far later, empty window, contributes nothing). The result is rA's week alone.
    expect((await getDevReport('rA', 'bob')).coveredWeeks).toEqual(['2026-03-09']);
  });

  it('a login with no developer_stats row in any completed report has no covered weeks', async () => {
    expect((await getDevReport('rFailed', 'carol')).coveredWeeks).toEqual([]);
  });

  it("anchorWeek follows the viewed report's status: completed_at if completed, created_at otherwise", async () => {
    expect((await getDevReport('rA', 'alice')).anchorWeek).toBe('2026-03-16');
    expect((await getDevReport('rPending', 'alice')).anchorWeek).toBe('2026-05-11');
    expect((await getDevReport('rFailed', 'alice')).anchorWeek).toBe('2026-01-26');
  });
});
