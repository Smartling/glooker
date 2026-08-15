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

function rawEpic(over: Record<string, unknown> = {}) {
  return {
    key: 'RND-1181', summary: 'Style Rules for AI Rule Validation',
    status: 'In Progress', dueDate: '2026-09-18',
    assigneeDisplayName: 'Daria Akselrod', assigneeEmail: 'dakselrod@smartling.com',
    parentKey: null, parentSummary: null, parentTypeName: null,
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDbExecute.mockResolvedValue([[], null]);
});

const RESEARCH = { name: 'Research', color: '#7C3AED' };

describe('provenance attribution', () => {
  it('attributes every epic to the provenance team, with no user_mappings row', async () => {
    mockGetJiraClient.mockReturnValue({ searchEpics: jest.fn().mockResolvedValue([rawEpic()]) });
    // No user_mappings and no team_members at all.
    mockDbExecute.mockResolvedValueOnce([[], null]).mockResolvedValueOnce([[], null]);

    const result = await fetchProjectEpics('project = RND', 'my-org', { provenanceTeam: RESEARCH });

    expect(result[0].team).toEqual(RESEARCH);
  });

  it('attributes an unassigned epic to the provenance team', async () => {
    mockGetJiraClient.mockReturnValue({
      searchEpics: jest.fn().mockResolvedValue([
        rawEpic({ key: 'RND-1186', assigneeEmail: null, assigneeDisplayName: null }),
      ]),
    });
    mockDbExecute.mockResolvedValueOnce([[], null]).mockResolvedValueOnce([[], null]);

    const result = await fetchProjectEpics('project = RND', 'my-org', { provenanceTeam: RESEARCH });

    expect(result[0].team).toEqual(RESEARCH);
    expect(result[0].assignee).toBeNull();
  });

  it('provenance beats the assignee map when they disagree', async () => {
    mockGetJiraClient.mockReturnValue({ searchEpics: jest.fn().mockResolvedValue([rawEpic()]) });
    mockDbExecute
      .mockResolvedValueOnce([[{ github_login: 'dakselrod-smartling', jira_email: 'dakselrod@smartling.com' }], null])
      .mockResolvedValueOnce([[{ github_login: 'dakselrod-smartling', name: 'Platform', color: '#2563EB' }], null]);

    const result = await fetchProjectEpics('project = RND', 'my-org', { provenanceTeam: RESEARCH });

    expect(result[0].team).toEqual(RESEARCH);
  });

  it('falls back to the assignee map when no provenance team is given', async () => {
    mockGetJiraClient.mockReturnValue({ searchEpics: jest.fn().mockResolvedValue([rawEpic()]) });
    mockDbExecute
      .mockResolvedValueOnce([[{ github_login: 'dakselrod-smartling', jira_email: 'dakselrod@smartling.com' }], null])
      .mockResolvedValueOnce([[{ github_login: 'dakselrod-smartling', name: 'Platform', color: '#2563EB' }], null]);

    const result = await fetchProjectEpics('project = RND', 'my-org');

    expect(result[0].team).toEqual({ name: 'Platform', color: '#2563EB' });
  });
});
