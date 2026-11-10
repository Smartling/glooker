jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));
jest.mock('@/lib/jira/client');
jest.mock('@/lib/auth', () => ({
  requireAdmin: jest.fn().mockResolvedValue(null),
}));
jest.mock('@/lib/orgs/guard', () => ({
  requireAllowedOrg: jest.fn((org) => ({ ok: true, org: org || 'test-org' })),
}));
jest.mock('@/lib/jira-projects/service', () => ({
  isProjectConfigured: jest.fn().mockResolvedValue(true),
}));

import { GET, PATCH } from '@/app/api/projects/[key]/status/route';
import { getJiraClient } from '@/lib/jira/client';
import { requireAdmin } from '@/lib/auth';
import { requireAllowedOrg } from '@/lib/orgs/guard';
import { isProjectConfigured } from '@/lib/jira-projects/service';

const mockGetJiraClient = getJiraClient as jest.Mock;
const mockRequireAdmin = requireAdmin as jest.Mock;
const mockRequireAllowedOrg = requireAllowedOrg as jest.Mock;
const mockIsProjectConfigured = isProjectConfigured as jest.Mock;

/** Build a minimal mock NextRequest with a JSON body. */
function makeRequest(body: unknown) {
  return {
    json: () => Promise.resolve(body),
  } as any;
}

/** Build a minimal mock NextRequest with query params (for GET). */
function makeGetRequest(org = 'test-org') {
  return {
    nextUrl: {
      searchParams: {
        get: (key: string) => (key === 'org' ? org : null),
      },
    },
  } as any;
}

/** Build the params object the route handler expects. */
function makeParams(key: string) {
  return { params: Promise.resolve({ key }) };
}

describe('GET /api/projects/[key]/status', () => {
  beforeEach(() => {
    mockGetJiraClient.mockReset();
    mockRequireAllowedOrg.mockImplementation((org) => ({ ok: true, org: org || 'test-org' }));
    mockIsProjectConfigured.mockResolvedValue(true);
  });

  it('returns transitions array from Jira client', async () => {
    const transitions = [
      { id: '11', name: 'To Do', to: { name: 'To Do' }, toStatusCategory: 'new' },
      { id: '21', name: 'In Progress', to: { name: 'In Progress' }, toStatusCategory: 'indeterminate' },
      { id: '31', name: 'Done', to: { name: 'Done' }, toStatusCategory: 'done' },
    ];
    mockGetJiraClient.mockReturnValue({
      getTransitions: jest.fn().mockResolvedValue(transitions),
    });

    const res = await GET(makeGetRequest(), makeParams('EPIC-1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.transitions).toEqual(transitions);
  });

  it('carries each destination\'s status category through to the client', async () => {
    // The response is deliberately unfiltered — it offers every transition the
    // workflow allows — so the category is the only thing that lets the board
    // tell a genuine Done from a Blocked. Dropping it is what put non-Done
    // epics on the Done tab.
    mockGetJiraClient.mockReturnValue({
      getTransitions: jest.fn().mockResolvedValue([
        { id: '61', name: 'Blocked', to: { name: 'Blocked' }, toStatusCategory: 'new' },
        { id: '41', name: 'Done', to: { name: 'Done' }, toStatusCategory: 'done' },
      ]),
    });

    const body = await (await GET(makeGetRequest(), makeParams('EPIC-1'))).json();
    expect(body.transitions.map((t: { toStatusCategory: string }) => t.toStatusCategory))
      .toEqual(['new', 'done']);
  });

  it('returns 404 when Jira is not configured', async () => {
    mockGetJiraClient.mockReturnValue(null);

    const res = await GET(makeGetRequest(), makeParams('EPIC-1'));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/not configured/i);
  });

  it('returns 404 when project is not configured for org', async () => {
    mockIsProjectConfigured.mockResolvedValue(false);
    mockGetJiraClient.mockReturnValue({
      getTransitions: jest.fn(),
    });

    const res = await GET(makeGetRequest(), makeParams('NOTCONFIG-1'));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Not found');
  });

  it('returns 500 on Jira error', async () => {
    mockGetJiraClient.mockReturnValue({
      getTransitions: jest.fn().mockRejectedValue(new Error('Jira API error (404): Issue Not Found')),
    });

    const res = await GET(makeGetRequest(), makeParams('EPIC-1'));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('internal_error');
      expect(String(body.error)).not.toContain('Jira API error');
  });
});

describe('PATCH /api/projects/[key]/status', () => {
  beforeEach(() => {
    mockGetJiraClient.mockReset();
    mockRequireAdmin.mockResolvedValue(null);
    mockRequireAllowedOrg.mockImplementation((org) => ({ ok: true, org: org || 'test-org' }));
    mockIsProjectConfigured.mockResolvedValue(true);
  });

  it('calls transitionIssue with correct key and transitionId, returns success JSON', async () => {
    const mockTransitionIssue = jest.fn().mockResolvedValue(undefined);
    mockGetJiraClient.mockReturnValue({ transitionIssue: mockTransitionIssue });

    const res = await PATCH(makeRequest({ transitionId: '21', org: 'test-org' }), makeParams('EPIC-42'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.key).toBe('EPIC-42');
    expect(mockTransitionIssue).toHaveBeenCalledWith('EPIC-42', '21');
  });

  it('returns 400 when transitionId is missing', async () => {
    mockGetJiraClient.mockReturnValue({
      transitionIssue: jest.fn(),
    });

    const res = await PATCH(makeRequest({ org: 'test-org' }), makeParams('EPIC-42'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/transitionId/i);
  });

  it('returns 404 when Jira is not configured', async () => {
    mockGetJiraClient.mockReturnValue(null);

    const res = await PATCH(makeRequest({ transitionId: '21', org: 'test-org' }), makeParams('EPIC-42'));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/not configured/i);
  });

  it('returns 404 when project is not configured for org', async () => {
    mockIsProjectConfigured.mockResolvedValue(false);
    mockGetJiraClient.mockReturnValue({
      transitionIssue: jest.fn(),
    });

    const res = await PATCH(makeRequest({ transitionId: '21', org: 'test-org' }), makeParams('NOTCONFIG-42'));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Not found');
  });

  it('returns 500 on Jira error', async () => {
    mockGetJiraClient.mockReturnValue({
      transitionIssue: jest.fn().mockRejectedValue(new Error('Jira API error (400): Transition not available')),
    });

    const res = await PATCH(makeRequest({ transitionId: '99', org: 'test-org' }), makeParams('EPIC-42'));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('internal_error');
      expect(String(body.error)).not.toContain('Jira API error');
  });

  it('requires admin — returns denied response when requireAdmin returns a response', async () => {
    const deniedResponse = new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
    mockRequireAdmin.mockResolvedValue(deniedResponse);

    const res = await PATCH(makeRequest({ transitionId: '21', org: 'test-org' }), makeParams('EPIC-42'));
    expect(res.status).toBe(403);
  });
});
