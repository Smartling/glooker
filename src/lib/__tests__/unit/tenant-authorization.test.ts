/**
 * Security test: Authenticated users cannot read another organization's report data.
 * 
 * This test verifies the mitigation for the pentest finding where authenticated
 * HTTP and MCP callers could receive report data for organizations they were not
 * authorized to access. The vulnerability existed because report-selection services
 * chose the globally newest completed report without requester or organization context.
 * 
 * The fix ensures that:
 * 1. getProjectInsights() scopes report selection to authorized orgs
 * 2. getReportHighlights() scopes report selection to authorized orgs
 * 3. MCP tools forward requester context and enforce authorization
 * 4. getAuthorizedOrgs() correctly determines which orgs a user can access
 */

jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));
jest.mock('@/lib/db/index', () => ({ __esModule: true, default: { execute: jest.fn() } }));
jest.mock('@/lib/report-runner', () => ({ runReport: jest.fn().mockResolvedValue(undefined), requestStop: jest.fn() }));
jest.mock('@/lib/llm-provider', () => ({
  getLLMClient: jest.fn(),
  LLM_MODEL: 'test-model',
  extraBodyProps: jest.fn().mockReturnValue({}),
  tokenLimit: (n: number) => ({ max_completion_tokens: n }),
  samplingParams: (t: number) => ({ temperature: t }),
  promptTag: (name: string) => name ? { __prompt_id: name } : {},
}));
jest.mock('@/lib/app-config/service', () => ({
  getAppConfig: jest.fn().mockReturnValue({
    highlights: { temperature: 0.7, maxTokens: 2000 }
  })
}));
jest.mock('@/lib/prompt-loader', () => ({
  loadPrompt: jest.fn().mockResolvedValue('test prompt')
}));

import { getAuthorizedOrgs } from '@/lib/cost-visibility';
import { getProjectInsights } from '@/lib/projects/insights';
import { getReportHighlights } from '@/lib/report-highlights/service';
import { callTool } from '@/lib/mcp/tools';
import db from '@/lib/db/index';
import { getLLMClient } from '@/lib/llm-provider';
import type { Requester } from '@/lib/cost-visibility';

const mockExecute = db.execute as jest.Mock;
const mockGetLLMClient = getLLMClient as jest.Mock;
const origEnv = { ...process.env };

beforeEach(() => {
  mockExecute.mockReset();
  mockGetLLMClient.mockReset();
  process.env = { ...origEnv };
});

afterAll(() => {
  process.env = origEnv;
});

describe('getAuthorizedOrgs', () => {
  it('returns all orgs when auth is disabled', async () => {
    mockExecute.mockResolvedValueOnce([
      [{ org: 'acme' }, { org: 'globex' }, { org: 'initech' }],
      null,
    ]);

    const requester: Requester = { githubLogin: null, isAdmin: false, authDisabled: true };
    const orgs = await getAuthorizedOrgs(requester);

    expect(orgs).toEqual(new Set(['acme', 'globex', 'initech']));
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('SELECT DISTINCT org FROM reports'),
      [],
    );
  });

  it('returns all orgs when requester is admin', async () => {
    mockExecute.mockResolvedValueOnce([
      [{ org: 'acme' }, { org: 'globex' }],
      null,
    ]);

    const requester: Requester = { githubLogin: 'admin-user', isAdmin: true, authDisabled: false };
    const orgs = await getAuthorizedOrgs(requester);

    expect(orgs).toEqual(new Set(['acme', 'globex']));
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('SELECT DISTINCT org FROM reports'),
      [],
    );
  });

  it('returns empty set when requester has no github login', async () => {
    const requester: Requester = { githubLogin: null, isAdmin: false, authDisabled: false };
    const orgs = await getAuthorizedOrgs(requester);

    expect(orgs).toEqual(new Set());
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('returns only orgs where requester has user_mappings entry', async () => {
    mockExecute.mockResolvedValueOnce([
      [{ org: 'acme' }, { org: 'initech' }],
      null,
    ]);

    const requester: Requester = { githubLogin: 'alice', isAdmin: false, authDisabled: false };
    const orgs = await getAuthorizedOrgs(requester);

    expect(orgs).toEqual(new Set(['acme', 'initech']));
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('SELECT DISTINCT org FROM user_mappings WHERE github_login = ?'),
      ['alice'],
    );
  });

  it('returns empty set when requester has no org mappings', async () => {
    mockExecute.mockResolvedValueOnce([[], null]);

    const requester: Requester = { githubLogin: 'bob', isAdmin: false, authDisabled: false };
    const orgs = await getAuthorizedOrgs(requester);

    expect(orgs).toEqual(new Set());
  });
});

describe('getProjectInsights - tenant authorization', () => {
  const acmeReport = { id: 'report-acme', org: 'acme', period_days: 30, created_at: '2026-03-15T10:00:00Z' };
  const globexReport = { id: 'report-globex', org: 'globex', period_days: 30, created_at: '2026-03-16T10:00:00Z' };

  describe('with explicit reportId', () => {
    it('returns available: false when requester cannot access the report org', async () => {
      // User alice can only access 'acme'
      mockExecute
        .mockResolvedValueOnce([[globexReport], null])  // report lookup
        .mockResolvedValueOnce([[{ org: 'acme' }], null]); // authorized orgs

      const requester: Requester = { githubLogin: 'alice', isAdmin: false, authDisabled: false };
      const result = await getProjectInsights('report-globex', requester);

      expect(result).toEqual({ available: false });
      // Should not proceed to query jira_issues or developer_stats
      expect(mockExecute).toHaveBeenCalledTimes(2);
    });

    it('allows access when requester is authorized for the report org', async () => {
      mockExecute
        .mockResolvedValueOnce([[acmeReport], null])     // report lookup
        .mockResolvedValueOnce([[{ org: 'acme' }], null]) // authorized orgs
        .mockResolvedValueOnce([[{ cnt: 5 }], null])      // jira count
        .mockResolvedValueOnce([[{ commits: 10, prs: 3 }], null]) // totals
        .mockResolvedValueOnce([[{
          highlights_json: JSON.stringify({
            _v: 3,
            projects: [],
            untracked_work: [],
            otherTotals: {},
            otherDetails: {}
          })
        }], null]);                                       // cache hit

      const requester: Requester = { githubLogin: 'alice', isAdmin: false, authDisabled: false };
      const result = await getProjectInsights('report-acme', requester);

      expect(result.available).toBe(true);
      expect(result.report.org).toBe('acme');
    });

    it('allows admin to access any report org', async () => {
      mockExecute
        .mockResolvedValueOnce([[globexReport], null])   // report lookup
        .mockResolvedValueOnce([[{ org: 'acme' }, { org: 'globex' }], null]) // all orgs (admin)
        .mockResolvedValueOnce([[{ cnt: 2 }], null])     // jira count
        .mockResolvedValueOnce([[{ commits: 5, prs: 1 }], null]) // totals
        .mockResolvedValueOnce([[{
          highlights_json: JSON.stringify({
            _v: 3,
            projects: [],
            untracked_work: [],
            otherTotals: {},
            otherDetails: {}
          })
        }], null]);                                      // cache hit

      const requester: Requester = { githubLogin: 'admin', isAdmin: true, authDisabled: false };
      const result = await getProjectInsights('report-globex', requester);

      expect(result.available).toBe(true);
      expect(result.report.org).toBe('globex');
    });
  });

  describe('without reportId (latest report selection)', () => {
    it('returns available: false when requester has no authorized orgs', async () => {
      mockExecute.mockResolvedValueOnce([[], null]); // no authorized orgs

      const requester: Requester = { githubLogin: 'unmapped', isAdmin: false, authDisabled: false };
      const result = await getProjectInsights(undefined, requester);

      expect(result).toEqual({ available: false });
      expect(mockExecute).toHaveBeenCalledTimes(1);
    });

    it('selects latest report scoped to authorized orgs only', async () => {
      // User can access 'acme' and 'initech', but NOT 'globex'
      // globexReport is newer but should be excluded
      mockExecute
        .mockResolvedValueOnce([[{ org: 'acme' }, { org: 'initech' }], null]) // authorized orgs
        .mockResolvedValueOnce([[acmeReport], null])     // latest within authorized orgs
        .mockResolvedValueOnce([[{ cnt: 3 }], null])     // jira count
        .mockResolvedValueOnce([[{ commits: 8, prs: 2 }], null]) // totals
        .mockResolvedValueOnce([[{
          highlights_json: JSON.stringify({
            _v: 3,
            projects: [],
            untracked_work: [],
            otherTotals: {},
            otherDetails: {}
          })
        }], null]);                                      // cache hit

      const requester: Requester = { githubLogin: 'alice', isAdmin: false, authDisabled: false };
      const result = await getProjectInsights(undefined, requester);

      expect(result.available).toBe(true);
      expect(result.report.org).toBe('acme');

      // Verify the query includes org IN (?) clause
      const latestReportQuery = mockExecute.mock.calls[1][0];
      expect(latestReportQuery).toContain('org IN (');
      expect(mockExecute.mock.calls[1][1]).toEqual(['acme', 'initech']);
    });

    it('admin gets globally newest report across all orgs', async () => {
      mockExecute
        .mockResolvedValueOnce([[{ org: 'acme' }, { org: 'globex' }], null]) // all orgs
        .mockResolvedValueOnce([[globexReport], null])   // globally newest
        .mockResolvedValueOnce([[{ cnt: 1 }], null])
        .mockResolvedValueOnce([[{ commits: 4, prs: 1 }], null])
        .mockResolvedValueOnce([[{
          highlights_json: JSON.stringify({
            _v: 3,
            projects: [],
            untracked_work: [],
            otherTotals: {},
            otherDetails: {}
          })
        }], null]);

      const requester: Requester = { githubLogin: 'admin', isAdmin: true, authDisabled: false };
      const result = await getProjectInsights(undefined, requester);

      expect(result.available).toBe(true);
      expect(result.report.org).toBe('globex');
    });

    it('falls back to global selection when no requester provided (backward compatibility)', async () => {
      mockExecute
        .mockResolvedValueOnce([[globexReport], null])   // global latest
        .mockResolvedValueOnce([[{ cnt: 2 }], null])
        .mockResolvedValueOnce([[{ commits: 6, prs: 2 }], null])
        .mockResolvedValueOnce([[{
          highlights_json: JSON.stringify({
            _v: 3,
            projects: [],
            untracked_work: [],
            otherTotals: {},
            otherDetails: {}
          })
        }], null]);

      const result = await getProjectInsights(undefined, undefined);

      expect(result.available).toBe(true);
      expect(result.report.org).toBe('globex');

      // Verify no org filtering in query
      const latestReportQuery = mockExecute.mock.calls[0][0];
      expect(latestReportQuery).not.toContain('org IN (');
    });
  });
});

describe('getReportHighlights - tenant authorization', () => {
  const acmeLatest = { id: 'acme-latest', org: 'acme', period_days: 30, created_at: '2026-03-15T10:00:00Z' };
  const acmePrev = { id: 'acme-prev', org: 'acme', period_days: 30, created_at: '2026-02-13T10:00:00Z' };
  const globexLatest = { id: 'globex-latest', org: 'globex', period_days: 30, created_at: '2026-03-16T10:00:00Z' };

  it('returns available: false when requester has no authorized orgs', async () => {
    mockExecute.mockResolvedValueOnce([[], null]); // no authorized orgs

    const requester: Requester = { githubLogin: 'unmapped', isAdmin: false, authDisabled: false };
    const result = await getReportHighlights(requester);

    expect(result).toEqual({ available: false });
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });

  it('selects latest report scoped to authorized orgs only', async () => {
    // User can access 'acme' but NOT 'globex'
    // globexLatest is newer but should be excluded
    const mockClient = {
      chat: {
        completions: {
          create: jest.fn().mockResolvedValue({
            choices: [{ message: { content: JSON.stringify({ highlights: [] }) } }],
          }),
        },
      },
    };
    mockGetLLMClient.mockResolvedValue(mockClient);

    mockExecute
      .mockResolvedValueOnce([[{ org: 'acme' }], null])  // authorized orgs
      .mockResolvedValueOnce([[acmeLatest], null])       // latest within authorized orgs
      .mockResolvedValueOnce([[acmePrev], null])         // previous report
      .mockResolvedValueOnce([[], null])                 // cache miss
      .mockResolvedValueOnce([[], null])                 // statsA
      .mockResolvedValueOnce([[], null])                 // statsB
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]); // INSERT

    const requester: Requester = { githubLogin: 'alice', isAdmin: false, authDisabled: false };
    const result = await getReportHighlights(requester);

    expect(result.available).toBe(true);
    expect(result.org).toBe('acme');

    // Verify the query includes org IN (?) clause
    const latestReportQuery = mockExecute.mock.calls[1][0];
    expect(latestReportQuery).toContain('org IN (');
    expect(mockExecute.mock.calls[1][1]).toEqual(['acme']);
  });

  it('admin gets globally newest report across all orgs', async () => {
    mockExecute
      .mockResolvedValueOnce([[{ org: 'acme' }, { org: 'globex' }], null]) // all orgs
      .mockResolvedValueOnce([[globexLatest], null])     // globally newest
      .mockResolvedValueOnce([[], null]);                // no previous (for simplicity)

    const requester: Requester = { githubLogin: 'admin', isAdmin: true, authDisabled: false };
    const result = await getReportHighlights(requester);

    // available: false because no previous report, but org selection worked
    expect(result.available).toBe(false);
    // Verify admin query included all orgs
    expect(mockExecute.mock.calls[1][1]).toEqual(['acme', 'globex']);
  });

  it('falls back to global selection when no requester provided (backward compatibility)', async () => {
    mockExecute
      .mockResolvedValueOnce([[globexLatest], null])     // global latest
      .mockResolvedValueOnce([[], null]);                // no previous

    const result = await getReportHighlights(undefined);

    expect(result.available).toBe(false);

    // Verify no org filtering in query
    const latestReportQuery = mockExecute.mock.calls[0][0];
    expect(latestReportQuery).not.toContain('org IN (');
  });

  it('prevents cross-tenant data leak: user in org A cannot see org B highlights', async () => {
    // This is the core exploit scenario from the pentest
    // User alice is mapped to 'acme' only
    // The globally newest report is for 'globex'
    // Without the fix, alice would see globex's data
    const mockClient = {
      chat: {
        completions: {
          create: jest.fn().mockResolvedValue({
            choices: [{ message: { content: JSON.stringify({ highlights: [] }) } }],
          }),
        },
      },
    };
    mockGetLLMClient.mockResolvedValue(mockClient);

    mockExecute
      .mockResolvedValueOnce([[{ org: 'acme' }], null])  // alice's authorized orgs
      .mockResolvedValueOnce([[acmeLatest], null])       // latest for acme (not globex)
      .mockResolvedValueOnce([[acmePrev], null])
      .mockResolvedValueOnce([[], null])                 // cache miss
      .mockResolvedValueOnce([[], null])                 // statsA
      .mockResolvedValueOnce([[], null])                 // statsB
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]); // INSERT

    const requester: Requester = { githubLogin: 'alice', isAdmin: false, authDisabled: false };
    const result = await getReportHighlights(requester);

    // Should get acme data, NOT globex
    expect(result.org).toBe('acme');
    expect(result.org).not.toBe('globex');
  });
});

describe('MCP tools - tenant authorization', () => {
  const acmeReport = { id: 'report-acme', org: 'acme', period_days: 30, created_at: '2026-03-15T10:00:00Z' };
  const globexReport = { id: 'report-globex', org: 'globex', period_days: 30, created_at: '2026-03-16T10:00:00Z' };

  describe('get_project_insights tool', () => {
    it('forwards requester context and enforces authorization', async () => {
      // User can only access 'acme'
      mockExecute
        .mockResolvedValueOnce([[{ org: 'acme' }], null])  // authorized orgs
        .mockResolvedValueOnce([[acmeReport], null])       // latest within authorized orgs
        .mockResolvedValueOnce([[{ cnt: 2 }], null])
        .mockResolvedValueOnce([[{ commits: 5, prs: 1 }], null])
        .mockResolvedValueOnce([[{
          highlights_json: JSON.stringify({
            _v: 3,
            projects: [],
            untracked_work: [],
            otherTotals: {},
            otherDetails: {}
          })
        }], null]);

      const requester: Requester = { githubLogin: 'alice', isAdmin: false, authDisabled: false };
      const result = await callTool('get_project_insights', {}, requester);

      expect(result.available).toBe(true);
      expect(result.report.org).toBe('acme');
    });

    it('prevents unauthorized access to specific report', async () => {
      // User tries to access globex report but is only authorized for acme
      mockExecute
        .mockResolvedValueOnce([[globexReport], null])     // report lookup
        .mockResolvedValueOnce([[{ org: 'acme' }], null]); // authorized orgs

      const requester: Requester = { githubLogin: 'alice', isAdmin: false, authDisabled: false };
      const result = await callTool('get_project_insights', { report_id: 'report-globex' }, requester);

      expect(result).toEqual({ available: false });
    });
  });

  describe('get_project_details tool', () => {
    it('inherits authorization from get_project_insights', async () => {
      // get_project_details calls getProjectInsights internally
      mockExecute
        .mockResolvedValueOnce([[globexReport], null])     // report lookup
        .mockResolvedValueOnce([[{ org: 'acme' }], null]); // authorized orgs (no globex)

      const requester: Requester = { githubLogin: 'alice', isAdmin: false, authDisabled: false };
      const result = await callTool('get_project_details', { project_name: 'Test', report_id: 'report-globex' }, requester);

      expect(result.available).toBe(false);
    });
  });

  describe('get_highlights tool', () => {
    it('forwards requester context and enforces authorization', async () => {
      const acmeLatest = { id: 'acme-latest', org: 'acme', period_days: 30, created_at: '2026-03-15T10:00:00Z' };
      const acmePrev = { id: 'acme-prev', org: 'acme', period_days: 30, created_at: '2026-02-13T10:00:00Z' };

      const mockClient = {
        chat: {
          completions: {
            create: jest.fn().mockResolvedValue({
              choices: [{ message: { content: JSON.stringify({ highlights: [] }) } }],
            }),
          },
        },
      };
      mockGetLLMClient.mockResolvedValue(mockClient);

      mockExecute
        .mockResolvedValueOnce([[{ org: 'acme' }], null])  // authorized orgs
        .mockResolvedValueOnce([[acmeLatest], null])       // latest
        .mockResolvedValueOnce([[acmePrev], null])         // previous
        .mockResolvedValueOnce([[], null])                 // cache miss
        .mockResolvedValueOnce([[], null])                 // statsA
        .mockResolvedValueOnce([[], null])                 // statsB
        .mockResolvedValueOnce([{ affectedRows: 1 }, null]); // INSERT

      const requester: Requester = { githubLogin: 'alice', isAdmin: false, authDisabled: false };
      const result = await callTool('get_highlights', {}, requester);

      expect(result.available).toBe(true);
      expect(result.org).toBe('acme');
    });

    it('prevents cross-tenant access via MCP', async () => {
      // This tests the MCP path of the exploit
      mockExecute
        .mockResolvedValueOnce([[{ org: 'acme' }], null])  // alice's authorized orgs
        .mockResolvedValueOnce([[], null]);                // no reports in acme

      const requester: Requester = { githubLogin: 'alice', isAdmin: false, authDisabled: false };
      const result = await callTool('get_highlights', {}, requester);

      // Should not get globex data even if it's the globally newest
      expect(result.available).toBe(false);
    });
  });
});

describe('Security properties', () => {
  it('getAuthorizedOrgs never returns orgs the user is not mapped to (non-admin)', async () => {
    mockExecute.mockResolvedValueOnce([
      [{ org: 'acme' }],
      null,
    ]);

    const requester: Requester = { githubLogin: 'alice', isAdmin: false, authDisabled: false };
    const orgs = await getAuthorizedOrgs(requester);

    // Should only contain orgs from user_mappings query
    expect(orgs.has('globex')).toBe(false);
    expect(orgs.has('initech')).toBe(false);
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('user_mappings'),
      ['alice'],
    );
  });

  it('report selection queries include org predicate when requester provided', async () => {
    mockExecute
      .mockResolvedValueOnce([[{ org: 'acme' }], null])
      .mockResolvedValueOnce([[], null]);

    const requester: Requester = { githubLogin: 'alice', isAdmin: false, authDisabled: false };
    await getProjectInsights(undefined, requester);

    // Second call should be the report selection with org filter
    const [sql, params] = mockExecute.mock.calls[1];
    expect(sql).toContain('org IN (');
    expect(params).toEqual(['acme']);
  });

  it('authorization check happens before data queries', async () => {
    const globexReport = { id: 'report-globex', org: 'globex', period_days: 30, created_at: '2026-03-16T10:00:00Z' };

    mockExecute
      .mockResolvedValueOnce([[globexReport], null])     // report lookup
      .mockResolvedValueOnce([[{ org: 'acme' }], null]); // authorized orgs

    const requester: Requester = { githubLogin: 'alice', isAdmin: false, authDisabled: false };
    await getProjectInsights('report-globex', requester);

    // Should only have 2 calls: report lookup + authorized orgs
    // Should NOT proceed to jira_issues, developer_stats queries
    expect(mockExecute).toHaveBeenCalledTimes(2);
  });

  it('empty authorized orgs set prevents any report access', async () => {
    mockExecute.mockResolvedValueOnce([[], null]); // no orgs

    const requester: Requester = { githubLogin: 'unmapped', isAdmin: false, authDisabled: false };
    const result = await getProjectInsights(undefined, requester);

    expect(result).toEqual({ available: false });
    // Should not attempt to query reports
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });
});
