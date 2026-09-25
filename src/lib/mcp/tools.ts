import db from '@/lib/db';
import {
  listReports, getOrgSummaryTool, queryCommits, queryJiraIssues,
  queryDeveloperStats, queryUnmergedWork, getEpicSummaries, getMetricTimeseries,
  queryModelUsage, querySkillsUsage,
} from './queries';
import { resolveReportId } from './resolve';
import { getProjectInsights } from '@/lib/projects/insights';
import { getReleaseNotes } from '@/lib/release-notes/service';
import { getReportHighlights } from '@/lib/report-highlights';
import { getDevSummary } from '@/lib/report/summary';
import { getTeamPulse } from '@/lib/team-pulse';
import type { Requester } from '@/lib/cost-visibility';
import { getSummary as getVulnSummary, getTrend as getVulnTrend, getAlerts as getVulnAlerts, getCoverage as getVulnCoverage, REASON_DISABLED as VULN_REASON_DISABLED } from '@/lib/vulnerabilities/queries';
import { parseVulnFilters } from '@/lib/vulnerabilities/filters';
import { isVulnerabilitiesEnabled } from '@/lib/vulnerabilities/config';

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

// ── GLOOK-43 vulnerability tools ──
const VULN_COMMON = 'Counts are Dependabot alerts, not CVEs: one CVE in five manifests is five alerts. '
  + 'Always check `available` (false means the feature is off or no sync has succeeded yet — say so, never report zeros) '
  + 'and `sync.stale` (true means the data is over 36h old — tell the user the date of `sync.last_successful_at`). '
  + 'Every data response carries config_errors; non-empty means results may be incomplete. ';
const VULN_FILTER_PROPS = {
  codebase: { type: 'string', enum: ['backend', 'frontend', 'shared', 'other', 'all'], description: 'Page group: backend, frontend, shared, other or all (default backend); which codebase-type values count in each is set by the deployment.' },
  team: { type: 'string', description: "The repo's team custom property value, or 'Unassigned'. Unknown values return an error listing known teams." },
  repo: { type: 'string', description: 'org/name' },
  severity: { type: 'string', enum: ['critical', 'high'] },
};

// MCP speaks snake_case; the HTTP API (consumed only by the UI) stays camelCase — a deliberate split (spec: MCP).
// Keys only, recursively. Values (team names, repo names) are never rewritten.
const snakeKey = (k: string) => k.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`);
function toSnake(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(toSnake);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [snakeKey(k), toSnake(x)]));
  return v;
}

async function vulnCall(args: Record<string, unknown>, run: (f: any) => Promise<any>) {
  if (!isVulnerabilitiesEnabled()) return { available: false, reason: VULN_REASON_DISABLED };
  const parsed = parseVulnFilters(args ?? {});
  if (!parsed.ok) return { error: parsed.error };
  return toSnake(await run(parsed.value));
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
    description: 'Per-developer aggregate stats for a report, ranked. Metrics: commits, PRs, lines, impact score, AI %. Also `cc_total_cost`, which despite its name is Claude spend in USD **cents** across all Anthropic surfaces (claude.ai + Claude Code + API); it and `cc_requests` are absent for developers whose spend the caller may not see.',
    inputSchema: { type: 'object', properties: {
      ...REPORT_ID,
      login: { type: 'string', description: 'Filter to one developer' },
      sort_by: { type: 'string', enum: ['impact_score', 'total_commits', 'total_prs', 'avg_complexity', 'lines_added', 'lines_removed', 'ai_percentage', 'pr_percentage'], description: 'Sort column (default impact_score)' },
      limit: { type: 'number', description: 'Max rows (default 100, max 500)' },
    } },
    handler: (a, requester) => queryDeveloperStats(a, requester),
  },
  {
    name: 'query_model_usage',
    description: "Per-developer Claude cost in USD cents (field `cost_cents`) and request counts, broken down by model, for a report. Covers all Anthropic surfaces the org's analytics feed reports — claude.ai, Claude Code and API — not Claude Code alone. Rows appear only for developers whose spend the caller may see; other developers' rows are omitted entirely, so an absent developer means either no usage or no visibility. `cost_visible: false` means the caller may see no costs at all, which is different from the report having no usage.",
    inputSchema: { type: 'object', properties: {
      ...REPORT_ID,
      login: { type: 'string', description: 'Filter to one developer (case-insensitive)' },
      limit: { type: 'number', description: 'Max rows (default 100, max 500)' },
    } },
    handler: (a, requester) => queryModelUsage(a, requester),
  },
  {
    name: 'query_skills_usage',
    description: 'Per-developer Claude skills usage by product (`claude_code`, `chat`, `cowork`, …) — skills invoked and distinct skills, for a report. Activity volume only, no cost, and visible for every developer in the report. Covers a window ending a few days before the report period because the analytics endpoint lags real time, so do not compare these counts against report-period commits or spend as if the windows matched.',
    inputSchema: { type: 'object', properties: {
      ...REPORT_ID,
      login: { type: 'string', description: 'Filter to one developer (case-insensitive)' },
      limit: { type: 'number', description: 'Max rows (default 100, max 500)' },
    } },
    handler: (a) => querySkillsUsage(a),
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
  {
    name: 'list_vulnerabilities',
    description: VULN_COMMON + 'Lists critical/high Dependabot alerts with SLA fields (due_date, days_remaining — negative means overdue, sla_policy_id), age, state, dismissed_reason and a link. Use for "our new CVEs" (created_since) and "what is due" (due_before / overdue). Returns total_count and truncated. The response also includes `repos` (per-repo counts under the current filters, ignoring `repo`) to help pick a `repo` filter.',
    inputSchema: { type: 'object', properties: {
      ...VULN_FILTER_PROPS,
      state: { type: 'string', enum: ['open', 'resolved', 'all'], description: 'default open' },
      overdue: { type: 'boolean' },
      due_soon: { type: 'boolean', description: 'Open with a due date 0-7 days out. An overdue alert does not count as due soon.' },
      due_before: { type: 'string', description: 'YYYY-MM-DD' },
      created_since: { type: 'string', description: 'YYYY-MM-DD' },
      resolved_since: { type: 'string', description: 'YYYY-MM-DD' },
      dependency_scope: { type: 'string', enum: ['runtime', 'development', 'unknown'] },
      cve: { type: 'string' }, ghsa: { type: 'string' },
      package: { type: 'string', description: 'echoed as applied_filters.package_name' },
      limit: { type: 'number', description: 'default 100, max 500' },
    } },
    handler: (a) => vulnCall(a, f => getVulnAlerts(f)),
  },
  {
    name: 'get_vulnerability_summary',
    description: VULN_COMMON + 'Per-team pivot: open, resolved since the start date (resolved_count_start_date), dismissed, % closed (null when nothing to close), overdue, due in 7 days, unmeasured_repos; plus the delta since a baseline (new / resolved / reopened / other, which always reconcile) and the SLA policy in effect. '
      + '`resolved` includes `carried_resolved` from imported CSV history for archived repos with no alert data in Glooker. '
      + '`sla_policy_invalid` true means the SLA policy configuration is invalid and no SLA applies (so `sla_status` \'none\' does not mean "no policy"); `resolved_count_start_date` null means all time; when `resolved_count_invalid` is true, `resolved` and `pct_closed` are null.',
    inputSchema: { type: 'object', properties: {
      codebase: VULN_FILTER_PROPS.codebase, team: VULN_FILTER_PROPS.team,
      baseline: { type: 'string', description: "last (previous sync), 7d, 30d or YYYY-MM-DD. Default last." },
    } },
    handler: (a) => vulnCall(a, f => getVulnSummary(f)),
  },
  {
    name: 'get_vulnerability_trend',
    description: VULN_COMMON + 'Open-count per team per day from measured snapshots only (no reconstructed history). High and non-Backend views start at the first sync.',
    inputSchema: { type: 'object', properties: {
      codebase: VULN_FILTER_PROPS.codebase, team: VULN_FILTER_PROPS.team, severity: VULN_FILTER_PROPS.severity,
      since: { type: 'string', description: 'YYYY-MM-DD' },
    } },
    handler: (a) => vulnCall(a, f => getVulnTrend(f)),
  },
  {
    name: 'get_vulnerability_coverage',
    description: VULN_COMMON + 'Repos with open alerts that need tagging (missing tier, codebase-type or team property), repos outside the configured tracking scope, and in-scope repos whose Dependabot status is unmeasured.',
    inputSchema: { type: 'object', properties: { team: VULN_FILTER_PROPS.team } },
    handler: (a) => vulnCall(a, f => getVulnCoverage(f)),
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
