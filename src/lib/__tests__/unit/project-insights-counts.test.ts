/**
 * Regression test: a project's commit/PR counts must be its real totals, not the length of the
 * 20-item lists shown in its detail drawer (every big project read "20 commits").
 *
 * Harness copied from project-insights-failure.test.ts (2026-08-03 incident): a truncated LLM completion
 * (finish_reason=length) failed JSON.parse, was silently converted into
 * `projects: []`, and then written to the permanent version-keyed cache — so a
 * transient LLM hiccup became an indefinite outage of the home-page card.
 *
 * The invariant under test: a failed generation must NEVER be cached.
 */
jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));
jest.mock('@/lib/db', () => ({ __esModule: true, default: { execute: jest.fn() } }));

const mockCreate = jest.fn();
jest.mock('@/lib/llm-provider', () => ({
  getLLMClient: jest.fn(async () => ({ chat: { completions: { create: mockCreate } } })),
  LLM_MODEL: 'test-model',
  extraBodyProps: () => ({}),
  tokenLimit: (n: number) => ({ max_tokens: n }),
  samplingParams: (t: number) => ({ temperature: t }),
}));

import { getProjectInsights } from '@/lib/projects/insights';
import db from '@/lib/db';

const mockExecute = db.execute as jest.Mock;

/** Route by SQL text so the test doesn't break when query order shifts. */
// 30 commits spread over 25 PRs (PRs 1-5 have two commits each).
const COMMITS = Array.from({ length: 30 }, (_, i) => ({
  commit_sha: `sha${String(i).padStart(4, '0')}`, pr_number: (i % 25) + 1, repo: 'r', github_login: 'alice',
  commit_message: `m${i}`, lines_added: 1, lines_removed: 0, committed_at: `2026-08-01T00:00:${String(i).padStart(2, '0')}Z`,
}));

function routeQueries() {
  mockExecute.mockImplementation(async (sql: string) => {
    if (/FROM reports/.test(sql)) {
      return [[{ id: 'r1', org: 'acme', period_days: 14, created_at: '2026-08-03T13:00:00Z' }], null];
    }
    if (/COUNT\(\*\) as cnt FROM jira_issues/.test(sql)) return [[{ cnt: 400 }], null];
    if (/SUM\(total_commits\)/.test(sql)) return [[{ commits: 1000, prs: 450 }], null];
    if (/SELECT highlights_json/.test(sql)) return [[], null]; // cache miss
    if (/FROM jira_issues WHERE report_id = \? ORDER BY/.test(sql)) {
      return [[{ issue_key: 'AAA-1', project_key: 'AAA', issue_type: 'Task', github_login: 'alice', summary: 'x' }], null];
    }
    if (/FROM commit_analyses/.test(sql)) return [COMMITS, null];
    if (/FROM unmerged_prs/.test(sql)) return [[], null];
    if (/FROM unmerged_commits/.test(sql)) return [[], null];
    if (/INSERT INTO report_comparisons/.test(sql)) return [{ affectedRows: 1 }, null];
    return [[], null];
  });
}


beforeEach(() => {
  mockExecute.mockReset();
  mockCreate.mockReset();
  routeQueries();
  (globalThis as any).__glookInsightsRetryAt?.clear();
});

it('counts every attributed commit and PR, and caps only the drawer lists at 20', async () => {
  mockCreate.mockResolvedValue({
    choices: [{
      finish_reason: 'stop',
      message: { content: JSON.stringify({
        projects: [{ name: 'Big proj', summary: 's', jira_keys: ['AAA-1'], pr_numbers: Array.from({ length: 25 }, (_, i) => i + 1), commit_shas: [] }],
        untracked_work: [],
      }) },
    }],
  });

  const result: any = await getProjectInsights();
  const p = result.projects[0];
  expect(p.estimated_commits).toBe(30);
  expect(p.estimated_prs).toBe(25);
  expect(p.commits).toHaveLength(20);
  expect(p.prs).toHaveLength(20);
});
