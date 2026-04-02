jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));
jest.mock('@/lib/jira/client');
jest.mock('@/lib/db/index', () => ({
  __esModule: true,
  default: { execute: jest.fn().mockResolvedValue([[], null]) },
}));
jest.mock('@/lib/llm-provider', () => ({
  getLLMClient: jest.fn(),
  LLM_MODEL: 'test-model',
  extraBodyProps: jest.fn().mockReturnValue({}),
  tokenLimit: (n: number) => ({ max_completion_tokens: n }),
  promptTag: (name: string) => name ? { __prompt_id: name } : {},
}));
jest.mock('@/lib/prompt-loader', () => ({
  loadPrompt: jest.fn().mockReturnValue('test prompt'),
}));
jest.mock('@/lib/app-config/service', () => ({
  getAppConfig: jest.fn().mockReturnValue({
    summary: { temperature: 0.7, maxTokens: 512 },
  }),
}));
jest.mock('@/lib/projects/epic-stats', () => ({
  getEpicRingStats: jest.fn(),
  evictEpicStats: jest.fn(),
}));

import { getEpicSummary } from '@/lib/projects/epic-summary';
import { getJiraClient } from '@/lib/jira/client';
import db from '@/lib/db/index';
import { getLLMClient } from '@/lib/llm-provider';
import { getEpicRingStats, evictEpicStats } from '@/lib/projects/epic-stats';

const mockGetJiraClient = getJiraClient as jest.Mock;
const mockDbExecute = db.execute as jest.Mock;
const mockGetLLMClient = getLLMClient as jest.Mock;
const mockGetEpicRingStats = getEpicRingStats as jest.Mock;
const mockEvictEpicStats = evictEpicStats as jest.Mock;

// Helper to build a mock Jira client with configurable children
function makeMockJiraClient(children: Array<{
  key: string;
  summary: string;
  status: string;
  statusCategory: string;
  resolvedAt: string | null;
  assigneeEmail: string | null;
}> = []) {
  return {
    searchChildIssues: jest.fn().mockResolvedValue(children),
  };
}

// Helper to build a resolved child issue
function makeChild(
  key: string,
  opts: Partial<{
    statusCategory: string;
    resolvedAt: string | null;
    assigneeEmail: string | null;
  }> = {},
) {
  return {
    key,
    summary: `Summary for ${key}`,
    status: opts.statusCategory === 'Done' ? 'Done' : 'In Progress',
    statusCategory: opts.statusCategory ?? 'In Progress',
    resolvedAt: opts.resolvedAt ?? null,
    assigneeEmail: opts.assigneeEmail ?? null,
  };
}

// A commit row as returned from commit_analyses DB query
function makeCommitRow(overrides: Partial<Record<string, any>> = {}) {
  return {
    commit_sha: 'sha-abc123',
    repo: 'acme/my-repo',
    github_login: 'alice',
    commit_message: 'fix: resolve EPIC-1 issue',
    lines_added: 100,
    lines_removed: 20,
    pr_number: 42,
    pr_title: 'Fix epic issue',
    committed_at: '2026-03-25T10:00:00.000Z',
    ...overrides,
  };
}

// Mock LLM client that returns a plain summary sentence
function makeMockLLMClient() {
  const mockCreate = jest.fn().mockResolvedValue({
    choices: [{ message: { content: 'Test summary sentence.' } }],
  });
  return { chat: { completions: { create: mockCreate } } };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDbExecute.mockResolvedValue([[], null]);
  mockGetEpicRingStats.mockResolvedValue({
    epicKey: 'SPS-1',
    totalJiras: 5,
    resolvedJiras: 3,
    remainingJiras: 2,
    commitCount: 10,
    devCount: 2,
    linesAdded: 500,
    linesRemoved: 100,
    repos: ['repo-a'],
    cached: false,
  });
  mockEvictEpicStats.mockResolvedValue(undefined);
});

// Helper: build a cache row with generated_at as a MySQL-style datetime string
// (SQLite/MySQL store datetime as string "YYYY-MM-DD HH:MM:SS", not ISO)
function makeCachedRow(overrides: Partial<Record<string, any>> = {}) {
  // Use a date 1 hour ago, formatted as MySQL datetime
  const d = new Date(Date.now() - 60 * 60 * 1000);
  const generated_at = d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
  return {
    summary_text: 'Cached one-liner about the epic.',
    jira_resolved: 3,
    jira_remaining: 1,
    commit_count: 10,
    lines_added: 500,
    lines_removed: 100,
    repos: JSON.stringify(['acme/repo-a']),
    generated_at,
    ...overrides,
  };
}

// ─── 1. Cached summary (< 24h TTL) ────────────────────────────────────────────

describe('getEpicSummary — cache hit', () => {
  it('returns cached summary with cached: true and still fetches live commits', async () => {
    const jiraClient = makeMockJiraClient([
      makeChild('EPIC-1-01', { statusCategory: 'Done', resolvedAt: '2026-03-28' }),
    ]);
    mockGetJiraClient.mockReturnValue(jiraClient);

    const cachedRow = makeCachedRow();
    const commitRow = makeCommitRow();

    mockDbExecute
      // Phase 1 seed query (commit_analyses) — child has assigneeEmail=null so no user_mappings
      .mockResolvedValueOnce([[commitRow], null])
      // Phase 2 query (commit_analyses)
      .mockResolvedValueOnce([[commitRow], null])
      // epic_summaries cache lookup → hit
      .mockResolvedValueOnce([[cachedRow], null]);

    const result = await getEpicSummary('EPIC-1', 'Epic title', 'acme', false);

    expect(result.cached).toBe(true);
    expect(result.summary).toBe('Cached one-liner about the epic.');
    expect(result.epicKey).toBe('EPIC-1');
    // Commits are fetched live even on cache hit
    expect(result.commits).toHaveLength(1);
    expect(result.commits[0].sha).toBe('sha-abc123');
    // LLM should NOT have been called
    expect(mockGetLLMClient).not.toHaveBeenCalled();
  });

  it('does not call storeSummary (INSERT) on cache hit', async () => {
    const jiraClient = makeMockJiraClient([]);
    mockGetJiraClient.mockReturnValue(jiraClient);

    const cachedRow = makeCachedRow({ summary_text: 'Already stored.' });

    mockDbExecute
      // Phase 1 seed: no commits (no assignees, no key matches)
      .mockResolvedValueOnce([[], null])
      // Phase 2 skipped (seedRepos=0, seedLogins=0 → early return in getCommitStats)
      // epic_summaries cache lookup → hit
      .mockResolvedValueOnce([[cachedRow], null]);

    await getEpicSummary('EPIC-1', 'Epic title', 'acme', false);

    const insertCall = mockDbExecute.mock.calls.find(
      (call: any[]) => typeof call[0] === 'string' && call[0].includes('INSERT INTO epic_summaries'),
    );
    expect(insertCall).toBeUndefined();
  });
});

// ─── 2. Cache miss → LLM call and store ──────────────────────────────────────

describe('getEpicSummary — cache miss', () => {
  // Children have no assigneeEmail so no user_mappings call is made.
  // DB call order:
  //   1. Phase 1 seed (commit_analyses)
  //   2. Phase 2 (commit_analyses) — only if seedRepos/seedLogins are non-empty
  //   3. epic_summaries SELECT (cache miss → empty)
  //   4. epic_summaries INSERT
  function setupCacheMissPath(commitRows: any[] = [makeCommitRow()]) {
    const jiraClient = makeMockJiraClient([
      makeChild('EPIC-1-01', { statusCategory: 'Done', resolvedAt: '2026-03-28' }),
      makeChild('EPIC-1-02', { statusCategory: 'In Progress' }),
    ]);
    mockGetJiraClient.mockReturnValue(jiraClient);

    const mockLLMClient = makeMockLLMClient();
    mockGetLLMClient.mockResolvedValue(mockLLMClient);

    mockDbExecute
      // Phase 1 seed query — returns seeded commits (seeds repos+logins)
      .mockResolvedValueOnce([commitRows, null])
      // Phase 2 query
      .mockResolvedValueOnce([commitRows, null])
      // epic_summaries SELECT → cache miss
      .mockResolvedValueOnce([[], null])
      // epic_summaries INSERT/UPSERT
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]);

    return mockLLMClient;
  }

  it('calls LLM when no cache exists and returns cached: false', async () => {
    setupCacheMissPath();

    const result = await getEpicSummary('EPIC-1', 'Epic title', 'acme', false);

    expect(result.cached).toBe(false);
    expect(result.summary).toBe('Test summary sentence.');
    expect(result.epicKey).toBe('EPIC-1');
    expect(mockGetLLMClient).toHaveBeenCalledTimes(1);
  });

  it('stores LLM result in epic_summaries table', async () => {
    setupCacheMissPath();

    await getEpicSummary('EPIC-1', 'Epic title', 'acme', false);

    const insertCall = mockDbExecute.mock.calls.find(
      (call: any[]) => typeof call[0] === 'string' && call[0].includes('INSERT INTO epic_summaries'),
    );
    expect(insertCall).toBeDefined();
    expect(insertCall![1]).toContain('EPIC-1');
    expect(insertCall![1]).toContain('acme');
    expect(insertCall![1]).toContain('Test summary sentence.');
  });

  it('also returns stats in the result', async () => {
    setupCacheMissPath();

    const result = await getEpicSummary('EPIC-1', 'Epic title', 'acme', false);

    expect(result.stats.commitCount).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(result.stats.repos)).toBe(true);
    expect(typeof result.stats.linesAdded).toBe('number');
    expect(typeof result.stats.linesRemoved).toBe('number');
  });
});

// ─── 3. Force refresh bypasses cache ─────────────────────────────────────────

describe('getEpicSummary — force refresh', () => {
  it('skips cache lookup and calls LLM even when cache would be fresh', async () => {
    // Use a child with an assigneeEmail to exercise user_mappings path
    const jiraClient = makeMockJiraClient([
      makeChild('EPIC-1-01', { assigneeEmail: 'dev@acme.com' }),
    ]);
    mockGetJiraClient.mockReturnValue(jiraClient);

    const mockLLMClient = makeMockLLMClient();
    mockGetLLMClient.mockResolvedValue(mockLLMClient);

    mockDbExecute
      // DELETE FROM epic_summaries (forceRefresh=true evicts DB cache)
      .mockResolvedValueOnce([{ affectedRows: 0 }, null])
      // Phase 1 seed → no key-matching commits
      .mockResolvedValueOnce([[], null])
      // user_mappings for dev@acme.com → returns a login to seed phase 2
      .mockResolvedValueOnce([[{ github_login: 'dev-alice' }], null])
      // Phase 2 — seedLogins non-empty → runs, returns no commits
      .mockResolvedValueOnce([[], null])
      // NO epic_summaries SELECT (forceRefresh=true)
      // epic_summaries INSERT/UPSERT
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]);

    const result = await getEpicSummary('EPIC-1', 'Epic title', 'acme', true);

    expect(result.cached).toBe(false);
    expect(result.summary).toBe('Test summary sentence.');
    expect(mockGetLLMClient).toHaveBeenCalledTimes(1);
    // evictEpicStats should have been called
    expect(mockEvictEpicStats).toHaveBeenCalledWith('EPIC-1', 'acme');

    // Verify no SELECT from epic_summaries was issued
    const cacheSelectCall = mockDbExecute.mock.calls.find(
      (call: any[]) => typeof call[0] === 'string' && call[0].includes('SELECT') && call[0].includes('epic_summaries'),
    );
    expect(cacheSelectCall).toBeUndefined();
  });
});

// ─── 4. Deduplication by commit_sha ──────────────────────────────────────────

describe('getEpicSummary — commit deduplication', () => {
  it('deduplicates commits with the same commit_sha', async () => {
    // No Jira children, no assigneeEmails → no user_mappings call
    const jiraClient = makeMockJiraClient([]);
    mockGetJiraClient.mockReturnValue(jiraClient);

    const mockLLMClient = makeMockLLMClient();
    mockGetLLMClient.mockResolvedValue(mockLLMClient);

    // Same SHA appears twice in phase 2 (from two different report rows)
    const dupCommit = makeCommitRow({ commit_sha: 'dup-sha', repo: 'acme/repo', lines_added: 50, lines_removed: 5 });

    mockDbExecute
      // Phase 1 seed: one matching commit → seeds repo + login
      .mockResolvedValueOnce([[dupCommit], null])
      // Phase 2: same commit returned twice (same commit in 2 reports)
      .mockResolvedValueOnce([[dupCommit, dupCommit], null])
      // epic_summaries cache → miss
      .mockResolvedValueOnce([[], null])
      // INSERT
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]);

    const result = await getEpicSummary('EPIC-1', 'Epic title', 'acme', false);

    // Despite being returned twice in phase 2, commit should appear only once
    const dupCommits = result.commits.filter(c => c.sha === 'dup-sha');
    expect(dupCommits).toHaveLength(1);
  });

  it('counts linesAdded only once per deduplicated commit', async () => {
    const jiraClient = makeMockJiraClient([]);
    mockGetJiraClient.mockReturnValue(jiraClient);

    const mockLLMClient = makeMockLLMClient();
    mockGetLLMClient.mockResolvedValue(mockLLMClient);

    const dupCommit = makeCommitRow({ commit_sha: 'dup-sha-2', lines_added: '200', lines_removed: '40' });

    mockDbExecute
      // Phase 1 seed → seeds repo + login
      .mockResolvedValueOnce([[dupCommit], null])
      // Phase 2: duplicate rows
      .mockResolvedValueOnce([[dupCommit, dupCommit], null])
      // epic_summaries cache → miss
      .mockResolvedValueOnce([[], null])
      // INSERT
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]);

    // Override stats mock for this test to match expected values
    mockGetEpicRingStats.mockResolvedValueOnce({
      epicKey: 'EPIC-1',
      totalJiras: 0,
      resolvedJiras: 0,
      remainingJiras: 0,
      commitCount: 1,
      devCount: 1,
      linesAdded: 200,
      linesRemoved: 40,
      repos: ['acme/my-repo'],
      cached: false,
    });

    const result = await getEpicSummary('EPIC-1', 'Epic title', 'acme', false);

    expect(result.stats.linesAdded).toBe(200);
    expect(result.stats.linesRemoved).toBe(40);
    expect(result.stats.commitCount).toBe(1);
  });
});

// ─── 5. Commit details in result ─────────────────────────────────────────────

describe('getEpicSummary — commit details', () => {
  it('maps DB row fields to CommitDetail shape correctly', async () => {
    // No children, no assigneeEmails
    const jiraClient = makeMockJiraClient([]);
    mockGetJiraClient.mockReturnValue(jiraClient);

    const mockLLMClient = makeMockLLMClient();
    mockGetLLMClient.mockResolvedValue(mockLLMClient);

    const commitRow = makeCommitRow({
      commit_sha: 'detail-sha',
      repo: 'acme/detail-repo',
      github_login: 'bob',
      commit_message: 'feat: add feature',
      lines_added: 300,
      lines_removed: 50,
      pr_number: 99,
      pr_title: 'Add feature PR',
      committed_at: '2026-03-20T08:00:00.000Z',
    });

    mockDbExecute
      // Phase 1 seed → seeds repo+login
      .mockResolvedValueOnce([[commitRow], null])
      // Phase 2
      .mockResolvedValueOnce([[commitRow], null])
      // cache miss
      .mockResolvedValueOnce([[], null])
      // INSERT
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]);

    const result = await getEpicSummary('EPIC-1', 'Epic title', 'acme', false);

    expect(result.commits).toHaveLength(1);
    const commit = result.commits[0];
    expect(commit.sha).toBe('detail-sha');
    expect(commit.repo).toBe('acme/detail-repo');
    expect(commit.author).toBe('bob');
    expect(commit.message).toBe('feat: add feature');
    expect(commit.linesAdded).toBe(300);
    expect(commit.linesRemoved).toBe(50);
    expect(commit.prNumber).toBe(99);
    expect(commit.prTitle).toBe('Add feature PR');
    expect(commit.committedAt).toBe(new Date('2026-03-20T08:00:00.000Z').toISOString());
  });

  it('handles null pr_number and pr_title', async () => {
    const jiraClient = makeMockJiraClient([]);
    mockGetJiraClient.mockReturnValue(jiraClient);

    const mockLLMClient = makeMockLLMClient();
    mockGetLLMClient.mockResolvedValue(mockLLMClient);

    // Explicitly null PR fields
    const commitRow = makeCommitRow({
      commit_sha: 'no-pr-sha',
      pr_number: null,
      pr_title: null,
    });

    mockDbExecute
      // Phase 1 seed → seeds repo+login
      .mockResolvedValueOnce([[commitRow], null])
      // Phase 2
      .mockResolvedValueOnce([[commitRow], null])
      // cache miss
      .mockResolvedValueOnce([[], null])
      // INSERT
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]);

    const result = await getEpicSummary('EPIC-1', 'Epic title', 'acme', false);

    expect(result.commits[0].prNumber).toBeNull();
    expect(result.commits[0].prTitle).toBeNull();
  });
});

// ─── 6. Empty child issues ────────────────────────────────────────────────────

describe('getEpicSummary — empty Jira children', () => {
  it('returns empty commits and zero stats when there are no child issues and no seeded commits', async () => {
    // No Jira children → allKeys = ['EPIC-1'] only, no assigneeEmails
    const jiraClient = makeMockJiraClient([]);
    mockGetJiraClient.mockReturnValue(jiraClient);

    const mockLLMClient = makeMockLLMClient();
    mockGetLLMClient.mockResolvedValue(mockLLMClient);

    // Override stats mock to return zero values for this empty-state test
    mockGetEpicRingStats.mockResolvedValueOnce({
      epicKey: 'EPIC-1',
      totalJiras: 0,
      resolvedJiras: 0,
      remainingJiras: 0,
      commitCount: 0,
      devCount: 0,
      linesAdded: 0,
      linesRemoved: 0,
      repos: [],
      cached: false,
    });

    mockDbExecute
      // Phase 1 seed: EPIC-1 key only, no matching commits
      .mockResolvedValueOnce([[], null])
      // No assigneeEmails → no user_mappings call
      // seedRepos=0, seedLogins=0 → getCommitStats returns early (no phase 2)
      // epic_summaries cache → miss
      .mockResolvedValueOnce([[], null])
      // INSERT
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]);

    const result = await getEpicSummary('EPIC-1', 'Epic title', 'acme', false);

    expect(result.commits).toEqual([]);
    expect(result.stats.commitCount).toBe(0);
    expect(result.stats.linesAdded).toBe(0);
    expect(result.stats.linesRemoved).toBe(0);
    expect(result.stats.repos).toEqual([]);
    expect(result.stats.jiraResolved).toBe(0);
    expect(result.stats.jiraRemaining).toBe(0);
    // LLM still called for the summary even with no commits
    expect(mockGetLLMClient).toHaveBeenCalledTimes(1);
  });

  it('throws when Jira client is not configured', async () => {
    mockGetJiraClient.mockReturnValue(null);

    await expect(
      getEpicSummary('EPIC-1', 'Epic title', 'acme', false),
    ).rejects.toThrow('Jira is not configured');
  });
});

// ─── 7. generatedAt is present and valid ISO string ───────────────────────────

describe('getEpicSummary — generatedAt field', () => {
  it('returns a valid ISO date string for generatedAt on cache miss', async () => {
    const jiraClient = makeMockJiraClient([]);
    mockGetJiraClient.mockReturnValue(jiraClient);

    const mockLLMClient = makeMockLLMClient();
    mockGetLLMClient.mockResolvedValue(mockLLMClient);

    mockDbExecute
      // Phase 1 seed → no results, phase 2 skipped
      .mockResolvedValueOnce([[], null])
      // cache miss
      .mockResolvedValueOnce([[], null])
      // INSERT
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]);

    const result = await getEpicSummary('EPIC-1', 'Epic title', 'acme', false);

    expect(result.generatedAt).toBeDefined();
    expect(() => new Date(result.generatedAt)).not.toThrow();
    expect(new Date(result.generatedAt).toISOString()).toBe(result.generatedAt);
  });
});
