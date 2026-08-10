jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));
jest.mock('@/lib/db', () => ({ __esModule: true, default: { execute: jest.fn() } }));
jest.mock('@/lib/report/dev', () => ({
  getDevReport: jest.fn(),
  DeveloperNotFoundError: class DeveloperNotFoundError extends Error {},
}));
jest.mock('@/lib/report/service', () => ({ ReportNotFoundError: class ReportNotFoundError extends Error {} }));
jest.mock('@/lib/cost-visibility', () => ({
  resolveRequester: jest.fn(async () => ({ githubLogin: 'bob', isAdmin: false, authDisabled: false })),
  buildCostVisibility: jest.fn(),
  stripCostFields: jest.requireActual('@/lib/cost-visibility').stripCostFields,
  costCacheHeaders: jest.requireActual('@/lib/cost-visibility').costCacheHeaders,
}));

import { GET } from '@/app/api/report/[id]/dev/[login]/route';
import { getDevReport } from '@/lib/report/dev';
import { buildCostVisibility } from '@/lib/cost-visibility';

const params = { params: Promise.resolve({ id: 'r1', login: 'alice' }) };
const req = () => new Request('http://localhost/api/report/r1/dev/alice');

beforeEach(() => {
  jest.clearAllMocks();
  (getDevReport as jest.Mock).mockResolvedValue({
    report: { id: 'r1', org: 'acme' },
    developer: { github_login: 'alice', cc_total_cost: 100, cc_requests: 5, cc_skills_used: 12 },
    allDevelopers: [],
    commits: [], timeline: [], unmergedWork: { openPrs: [], branchCommits: [] },
    skills: [{ product: 'cowork', skills_used: 12, skills_distinct: 4 }],
    // Cost-ordered (DESC), as dev.ts's ORDER BY cost DESC would produce. Names
    // deliberately sort the opposite way from cost, so an assertion on model-name
    // order can't be satisfied by accident when cost is stripped.
    models: [
      { model: 'claude-sonnet-5', cost: 500, requests: 20 },
      { model: 'claude-haiku-4', cost: 100, requests: 5 },
    ],
  });
});

it('strips per-model cost and requests when cost is not visible, reordered by model name', async () => {
  const canSeeCost = jest.fn(() => false);
  (buildCostVisibility as jest.Mock).mockResolvedValue({ canSeeCost, canSeeAnyCost: false });

  const body = await (await GET(req() as any, params as any)).json();

  // Re-sorted by model name (asc), not the original cost-DESC order, so array
  // position doesn't leak a relative-cost ranking to an unprivileged viewer.
  expect(body.models).toEqual([
    { model: 'claude-haiku-4' },
    { model: 'claude-sonnet-5' },
  ]);
  expect(body.models[0]).not.toHaveProperty('cost');
  expect(body.models[1]).not.toHaveProperty('cost');
  // requests is gated too: summing models[].requests reconstructs the gated
  // cc_requests total, so it must be stripped alongside cost.
  expect(body.models[0]).not.toHaveProperty('requests');
  expect(body.models[1]).not.toHaveProperty('requests');
  // Skills are ungated telemetry.
  expect(body.skills).toEqual([{ product: 'cowork', skills_used: 12, skills_distinct: 4 }]);
  expect(body.developer.cc_skills_used).toBe(12);
  expect(body.developer).not.toHaveProperty('cc_total_cost');
  // Prove the gate was consulted for the focused developer, not some other identity.
  expect(canSeeCost).toHaveBeenCalledWith('alice');
});

it('keeps per-model cost and cost-DESC order when cost is visible', async () => {
  const canSeeCost = jest.fn(() => true);
  (buildCostVisibility as jest.Mock).mockResolvedValue({ canSeeCost, canSeeAnyCost: true });

  const body = await (await GET(req() as any, params as any)).json();

  expect(body.models).toEqual([
    { model: 'claude-sonnet-5', cost: 500, requests: 20 },
    { model: 'claude-haiku-4', cost: 100, requests: 5 },
  ]);
  expect(body.developer.cc_total_cost).toBe(100);
  expect(canSeeCost).toHaveBeenCalledWith('alice');
});
