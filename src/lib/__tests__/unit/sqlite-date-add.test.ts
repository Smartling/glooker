/**
 * GLOOK-41 regression: the org report's spend-window query uses
 * `DATE_ADD(?, INTERVAL 1 DAY)` (src/lib/report/org.ts). translateSQL had
 * rules for DATE_SUB but none for DATE_ADD, so the statement reached
 * better-sqlite3 verbatim and failed with `near "1": syntax error`.
 *
 * These tests deliberately drive the REAL SQLite driver rather than a mock.
 * The mocked suites around getOrgReport stayed green through this bug
 * precisely because they never exercised translateSQL.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

describe('SQLite dialect translation — DATE_ADD', () => {
  const prevSqlitePath = process.env.SQLITE_PATH;
  const prevDbType = process.env.DB_TYPE;
  let dbPath: string;

  beforeAll(() => {
    dbPath = path.join(os.tmpdir(), `glooker-glook41-${process.pid}-${Date.now()}.db`);
    process.env.SQLITE_PATH = dbPath;
    process.env.DB_TYPE = 'sqlite';
  });

  afterAll(() => {
    // Restore, or later files in this worker inherit a deleted DB path.
    if (prevSqlitePath === undefined) delete process.env.SQLITE_PATH;
    else process.env.SQLITE_PATH = prevSqlitePath;
    if (prevDbType === undefined) delete process.env.DB_TYPE;
    else process.env.DB_TYPE = prevDbType;
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(`${dbPath}${suffix}`); } catch { /* already gone */ }
    }
  });

  async function makeDb() {
    const { createSQLiteDB } = await import('@/lib/db/sqlite');
    return createSQLiteDB();
  }

  it('translates DATE_ADD(?, INTERVAL 1 DAY) instead of failing to parse', async () => {
    const db = await makeDb();
    const [rows] = await db.execute(
      `SELECT DATE_ADD(?, INTERVAL 1 DAY) AS boundary`,
      ['2026-03-18'],
    ) as [any[], any];
    expect(String(rows[0].boundary)).toMatch(/^2026-03-19/);
  });

  it('keeps the bound parameter a parameter rather than interpolating it', async () => {
    const db = await makeDb();
    const [rows] = await db.execute(
      `SELECT DATE_ADD(?, INTERVAL 1 DAY) AS boundary`,
      ["2026-03-18' OR '1'='1"],
    ) as [any[], any];
    // A hostile string must simply fail to parse as a date, not alter the query.
    expect(rows).toHaveLength(1);
    expect(rows[0].boundary).toBeNull();
  });

  it('gives the org spend-window clause exclusive-end-of-day semantics', async () => {
    const db = await makeDb();
    // Mirrors src/lib/report/org.ts: committed_at < DATE_ADD(?, INTERVAL 1 DAY)
    const inWindow = async (committedAt: string) => {
      const [rows] = await db.execute(
        `SELECT 1 AS hit WHERE ? < DATE_ADD(?, INTERVAL 1 DAY)`,
        [committedAt, '2026-03-31'],
      ) as [any[], any];
      return rows.length === 1;
    };
    expect(await inWindow('2026-03-31 23:59:59')).toBe(true);
    expect(await inWindow('2026-04-01 00:00:01')).toBe(false);
  });

  it('handles DATE_ADD(NOW(), ...) even though NOW() is rewritten first', async () => {
    // translateSQL turns NOW() into datetime('now','localtime') before any
    // DATE_ADD rule runs, and that replacement contains a comma — a rule that
    // naively matched "everything up to the first comma" would break here.
    // DATE_SUB already carries a dedicated variant for this reason.
    const db = await makeDb();
    const [rows] = await db.execute(
      `SELECT DATE_ADD(NOW(), INTERVAL 7 DAY) AS boundary`,
    ) as [any[], any];
    expect(rows).toHaveLength(1);
    expect(String(rows[0].boundary)).toMatch(/^\d{4}-\d{2}-\d{2}/);
  });
});
