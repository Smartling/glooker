jest.mock('@/lib/db', () => ({ __esModule: true, default: { execute: jest.fn() } }));
jest.mock('@/lib/auth', () => ({ __esModule: true, extractUser: jest.fn().mockResolvedValue(null) }));
jest.mock('@/lib/orgs/guard', () => ({
  requireAllowedOrg: (org: string | null) => (org ? { ok: true, org } : { ok: false, res: new Response(null, { status: 400 }) }),
}));
jest.mock('@/lib/teams/service', () => ({
  listTeams: jest.fn(async () => [
    { id: 't1', name: 'Core', color: '#123456', members: ['ann'] },
    { id: 't2', name: 'Web', color: '#654321', members: ['bob'] },
  ]),
}));
jest.mock('@/lib/canonical/state', () => ({ isCanonicalBuilt: jest.fn() }));
jest.mock('@/lib/activity-calendar/access', () => ({
  ...jest.requireActual('@/lib/activity-calendar/access'),
  resolveCalendarAccess: jest.fn(),
}));
jest.mock('@/lib/activity-calendar/service', () => ({
  ...jest.requireActual('@/lib/activity-calendar/metrics'),
  getTeamCalendar: jest.fn(async () => ({ metric: 'commits', start: 's', end: 'e', thresholds: [], rows: [] })),
}));

import { NextRequest } from 'next/server';
import { isCanonicalBuilt } from '@/lib/canonical/state';
import { resolveCalendarAccess } from '@/lib/activity-calendar/access';
import { getTeamCalendar } from '@/lib/activity-calendar/service';
import { GET } from '@/app/api/activity-calendar/route';
import { GET as teamsGET } from '@/app/api/activity-calendar/teams/route';

const access = resolveCalendarAccess as jest.Mock;
const get = (qs: string) => GET(new NextRequest(`http://localhost/api/activity-calendar?${qs}`));
const getTeams = () => teamsGET(new NextRequest('http://localhost/api/activity-calendar/teams?org=acme'));

beforeEach(() => {
  jest.clearAllMocks();
  access.mockResolvedValue({ scope: 'all' });
  (isCanonicalBuilt as jest.Mock).mockResolvedValue(true);
});

describe('GET /api/activity-calendar', () => {
  it('lets an admin open any team', async () => {
    expect((await get('org=acme&team=t2')).status).toBe(200);
    expect(getTeamCalendar).toHaveBeenCalledWith('acme', ['bob'], 'commits');
  });

  it("lets a developer open their own team and refuses another team's without reading it", async () => {
    access.mockResolvedValue({ scope: 'own', teamIds: new Set(['t1']) });
    expect((await get('org=acme&team=t1&metric=story_points')).status).toBe(200);
    expect(getTeamCalendar).toHaveBeenLastCalledWith('acme', ['ann'], 'story_points');
    jest.clearAllMocks();
    expect((await get('org=acme&team=t2')).status).toBe(403);
    expect(getTeamCalendar).not.toHaveBeenCalled();
  });

  it('answers 403, not 404, for an unknown team when the caller is not an admin', async () => {
    access.mockResolvedValue({ scope: 'own', teamIds: new Set(['t1']) });
    expect((await get('org=acme&team=nope')).status).toBe(403);
  });

  it('refuses a developer without a team or mapping', async () => {
    access.mockResolvedValue({ scope: 'none', reason: 'unmapped' });
    expect((await get('org=acme&team=t1')).status).toBe(403);
  });

  it('rejects an unknown metric, and an unknown team for an admin', async () => {
    expect((await get('org=acme&team=t1&metric=bogus')).status).toBe(400);
    expect((await get('org=acme&team=nope')).status).toBe(404);
  });

  it('returns 409 not_built when the org has no canonical tables', async () => {
    (isCanonicalBuilt as jest.Mock).mockResolvedValue(false);
    const res = await get('org=acme&team=t1');
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'not_built' });
  });
});

describe('GET /api/activity-calendar/teams', () => {
  it('lists every team for an admin, without member lists', async () => {
    expect(await (await getTeams()).json()).toEqual({ scope: 'all', teams: [
      { id: 't1', name: 'Core', color: '#123456' }, { id: 't2', name: 'Web', color: '#654321' },
    ] });
  });

  it("lists only the developer's own teams", async () => {
    access.mockResolvedValue({ scope: 'own', teamIds: new Set(['t2']) });
    expect(await (await getTeams()).json()).toEqual({ scope: 'own', teams: [{ id: 't2', name: 'Web', color: '#654321' }] });
  });

  it('explains an empty list', async () => {
    access.mockResolvedValue({ scope: 'none', reason: 'no_team' });
    expect(await (await getTeams()).json()).toEqual({ scope: 'none', reason: 'no_team', teams: [] });
  });
});
