jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));
jest.mock('@/lib/db', () => ({ __esModule: true, default: { execute: jest.fn() } }));
// org.ts -> ./service -> @/lib/report-runner, which pulls in the ESM-only
// p-limit package; jest has no transform for it, so this module must be
// mocked before import (same pattern as org-unmerged-summary.test.ts).
jest.mock('@/lib/report-runner', () => ({ runReport: jest.fn().mockResolvedValue(undefined), requestStop: jest.fn() }));
jest.mock('@/lib/progress-store', () => ({ initProgress: jest.fn(), updateProgress: jest.fn(), getProgress: jest.fn() }));

import { getOrgReport } from '@/lib/report/org';
import db from '@/lib/db';

const mockExecute = db.execute as jest.Mock;

/** Route by SQL text so the test survives query-order changes. */
function routeQueries() {
  mockExecute.mockImplementation(async (sql: string) => {
    if (/FROM reports/.test(sql)) {
      return [[{ id: 'r1', org: 'acme', period_days: 14, status: 'completed', created_at: 'x', completed_at: 'y' }], null];
    }
    if (/FROM developer_stats/.test(sql)) {
      return [[{ github_login: 'alice', github_name: 'Alice', type_breakdown: '{}', active_repos: '[]', cc_total_cost: '100', cc_requests: '5', cc_skills_used: '12' }], null];
    }
    if (/FROM cc_model_usage/.test(sql)) {
      return [[
        { github_login: 'alice', model: 'claude-sonnet-5', cost: '500.00', requests: '20' },
        { github_login: 'bob', model: 'claude-opus-4-8', cost: '900.00', requests: '5' },
      ], null];
    }
    if (/FROM cc_skills_usage/.test(sql)) {
      return [[{ github_login: 'alice', product: 'cowork', skills_used: '12', skills_distinct: '4' }], null];
    }
    return [[], null];
  });
}

beforeEach(() => { mockExecute.mockReset(); routeQueries(); });

it('returns modelUsage with numeric coercion', async () => {
  const res: any = await getOrgReport('r1');
  expect(res.modelUsage).toEqual([
    { github_login: 'alice', model: 'claude-sonnet-5', cost: 500, requests: 20 },
    { github_login: 'bob', model: 'claude-opus-4-8', cost: 900, requests: 5 },
  ]);
});

it('returns skillsUsage with numeric coercion', async () => {
  const res: any = await getOrgReport('r1');
  expect(res.skillsUsage).toEqual([
    { github_login: 'alice', product: 'cowork', skills_used: 12, skills_distinct: 4 },
  ]);
});

it('selects cc_skills_used for developers', async () => {
  const res: any = await getOrgReport('r1');
  const devSelect = mockExecute.mock.calls.map(c => String(c[0])).find(s => /FROM developer_stats/.test(s))!;
  expect(devSelect).toMatch(/cc_skills_used/);
  expect(res.developers[0].cc_skills_used).toBe('12');
});

it('scopes both new queries to the report', async () => {
  await getOrgReport('r1');
  for (const pattern of [/FROM cc_model_usage/, /FROM cc_skills_usage/]) {
    const call = mockExecute.mock.calls.find(c => pattern.test(String(c[0])))!;
    expect(String(call[0])).toMatch(/WHERE report_id = \?/);
    expect(call[1]).toEqual(['r1']);
  }
});
