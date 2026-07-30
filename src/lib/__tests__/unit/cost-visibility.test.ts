jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));
jest.mock('@/lib/db/index', () => ({ __esModule: true, default: { execute: jest.fn() } }));
jest.mock('@/lib/teams/service', () => ({ listTeams: jest.fn() }));

import { resolveRequester, buildCostVisibility, stripDevCost } from '@/lib/cost-visibility';
import db from '@/lib/db/index';
import { listTeams } from '@/lib/teams/service';

const mockExecute = db.execute as jest.Mock;
const mockListTeams = listTeams as jest.Mock;
const origEnv = { ...process.env };
beforeEach(() => { mockExecute.mockReset(); mockListTeams.mockReset(); process.env = { ...origEnv }; });
afterAll(() => { process.env = origEnv; });

function headersWithEmail(email: string): Headers {
  // AUTH_HEADER default x-amzn-oidc-data: unsigned JWT whose payload has `email`.
  const payload = Buffer.from(JSON.stringify({ email, sub: email })).toString('base64');
  return new Headers({ 'x-amzn-oidc-data': `h.${payload}.` });
}

describe('resolveRequester', () => {
  it('authDisabled when AUTH_ENABLED is not true', async () => {
    delete process.env.AUTH_ENABLED;
    const r = await resolveRequester(new Headers());
    expect(r).toEqual({ githubLogin: null, isAdmin: false, authDisabled: true });
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('no identity header (auth on) → not admin, no login, not authDisabled', async () => {
    process.env.AUTH_ENABLED = 'true';
    const r = await resolveRequester(new Headers());
    expect(r).toEqual({ githubLogin: null, isAdmin: false, authDisabled: false });
  });

  it('maps email → github_login and reads admin group membership', async () => {
    process.env.AUTH_ENABLED = 'true';
    process.env.AUTH_ADMIN_GROUP = 'glooker-admin';
    // extractUser reads groups from the JWT payload; put the admin group in it.
    const payload = Buffer.from(JSON.stringify({ email: 'a@x.com', sub: 'a@x.com', groups: ['glooker-admin'] })).toString('base64');
    const headers = new Headers({ 'x-amzn-oidc-data': `h.${payload}.` });
    mockExecute.mockResolvedValueOnce([[{ github_login: 'alice' }], null]);
    const r = await resolveRequester(headers);
    expect(r).toEqual({ githubLogin: 'alice', isAdmin: true, authDisabled: false });
  });

  it('mapped non-admin', async () => {
    process.env.AUTH_ENABLED = 'true';
    process.env.AUTH_ADMIN_GROUP = 'glooker-admin';
    mockExecute.mockResolvedValueOnce([[{ github_login: 'bob' }], null]);
    const r = await resolveRequester(headersWithEmail('bob@x.com'));
    expect(r).toEqual({ githubLogin: 'bob', isAdmin: false, authDisabled: false });
  });
});

describe('buildCostVisibility', () => {
  const teams = [
    { id: 't1', members: ['alice', 'bob'] },
    { id: 't2', members: ['carol'] },
  ];

  it('admin sees all without hitting listTeams', async () => {
    const v = await buildCostVisibility('acme', { githubLogin: 'x', isAdmin: true, authDisabled: false });
    expect(v.canSeeAnyCost).toBe(true);
    expect(v.canSeeCost('anyone')).toBe(true);
    expect(mockListTeams).not.toHaveBeenCalled();
  });

  it('authDisabled sees all', async () => {
    const v = await buildCostVisibility('acme', { githubLogin: null, isAdmin: false, authDisabled: true });
    expect(v.canSeeCost('anyone')).toBe(true);
    expect(v.canSeeAnyCost).toBe(true);
  });

  it('unmapped requester sees nothing', async () => {
    const v = await buildCostVisibility('acme', { githubLogin: null, isAdmin: false, authDisabled: false });
    expect(v.canSeeAnyCost).toBe(false);
    expect(v.canSeeCost('alice')).toBe(false);
  });

  it('team member sees own-team devs, not other teams', async () => {
    mockListTeams.mockResolvedValueOnce(teams);
    const v = await buildCostVisibility('acme', { githubLogin: 'alice', isAdmin: false, authDisabled: false });
    expect(v.canSeeAnyCost).toBe(true);
    expect(v.canSeeCost('alice')).toBe(true);  // self
    expect(v.canSeeCost('bob')).toBe(true);     // same team t1
    expect(v.canSeeCost('carol')).toBe(false);  // team t2
  });

  it('mapped but team-less requester sees nothing', async () => {
    mockListTeams.mockResolvedValueOnce(teams);
    const v = await buildCostVisibility('acme', { githubLogin: 'dave', isAdmin: false, authDisabled: false });
    expect(v.canSeeAnyCost).toBe(false);
    expect(v.canSeeCost('alice')).toBe(false);
  });
});

describe('stripDevCost', () => {
  it('drops cc fields for devs the predicate rejects, keeps for accepted', () => {
    const devs = [
      { github_login: 'alice', cc_total_cost: 100, cc_requests: 5, impact_score: 4 },
      { github_login: 'carol', cc_total_cost: 200, cc_requests: 9, impact_score: 3 },
    ];
    const out = stripDevCost(devs, (l) => l === 'alice');
    expect(out[0]).toEqual({ github_login: 'alice', cc_total_cost: 100, cc_requests: 5, impact_score: 4 });
    expect(out[1]).toEqual({ github_login: 'carol', impact_score: 3 });
    expect('cc_total_cost' in out[1]).toBe(false);
  });
});
