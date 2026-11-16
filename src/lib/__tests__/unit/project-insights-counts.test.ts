/**
 * Regression test: a project's commit/PR counts must be its real totals, not the length of the
 * 20-item lists shown in its detail drawer (every big project read "20 commits").
 * Harness borrowed from project-insights-failure.test.ts.
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

const commit = (sha: string, pr: number | null, repo = 'r') => ({
  commit_sha: sha, pr_number: pr, repo, github_login: 'alice', commit_message: sha,
  lines_added: 1, lines_removed: 0, committed_at: '2026-08-01T00:00:00Z',
});

// 30 commits spread over 25 PRs (PRs 1-5 have two commits each). Tests may replace it.
let COMMITS: any[];
const MANY = Array.from({ length: 30 }, (_, i) => ({
  commit_sha: `sha${String(i).padStart(4, '0')}`, pr_number: (i % 25) + 1, repo: 'r', github_login: 'alice',
  commit_message: `m${i}`, lines_added: 1, lines_removed: 0, committed_at: `2026-08-01T00:00:${String(i).padStart(2, '0')}Z`,
}));

/** Route by SQL text so the test doesn't break when query order shifts. */
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
  COMMITS = MANY;
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

const llmReturns = (project: object) => mockCreate.mockResolvedValue({
  choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({
    projects: [{ name: 'P', summary: 's', jira_keys: ['AAA-1'], pr_numbers: [], commit_shas: [], ...project }],
    untracked_work: [],
  }) } }],
});

it('counts only attributed commits: a PR number with no commits adds nothing, a bare commit adds no PR', async () => {
  COMMITS = [commit('abc0001', 7), commit('bare001', null)];
  llmReturns({ pr_numbers: [7, 999], commit_shas: ['bare001'] });
  const p = ((await getProjectInsights()) as any).projects[0];
  expect(p.estimated_commits).toBe(2);
  expect(p.estimated_prs).toBe(1);
  expect(p.commits_truncated).toBe(false);
  expect(p.prs_truncated).toBe(false);
});

it('keeps PRs with the same number in different repos apart', async () => {
  COMMITS = [commit('aaa0001', 123, 'org/a'), commit('bbb0001', 123, 'org/b')];
  llmReturns({ pr_numbers: [123] });
  const p = ((await getProjectInsights()) as any).projects[0];
  expect(p.estimated_prs).toBe(2);
  expect(p.prs.map((x: any) => x.repo).sort()).toEqual(['org/a', 'org/b']);
});

it('leaves a PR out of "Other" when a project reached it only through a commit sha', async () => {
  COMMITS = [commit('abc0001', 7), commit('oth0001', 8)];
  llmReturns({ commit_shas: ['abc0001'] });
  const r: any = await getProjectInsights();
  expect(r.projects[0].estimated_prs).toBe(1);
  expect(r.otherDetails.prs.map((x: any) => x.pr)).toEqual([8]);
  expect(r.otherTotals.prs).toBe(1);
});

it('flags the drawer lists as truncated when there are more than 20', async () => {
  llmReturns({ pr_numbers: Array.from({ length: 25 }, (_, i) => i + 1) });
  const p = ((await getProjectInsights()) as any).projects[0];
  expect(p.commits_truncated).toBe(true);
  expect(p.prs_truncated).toBe(true);
});
