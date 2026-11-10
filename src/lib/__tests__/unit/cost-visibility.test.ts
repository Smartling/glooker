jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));
jest.mock('@/lib/db/index', () => ({ __esModule: true, default: { execute: jest.fn() } }));

import { resolveRequester, buildCostVisibility, stripDevCost, stripCostFields } from '@/lib/cost-visibility';
import db from '@/lib/db/index';

const mockExecute = db.execute as jest.Mock;
const origEnv = { ...process.env };
beforeEach(() => { 
  mockExecute.mockReset(); 
  process.env = { ...origEnv };
  // Ensure NODE_ENV is not 'production' so AUTH_TEST_USER works
  delete (process.env as any).NODE_ENV;
});
afterAll(() => { process.env = origEnv; });

/**
 * Identity is injected through the AUTH_TEST_USER path rather than a header.
 * These cases are about resolveRequester's org-scoped mapping lookup and the
 * cost predicates; token signature verification is covered in auth.test.ts.
 * The previous helper built an UNSIGNED token and relied on it being accepted,
 * which is exactly the behaviour that has been removed.
 */
function asUser(email: string, opts: { admin?: boolean } = {}): Headers {
  process.env.AUTH_TEST_USER = opts.admin ? 'admin' : 'viewer';
  process.env.AUTH_TEST_EMAIL = email;
  return new Headers();
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
    const headers = asUser('a@x.com', { admin: true });
    mockExecute.mockResolvedValueOnce([[{ github_login: 'alice' }], null]);
    const r = await resolveRequester(headers);
    expect(r).toEqual({ githubLogin: 'alice', isAdmin: true, authDisabled: false });
  });

  it('mapped non-admin', async () => {
    process.env.AUTH_ENABLED = 'true';
    process.env.AUTH_ADMIN_GROUP = 'glooker-admin';
    mockExecute.mockResolvedValueOnce([[{ github_login: 'bob' }], null]);
    const r = await resolveRequester(asUser('bob@x.com'));
    expect(r).toEqual({ githubLogin: 'bob', isAdmin: false, authDisabled: false });
  });

  it('scopes the mapping lookup to org when one is supplied', async () => {
    process.env.AUTH_ENABLED = 'true';
    mockExecute.mockResolvedValueOnce([[{ github_login: 'bob' }], null]);
    await resolveRequester(asUser('bob@x.com'), 'acme');
    const [sql, params] = mockExecute.mock.calls[0];
    expect(sql).toMatch(/org = \?/);
    expect(params).toEqual(['bob@x.com', 'acme']);
  });
});

describe('buildCostVisibility', () => {
  // Flat team_members ⋈ teams rows (one row per membership).
  const teamRows = [
    { github_login: 'alice', team_id: 't1' },
    { github_login: 'bob',   team_id: 't1' },
    { github_login: 'carol', team_id: 't2' },
  ];

  it('admin sees all without querying team membership', async () => {
    const v = await buildCostVisibility('acme', { githubLogin: 'x', isAdmin: true, authDisabled: false });
    expect(v.canSeeAnyCost).toBe(true);
    expect(v.canSeeCost('anyone')).toBe(true);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('authDisabled sees all without querying', async () => {
    const v = await buildCostVisibility('acme', { githubLogin: null, isAdmin: false, authDisabled: true });
    expect(v.canSeeCost('anyone')).toBe(true);
    expect(v.canSeeAnyCost).toBe(true);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('unmapped requester sees nothing (no query)', async () => {
    const v = await buildCostVisibility('acme', { githubLogin: null, isAdmin: false, authDisabled: false });
    expect(v.canSeeAnyCost).toBe(false);
    expect(v.canSeeCost('alice')).toBe(false);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('team member sees own-team devs and self, not other teams', async () => {
    mockExecute.mockResolvedValueOnce([[{ github_login: 'alice' }], null]); // mapping check
    mockExecute.mockResolvedValueOnce([teamRows, null]); // team membership
    const v = await buildCostVisibility('acme', { githubLogin: 'alice', isAdmin: false, authDisabled: false });
    expect(v.canSeeAnyCost).toBe(true);
    expect(v.canSeeCost('alice')).toBe(true);  // self
    expect(v.canSeeCost('bob')).toBe(true);     // same team t1
    expect(v.canSeeCost('carol')).toBe(false);  // team t2
  });

  it('matches logins case-insensitively', async () => {
    mockExecute.mockResolvedValueOnce([[{ github_login: 'ALICE' }], null]); // mapping check
    mockExecute.mockResolvedValueOnce([teamRows, null]); // team membership
    const v = await buildCostVisibility('acme', { githubLogin: 'ALICE', isAdmin: false, authDisabled: false });
    expect(v.canSeeCost('Bob')).toBe(true);     // Bob shares t1 with ALICE
    expect(v.canSeeCost('CAROL')).toBe(false);
  });

  it('mapped team-less requester sees only their own cost', async () => {
    mockExecute.mockResolvedValueOnce([[{ github_login: 'dave' }], null]); // mapping check
    mockExecute.mockResolvedValueOnce([teamRows, null]); // team membership
    const v = await buildCostVisibility('acme', { githubLogin: 'dave', isAdmin: false, authDisabled: false });
    expect(v.canSeeAnyCost).toBe(true);         // can always see self
    expect(v.canSeeCost('dave')).toBe(true);    // self
    expect(v.canSeeCost('alice')).toBe(false);  // no shared team
  });

  it('requester not mapped in target org sees nothing', async () => {
    mockExecute.mockResolvedValueOnce([[], null]); // no mapping in this org
    const v = await buildCostVisibility('acme', { githubLogin: 'eve', isAdmin: false, authDisabled: false });
    expect(v.canSeeAnyCost).toBe(false);
    expect(v.canSeeCost('alice')).toBe(false);
    expect(v.canSeeCost('eve')).toBe(false);
    // Should not query team membership after failing the mapping check
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });

  // --- Cross-organization authorization boundary tests (pentest finding) -----
  // The vulnerability: resolveRequester without an org performs a global lookup
  // that can return a login from organization A, then buildCostVisibility for
  // organization B would accept that login via self-login or shared-team checks
  // without validating the mapping exists in org B. The fix adds an org-scoped
  // mapping validation in buildCostVisibility before granting any visibility.

  it('SECURITY: login from org A cannot see costs in org B via self-login check', async () => {
    // Scenario: user mapped as 'eve' in org 'widgets', tries to access report
    // in org 'acme' where a developer named 'eve' exists but the requester has
    // no mapping. The self-login check (dev === requesterLogin) would pass if
    // we didn't validate the mapping in the target org first.
    mockExecute.mockResolvedValueOnce([[], null]); // no mapping for 'eve' in 'acme'
    const v = await buildCostVisibility('acme', { githubLogin: 'eve', isAdmin: false, authDisabled: false });
    
    // Must not see any costs, including their own login name in the target org
    expect(v.canSeeAnyCost).toBe(false);
    expect(v.canSeeCost('eve')).toBe(false);
    expect(v.canSeeCost('alice')).toBe(false);
    
    // Verify the mapping check query was made with the correct org
    expect(mockExecute).toHaveBeenCalledTimes(1);
    const [sql, params] = mockExecute.mock.calls[0];
    expect(sql).toMatch(/SELECT.*FROM user_mappings/i);
    expect(sql).toMatch(/LOWER\(github_login\)/i);
    expect(sql).toMatch(/org = \?/);
    expect(params).toEqual(['eve', 'acme']);
  });

  it('SECURITY: login from org A cannot see costs in org B via shared-team check', async () => {
    // Scenario: user mapped as 'frank' in org 'widgets', tries to access report
    // in org 'acme'. In 'acme', there's a team with 'frank' and 'alice', but the
    // requester's mapping is in 'widgets', not 'acme'. The shared-team check
    // would grant visibility to alice's costs if we didn't validate the mapping.
    mockExecute.mockResolvedValueOnce([[], null]); // no mapping for 'frank' in 'acme'
    const v = await buildCostVisibility('acme', { githubLogin: 'frank', isAdmin: false, authDisabled: false });
    
    expect(v.canSeeAnyCost).toBe(false);
    expect(v.canSeeCost('frank')).toBe(false);
    expect(v.canSeeCost('alice')).toBe(false);
    
    // Team membership query should NOT run after mapping check fails
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });

  it('SECURITY: validates mapping org-scoped even when login matches case-insensitively', async () => {
    // The mapping check uses LOWER() for case-insensitive comparison, ensuring
    // 'Alice' from org A cannot access 'alice' costs in org B
    mockExecute.mockResolvedValueOnce([[], null]); // no mapping for 'Alice' in 'acme'
    const v = await buildCostVisibility('acme', { githubLogin: 'Alice', isAdmin: false, authDisabled: false });
    
    expect(v.canSeeAnyCost).toBe(false);
    expect(v.canSeeCost('alice')).toBe(false);
    expect(v.canSeeCost('ALICE')).toBe(false);
    
    const [sql, params] = mockExecute.mock.calls[0];
    expect(sql).toMatch(/LOWER\(github_login\)/i);
    expect(params).toEqual(['Alice', 'acme']);
  });

  it('SECURITY: requester with valid mapping in target org proceeds to team checks', async () => {
    // Positive case: user IS mapped in the target org, so mapping check passes
    // and team membership is queried to determine visibility scope
    mockExecute.mockResolvedValueOnce([[{ github_login: 'alice' }], null]); // mapping exists
    mockExecute.mockResolvedValueOnce([teamRows, null]); // team membership
    
    const v = await buildCostVisibility('acme', { githubLogin: 'alice', isAdmin: false, authDisabled: false });
    
    expect(v.canSeeAnyCost).toBe(true);
    expect(v.canSeeCost('alice')).toBe(true);
    expect(v.canSeeCost('bob')).toBe(true); // shares team t1
    
    // Both queries should have run: mapping check + team membership
    expect(mockExecute).toHaveBeenCalledTimes(2);
  });

  it('SECURITY: mapping check query structure prevents SQL injection', async () => {
    // Verify the query uses parameterized values, not string concatenation
    mockExecute.mockResolvedValueOnce([[], null]);
    await buildCostVisibility('acme', { githubLogin: "eve' OR '1'='1", isAdmin: false, authDisabled: false });
    
    const [sql, params] = mockExecute.mock.calls[0];
    // SQL should have placeholders, not interpolated values
    expect(sql).toMatch(/\?/);
    expect(sql).not.toMatch(/eve.*OR/);
    // The malicious string should be in params, safely bound
    expect(params[0]).toBe("eve' OR '1'='1");
  });
});

describe('stripDevCost / stripCostFields', () => {
  it('drops cc fields for devs the predicate rejects, keeps for accepted', () => {
    const devs = [
      { github_login: 'alice', cc_total_cost: 100, cc_requests: 5, impact_score: 4 },
      { github_login: 'carol', cc_total_cost: 200, cc_requests: 9, impact_score: 3 },
    ];
    const out = stripDevCost(devs, (l) => l === 'alice');
    expect(out[0]).toEqual({ github_login: 'alice', cc_total_cost: 100, cc_requests: 5, impact_score: 4 });
    expect(out[1]).toEqual({ github_login: 'carol', impact_score: 3 });
    expect('cc_total_cost' in out[1]).toBe(false);
    expect('cc_requests' in out[1]).toBe(false);
  });

  it('stripCostFields removes both cc fields from a single object', () => {
    const out = stripCostFields({ github_login: 'x', cc_total_cost: 1, cc_requests: 2, impact_score: 7 });
    expect(out).toEqual({ github_login: 'x', impact_score: 7 });
  });
});
