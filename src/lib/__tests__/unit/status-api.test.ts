jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));
jest.mock('@/lib/jira/client');
jest.mock('@/lib/auth', () => ({
  requireAdmin: jest.fn().mockResolvedValue(null),
}));

import { GET, PATCH } from '@/app/api/projects/[key]/status/route';
import { getJiraClient } from '@/lib/jira/client';
import { requireAdmin } from '@/lib/auth';

const mockGetJiraClient = getJiraClient as jest.Mock;
const mockRequireAdmin = requireAdmin as jest.Mock;

/** Build a minimal mock NextRequest with a JSON body. */
function makeRequest(body: unknown) {
  return {
    json: () => Promise.resolve(body),
  } as any;
}

/** Build a minimal mock NextRequest with no body (for GET). */
function makeGetRequest() {
  return {} as any;
}

/** Build the params object the route handler expects. */
function makeParams(key: string) {
  return { params: Promise.resolve({ key }) };
}

describe('GET /api/projects/[key]/status', () => {
  beforeEach(() => {
    mockGetJiraClient.mockReset();
  });

  it('returns transitions array from Jira client', async () => {
    const transitions = [
      { id: '11', name: 'To Do', to: { name: 'To Do' } },
      { id: '21', name: 'In Progress', to: { name: 'In Progress' } },
      { id: '31', name: 'Done', to: { name: 'Done' } },
    ];
    mockGetJiraClient.mockReturnValue({
      getTransitions: jest.fn().mockResolvedValue(transitions),
    });

    const res = await GET(makeGetRequest(), makeParams('EPIC-1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.transitions).toEqual(transitions);
  });

  it('returns 404 when Jira is not configured', async () => {
    mockGetJiraClient.mockReturnValue(null);

    const res = await GET(makeGetRequest(), makeParams('EPIC-1'));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/not configured/i);
  });

  it('returns 500 on Jira error', async () => {
    mockGetJiraClient.mockReturnValue({
      getTransitions: jest.fn().mockRejectedValue(new Error('Jira API error (404): Issue Not Found')),
    });

    const res = await GET(makeGetRequest(), makeParams('EPIC-1'));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain('Jira API error (404)');
  });
});

describe('PATCH /api/projects/[key]/status', () => {
  beforeEach(() => {
    mockGetJiraClient.mockReset();
    mockRequireAdmin.mockResolvedValue(null);
  });

  it('calls transitionIssue with correct key and transitionId, returns success JSON', async () => {
    const mockTransitionIssue = jest.fn().mockResolvedValue(undefined);
    mockGetJiraClient.mockReturnValue({ transitionIssue: mockTransitionIssue });

    const res = await PATCH(makeRequest({ transitionId: '21' }), makeParams('EPIC-42'));
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

    const res = await PATCH(makeRequest({}), makeParams('EPIC-42'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/transitionId/i);
  });

  it('returns 404 when Jira is not configured', async () => {
    mockGetJiraClient.mockReturnValue(null);

    const res = await PATCH(makeRequest({ transitionId: '21' }), makeParams('EPIC-42'));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/not configured/i);
  });

  it('returns 500 on Jira error', async () => {
    mockGetJiraClient.mockReturnValue({
      transitionIssue: jest.fn().mockRejectedValue(new Error('Jira API error (400): Transition not available')),
    });

    const res = await PATCH(makeRequest({ transitionId: '99' }), makeParams('EPIC-42'));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain('Jira API error (400)');
  });

  it('requires admin — returns denied response when requireAdmin returns a response', async () => {
    const deniedResponse = new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
    mockRequireAdmin.mockResolvedValue(deniedResponse);

    const res = await PATCH(makeRequest({ transitionId: '21' }), makeParams('EPIC-42'));
    expect(res.status).toBe(403);
  });
});
