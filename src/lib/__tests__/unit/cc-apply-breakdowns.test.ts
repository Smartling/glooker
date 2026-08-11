jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));

import fs from 'fs';
import os from 'os';
import path from 'path';

let dbPath: string;
let applySkillsUsage: any;
let applyModelUsage: any;
let db: any;

// See cc-breakdown-schema.test.ts: process.env is shared across test files in a
// worker, so leaving SQLITE_PATH/DB_TYPE mutated leaks into whichever file runs
// next — an order-dependent flake. Restore both in afterAll.
const priorSqlitePath = process.env.SQLITE_PATH;
const priorDbType = process.env.DB_TYPE;

beforeAll(async () => {
  dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'glooker-bd-')), 'test.db');
  process.env.SQLITE_PATH = dbPath;
  process.env.DB_TYPE = 'sqlite';
  db = (await import('@/lib/db')).default;
  ({ applySkillsUsage, applyModelUsage } = await import('@/lib/cc-spend/apply-breakdowns'));

  await db.execute(`INSERT INTO reports (id, org, period_days, status) VALUES ('r1', 'acme', 14, 'completed')`);
  await db.execute(
    `INSERT INTO developer_stats (report_id, github_login, github_name) VALUES ('r1', 'alice', 'Alice')`,
  );
  await db.execute(
    `INSERT INTO commit_analyses (report_id, commit_sha, repo, github_login, author_email, commit_message)
     VALUES ('r1', 'sha1', 'repo', 'alice', 'alice@x.com', 'msg')`,
  );
});
afterAll(() => {
  if (priorSqlitePath === undefined) delete process.env.SQLITE_PATH;
  else process.env.SQLITE_PATH = priorSqlitePath;
  if (priorDbType === undefined) delete process.env.DB_TYPE;
  else process.env.DB_TYPE = priorDbType;
  try { fs.unlinkSync(dbPath); } catch {}
});

it('writes one row per product and sets the cc_skills_used rollup', async () => {
  const res = await applySkillsUsage({
    reportId: 'r1', org: 'acme',
    skills: [
      { email: 'alice@x.com', products: [
        { product: 'cowork', used: 12, distinct: 4 },
        { product: 'chat',   used: 0,  distinct: 5 },
      ] },
      { email: 'nobody@x.com', products: [{ product: 'cowork', used: 1, distinct: 1 }] },
    ],
  });

  expect(res).toEqual({ matched: 1, unmappedEmail: 1, rows: 2, noDevStatsRow: 0 });

  const [rows] = await db.execute(
    `SELECT product, skills_used, skills_distinct FROM cc_skills_usage WHERE report_id = 'r1' ORDER BY product`,
  ) as [any[], any];
  expect(rows).toEqual([
    { product: 'chat',   skills_used: 0,  skills_distinct: 5 },
    { product: 'cowork', skills_used: 12, skills_distinct: 4 },
  ]);

  // Rollup = Σ used only. chat contributes 0 because it reports no total.
  const [devs] = await db.execute(
    `SELECT cc_skills_used FROM developer_stats WHERE report_id = 'r1' AND github_login = 'alice'`,
  ) as [any[], any];
  expect(Number(devs[0].cc_skills_used)).toBe(12);
});

it('replaces prior rows instead of accumulating on re-run', async () => {
  await applySkillsUsage({
    reportId: 'r1', org: 'acme',
    skills: [{ email: 'alice@x.com', products: [{ product: 'science', used: 3, distinct: 1 }] }],
  });
  const [rows] = await db.execute(`SELECT product FROM cc_skills_usage WHERE report_id = 'r1'`) as [any[], any];
  expect(rows.map((r: any) => r.product)).toEqual(['science']);

  const [devs] = await db.execute(
    `SELECT cc_skills_used FROM developer_stats WHERE report_id = 'r1' AND github_login = 'alice'`,
  ) as [any[], any];
  expect(Number(devs[0].cc_skills_used)).toBe(3);
});

it('writes one row per model', async () => {
  const res = await applyModelUsage({
    reportId: 'r1', org: 'acme',
    models: [{ email: 'alice@x.com', models: [
      { model: 'claude-opus-4-8', costCents: 1500, requests: 10 },
      { model: 'claude-sonnet-5', costCents: 500,  requests: 20 },
    ] }],
  });

  expect(res).toEqual({ matched: 1, unmappedEmail: 0, rows: 2, noDevStatsRow: 0 });

  const [rows] = await db.execute(
    `SELECT model, cost, requests FROM cc_model_usage WHERE report_id = 'r1' ORDER BY model`,
  ) as [any[], any];
  expect(rows.map((r: any) => ({ model: r.model, cost: Number(r.cost), requests: Number(r.requests) }))).toEqual([
    { model: 'claude-opus-4-8', cost: 1500, requests: 10 },
    { model: 'claude-sonnet-5', cost: 500,  requests: 20 },
  ]);
});

// Fix round 1: buildEmailToLoginMap can resolve two different input emails to
// the same github_login (a developer with two commit emails). Both applies
// must merge by resolved login before writing so this can never (a) silently
// clobber the rollup via an absolute UPDATE, or (b) throw on the
// UNIQUE(report_id, github_login, product|model) constraint and roll back
// the whole apply.
it('merges two entries with different emails resolving to the same login, non-overlapping products', async () => {
  await db.execute(`INSERT INTO developer_stats (report_id, github_login, github_name) VALUES ('r1', 'carol', 'Carol')`);
  await db.execute(
    `INSERT INTO commit_analyses (report_id, commit_sha, repo, github_login, author_email, commit_message)
     VALUES ('r1', 'sha-carol-1', 'repo', 'carol', 'carol1@x.com', 'msg')`,
  );
  await db.execute(
    `INSERT INTO commit_analyses (report_id, commit_sha, repo, github_login, author_email, commit_message)
     VALUES ('r1', 'sha-carol-2', 'repo', 'carol', 'carol2@x.com', 'msg')`,
  );

  const res = await applySkillsUsage({
    reportId: 'r1', org: 'acme',
    skills: [
      { email: 'carol1@x.com', products: [{ product: 'science', used: 5, distinct: 2 }] },
      { email: 'carol2@x.com', products: [{ product: 'debugging', used: 7, distinct: 3 }] },
    ],
  });

  // matched counts input emails resolved (2), not distinct logins (1).
  expect(res).toEqual({ matched: 2, unmappedEmail: 0, rows: 2, noDevStatsRow: 0 });

  const [rows] = await db.execute(
    `SELECT product, skills_used, skills_distinct FROM cc_skills_usage
     WHERE report_id = 'r1' AND github_login = 'carol' ORDER BY product`,
  ) as [any[], any];
  expect(rows).toEqual([
    { product: 'debugging', skills_used: 7, skills_distinct: 3 },
    { product: 'science',   skills_used: 5, skills_distinct: 2 },
  ]);

  const [devs] = await db.execute(
    `SELECT cc_skills_used FROM developer_stats WHERE report_id = 'r1' AND github_login = 'carol'`,
  ) as [any[], any];
  expect(Number(devs[0].cc_skills_used)).toBe(12);
});

it('merges the same product from two entries resolving to the same login instead of throwing on the UNIQUE constraint', async () => {
  const res = await applySkillsUsage({
    reportId: 'r1', org: 'acme',
    skills: [
      { email: 'carol1@x.com', products: [{ product: 'cowork', used: 4, distinct: 1 }] },
      { email: 'carol2@x.com', products: [{ product: 'cowork', used: 6, distinct: 2 }] },
    ],
  });

  expect(res).toEqual({ matched: 2, unmappedEmail: 0, rows: 1, noDevStatsRow: 0 });

  const [rows] = await db.execute(
    `SELECT product, skills_used, skills_distinct FROM cc_skills_usage
     WHERE report_id = 'r1' AND github_login = 'carol'`,
  ) as [any[], any];
  expect(rows).toEqual([{ product: 'cowork', skills_used: 10, skills_distinct: 3 }]);

  const [devs] = await db.execute(
    `SELECT cc_skills_used FROM developer_stats WHERE report_id = 'r1' AND github_login = 'carol'`,
  ) as [any[], any];
  expect(Number(devs[0].cc_skills_used)).toBe(10);
});

it('merges two entries with different emails resolving to the same login for applyModelUsage, including the same model, without throwing', async () => {
  const res = await applyModelUsage({
    reportId: 'r1', org: 'acme',
    models: [
      { email: 'carol1@x.com', models: [{ model: 'claude-opus-4-8', costCents: 200, requests: 3 }] },
      { email: 'carol2@x.com', models: [{ model: 'claude-opus-4-8', costCents: 300, requests: 4 }] },
    ],
  });

  expect(res).toEqual({ matched: 2, unmappedEmail: 0, rows: 1, noDevStatsRow: 0 });

  const [rows] = await db.execute(
    `SELECT model, cost, requests FROM cc_model_usage WHERE report_id = 'r1' AND github_login = 'carol'`,
  ) as [any[], any];
  expect(rows.map((r: any) => ({ model: r.model, cost: Number(r.cost), requests: Number(r.requests) }))).toEqual([
    { model: 'claude-opus-4-8', cost: 500, requests: 7 },
  ]);
});

// org.ts's getOrgReport INNER JOINs cc_skills_usage/cc_model_usage against
// this report's developer_stats, so a login resolved only via the
// user_mappings fallback (no commits in this report's window) is written here
// but never rendered in the Spend tab. noDevStatsRow makes that gap visible
// instead of "N matched, M rows" silently overstating what's displayable.
it('counts noDevStatsRow for a login resolved via user_mappings with no developer_stats row for this report', async () => {
  await db.execute(
    `INSERT INTO user_mappings (org, github_login, jira_account_id, jira_email)
     VALUES ('acme', 'dave', 'jira-dave', 'dave@x.com')`,
  );
  // Deliberately no developer_stats row for 'dave' under report r1.

  const skillsRes = await applySkillsUsage({
    reportId: 'r1', org: 'acme',
    skills: [{ email: 'dave@x.com', products: [{ product: 'cowork', used: 3, distinct: 2 }] }],
  });
  expect(skillsRes).toEqual({ matched: 1, unmappedEmail: 0, rows: 1, noDevStatsRow: 1 });

  const modelsRes = await applyModelUsage({
    reportId: 'r1', org: 'acme',
    models: [{ email: 'dave@x.com', models: [{ model: 'claude-haiku-4', costCents: 50, requests: 2 }] }],
  });
  expect(modelsRes).toEqual({ matched: 1, unmappedEmail: 0, rows: 1, noDevStatsRow: 1 });

  // No developer_stats row exists for dave, so the rollup UPDATE is a no-op —
  // confirms noDevStatsRow isn't just counting rows that also silently fail
  // elsewhere.
  const [devs] = await db.execute(
    `SELECT * FROM developer_stats WHERE report_id = 'r1' AND github_login = 'dave'`,
  ) as [any[], any];
  expect(devs).toHaveLength(0);
});
