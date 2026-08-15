jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));
jest.mock('@/lib/projects/service', () => ({ fetchProjectEpics: jest.fn() }));
jest.mock('@/lib/projects/sources', () => ({
  resolveProjectSources: jest.fn(),
  resolveBoardConfig: jest.fn(),
  buildTeamJql: jest.fn(() => 'BUILT_JQL'),
}));

import { NextRequest } from 'next/server';
import { GET } from '@/app/api/projects/route';
import { fetchProjectEpics } from '@/lib/projects/service';
import { resolveProjectSources, resolveBoardConfig, buildTeamJql } from '@/lib/projects/sources';
import { DEFAULT_BOARD_CONFIG } from '@/lib/teams/board-config';

const mockFetch = fetchProjectEpics as jest.Mock;
const mockSources = resolveProjectSources as jest.Mock;
const mockCfg = resolveBoardConfig as jest.Mock;
const mockBuild = buildTeamJql as jest.Mock;

const RESEARCH_CFG = { ...DEFAULT_BOARD_CONFIG, jiraProjectKeys: ['RND'], hierarchy: 'owner' as const };

const req = (qs: string) => new NextRequest(`http://localhost/api/projects${qs}`);

let prevEnabled: string | undefined;
let prevJql: string | undefined;

beforeAll(() => {
  prevEnabled = process.env.JIRA_ENABLED;
  prevJql = process.env.JIRA_PROJECTS_JQL;
});

afterAll(() => {
  if (prevEnabled === undefined) delete process.env.JIRA_ENABLED; else process.env.JIRA_ENABLED = prevEnabled;
  if (prevJql === undefined) delete process.env.JIRA_PROJECTS_JQL; else process.env.JIRA_PROJECTS_JQL = prevJql;
});

beforeEach(() => {
  jest.clearAllMocks();
  process.env.JIRA_ENABLED = 'true';
  process.env.JIRA_PROJECTS_JQL = 'project = SPS AND issuetype = Epic AND status = "In Progress"';
  mockFetch.mockResolvedValue([]);
  mockSources.mockResolvedValue([{ kind: 'global', jql: 'project = SPS' }]);
  mockCfg.mockResolvedValue(null);
  mockBuild.mockReturnValue('BUILT_JQL');
});

describe('GET /api/projects', () => {
  it('400s without an org', async () => {
    expect((await GET(req(''))).status).toBe(400);
  });

  it('404s when Jira is disabled', async () => {
    process.env.JIRA_ENABLED = 'false';
    expect((await GET(req('?org=o'))).status).toBe(404);
  });

  it('returns boardConfig null for the unfiltered board', async () => {
    const body = await (await GET(req('?org=o'))).json();
    expect(body.boardConfig).toBeNull();
  });

  it('returns the team boardConfig when a configured team is filtered', async () => {
    mockCfg.mockResolvedValue(RESEARCH_CFG);
    const body = await (await GET(req('?org=o&team=Research'))).json();
    expect(body.boardConfig.hierarchy).toBe('owner');
  });

  it('passes the team filter through to source resolution', async () => {
    await GET(req('?org=o&team=Research'));
    expect(mockSources).toHaveBeenCalledWith('o', expect.objectContaining({ team: 'Research' }));
  });

  it('accepts Backlog as a status and passes it as the tab', async () => {
    mockSources.mockResolvedValue([{
      kind: 'team',
      team: { name: 'Research', color: '#7C3AED' },
      projectKeys: ['RND'],
      config: RESEARCH_CFG,
    }]);

    const res = await GET(req('?org=o&team=Research&status=Backlog'));

    expect(res.status).toBe(200);
    expect(mockBuild).toHaveBeenCalledWith(['RND'], 'Backlog', RESEARCH_CFG);
  });

  it('calls fetchProjectEpics with the built JQL and the provenance team', async () => {
    mockSources.mockResolvedValue([{
      kind: 'team',
      team: { name: 'Research', color: '#7C3AED' },
      projectKeys: ['RND'],
      config: RESEARCH_CFG,
    }]);

    await GET(req('?org=o&team=Research'));

    expect(mockFetch).toHaveBeenCalledWith('BUILT_JQL', 'o', {
      provenanceTeam: { name: 'Research', color: '#7C3AED' },
    });
  });

  it('runs the global source with no provenance team', async () => {
    await GET(req('?org=o'));
    expect(mockFetch).toHaveBeenCalledWith('project = SPS', 'o', { provenanceTeam: null });
  });

  it('merges epics from several sources, deduping by key with provenance winning', async () => {
    mockSources.mockResolvedValue([
      { kind: 'global', jql: 'project = SPS' },
      { kind: 'team', team: { name: 'Research', color: '#7C3AED' }, projectKeys: ['RND'], config: RESEARCH_CFG },
    ]);
    mockFetch
      .mockResolvedValueOnce([{ key: 'SPS-1', team: null }, { key: 'RND-1', team: null }])
      .mockResolvedValueOnce([{ key: 'RND-1', team: { name: 'Research', color: '#7C3AED' } }]);

    const body = await (await GET(req('?org=o'))).json();

    expect(body.epics).toHaveLength(2);
    const rnd = body.epics.find((e: any) => e.key === 'RND-1');
    expect(rnd.team).toEqual({ name: 'Research', color: '#7C3AED' });
  });

  it('still 200s when only team sources exist and the global JQL is unset', async () => {
    delete process.env.JIRA_PROJECTS_JQL;
    mockSources.mockResolvedValue([{
      kind: 'team', team: { name: 'Research', color: '#7C3AED' },
      projectKeys: ['RND'], config: RESEARCH_CFG,
    }]);

    expect((await GET(req('?org=o&team=Research'))).status).toBe(200);
  });

  it('404s when neither a global JQL nor any team source exists', async () => {
    delete process.env.JIRA_PROJECTS_JQL;
    mockSources.mockResolvedValue([]);
    expect((await GET(req('?org=o'))).status).toBe(404);
  });

  it('500s with the error message when a source throws', async () => {
    mockFetch.mockRejectedValue(new Error('Jira exploded'));
    const res = await GET(req('?org=o'));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('Jira exploded');
  });
});

describe('GET /api/projects — global JQL tab rewriting', () => {
  it('In Progress: passes JIRA_PROJECTS_JQL through unmodified', async () => {
    await GET(req('?org=o'));
    expect(mockSources).toHaveBeenCalledWith('o', expect.objectContaining({
      globalJql: 'project = SPS AND issuetype = Epic AND status = "In Progress"',
    }));
  });

  it('Rollout: rewrites the status clause to Rollout', async () => {
    await GET(req('?org=o&status=Rollout'));
    expect(mockSources).toHaveBeenCalledWith('o', expect.objectContaining({
      globalJql: 'project = SPS AND issuetype = Epic AND status = "Rollout"',
    }));
  });

  it('Done: rewrites the clause to statusCategory = "Done" and appends the 30d window', async () => {
    await GET(req('?org=o&status=Done'));
    expect(mockSources).toHaveBeenCalledWith('o', expect.objectContaining({
      globalJql: 'project = SPS AND issuetype = Epic AND statusCategory = "Done" AND updated >= -30d',
    }));
  });

  it('Backlog: globalJql is null', async () => {
    await GET(req('?org=o&status=Backlog'));
    expect(mockSources).toHaveBeenCalledWith('o', expect.objectContaining({
      globalJql: null,
    }));
  });
});
