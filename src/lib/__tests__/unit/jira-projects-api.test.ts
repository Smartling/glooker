jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));
jest.mock('@/lib/auth', () => ({
  requireAdmin: jest.fn().mockResolvedValue(null),
  // withRequestLog (src/lib/logger.ts) unconditionally calls extractUser on
  // any request object that has a `.url` — which real NextRequest instances
  // (used below for the GET tests' query-string handling) do. Without this,
  // the mocked auth module has no extractUser and every request crashes.
  extractUser: jest.fn().mockReturnValue(null),
}));
jest.mock('@/lib/jira-projects/service', () => {
  const actual = jest.requireActual('@/lib/jira-projects/service');
  return {
    ...actual,
    listJiraProjects: jest.fn(),
    createJiraProject: jest.fn(),
    updateJiraProject: jest.fn(),
    deleteJiraProject: jest.fn(),
  };
});

import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/jira-projects/route';
import { PUT, DELETE } from '@/app/api/jira-projects/[id]/route';
import {
  listJiraProjects, createJiraProject, updateJiraProject, deleteJiraProject,
  JiraProjectDuplicateError, JiraProjectNotFoundError,
} from '@/lib/jira-projects/service';
import { JiraProjectError } from '@/lib/jira-projects/types';

const mockList = listJiraProjects as jest.Mock;
const mockCreate = createJiraProject as jest.Mock;
const mockUpdate = updateJiraProject as jest.Mock;
const mockDelete = deleteJiraProject as jest.Mock;

const post = (body: unknown) => new NextRequest('http://localhost/api/jira-projects', {
  method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' },
});
const put = (body: unknown) => new NextRequest('http://localhost/api/jira-projects/p1', {
  method: 'PUT', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' },
});
const ctx = { params: Promise.resolve({ id: 'p1' }) };

beforeEach(() => jest.clearAllMocks());

describe('GET /api/jira-projects', () => {
  it('400s without an org', async () => {
    expect((await GET(new NextRequest('http://localhost/api/jira-projects'))).status).toBe(400);
  });

  it('returns the configured list', async () => {
    mockList.mockResolvedValue([{ projectKey: 'SPS' }]);
    const res = await GET(new NextRequest('http://localhost/api/jira-projects?org=o'));
    expect((await res.json())[0].projectKey).toBe('SPS');
  });
});

describe('POST /api/jira-projects', () => {
  it('creates and returns the row', async () => {
    mockCreate.mockResolvedValue({ id: 'p1', projectKey: 'RND' });
    const res = await POST(post({ org: 'o', projectKey: 'RND', activeStatus: 'In Progress' }));
    expect(res.status).toBe(200);
    expect((await res.json()).projectKey).toBe('RND');
  });

  it('400s on a validation failure, carrying the message', async () => {
    mockCreate.mockRejectedValue(new JiraProjectError('projectKey is not a valid Jira project key: b d'));
    const res = await POST(post({ org: 'o', projectKey: 'b d', activeStatus: 'x' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/projectKey/);
  });

  it('409s on a duplicate key', async () => {
    mockCreate.mockRejectedValue(new JiraProjectDuplicateError('RND'));
    expect((await POST(post({ org: 'o', projectKey: 'RND', activeStatus: 'x' }))).status).toBe(409);
  });

  it('400s without an org', async () => {
    expect((await POST(post({ projectKey: 'RND', activeStatus: 'x' }))).status).toBe(400);
  });
});

describe('PUT /api/jira-projects/[id]', () => {
  it('updates', async () => {
    mockUpdate.mockResolvedValue(undefined);
    const res = await PUT(put({ projectKey: 'RND', activeStatus: 'In Progress' }), ctx);
    expect((await res.json())).toEqual({ updated: true });
  });

  it('400s on a validation failure', async () => {
    mockUpdate.mockRejectedValue(new JiraProjectError('activeStatus must not contain a double quote'));
    expect((await PUT(put({ projectKey: 'RND', activeStatus: 'a"b' }), ctx)).status).toBe(400);
  });

  it('404s when the row is gone', async () => {
    mockUpdate.mockRejectedValue(new JiraProjectNotFoundError('p1'));
    expect((await PUT(put({ projectKey: 'RND', activeStatus: 'x' }), ctx)).status).toBe(404);
  });
});

describe('DELETE /api/jira-projects/[id]', () => {
  it('deletes', async () => {
    mockDelete.mockResolvedValue(undefined);
    const res = await DELETE(new NextRequest('http://localhost/api/jira-projects/p1', { method: 'DELETE' }), ctx);
    expect((await res.json())).toEqual({ deleted: true });
  });
});
