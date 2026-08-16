jest.mock('@/lib/jira-projects/service', () => ({
  listJiraProjects: jest.fn(),
  createJiraProject: jest.fn(),
}));
jest.mock('@/lib/db', () => ({ __esModule: true, default: { execute: jest.fn() } }));

import { parseLegacyJql, ensureSeedProject } from '@/lib/jira-projects/seed';
import { listJiraProjects, createJiraProject } from '@/lib/jira-projects/service';
import db from '@/lib/db';

const mockList = listJiraProjects as jest.Mock;
const mockCreate = createJiraProject as jest.Mock;
const mockExecute = db.execute as jest.Mock;

let prev: string | undefined;
beforeAll(() => { prev = process.env.JIRA_PROJECTS_JQL; });
afterAll(() => {
  if (prev === undefined) delete process.env.JIRA_PROJECTS_JQL;
  else process.env.JIRA_PROJECTS_JQL = prev;
});

beforeEach(() => {
  jest.clearAllMocks();
  mockList.mockResolvedValue([]);
  // Default: the org is a known one (has a team), so the org-gating check in
  // FIX 2 doesn't interfere with tests that aren't about it.
  mockExecute.mockResolvedValue([[{ 1: 1 }], undefined]);
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

  describe('org gating', () => {
    beforeEach(() => {
      process.env.JIRA_PROJECTS_JQL = 'project = SPS AND issuetype = Epic AND status = "In Progress"';
    });

    it('seeds when the org is present in teams', async () => {
      mockExecute.mockImplementation(async (sql: string) => {
        if (sql.includes('FROM teams')) return [[{ 1: 1 }], undefined];
        return [[], undefined];
      });
      await ensureSeedProject('o');
      expect(mockCreate).toHaveBeenCalled();
    });

    it('seeds when the org is present only in reports', async () => {
      mockExecute.mockImplementation(async (sql: string) => {
        if (sql.includes('FROM teams')) return [[], undefined];
        if (sql.includes('FROM reports')) return [[{ 1: 1 }], undefined];
        return [[], undefined];
      });
      await ensureSeedProject('o');
      expect(mockCreate).toHaveBeenCalled();
      // Both queries run, teams first, since the org wasn't found there.
      expect(mockExecute).toHaveBeenCalledWith(expect.stringContaining('FROM teams'), ['o']);
      expect(mockExecute).toHaveBeenCalledWith(expect.stringContaining('FROM reports'), ['o']);
    });

    it('does not insert for an org present in neither teams nor reports', async () => {
      mockExecute.mockResolvedValue([[], undefined]);
      await ensureSeedProject('totally-made-up-org');
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('never throws when the org-gating query itself fails', async () => {
      mockExecute.mockRejectedValue(new Error('db down'));
      await expect(ensureSeedProject('o')).resolves.toBeUndefined();
      expect(mockCreate).not.toHaveBeenCalled();
    });
  });
});
