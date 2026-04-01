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
}));
jest.mock('@/lib/prompt-loader', () => ({
  loadPrompt: jest.fn().mockReturnValue('test prompt'),
}));
jest.mock('@/lib/app-config/service', () => ({
  getAppConfig: jest.fn().mockReturnValue({}),
}));

import { getUntrackedWork } from '@/lib/projects/untracked';
import { getJiraClient } from '@/lib/jira/client';
import db from '@/lib/db/index';
import { getLLMClient } from '@/lib/llm-provider';

const mockGetJiraClient = getJiraClient as jest.Mock;
const mockDbExecute = db.execute as jest.Mock;
const mockGetLLMClient = getLLMClient as jest.Mock;

// Reusable LLM mock response
const mockGroup = {
  name: 'Test Group',
  summary: 'Test',
  commitCount: 5,
  repos: ['repo-a'],
  linesAdded: 100,
  linesRemoved: 50,
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

  // Default: no epic summaries, no repo rows, no teams
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
    expect(result.cached).toBe(false);
  });
});

// ─── Test 2: excludes commits matching tracked Jira prefixes ──────────────────

describe('getUntrackedWork — prefix exclusion', () => {
  it('passes dash and space NOT LIKE patterns for each tracked prefix', async () => {
    // Epics: SPS-1 (prefix SPS), child PARSER-10 (prefix PARSER)
    const jiraClient = makeJiraClient(['SPS-1'], ['PARSER-10']);
    mockGetJiraClient.mockReturnValue(jiraClient);

    // DB call sequence:
    // 1. epic_summaries => []
    // 2. commit_analyses repo discovery => []
    // 3. teams => 1 team
    // 4. team_members => 1 member
    // 5. untracked_summaries cache => [] (cache miss)
    // 6. commit_analyses untracked query => 2 commits
    // 7. storeUntracked upsert => success

    const team = { id: 'team-1', name: 'Alpha', color: '#ff0000' };
    const commits = [
      makeCommitRow('sha-1', 'repo-a', 'feat: new feature'),
      makeCommitRow('sha-2', 'repo-b', 'fix: another fix'),
    ];

    mockDbExecute
      .mockResolvedValueOnce([[], null])                   // epic_summaries
      .mockResolvedValueOnce([[], null])                   // commit_analyses repo discovery
      .mockResolvedValueOnce([[team], null])               // teams
      .mockResolvedValueOnce([[{ github_login: 'alice' }], null]) // team_members
      .mockResolvedValueOnce([[], null])                   // cache miss
      .mockResolvedValueOnce([commits, null])              // untracked commits
      .mockResolvedValueOnce([[], null]);                  // storeUntracked

    makeMockLLMClient();

    await getUntrackedWork('acme', false);

    // Find the commit_analyses query call (index 5 = the 6th call)
    const commitQueryCall = mockDbExecute.mock.calls[5];
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
    const commits = [makeCommitRow('sha-1', 'other-repo', 'feat: new thing')];

    mockDbExecute
      .mockResolvedValueOnce([epicSummaryRows, null])      // epic_summaries
      .mockResolvedValueOnce([[], null])                   // commit_analyses repo discovery
      .mockResolvedValueOnce([[team], null])               // teams
      .mockResolvedValueOnce([[{ github_login: 'alice' }], null]) // team_members
      .mockResolvedValueOnce([[], null])                   // cache miss
      .mockResolvedValueOnce([commits, null])              // untracked commits
      .mockResolvedValueOnce([[], null]);                  // storeUntracked

    makeMockLLMClient();

    await getUntrackedWork('acme', false);

    // Commit query should include NOT IN clause with tracked-repo
    const commitQueryCall = mockDbExecute.mock.calls[5];
    const sql: string = commitQueryCall[0];
    const values: any[] = commitQueryCall[1];

    expect(sql).toContain('NOT IN');
    expect(values).toContain('tracked-repo');
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
    const commits = [makeCommitRow('sha-1', 'shared-repo', 'feat: something')];

    mockDbExecute
      .mockResolvedValueOnce([epicSummaryRows, null])
      .mockResolvedValueOnce([[], null])
      .mockResolvedValueOnce([[team], null])
      .mockResolvedValueOnce([[{ github_login: 'alice' }], null])
      .mockResolvedValueOnce([[], null])
      .mockResolvedValueOnce([commits, null])
      .mockResolvedValueOnce([[], null]);

    makeMockLLMClient();

    await getUntrackedWork('acme', false);

    const commitQueryCall = mockDbExecute.mock.calls[5];
    const sql: string = commitQueryCall[0];
    const values: any[] = commitQueryCall[1];

    // shared-repo should NOT appear in the query values
    expect(values).not.toContain('shared-repo');
    // No NOT IN clause at all (since excluded repos list is empty)
    expect(sql).not.toContain('NOT IN');
  });
});

// ─── Test 4: returns cached groups when cache is fresh ────────────────────────

describe('getUntrackedWork — caching', () => {
  it('returns cached groups without calling LLM when cache is fresh', async () => {
    const jiraClient = makeJiraClient(['SPS-1'], []);
    mockGetJiraClient.mockReturnValue(jiraClient);

    const team = { id: 'team-1', name: 'Alpha', color: '#ff0000' };
    const cachedGroups = [mockGroup];
    const freshCacheRow = {
      groups_json: JSON.stringify(cachedGroups),
      total_commits: 5,
      generated_at: new Date(Date.now() - 1000 * 60).toISOString(), // 1 minute ago
    };
    const freshCommits = [makeCommitRow('sha-1', 'repo-a', 'feat: cached thing')];

    mockDbExecute
      .mockResolvedValueOnce([[], null])                         // epic_summaries
      .mockResolvedValueOnce([[], null])                         // commit_analyses repo discovery
      .mockResolvedValueOnce([[team], null])                     // teams
      .mockResolvedValueOnce([[{ github_login: 'alice' }], null]) // team_members
      .mockResolvedValueOnce([[freshCacheRow], null])            // cache hit
      .mockResolvedValueOnce([freshCommits, null]);              // re-fetch commits for cache hit

    const mockCreate = makeMockLLMClient();

    const result = await getUntrackedWork('acme', false);

    // LLM should NOT be called on a cache hit
    expect(mockCreate).not.toHaveBeenCalled();

    // Should still return the cached groups
    expect(result.teams).toHaveLength(1);
    expect(result.teams[0].groups).toEqual(cachedGroups);
    expect(result.teams[0].commits).toHaveLength(1);
  });

  it('bypasses cache and calls LLM when forceRefresh=true', async () => {
    const jiraClient = makeJiraClient(['SPS-1'], []);
    mockGetJiraClient.mockReturnValue(jiraClient);

    const team = { id: 'team-1', name: 'Alpha', color: '#ff0000' };
    const freshCommits = [makeCommitRow('sha-1', 'repo-a', 'feat: new thing')];

    mockDbExecute
      .mockResolvedValueOnce([[], null])                         // epic_summaries
      .mockResolvedValueOnce([[], null])                         // commit_analyses repo discovery
      .mockResolvedValueOnce([[team], null])                     // teams
      .mockResolvedValueOnce([[{ github_login: 'alice' }], null]) // team_members
      // No cache check call when forceRefresh=true
      .mockResolvedValueOnce([freshCommits, null])               // untracked commits
      .mockResolvedValueOnce([[], null]);                        // storeUntracked

    const mockCreate = makeMockLLMClient();

    await getUntrackedWork('acme', true);

    // LLM SHOULD be called when forceRefresh=true
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('ignores stale cache (older than 24h) and re-runs LLM', async () => {
    const jiraClient = makeJiraClient(['SPS-1'], []);
    mockGetJiraClient.mockReturnValue(jiraClient);

    const team = { id: 'team-1', name: 'Alpha', color: '#ff0000' };
    const staleCacheRow = {
      groups_json: JSON.stringify([mockGroup]),
      total_commits: 5,
      generated_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(), // 25h ago
    };
    const freshCommits = [makeCommitRow('sha-1', 'repo-a', 'feat: something new')];

    mockDbExecute
      .mockResolvedValueOnce([[], null])
      .mockResolvedValueOnce([[], null])
      .mockResolvedValueOnce([[team], null])
      .mockResolvedValueOnce([[{ github_login: 'alice' }], null])
      .mockResolvedValueOnce([[staleCacheRow], null])            // stale cache
      .mockResolvedValueOnce([freshCommits, null])               // untracked commits
      .mockResolvedValueOnce([[], null]);                        // storeUntracked

    const mockCreate = makeMockLLMClient();

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

    mockDbExecute
      .mockResolvedValueOnce([[], null])                         // epic_summaries
      .mockResolvedValueOnce([[], null])                         // commit_analyses repo discovery
      .mockResolvedValueOnce([[team], null])                     // teams
      .mockResolvedValueOnce([[{ github_login: 'alice' }], null]) // team_members
      .mockResolvedValueOnce([[], null])                         // cache miss
      .mockResolvedValueOnce([[], null]);                        // 0 untracked commits

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

    mockDbExecute
      .mockResolvedValueOnce([[], null])   // epic_summaries
      .mockResolvedValueOnce([[], null])   // commit_analyses repo discovery
      .mockResolvedValueOnce([[team], null]) // teams
      .mockResolvedValueOnce([[], null]);  // team_members → empty → team skipped

    const mockCreate = makeMockLLMClient();

    const result = await getUntrackedWork('acme', false);

    expect(mockCreate).not.toHaveBeenCalled();
    expect(result.teams).toHaveLength(0);
  });
});

// ─── Test 6: LLM response is parsed into WorkGroup objects ────────────────────

describe('getUntrackedWork — LLM parsing', () => {
  it('maps LLM groups JSON into WorkGroup objects', async () => {
    const jiraClient = makeJiraClient(['SPS-1'], []);
    mockGetJiraClient.mockReturnValue(jiraClient);

    const team = { id: 'team-1', name: 'Alpha', color: '#ff0000' };
    const commits = [makeCommitRow('sha-1', 'repo-a', 'feat: new feature')];

    mockDbExecute
      .mockResolvedValueOnce([[], null])
      .mockResolvedValueOnce([[], null])
      .mockResolvedValueOnce([[team], null])
      .mockResolvedValueOnce([[{ github_login: 'alice' }], null])
      .mockResolvedValueOnce([[], null])
      .mockResolvedValueOnce([commits, null])
      .mockResolvedValueOnce([[], null]);

    makeMockLLMClient();

    const result = await getUntrackedWork('acme', false);

    expect(result.teams).toHaveLength(1);
    const team0 = result.teams[0];
    expect(team0.name).toBe('Alpha');
    expect(team0.color).toBe('#ff0000');
    expect(team0.groups).toHaveLength(1);

    const group = team0.groups[0];
    expect(group.name).toBe('Test Group');
    expect(group.summary).toBe('Test');
    expect(group.commitCount).toBe(5);
    expect(group.repos).toEqual(['repo-a']);
    expect(group.linesAdded).toBe(100);
    expect(group.linesRemoved).toBe(50);
  });

  it('handles markdown-fenced JSON from LLM gracefully', async () => {
    const jiraClient = makeJiraClient(['SPS-1'], []);
    mockGetJiraClient.mockReturnValue(jiraClient);

    const team = { id: 'team-1', name: 'Alpha', color: '#ff0000' };
    const commits = [makeCommitRow('sha-1', 'repo-a', 'feat: something')];

    const fencedResponse = '```json\n' + JSON.stringify({ groups: [mockGroup] }) + '\n```';
    const mockCreate = jest.fn().mockResolvedValue({
      choices: [{ message: { content: fencedResponse } }],
    });
    mockGetLLMClient.mockResolvedValue({ chat: { completions: { create: mockCreate } } });

    mockDbExecute
      .mockResolvedValueOnce([[], null])
      .mockResolvedValueOnce([[], null])
      .mockResolvedValueOnce([[team], null])
      .mockResolvedValueOnce([[{ github_login: 'alice' }], null])
      .mockResolvedValueOnce([[], null])
      .mockResolvedValueOnce([commits, null])
      .mockResolvedValueOnce([[], null]);

    const result = await getUntrackedWork('acme', false);

    expect(result.teams[0].groups).toHaveLength(1);
    expect(result.teams[0].groups[0].name).toBe('Test Group');
  });

  it('returns empty groups when LLM returns invalid JSON', async () => {
    const jiraClient = makeJiraClient(['SPS-1'], []);
    mockGetJiraClient.mockReturnValue(jiraClient);

    const team = { id: 'team-1', name: 'Alpha', color: '#ff0000' };
    const commits = [makeCommitRow('sha-1', 'repo-a', 'feat: bad llm')];

    const mockCreate = jest.fn().mockResolvedValue({
      choices: [{ message: { content: 'not valid json at all' } }],
    });
    mockGetLLMClient.mockResolvedValue({ chat: { completions: { create: mockCreate } } });

    mockDbExecute
      .mockResolvedValueOnce([[], null])
      .mockResolvedValueOnce([[], null])
      .mockResolvedValueOnce([[team], null])
      .mockResolvedValueOnce([[{ github_login: 'alice' }], null])
      .mockResolvedValueOnce([[], null])
      .mockResolvedValueOnce([commits, null])
      .mockResolvedValueOnce([[], null]);

    const result = await getUntrackedWork('acme', false);

    // Team with empty groups is filtered out
    expect(result.teams).toHaveLength(0);
  });

  it('deduplicates commits with the same sha', async () => {
    const jiraClient = makeJiraClient(['SPS-1'], []);
    mockGetJiraClient.mockReturnValue(jiraClient);

    const team = { id: 'team-1', name: 'Alpha', color: '#ff0000' };
    // Two rows with the same commit_sha — only one should be passed to LLM
    const duplicateCommits = [
      makeCommitRow('sha-dupe', 'repo-a', 'feat: dupe commit'),
      makeCommitRow('sha-dupe', 'repo-a', 'feat: dupe commit'),
      makeCommitRow('sha-unique', 'repo-b', 'fix: unique fix'),
    ];

    mockDbExecute
      .mockResolvedValueOnce([[], null])
      .mockResolvedValueOnce([[], null])
      .mockResolvedValueOnce([[team], null])
      .mockResolvedValueOnce([[{ github_login: 'alice' }], null])
      .mockResolvedValueOnce([[], null])
      .mockResolvedValueOnce([duplicateCommits, null])
      .mockResolvedValueOnce([[], null]);

    makeMockLLMClient();

    const result = await getUntrackedWork('acme', false);

    // The commits returned should have 2 unique entries (sha-dupe and sha-unique)
    expect(result.teams[0].commits).toHaveLength(2);
    expect(result.teams[0].totalCommits).toBe(2);
  });
});

// ─── Test 7: JIRA_PROJECTS_JQL not set ────────────────────────────────────────

describe('getUntrackedWork — missing JIRA_PROJECTS_JQL', () => {
  it('falls back to SPS prefix when JIRA_PROJECTS_JQL is not set', async () => {
    delete process.env.JIRA_PROJECTS_JQL;

    const jiraClient = { searchEpics: jest.fn() };
    mockGetJiraClient.mockReturnValue(jiraClient);

    const team = { id: 'team-1', name: 'Alpha', color: '#ff0000' };
    const commits = [makeCommitRow('sha-1', 'repo-a', 'feat: something')];

    mockDbExecute
      .mockResolvedValueOnce([[], null])
      .mockResolvedValueOnce([[], null])
      .mockResolvedValueOnce([[team], null])
      .mockResolvedValueOnce([[{ github_login: 'alice' }], null])
      .mockResolvedValueOnce([[], null])
      .mockResolvedValueOnce([commits, null])
      .mockResolvedValueOnce([[], null]);

    makeMockLLMClient();

    await getUntrackedWork('acme', false);

    // searchEpics should NOT be called when JQL env var is missing
    expect(jiraClient.searchEpics).not.toHaveBeenCalled();

    // Should still run with SPS as fallback prefix
    const commitQueryCall = mockDbExecute.mock.calls[5];
    const values: any[] = commitQueryCall[1];
    expect(values).toContain('%SPS-%');
    expect(values).toContain('%SPS %');
  });
});
