jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));
jest.mock('@/lib/projects/service', () => ({ fetchProjectEpics: jest.fn() }));
jest.mock('@/lib/jira-projects/service', () => ({
  listJiraProjects: jest.fn(),
}));
jest.mock('@/lib/jira-projects/seed', () => {
  const actual = jest.requireActual('@/lib/jira-projects/seed');
  return { ...actual, ensureSeedProject: jest.fn() };
});

import { NextRequest } from 'next/server';
import { GET } from '@/app/api/projects/route';
import { fetchProjectEpics } from '@/lib/projects/service';
import { listJiraProjects } from '@/lib/jira-projects/service';
import { ensureSeedProject } from '@/lib/jira-projects/seed';
import type { JiraProject } from '@/lib/jira-projects/types';

const mockFetch = fetchProjectEpics as jest.Mock;
const mockList = listJiraProjects as jest.Mock;
const mockSeed = ensureSeedProject as jest.Mock;

const SPS: JiraProject = {
  id: 'a', org: 'o', projectKey: 'SPS', displayName: 'Smartling Platform',
  activeStatus: 'In Progress', middleStatus: 'Rollout', hierarchy: 'goal-initiative', position: 0,
};
const RND: JiraProject = {
  id: 'b', org: 'o', projectKey: 'RND', displayName: 'LanguageAI Research',
  activeStatus: 'In Progress', middleStatus: 'Backlog', hierarchy: 'owner', position: 1,
};

const req = (qs: string) => new NextRequest(`http://localhost/api/projects${qs}`);

let prevEnabled: string | undefined;
let prevJql: string | undefined;
beforeAll(() => {
  prevEnabled = process.env.JIRA_ENABLED;
  prevJql = process.env.JIRA_PROJECTS_JQL;
});
afterAll(() => {
  if (prevEnabled === undefined) delete process.env.JIRA_ENABLED;
  else process.env.JIRA_ENABLED = prevEnabled;
  if (prevJql === undefined) delete process.env.JIRA_PROJECTS_JQL;
  else process.env.JIRA_PROJECTS_JQL = prevJql;
});

beforeEach(() => {
  jest.clearAllMocks();
  process.env.JIRA_ENABLED = 'true';
  delete process.env.JIRA_PROJECTS_JQL;
  mockFetch.mockResolvedValue([]);
  mockList.mockResolvedValue([SPS, RND]);
  mockSeed.mockResolvedValue(undefined);
});

describe('GET /api/projects', () => {
  it('400s without an org', async () => {
    expect((await GET(req(''))).status).toBe(400);
  });

  it('404s when Jira is disabled', async () => {
    process.env.JIRA_ENABLED = 'false';
    expect((await GET(req('?org=o'))).status).toBe(404);
  });

  it('runs the self-migration seed before reading the list', async () => {
    await GET(req('?org=o'));
    expect(mockSeed).toHaveBeenCalledWith('o');
    // Ordering is load-bearing: if the list is read first, a deployment
    // configured only with the legacy JIRA_PROJECTS_JQL sees an empty table
    // and 404s instead of migrating itself.
    expect(mockSeed.mock.invocationCallOrder[0])
      .toBeLessThan(mockList.mock.invocationCallOrder[0]);
  });

  it('404s when no projects are configured', async () => {
    mockList.mockResolvedValue([]);
    const res = await GET(req('?org=o'));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/no jira projects/i);
  });

  it('defaults to the lowest-position project when none is named', async () => {
    await GET(req('?org=o'));
    expect(mockFetch).toHaveBeenCalledWith(
      'project = "SPS" AND issuetype = Epic AND status = "In Progress"', 'o',
    );
  });

  it('404s for an unknown project key', async () => {
    // Driven entirely through mockList (the route resolves the project from
    // the already-fetched `configured` list, not a separate lookup) — 'NOPE'
    // is simply absent from it.
    expect((await GET(req('?org=o&project=NOPE'))).status).toBe(404);
  });

  it('builds the named project active tab', async () => {
    await GET(req('?org=o&project=RND&status=active'));
    expect(mockFetch).toHaveBeenCalledWith(
      'project = "RND" AND issuetype = Epic AND status = "In Progress"', 'o',
    );
  });

  it('builds the middle tab from the project middle status', async () => {
    await GET(req('?org=o&project=RND&status=middle'));
    expect(mockFetch).toHaveBeenCalledWith(
      'project = "RND" AND issuetype = Epic AND status = "Backlog"', 'o',
    );
  });

  it('builds the done tab identically for every project', async () => {
    await GET(req('?org=o&project=SPS&status=done'));
    expect(mockFetch).toHaveBeenCalledWith(
      'project = "SPS" AND issuetype = Epic AND statusCategory = "Done" AND updated >= -30d', 'o',
    );
  });

  it('returns an empty list rather than 500 when the middle tab is not configured', async () => {
    // The project is resolved from the `configured` list, which is where the
    // no-middle-tab shape must come from — there is no separate lookup.
    mockList.mockResolvedValue([SPS, { ...RND, middleStatus: null }]);
    const res = await GET(req('?org=o&project=RND&status=middle'));
    expect(res.status).toBe(200);
    expect((await res.json()).epics).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns the project row alongside the epics', async () => {
    const body = await (await GET(req('?org=o&project=RND'))).json();
    expect(body.project.projectKey).toBe('RND');
    expect(body.project.hierarchy).toBe('owner');
  });

  it('calls fetchProjectEpics with exactly two arguments', async () => {
    await GET(req('?org=o'));
    expect(mockFetch.mock.calls[0]).toHaveLength(2);
  });

  it('500s with the error message when the fetch throws', async () => {
    mockFetch.mockRejectedValue(new Error('Jira exploded'));
    const res = await GET(req('?org=o'));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('Jira exploded');
  });

  describe('isLegacy on the response project', () => {
    it('is true for the project JIRA_PROJECTS_JQL names', async () => {
      process.env.JIRA_PROJECTS_JQL = 'project = SPS AND issuetype = Epic AND status = "In Progress"';
      const body = await (await GET(req('?org=o&project=SPS'))).json();
      expect(body.project.isLegacy).toBe(true);
    });

    it('is false for a different project', async () => {
      process.env.JIRA_PROJECTS_JQL = 'project = SPS AND issuetype = Epic AND status = "In Progress"';
      const body = await (await GET(req('?org=o&project=RND'))).json();
      expect(body.project.isLegacy).toBe(false);
    });

    it('is false when JIRA_PROJECTS_JQL is unset', async () => {
      delete process.env.JIRA_PROJECTS_JQL;
      const body = await (await GET(req('?org=o&project=SPS'))).json();
      expect(body.project.isLegacy).toBe(false);
    });

    it('is false when JIRA_PROJECTS_JQL is unparseable', async () => {
      process.env.JIRA_PROJECTS_JQL = 'statusCategory = "In Progress"';
      const body = await (await GET(req('?org=o&project=SPS'))).json();
      expect(body.project.isLegacy).toBe(false);
    });
  });
});
