/**
 * GLOOK-41 regression: the org report's spend-window query uses
 * `DATE_ADD(?, INTERVAL 1 DAY)` (src/lib/report/org.ts). translateSQL had rules
 * for DATE_SUB but none for DATE_ADD, so the statement reached better-sqlite3
 * verbatim and failed with `near "1": syntax error`.
 *
 * Two layers on purpose:
 *  - translateSQL is pure, so the rewrite itself is asserted directly. That is
 *    where sign, magnitude and quoting live, and it needs no driver.
 *  - one case drives the REAL SQLite driver, because the value of this fix is
 *    that better-sqlite3 accepts the output. The mocked suites around
 *    getOrgReport stayed green through this bug precisely because none of them
 *    reach translateSQL.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { translateSQL } from '@/lib/db/sqlite';

describe('translateSQL — MySQL date expressions', () => {
  it('rewrites the org spend-window DATE_ADD, keeping the bound parameter', () => {
    expect(
      translateSQL('SELECT 1 WHERE committed_at < DATE_ADD(?, INTERVAL 1 DAY)'),
    ).toBe("SELECT 1 WHERE committed_at < datetime(?, '+1 days')");
  });

  it('adds days rather than subtracting them', () => {
    // The rule was written by copying the DATE_SUB block; flipping '+' to '-'
    // is the slip that copying invites, and a shape-only assertion would miss it.
    expect(translateSQL('SELECT DATE_ADD(?, INTERVAL 7 DAY)')).toContain("'+7 days'");
    expect(translateSQL('SELECT DATE_SUB(?, INTERVAL 7 DAY)')).toContain("'-7 days'");
  });

  it('keeps DATE_SUB(NOW(), …) on localtime so it agrees with NOW()', () => {
    // Without 'localtime' the two disagree by the host's UTC offset, silently
    // shifting every 90-day window in projects/untracked.ts, epic-stats.ts and
    // epic-summary.ts on any non-UTC host.
    const out = translateSQL('SELECT NOW() AS a, DATE_SUB(NOW(), INTERVAL 90 DAY) AS b');
    expect(out).toContain("datetime('now','localtime') AS a");
    expect(out).toContain("datetime('now', 'localtime', '-90 days') AS b");
  });

  it('leaves a MySQL date expression inside a string literal byte-identical', () => {
    // Anchoring the pattern to `?`/identifier is NOT sufficient on its own:
    // 'DATE_ADD(a , INTERVAL 9 DAY)' still matches an identifier capture, and the
    // replacement injects quotes, which would terminate the literal and
    // restructure the statement. The rewrites run per non-literal chunk instead.
    const sql = "SELECT 1 WHERE msg = 'DATE_ADD(a , INTERVAL 9 DAY)'";
    expect(translateSQL(sql)).toBe(sql);
  });

  it('handles a doubled quote inside a literal', () => {
    const sql = "SELECT 1 WHERE note = 'it''s a DATE_SUB(x , INTERVAL 3 DAY) note'";
    expect(translateSQL(sql)).toBe(sql);
  });

  it('rewrites a real expression while leaving a literal beside it untouched', () => {
    expect(
      translateSQL("SELECT 1 WHERE msg='DATE_ADD(q , INTERVAL 5 DAY)' AND t < DATE_ADD(?, INTERVAL 1 DAY)"),
    ).toBe("SELECT 1 WHERE msg='DATE_ADD(q , INTERVAL 5 DAY)' AND t < datetime(?, '+1 days')");
  });

  it('does not let SQL-looking text stored as data trip the guard', () => {
    // commit_analyses stores commit messages; a message mentioning INTERVAL must
    // not turn a working query into a thrown error.
    const sql = "INSERT INTO commit_analyses (message) VALUES ('perf: use INTERVAL 7 DAY window')";
    expect(() => translateSQL(sql)).not.toThrow();
  });

  it('throws instead of passing an untranslated form to the driver', () => {
    // Passthrough was the root cause of GLOOK-41: unmatched SQL reached the
    // driver and 500d at request time. These shapes have no rule; each must fail
    // loudly and greppably rather than at a user's request.
    for (const sql of [
      'SELECT DATE_ADD(?, INTERVAL 1 MONTH)',
      'SELECT DATE_ADD(?, INTERVAL ? DAY)',
      'SELECT DATE_ADD(DATE(x), INTERVAL 1 DAY)',
      'SELECT DATE_SUB(?, INTERVAL 2 HOUR)',
    ]) {
      expect(() => translateSQL(sql)).toThrow(/untranslated MySQL date expression/);
    }
  });
});

describe('SQLite driver accepts the translated spend-window clause', () => {
  const prevSqlitePath = process.env.SQLITE_PATH;
  const prevDbType = process.env.DB_TYPE;
  let tmpDir: string;
  let db: { execute: <T = any>(sql: string, params?: any[]) => Promise<[T[], any]> };

  beforeAll(async () => {
    // mkdtempSync, not a guessable path in the shared temp dir — matches
    // cc-apply-breakdowns.test.ts, prompt-loader.test.ts and logger.test.ts.
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'glooker-glook41-'));
    process.env.SQLITE_PATH = path.join(tmpDir, 'test.db');
    process.env.DB_TYPE = 'sqlite';
    const { createSQLiteDB } = await import('@/lib/db/sqlite');
    // One handle for the whole suite: each createSQLiteDB() re-runs the schema
    // and every ALTER migration.
    db = createSQLiteDB();
  });

  afterAll(() => {
    // Restore, or later files in this Jest worker inherit a deleted DB path.
    if (prevSqlitePath === undefined) delete process.env.SQLITE_PATH;
    else process.env.SQLITE_PATH = prevSqlitePath;
    if (prevDbType === undefined) delete process.env.DB_TYPE;
    else process.env.DB_TYPE = prevDbType;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* already gone */ }
  });

  it('lands the boundary on exact midnight of the following day', async () => {
    const [rows] = await db.execute(
      `SELECT DATE_ADD(?, INTERVAL 1 DAY) AS boundary`,
      ['2026-03-18'],
    ) as [any[], any];
    // Pinned exactly: a time component here would be a real MySQL/SQLite difference.
    expect(String(rows[0].boundary)).toBe('2026-03-19 00:00:00');
  });

  it('keeps the spend window exclusive at the end date', async () => {
    // Inputs use the format actually stored in commit_analyses — GitHub's
    // ISO-8601 `…T…Z` (src/lib/github.ts → src/lib/report-runner.ts), compared
    // as TEXT against datetime()'s space-separated output.
    const inWindow = async (committedAt: string) => {
      const [rows] = await db.execute(
        `SELECT 1 AS hit WHERE ? < DATE_ADD(?, INTERVAL 1 DAY)`,
        [committedAt, '2026-03-31'],
      ) as [any[], any];
      return rows.length === 1;
    };
    expect(await inWindow('2026-03-31T23:59:59Z')).toBe(true);
    expect(await inWindow('2026-04-01T00:00:00Z')).toBe(false);
  });
});
