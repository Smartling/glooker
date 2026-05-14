// Tests for POST /api/report/[id]/cc-spend/refresh:
//   - admin gate is honored (denied response is propagated)
//   - per-report in-flight lock returns 409 on concurrent POSTs
//   - lock is released so a subsequent POST succeeds
//
// The route's in-flight Set is stored on globalThis to survive Next.js HMR;
// these tests reset it between cases so state doesn't leak across files.

jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));
jest.mock('@/lib/auth', () => ({
  requireAdmin: jest.fn().mockResolvedValue(null),
}));
jest.mock('@/lib/cc-spend/service', () => ({
  refreshCcSpendForReport: jest.fn(),
}));

import { POST } from '@/app/api/report/[id]/cc-spend/refresh/route';
import { requireAdmin } from '@/lib/auth';
import { refreshCcSpendForReport } from '@/lib/cc-spend/service';

const mockRequireAdmin = requireAdmin as jest.Mock;
const mockRefresh = refreshCcSpendForReport as jest.Mock;

function makeReq() {
  return { headers: new Headers() } as any;
}
function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  mockRequireAdmin.mockReset();
  mockRequireAdmin.mockResolvedValue(null);
  mockRefresh.mockReset();
  // Reset the globalThis Set so each test sees a clean slate.
  (globalThis as any).__cc_refresh_in_flight = new Set<string>();
});

describe('POST /api/report/[id]/cc-spend/refresh', () => {
  it('propagates the requireAdmin denial when caller is not admin', async () => {
    const denied = new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
    mockRequireAdmin.mockResolvedValue(denied);

    const res = await POST(makeReq(), makeParams('rep1') as any);
    expect(res.status).toBe(403);
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('returns the apply result on the happy path', async () => {
    mockRefresh.mockResolvedValue({
      matched: 2, unmappedEmail: 1, noDevStatsRow: 0,
      totalApiUsers: 3, totalSpendUsd: 12.34,
      periodStart: '2026-04-01', periodEnd: '2026-04-15',
    });

    const res = await POST(makeReq(), makeParams('rep1') as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.matched).toBe(2);
    expect(body.unmappedEmail).toBe(1);
  });

  it('returns 409 Conflict when a refresh is already in flight for the same report', async () => {
    // First call hangs (never resolves) so the lock stays held.
    let resolveFirst: (v: any) => void = () => {};
    mockRefresh.mockImplementationOnce(
      () => new Promise((resolve) => { resolveFirst = resolve; }),
    );

    const firstPromise = POST(makeReq(), makeParams('rep1') as any);

    // Yield control once so the first call enters refreshCcSpendForReport and
    // takes the lock before the second POST is dispatched.
    await Promise.resolve();

    // Second call for the SAME report — must short-circuit with 409.
    const secondRes = await POST(makeReq(), makeParams('rep1') as any);
    expect(secondRes.status).toBe(409);
    const body = await secondRes.json();
    expect(body.error).toBe('in_progress');
    // The second call must NOT have invoked the service.
    expect(mockRefresh).toHaveBeenCalledTimes(1);

    // Resolve the first call so the test doesn't hang and the lock clears.
    resolveFirst({
      matched: 0, unmappedEmail: 0, noDevStatsRow: 0,
      totalApiUsers: 0, totalSpendUsd: 0,
      periodStart: '2026-04-01', periodEnd: '2026-04-15',
    });
    const firstRes = await firstPromise;
    expect(firstRes.status).toBe(200);
  });

  it('does NOT block POSTs for a different report id', async () => {
    let resolveFirst: (v: any) => void = () => {};
    mockRefresh.mockImplementationOnce(
      () => new Promise((resolve) => { resolveFirst = resolve; }),
    );
    mockRefresh.mockResolvedValueOnce({
      matched: 0, unmappedEmail: 0, noDevStatsRow: 0,
      totalApiUsers: 0, totalSpendUsd: 0,
      periodStart: '2026-04-01', periodEnd: '2026-04-15',
    });

    const firstPromise = POST(makeReq(), makeParams('rep1') as any);
    await Promise.resolve();

    // Different report id — should NOT be blocked.
    const otherRes = await POST(makeReq(), makeParams('rep2') as any);
    expect(otherRes.status).toBe(200);
    expect(mockRefresh).toHaveBeenCalledTimes(2);

    resolveFirst({
      matched: 0, unmappedEmail: 0, noDevStatsRow: 0,
      totalApiUsers: 0, totalSpendUsd: 0,
      periodStart: '2026-04-01', periodEnd: '2026-04-15',
    });
    await firstPromise;
  });

  it('releases the lock in finally so a subsequent POST succeeds', async () => {
    mockRefresh.mockResolvedValueOnce({
      matched: 0, unmappedEmail: 0, noDevStatsRow: 0,
      totalApiUsers: 0, totalSpendUsd: 0,
      periodStart: '2026-04-01', periodEnd: '2026-04-15',
    });
    const first = await POST(makeReq(), makeParams('rep1') as any);
    expect(first.status).toBe(200);

    // Same report — lock should have been released; this call must run.
    mockRefresh.mockResolvedValueOnce({
      matched: 1, unmappedEmail: 0, noDevStatsRow: 0,
      totalApiUsers: 1, totalSpendUsd: 0.5,
      periodStart: '2026-04-01', periodEnd: '2026-04-15',
    });
    const second = await POST(makeReq(), makeParams('rep1') as any);
    expect(second.status).toBe(200);
    expect(mockRefresh).toHaveBeenCalledTimes(2);
  });

  it('releases the lock when the service throws (lock cleared in finally)', async () => {
    mockRefresh.mockRejectedValueOnce(new Error('Anthropic 500'));
    const errRes = await POST(makeReq(), makeParams('rep1') as any);
    expect(errRes.status).toBe(500);

    // Lock must have been freed: a subsequent POST runs the service again.
    mockRefresh.mockResolvedValueOnce({
      matched: 0, unmappedEmail: 0, noDevStatsRow: 0,
      totalApiUsers: 0, totalSpendUsd: 0,
      periodStart: '2026-04-01', periodEnd: '2026-04-15',
    });
    const okRes = await POST(makeReq(), makeParams('rep1') as any);
    expect(okRes.status).toBe(200);
  });
});
