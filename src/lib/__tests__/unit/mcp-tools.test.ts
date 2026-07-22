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
    'get_metric_timeseries',
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

  it('callTool converts a handler throw into an error object', async () => {
    mockExecute.mockRejectedValueOnce(new Error('boom'));
    const out = await callTool('list_reports', {});
    expect(out).toEqual({ error: 'boom' });
  });
});
