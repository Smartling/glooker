jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));
jest.mock('@/lib/jira/client');
jest.mock('@/lib/db/index', () => ({
  __esModule: true,
  default: { execute: jest.fn().mockResolvedValue([[], null]) },
}));

import { fetchProjectEpics } from '@/lib/projects/service';
import { getJiraClient } from '@/lib/jira/client';
import db from '@/lib/db/index';

const mockGetJiraClient = getJiraClient as jest.Mock;
const mockDbExecute = db.execute as jest.Mock;

// Helper to build a raw epic returned by searchEpics
function makeEpic(overrides: Partial<{
  key: string;
  summary: string;
  status: string;
  dueDate: string | null;
  assigneeDisplayName: string | null;
  assigneeEmail: string | null;
  parentKey: string | null;
  parentSummary: string | null;
  parentTypeName: string | null;
}> = {}) {
  return {
    key: 'EPIC-1',
    summary: 'My Epic',
    status: 'In Progress',
    dueDate: null,
    assigneeDisplayName: null,
    assigneeEmail: null,
    parentKey: null,
    parentSummary: null,
    parentTypeName: null,
    ...overrides,
  };
}

const noMappingsDb = () => {
  mockDbExecute
    .mockResolvedValueOnce([[], null]) // user_mappings
    .mockResolvedValueOnce([[], null]); // team_members JOIN teams
};

beforeEach(() => {
  jest.clearAllMocks();
  mockDbExecute.mockResolvedValue([[], null]);
});

describe('fetchProjectEpics', () => {
  it('throws when Jira client is not configured', async () => {
    mockGetJiraClient.mockReturnValue(null);
    await expect(fetchProjectEpics('project = FOO', 'my-org')).rejects.toThrow('Jira is not configured');
  });

  it('returns empty array when there are no epics', async () => {
    const mockSearchEpics = jest.fn().mockResolvedValue([]);
    mockGetJiraClient.mockReturnValue({ searchEpics: mockSearchEpics });
    noMappingsDb();

    const result = await fetchProjectEpics('project = FOO', 'my-org');

    expect(result).toEqual([]);
    expect(mockSearchEpics).toHaveBeenCalledTimes(1);
    expect(mockSearchEpics).toHaveBeenCalledWith('project = FOO');
  });

  it('filters out epics whose parent is not an Initiative', async () => {
    const epics = [
      makeEpic({ key: 'EPIC-1', summary: 'Has no parent', parentKey: null, parentTypeName: null }),
      makeEpic({ key: 'EPIC-2', summary: 'Story parent', parentKey: 'STORY-1', parentTypeName: 'Story' }),
      makeEpic({ key: 'EPIC-3', summary: 'Initiative parent', parentKey: 'INIT-1', parentSummary: 'My Initiative', parentTypeName: 'Initiative' }),
    ];
    const mockSearchEpics = jest.fn()
      .mockResolvedValueOnce(epics)           // first call: epics JQL
      .mockResolvedValueOnce([               // second call: initiative batch fetch
        makeEpic({ key: 'INIT-1', summary: 'My Initiative', parentKey: 'GOAL-1', parentSummary: 'My Goal', parentTypeName: 'Goal' }),
      ]);
    mockGetJiraClient.mockReturnValue({ searchEpics: mockSearchEpics });
    noMappingsDb();

    const result = await fetchProjectEpics('project = FOO', 'my-org');

    expect(result).toHaveLength(1);
    expect(result[0].key).toBe('EPIC-3');
  });

  it('resolves initiative and goal for epics with Initiative parent', async () => {
    const epics = [
      makeEpic({
        key: 'EPIC-1',
        summary: 'Alpha Epic',
        status: 'In Progress',
        dueDate: '2026-06-30',
        assigneeDisplayName: 'Jane Doe',
        assigneeEmail: 'jane@example.com',
        parentKey: 'INIT-10',
        parentSummary: 'Platform Initiative',
        parentTypeName: 'Initiative',
      }),
    ];
    const initiatives = [
      makeEpic({
        key: 'INIT-10',
        summary: 'Platform Initiative',
        parentKey: 'GOAL-5',
        parentSummary: 'Grow Platform',
        parentTypeName: 'Goal',
      }),
    ];
    const mockSearchEpics = jest.fn()
      .mockResolvedValueOnce(epics)
      .mockResolvedValueOnce(initiatives);
    mockGetJiraClient.mockReturnValue({ searchEpics: mockSearchEpics });
    noMappingsDb();

    const result = await fetchProjectEpics('issuetype = Epic', 'my-org');

    expect(result).toHaveLength(1);
    const epic = result[0];
    expect(epic.key).toBe('EPIC-1');
    expect(epic.summary).toBe('Alpha Epic');
    expect(epic.status).toBe('In Progress');
    expect(epic.dueDate).toBe('2026-06-30');
    expect(epic.assignee).toBe('Jane Doe');
    expect(epic.initiative).toEqual({ key: 'INIT-10', summary: 'Platform Initiative' });
    expect(epic.goal).toEqual({ key: 'GOAL-5', summary: 'Grow Platform' });
    expect(epic.team).toBeNull();
  });

  it('does not call searchEpics a second time when no epics have Initiative parents', async () => {
    const epics = [
      makeEpic({ key: 'EPIC-1', parentKey: 'STORY-1', parentTypeName: 'Story' }),
    ];
    const mockSearchEpics = jest.fn().mockResolvedValueOnce(epics);
    mockGetJiraClient.mockReturnValue({ searchEpics: mockSearchEpics });
    noMappingsDb();

    await fetchProjectEpics('project = BAR', 'my-org');

    // Only the initial epic search; no initiative batch call needed
    expect(mockSearchEpics).toHaveBeenCalledTimes(1);
  });

  it('maps assignee email to team via user_mappings → team_members → teams', async () => {
    const epics = [
      makeEpic({
        key: 'EPIC-1',
        summary: 'Infra Epic',
        assigneeEmail: 'alice@example.com',
        parentKey: 'INIT-1',
        parentSummary: 'Infra Initiative',
        parentTypeName: 'Initiative',
      }),
    ];
    const initiatives = [
      makeEpic({ key: 'INIT-1', summary: 'Infra Initiative', parentKey: null, parentSummary: null }),
    ];
    const mockSearchEpics = jest.fn()
      .mockResolvedValueOnce(epics)
      .mockResolvedValueOnce(initiatives);
    mockGetJiraClient.mockReturnValue({ searchEpics: mockSearchEpics });

    // DB call 1: user_mappings — email → github_login
    mockDbExecute.mockResolvedValueOnce([
      [{ github_login: 'alice-gh', jira_email: 'alice@example.com' }],
      null,
    ]);
    // DB call 2: team_members JOIN teams — github_login → team
    mockDbExecute.mockResolvedValueOnce([
      [{ github_login: 'alice-gh', name: 'Platform Team', color: '#ff0000' }],
      null,
    ]);

    const result = await fetchProjectEpics('project = FOO', 'my-org');

    expect(result).toHaveLength(1);
    expect(result[0].team).toEqual({ name: 'Platform Team', color: '#ff0000' });
  });

  it('returns null team when assignee email has no user_mapping', async () => {
    const epics = [
      makeEpic({
        key: 'EPIC-1',
        summary: 'Orphan Epic',
        assigneeEmail: 'unknown@example.com',
        parentKey: 'INIT-1',
        parentSummary: 'Some Initiative',
        parentTypeName: 'Initiative',
      }),
    ];
    const initiatives = [
      makeEpic({ key: 'INIT-1', summary: 'Some Initiative', parentKey: null, parentSummary: null }),
    ];
    const mockSearchEpics = jest.fn()
      .mockResolvedValueOnce(epics)
      .mockResolvedValueOnce(initiatives);
    mockGetJiraClient.mockReturnValue({ searchEpics: mockSearchEpics });

    // No mappings for this email
    mockDbExecute.mockResolvedValueOnce([[], null]);
    mockDbExecute.mockResolvedValueOnce([
      [{ github_login: 'alice-gh', name: 'Platform Team', color: '#ff0000' }],
      null,
    ]);

    const result = await fetchProjectEpics('project = FOO', 'my-org');

    expect(result).toHaveLength(1);
    expect(result[0].team).toBeNull();
  });

  it('returns null team when github_login has no team row', async () => {
    const epics = [
      makeEpic({
        key: 'EPIC-1',
        summary: 'Unmapped Epic',
        assigneeEmail: 'bob@example.com',
        parentKey: 'INIT-2',
        parentSummary: 'Beta Initiative',
        parentTypeName: 'Initiative',
      }),
    ];
    const initiatives = [
      makeEpic({ key: 'INIT-2', summary: 'Beta Initiative', parentKey: null, parentSummary: null }),
    ];
    const mockSearchEpics = jest.fn()
      .mockResolvedValueOnce(epics)
      .mockResolvedValueOnce(initiatives);
    mockGetJiraClient.mockReturnValue({ searchEpics: mockSearchEpics });

    // user_mappings has the email → login mapping
    mockDbExecute.mockResolvedValueOnce([
      [{ github_login: 'bob-gh', jira_email: 'bob@example.com' }],
      null,
    ]);
    // But team_members has no row for bob-gh
    mockDbExecute.mockResolvedValueOnce([[], null]);

    const result = await fetchProjectEpics('project = FOO', 'my-org');

    expect(result).toHaveLength(1);
    expect(result[0].team).toBeNull();
  });

  it('passes org to DB queries', async () => {
    const mockSearchEpics = jest.fn().mockResolvedValue([]);
    mockGetJiraClient.mockReturnValue({ searchEpics: mockSearchEpics });
    noMappingsDb();

    await fetchProjectEpics('project = FOO', 'test-org');

    expect(mockDbExecute).toHaveBeenCalledWith(
      expect.stringContaining('user_mappings'),
      ['test-org'],
    );
    expect(mockDbExecute).toHaveBeenCalledWith(
      expect.stringContaining('team_members'),
      ['test-org'],
    );
  });

  it('sorts results by goal → initiative → epic summary', async () => {
    const epics = [
      makeEpic({ key: 'EPIC-C', summary: 'C Epic', parentKey: 'INIT-2', parentSummary: 'Beta Init', parentTypeName: 'Initiative' }),
      makeEpic({ key: 'EPIC-A', summary: 'A Epic', parentKey: 'INIT-1', parentSummary: 'Alpha Init', parentTypeName: 'Initiative' }),
      makeEpic({ key: 'EPIC-B', summary: 'B Epic', parentKey: 'INIT-1', parentSummary: 'Alpha Init', parentTypeName: 'Initiative' }),
      makeEpic({ key: 'EPIC-D', summary: 'D Epic', parentKey: 'INIT-3', parentSummary: 'Gamma Init', parentTypeName: 'Initiative' }),
    ];
    // initiatives: INIT-1 and INIT-3 share same goal; INIT-2 has a different goal
    const initiatives = [
      makeEpic({ key: 'INIT-1', summary: 'Alpha Init', parentKey: 'GOAL-X', parentSummary: 'Zeta Goal' }),
      makeEpic({ key: 'INIT-2', summary: 'Beta Init', parentKey: 'GOAL-A', parentSummary: 'Aardvark Goal' }),
      makeEpic({ key: 'INIT-3', summary: 'Gamma Init', parentKey: 'GOAL-X', parentSummary: 'Zeta Goal' }),
    ];
    const mockSearchEpics = jest.fn()
      .mockResolvedValueOnce(epics)
      .mockResolvedValueOnce(initiatives);
    mockGetJiraClient.mockReturnValue({ searchEpics: mockSearchEpics });
    noMappingsDb();

    const result = await fetchProjectEpics('issuetype = Epic', 'my-org');

    // Aardvark Goal comes before Zeta Goal
    expect(result[0].key).toBe('EPIC-C'); // Aardvark Goal / Beta Init
    // Zeta Goal: Alpha Init before Gamma Init
    expect(result[1].key).toBe('EPIC-A'); // Zeta Goal / Alpha Init / A Epic
    expect(result[2].key).toBe('EPIC-B'); // Zeta Goal / Alpha Init / B Epic
    expect(result[3].key).toBe('EPIC-D'); // Zeta Goal / Gamma Init / D Epic
  });

  it('sorts epics without a goal after those with a goal', async () => {
    const epics = [
      makeEpic({ key: 'EPIC-1', summary: 'No Goal Epic', parentKey: 'INIT-1', parentSummary: 'Some Init', parentTypeName: 'Initiative' }),
      makeEpic({ key: 'EPIC-2', summary: 'Has Goal Epic', parentKey: 'INIT-2', parentSummary: 'Another Init', parentTypeName: 'Initiative' }),
    ];
    const initiatives = [
      // INIT-1 has no parent goal
      makeEpic({ key: 'INIT-1', summary: 'Some Init', parentKey: null, parentSummary: null }),
      // INIT-2 has a goal
      makeEpic({ key: 'INIT-2', summary: 'Another Init', parentKey: 'GOAL-1', parentSummary: 'Actual Goal' }),
    ];
    const mockSearchEpics = jest.fn()
      .mockResolvedValueOnce(epics)
      .mockResolvedValueOnce(initiatives);
    mockGetJiraClient.mockReturnValue({ searchEpics: mockSearchEpics });
    noMappingsDb();

    const result = await fetchProjectEpics('issuetype = Epic', 'my-org');

    // 'Actual Goal' < '\uffff' (no-goal sentinel), so Has Goal Epic should come first
    expect(result[0].key).toBe('EPIC-2');
    expect(result[1].key).toBe('EPIC-1');
  });

  it('fetches initiatives using key in (...) JQL built from unique parent keys', async () => {
    const epics = [
      makeEpic({ key: 'EPIC-1', parentKey: 'INIT-5', parentSummary: 'Init Five', parentTypeName: 'Initiative' }),
      makeEpic({ key: 'EPIC-2', parentKey: 'INIT-5', parentSummary: 'Init Five', parentTypeName: 'Initiative' }),
      makeEpic({ key: 'EPIC-3', parentKey: 'INIT-7', parentSummary: 'Init Seven', parentTypeName: 'Initiative' }),
    ];
    const mockSearchEpics = jest.fn()
      .mockResolvedValueOnce(epics)
      .mockResolvedValueOnce([]);
    mockGetJiraClient.mockReturnValue({ searchEpics: mockSearchEpics });
    noMappingsDb();

    await fetchProjectEpics('project = FOO', 'my-org');

    expect(mockSearchEpics).toHaveBeenCalledTimes(2);
    const initiativeJql: string = mockSearchEpics.mock.calls[1][0];
    // Should contain both unique parent keys exactly once each
    expect(initiativeJql).toContain('"INIT-5"');
    expect(initiativeJql).toContain('"INIT-7"');
    // INIT-5 should not appear twice
    expect(initiativeJql.split('"INIT-5"').length - 1).toBe(1);
  });
});
