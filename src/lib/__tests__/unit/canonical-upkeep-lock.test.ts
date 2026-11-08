jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));
const txExecute = jest.fn();
const poolExecute = jest.fn();
jest.mock('@/lib/db', () => ({
  __esModule: true,
  default: { execute: (...a: any[]) => poolExecute(...a), transaction: (fn: any) => fn({ execute: txExecute }) },
}));
jest.mock('@/lib/canonical/pick', () => ({ refreshCommitKeys: jest.fn(), refreshJiraKeys: jest.fn() }));

import { completeReport, deleteReportWithUpkeep } from '@/lib/canonical/upkeep';

beforeEach(() => {
  jest.clearAllMocks();
  poolExecute.mockResolvedValue([[{ org: 'acme' }], null]);
  txExecute.mockResolvedValue([[{ org: 'acme' }], null]);
});

it('completeReport takes the per-org lock before any other statement', async () => {
  await completeReport('r1', '{}');
  expect(txExecute.mock.calls[0][0]).toMatch(/FROM canonical_builds WHERE org = \? FOR UPDATE$/);
  expect(txExecute.mock.calls[0][1]).toEqual(['acme']);
});

it('deleteReportWithUpkeep takes the per-org lock before any other statement', async () => {
  txExecute.mockResolvedValue([[{ org: 'acme' }], null]);
  await deleteReportWithUpkeep('r1').catch(() => {});
  expect(txExecute.mock.calls[0][0]).toMatch(/FROM canonical_builds WHERE org = \? FOR UPDATE$/);
});

it('no lock row means no canonical writes', async () => {
  txExecute.mockResolvedValue([[], null]);
  await completeReport('r1', '{}');
  expect(txExecute).toHaveBeenCalledTimes(2); // lock + UPDATE only
});

describe('lock-conflict retry', () => {
  const lockErr = (errno: number) => Object.assign(new Error('lock'), { errno });
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('retries a deadlock (errno 1213) and resolves on the second attempt', async () => {
    txExecute.mockRejectedValueOnce(lockErr(1213));
    const p = completeReport('r1', '{}');
    await jest.advanceTimersByTimeAsync(250);
    await expect(p).resolves.toBeUndefined();
    const locks = txExecute.mock.calls.filter((c) => /FOR UPDATE$/.test(c[0]));
    expect(locks).toHaveLength(2);
  });

  it('retries a lock-wait timeout by code', async () => {
    txExecute.mockRejectedValueOnce(Object.assign(new Error('t'), { code: 'ER_LOCK_WAIT_TIMEOUT' }));
    const p = deleteReportWithUpkeep('r1');
    await jest.advanceTimersByTimeAsync(250);
    await expect(p).resolves.toEqual(expect.any(Number));
  });

  it('does not retry a non-lock error', async () => {
    txExecute.mockRejectedValueOnce(Object.assign(new Error('boom'), { errno: 1146 }));
    await expect(completeReport('r1', '{}')).rejects.toThrow('boom');
    expect(txExecute).toHaveBeenCalledTimes(1);
  });

  it('rethrows after three lock errors', async () => {
    txExecute.mockRejectedValue(lockErr(1213));
    const p = completeReport('r1', '{}');
    const settled = p.catch((e) => e);
    await jest.advanceTimersByTimeAsync(1250);
    const err = await settled;
    expect(err).toMatchObject({ errno: 1213 });
    expect(txExecute).toHaveBeenCalledTimes(3);
  });
});
