jest.mock('@/lib/db/index', () => ({
  __esModule: true,
  default: { execute: jest.fn().mockResolvedValue([[], null]) },
}));

import {
  listJiraProjects, createJiraProject, updateJiraProject, deleteJiraProject,
  JiraProjectDuplicateError, JiraProjectNotFoundError,
} from '@/lib/jira-projects/service';
import db from '@/lib/db/index';

const mockExecute = db.execute as jest.Mock;

const row = {
  id: 'p1', org: 'o', project_key: 'RND', display_name: 'LanguageAI Research',
  active_status: 'In Progress', middle_status: 'Backlog', hierarchy: 'owner', position: 1,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockExecute.mockResolvedValue([[], null]);
});

describe('listJiraProjects', () => {
  it('maps snake_case rows onto the JiraProject shape', async () => {
    mockExecute.mockResolvedValueOnce([[row], null]);
    const [p] = await listJiraProjects('o');
    expect(p).toEqual({
      id: 'p1', org: 'o', projectKey: 'RND', displayName: 'LanguageAI Research',
      activeStatus: 'In Progress', middleStatus: 'Backlog', hierarchy: 'owner', position: 1,
    });
  });

  it('orders by position', async () => {
    await listJiraProjects('o');
    expect(mockExecute.mock.calls[0][0]).toMatch(/ORDER BY position/i);
  });

  it('returns an empty array when nothing is configured', async () => {
    expect(await listJiraProjects('o')).toEqual([]);
  });

  it('normalises a null middle_status to null', async () => {
    mockExecute.mockResolvedValueOnce([[{ ...row, middle_status: null }], null]);
    expect((await listJiraProjects('o'))[0].middleStatus).toBeNull();
  });
});

describe('createJiraProject', () => {
  it('validates before inserting', async () => {
    await expect(createJiraProject('o', { projectKey: 'bad key!', activeStatus: 'In Progress' }))
      .rejects.toThrow(/projectKey/);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('inserts the validated row and returns it', async () => {
    const p = await createJiraProject('o', {
      projectKey: 'rnd', activeStatus: 'In Progress', middleStatus: 'Backlog', hierarchy: 'owner',
    });
    expect(p.projectKey).toBe('RND');
    expect(p.displayName).toBe('RND');
    expect(mockExecute.mock.calls[0][0]).toMatch(/INSERT INTO jira_projects/i);
  });

  it('maps a unique violation to JiraProjectDuplicateError', async () => {
    mockExecute.mockRejectedValueOnce({ code: 'ER_DUP_ENTRY' });
    await expect(createJiraProject('o', { projectKey: 'RND', activeStatus: 'In Progress' }))
      .rejects.toThrow(JiraProjectDuplicateError);
  });
});

describe('updateJiraProject', () => {
  it('validates and writes every field', async () => {
    mockExecute.mockResolvedValueOnce([[{ id: 'p1' }], null]);
    await updateJiraProject('p1', {
      projectKey: 'RND', activeStatus: 'In Progress', middleStatus: null, hierarchy: 'owner', position: 2,
    });
    const update = mockExecute.mock.calls.find(c => /UPDATE jira_projects/i.test(c[0]));
    expect(update).toBeDefined();
    expect(update![1]).toContain('RND');
    expect(update![1]).toContain(null);
  });

  it('rejects an invalid payload before touching the DB', async () => {
    mockExecute.mockResolvedValueOnce([[{ id: 'p1' }], null]);
    await expect(updateJiraProject('p1', { projectKey: 'RND', activeStatus: 'a"b' }))
      .rejects.toThrow(/activeStatus/);
  });
});

describe('deleteJiraProject', () => {
  it('deletes by id', async () => {
    mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }, null]);
    await deleteJiraProject('p1');
    expect(mockExecute.mock.calls[0][0]).toMatch(/DELETE FROM jira_projects/i);
    expect(mockExecute.mock.calls[0][1]).toEqual(['p1']);
  });

  it('throws JiraProjectNotFoundError when no row matched', async () => {
    mockExecute.mockResolvedValueOnce([{ affectedRows: 0 }, null]);
    await expect(deleteJiraProject('gone')).rejects.toThrow(JiraProjectNotFoundError);
  });
});
