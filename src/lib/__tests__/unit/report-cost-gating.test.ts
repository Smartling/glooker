jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));
jest.mock('@/lib/db/index', () => ({ __esModule: true, default: { execute: jest.fn() } }));
jest.mock('@/lib/report/service', () => ({
  getReport: jest.fn(), deleteReport: jest.fn(),
  ReportNotFoundError: class ReportNotFoundError extends Error {},
}));
jest.mock('@/lib/report/dev', () => ({
  getDevReport: jest.fn(),
  DeveloperNotFoundError: class DeveloperNotFoundError extends Error {},
}));
jest.mock('@/lib/report/org', () => ({
  getOrgReport: jest.fn(),
}));
jest.mock('@/lib/cost-visibility', () => ({
  resolveRequester: jest.fn(),
  buildCostVisibility: jest.fn(),
  stripDevCost: jest.requireActual('@/lib/cost-visibility').stripDevCost,
  stripCostFields: jest.requireActual('@/lib/cost-visibility').stripCostFields,
  stripModelCost: jest.requireActual('@/lib/cost-visibility').stripModelCost,
  gateModelRowsByLogin: jest.requireActual('@/lib/cost-visibility').gateModelRowsByLogin,
  costCacheHeaders: jest.requireActual('@/lib/cost-visibility').costCacheHeaders,
}));

import { GET as reportGET } from '@/app/api/report/[id]/route';
import { GET as devGET } from '@/app/api/report/[id]/dev/[login]/route';
import { GET as orgGET } from '@/app/api/report/[id]/org/route';
import { getReport } from '@/lib/report/service';
import { getDevReport } from '@/lib/report/dev';
import { getOrgReport } from '@/lib/report/org';
import { resolveRequester, buildCostVisibility } from '@/lib/cost-visibility';

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const devParams = (id: string, login: string) => ({ params: Promise.resolve({ id, login }) });
const req = () => new Request('http://localhost/api/report/r1');

beforeEach(() => jest.clearAllMocks());

describe('report/[id] route', () => {
  it('strips cost for devs the requester cannot see', async () => {
    (getReport as jest.Mock).mockResolvedValue({
      report: { id: 'r1', org: 'acme' },
      developers: [
        { github_login: 'alice', cc_total_cost: 10, cc_requests: 1 },
        { github_login: 'carol', cc_total_cost: 20, cc_requests: 2 },
      ],
    });
    (resolveRequester as jest.Mock).mockResolvedValue({ githubLogin: 'alice', isAdmin: false, authDisabled: false });
    (buildCostVisibility as jest.Mock).mockResolvedValue({ canSeeCost: (l: string) => l === 'alice', canSeeAnyCost: true });

    const res = await reportGET(req() as any, params('r1') as any);
    const body = await res.json();
    expect(body.developers[0]).toHaveProperty('cc_total_cost', 10);
    expect(body.developers[1]).not.toHaveProperty('cc_total_cost');
    expect(body.developers[1]).not.toHaveProperty('cc_requests');
    expect(buildCostVisibility).toHaveBeenCalledWith('acme', expect.objectContaining({ githubLogin: 'alice' }));
  });

  it('keeps cost for all devs when requester is admin', async () => {
    (getReport as jest.Mock).mockResolvedValue({
      report: { id: 'r1', org: 'acme' },
      developers: [
        { github_login: 'alice', cc_total_cost: 10, cc_requests: 1 },
        { github_login: 'carol', cc_total_cost: 20, cc_requests: 2 },
      ],
    });
    (resolveRequester as jest.Mock).mockResolvedValue({ githubLogin: 'bob', isAdmin: true, authDisabled: false });
    (buildCostVisibility as jest.Mock).mockResolvedValue({ canSeeCost: () => true, canSeeAnyCost: true });

    const res = await reportGET(req() as any, params('r1') as any);
    const body = await res.json();
    expect(body.developers[0]).toHaveProperty('cc_total_cost', 10);
    expect(body.developers[1]).toHaveProperty('cc_total_cost', 20);
  });
});

describe('report/[id]/dev/[login] route', () => {
  it('strips cost on developer and allDevelopers by predicate', async () => {
    (getDevReport as jest.Mock).mockResolvedValue({
      report: { id: 'r1', org: 'acme' },
      developer: { github_login: 'carol', cc_total_cost: 20, cc_requests: 2 },
      allDevelopers: [
        { github_login: 'alice', cc_total_cost: 10, cc_requests: 1 },
        { github_login: 'carol', cc_total_cost: 20, cc_requests: 2 },
      ],
    });
    (resolveRequester as jest.Mock).mockResolvedValue({ githubLogin: 'alice', isAdmin: false, authDisabled: false });
    (buildCostVisibility as jest.Mock).mockResolvedValue({ canSeeCost: (l: string) => l === 'alice', canSeeAnyCost: true });

    const res = await devGET(req() as any, devParams('r1', 'carol') as any);
    const body = await res.json();
    expect(body.developer).not.toHaveProperty('cc_total_cost');
    expect(body.developer).not.toHaveProperty('cc_requests');
    expect(body.allDevelopers[0]).toHaveProperty('cc_total_cost', 10);
    expect(body.allDevelopers[1]).not.toHaveProperty('cc_total_cost');
    expect(buildCostVisibility).toHaveBeenCalledWith('acme', expect.objectContaining({ githubLogin: 'alice' }));
  });

  it('keeps cost when requester can see the developer', async () => {
    (getDevReport as jest.Mock).mockResolvedValue({
      report: { id: 'r1', org: 'acme' },
      developer: { github_login: 'alice', cc_total_cost: 10, cc_requests: 1 },
      allDevelopers: [
        { github_login: 'alice', cc_total_cost: 10, cc_requests: 1 },
      ],
    });
    (resolveRequester as jest.Mock).mockResolvedValue({ githubLogin: 'alice', isAdmin: false, authDisabled: false });
    (buildCostVisibility as jest.Mock).mockResolvedValue({ canSeeCost: () => true, canSeeAnyCost: true });

    const res = await devGET(req() as any, devParams('r1', 'alice') as any);
    const body = await res.json();
    expect(body.developer).toHaveProperty('cc_total_cost', 10);
  });
});

describe('report/[id]/org route', () => {
  it('strips developer cost and report-level spend window when canSeeAnyCost is false', async () => {
    (getOrgReport as jest.Mock).mockResolvedValue({
      report: { id: 'r1', org: 'acme', cc_period_start: '2026-01-01', cc_period_end: '2026-01-31' },
      developers: [
        { github_login: 'alice', cc_total_cost: 10, cc_requests: 1 },
      ],
    });
    (resolveRequester as jest.Mock).mockResolvedValue({ githubLogin: 'dave', isAdmin: false, authDisabled: false });
    (buildCostVisibility as jest.Mock).mockResolvedValue({ canSeeCost: () => false, canSeeAnyCost: false });

    const res = await orgGET(req() as any, params('r1') as any);
    const body = await res.json();
    expect(body.developers[0]).not.toHaveProperty('cc_total_cost');
    expect(body.report).not.toHaveProperty('cc_period_start');
    expect(body.report).not.toHaveProperty('cc_period_end');
    expect(body.spendWindow).toBeNull();
  });

  it('keeps developer cost and report-level spend window when canSeeAnyCost is true', async () => {
    (getOrgReport as jest.Mock).mockResolvedValue({
      report: { id: 'r1', org: 'acme', cc_period_start: '2026-01-01', cc_period_end: '2026-01-31' },
      developers: [
        { github_login: 'alice', cc_total_cost: 10, cc_requests: 1 },
      ],
    });
    (resolveRequester as jest.Mock).mockResolvedValue({ githubLogin: 'alice', isAdmin: false, authDisabled: false });
    (buildCostVisibility as jest.Mock).mockResolvedValue({ canSeeCost: () => true, canSeeAnyCost: true });

    const res = await orgGET(req() as any, params('r1') as any);
    const body = await res.json();
    expect(body.developers[0]).toHaveProperty('cc_total_cost', 10);
    expect(body.report).toHaveProperty('cc_period_start', '2026-01-01');
    expect(body.report).toHaveProperty('cc_period_end', '2026-01-31');
  });
});
