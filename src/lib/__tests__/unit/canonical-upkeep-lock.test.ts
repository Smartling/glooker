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
