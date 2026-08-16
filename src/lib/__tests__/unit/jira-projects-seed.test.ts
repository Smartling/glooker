jest.mock('@/lib/jira-projects/service', () => ({
  listJiraProjects: jest.fn(),
  createJiraProject: jest.fn(),
}));

import { parseLegacyJql, ensureSeedProject } from '@/lib/jira-projects/seed';
import { listJiraProjects, createJiraProject } from '@/lib/jira-projects/service';

const mockList = listJiraProjects as jest.Mock;
const mockCreate = createJiraProject as jest.Mock;

let prev: string | undefined;
beforeAll(() => { prev = process.env.JIRA_PROJECTS_JQL; });
afterAll(() => {
  if (prev === undefined) delete process.env.JIRA_PROJECTS_JQL;
  else process.env.JIRA_PROJECTS_JQL = prev;
});

beforeEach(() => {
  jest.clearAllMocks();
  mockList.mockResolvedValue([]);
});

describe('parseLegacyJql', () => {
  it('extracts the key and status from the shipped SPS form', () => {
    expect(parseLegacyJql('project = SPS AND issuetype = Epic AND status = "In Progress"'))
      .toEqual({ projectKey: 'SPS', activeStatus: 'In Progress' });
  });

  it('handles a quoted project key', () => {
    expect(parseLegacyJql('project = "SPS" AND status = "In Progress"')!.projectKey).toBe('SPS');
  });

  it('returns null when there is no project clause', () => {
    expect(parseLegacyJql('issuetype = Epic AND status = "In Progress"')).toBeNull();
  });

  it('returns null when there is no status clause', () => {
    expect(parseLegacyJql('project = SPS AND issuetype = Epic')).toBeNull();
  });

  it('returns null for a statusCategory-only form it cannot map', () => {
    expect(parseLegacyJql('project = SPS AND statusCategory = "In Progress"')).toBeNull();
  });
});

describe('ensureSeedProject', () => {
  it('seeds one project from the legacy JQL when the table is empty', async () => {
    process.env.JIRA_PROJECTS_JQL = 'project = SPS AND issuetype = Epic AND status = "In Progress"';
    await ensureSeedProject('o');
    expect(mockCreate).toHaveBeenCalledWith('o', {
      projectKey: 'SPS',
      displayName: 'SPS',
      activeStatus: 'In Progress',
      middleStatus: 'Rollout',
      hierarchy: 'goal-initiative',
      position: 0,
    });
  });

  it('does nothing when projects already exist', async () => {
    process.env.JIRA_PROJECTS_JQL = 'project = SPS AND status = "In Progress"';
    mockList.mockResolvedValue([{ id: 'p1' }]);
    await ensureSeedProject('o');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('does nothing when the env var is unset', async () => {
    delete process.env.JIRA_PROJECTS_JQL;
    await ensureSeedProject('o');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('does nothing when the JQL cannot be parsed', async () => {
    process.env.JIRA_PROJECTS_JQL = 'issuetype = Epic';
    await ensureSeedProject('o');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('swallows a create failure rather than breaking the page', async () => {
    process.env.JIRA_PROJECTS_JQL = 'project = SPS AND status = "In Progress"';
    mockCreate.mockRejectedValue(new Error('db down'));
    await expect(ensureSeedProject('o')).resolves.toBeUndefined();
  });
});
