jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));

import fs from 'fs';
import os from 'os';
import path from 'path';

let dbPath: string;
let db: any;
let svc: typeof import('@/lib/activity-calendar/service');

const priorSqlitePath = process.env.SQLITE_PATH;
const priorDbType = process.env.DB_TYPE;
const NOW = new Date('2026-11-10T15:00:00Z');

beforeAll(async () => {
  dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'glooker-cal-')), 'test.db');
  process.env.SQLITE_PATH = dbPath;
  process.env.DB_TYPE = 'sqlite';
  db = (await import('@/lib/db')).default;
  svc = await import('@/lib/activity-calendar/service');

  const commit = (sha: string, login: string, at: string, added: number, org = 'acme') => db.execute(
    `INSERT INTO commit_canonical (org, commit_sha, analysis_id, report_id, github_login, repo, committed_at, lines_added, lines_removed)
     VALUES (?, ?, 1, 'r1', ?, 'repo', ?, ?, 1)`, [org, sha, login, at, added]);
  await commit('a1', 'ann', '2026-11-01 10:00:00', 10);
  await commit('a2', 'ann', '2026-11-01 18:00:00', 20);
  await commit('a3', 'ann', '2026-10-02 09:00:00', 5);
  await commit('old', 'ann', '2025-11-10 23:00:00', 5);      // one day before the 365-day window
  await commit('b1', 'bob', '2026-11-03 10:00:00', 1);
  await commit('x1', 'ann', '2026-11-01 10:00:00', 1, 'other'); // other org
  await commit('z1', 'zed', '2026-11-01 10:00:00', 1);          // not on the team

  const issue = (key: string, login: string, resolved: string | null, sp: number | null) => db.execute(
    `INSERT INTO jira_canonical (org, issue_key, issue_id, report_id, github_login, project_key, story_points, resolved_at)
     VALUES ('acme', ?, 1, 'r1', ?, 'P', ?, ?)`, [key, login, sp, resolved]);
  await issue('P-1', 'bob', '2026-11-05 10:00:00', 3);
  await issue('P-2', 'bob', '2026-11-05 12:00:00', null);
  await issue('P-3', 'bob', null, 8);

  await db.execute("INSERT INTO reports (id, org, period_days, status, created_at) VALUES ('old', 'acme', 14, 'completed', '2026-01-01 00:00:00')");
  await db.execute("INSERT INTO reports (id, org, period_days, status, created_at) VALUES ('new', 'acme', 14, 'completed', '2026-11-01 00:00:00')");
  await db.execute("INSERT INTO reports (id, org, period_days, status, created_at) VALUES ('oth', 'other', 14, 'completed', '2026-11-09 00:00:00')");
  const dev = (report: string, login: string, name: string, avatar: string) => db.execute(
    'INSERT INTO developer_stats (report_id, github_login, github_name, avatar_url) VALUES (?, ?, ?, ?)', [report, login, name, avatar]);
  await dev('new', 'ann', 'Ann Lee', 'https://avatars.githubusercontent.com/u/1?v=new');
  await dev('old', 'ann', 'Ann Old', 'https://avatars.githubusercontent.com/u/1?v=old');
  await dev('oth', 'ann', 'Other Org', 'https://avatars.githubusercontent.com/u/1?v=other');

  const pr = (login: string, kind: string, n: number, at: string) => db.execute(
    `INSERT INTO pr_activity (org, github_login, kind, repo, pr_number, merged_at) VALUES ('acme', ?, ?, 'repo', ?, ?)`,
    [login, kind, n, at]);
  await pr('ann', 'authored', 1, '2026-11-02T10:00:00.000Z');
  await pr('ann', 'reviewed', 2, '2026-11-02T11:00:00.000Z');
  await pr('bob', 'reviewed', 1, '2026-11-02T12:00:00.000Z');
});
afterAll(() => {
  if (priorSqlitePath === undefined) delete process.env.SQLITE_PATH;
  else process.env.SQLITE_PATH = priorSqlitePath;
  if (priorDbType === undefined) delete process.env.DB_TYPE;
  else process.env.DB_TYPE = priorDbType;
  try { fs.unlinkSync(dbPath); } catch {}
});

it('counts commits per UTC day for team members only, inside the 365-day window, sorted by total', async () => {
  const r = await svc.getTeamCalendar('acme', ['bob', 'ann', 'cat'], 'commits', NOW);
  expect(r.start).toBe('2025-11-11');
  expect(r.end).toBe('2026-11-10');
  expect(r.rows.map((x) => x.login)).toEqual(['ann', 'bob', 'cat']);
  expect(r.rows[0]).toMatchObject({ login: 'ann', total: 3, days: { '2026-11-01': 2, '2026-10-02': 1 } });
  expect(r.rows[2]).toEqual({ login: 'cat', name: '', avatarUrl: '', total: 0, days: {} });
});

it('sums lines changed', async () => {
  const r = await svc.getTeamCalendar('acme', ['ann'], 'lines', NOW);
  expect(r.rows[0].days).toEqual({ '2026-11-01': 32, '2026-10-02': 6 });
});

it('counts resolved Jira issues and sums story points, skipping unresolved issues', async () => {
  const jira = await svc.getTeamCalendar('acme', ['bob'], 'jira', NOW);
  expect(jira.rows[0].days).toEqual({ '2026-11-05': 2 });
  const sp = await svc.getTeamCalendar('acme', ['bob'], 'story_points', NOW);
  expect(sp.rows[0]).toMatchObject({ total: 3, days: { '2026-11-05': 3 } });
});

it('separates authored PRs from reviews', async () => {
  const prs = await svc.getTeamCalendar('acme', ['ann', 'bob'], 'prs', NOW);
  expect(prs.rows.find((x) => x.login === 'ann')!.days).toEqual({ '2026-11-02': 1 });
  expect(prs.rows.find((x) => x.login === 'bob')!.total).toBe(0);
  const reviews = await svc.getTeamCalendar('acme', ['ann', 'bob'], 'reviews', NOW);
  expect(reviews.rows.map((x) => x.total)).toEqual([1, 1]);
});

it('returns an empty calendar for a team without members', async () => {
  const r = await svc.getTeamCalendar('acme', [], 'commits', NOW);
  expect(r.rows).toEqual([]);
  expect(r.thresholds).toEqual([]);
});

it("takes name and stored avatar from the member's latest report in this org", async () => {
  const r = await svc.getTeamCalendar('acme', ['ann', 'bob'], 'commits', NOW);
  expect(r.rows.find((x) => x.login === 'ann')).toMatchObject({
    name: 'Ann Lee', avatarUrl: 'https://avatars.githubusercontent.com/u/1?v=new',
  });
  expect(r.rows.find((x) => x.login === 'bob')).toMatchObject({ name: '', avatarUrl: '' });
});
