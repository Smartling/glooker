jest.mock('@/lib/db', () => ({ __esModule: true, default: { execute: jest.fn() } }));
jest.mock('@/lib/auth', () => ({
  __esModule: true,
  requireAdmin: jest.fn(),
  isAdmin: jest.fn().mockReturnValue(true),
  isAuthEnabled: jest.fn().mockReturnValue(false),
  extractUser: jest.fn().mockReturnValue(null),
}));
jest.mock('@/lib/canonical/state', () => ({ listCanonicalBuilds: jest.fn() }));
jest.mock('@/lib/canonical/rebuild', () => ({
  ...jest.requireActual('@/lib/canonical/rebuild'),
  checkCanonical: jest.fn(),
  acquireRebuildLock: jest.fn(),
  runRebuild: jest.fn(),
  getRebuildLock: jest.fn(),
}));
jest.mock('@/lib/report/range', () => ({ clearRangeCache: jest.fn() }));

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { listCanonicalBuilds } from '@/lib/canonical/state';
import * as rebuild from '@/lib/canonical/rebuild';
import { clearRangeCache } from '@/lib/report/range';
import { getRebuildProgress } from '@/lib/canonical/progress';
import { GET as statusGET } from '@/app/api/settings/canonical/route';
import { GET as checkGET } from '@/app/api/settings/canonical/check/route';
import { POST as rebuildPOST } from '@/app/api/settings/canonical/rebuild/route';

const mocks = rebuild as any;
const admin = requireAdmin as jest.Mock;
const req = (m: string) => new Request('http://localhost/api/settings/canonical', { method: m }) as any;

beforeEach(() => {
  jest.clearAllMocks();
  admin.mockResolvedValue(null);
  (globalThis as any).__glookerCanonicalRebuild = undefined;
});

describe('canonical admin api', () => {
  it.each(['status', 'check', 'rebuild'])('%s returns 403 for a viewer', async (which) => {
    admin.mockResolvedValue(NextResponse.json({ error: 'forbidden' }, { status: 403 }));
    const res = which === 'status' ? await statusGET(req('GET'))
      : which === 'check' ? await checkGET(req('GET')) : await rebuildPOST(req('POST'));
    expect(res.status).toBe(403);
    expect(listCanonicalBuilds).not.toHaveBeenCalled();
    expect(mocks.checkCanonical).not.toHaveBeenCalled();
    expect(mocks.acquireRebuildLock).not.toHaveBeenCalled();
    expect(mocks.runRebuild).not.toHaveBeenCalled();
  });

  it('status returns builds, lock and progress', async () => {
    (listCanonicalBuilds as jest.Mock).mockResolvedValue([{ org: 'o' }]);
    mocks.getRebuildLock.mockResolvedValue({ startedAt: 't', holder: 'h' });
    const body = await (await statusGET(req('GET'))).json();
    expect(body.builds).toEqual([{ org: 'o' }]);
    expect(body.lock).toEqual({ startedAt: 't', holder: 'h' });
    expect(body.progress.running).toBe(false);
  });

  it('check returns the per-org results and writes nothing', async () => {
    const orgs = [{ org: 'o', builtAt: null }];
    mocks.checkCanonical.mockResolvedValue(orgs);
    const res = await checkGET(req('GET'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ orgs });
  });

  it('rebuild returns 202 and starts in the background', async () => {
    mocks.acquireRebuildLock.mockResolvedValue({ startedAt: 't', completedIds: new Set() });
    mocks.runRebuild.mockReturnValue(new Promise(() => {}));
    const res = await rebuildPOST(req('POST'));
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ started: true });
    expect(mocks.runRebuild).toHaveBeenCalledTimes(1);
    expect(getRebuildProgress().running).toBe(true);
  });

  it('rebuild returns 409 when one is already running', async () => {
    mocks.acquireRebuildLock.mockRejectedValue(new rebuild.RebuildRunningError());
    const res = await rebuildPOST(req('POST'));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'rebuild already running' });
  });

  it('records progress, results and clears the range cache on success', async () => {
    mocks.acquireRebuildLock.mockResolvedValue({ startedAt: 't', completedIds: new Set() });
    mocks.runRebuild.mockImplementation(async (_h: string, _s: any, opts: any) => {
      await opts.onProgress('o', 1, 2);
      return [{ org: 'o' }];
    });
    await rebuildPOST(req('POST'));
    await new Promise((r) => setImmediate(r));
    const p = getRebuildProgress();
    expect(p).toMatchObject({ running: false, orgsDone: 1, orgsTotal: 2, results: [{ org: 'o' }], error: null });
    expect(p.finishedAt).not.toBeNull();
    expect(clearRangeCache).toHaveBeenCalledTimes(1);
  });

  it('records error without unhandled rejection and clears the range cache on failure', async () => {
    mocks.acquireRebuildLock.mockResolvedValue({ startedAt: 't', completedIds: new Set() });
    mocks.runRebuild.mockRejectedValue(new Error('boom'));
    const res = await rebuildPOST(req('POST'));
    expect(res.status).toBe(202);
    await new Promise((r) => setImmediate(r));
    expect(getRebuildProgress()).toMatchObject({ running: false, error: 'boom', results: null });
    expect(clearRangeCache).toHaveBeenCalledTimes(1);
  });
});
