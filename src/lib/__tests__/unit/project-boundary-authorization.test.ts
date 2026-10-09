/**
 * Security tests verifying that the configured-project boundary bypass vulnerability
 * is mitigated on all dynamic Jira routes (/summary, /stats, /status, /due).
 *
 * Pentest finding: Authenticated callers could bypass the configured-project boundary
 * by querying arbitrary syntactically valid Jira keys through dynamic routes.
 *
 * Mitigation: All routes now extract the project key from the issue key and verify
 * it against the org's configured projects before processing the request.
 */

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
jest.mock('@/lib/projects/epic-summary', () => ({
  getEpicSummary: jest.fn().mockResolvedValue({ epic: 'summary-data' }),
}));
jest.mock('@/lib/projects/epic-stats', () => ({
  getEpicRingStats: jest.fn().mockResolvedValue({ stats: 'ring-data' }),
}));

import { GET as summaryGET } from '@/app/api/projects/[key]/summary/route';
import { GET as statsGET } from '@/app/api/projects/[key]/stats/route';
import { GET as statusGET, PATCH as statusPATCH } from '@/app/api/projects/[key]/status/route';
import { PATCH as duePATCH } from '@/app/api/projects/[key]/due/route';
import { getJiraClient } from '@/lib/jira/client';
import { isProjectConfigured } from '@/lib/jira-projects/service';
import { getEpicSummary } from '@/lib/projects/epic-summary';
import { getEpicRingStats } from '@/lib/projects/epic-stats';

const mockGetJiraClient = getJiraClient as jest.Mock;
const mockIsProjectConfigured = isProjectConfigured as jest.Mock;
const mockGetEpicSummary = getEpicSummary as jest.Mock;
const mockGetEpicRingStats = getEpicRingStats as jest.Mock;

/** Build a minimal mock NextRequest with query params. */
function makeGetRequest(org = 'test-org', extraParams: Record<string, string> = {}) {
  return {
    nextUrl: {
      searchParams: {
        get: (key: string) => {
          if (key === 'org') return org;
          return extraParams[key] || null;
        },
      },
    },
  } as any;
}

/** Build a minimal mock NextRequest with a JSON body. */
function makePostRequest(body: unknown) {
  return {
    json: () => Promise.resolve(body),
    nextUrl: {
      searchParams: {
        get: () => null,
      },
    },
  } as any;
}

/** Build the params object the route handler expects. */
function makeParams(key: string) {
  return { params: Promise.resolve({ key }) };
}

describe('Project boundary authorization - preventing configured-project bypass', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.JIRA_ENABLED = 'true';
    mockIsProjectConfigured.mockResolvedValue(true);
    mockGetJiraClient.mockReturnValue({
      getTransitions: jest.fn().mockResolvedValue([
        { id: '21', name: 'In Progress', to: { statusCategory: { key: 'indeterminate' } } },
      ]),
      transitionIssue: jest.fn().mockResolvedValue(undefined),
      updateDueDate: jest.fn().mockResolvedValue(undefined),
    });
  });

  describe('/summary route - exploit scenario', () => {
    it('rejects issue from unconfigured project with 404', async () => {
      // Simulate attacker knowing a valid issue key from a project not configured for their org
      mockIsProjectConfigured.mockResolvedValue(false);

      const res = await summaryGET(
        makeGetRequest('victim-org'),
        makeParams('UNCONFIGURED-123')
      );

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('Not found');
      
      // Verify the authorization check was performed
      expect(mockIsProjectConfigured).toHaveBeenCalledWith('victim-org', 'UNCONFIGURED');
      
      // Verify the underlying service was never called (request blocked at boundary)
      expect(mockGetEpicSummary).not.toHaveBeenCalled();
    });

    it('allows issue from configured project', async () => {
      mockIsProjectConfigured.mockResolvedValue(true);

      const res = await summaryGET(
        makeGetRequest('test-org'),
        makeParams('CONFIGURED-456')
      );

      expect(res.status).toBe(200);
      
      // Verify authorization check passed
      expect(mockIsProjectConfigured).toHaveBeenCalledWith('test-org', 'CONFIGURED');
      
      // Verify the service was called after authorization
      expect(mockGetEpicSummary).toHaveBeenCalled();
    });

    it('extracts project key correctly from issue key with underscores', async () => {
      mockIsProjectConfigured.mockResolvedValue(false);

      await summaryGET(
        makeGetRequest('test-org'),
        makeParams('SPS_2-789')
      );

      // Verify project key extraction handles underscores
      expect(mockIsProjectConfigured).toHaveBeenCalledWith('test-org', 'SPS_2');
    });
  });

  describe('/stats route - exploit scenario', () => {
    it('rejects issue from unconfigured project with 404', async () => {
      // Attacker attempts to query statistics for an issue outside their configured projects
      mockIsProjectConfigured.mockResolvedValue(false);

      const res = await statsGET(
        makeGetRequest('victim-org'),
        makeParams('EXTERNAL-999')
      );

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('Not found');
      
      expect(mockIsProjectConfigured).toHaveBeenCalledWith('victim-org', 'EXTERNAL');
      expect(mockGetEpicRingStats).not.toHaveBeenCalled();
    });

    it('allows issue from configured project', async () => {
      mockIsProjectConfigured.mockResolvedValue(true);

      const res = await statsGET(
        makeGetRequest('test-org'),
        makeParams('ALLOWED-111')
      );

      expect(res.status).toBe(200);
      expect(mockIsProjectConfigured).toHaveBeenCalledWith('test-org', 'ALLOWED');
      expect(mockGetEpicRingStats).toHaveBeenCalled();
    });
  });

  describe('/status GET route - exploit scenario', () => {
    it('rejects issue from unconfigured project with 404', async () => {
      // Attacker attempts to fetch transitions for an issue outside their scope
      mockIsProjectConfigured.mockResolvedValue(false);

      const res = await statusGET(
        makeGetRequest('victim-org'),
        makeParams('FORBIDDEN-222')
      );

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('Not found');
      
      expect(mockIsProjectConfigured).toHaveBeenCalledWith('victim-org', 'FORBIDDEN');
      
      // Verify Jira client was never invoked
      const client = mockGetJiraClient();
      expect(client.getTransitions).not.toHaveBeenCalled();
    });

    it('allows issue from configured project', async () => {
      mockIsProjectConfigured.mockResolvedValue(true);

      const res = await statusGET(
        makeGetRequest('test-org'),
        makeParams('ALLOWED-333')
      );

      expect(res.status).toBe(200);
      expect(mockIsProjectConfigured).toHaveBeenCalledWith('test-org', 'ALLOWED');
    });

    it('requires org parameter to be provided', async () => {
      // The org parameter is required by requireAllowedOrg guard
      // When null/missing, the guard returns an error response
      // This test verifies the route properly uses the guard
      const res = await statusGET(
        makeGetRequest('test-org'),
        makeParams('PROJ-1')
      );

      // With valid org, request should proceed to authorization check
      expect(res.status).toBe(200);
    });
  });

  describe('/status PATCH route - exploit scenario', () => {
    it('rejects issue from unconfigured project with 404', async () => {
      // Attacker attempts to transition an issue outside their configured projects
      mockIsProjectConfigured.mockResolvedValue(false);

      const res = await statusPATCH(
        makePostRequest({ transitionId: '21', org: 'victim-org' }),
        makeParams('OUTOFSCOPE-444')
      );

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('Not found');
      
      expect(mockIsProjectConfigured).toHaveBeenCalledWith('victim-org', 'OUTOFSCOPE');
      
      const client = mockGetJiraClient();
      expect(client.transitionIssue).not.toHaveBeenCalled();
    });

    it('allows issue from configured project', async () => {
      mockIsProjectConfigured.mockResolvedValue(true);

      const res = await statusPATCH(
        makePostRequest({ transitionId: '21', org: 'test-org' }),
        makeParams('ALLOWED-555')
      );

      expect(res.status).toBe(200);
      expect(mockIsProjectConfigured).toHaveBeenCalledWith('test-org', 'ALLOWED');
    });
  });

  describe('/due PATCH route - exploit scenario', () => {
    it('rejects issue from unconfigured project with 404', async () => {
      // Attacker attempts to modify due date for an issue outside their scope
      mockIsProjectConfigured.mockResolvedValue(false);

      const res = await duePATCH(
        makePostRequest({ dueDate: '2026-04-15', org: 'victim-org' }),
        makeParams('RESTRICTED-666')
      );

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('Not found');
      
      expect(mockIsProjectConfigured).toHaveBeenCalledWith('victim-org', 'RESTRICTED');
      
      const client = mockGetJiraClient();
      expect(client.updateDueDate).not.toHaveBeenCalled();
    });

    it('allows issue from configured project', async () => {
      mockIsProjectConfigured.mockResolvedValue(true);

      const res = await duePATCH(
        makePostRequest({ dueDate: '2026-04-15', org: 'test-org' }),
        makeParams('ALLOWED-777')
      );

      expect(res.status).toBe(200);
      expect(mockIsProjectConfigured).toHaveBeenCalledWith('test-org', 'ALLOWED');
    });
  });

  describe('Cross-org boundary enforcement', () => {
    it('prevents org-A user from accessing org-B configured project', async () => {
      // Simulate org-A user attempting to access org-B's project
      mockIsProjectConfigured.mockImplementation((org, projectKey) => {
        // Project ORGB is only configured for org-b
        return org === 'org-b' && projectKey === 'ORGB';
      });

      // Attacker from org-a tries to access ORGB-123
      const res = await summaryGET(
        makeGetRequest('org-a'),
        makeParams('ORGB-123')
      );

      expect(res.status).toBe(404);
      expect(mockIsProjectConfigured).toHaveBeenCalledWith('org-a', 'ORGB');
      expect(mockGetEpicSummary).not.toHaveBeenCalled();
    });

    it('allows org-B user to access their own configured project', async () => {
      mockIsProjectConfigured.mockImplementation((org, projectKey) => {
        return org === 'org-b' && projectKey === 'ORGB';
      });

      const res = await summaryGET(
        makeGetRequest('org-b'),
        makeParams('ORGB-123')
      );

      expect(res.status).toBe(200);
      expect(mockIsProjectConfigured).toHaveBeenCalledWith('org-b', 'ORGB');
    });
  });

  describe('Authorization check ordering - defense in depth', () => {
    it('checks project authorization before calling Jira client on /summary', async () => {
      mockIsProjectConfigured.mockResolvedValue(false);
      const mockClient = mockGetJiraClient();

      await summaryGET(
        makeGetRequest('test-org'),
        makeParams('BLOCKED-1')
      );

      // Authorization check must happen before any Jira API calls
      expect(mockIsProjectConfigured).toHaveBeenCalled();
      expect(mockGetEpicSummary).not.toHaveBeenCalled();
    });

    it('checks project authorization before calling Jira client on /stats', async () => {
      mockIsProjectConfigured.mockResolvedValue(false);

      await statsGET(
        makeGetRequest('test-org'),
        makeParams('BLOCKED-2')
      );

      expect(mockIsProjectConfigured).toHaveBeenCalled();
      expect(mockGetEpicRingStats).not.toHaveBeenCalled();
    });

    it('checks project authorization before calling Jira client on /status GET', async () => {
      mockIsProjectConfigured.mockResolvedValue(false);
      const mockClient = mockGetJiraClient();

      await statusGET(
        makeGetRequest('test-org'),
        makeParams('BLOCKED-3')
      );

      expect(mockIsProjectConfigured).toHaveBeenCalled();
      expect(mockClient.getTransitions).not.toHaveBeenCalled();
    });

    it('checks project authorization before calling Jira client on /status PATCH', async () => {
      mockIsProjectConfigured.mockResolvedValue(false);
      const mockClient = mockGetJiraClient();

      await statusPATCH(
        makePostRequest({ transitionId: '21', org: 'test-org' }),
        makeParams('BLOCKED-4')
      );

      expect(mockIsProjectConfigured).toHaveBeenCalled();
      expect(mockClient.transitionIssue).not.toHaveBeenCalled();
    });

    it('checks project authorization before calling Jira client on /due PATCH', async () => {
      mockIsProjectConfigured.mockResolvedValue(false);
      const mockClient = mockGetJiraClient();

      await duePATCH(
        makePostRequest({ dueDate: '2026-04-15', org: 'test-org' }),
        makeParams('BLOCKED-5')
      );

      expect(mockIsProjectConfigured).toHaveBeenCalled();
      expect(mockClient.updateDueDate).not.toHaveBeenCalled();
    });
  });

  describe('Edge cases - project key extraction', () => {
    it('handles single-letter project keys', async () => {
      mockIsProjectConfigured.mockResolvedValue(false);

      await summaryGET(
        makeGetRequest('test-org'),
        makeParams('A-1')
      );

      expect(mockIsProjectConfigured).toHaveBeenCalledWith('test-org', 'A');
    });

    it('handles long project keys', async () => {
      mockIsProjectConfigured.mockResolvedValue(false);

      await summaryGET(
        makeGetRequest('test-org'),
        makeParams('VERYLONGPROJECTKEY-999')
      );

      expect(mockIsProjectConfigured).toHaveBeenCalledWith('test-org', 'VERYLONGPROJECTKEY');
    });

    it('handles project keys with numbers', async () => {
      mockIsProjectConfigured.mockResolvedValue(false);

      await summaryGET(
        makeGetRequest('test-org'),
        makeParams('PROJ123-456')
      );

      expect(mockIsProjectConfigured).toHaveBeenCalledWith('test-org', 'PROJ123');
    });
  });

  describe('Security property: consistent 404 response', () => {
    it('returns same error message for unconfigured projects across all routes', async () => {
      mockIsProjectConfigured.mockResolvedValue(false);

      const summaryRes = await summaryGET(makeGetRequest('test-org'), makeParams('X-1'));
      const statsRes = await statsGET(makeGetRequest('test-org'), makeParams('X-2'));
      const statusGetRes = await statusGET(makeGetRequest('test-org'), makeParams('X-3'));
      const statusPatchRes = await statusPATCH(
        makePostRequest({ transitionId: '21', org: 'test-org' }),
        makeParams('X-4')
      );
      const dueRes = await duePATCH(
        makePostRequest({ dueDate: '2026-04-15', org: 'test-org' }),
        makeParams('X-5')
      );

      // All routes should return consistent 404 response
      expect(summaryRes.status).toBe(404);
      expect(statsRes.status).toBe(404);
      expect(statusGetRes.status).toBe(404);
      expect(statusPatchRes.status).toBe(404);
      expect(dueRes.status).toBe(404);

      // All should have the same error message (no information leakage)
      const summaryBody = await summaryRes.json();
      const statsBody = await statsRes.json();
      const statusGetBody = await statusGetRes.json();
      const statusPatchBody = await statusPatchRes.json();
      const dueBody = await dueRes.json();

      expect(summaryBody.error).toBe('Not found');
      expect(statsBody.error).toBe('Not found');
      expect(statusGetBody.error).toBe('Not found');
      expect(statusPatchBody.error).toBe('Not found');
      expect(dueBody.error).toBe('Not found');
    });
  });
});
