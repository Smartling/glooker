/**
 * MCP organization allowlist enforcement tests.
 *
 * Pentest finding: MCP tools bypassed the configured organization allowlist by
 * accepting caller-controlled org parameters without invoking assertAllowedOrg.
 * The equivalent HTTP routes enforced the allowlist with requireAllowedOrg.
 *
 * This test suite verifies that:
 *  1. get_team_pulse enforces the org allowlist before querying team members
 *  2. list_reports enforces the org allowlist when filtering by org
 *  3. get_epic_summaries enforces the org allowlist when filtering by org
 *  4. get_metric_timeseries enforces the org allowlist when filtering by org
 *  5. All org-scoped MCP tools reject disallowed orgs with OrgNotAllowedError
 *
 * The fix adds assertAllowedOrg calls at the entry point of each tool that
 * accepts an org parameter, matching the HTTP route pattern.
 */

jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));
jest.mock('@/lib/db/index', () => ({ __esModule: true, default: { execute: jest.fn() } }));
jest.mock('@/lib/report-runner', () => ({ runReport: jest.fn().mockResolvedValue(undefined), requestStop: jest.fn() }));

import { callTool } from '@/lib/mcp/tools';
import { listReports, getEpicSummaries, getMetricTimeseries } from '@/lib/mcp/queries';
import { _clearOrgCache, OrgNotAllowedError } from '@/lib/orgs/guard';
import db from '@/lib/db/index';

const mockExecute = db.execute as jest.Mock;

const saved = process.env.ALLOWED_ORGS;
beforeEach(() => {
  mockExecute.mockReset();
  delete process.env.ALLOWED_ORGS;
  _clearOrgCache();
});
afterAll(() => {
  if (saved === undefined) delete process.env.ALLOWED_ORGS;
  else process.env.ALLOWED_ORGS = saved;
  _clearOrgCache();
});

describe('MCP organization allowlist enforcement', () => {
  describe('get_team_pulse tool', () => {
    it('rejects a disallowed org before querying team members', async () => {
      process.env.ALLOWED_ORGS = 'smartling';
      // No mock setup for team_members query — it should never be reached
      const result = await callTool('get_team_pulse', {
        team: 'Engineering',
        org: 'victim-inc',
        report_id: 'r1',
      });
      expect(result).toEqual({ error: 'Tool "get_team_pulse" failed. See server logs for details.' });
      // Verify the team_members query was never executed
      expect(mockExecute).not.toHaveBeenCalled();
    });

    it('accepts an allowed org and proceeds to query team members', async () => {
      process.env.ALLOWED_ORGS = 'smartling';
      mockExecute
        .mockResolvedValueOnce([[{ id: 'r1' }], null])  // resolveReportId
        .mockResolvedValueOnce([[], null]);             // team_members query → empty
      const result = await callTool('get_team_pulse', {
        team: 'Engineering',
        org: 'smartling',
        report_id: 'r1',
      });
      // Should reach the "team not found" error, proving the query executed
      expect(result).toEqual({ error: 'team not found or has no members' });
      expect(mockExecute).toHaveBeenCalledTimes(2);
    });

    it('accepts any well-formed org when ALLOWED_ORGS is not configured', async () => {
      // ALLOWED_ORGS unset → no allowlist enforcement
      mockExecute
        .mockResolvedValueOnce([[{ id: 'r1' }], null])  // resolveReportId
        .mockResolvedValueOnce([[], null]);             // team_members query
      const result = await callTool('get_team_pulse', {
        team: 'Engineering',
        org: 'any-org',
        report_id: 'r1',
      });
      expect(result).toEqual({ error: 'team not found or has no members' });
      expect(mockExecute).toHaveBeenCalledTimes(2);
    });

    it('compares org case-insensitively', async () => {
      process.env.ALLOWED_ORGS = 'Smartling';
      mockExecute
        .mockResolvedValueOnce([[{ id: 'r1' }], null])
        .mockResolvedValueOnce([[], null]);
      const result = await callTool('get_team_pulse', {
        team: 'Engineering',
        org: 'SMARTLING',
        report_id: 'r1',
      });
      expect(result).toEqual({ error: 'team not found or has no members' });
      expect(mockExecute).toHaveBeenCalledTimes(2);
    });

    it('rejects malformed org names regardless of allowlist', async () => {
      // No ALLOWED_ORGS set, but shape validation still applies
      const result = await callTool('get_team_pulse', {
        team: 'Engineering',
        org: '../../etc/passwd',
        report_id: 'r1',
      });
      expect(result).toEqual({ error: 'Tool "get_team_pulse" failed. See server logs for details.' });
      expect(mockExecute).not.toHaveBeenCalled();
    });
  });

  describe('list_reports query', () => {
    it('rejects a disallowed org filter', async () => {
      process.env.ALLOWED_ORGS = 'smartling';
      await expect(listReports({ org: 'victim-inc' })).rejects.toThrow(OrgNotAllowedError);
      expect(mockExecute).not.toHaveBeenCalled();
    });

    it('accepts an allowed org filter', async () => {
      process.env.ALLOWED_ORGS = 'smartling';
      mockExecute.mockResolvedValueOnce([[{ id: 'r1', org: 'smartling', status: 'completed' }], null]);
      const result = await listReports({ org: 'smartling' });
      expect(result.reports).toHaveLength(1);
      expect(mockExecute).toHaveBeenCalledTimes(1);
      // Verify the org parameter was passed to the query
      const [sql, params] = mockExecute.mock.calls[0];
      expect(sql).toContain('org = ?');
      expect(params).toContain('smartling');
    });

    it('allows queries without org filter when ALLOWED_ORGS is set', async () => {
      process.env.ALLOWED_ORGS = 'smartling';
      mockExecute.mockResolvedValueOnce([[{ id: 'r1', org: 'smartling', status: 'completed' }], null]);
      const result = await listReports({ limit: 10 });
      expect(result.reports).toHaveLength(1);
      expect(mockExecute).toHaveBeenCalledTimes(1);
      // Verify no org filter was applied
      const [sql] = mockExecute.mock.calls[0];
      expect(sql).not.toContain('org = ?');
    });

    it('trims and normalizes the allowed org', async () => {
      process.env.ALLOWED_ORGS = 'smartling';
      mockExecute.mockResolvedValueOnce([[], null]);
      await listReports({ org: '  smartling  ' });
      const [, params] = mockExecute.mock.calls[0];
      expect(params).toContain('smartling'); // trimmed
    });
  });

  describe('get_epic_summaries query', () => {
    it('rejects a disallowed org filter', async () => {
      process.env.ALLOWED_ORGS = 'smartling';
      await expect(getEpicSummaries({ org: 'victim-inc' })).rejects.toThrow(OrgNotAllowedError);
      expect(mockExecute).not.toHaveBeenCalled();
    });

    it('accepts an allowed org filter', async () => {
      process.env.ALLOWED_ORGS = 'smartling';
      mockExecute.mockResolvedValueOnce([[{ epic_key: 'PROJ-1', org: 'smartling' }], null]);
      const result = await getEpicSummaries({ org: 'smartling' });
      expect(result.epics).toHaveLength(1);
      expect(mockExecute).toHaveBeenCalledTimes(1);
      const [sql, params] = mockExecute.mock.calls[0];
      expect(sql).toContain('es.org = ?');
      expect(params).toContain('smartling');
    });

    it('allows queries without org filter', async () => {
      process.env.ALLOWED_ORGS = 'smartling';
      mockExecute.mockResolvedValueOnce([[], null]);
      const result = await getEpicSummaries({ limit: 10 });
      expect(result.epics).toEqual([]);
      const [sql] = mockExecute.mock.calls[0];
      expect(sql).not.toContain('es.org = ?');
    });
  });

  describe('get_metric_timeseries query', () => {
    it('rejects a disallowed org filter in report-level metrics', async () => {
      process.env.ALLOWED_ORGS = 'smartling';
      await expect(
        getMetricTimeseries({ metric: 'impact_score', org: 'victim-inc' })
      ).rejects.toThrow(OrgNotAllowedError);
      expect(mockExecute).not.toHaveBeenCalled();
    });

    it('accepts an allowed org filter in report-level metrics', async () => {
      process.env.ALLOWED_ORGS = 'smartling';
      mockExecute.mockResolvedValueOnce([[], null]);
      const result = await getMetricTimeseries({ metric: 'impact_score', org: 'smartling' });
      expect('series' in result ? result.series : undefined).toEqual([]);
      const [sql, params] = mockExecute.mock.calls[0];
      expect(sql).toContain('r.org = ?');
      expect(params).toContain('smartling');
    });

    it('rejects a disallowed org filter in commit-level metrics', async () => {
      process.env.ALLOWED_ORGS = 'smartling';
      await expect(
        getMetricTimeseries({ metric: 'commits', org: 'victim-inc' })
      ).rejects.toThrow(OrgNotAllowedError);
      // Should not reach the resolveReportId fallback
      expect(mockExecute).not.toHaveBeenCalled();
    });

    it('accepts an allowed org filter in commit-level metrics', async () => {
      process.env.ALLOWED_ORGS = 'smartling';
      mockExecute.mockResolvedValueOnce([[], null]);  // timeseries query (no report lookup needed when org is provided)
      const result = await getMetricTimeseries({ metric: 'commits', org: 'smartling' });
      expect('series' in result ? result.series : undefined).toEqual([]);
      expect(mockExecute).toHaveBeenCalledTimes(1);
    });

    it('falls back to latest report when org is not specified', async () => {
      process.env.ALLOWED_ORGS = 'smartling';
      mockExecute
        .mockResolvedValueOnce([[{ id: 'r1', org: 'smartling' }], null])  // resolveReportId
        .mockResolvedValueOnce([[{ id: 'r1', org: 'smartling' }], null])  // report lookup
        .mockResolvedValueOnce([[], null]);                                // timeseries query
      const result = await getMetricTimeseries({ metric: 'commits' });
      expect('series' in result ? result.series : undefined).toEqual([]);
      expect(mockExecute).toHaveBeenCalledTimes(3);
    });
  });

  describe('defense in depth: shape validation', () => {
    it('rejects SQL injection attempts in org parameter', async () => {
      const malicious = [
        "smartling' OR '1'='1",
        'smartling; DROP TABLE reports--',
        'smartling" OR "1"="1',
        'smartling\' UNION SELECT * FROM users--',
      ];

      for (const org of malicious) {
        mockExecute.mockReset();
        await expect(listReports({ org })).rejects.toThrow(OrgNotAllowedError);
        expect(mockExecute).not.toHaveBeenCalled();
      }
    });

    it('rejects path traversal attempts in org parameter', async () => {
      const malicious = ['../../etc/passwd', '../admin', 'org/subpath', 'org\\path'];

      for (const org of malicious) {
        mockExecute.mockReset();
        await expect(listReports({ org })).rejects.toThrow(OrgNotAllowedError);
        expect(mockExecute).not.toHaveBeenCalled();
      }
    });

    it('rejects overly long org names', async () => {
      const tooLong = 'a'.repeat(40); // GitHub org names are max 39 chars
      await expect(listReports({ org: tooLong })).rejects.toThrow(OrgNotAllowedError);
      expect(mockExecute).not.toHaveBeenCalled();
    });

    it('rejects org names with special characters', async () => {
      const invalid = ['org.with.dots', 'org with spaces', 'org@domain', 'org#tag'];

      for (const org of invalid) {
        mockExecute.mockReset();
        await expect(listReports({ org })).rejects.toThrow(OrgNotAllowedError);
        expect(mockExecute).not.toHaveBeenCalled();
      }
    });
  });

  describe('security property: allowlist is enforced before database access', () => {
    it('get_team_pulse: assertAllowedOrg is called before any database query', async () => {
      process.env.ALLOWED_ORGS = 'smartling';
      const result = await callTool('get_team_pulse', {
        team: 'Engineering',
        org: 'victim-inc',
        report_id: 'r1',
      });
      // The tool should fail without executing any queries
      expect(result.error).toBeTruthy();
      expect(mockExecute).not.toHaveBeenCalled();
    });

    it('list_reports: assertAllowedOrg is called before the reports query', async () => {
      process.env.ALLOWED_ORGS = 'smartling';
      await expect(listReports({ org: 'victim-inc' })).rejects.toThrow(OrgNotAllowedError);
      expect(mockExecute).not.toHaveBeenCalled();
    });

    it('get_epic_summaries: assertAllowedOrg is called before the epics query', async () => {
      process.env.ALLOWED_ORGS = 'smartling';
      await expect(getEpicSummaries({ org: 'victim-inc' })).rejects.toThrow(OrgNotAllowedError);
      expect(mockExecute).not.toHaveBeenCalled();
    });

    it('get_metric_timeseries: assertAllowedOrg is called before any query', async () => {
      process.env.ALLOWED_ORGS = 'smartling';
      await expect(
        getMetricTimeseries({ metric: 'commits', org: 'victim-inc' })
      ).rejects.toThrow(OrgNotAllowedError);
      expect(mockExecute).not.toHaveBeenCalled();
    });
  });

  describe('regression: HTTP route parity', () => {
    it('MCP get_team_pulse now matches HTTP /api/report/[id]/team-pulse allowlist enforcement', async () => {
      // The HTTP route calls requireAllowedOrg before querying team members.
      // The MCP tool must do the same with assertAllowedOrg.
      process.env.ALLOWED_ORGS = 'smartling';

      // Disallowed org should be rejected
      const rejected = await callTool('get_team_pulse', {
        team: 'Engineering',
        org: 'victim-inc',
        report_id: 'r1',
      });
      expect(rejected.error).toBeTruthy();
      expect(mockExecute).not.toHaveBeenCalled();

      // Allowed org should proceed
      mockExecute
        .mockResolvedValueOnce([[{ id: 'r1' }], null])
        .mockResolvedValueOnce([[], null]);
      const allowed = await callTool('get_team_pulse', {
        team: 'Engineering',
        org: 'smartling',
        report_id: 'r1',
      });
      expect(allowed).toEqual({ error: 'team not found or has no members' });
      expect(mockExecute).toHaveBeenCalledTimes(2);
    });

    it('MCP list_reports now matches HTTP /api/reports allowlist enforcement', async () => {
      // The HTTP route would call requireAllowedOrg when org is provided.
      // The MCP query must do the same with assertAllowedOrg.
      process.env.ALLOWED_ORGS = 'smartling';

      await expect(listReports({ org: 'victim-inc' })).rejects.toThrow(OrgNotAllowedError);
      expect(mockExecute).not.toHaveBeenCalled();

      mockExecute.mockResolvedValueOnce([[], null]);
      const result = await listReports({ org: 'smartling' });
      expect(result.reports).toEqual([]);
      expect(mockExecute).toHaveBeenCalledTimes(1);
    });
  });

  describe('edge cases', () => {
    it('handles empty string org parameter (treated as no filter)', async () => {
      process.env.ALLOWED_ORGS = 'smartling';
      // Empty string is falsy in JavaScript, so `if (args.org)` is false
      // and no org filter is applied
      mockExecute.mockResolvedValueOnce([[], null]);
      const result = await listReports({ org: '' });
      expect(result.reports).toEqual([]);
      const [sql] = mockExecute.mock.calls[0];
      expect(sql).not.toContain('org = ?');
    });

    it('handles whitespace-only org parameter', async () => {
      process.env.ALLOWED_ORGS = 'smartling';
      // Whitespace-only string is truthy, so assertAllowedOrg is called and rejects it
      await expect(listReports({ org: '   ' })).rejects.toThrow(OrgNotAllowedError);
      expect(mockExecute).not.toHaveBeenCalled();
    });

    it('handles null org parameter gracefully (treated as no filter)', async () => {
      process.env.ALLOWED_ORGS = 'smartling';
      // null is falsy, so `if (args.org)` is false and no org filter is applied
      mockExecute.mockResolvedValueOnce([[], null]);
      const result = await listReports({ org: null as any });
      expect(result.reports).toEqual([]);
      const [sql] = mockExecute.mock.calls[0];
      expect(sql).not.toContain('org = ?');
    });

    it('handles undefined org parameter gracefully', async () => {
      process.env.ALLOWED_ORGS = 'smartling';
      // When org is undefined, the query should proceed without org filter
      mockExecute.mockResolvedValueOnce([[], null]);
      const result = await listReports({ org: undefined });
      expect(result.reports).toEqual([]);
      const [sql] = mockExecute.mock.calls[0];
      expect(sql).not.toContain('org = ?');
    });

    it('handles multiple orgs in allowlist', async () => {
      process.env.ALLOWED_ORGS = 'smartling, acme, victim-inc';
      mockExecute.mockResolvedValueOnce([[], null]);
      
      // All three should be allowed
      await listReports({ org: 'smartling' });
      mockExecute.mockResolvedValueOnce([[], null]);
      await listReports({ org: 'acme' });
      mockExecute.mockResolvedValueOnce([[], null]);
      await listReports({ org: 'victim-inc' });
      
      // But not others
      await expect(listReports({ org: 'other-org' })).rejects.toThrow(OrgNotAllowedError);
    });
  });
});
