jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));
jest.mock('@/lib/db', () => ({ __esModule: true, default: { execute: jest.fn() } }));
jest.mock('@/lib/report/org', () => ({ getOrgReport: jest.fn() }));
jest.mock('@/lib/report/service', () => ({ ReportNotFoundError: class ReportNotFoundError extends Error {} }));
jest.mock('@/lib/cost-visibility', () => ({
  resolveRequester: jest.fn(async () => ({ githubLogin: 'alice', isAdmin: false, authDisabled: false })),
  buildCostVisibility: jest.fn(),
  stripDevCost: jest.requireActual('@/lib/cost-visibility').stripDevCost,
  stripModelCost: jest.requireActual('@/lib/cost-visibility').stripModelCost,
  costCacheHeaders: jest.requireActual('@/lib/cost-visibility').costCacheHeaders,
}));

import { GET } from '@/app/api/report/[id]/org/route';
import { getOrgReport } from '@/lib/report/org';
import { buildCostVisibility } from '@/lib/cost-visibility';

const params = { params: Promise.resolve({ id: 'r1' }) };
const req = () => new Request('http://localhost/api/report/r1/org');

beforeEach(() => {
  jest.clearAllMocks();
  (getOrgReport as jest.Mock).mockResolvedValue({
    report: { id: 'r1', org: 'acme', cc_period_start: '2026-07-01', cc_period_end: '2026-07-14' },
    developers: [{ github_login: 'alice', cc_total_cost: 100, cc_requests: 5 },
                 { github_login: 'carol', cc_total_cost: 200, cc_requests: 9 }],
    timeline: [], spendWindow: {}, unmergedSummary: null,
    modelUsage: [
      // alice is a teammate; carol is not. zeta/alpha differ in cost vs name order.
      { github_login: 'alice', model: 'zeta-model', cost: 900, requests: 3 },
      { github_login: 'alice', model: 'alpha-model', cost: 100, requests: 7 },
      { github_login: 'carol', model: 'zeta-model', cost: 800, requests: 4 },
      { github_login: 'carol', model: 'alpha-model', cost: 50, requests: 1 },
    ],
    skillsUsage: [{ github_login: 'carol', product: 'cowork', skills_used: 3, skills_distinct: 2 }],
  });
  (buildCostVisibility as jest.Mock).mockResolvedValue({
    canSeeCost: (l: string) => l === 'alice', canSeeAnyCost: true,
  });
});

it('keeps per-model cost for a developer the requester can see', async () => {
  const body = await (await GET(req() as any, params as any)).json();
  const alice = body.modelUsage.filter((r: any) => r.github_login === 'alice');
  expect(alice).toEqual([
    { github_login: 'alice', model: 'zeta-model', cost: 900, requests: 3 },
    { github_login: 'alice', model: 'alpha-model', cost: 100, requests: 7 },
  ]);
});

it('strips cost AND requests for a developer the requester cannot see', async () => {
  const body = await (await GET(req() as any, params as any)).json();
  const carol = body.modelUsage.filter((r: any) => r.github_login === 'carol');
  expect(carol.map((r: any) => r.model)).toEqual(['alpha-model', 'zeta-model']); // name-ordered
  for (const r of carol) {
    expect(r).not.toHaveProperty('cost');
    expect(r).not.toHaveProperty('requests');
    expect(r.github_login).toBe('carol');
  }
});

it('never strips skillsUsage', async () => {
  const body = await (await GET(req() as any, params as any)).json();
  expect(body.skillsUsage).toEqual([
    { github_login: 'carol', product: 'cowork', skills_used: 3, skills_distinct: 2 },
  ]);
});

it('preserves per-login grouping and cost order in the merged array when multiple developers are visible', async () => {
  (buildCostVisibility as jest.Mock).mockResolvedValue({ canSeeCost: () => true, canSeeAnyCost: true });
  const body = await (await GET(req() as any, params as any)).json();
  expect(body.modelUsage.map((r: any) => `${r.github_login}:${r.model}`)).toEqual([
    'alice:zeta-model', 'alice:alpha-model', 'carol:zeta-model', 'carol:alpha-model',
  ]);
});

it('leak guard: no per-model cost for any developer when nothing is visible', async () => {
  (buildCostVisibility as jest.Mock).mockResolvedValue({ canSeeCost: () => false, canSeeAnyCost: false });
  const body = await (await GET(req() as any, params as any)).json();
  expect(body.modelUsage).toHaveLength(4);
  for (const r of body.modelUsage) {
    expect(r).not.toHaveProperty('cost');
    expect(r).not.toHaveProperty('requests');
  }
});
