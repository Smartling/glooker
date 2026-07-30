import db from '@/lib/db';
import {
  listReports, getOrgSummaryTool, queryCommits, queryJiraIssues,
  queryDeveloperStats, queryUnmergedWork, getEpicSummaries, getMetricTimeseries,
} from './queries';
import { resolveReportId } from './resolve';
import { getProjectInsights } from '@/lib/projects/insights';
import { getReleaseNotes } from '@/lib/release-notes/service';
import { getReportHighlights } from '@/lib/report-highlights';
import { getDevSummary } from '@/lib/report/summary';
import { getTeamPulse } from '@/lib/team-pulse';
import type { Requester } from '@/lib/cost-visibility';

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, any>;
  handler: (args: any, requester?: Requester) => Promise<any>;
}

const REPORT_ID = { report_id: { type: 'string', description: 'Report id. Omit for the latest completed report.' } };

// get_project_details: filter the insights payload down to one project by name.
async function getProjectDetails(args: { project_name: string; report_id?: string }) {
  const insights: any = await getProjectInsights(args.report_id);
  if (!insights?.available) return insights;
  const projects: any[] = insights.projects ?? [];
  const match = projects.find(p => String(p.name).toLowerCase() === String(args.project_name).toLowerCase());
  if (!match) return { error: 'project not found', available: projects.map(p => p.name) };
  return { report: insights.report, project: match };
}

// get_team_pulse: look up members, then delegate to the existing service.
async function getTeamPulseTool(args: { report_id?: string; team: string; org: string; with_projects?: boolean }) {
  const r = await resolveReportId(args.report_id);
  if ('error' in r) return r;
  const [members] = await db.execute(
    `SELECT tm.github_login FROM team_members tm JOIN teams t ON tm.team_id = t.id
     WHERE t.name = ? AND t.org = ?`,
    [args.team, args.org],
  ) as [any[], any];
  if (!members.length) return { error: 'team not found or has no members' };
  return getTeamPulse(r.id, args.team, args.org, members.map((m: any) => m.github_login), { withProjects: !!args.with_projects });
}

// get_developer_summary: resolve report, then delegate.
async function getDeveloperSummaryTool(args: { login: string; report_id?: string }) {
  const r = await resolveReportId(args.report_id);
  if ('error' in r) return r;
  return getDevSummary(r.id, args.login);
}

export const MCP_TOOLS: McpTool[] = [
  {
    name: 'list_reports',
    description: 'List Glooker report runs (id, org, period, status, dates). The entry point for finding report ids.',
    inputSchema: { type: 'object', properties: {
      org: { type: 'string', description: 'Filter by GitHub org (optional)' },
      status: { type: 'string', enum: ['pending', 'running', 'completed', 'failed', 'stopped'], description: 'Filter by status (optional)' },
      limit: { type: 'number', description: 'Max rows (default 50, max 500)' },
    } },
    handler: (a) => listReports(a),
  },
  {
    name: 'get_org_summary',
    description: 'High-level totals for a report: developers, commits, PRs, lines, averages, Jira totals.',
    inputSchema: { type: 'object', properties: { ...REPORT_ID } },
    handler: (a) => getOrgSummaryTool(a),
  },
  {
    name: 'query_commits',
    description: 'Query analyzed commits as flat rows. Omit report_id for cross-report results (deduped by SHA, earliest commit date).',
    inputSchema: { type: 'object', properties: {
      ...REPORT_ID,
      login: { type: 'string', description: 'Filter by developer login' },
      repo: { type: 'string', description: 'Filter by repo' },
      type: { type: 'string', enum: ['feature', 'bug', 'refactor', 'infra', 'docs', 'test', 'other'], description: 'Commit type' },
      since: { type: 'string', description: 'ISO date lower bound on committed_at' },
      until: { type: 'string', description: 'ISO date upper bound on committed_at' },
      min_complexity: { type: 'number', description: 'Minimum complexity 1-10' },
      ai_only: { type: 'boolean', description: 'Only AI-assisted commits' },
      limit: { type: 'number', description: 'Max rows (default 100, max 500)' },
    } },
    handler: (a) => queryCommits(a),
  },
  {
    name: 'query_jira_issues',
    description: 'Query Jira issues as flat rows. Omit report_id for cross-report results (deduped by issue key, earliest resolved date).',
    inputSchema: { type: 'object', properties: {
      ...REPORT_ID,
      login: { type: 'string', description: 'Filter by developer login' },
      project_key: { type: 'string', description: 'Filter by Jira project key e.g. GLOOK' },
      issue_type: { type: 'string', description: 'Filter by issue type e.g. Story, Bug' },
      status: { type: 'string', description: 'Filter by status' },
      since: { type: 'string', description: 'ISO date lower bound on resolved_at' },
      until: { type: 'string', description: 'ISO date upper bound on resolved_at' },
      limit: { type: 'number', description: 'Max rows (default 100, max 500)' },
    } },
    handler: (a) => queryJiraIssues(a),
  },
  {
    name: 'query_developer_stats',
    description: 'Per-developer aggregate stats for a report, ranked. Metrics: commits, PRs, lines, impact score, AI %.',
    inputSchema: { type: 'object', properties: {
      ...REPORT_ID,
      login: { type: 'string', description: 'Filter to one developer' },
      sort_by: { type: 'string', enum: ['impact_score', 'total_commits', 'total_prs', 'avg_complexity', 'lines_added', 'lines_removed', 'ai_percentage', 'pr_percentage'], description: 'Sort column (default impact_score)' },
      limit: { type: 'number', description: 'Max rows (default 100, max 500)' },
    } },
    handler: (a, requester) => queryDeveloperStats(a, requester),
  },
  {
    name: 'query_unmerged_work',
    description: 'In-flight work for a report: open PRs and unmerged branch commits.',
    inputSchema: { type: 'object', properties: {
      ...REPORT_ID,
      login: { type: 'string', description: 'Filter by developer login' },
      repo: { type: 'string', description: 'Filter by repo' },
    } },
    handler: (a) => queryUnmergedWork(a),
  },
  {
    name: 'get_project_insights',
    description: 'LLM-clustered projects for a report with Jira/PR/commit attribution, plus unattributed "Other" work. Cached; first call may take 30-60s.',
    inputSchema: { type: 'object', properties: { ...REPORT_ID } },
    handler: (a) => getProjectInsights(a.report_id),
  },
  {
    name: 'get_project_details',
    description: 'Full drill-down (Jiras, PRs, commits) for a single clustered project by name.',
    inputSchema: { type: 'object', properties: {
      project_name: { type: 'string', description: 'Exact project name from get_project_insights' },
      ...REPORT_ID,
    }, required: ['project_name'] },
    handler: (a) => getProjectDetails(a),
  },
  {
    name: 'get_highlights',
    description: 'Narrative highlights comparing the latest report to the previous one.',
    inputSchema: { type: 'object', properties: {} },
    handler: () => getReportHighlights(),
  },
  {
    name: 'get_team_pulse',
    description: 'Team health summary for a report. Requires team name and org (report period must be >= 14 days).',
    inputSchema: { type: 'object', properties: {
      team: { type: 'string', description: 'Team name' },
      org: { type: 'string', description: 'GitHub org' },
      ...REPORT_ID,
      with_projects: { type: 'boolean', description: 'Include per-project breakdown' },
    }, required: ['team', 'org'] },
    handler: (a) => getTeamPulseTool(a),
  },
  {
    name: 'get_developer_summary',
    description: 'LLM narrative + badges for a single developer in a report.',
    inputSchema: { type: 'object', properties: {
      login: { type: 'string', description: 'Developer GitHub login' },
      ...REPORT_ID,
    }, required: ['login'] },
    handler: (a) => getDeveloperSummaryTool(a),
  },
  {
    name: 'get_release_notes',
    description: 'Recent release notes for the Glooker repo (last 14 days of commits, summarized).',
    inputSchema: { type: 'object', properties: {} },
    handler: () => getReleaseNotes(),
  },
  {
    name: 'get_epic_summaries',
    description: 'Epic-level rollups (summary text, resolved/remaining Jiras, commits, devs). List all epics or drill into one.',
    inputSchema: { type: 'object', properties: {
      org: { type: 'string', description: 'Filter by org' },
      epic_key: { type: 'string', description: 'Specific epic key (optional)' },
      limit: { type: 'number', description: 'Max rows (default 100, max 500)' },
    } },
    handler: (a) => getEpicSummaries(a),
  },
  {
    name: 'get_metric_timeseries',
    description: 'Time-series or grouped aggregate of a metric across reports. metric: commits|prs|lines_added|jira_resolved|impact_score|ai_percentage. group_by: week|month|report|developer|repo|type. If neither since nor until is given, results default to the last 180 days.',
    inputSchema: { type: 'object', properties: {
      metric: { type: 'string', enum: ['commits', 'prs', 'lines_added', 'jira_resolved', 'impact_score', 'ai_percentage'], description: 'Metric to aggregate' },
      group_by: { type: 'string', enum: ['week', 'month', 'report', 'developer', 'repo', 'type'], description: 'Bucketing dimension (default week)' },
      org: { type: 'string', description: 'GitHub org (defaults to latest completed report org)' },
      since: { type: 'string', description: 'ISO date lower bound (default: 180 days ago if until is also unset)' },
      until: { type: 'string', description: 'ISO date upper bound' },
    }, required: ['metric'] },
    handler: (a) => getMetricTimeseries(a),
  },
];

const BY_NAME = new Map(MCP_TOOLS.map(t => [t.name, t]));

export async function callTool(name: string, args: Record<string, any>, requester?: Requester): Promise<any> {
  const tool = BY_NAME.get(name);
  if (!tool) return { error: `unknown tool: ${name}` };
  try {
    return await tool.handler(args ?? {}, requester);
  } catch (err) {
    // Log the real error server-side; return a generic message to the MCP caller
    // so internal detail (DB error text, table/column names) isn't leaked to an
    // arbitrary agent/client.
    console.error(`[mcp] tool "${name}" failed:`, err);
    return { error: `Tool "${name}" failed. See server logs for details.` };
  }
}
