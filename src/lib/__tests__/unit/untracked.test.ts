/**
 * Tests for getUntrackedWork — the service that identifies commits that don't
 * reference any tracked Jira issue prefixes and clusters them via LLM.
 */

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

import { getUntrackedWork } from '@/lib/projects/untracked';
import { getJiraClient } from '@/lib/jira/client';
import db from '@/lib/db/index';
import { getLLMClient } from '@/lib/llm-provider';

const mockGetJiraClient = getJiraClient as jest.Mock;
const mockDbExecute = db.execute as jest.Mock;
const mockGetLLMClient = getLLMClient as jest.Mock;

// Default mock group — commit_shas are 8-char short SHAs as the LLM sees them
const mockGroup = {
  name: 'Test Group',
  summary: 'Test',
  commit_shas: ['sha-1abc'],
};

function makeMockLLMClient() {
  const mockCreate = jest.fn().mockResolvedValue({
    choices: [{ message: { content: JSON.stringify({ groups: [mockGroup] }) } }],
  });
  mockGetLLMClient.mockResolvedValue({ chat: { completions: { create: mockCreate } } });
  return mockCreate;
}

// Helper: build a Jira client mock with configurable searchEpics results
function makeJiraClient(epicKeys: string[], childKeys: string[]) {
  const searchEpics = jest.fn()
    .mockResolvedValueOnce(epicKeys.map(k => ({ key: k })))
    .mockResolvedValueOnce(childKeys.map(k => ({ key: k })));
  return { searchEpics };
}

// A sample raw commit row returned by DB
// sha is 40-char to allow 8-char slice matching in clusterCommits
function makeCommitRow(sha: string, repo: string, message: string) {
  return {
    commit_sha: sha,
    repo,
    github_login: 'alice',
    msg: message,
    lines_added: 10,
    lines_removed: 5,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.JIRA_PROJECTS_JQL = 'project = SPS AND issuetype = Epic';

  // Default: no rows for any query
  mockDbExecute.mockResolvedValue([[], null]);
});

afterEach(() => {
  delete process.env.JIRA_PROJECTS_JQL;
});

// ─── Test 1: returns empty when Jira client is null ───────────────────────────

describe('getUntrackedWork — Jira client is null', () => {
  it('returns empty teams when Jira client returns null', async () => {
    mockGetJiraClient.mockReturnValue(null);

    // No teams in DB
    mockDbExecute.mockResolvedValue([[], null]);

    const result = await getUntrackedWork('acme', false);

    expect(result.teams).toEqual([]);
    expect(result.cached).toBe(true);
  });
});

// ─── Test 2: excludes commits matching tracked Jira prefixes ──────────────────

describe('getUntrackedWork — prefix exclusion', () => {
  it('passes dash and space NOT LIKE patterns for each tracked prefix', async () => {
    // Epics: SPS-1 (prefix SPS), child PARSER-10 (prefix PARSER)
    const jiraClient = makeJiraClient(['SPS-1'], ['PARSER-10']);
    mockGetJiraClient.mockReturnValue(jiraClient);

    // DB call sequence (new cache-first flow, cache miss):
    // 1. teams => 1 team
    // 2. team_members => 1 member
    // 3. untracked_summaries cache check (early) => [] (cache miss)
    // 4. epic_summaries => []
    // 5. commit_analyses repo discovery => []
    // 6. untracked_summaries cache check (second, in parallel loop) => [] (miss)
    // 7. commit_analyses untracked query => 2 commits
    // 8. storeUntracked upsert => success

    const team = { id: 'team-1', name: 'Alpha', color: '#ff0000' };
    const commits = [
      makeCommitRow('sha-1abc1234567890', 'repo-a', 'feat: new feature'),
      makeCommitRow('sha-2abc1234567890', 'repo-b', 'fix: another fix'),
    ];

    mockDbExecute
      .mockResolvedValueOnce([[team], null])                // teams
      .mockResolvedValueOnce([[{ github_login: 'alice' }], null]) // team_members
      .mockResolvedValueOnce([[], null])                   // cache miss (early check)
      .mockResolvedValueOnce([[], null])                   // epic_summaries
      .mockResolvedValueOnce([[], null])                   // commit_analyses repo discovery
      .mockResolvedValueOnce([[], null])                   // cache miss (second check in parallel)
      .mockResolvedValueOnce([commits, null])              // untracked commits
      .mockResolvedValueOnce([[], null]);                  // storeUntracked

    const mockCreate = jest.fn().mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ groups: [
        { name: 'Test', summary: 'Test', commit_shas: ['sha-1abc', 'sha-2abc'] },
      ] }) } }],
    });
    mockGetLLMClient.mockResolvedValue({ chat: { completions: { create: mockCreate } } });

    await getUntrackedWork('acme', false);

    // Find the commit_analyses untracked query call (index 6 = the 7th call)
    const commitQueryCall = mockDbExecute.mock.calls[6];
    const sql: string = commitQueryCall[0];
    const values: any[] = commitQueryCall[1];

    // Should contain NOT LIKE patterns for SPS and PARSER
    expect(sql).toContain('NOT LIKE');

    // Values array should include %SPS-%, %SPS %, %PARSER-%, %PARSER %
    const prefixPatterns = values.filter((v: any) => typeof v === 'string' && v.startsWith('%'));
    expect(prefixPatterns).toContain('%SPS-%');
    expect(prefixPatterns).toContain('%SPS %');
    expect(prefixPatterns).toContain('%PARSER-%');
    expect(prefixPatterns).toContain('%PARSER %');
  });
});

// ─── Test 3: excludes commits in tracked repos ────────────────────────────────

describe('getUntrackedWork — repo exclusion', () => {
  it('excludes repos from epic_summaries cache', async () => {
    const jiraClient = makeJiraClient(['SPS-1'], []);
    mockGetJiraClient.mockReturnValue(jiraClient);

    const team = { id: 'team-1', name: 'Alpha', color: '#ff0000' };
    // epic_summaries has repo "tracked-repo" appearing once (count ≤ 3 => excluded)
    const epicSummaryRows = [{ repos: JSON.stringify(['tracked-repo']) }];
    const commits = [makeCommitRow('sha-1abc1234567890', 'other-repo', 'feat: new thing')];

    mockDbExecute
      .mockResolvedValueOnce([[team], null])               // teams
      .mockResolvedValueOnce([[{ github_login: 'alice' }], null]) // team_members
      .mockResolvedValueOnce([[], null])                   // cache miss (early check)
      .mockResolvedValueOnce([epicSummaryRows, null])      // epic_summaries
      .mockResolvedValueOnce([[], null])                   // commit_analyses repo discovery
      .mockResolvedValueOnce([[], null])                   // cache miss (second check in parallel)
      .mockResolvedValueOnce([commits, null])              // untracked commits
      .mockResolvedValueOnce([[], null]);                  // storeUntracked

    const mockCreate = jest.fn().mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ groups: [
        { name: 'Test', summary: 'Test', commit_shas: ['sha-1abc'] },
      ] }) } }],
    });
    mockGetLLMClient.mockResolvedValue({ chat: { completions: { create: mockCreate } } });

    await getUntrackedWork('acme', false);

    // Commit query should include NOT IN clause with tracked-repo
    const commitQueryCall = mockDbExecute.mock.calls[6];
    const sql: string = commitQueryCall[0];
    const values: any[] = commitQueryCall[1];

    expect(sql).toContain('NOT IN');
    expect(values).toContain('tracked-repo');
  });

  it('excludes repos from commit-based discovery (commit_analyses with tracked prefixes)', async () => {
    const jiraClient = makeJiraClient(['SPS-1'], []);
    mockGetJiraClient.mockReturnValue(jiraClient);

    const team = { id: 'team-1', name: 'Alpha', color: '#ff0000' };
    // commit_analyses repo discovery returns "sps-service" with enough commits
    const repoDiscoveryRows = [{ repo: 'sps-service', cnt: 5 }];
    const commits = [makeCommitRow('sha-1abc1234567890', 'other-repo', 'feat: unrelated')];

    mockDbExecute
      .mockResolvedValueOnce([[team], null])               // teams
      .mockResolvedValueOnce([[{ github_login: 'alice' }], null]) // team_members
      .mockResolvedValueOnce([[], null])                   // cache miss (early check)
      .mockResolvedValueOnce([[], null])                   // epic_summaries
      .mockResolvedValueOnce([repoDiscoveryRows, null])    // commit_analyses repo discovery
      .mockResolvedValueOnce([[], null])                   // cache miss (second check in parallel)
      .mockResolvedValueOnce([commits, null])              // untracked commits
      .mockResolvedValueOnce([[], null]);                  // storeUntracked

    const mockCreate = jest.fn().mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ groups: [
        { name: 'Test', summary: 'Test', commit_shas: ['sha-1abc'] },
      ] }) } }],
    });
    mockGetLLMClient.mockResolvedValue({ chat: { completions: { create: mockCreate } } });

    await getUntrackedWork('acme', false);

    const commitQueryCall = mockDbExecute.mock.calls[6];
    const values: any[] = commitQueryCall[1];

    expect(values).toContain('sps-service');
  });

  it('does NOT exclude a repo appearing in more than 3 epics (widely shared)', async () => {
    const jiraClient = makeJiraClient(['SPS-1'], []);
    mockGetJiraClient.mockReturnValue(jiraClient);

    const team = { id: 'team-1', name: 'Alpha', color: '#ff0000' };
    // "shared-repo" appears in 4 different epic rows → count > 3 → not excluded
    const epicSummaryRows = [
      { repos: JSON.stringify(['shared-repo']) },
      { repos: JSON.stringify(['shared-repo']) },
      { repos: JSON.stringify(['shared-repo']) },
      { repos: JSON.stringify(['shared-repo']) },
    ];
    const commits = [makeCommitRow('sha-1abc1234567890', 'shared-repo', 'feat: something')];

    mockDbExecute
      .mockResolvedValueOnce([[team], null])               // teams
      .mockResolvedValueOnce([[{ github_login: 'alice' }], null]) // team_members
      .mockResolvedValueOnce([[], null])                   // cache miss (early check)
      .mockResolvedValueOnce([epicSummaryRows, null])      // epic_summaries
      .mockResolvedValueOnce([[], null])                   // commit_analyses repo discovery
      .mockResolvedValueOnce([[], null])                   // cache miss (second check in parallel)
      .mockResolvedValueOnce([commits, null])              // untracked commits
      .mockResolvedValueOnce([[], null]);                  // storeUntracked

    const mockCreate = jest.fn().mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ groups: [
        { name: 'Test', summary: 'Test', commit_shas: ['sha-1abc'] },
      ] }) } }],
    });
    mockGetLLMClient.mockResolvedValue({ chat: { completions: { create: mockCreate } } });

    await getUntrackedWork('acme', false);

    const commitQueryCall = mockDbExecute.mock.calls[6];
    const sql: string = commitQueryCall[0];
    const values: any[] = commitQueryCall[1];

    // shared-repo should NOT appear in the query values
    expect(values).not.toContain('shared-repo');
    // No NOT IN clause at all (since excluded repos list is empty)
    expect(sql).not.toContain('NOT IN');
  });
});

// ─── Test 4: returns cached groups on cache hit (no LLM, no commit re-fetch) ──

describe('getUntrackedWork — caching', () => {
  it('returns cached groups directly without calling LLM or re-fetching commits', async () => {
    const jiraClient = makeJiraClient(['SPS-1'], []);
    mockGetJiraClient.mockReturnValue(jiraClient);

    const team = { id: 'team-1', name: 'Alpha', color: '#ff0000' };
    // Cache stores WorkGroup objects WITH commits embedded
    const cachedCommit = {
      sha: 'sha-1abc1234567890',
      repo: 'repo-a',
      author: 'alice',
      message: 'feat: cached thing',
      linesAdded: 10,
      linesRemoved: 5,
    };
    const cachedGroups = [{
      name: 'Cached Group',
      summary: 'From cache',
      commits: [cachedCommit],
    }];
    const freshCacheRow = {
      groups_json: JSON.stringify(cachedGroups),
      total_commits: 1,
      generated_at: new Date(Date.now() - 1000 * 60).toISOString(), // 1 minute ago
    };

    // Cache-first flow for a cache HIT:
    // 1. teams => 1 team
    // 2. team_members => 1 member
    // 3. untracked_summaries cache check => hit → return immediately
    mockDbExecute
      .mockResolvedValueOnce([[team], null])                      // teams
      .mockResolvedValueOnce([[{ github_login: 'alice' }], null]) // team_members
      .mockResolvedValueOnce([[freshCacheRow], null]);            // cache hit → early return

    const mockCreate = makeMockLLMClient();

    const result = await getUntrackedWork('acme', false);

    // LLM should NOT be called on a cache hit
    expect(mockCreate).not.toHaveBeenCalled();

    // DB should only have been called 3 times (teams + members + cache hit → done)
    expect(mockDbExecute).toHaveBeenCalledTimes(3);

    // Should return the cached groups with commits embedded
    expect(result.teams).toHaveLength(1);
    expect(result.teams[0].groups).toEqual(cachedGroups);
    expect(result.teams[0].groups[0].commits).toHaveLength(1);
    expect(result.teams[0].groups[0].commits[0].sha).toBe('sha-1abc1234567890');
  });

  it('bypasses cache and calls LLM when forceRefresh=true', async () => {
    const jiraClient = makeJiraClient(['SPS-1'], []);
    mockGetJiraClient.mockReturnValue(jiraClient);

    const team = { id: 'team-1', name: 'Alpha', color: '#ff0000' };
    const freshCommits = [makeCommitRow('sha-1abc1234567890', 'repo-a', 'feat: new thing')];

    // forceRefresh=true skips BOTH cache checks:
    // 1. teams
    // 2. team_members
    // (no early cache check — forceRefresh skips it)
    // 3. epic_summaries
    // 4. commit_analyses repo discovery
    // (no second cache check in parallel loop — forceRefresh skips it)
    // 5. untracked commits
    // 6. storeUntracked
    mockDbExecute
      .mockResolvedValueOnce([[team], null])                      // teams
      .mockResolvedValueOnce([[{ github_login: 'alice' }], null]) // team_members
      .mockResolvedValueOnce([[], null])                          // epic_summaries
      .mockResolvedValueOnce([[], null])                          // commit_analyses repo discovery
      .mockResolvedValueOnce([freshCommits, null])                // untracked commits
      .mockResolvedValueOnce([[], null]);                         // storeUntracked

    const mockCreate = jest.fn().mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ groups: [
        { name: 'Test', summary: 'Test', commit_shas: ['sha-1abc'] },
      ] }) } }],
    });
    mockGetLLMClient.mockResolvedValue({ chat: { completions: { create: mockCreate } } });

    await getUntrackedWork('acme', true);

    // LLM SHOULD be called when forceRefresh=true
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('ignores stale cache (older than 24h) and re-runs LLM', async () => {
    const jiraClient = makeJiraClient(['SPS-1'], []);
    mockGetJiraClient.mockReturnValue(jiraClient);

    const team = { id: 'team-1', name: 'Alpha', color: '#ff0000' };
    const staleCacheRow = {
      groups_json: JSON.stringify([{ name: 'Old Group', summary: 'Old', commits: [] }]),
      total_commits: 5,
      generated_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(), // 25h ago
    };
    const freshCommits = [makeCommitRow('sha-1abc1234567890', 'repo-a', 'feat: something new')];

    // Stale cache counts as a miss — falls through to expensive path:
    // 1. teams
    // 2. team_members
    // 3. untracked_summaries (early check) → stale → treated as miss
    // 4. epic_summaries
    // 5. commit_analyses repo discovery
    // 6. untracked_summaries (second check in parallel) → stale again
    // 7. untracked commits
    // 8. storeUntracked
    mockDbExecute
      .mockResolvedValueOnce([[team], null])                      // teams
      .mockResolvedValueOnce([[{ github_login: 'alice' }], null]) // team_members
      .mockResolvedValueOnce([[staleCacheRow], null])             // stale cache (early check → miss)
      .mockResolvedValueOnce([[], null])                          // epic_summaries
      .mockResolvedValueOnce([[], null])                          // commit_analyses repo discovery
      .mockResolvedValueOnce([[staleCacheRow], null])             // stale cache (second check → miss)
      .mockResolvedValueOnce([freshCommits, null])                // untracked commits
      .mockResolvedValueOnce([[], null]);                         // storeUntracked

    const mockCreate = jest.fn().mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ groups: [
        { name: 'Test', summary: 'Test', commit_shas: ['sha-1abc'] },
      ] }) } }],
    });
    mockGetLLMClient.mockResolvedValue({ chat: { completions: { create: mockCreate } } });

    await getUntrackedWork('acme', false);

    // LLM should be called because cache is stale
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });
});

// ─── Test 5: skips teams with no untracked commits ────────────────────────────

describe('getUntrackedWork — empty commits', () => {
  it('skips a team that has no untracked commits', async () => {
    const jiraClient = makeJiraClient(['SPS-1'], []);
    mockGetJiraClient.mockReturnValue(jiraClient);

    const team = { id: 'team-1', name: 'Alpha', color: '#ff0000' };

    // Cache miss → expensive path → 0 commits → team skipped
    // 1. teams
    // 2. team_members
    // 3. untracked_summaries (early check) → miss
    // 4. epic_summaries
    // 5. commit_analyses repo discovery
    // 6. untracked_summaries (second check in parallel) → miss
    // 7. 0 untracked commits → null returned (no storeUntracked)
    mockDbExecute
      .mockResolvedValueOnce([[team], null])                      // teams
      .mockResolvedValueOnce([[{ github_login: 'alice' }], null]) // team_members
      .mockResolvedValueOnce([[], null])                          // cache miss (early check)
      .mockResolvedValueOnce([[], null])                          // epic_summaries
      .mockResolvedValueOnce([[], null])                          // commit_analyses repo discovery
      .mockResolvedValueOnce([[], null])                          // cache miss (second check)
      .mockResolvedValueOnce([[], null]);                         // 0 untracked commits

    const mockCreate = makeMockLLMClient();

    const result = await getUntrackedWork('acme', false);

    // Team has no commits → skipped → no LLM call
    expect(mockCreate).not.toHaveBeenCalled();
    expect(result.teams).toHaveLength(0);
  });

  it('skips a team that has no members', async () => {
    const jiraClient = makeJiraClient(['SPS-1'], []);
    mockGetJiraClient.mockReturnValue(jiraClient);

    const team = { id: 'team-1', name: 'Alpha', color: '#ff0000' };

    // Team has no members → not added to teams array → early-exit loop has no items
    // → allCached = true → returns immediately with empty cached result
    // 1. teams
    // 2. team_members → empty → team not pushed to array
    // (early cache loop has nothing to iterate → allCached stays true → return)
    mockDbExecute
      .mockResolvedValueOnce([[team], null])  // teams
      .mockResolvedValueOnce([[], null]);     // team_members → empty → team skipped

    const mockCreate = makeMockLLMClient();

    const result = await getUntrackedWork('acme', false);

    expect(mockCreate).not.toHaveBeenCalled();
    expect(result.teams).toHaveLength(0);
  });
});

// ─── Test 6: LLM returns commit_shas → commits mapped into groups ─────────────

describe('getUntrackedWork — LLM commit_shas mapping', () => {
  it('maps LLM commit_shas (8-char short SHAs) to actual UntrackedCommit objects', async () => {
    const jiraClient = makeJiraClient(['SPS-1'], []);
    mockGetJiraClient.mockReturnValue(jiraClient);

    const team = { id: 'team-1', name: 'Alpha', color: '#ff0000' };
    // Full 40-char SHA; first 8 chars = 'sha1abc0'
    const commits = [makeCommitRow('sha1abc0efgh1234567890abcdef123456789012', 'repo-a', 'feat: new feature')];

    mockDbExecute
      .mockResolvedValueOnce([[team], null])
      .mockResolvedValueOnce([[{ github_login: 'alice' }], null])
      .mockResolvedValueOnce([[], null])                   // cache miss (early check)
      .mockResolvedValueOnce([[], null])                   // epic_summaries
      .mockResolvedValueOnce([[], null])                   // commit_analyses repo discovery
      .mockResolvedValueOnce([[], null])                   // cache miss (second check)
      .mockResolvedValueOnce([commits, null])
      .mockResolvedValueOnce([[], null]);

    const mockCreate = jest.fn().mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ groups: [
        { name: 'Feature Work', summary: 'New features', commit_shas: ['sha1abc0'] },
      ] }) } }],
    });
    mockGetLLMClient.mockResolvedValue({ chat: { completions: { create: mockCreate } } });

    const result = await getUntrackedWork('acme', false);

    expect(result.teams).toHaveLength(1);
    const team0 = result.teams[0];
    expect(team0.name).toBe('Alpha');
    expect(team0.color).toBe('#ff0000');
    expect(team0.groups).toHaveLength(1);

    const group = team0.groups[0];
    expect(group.name).toBe('Feature Work');
    expect(group.summary).toBe('New features');
    expect(group.commits).toHaveLength(1);
    expect(group.commits[0].sha).toBe('sha1abc0efgh1234567890abcdef123456789012');
    expect(group.commits[0].repo).toBe('repo-a');
    expect(group.commits[0].linesAdded).toBe(10);
    expect(group.commits[0].linesRemoved).toBe(5);
  });

  it('sends short SHAs (8 chars) in the prompt input', async () => {
    const jiraClient = makeJiraClient(['SPS-1'], []);
    mockGetJiraClient.mockReturnValue(jiraClient);
    const { loadPrompt } = require('@/lib/prompt-loader');

    const team = { id: 'team-1', name: 'Alpha', color: '#ff0000' };
    const commits = [makeCommitRow('sha1abc0efgh1234567890abcdef123456789012', 'repo-a', 'feat: feature')];

    mockDbExecute
      .mockResolvedValueOnce([[team], null])
      .mockResolvedValueOnce([[{ github_login: 'alice' }], null])
      .mockResolvedValueOnce([[], null])                   // cache miss (early check)
      .mockResolvedValueOnce([[], null])                   // epic_summaries
      .mockResolvedValueOnce([[], null])                   // commit_analyses repo discovery
      .mockResolvedValueOnce([[], null])                   // cache miss (second check)
      .mockResolvedValueOnce([commits, null])
      .mockResolvedValueOnce([[], null]);

    const mockCreate = jest.fn().mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ groups: [
        { name: 'Test', summary: 'Test', commit_shas: ['sha1abc0'] },
      ] }) } }],
    });
    mockGetLLMClient.mockResolvedValue({ chat: { completions: { create: mockCreate } } });

    await getUntrackedWork('acme', false);

    // The COMMITS placeholder passed to loadPrompt should use 8-char short SHAs
    const loadPromptCall = (loadPrompt as jest.Mock).mock.calls[0];
    const placeholders = loadPromptCall[1];
    expect(placeholders.COMMITS).toContain('sha1abc0'); // 8-char short SHA
    expect(placeholders.COMMITS).not.toContain('sha1abc0efgh'); // not full SHA
    // Format: sha8 | repo | author | message | +lines | -lines
    expect(placeholders.COMMITS).toMatch(/sha1abc0 \| repo-a \| alice \| feat: feature \| \+10 \| -5/);
  });

  it('handles markdown-fenced JSON from LLM gracefully', async () => {
    const jiraClient = makeJiraClient(['SPS-1'], []);
    mockGetJiraClient.mockReturnValue(jiraClient);

    const team = { id: 'team-1', name: 'Alpha', color: '#ff0000' };
    const commits = [makeCommitRow('sha1abc0efgh1234567890abcdef123456789012', 'repo-a', 'feat: something')];

    const llmGroup = { name: 'Test Group', summary: 'Test', commit_shas: ['sha1abc0'] };
    const fencedResponse = '```json\n' + JSON.stringify({ groups: [llmGroup] }) + '\n```';
    const mockCreate = jest.fn().mockResolvedValue({
      choices: [{ message: { content: fencedResponse } }],
    });
    mockGetLLMClient.mockResolvedValue({ chat: { completions: { create: mockCreate } } });

    mockDbExecute
      .mockResolvedValueOnce([[team], null])
      .mockResolvedValueOnce([[{ github_login: 'alice' }], null])
      .mockResolvedValueOnce([[], null])                   // cache miss (early check)
      .mockResolvedValueOnce([[], null])                   // epic_summaries
      .mockResolvedValueOnce([[], null])                   // commit_analyses repo discovery
      .mockResolvedValueOnce([[], null])                   // cache miss (second check)
      .mockResolvedValueOnce([commits, null])
      .mockResolvedValueOnce([[], null]);

    const result = await getUntrackedWork('acme', false);

    expect(result.teams[0].groups).toHaveLength(1);
    expect(result.teams[0].groups[0].name).toBe('Test Group');
    expect(result.teams[0].groups[0].commits).toHaveLength(1);
  });
});

// ─── Test 7: unclaimed commits go into "Other" group ─────────────────────────

describe('getUntrackedWork — unclaimed commits → Other group', () => {
  it('puts commits not referenced by any LLM group into an Other group', async () => {
    const jiraClient = makeJiraClient(['SPS-1'], []);
    mockGetJiraClient.mockReturnValue(jiraClient);

    const team = { id: 'team-1', name: 'Alpha', color: '#ff0000' };
    const commits = [
      makeCommitRow('aaaa1111efgh1234567890abcdef123456789012', 'repo-a', 'feat: claimed commit'),
      makeCommitRow('bbbb2222efgh1234567890abcdef123456789012', 'repo-b', 'fix: unclaimed commit'),
    ];

    mockDbExecute
      .mockResolvedValueOnce([[team], null])
      .mockResolvedValueOnce([[{ github_login: 'alice' }], null])
      .mockResolvedValueOnce([[], null])                   // cache miss (early check)
      .mockResolvedValueOnce([[], null])                   // epic_summaries
      .mockResolvedValueOnce([[], null])                   // commit_analyses repo discovery
      .mockResolvedValueOnce([[], null])                   // cache miss (second check)
      .mockResolvedValueOnce([commits, null])
      .mockResolvedValueOnce([[], null]);

    // LLM only claims 'aaaa1111' — 'bbbb2222' is unclaimed
    const mockCreate = jest.fn().mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ groups: [
        { name: 'Feature Work', summary: 'Features', commit_shas: ['aaaa1111'] },
      ] }) } }],
    });
    mockGetLLMClient.mockResolvedValue({ chat: { completions: { create: mockCreate } } });

    const result = await getUntrackedWork('acme', false);

    const groups = result.teams[0].groups;
    // Should have at least 2 groups: 'Feature Work' and 'Other'
    expect(groups.length).toBeGreaterThanOrEqual(2);

    const featureGroup = groups.find(g => g.name === 'Feature Work');
    expect(featureGroup).toBeDefined();
    expect(featureGroup!.commits).toHaveLength(1);
    expect(featureGroup!.commits[0].sha).toBe('aaaa1111efgh1234567890abcdef123456789012');

    const otherGroup = groups.find(g => g.name === 'Other');
    expect(otherGroup).toBeDefined();
    expect(otherGroup!.commits).toHaveLength(1);
    expect(otherGroup!.commits[0].sha).toBe('bbbb2222efgh1234567890abcdef123456789012');
  });

  it('appends unclaimed commits to existing "maintenance" group instead of creating Other', async () => {
    const jiraClient = makeJiraClient(['SPS-1'], []);
    mockGetJiraClient.mockReturnValue(jiraClient);

    const team = { id: 'team-1', name: 'Alpha', color: '#ff0000' };
    const commits = [
      makeCommitRow('aaaa1111efgh1234567890abcdef123456789012', 'repo-a', 'feat: claimed'),
      makeCommitRow('bbbb2222efgh1234567890abcdef123456789012', 'repo-b', 'fix: unclaimed'),
    ];

    mockDbExecute
      .mockResolvedValueOnce([[team], null])
      .mockResolvedValueOnce([[{ github_login: 'alice' }], null])
      .mockResolvedValueOnce([[], null])                   // cache miss (early check)
      .mockResolvedValueOnce([[], null])                   // epic_summaries
      .mockResolvedValueOnce([[], null])                   // commit_analyses repo discovery
      .mockResolvedValueOnce([[], null])                   // cache miss (second check)
      .mockResolvedValueOnce([commits, null])
      .mockResolvedValueOnce([[], null]);

    // LLM returns a "maintenance" group that claims only 'aaaa1111'
    const mockCreate = jest.fn().mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ groups: [
        { name: 'Maintenance & Fixes', summary: 'Maintenance work', commit_shas: ['aaaa1111'] },
      ] }) } }],
    });
    mockGetLLMClient.mockResolvedValue({ chat: { completions: { create: mockCreate } } });

    const result = await getUntrackedWork('acme', false);

    const groups = result.teams[0].groups;
    // Unclaimed commit should be absorbed into the maintenance group (no new Other group)
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe('Maintenance & Fixes');
    expect(groups[0].commits).toHaveLength(2);
  });
});

// ─── Test 8: invalid LLM JSON → all commits in one "All work" group ──────────

describe('getUntrackedWork — invalid LLM JSON', () => {
  it('puts all commits in one "All work" group when LLM returns invalid JSON', async () => {
    const jiraClient = makeJiraClient(['SPS-1'], []);
    mockGetJiraClient.mockReturnValue(jiraClient);

    const team = { id: 'team-1', name: 'Alpha', color: '#ff0000' };
    const commits = [
      makeCommitRow('sha-1abc1234567890', 'repo-a', 'feat: bad llm 1'),
      makeCommitRow('sha-2abc1234567890', 'repo-b', 'fix: bad llm 2'),
    ];

    const mockCreate = jest.fn().mockResolvedValue({
      choices: [{ message: { content: 'not valid json at all' } }],
    });
    mockGetLLMClient.mockResolvedValue({ chat: { completions: { create: mockCreate } } });

    mockDbExecute
      .mockResolvedValueOnce([[team], null])
      .mockResolvedValueOnce([[{ github_login: 'alice' }], null])
      .mockResolvedValueOnce([[], null])                   // cache miss (early check)
      .mockResolvedValueOnce([[], null])                   // epic_summaries
      .mockResolvedValueOnce([[], null])                   // commit_analyses repo discovery
      .mockResolvedValueOnce([[], null])                   // cache miss (second check)
      .mockResolvedValueOnce([commits, null])
      .mockResolvedValueOnce([[], null]);

    const result = await getUntrackedWork('acme', false);

    // All commits land in an "All work" fallback group — team is NOT empty
    expect(result.teams).toHaveLength(1);
    const groups = result.teams[0].groups;
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe('All work');
    expect(groups[0].commits).toHaveLength(2);
  });
});

// ─── Test 9: dedup by commit_sha ──────────────────────────────────────────────

describe('getUntrackedWork — dedup by commit_sha', () => {
  it('deduplicates commits with the same sha before passing to LLM', async () => {
    const jiraClient = makeJiraClient(['SPS-1'], []);
    mockGetJiraClient.mockReturnValue(jiraClient);

    const team = { id: 'team-1', name: 'Alpha', color: '#ff0000' };
    // Two rows with the same commit_sha — only one should be passed to LLM
    const duplicateCommits = [
      makeCommitRow('sha-dupeabcd1234567890abcdef12345678901234', 'repo-a', 'feat: dupe commit'),
      makeCommitRow('sha-dupeabcd1234567890abcdef12345678901234', 'repo-a', 'feat: dupe commit'),
      makeCommitRow('sha-uniqabcd1234567890abcdef12345678901234', 'repo-b', 'fix: unique fix'),
    ];

    mockDbExecute
      .mockResolvedValueOnce([[team], null])
      .mockResolvedValueOnce([[{ github_login: 'alice' }], null])
      .mockResolvedValueOnce([[], null])                   // cache miss (early check)
      .mockResolvedValueOnce([[], null])                   // epic_summaries
      .mockResolvedValueOnce([[], null])                   // commit_analyses repo discovery
      .mockResolvedValueOnce([[], null])                   // cache miss (second check)
      .mockResolvedValueOnce([duplicateCommits, null])
      .mockResolvedValueOnce([[], null]);

    const mockCreate = jest.fn().mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ groups: [
        { name: 'Test', summary: 'Test', commit_shas: ['sha-dupe', 'sha-uniq'] },
      ] }) } }],
    });
    mockGetLLMClient.mockResolvedValue({ chat: { completions: { create: mockCreate } } });

    const result = await getUntrackedWork('acme', false);

    // Should have 2 unique commits total (dupe deduplicated)
    const allGroupCommits = result.teams[0].groups.flatMap(g => g.commits);
    expect(allGroupCommits).toHaveLength(2);
    expect(result.teams[0].totalCommits).toBe(2);

    // Prompt should only show 2 lines (not 3)
    const { loadPrompt } = require('@/lib/prompt-loader');
    const loadPromptCall = (loadPrompt as jest.Mock).mock.calls[0];
    const commitLines: string = loadPromptCall[1].COMMITS;
    const lineCount = commitLines.split('\n').filter(Boolean).length;
    expect(lineCount).toBe(2);
  });
});

// ─── Test 10: JIRA_PROJECTS_JQL not set ───────────────────────────────────────

describe('getUntrackedWork — missing JIRA_PROJECTS_JQL', () => {
  it('falls back to SPS prefix when JIRA_PROJECTS_JQL is not set', async () => {
    delete process.env.JIRA_PROJECTS_JQL;

    const jiraClient = { searchEpics: jest.fn() };
    mockGetJiraClient.mockReturnValue(jiraClient);

    const team = { id: 'team-1', name: 'Alpha', color: '#ff0000' };
    const commits = [makeCommitRow('sha-1abc1234567890', 'repo-a', 'feat: something')];

    mockDbExecute
      .mockResolvedValueOnce([[team], null])               // teams
      .mockResolvedValueOnce([[{ github_login: 'alice' }], null]) // team_members
      .mockResolvedValueOnce([[], null])                   // cache miss (early check)
      .mockResolvedValueOnce([[], null])                   // epic_summaries
      .mockResolvedValueOnce([[], null])                   // commit_analyses repo discovery
      .mockResolvedValueOnce([[], null])                   // cache miss (second check)
      .mockResolvedValueOnce([commits, null])              // untracked commits
      .mockResolvedValueOnce([[], null]);                  // storeUntracked

    const mockCreate = jest.fn().mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ groups: [
        { name: 'Test', summary: 'Test', commit_shas: ['sha-1abc'] },
      ] }) } }],
    });
    mockGetLLMClient.mockResolvedValue({ chat: { completions: { create: mockCreate } } });

    await getUntrackedWork('acme', false);

    // searchEpics should NOT be called when JQL env var is missing
    expect(jiraClient.searchEpics).not.toHaveBeenCalled();

    // Should still run with SPS as fallback prefix
    const commitQueryCall = mockDbExecute.mock.calls[6];
    const values: any[] = commitQueryCall[1];
    expect(values).toContain('%SPS-%');
    expect(values).toContain('%SPS %');
  });
});
