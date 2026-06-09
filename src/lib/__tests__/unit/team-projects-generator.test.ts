jest.mock('@/lib/llm-provider', () => ({
  __esModule: true,
  getLLMClient: jest.fn(),
  LLM_MODEL: 'mock-model',
  extraBodyProps: () => ({}),
  tokenLimit: () => ({ max_tokens: 1024 }),
  promptTag: (n: string) => ({ __prompt_id: n }),
}));

import { getLLMClient } from '@/lib/llm-provider';
import { generateTeamProjects } from '@/lib/team-pulse/projects';
import type { TeamProjectsInput } from '@/lib/team-pulse/data';

const makeClient = (jsonResponse: string) => ({
  chat: { completions: { create: jest.fn().mockResolvedValue({
    choices: [{ message: { content: jsonResponse } }],
  })}},
});

const mockGetLLMClient = getLLMClient as jest.Mock;

const baseInput = (): TeamProjectsInput => ({
  team_members: ['alice', 'bob'],
  commits: [
    { sha: 'a1', repo: 'r1', pr_number: 1, message_first_line: 'feat: x',
      github_login: 'alice', lines: 10, committed_at: '2026-05-20T10:00:00Z' },
    { sha: 'b1', repo: 'r1', pr_number: 2, message_first_line: 'fix: y',
      github_login: 'bob',   lines: 5,  committed_at: '2026-05-21T11:00:00Z' },
  ],
  jira_issues: [],
  in_flight_prs: [],
  in_flight_branches: [],
});

describe('generateTeamProjects', () => {
  beforeEach(() => mockGetLLMClient.mockReset());

  it('short-circuits to [] when both commits and jira are empty (no LLM call)', async () => {
    const out = await generateTeamProjects({ team_members: ['alice'], commits: [], jira_issues: [], in_flight_prs: [], in_flight_branches: [] });
    expect(out).toEqual([]);
    expect(mockGetLLMClient).not.toHaveBeenCalled();
  });

  it('returns parsed projects on a well-formed LLM response', async () => {
    mockGetLLMClient.mockResolvedValueOnce(makeClient(JSON.stringify({
      projects: [
        { name: 'P1', summary: 's', developers: ['alice', 'bob'],
          jira_count: 0, estimated_commits: 2, estimated_prs: 2,
          last_activity: '2026-05-21T11:00:00Z' },
      ],
    })));
    const out = await generateTeamProjects(baseInput());
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('P1');
    expect(out[0].developers).toEqual(['alice', 'bob']);
  });

  it('strips hallucinated developers not in team_members', async () => {
    mockGetLLMClient.mockResolvedValueOnce(makeClient(JSON.stringify({
      projects: [
        { name: 'P1', summary: 's',
          developers: ['alice', 'mallory', 'bob'],
          jira_count: 0, estimated_commits: 2, estimated_prs: 2,
          last_activity: '2026-05-21T11:00:00Z' },
      ],
    })));
    const out = await generateTeamProjects(baseInput());
    expect(out[0].developers).toEqual(['alice', 'bob']);
  });

  it('drops projects whose developers list is empty after filtering', async () => {
    mockGetLLMClient.mockResolvedValueOnce(makeClient(JSON.stringify({
      projects: [
        { name: 'BAD', summary: 's', developers: ['mallory'],
          jira_count: 0, estimated_commits: 2, estimated_prs: 2,
          last_activity: '2026-05-21T11:00:00Z' },
        { name: 'OK',  summary: 's', developers: ['alice'],
          jira_count: 0, estimated_commits: 1, estimated_prs: 1,
          last_activity: '2026-05-20T10:00:00Z' },
      ],
    })));
    const out = await generateTeamProjects(baseInput());
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('OK');
  });

  it('overrides last_activity from the actual max committed_at in the cluster', async () => {
    // LLM returns a wrong last_activity; we should overwrite with the real max.
    mockGetLLMClient.mockResolvedValueOnce(makeClient(JSON.stringify({
      projects: [
        { name: 'P1', summary: 's', developers: ['alice', 'bob'],
          jira_count: 0, estimated_commits: 2, estimated_prs: 2,
          last_activity: '2020-01-01T00:00:00Z' },
      ],
    })));
    const out = await generateTeamProjects(baseInput());
    // Max committed_at across the 2 baseInput commits is bob's '2026-05-21T11:00:00Z'
    expect(out[0].last_activity).toBe('2026-05-21T11:00:00Z');
  });

  it('strips ```json fences from the LLM response', async () => {
    mockGetLLMClient.mockResolvedValueOnce(makeClient('```json\n' + JSON.stringify({
      projects: [
        { name: 'P1', summary: 's', developers: ['alice'],
          jira_count: 0, estimated_commits: 1, estimated_prs: 1,
          last_activity: '2026-05-20T10:00:00Z' },
      ],
    }) + '\n```'));
    const out = await generateTeamProjects(baseInput());
    expect(out).toHaveLength(1);
  });

  it('includes IN-FLIGHT WORK block in prompt when in-flight data is present', async () => {
    const client = makeClient(JSON.stringify({
      projects: [{ name: 'P1', summary: 's', developers: ['alice'],
        jira_count: 0, estimated_commits: 1, estimated_prs: 1,
        last_activity: '2026-05-20T10:00:00Z' }],
    }));
    mockGetLLMClient.mockResolvedValueOnce(client);

    const input: TeamProjectsInput = {
      ...baseInput(),
      in_flight_prs: [
        { repo: 'r1', title: 'Add jobs pagination', author: 'alice', additions: 120, deletions: 5, is_draft: false },
      ],
      in_flight_branches: [],
    };

    await generateTeamProjects(input);

    const callArgs = client.chat.completions.create.mock.calls[0][0];
    const systemPrompt: string = callArgs.messages[0].content;
    expect(systemPrompt).toContain('IN-FLIGHT WORK');
    expect(systemPrompt).toContain('Add jobs pagination');
    expect(systemPrompt).toContain('OPEN PRs (1)');
  });

  it('omits IN-FLIGHT WORK block when in_flight_prs and in_flight_branches are empty', async () => {
    const client = makeClient(JSON.stringify({
      projects: [{ name: 'P1', summary: 's', developers: ['alice'],
        jira_count: 0, estimated_commits: 1, estimated_prs: 1,
        last_activity: '2026-05-20T10:00:00Z' }],
    }));
    mockGetLLMClient.mockResolvedValueOnce(client);

    await generateTeamProjects(baseInput());

    const callArgs = client.chat.completions.create.mock.calls[0][0];
    const systemPrompt: string = callArgs.messages[0].content;
    expect(systemPrompt).not.toContain('IN-FLIGHT WORK');
  });
});
