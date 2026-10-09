jest.mock('@/lib/db/index', () => ({
  __esModule: true,
  default: { execute: jest.fn().mockResolvedValue([[], null]) },
}));

import {
  listJiraProjects, createJiraProject, updateJiraProject, deleteJiraProject,
  isProjectConfigured,
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

describe('isProjectConfigured - authorization boundary enforcement', () => {
  it('returns true when project is configured for the org', async () => {
    mockExecute.mockResolvedValueOnce([[{ '1': 1 }], null]);
    const result = await isProjectConfigured('test-org', 'GLOOK');
    expect(result).toBe(true);
    expect(mockExecute.mock.calls[0][0]).toMatch(/SELECT 1 FROM jira_projects/i);
    expect(mockExecute.mock.calls[0][1]).toEqual(['test-org', 'GLOOK']);
  });

  it('returns false when project is not configured for the org', async () => {
    mockExecute.mockResolvedValueOnce([[], null]);
    const result = await isProjectConfigured('test-org', 'NOTFOUND');
    expect(result).toBe(false);
    expect(mockExecute.mock.calls[0][1]).toEqual(['test-org', 'NOTFOUND']);
  });

  it('normalizes project key to uppercase', async () => {
    mockExecute.mockResolvedValueOnce([[], null]);
    await isProjectConfigured('test-org', 'lowercase');
    // The query should use uppercase version
    expect(mockExecute.mock.calls[0][1]).toEqual(['test-org', 'LOWERCASE']);
  });

  it('trims whitespace from project key', async () => {
    mockExecute.mockResolvedValueOnce([[], null]);
    await isProjectConfigured('test-org', '  PROJ  ');
    expect(mockExecute.mock.calls[0][1]).toEqual(['test-org', 'PROJ']);
  });

  it('enforces org-scoped authorization - same project different orgs', async () => {
    // Project SHARED exists for org-a but not org-b
    mockExecute
      .mockResolvedValueOnce([[{ '1': 1 }], null])  // org-a has SHARED
      .mockResolvedValueOnce([[], null]);            // org-b does not

    const orgAResult = await isProjectConfigured('org-a', 'SHARED');
    const orgBResult = await isProjectConfigured('org-b', 'SHARED');

    expect(orgAResult).toBe(true);
    expect(orgBResult).toBe(false);

    // Verify both queries checked the correct org
    expect(mockExecute.mock.calls[0][1]).toEqual(['org-a', 'SHARED']);
    expect(mockExecute.mock.calls[1][1]).toEqual(['org-b', 'SHARED']);
  });

  it('uses LIMIT 1 for performance', async () => {
    mockExecute.mockResolvedValueOnce([[], null]);
    await isProjectConfigured('test-org', 'PROJ');
    expect(mockExecute.mock.calls[0][0]).toMatch(/LIMIT 1/i);
  });

  it('queries by both org and project_key to prevent cross-org access', async () => {
    mockExecute.mockResolvedValueOnce([[], null]);
    await isProjectConfigured('victim-org', 'ATTACKER');
    
    const query = mockExecute.mock.calls[0][0];
    const params = mockExecute.mock.calls[0][1];
    
    // Query must include both WHERE conditions
    expect(query).toMatch(/WHERE org = \?/i);
    expect(query).toMatch(/AND project_key = \?/i);
    expect(params).toEqual(['victim-org', 'ATTACKER']);
  });
});
