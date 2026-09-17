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
  // The salted-retry cooldown lives on globalThis so it survives HMR; clear it
  // so each test starts eligible to retry.
  (globalThis as any).__glookInsightsRetryAt?.clear();
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

/**
 * GLOOK-54: the Top Projects card was broken for weeks by ONE trailing comma
 * in an otherwise perfect 14,268-char response, and reloading never helped
 * because the AI Proxy re-serves the identical cached completion (measured:
 * 2431ms first call, 224ms and byte-identical on the second).
 */
describe('GLOOK-54 — malformed model JSON', () => {
  const TRAILING_COMMA =
    '{"projects":[{"name":"Media Studio","jira_keys":["AAA-1"],},{"name":"Other","jira_keys":["AAA-1"]}]}';

  const userMessageOf = (call: any) =>
    call[0].messages.find((m: any) => m.role === 'user').content;

  it('repairs a trailing comma instead of failing the card', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ finish_reason: 'stop', message: { content: TRAILING_COMMA } }],
    });
    const out = await getProjectInsights();
    expect(out.available).toBe(true);
    // Repaired output is a real success, so it SHOULD be cached.
    expect(cacheWrites()).toHaveLength(1);
    // One call only: repair must not spend a regeneration.
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('retries ONCE with a salt when repair cannot help', async () => {
    mockCreate
      .mockResolvedValueOnce({ choices: [{ finish_reason: 'stop', message: { content: 'reasoning: here goes {"projects":[]}' } }] })
      .mockResolvedValueOnce({
        choices: [{ finish_reason: 'stop', message: { content: '{"projects":[{"name":"Fresh","jira_keys":["AAA-1"]}]}' } }],
      });

    const out = await getProjectInsights();
    expect(out.available).toBe(true);
    expect(mockCreate).toHaveBeenCalledTimes(2);

    // The salt must be in the USER MESSAGE. Measured on 2026-09-16: a nonce in
    // smartling_additional_properties does NOT bust the proxy cache (38ms,
    // identical bytes), so putting it there would re-serve the same bad JSON.
    const first = userMessageOf(mockCreate.mock.calls[0]);
    const second = userMessageOf(mockCreate.mock.calls[1]);
    expect(second).not.toBe(first);
    expect(second).toMatch(/<!-- retry .+ -->/);
    expect(second.startsWith(first)).toBe(true); // payload unchanged, salt appended
  });

  it('does not cache when even the salted retry fails', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ finish_reason: 'stop', message: { content: 'not json at all' } }],
    });
    await expect(getProjectInsights()).rejects.toThrow(/json parse/i);
    expect(cacheWrites()).toHaveLength(0);
    expect(mockCreate).toHaveBeenCalledTimes(2); // original + one salted retry
  });

  it('will not spend a second regeneration while the cooldown holds', async () => {
    // Failures are NOT cached on our side, so every page load re-enters this
    // path. Without the cooldown one broken report buys a full ~200k-char
    // generation per load — da2fa78f logged 15 in a day.
    mockCreate.mockResolvedValue({
      choices: [{ finish_reason: 'stop', message: { content: 'not json at all' } }],
    });

    await expect(getProjectInsights()).rejects.toThrow();
    expect(mockCreate).toHaveBeenCalledTimes(2); // first load: original + retry

    mockCreate.mockClear();
    await expect(getProjectInsights()).rejects.toThrow(/cooldown/i);
    expect(mockCreate).toHaveBeenCalledTimes(1); // second load: no retry
  });

  it('still refuses to cache a truncated completion', async () => {
    // GLOOK-54 must not weaken the 2026-08-03 invariant: repair is for
    // malformed output, never for a severed one.
    mockCreate.mockResolvedValue({
      choices: [{ finish_reason: 'length', message: { content: '{"projects":[{"name":"x","jira_keys":["AAA' } }],
    });
    await expect(getProjectInsights()).rejects.toThrow();
    expect(cacheWrites()).toHaveLength(0);
  });
});
