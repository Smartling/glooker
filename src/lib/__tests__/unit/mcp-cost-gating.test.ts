jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));
jest.mock('@/lib/db/index', () => ({ __esModule: true, default: { execute: jest.fn() } }));
jest.mock('@/lib/report-runner', () => ({ runReport: jest.fn().mockResolvedValue(undefined), requestStop: jest.fn() }));

import { queryDeveloperStats, queryModelUsage, querySkillsUsage } from '@/lib/mcp/queries';
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
// Cost AND requests are gated: summing a developer's per-model requests
// reconstructs the gated cc_requests exactly. Gating drops the rows wholesale
// rather than blanking amounts, so a hidden developer leaves no trace at all.

// DECIMAL/BIGINT come back as strings from both drivers — see the CLAUDE.md gotcha.
const MODEL_ROWS = [
  { github_login: 'alice', model: 'opus', cost: '12.50', requests: '7' },
  { github_login: 'carol', model: 'opus', cost: '99.00', requests: '11' },
  { github_login: 'carol', model: 'sonnet', cost: '1.00', requests: '2' },
];

function mockResolveAndModels() {
  mockExecute
    .mockResolvedValueOnce([[{ id: 'r1' }], null])   // resolveReportId
    .mockResolvedValueOnce([MODEL_ROWS, null]);       // cc_model_usage rows
}

function mockTeamSplit() {
  mockExecute
    .mockResolvedValueOnce([[{ org: 'acme' }], null])                     // reportOrg
    .mockResolvedValueOnce([[                                             // team_members ⋈ teams
      { github_login: 'alice', team_id: 't1' },
      { github_login: 'carol', team_id: 't2' },
    ], null]);
}

it('model usage: keeps a teammate, omits a non-teammate entirely', async () => {
  mockResolveAndModels();
  mockTeamSplit();
  const out = await queryModelUsage({ report_id: 'r1' }, { githubLogin: 'alice', isAdmin: false, authDisabled: false }) as any;

  expect(out.models).toEqual([{ github_login: 'alice', model: 'opus', cost: 12.5, requests: 7 }]);
  // Not merely blanked — carol contributes no row, so "hidden" is
  // indistinguishable from "has no Claude usage".
  expect(out.models.some((m: any) => m.github_login === 'carol')).toBe(false);
  expect(out.count).toBe(1);
});

it('model usage: strips everything with no requester, and does no org lookup', async () => {
  mockResolveAndModels();
  const out = await queryModelUsage({ report_id: 'r1' }) as any;
  expect(out.models).toEqual([]);
  expect(out.count).toBe(0);
  expect(mockExecute).toHaveBeenCalledTimes(2);
});

it('model usage: admin sees every developer, and does no org lookup', async () => {
  mockResolveAndModels();
  const out = await queryModelUsage({ report_id: 'r1' }, { githubLogin: 'x', isAdmin: true, authDisabled: false }) as any;
  expect(out.models).toHaveLength(3);
  expect(mockExecute).toHaveBeenCalledTimes(2);
});

it('model usage: a partially-visible response never leaks a hidden total via requests', async () => {
  mockResolveAndModels();
  mockTeamSplit();
  const out = await queryModelUsage({ report_id: 'r1' }, { githubLogin: 'alice', isAdmin: false, authDisabled: false }) as any;
  const carolRequests = out.models
    .filter((m: any) => m.github_login === 'carol')
    .reduce((s: number, m: any) => s + m.requests, 0);
  expect(carolRequests).toBe(0); // 11 + 2 must not be reconstructible
});

it('model usage: coerces DECIMAL/BIGINT strings to numbers', async () => {
  mockResolveAndModels();
  const out = await queryModelUsage({ report_id: 'r1' }, { githubLogin: 'x', isAdmin: true, authDisabled: false }) as any;
  for (const m of out.models) {
    expect(typeof m.cost).toBe('number');
    expect(typeof m.requests).toBe('number');
  }
});

// --- query_skills_usage (GLOOK-37) ----------------------------------------
// Deliberately ungated: skill counts convert to no currency, so they sum to no
// gated figure. querySkillsUsage takes no requester at all.

const SKILL_ROWS = [
  { github_login: 'alice', product: 'claude_code', skills_used: '5', skills_distinct: '2' },
  { github_login: 'carol', product: 'chat', skills_used: '3', skills_distinct: '1' },
];

it('skills usage: returns every developer with no requester, and never gates', async () => {
  mockExecute
    .mockResolvedValueOnce([[{ id: 'r1' }], null])
    .mockResolvedValueOnce([SKILL_ROWS, null]);
  const out = await querySkillsUsage({ report_id: 'r1' }) as any;

  expect(out.skills).toEqual([
    { github_login: 'alice', product: 'claude_code', skills_used: 5, skills_distinct: 2 },
    { github_login: 'carol', product: 'chat', skills_used: 3, skills_distinct: 1 },
  ]);
  // No reportOrg / team lookup on any path — there is nothing to gate.
  expect(mockExecute).toHaveBeenCalledTimes(2);
});
