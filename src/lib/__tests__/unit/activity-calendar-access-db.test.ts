jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));
let requester: any;
jest.mock('@/lib/cost-visibility', () => ({ resolveRequester: jest.fn(async () => requester) }));

import fs from 'fs';
import os from 'os';
import path from 'path';

let dbPath: string;
let access: typeof import('@/lib/activity-calendar/access');
const priorSqlitePath = process.env.SQLITE_PATH;
const priorDbType = process.env.DB_TYPE;
const H = new Headers();

beforeAll(async () => {
  dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'glooker-calacc-')), 'test.db');
  process.env.SQLITE_PATH = dbPath;
  process.env.DB_TYPE = 'sqlite';
  const db = (await import('@/lib/db')).default;
  access = await import('@/lib/activity-calendar/access');
  for (const [id, org, name] of [['t1', 'acme', 'Core'], ['t2', 'acme', 'Web'], ['t3', 'other', 'Core']]) {
    await db.execute('INSERT INTO teams (id, org, name) VALUES (?, ?, ?)', [id, org, name]);
  }
  for (const [team, login] of [['t1', 'Ann'], ['t2', 'ann'], ['t2', 'bob'], ['t3', 'cat']]) {
    await db.execute('INSERT INTO team_members (team_id, github_login) VALUES (?, ?)', [team, login]);
  }
});
afterAll(() => {
  if (priorSqlitePath === undefined) delete process.env.SQLITE_PATH;
  else process.env.SQLITE_PATH = priorSqlitePath;
  if (priorDbType === undefined) delete process.env.DB_TYPE;
  else process.env.DB_TYPE = priorDbType;
  try { fs.unlinkSync(dbPath); } catch {}
});

it('gives admins and auth-off installs every team', async () => {
  requester = { githubLogin: null, isAdmin: true, authDisabled: false };
  expect(await access.resolveCalendarAccess(H, 'acme')).toEqual({ scope: 'all' });
  requester = { githubLogin: null, isAdmin: false, authDisabled: true };
  expect(await access.resolveCalendarAccess(H, 'acme')).toEqual({ scope: 'all' });
});

it("gives a developer only their own teams in this org, matching the login case-insensitively", async () => {
  requester = { githubLogin: 'ANN', isAdmin: false, authDisabled: false };
  const a = await access.resolveCalendarAccess(H, 'acme');
  expect(a).toEqual({ scope: 'own', teamIds: new Set(['t1', 't2']) });
  requester = { githubLogin: 'bob', isAdmin: false, authDisabled: false };
  const b = await access.resolveCalendarAccess(H, 'acme');
  expect(access.canSeeTeam(b, 't2')).toBe(true);
  expect(access.canSeeTeam(b, 't1')).toBe(false);
});

it('ignores team membership in another org', async () => {
  requester = { githubLogin: 'cat', isAdmin: false, authDisabled: false };
  expect(await access.resolveCalendarAccess(H, 'acme')).toEqual({ scope: 'none', reason: 'no_team' });
});

it('says why a developer sees nothing', async () => {
  requester = { githubLogin: null, isAdmin: false, authDisabled: false };
  const a = await access.resolveCalendarAccess(H, 'acme');
  expect(a).toEqual({ scope: 'none', reason: 'unmapped' });
  expect(access.canSeeTeam(a, 't1')).toBe(false);
});
