/**
 * Regression tests for the 2026-08-03 incident: a truncated LLM completion
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
    if (/FROM commit_analyses/.test(sql)) {
      return [[{ commit_sha: 'abc1234', pr_number: 7, repo: 'r', github_login: 'alice', commit_message: 'm', lines_added: 1, lines_removed: 0, committed_at: '2026-08-01' }], null];
    }
    if (/FROM unmerged_prs/.test(sql)) return [[], null];
    if (/FROM unmerged_commits/.test(sql)) return [[], null];
    if (/INSERT INTO report_comparisons/.test(sql)) return [{ affectedRows: 1 }, null];
    return [[], null];
  });
}

const cacheWrites = () =>
  mockExecute.mock.calls.filter((c) => /INSERT INTO report_comparisons/.test(c[0]));

beforeEach(() => {
  mockExecute.mockReset();
  mockCreate.mockReset();
  routeQueries();
});

it('does NOT cache when the completion is truncated (finish_reason=length)', async () => {
  // Real shape of the incident: valid JSON prefix, severed mid-string.
  mockCreate.mockResolvedValue({
    choices: [{ finish_reason: 'length', message: { content: '{"projects":[{"name":"Some proj","jira_keys":["AAA-1","AAA' } }],
  });

  await expect(getProjectInsights()).rejects.toThrow(/truncat|json parse|generation/i);
  expect(cacheWrites()).toHaveLength(0);
});

it('does NOT cache when the completion is empty', async () => {
  mockCreate.mockResolvedValue({ choices: [{ finish_reason: 'stop', message: { content: '' } }] });

  await expect(getProjectInsights()).rejects.toThrow(/empty/i);
  expect(cacheWrites()).toHaveLength(0);
});

it('caches a complete, parseable generation', async () => {
  mockCreate.mockResolvedValue({
    choices: [{
      finish_reason: 'stop',
      message: {
        content: JSON.stringify({
          projects: [{ name: 'Some proj', summary: 's', jira_keys: ['AAA-1'], pr_numbers: [7], commit_shas: ['abc1234'] }],
          untracked_work: [],
        }),
      },
    }],
  });

  const res: any = await getProjectInsights();
  expect(res.available).toBe(true);
  expect(res.projects).toHaveLength(1);
  expect(cacheWrites()).toHaveLength(1);
});
