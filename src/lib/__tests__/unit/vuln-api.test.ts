jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));
jest.mock('@/lib/auth', () => ({
  requireAdmin: jest.fn().mockResolvedValue(null),
  extractUser: jest.fn().mockReturnValue({ email: 'admin@x', groups: [] }),
}));
jest.mock('@/lib/vulnerabilities/queries', () => {
  class SyncNotFoundError extends Error {}
  return {
    getSummary: jest.fn(), getTrend: jest.fn(), getAlerts: jest.fn(), getCoverage: jest.fn(), listSyncs: jest.fn(),
    getSyncProgressView: jest.fn(), SyncNotFoundError,
  };
});
jest.mock('@/lib/vulnerabilities/scheduler', () => ({ startSync: jest.fn() }));

import { NextRequest, NextResponse } from 'next/server';
import { GET as summary } from '@/app/api/vulnerabilities/summary/route';
import { GET as trend } from '@/app/api/vulnerabilities/trend/route';
import { GET as alerts } from '@/app/api/vulnerabilities/alerts/route';
import { GET as coverage } from '@/app/api/vulnerabilities/coverage/route';
import { GET as syncs } from '@/app/api/vulnerabilities/syncs/route';
import { GET as syncProgress } from '@/app/api/vulnerabilities/syncs/[id]/progress/route';
import { POST as sync } from '@/app/api/vulnerabilities/sync/route';
import { getSummary, getTrend, getAlerts, getCoverage, listSyncs, getSyncProgressView, SyncNotFoundError } from '@/lib/vulnerabilities/queries';
import { startSync } from '@/lib/vulnerabilities/scheduler';
import { requireAdmin } from '@/lib/auth';

const req = (p: string, init?: any) => new NextRequest(`http://localhost${p}`, init);
const progressReq = (id: string) => syncProgress(req(`/api/vulnerabilities/syncs/${id}/progress`), { params: Promise.resolve({ id }) });
const prior = process.env.VULNERABILITIES_ORG;
beforeEach(() => { process.env.VULNERABILITIES_ORG = 'o'; jest.clearAllMocks(); (requireAdmin as jest.Mock).mockResolvedValue(null); });
afterAll(() => { if (prior === undefined) delete process.env.VULNERABILITIES_ORG; else process.env.VULNERABILITIES_ORG = prior; });

const GETS: Array<[string, (r: any) => Promise<Response>]> = [
  ['summary', summary], ['trend', trend], ['alerts', alerts], ['coverage', coverage], ['syncs', syncs],
];

it('404s every route when the feature is off', async () => {
  delete process.env.VULNERABILITIES_ORG;
  for (const [name, h] of GETS) expect((await h(req(`/api/vulnerabilities/${name}`))).status).toBe(404);
  expect((await sync(req('/api/vulnerabilities/sync', { method: 'POST' }))).status).toBe(404);
  expect((await progressReq('5')).status).toBe(404);
});

it('every GET is readable by a non-admin (requireAdmin would deny, and is never consulted)', async () => {
  (requireAdmin as jest.Mock).mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
  for (const fn of [getSummary, getTrend, getAlerts, getCoverage, listSyncs]) (fn as jest.Mock).mockResolvedValue({ available: true });
  for (const [name, h] of GETS) expect((await h(req(`/api/vulnerabilities/${name}`))).status).toBe(200);
});

it('passes parsed filters to the query layer', async () => {
  (getSummary as jest.Mock).mockResolvedValue({ available: true });
  const res = await summary(req('/api/vulnerabilities/summary?codebase=frontend&baseline=7d&team=T1'));
  expect(res.status).toBe(200);
  expect((getSummary as jest.Mock).mock.calls[0][0]).toMatchObject({ codebase: 'frontend', baseline: '7d', team: 'T1' });
});

it('400s on a bad filter and on an unknown team', async () => {
  expect((await alerts(req('/api/vulnerabilities/alerts?codebase=mobile'))).status).toBe(400);
  (getAlerts as jest.Mock).mockResolvedValue({ error: 'unknown team', known_teams: ['T1'] });
  const res = await alerts(req('/api/vulnerabilities/alerts?team=Z'));
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: 'unknown team', known_teams: ['T1'] });
});

it('POST sync: admin only, 202 / 409, records who triggered it', async () => {
  (requireAdmin as jest.Mock).mockResolvedValueOnce(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
  expect((await sync(req('/api/vulnerabilities/sync', { method: 'POST' }))).status).toBe(403);
  (startSync as jest.Mock).mockResolvedValueOnce({ status: 'started', syncId: 5 });
  const ok = await sync(req('/api/vulnerabilities/sync', { method: 'POST' }));
  expect(ok.status).toBe(202);
  expect(await ok.json()).toEqual({ syncId: 5 });
  expect(startSync).toHaveBeenCalledWith('manual', 'admin@x');
  (startSync as jest.Mock).mockResolvedValueOnce({ status: 'already-running' });
  expect((await sync(req('/api/vulnerabilities/sync', { method: 'POST' }))).status).toBe(409);
});

it.each(['abc', '1e3', '12abc', '-1', '0x1f', '1.5', ''])('GET syncs/:id/progress: 400s on id %p (digits only), never reaching the query layer', async (id) => {
  const res = await progressReq(id);
  expect(res.status).toBe(400);
  expect(getSyncProgressView).not.toHaveBeenCalled();
});

it('GET syncs/:id/progress: 404s on an unknown id', async () => {
  (getSyncProgressView as jest.Mock).mockRejectedValueOnce(new SyncNotFoundError(999));
  const res = await progressReq('999');
  expect(res.status).toBe(404);
});

it('GET syncs/:id/progress: readable by a non-admin, returns the view as-is', async () => {
  (requireAdmin as jest.Mock).mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
  const view = { status: 'running' as const, step: 'Fetching alerts…', done: 3, total: 10, logs: ['[10:00:00] fetching alerts'] };
  (getSyncProgressView as jest.Mock).mockResolvedValueOnce(view);
  const res = await progressReq('5');
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual(view);
  expect(getSyncProgressView).toHaveBeenCalledWith(5);
});
