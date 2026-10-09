jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));
jest.mock('@/lib/db/index', () => ({ __esModule: true, default: { execute: jest.fn() } }));
jest.mock('@/lib/report-runner', () => ({ runReport: jest.fn().mockResolvedValue(undefined), requestStop: jest.fn() }));

import { queryDeveloperStats, queryModelUsage, querySkillsUsage, MAX_ROWS } from '@/lib/mcp/queries';
import db from '@/lib/db/index';

const mockExecute = db.execute as jest.Mock;
beforeEach(() => { mockExecute.mockReset(); });

const DEV_ROWS = [
  { github_login: 'alice', impact_score: '4', cc_total_cost: '10', cc_requests: '1' },
  { github_login: 'carol', impact_score: '3', cc_total_cost: '20', cc_requests: '2' },
];

// Execute order in queryDeveloperStats: resolveReportId → developer_stats SELECT
// → (team-scoped path only) reportOrg → (team-scoped path only) flat team query.
function mockResolveAndDevs() {
  mockExecute
    .mockResolvedValueOnce([[{ id: 'r1' }], null])   // resolveReportId
    .mockResolvedValueOnce([DEV_ROWS, null]);         // developer_stats rows
}

it('strips cc for non-teammates when requester is a non-admin team member', async () => {
  mockResolveAndDevs();
  mockExecute
    .mockResolvedValueOnce([[{ org: 'acme' }], null])                     // reportOrg
    .mockResolvedValueOnce([[{ github_login: 'alice' }], null])           // mapping check
    .mockResolvedValueOnce([[                                             // flat team_members ⋈ teams
      { github_login: 'alice', team_id: 't1' },
      { github_login: 'carol', team_id: 't2' },
    ], null]);
  const out = await queryDeveloperStats({ report_id: 'r1' }, { githubLogin: 'alice', isAdmin: false, authDisabled: false }) as any;
  const alice = out.developers.find((d: any) => d.github_login === 'alice');
  const carol = out.developers.find((d: any) => d.github_login === 'carol');
  expect(alice.cc_total_cost).toBe(10);
  expect('cc_total_cost' in carol).toBe(false);
});

it('strips ALL cc when no requester is provided (safe default, no org lookup)', async () => {
  mockResolveAndDevs();
  const out = await queryDeveloperStats({ report_id: 'r1' }) as any;
  expect(out.developers.every((d: any) => !('cc_total_cost' in d))).toBe(true);
  // reportOrg / team query must NOT run on the fail-closed path.
  expect(mockExecute).toHaveBeenCalledTimes(2);
});

it('admin keeps all cc without an org lookup', async () => {
  mockResolveAndDevs();
  const out = await queryDeveloperStats({ report_id: 'r1' }, { githubLogin: 'x', isAdmin: true, authDisabled: false }) as any;
  expect(out.developers.every((d: any) => 'cc_total_cost' in d)).toBe(true);
  expect(mockExecute).toHaveBeenCalledTimes(2);
});

// --- query_model_usage (GLOOK-37) -----------------------------------------
// Cost AND requests are gated, and a hidden developer's rows are dropped rather
// than blanked, so amounts and model mix are both withheld. Visibility is
// resolved before the data query, so the execute order is:
//   resolveReportId → [reportOrg → team query] → cc_model_usage SELECT
// with the bracketed pair present only on the team-scoped path.

// DECIMAL/BIGINT come back as strings from both drivers — see the CLAUDE.md
// gotcha. cost is cents, surfaced as cost_cents.
const MODEL_ROWS = [
  { github_login: 'alice', model: 'opus', cost: '1250', requests: '7' },
  { github_login: 'carol', model: 'opus', cost: '9900', requests: '11' },
  { github_login: 'carol', model: 'sonnet', cost: '100', requests: '2' },
];

const mockResolve = () => mockExecute.mockResolvedValueOnce([[{ id: 'r1' }], null]);
const mockRows = (rows: any[]) => mockExecute.mockResolvedValueOnce([rows, null]);

// alice on t1, carol on t2 — so a requester of alice cannot see carol.
function mockTeamSplit() {
  mockExecute
    .mockResolvedValueOnce([[{ org: 'acme' }], null])
    .mockResolvedValueOnce([[{ github_login: 'alice' }], null])  // mapping check
    .mockResolvedValueOnce([[
      { github_login: 'alice', team_id: 't1' },
      { github_login: 'carol', team_id: 't2' },
    ], null]);
}

const ALICE = { githubLogin: 'alice', isAdmin: false, authDisabled: false };
const ADMIN = { githubLogin: 'x', isAdmin: true, authDisabled: false };

it('model usage: keeps a teammate, omits a non-teammate entirely, reports cents', async () => {
  mockResolve(); mockTeamSplit(); mockRows(MODEL_ROWS);
  const out = await queryModelUsage({ report_id: 'r1' }, ALICE) as any;

  // Exact-value toEqual also pins the cents field name and the string→number
  // coercion, so neither needs its own test.
  expect(out.models).toEqual([{ github_login: 'alice', model: 'opus', cost_cents: 1250, requests: 7 }]);
  expect(out.count).toBe(1);
  expect(out.cost_visible).toBe(true);
});

it('model usage: no requester yields no rows AND no data read at all', async () => {
  mockResolve();
  const out = await queryModelUsage({ report_id: 'r1' }) as any;
  expect(out).toEqual({ models: [], count: 0, truncated: false, cost_visible: false });
  // Only resolveReportId ran: visibility is resolved first, so a caller
  // entitled to nothing costs us neither an org lookup nor a table scan.
  expect(mockExecute).toHaveBeenCalledTimes(1);
});

it('model usage: distinguishes "you may see no costs" from "no usage recorded"', async () => {
  // An authenticated user with no user_mappings row — CLAUDE.md documents this
  // population (Jira instances that hide emails break auto-discovery).
  mockResolve();
  mockExecute.mockResolvedValueOnce([[{ org: 'acme' }], null]); // reportOrg
  const out = await queryModelUsage({ report_id: 'r1' }, { githubLogin: null as any, isAdmin: false, authDisabled: false }) as any;
  expect(out.models).toEqual([]);
  // The flag is the whole point: without it an agent reports "no usage exists".
  expect(out.cost_visible).toBe(false);
});

it('model usage: admin sees every developer, and does no org lookup', async () => {
  mockResolve(); mockRows(MODEL_ROWS);
  const out = await queryModelUsage({ report_id: 'r1' }, ADMIN) as any;
  expect(out.models).toHaveLength(3);
  expect(out.truncated).toBe(false);
  expect(mockExecute).toHaveBeenCalledTimes(2);
});

// The critical finding from the PR #65 review. stripModelCost drops rows, so a
// LIMIT applied in SQL would spend the row budget on rows that are then deleted.
it('model usage: the caller limit applies AFTER gating, so entitled rows stay reachable', async () => {
  // 3 hidden carol rows sort before dave. Under a pre-gating LIMIT of 2 the SQL
  // would return only carol rows and dave — the requester — would see nothing.
  const rows = [
    { github_login: 'carol', model: 'a', cost: '1', requests: '1' },
    { github_login: 'carol', model: 'b', cost: '1', requests: '1' },
    { github_login: 'carol', model: 'c', cost: '1', requests: '1' },
    { github_login: 'dave', model: 'd', cost: '500', requests: '5' },
  ];
  mockResolve();
  mockExecute
    .mockResolvedValueOnce([[{ org: 'acme' }], null])
    .mockResolvedValueOnce([[{ github_login: 'dave' }], null])  // mapping check
    .mockResolvedValueOnce([[{ github_login: 'carol', team_id: 't2' }, { github_login: 'dave', team_id: 't3' }], null]);
  mockRows(rows);

  const out = await queryModelUsage({ report_id: 'r1', limit: 2 }, { githubLogin: 'dave', isAdmin: false, authDisabled: false }) as any;
  // cost-visibility.ts guarantees own cost is always visible; that guarantee
  // only holds if gating precedes the slice.
  expect(out.models).toEqual([{ github_login: 'dave', model: 'd', cost_cents: 500, requests: 5 }]);
  expect(out.count).toBe(1);
});

it('model usage: count tracks visible rows only, so varying limit is not an oracle', async () => {
  // Sweeping limit must yield min(visible, limit) — a clean ramp that reveals
  // only the visible count, never the ordinal positions of hidden rows.
  for (const [limit, expected] of [[1, 1], [2, 1], [3, 1]] as const) {
    mockExecute.mockReset();
    mockResolve(); mockTeamSplit(); mockRows(MODEL_ROWS);
    const out = await queryModelUsage({ report_id: 'r1', limit }, ALICE) as any;
    expect(out.count).toBe(expected);
  }
});

it('model usage: flags truncation when the fetch hits MAX_ROWS', async () => {
  const many = Array.from({ length: MAX_ROWS }, (_, i) => ({
    github_login: `dev${String(i).padStart(4, '0')}`, model: 'opus', cost: '1', requests: '1',
  }));
  mockResolve(); mockRows(many);
  const out = await queryModelUsage({ report_id: 'r1', limit: 5 }, ADMIN) as any;
  expect(out.truncated).toBe(true);
  expect(out.models).toHaveLength(5);
});

// --- query_skills_usage (GLOOK-37) ----------------------------------------
// Deliberately ungated: skill counts convert to no currency, so they sum to no
// gated figure. querySkillsUsage takes no requester at all.

const SKILL_ROWS = [
  { github_login: 'alice', product: 'claude_code', skills_used: '5', skills_distinct: '2' },
  { github_login: 'carol', product: 'chat', skills_used: '3', skills_distinct: '1' },
];

it('skills usage: returns every developer with no requester, and never gates', async () => {
  mockResolve(); mockRows(SKILL_ROWS);
  const out = await querySkillsUsage({ report_id: 'r1' }) as any;

  expect(out.skills).toEqual([
    { github_login: 'alice', product: 'claude_code', skills_used: 5, skills_distinct: 2 },
    { github_login: 'carol', product: 'chat', skills_used: 3, skills_distinct: 1 },
  ]);
  expect(out.truncated).toBe(false);
  // No reportOrg / team lookup on any path — there is nothing to gate.
  expect(mockExecute).toHaveBeenCalledTimes(2);
});

it('skills usage: flags truncation rather than reporting an alphabetical prefix as the whole org', async () => {
  const many = Array.from({ length: MAX_ROWS }, (_, i) => ({
    github_login: `dev${String(i).padStart(4, '0')}`, product: 'chat', skills_used: '1', skills_distinct: '1',
  }));
  mockResolve(); mockRows(many);
  const out = await querySkillsUsage({ report_id: 'r1', limit: 3 }) as any;
  expect(out.truncated).toBe(true);
  expect(out.skills).toHaveLength(3);
});

// --- SQL invariants -------------------------------------------------------
// db.execute is mocked and returns fixed rows regardless of SQL, so nothing
// above would fail if the INNER JOIN or the LOWER()s were deleted. That join is
// what stops these tools reporting a wider population than query_developer_stats
// lists — the discrepancy that shipped once already (see report/org.ts). Pinned
// at the text level, mirroring org-model-usage.test.ts.

it('scopes both breakdown queries to this report\'s developers via INNER JOIN developer_stats', async () => {
  mockResolve(); mockRows(MODEL_ROWS);
  await queryModelUsage({ report_id: 'r1' }, ADMIN);
  const modelSql = String(mockExecute.mock.calls.find(c => /FROM cc_model_usage/.test(String(c[0])))![0]);

  mockExecute.mockReset();
  mockResolve(); mockRows(SKILL_ROWS);
  await querySkillsUsage({ report_id: 'r1' });
  const skillsSql = String(mockExecute.mock.calls.find(c => /FROM cc_skills_usage/.test(String(c[0])))![0]);

  for (const [sql, table] of [[modelSql, 'cc_model_usage'], [skillsSql, 'cc_skills_usage']] as const) {
    expect(sql).toMatch(/INNER JOIN developer_stats\s+d\b/);
    expect(sql).toMatch(new RegExp(`d\\.report_id\\s*=\\s*${table}\\.report_id`));
    expect(sql).toMatch(new RegExp(`LOWER\\(d\\.github_login\\)\\s*=\\s*LOWER\\(${table}\\.github_login\\)`));
  }
});

it('matches the login filter case-insensitively, as both tool descriptions claim', async () => {
  mockResolve(); mockRows(MODEL_ROWS);
  await queryModelUsage({ report_id: 'r1', login: 'Alice' }, ADMIN);
  const call = mockExecute.mock.calls.find(c => /FROM cc_model_usage/.test(String(c[0])))!;
  expect(String(call[0])).toMatch(/LOWER\(cc_model_usage\.github_login\)\s*=\s*LOWER\(\?\)/);
  expect(call[1]).toContain('Alice'); // passed through unfolded; SQL does the folding
});

it('binds MAX_ROWS in SQL rather than the caller limit, on both queries', async () => {
  mockResolve(); mockRows(MODEL_ROWS);
  await queryModelUsage({ report_id: 'r1', limit: 3 }, ADMIN);
  const modelParams = mockExecute.mock.calls.find(c => /FROM cc_model_usage/.test(String(c[0])))![1];

  mockExecute.mockReset();
  mockResolve(); mockRows(SKILL_ROWS);
  await querySkillsUsage({ report_id: 'r1', limit: 3 });
  const skillsParams = mockExecute.mock.calls.find(c => /FROM cc_skills_usage/.test(String(c[0])))![1];

  // A caller limit reaching the LIMIT clause is the critical defect this PR
  // fixed; assert the bound value is the cap, never args.limit.
  for (const params of [modelParams, skillsParams]) {
    expect(params[params.length - 1]).toBe(String(MAX_ROWS));
    expect(params).not.toContain('3');
  }
});

// --- Cross-organization authorization tests (pentest finding) -----------------
// The vulnerability: MCP route calls resolveRequester without an org, which
// performs a global email→login lookup. The login is then passed to
// buildCostVisibility for the report's org, where it would pass self-login or
// shared-team checks without validating the mapping exists in that org. A user
// mapped only in org A could thus access cost data from org B.
//
// The fix: buildCostVisibility now validates the requester's login is mapped in
// the target org before granting any visibility. These tests verify the exploit
// is blocked at the query layer where cost data is actually gated.

it('SECURITY: queryDeveloperStats blocks cross-org access via unmapped requester', async () => {
  // Scenario: user 'eve' is mapped in org 'widgets', requests developer stats
  // for a report in org 'acme'. The report has a developer named 'eve', but the
  // requester has no mapping in 'acme'. Without the fix, the self-login check
  // would grant visibility to eve's costs in acme.
  mockResolveAndDevs();
  mockExecute
    .mockResolvedValueOnce([[{ org: 'acme' }], null])  // reportOrg
    .mockResolvedValueOnce([[], null]);                 // mapping check: no mapping for 'eve' in 'acme'
  
  const out = await queryDeveloperStats(
    { report_id: 'r1' },
    { githubLogin: 'eve', isAdmin: false, authDisabled: false }
  ) as any;
  
  // All cost fields must be stripped from all developers
  expect(out.developers.every((d: any) => !('cc_total_cost' in d))).toBe(true);
  expect(out.developers.every((d: any) => !('cc_requests' in d))).toBe(true);
  
  // Team membership query should NOT run after mapping check fails
  const calls = mockExecute.mock.calls.map(c => String(c[0]));
  expect(calls.some(s => /team_members/.test(s))).toBe(false);
});

it('SECURITY: queryModelUsage blocks cross-org access via unmapped requester', async () => {
  // Same scenario for model usage: user from org A tries to access org B's data
  mockResolve();
  mockExecute
    .mockResolvedValueOnce([[{ org: 'acme' }], null])  // reportOrg
    .mockResolvedValueOnce([[], null]);                 // mapping check fails
  
  const out = await queryModelUsage(
    { report_id: 'r1' },
    { githubLogin: 'eve', isAdmin: false, authDisabled: false }
  ) as any;
  
  // No cost visibility at all
  expect(out.models).toEqual([]);
  expect(out.count).toBe(0);
  expect(out.cost_visible).toBe(false);
  
  // Data query should NOT run after visibility check fails
  const calls = mockExecute.mock.calls.map(c => String(c[0]));
  expect(calls.some(s => /cc_model_usage/.test(s))).toBe(false);
});

it('SECURITY: queryDeveloperStats allows same-org access with valid mapping', async () => {
  // Positive case: user IS mapped in the target org, so access is granted
  mockResolveAndDevs();
  mockExecute
    .mockResolvedValueOnce([[{ org: 'acme' }], null])                     // reportOrg
    .mockResolvedValueOnce([[{ github_login: 'alice' }], null])           // mapping check passes
    .mockResolvedValueOnce([[                                             // team membership
      { github_login: 'alice', team_id: 't1' },
      { github_login: 'carol', team_id: 't2' },
    ], null]);
  
  const out = await queryDeveloperStats(
    { report_id: 'r1' },
    { githubLogin: 'alice', isAdmin: false, authDisabled: false }
  ) as any;
  
  const alice = out.developers.find((d: any) => d.github_login === 'alice');
  expect(alice.cc_total_cost).toBe(10); // can see own cost
  
  // Mapping check should have been performed with correct org
  const mappingCall = mockExecute.mock.calls.find(c => 
    String(c[0]).includes('user_mappings') && String(c[0]).includes('org = ?')
  );
  expect(mappingCall).toBeDefined();
  expect(mappingCall![1]).toEqual(['alice', 'acme']);
});

it('SECURITY: queryModelUsage allows same-org access with valid mapping', async () => {
  mockResolve();
  mockExecute
    .mockResolvedValueOnce([[{ org: 'acme' }], null])           // reportOrg
    .mockResolvedValueOnce([[{ github_login: 'alice' }], null]) // mapping check passes
    .mockResolvedValueOnce([[                                   // team membership
      { github_login: 'alice', team_id: 't1' },
      { github_login: 'carol', team_id: 't2' },
    ], null]);
  mockRows(MODEL_ROWS);
  
  const out = await queryModelUsage(
    { report_id: 'r1' },
    { githubLogin: 'alice', isAdmin: false, authDisabled: false }
  ) as any;
  
  expect(out.cost_visible).toBe(true);
  expect(out.models.length).toBeGreaterThan(0);
  expect(out.models.every((m: any) => m.github_login === 'alice')).toBe(true);
});

it('SECURITY: cross-org exploit blocked even when login matches case-insensitively', async () => {
  // User 'Alice' from org A tries to access 'alice' costs in org B
  mockResolveAndDevs();
  mockExecute
    .mockResolvedValueOnce([[{ org: 'acme' }], null])  // reportOrg
    .mockResolvedValueOnce([[], null]);                 // no mapping for 'Alice' in 'acme'
  
  const out = await queryDeveloperStats(
    { report_id: 'r1' },
    { githubLogin: 'Alice', isAdmin: false, authDisabled: false }
  ) as any;
  
  expect(out.developers.every((d: any) => !('cc_total_cost' in d))).toBe(true);
  
  // Verify case-insensitive mapping check was performed
  const mappingCall = mockExecute.mock.calls.find(c => 
    String(c[0]).includes('LOWER(github_login)')
  );
  expect(mappingCall).toBeDefined();
  expect(mappingCall![1]).toEqual(['Alice', 'acme']);
});

it('SECURITY: exploit blocked even when requester shares team name in target org', async () => {
  // Scenario: user 'frank' mapped in org 'widgets', tries to access org 'acme'
  // where there's a team containing 'frank' and 'alice'. Without the mapping
  // check, the shared-team logic would grant visibility to alice's costs.
  mockResolveAndDevs();
  mockExecute
    .mockResolvedValueOnce([[{ org: 'acme' }], null])  // reportOrg
    .mockResolvedValueOnce([[], null]);                 // no mapping for 'frank' in 'acme'
  
  const out = await queryDeveloperStats(
    { report_id: 'r1' },
    { githubLogin: 'frank', isAdmin: false, authDisabled: false }
  ) as any;
  
  // No visibility despite potential team overlap
  expect(out.developers.every((d: any) => !('cc_total_cost' in d))).toBe(true);
  
  // Team query should NOT run after mapping check fails
  const teamCall = mockExecute.mock.calls.find(c => 
    String(c[0]).includes('team_members')
  );
  expect(teamCall).toBeUndefined();
});
