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
      // Only alice has a developer_stats row for this report. 'bob' below has
      // none — he stands in for the user_mappings-fallback population that the
      // INNER JOIN is meant to exclude in real SQL. This mock routes by regex
      // and does not execute an actual join, so it still echoes bob's row back;
      // the exclusion itself is verified at the SQL-text level below, not by
      // asserting on this mock's returned array (see the JOIN test).
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
    // report_id is qualified (e.g. `cc_model_usage.report_id`) rather than bare,
    // because the INNER JOIN below brings a second report_id column (from
    // developer_stats) into scope — an unqualified reference would be ambiguous.
    expect(String(call[0])).toMatch(/WHERE \w+\.report_id = \?/);
    expect(call[1]).toEqual(['r1']);
  }
});

it('scopes cc_model_usage and cc_skills_usage to developers present in this report via INNER JOIN developer_stats', async () => {
  // The login resolver behind these tables falls back to the historical
  // user_mappings table, so it can attribute rows to logins with no
  // developer_stats row for this report (see 'bob' in the fixture above).
  // This mock routes by regex and doesn't execute a real join, so that
  // exclusion can't be observed on the returned array here — instead we
  // assert the JOIN predicates directly in the SQL text, specific enough
  // that dropping either the report_id or the github_login predicate fails it.
  await getOrgReport('r1');
  const modelSql = String(mockExecute.mock.calls.find(c => /FROM cc_model_usage/.test(String(c[0])))![0]);
  const skillsSql = String(mockExecute.mock.calls.find(c => /FROM cc_skills_usage/.test(String(c[0])))![0]);

  for (const [sql, table] of [
    [modelSql, 'cc_model_usage'],
    [skillsSql, 'cc_skills_usage'],
  ] as const) {
    expect(sql).toMatch(/INNER JOIN developer_stats\s+d\b/);
    expect(sql).toMatch(new RegExp(`d\\.report_id\\s*=\\s*${table}\\.report_id`));
    expect(sql).toMatch(new RegExp(`d\\.github_login\\s*=\\s*${table}\\.github_login`));
  }
});
