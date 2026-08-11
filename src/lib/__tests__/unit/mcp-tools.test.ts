jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));
jest.mock('@/lib/db/index', () => ({ __esModule: true, default: { execute: jest.fn() } }));
// @/lib/report/summary (used for get_developer_summary) transitively imports
// @/lib/report-runner, which imports the ESM-only `p-limit` package. Mock it
// the same way sibling tests do (report-summary.test.ts, report-dev.test.ts, etc.)
jest.mock('@/lib/report-runner', () => ({ runReport: jest.fn().mockResolvedValue(undefined), requestStop: jest.fn() }));

import { MCP_TOOLS, callTool } from '@/lib/mcp/tools';
import db from '@/lib/db/index';

const mockExecute = db.execute as jest.Mock;
beforeEach(() => mockExecute.mockReset());

describe('MCP tool registry', () => {
  const EXPECTED = [
    'list_reports', 'get_org_summary', 'query_commits', 'query_jira_issues',
    'query_developer_stats', 'query_unmerged_work', 'get_project_insights',
    'get_project_details', 'get_highlights', 'get_team_pulse',
    'get_developer_summary', 'get_release_notes', 'get_epic_summaries',
    'get_metric_timeseries', 'query_model_usage', 'query_skills_usage',
  ];

  it('registers exactly the expected tools with unique names', () => {
    const names = MCP_TOOLS.map(t => t.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.sort()).toEqual([...EXPECTED].sort());
  });

  it('every tool has a description and a JSON-Schema inputSchema of type object', () => {
    for (const t of MCP_TOOLS) {
      expect(typeof t.description).toBe('string');
      expect(t.description.length).toBeGreaterThan(0);
      expect((t.inputSchema as any).type).toBe('object');
      expect(typeof t.handler).toBe('function');
    }
  });

  it('callTool dispatches to the handler (list_reports round-trip)', async () => {
    mockExecute.mockResolvedValueOnce([[{ id: 'r1', org: 'acme', period_days: 30, status: 'completed', created_at: 'x', completed_at: 'y' }], null]);
    const out = await callTool('list_reports', { limit: 5 });
    expect(out.reports).toHaveLength(1);
  });

  it('callTool returns an error object for an unknown tool', async () => {
    expect(await callTool('nope', {})).toEqual({ error: 'unknown tool: nope' });
  });

  // GLOOK-37. query_model_usage gates on the requester, so a handler registered
  // as `(a) => queryModelUsage(a)` — dropping the second arg — would fail closed
  // and silently return nothing for everyone. That bug is invisible to tests
  // that call queryModelUsage directly, so assert the wiring here: an admin
  // requester must reach the query and keep the rows.
  it('callTool forwards the requester to query_model_usage', async () => {
    mockExecute
      .mockResolvedValueOnce([[{ id: 'r1' }], null])                                            // resolveReportId
      .mockResolvedValueOnce([[{ github_login: 'alice', model: 'opus', cost: '1', requests: '2' }], null]);
    const out = await callTool('query_model_usage', { report_id: 'r1' }, { githubLogin: 'a', isAdmin: true, authDisabled: false });
    expect(out.models).toHaveLength(1);
  });

  // No equivalent test for query_skills_usage: its handler is ungated, so
  // passing or omitting the second argument is behaviourally identical and
  // there is no failure mode to defend. The registry assertion above already
  // catches a handler pointed at the wrong function.

  it('callTool masks a handler throw behind a generic error (no internal detail leaked)', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockExecute.mockRejectedValueOnce(new Error('secret DB detail: table users'));
    const out = await callTool('list_reports', {});
    expect(out).toEqual({ error: 'Tool "list_reports" failed. See server logs for details.' });
    expect(out.error).not.toContain('secret DB detail'); // raw message not surfaced
    spy.mockRestore();
  });

  describe('handler branches', () => {
    it('get_project_details returns not-found with the available project names', async () => {
      // get_project_insights is cached in report_comparisons; mock its resolution +
      // cache read so getProjectInsights returns a projects list without an LLM call.
      mockExecute
        .mockResolvedValueOnce([[{ id: 'r1', org: 'acme', period_days: 30, created_at: 'x' }], null]) // report lookup
        .mockResolvedValueOnce([[{ cnt: 3 }], null])                                                   // jira count
        .mockResolvedValueOnce([[{ commits: 1, prs: 1 }], null])                                       // totals
        .mockResolvedValueOnce([[{ highlights_json: JSON.stringify({ _v: 3, projects: [{ name: 'Alpha' }, { name: 'Beta' }], untracked_work: [], otherTotals: {}, otherDetails: {} }) }], null]); // cache hit
      const out = await callTool('get_project_details', { project_name: 'Nope', report_id: 'r1' });
      expect(out).toEqual({ error: 'project not found', available: ['Alpha', 'Beta'] });
    });

    it('get_team_pulse errors when the team has no members', async () => {
      mockExecute
        .mockResolvedValueOnce([[{ id: 'r1' }], null]) // resolveReportId
        .mockResolvedValueOnce([[], null]);            // team_members lookup → empty
      const out = await callTool('get_team_pulse', { team: 'Ghost', org: 'acme', report_id: 'r1' });
      expect(out).toEqual({ error: 'team not found or has no members' });
    });

    it('get_developer_summary errors cleanly when no completed report exists', async () => {
      mockExecute.mockResolvedValueOnce([[], null]); // resolveReportId → none
      const out = await callTool('get_developer_summary', { login: 'alice' });
      expect(out).toEqual({ error: 'no completed reports' });
    });
  });
});
