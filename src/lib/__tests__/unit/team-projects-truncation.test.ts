import {
  generateTeamProjects,
  projectsTokenBudget,
  TeamProjectsUnusableError,
} from '@/lib/team-pulse/projects';

/**
 * GLOOK-51. The Integrations team (14 developers) showed an empty Current
 * Projects section on every reload. The model HAD produced good output — it was
 * truncated mid-object by a flat tokenLimit(1500), JSON.parse threw, the catch
 * returned [], and service.ts cached that [] as a success. Because the lazy
 * top-up only re-runs when the column is NULL, one truncation blanked the
 * section permanently.
 *
 * The contract: a failure must be distinguishable from "this team genuinely has
 * no projects", because only the latter may be cached.
 */

const mockCreate = jest.fn();
jest.mock('@/lib/llm-provider', () => ({
  getLLMClient: async () => ({ chat: { completions: { create: mockCreate } } }),
  LLM_MODEL: 'test-model',
  extraBodyProps: () => ({}),
  // Mirrors the real tokenLimit(): the openai provider gets
  // max_completion_tokens, everything else max_tokens. Hard-coding max_tokens
  // here would assert against a shape production may not use.
  tokenLimit: (n: number) => ({ max_tokens: n, max_completion_tokens: n }),
  promptTag: () => ({}),
  samplingParams: () => ({}),
}));
jest.mock('@/lib/prompt-loader', () => ({ loadPrompt: () => 'SYSTEM PROMPT' }));

function input(teamSize: number) {
  const team_members = Array.from({ length: teamSize }, (_, i) => `dev${i}`);
  return {
    team_members,
    commits: [{ github_login: 'dev0', committed_at: '2026-09-10T00:00:00Z', commit_message: 'x', repo: 'r' }],
    jira_issues: [],
    in_flight_prs: [],
    in_flight_branches: [],
  } as any;
}

function reply(content: string, finish_reason = 'stop') {
  return { choices: [{ finish_reason, message: { content } }] };
}

beforeEach(() => mockCreate.mockReset());

describe('projectsTokenBudget', () => {
  it('scales with team size instead of a flat cap', () => {
    // The flat 1500 is what truncated a 14-developer team.
    expect(projectsTokenBudget(14)).toBeGreaterThan(1500);
    expect(projectsTokenBudget(14)).toBeGreaterThan(projectsTokenBudget(3));
  });

  it('is bounded, and non-zero for an empty roster', () => {
    expect(projectsTokenBudget(1000)).toBeLessThanOrEqual(8000);
    expect(projectsTokenBudget(0)).toBeGreaterThan(0);
  });
});

describe('an unusable response RAISES rather than returning []', () => {
  it('raises on truncation, naming it as truncation', async () => {
    // The exact incident shape: good JSON, cut off mid-object.
    mockCreate.mockResolvedValue(reply(
      '{"projects":[{"name":"Datadog On-Call Migration","estimated_prs":20,',
      'length',
    ));
    await expect(generateTeamProjects(input(14), 'Integrations'))
      .rejects.toThrow(TeamProjectsUnusableError);
    await expect(generateTeamProjects(input(14), 'Integrations'))
      .rejects.toThrow(/truncated[\s\S]*finish_reason=length/);
  });

  it('raises on unparseable output that was NOT truncated', async () => {
    mockCreate.mockResolvedValue(reply('not json at all'));
    await expect(generateTeamProjects(input(5), 'Data'))
      .rejects.toThrow(/unparseable/);
  });

  it('reports truncation distinctly from malformed JSON', async () => {
    // Both used to log "parse error", which sent the investigation looking at
    // the model instead of the token budget.
    mockCreate.mockResolvedValue(reply('{"projects":[{"name":"x",', 'length'));
    const truncated = await generateTeamProjects(input(14), 'T').catch((e) => e.message);
    mockCreate.mockResolvedValue(reply('garbage'));
    const malformed = await generateTeamProjects(input(14), 'T').catch((e) => e.message);
    expect(truncated).toMatch(/truncated/);
    expect(malformed).not.toMatch(/truncated/);
  });
});

describe('a genuine empty result is still a success', () => {
  it('returns [] without raising when the model reports no projects', async () => {
    // Must stay cacheable — otherwise every load pays for the LLM.
    mockCreate.mockResolvedValue(reply('{"projects":[]}'));
    await expect(generateTeamProjects(input(5), 'Small'))
      .resolves.toEqual({ projects: [], cacheable: true });
  });

  it('short-circuits with no LLM call when there is nothing to cluster', async () => {
    const empty = { team_members: ['a'], commits: [], jira_issues: [], in_flight_prs: [], in_flight_branches: [] } as any;
    await expect(generateTeamProjects(empty, 'Quiet'))
      .resolves.toEqual({ projects: [], cacheable: true });
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe('a usable response is still parsed normally', () => {
  it('keeps projects whose developers are on the team', async () => {
    mockCreate.mockResolvedValue(reply(JSON.stringify({
      projects: [
        { name: 'Real', summary: 's', developers: ['dev0'], jira_count: 1, estimated_commits: 5, estimated_prs: 2 },
        { name: 'Nobody', summary: 's', developers: ['stranger'], jira_count: 0 },
      ],
    })));
    const { projects: out } = await generateTeamProjects(input(3), 'T');
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('Real');
    // last_activity is overridden from real commit data.
    expect(out[0].last_activity).toBe('2026-09-10T00:00:00Z');
  });

  it('requests a literal budget for the incident team, not just "whatever the fn returns"', async () => {
    // Asserted as a literal on purpose: comparing against
    // projectsTokenBudget(14) compares the implementation to itself, and a
    // regression to the flat 1500 that caused GLOOK-51 would still pass.
    mockCreate.mockResolvedValue(reply('{"projects":[]}'));
    await generateTeamProjects(input(14), 'Integrations');
    expect(projectsTokenBudget(14)).toBe(7600);
    expect(mockCreate.mock.calls[0][0].max_tokens).toBe(7600);
    expect(mockCreate.mock.calls[0][0].max_completion_tokens).toBe(7600);
  });
});

describe('an empty that the validator produced is served but NOT cached', () => {
  it('marks cacheable=false when the model named nobody on the team', async () => {
    // The model returned projects; every developer failed the teamSet filter
    // (e.g. display names instead of logins). Caching this would blank the
    // section permanently — GLOOK-51 arriving by a second route. Deliberately
    // not a throw: the empty may be correct, and raising buys a paid retry loop.
    mockCreate.mockResolvedValue(reply(JSON.stringify({
      projects: [{ name: 'Real work', summary: 's', developers: ['Some Person'] }],
    })));
    const res = await generateTeamProjects(input(3), 'T');
    expect(res.projects).toEqual([]);
    expect(res.cacheable).toBe(false);
  });

  it('still marks a genuinely empty model response as cacheable', async () => {
    mockCreate.mockResolvedValue(reply('{"projects":[]}'));
    const res = await generateTeamProjects(input(3), 'T');
    expect(res).toEqual({ projects: [], cacheable: true });
  });
});
