jest.mock('@/lib/db', () => ({ __esModule: true, default: { execute: jest.fn() } }));
jest.mock('@/lib/auth', () => ({ __esModule: true, requireAdmin: jest.fn(), extractUser: jest.fn().mockResolvedValue(null) }));
jest.mock('@/lib/orgs/guard', () => ({
  requireAllowedOrg: (org: string | null) => (org ? { ok: true, org } : { ok: false, res: new Response(null, { status: 400 }) }),
}));
jest.mock('@/lib/teams/service', () => ({
  listTeams: jest.fn(async () => [{ id: 't1', name: 'Core', color: '#123456', members: ['ann'] }]),
}));
jest.mock('@/lib/canonical/state', () => ({ isCanonicalBuilt: jest.fn() }));
jest.mock('@/lib/activity-calendar/service', () => ({
  ...jest.requireActual('@/lib/activity-calendar/metrics'),
  getTeamCalendar: jest.fn(async () => ({ metric: 'commits', start: 's', end: 'e', thresholds: [], rows: [] })),
}));

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { isCanonicalBuilt } from '@/lib/canonical/state';
import { getTeamCalendar } from '@/lib/activity-calendar/service';
import { GET } from '@/app/api/activity-calendar/route';

const get = (qs: string) => GET(new NextRequest(`http://localhost/api/activity-calendar?${qs}`));

beforeEach(() => {
  jest.clearAllMocks();
  (requireAdmin as jest.Mock).mockResolvedValue(null);
  (isCanonicalBuilt as jest.Mock).mockResolvedValue(true);
});

it('returns 403 to a viewer without reading data', async () => {
  (requireAdmin as jest.Mock).mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
  expect((await get('org=acme&team=t1')).status).toBe(403);
  expect(getTeamCalendar).not.toHaveBeenCalled();
});

it('rejects an unknown metric and an unknown team', async () => {
  expect((await get('org=acme&team=t1&metric=bogus')).status).toBe(400);
  expect((await get('org=acme&team=nope')).status).toBe(404);
});

it('returns 409 not_built when the org has no canonical tables', async () => {
  (isCanonicalBuilt as jest.Mock).mockResolvedValue(false);
  const res = await get('org=acme&team=t1');
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: 'not_built' });
});

it('returns the team calendar for the team members', async () => {
  const res = await get('org=acme&team=t1&metric=story_points');
  expect(res.status).toBe(200);
  expect(getTeamCalendar).toHaveBeenCalledWith('acme', ['ann'], 'story_points');
  expect((await res.json()).team).toEqual({ id: 't1', name: 'Core', color: '#123456' });
});
