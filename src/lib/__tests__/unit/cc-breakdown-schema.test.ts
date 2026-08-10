jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));

import fs from 'fs';
import os from 'os';
import path from 'path';
import { createSQLiteDB } from '@/lib/db/sqlite';

let dbPath: string;
let db: any;

beforeAll(async () => {
  dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'glooker-schema-')), 'test.db');
  process.env.SQLITE_PATH = dbPath;
  db = createSQLiteDB();
});
afterAll(() => { try { fs.unlinkSync(dbPath); } catch {} });

it('creates both breakdown tables', async () => {
  const [rows] = await db.execute(
    `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('cc_skills_usage','cc_model_usage')`,
  ) as [any[], any];
  expect(rows.map((r: any) => r.name).sort()).toEqual(['cc_model_usage', 'cc_skills_usage']);
});

it('adds the cc_skills_used rollup column to developer_stats', async () => {
  const [cols] = await db.execute(`PRAGMA table_info(developer_stats)`) as [any[], any];
  expect(cols.map((c: any) => c.name)).toContain('cc_skills_used');
});

it('routes a setter-only pragma (no return rows) through execute() without throwing', async () => {
  // `PRAGMA foreign_keys = ON` has `.reader === false` on the prepared
  // statement (unlike reader-form pragmas such as `table_info`), so it must
  // go through the run() branch, not all(). Regressed by a keyword-regex
  // dispatcher that classified any string starting with "PRAGMA" as a
  // reader statement; fixed by dispatching on `stmt.reader` instead.
  const [result] = await db.execute(`PRAGMA foreign_keys = ON`) as [any, any];
  expect(result).toEqual(expect.objectContaining({ affectedRows: expect.any(Number) }));
});

it('cascades breakdown rows when the report is deleted', async () => {
  await db.execute(
    `INSERT INTO reports (id, org, period_days, status) VALUES ('rX', 'acme', 14, 'completed')`,
  );
  await db.execute(
    `INSERT INTO cc_skills_usage (report_id, github_login, product, skills_used, skills_distinct)
     VALUES ('rX', 'alice', 'cowork', 5, 2)`,
  );
  await db.execute(
    `INSERT INTO cc_model_usage (report_id, github_login, model, cost, requests)
     VALUES ('rX', 'alice', 'claude-sonnet-5', 1234, 10)`,
  );
  await db.execute(`DELETE FROM reports WHERE id = 'rX'`);

  const [skills] = await db.execute(`SELECT * FROM cc_skills_usage WHERE report_id = 'rX'`) as [any[], any];
  const [models] = await db.execute(`SELECT * FROM cc_model_usage WHERE report_id = 'rX'`) as [any[], any];
  expect(skills).toHaveLength(0);
  expect(models).toHaveLength(0);
});

it('rejects a duplicate (report, login, dimension)', async () => {
  await db.execute(`INSERT INTO reports (id, org, period_days, status) VALUES ('rY', 'acme', 14, 'completed')`);
  await db.execute(
    `INSERT INTO cc_skills_usage (report_id, github_login, product, skills_used, skills_distinct)
     VALUES ('rY', 'bob', 'chat', 0, 3)`,
  );
  await expect(db.execute(
    `INSERT INTO cc_skills_usage (report_id, github_login, product, skills_used, skills_distinct)
     VALUES ('rY', 'bob', 'chat', 1, 1)`,
  )).rejects.toThrow(/UNIQUE/i);
});
