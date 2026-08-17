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
jest.mock('@/lib/jira-projects/seed', () => ({ ensureSeedProject: jest.fn() }));

import { NextRequest, NextResponse } from 'next/server';
import { GET, POST } from '@/app/api/jira-projects/route';
import { PUT, DELETE } from '@/app/api/jira-projects/[id]/route';
import {
  listJiraProjects, createJiraProject, updateJiraProject, deleteJiraProject,
  JiraProjectDuplicateError, JiraProjectNotFoundError,
} from '@/lib/jira-projects/service';
import { ensureSeedProject } from '@/lib/jira-projects/seed';
import { JiraProjectError } from '@/lib/jira-projects/types';

const mockList = listJiraProjects as jest.Mock;
const mockCreate = createJiraProject as jest.Mock;
const mockUpdate = updateJiraProject as jest.Mock;
const mockDelete = deleteJiraProject as jest.Mock;
const mockSeed = ensureSeedProject as jest.Mock;

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

  it('is a pure read: does not call ensureSeedProject', async () => {
    // Settings → Projects reloads this list right after a DELETE. Seeding
    // here would resurrect the project an admin just deleted (PR #66 review).
    mockList.mockResolvedValue([]);
    await GET(new NextRequest('http://localhost/api/jira-projects?org=o'));
    expect(mockSeed).not.toHaveBeenCalled();
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

  it('400s on malformed JSON instead of an unhandled 500', async () => {
    const req = new NextRequest('http://localhost/api/jira-projects', {
      method: 'POST', body: '{not valid json', headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('refuses a non-admin and does not touch the service', async () => {
    // Real shape from src/lib/auth.ts's requireAdmin: NextResponse.json({ error: 'Forbidden' }, { status: 403 }).
    // mockResolvedValueOnce is consumed by this single call, so the factory's
    // default mockResolvedValue(null) is back in effect for every later test —
    // no manual reset needed.
    const { requireAdmin } = jest.requireMock('@/lib/auth');
    requireAdmin.mockResolvedValueOnce(
      NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    );
    const res = await POST(post({ org: 'o', projectKey: 'RND', activeStatus: 'In Progress' }));
    expect(res.status).toBe(403);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe('PUT /api/jira-projects/[id]', () => {
  it('updates', async () => {
    mockUpdate.mockResolvedValue(undefined);
    const res = await PUT(put({ projectKey: 'RND', activeStatus: 'In Progress' }), ctx);
    expect((await res.json())).toEqual({ updated: true });
  });

  it('400s on a validation failure, carrying the message', async () => {
    mockUpdate.mockRejectedValue(new JiraProjectError('activeStatus must not contain a double quote'));
    const res = await PUT(put({ projectKey: 'RND', activeStatus: 'a"b' }), ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/activeStatus/);
  });

  it('409s on a duplicate key', async () => {
    mockUpdate.mockRejectedValue(new JiraProjectDuplicateError('RND'));
    expect((await PUT(put({ projectKey: 'RND', activeStatus: 'In Progress' }), ctx)).status).toBe(409);
  });

  it('404s when the row is gone', async () => {
    mockUpdate.mockRejectedValue(new JiraProjectNotFoundError('p1'));
    expect((await PUT(put({ projectKey: 'RND', activeStatus: 'x' }), ctx)).status).toBe(404);
  });

  it('400s on malformed JSON instead of an unhandled 500', async () => {
    const req = new NextRequest('http://localhost/api/jira-projects/p1', {
      method: 'PUT', body: '{not valid json', headers: { 'Content-Type': 'application/json' },
    });
    const res = await PUT(req, ctx);
    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('refuses a non-admin and does not touch the service', async () => {
    const { requireAdmin } = jest.requireMock('@/lib/auth');
    requireAdmin.mockResolvedValueOnce(
      NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    );
    const res = await PUT(put({ projectKey: 'RND', activeStatus: 'In Progress' }), ctx);
    expect(res.status).toBe(403);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/jira-projects/[id]', () => {
  it('deletes', async () => {
    mockDelete.mockResolvedValue(undefined);
    const res = await DELETE(new NextRequest('http://localhost/api/jira-projects/p1', { method: 'DELETE' }), ctx);
    expect((await res.json())).toEqual({ deleted: true });
  });

  it('404s when the row is already gone instead of reporting deleted: true', async () => {
    mockDelete.mockRejectedValue(new JiraProjectNotFoundError('p1'));
    const res = await DELETE(new NextRequest('http://localhost/api/jira-projects/p1', { method: 'DELETE' }), ctx);
    expect(res.status).toBe(404);
  });

  it('refuses a non-admin and does not touch the service', async () => {
    const { requireAdmin } = jest.requireMock('@/lib/auth');
    requireAdmin.mockResolvedValueOnce(
      NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    );
    const res = await DELETE(new NextRequest('http://localhost/api/jira-projects/p1', { method: 'DELETE' }), ctx);
    expect(res.status).toBe(403);
    expect(mockDelete).not.toHaveBeenCalled();
  });
});
