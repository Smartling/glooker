import db from '@/lib/db';

// Tool definitions for LLM function calling
export const TOOL_DEFINITIONS = [
  {
    type: 'function' as const,
    function: {
      name: 'queryLeaderboard',
      description: 'Get developers ranked by a metric. Use this for questions about top/bottom performers, rankings, comparisons across the org.',
      parameters: {
        type: 'object',
        properties: {
          org: { type: 'string', description: 'GitHub org name' },
          metric: { type: 'string', enum: ['impact_score', 'total_commits', 'total_prs', 'avg_complexity', 'lines_added', 'ai_percentage', 'pr_percentage'], description: 'Metric to rank by' },
          order: { type: 'string', enum: ['desc', 'asc'], description: 'Sort order' },
          limit: { type: 'number', description: 'Max results (default 10, max 100)' },
          team: { type: 'string', description: 'Filter by team name (optional)' },
        },
        required: ['org', 'metric'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'queryDevStats',
      description: 'Get detailed stats for specific developer(s). Use for questions about individual performance, comparing two developers.',
      parameters: {
        type: 'object',
        properties: {
          org: { type: 'string', description: 'GitHub org name' },
          logins: { type: 'array', items: { type: 'string' }, description: 'GitHub logins to look up' },
        },
        required: ['org', 'logins'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'queryCommits',
      description: 'Search commits with filters. Use for questions about specific types of work, complexity, recent activity, AI usage patterns.',
      parameters: {
        type: 'object',
        properties: {
          org: { type: 'string', description: 'GitHub org name' },
          login: { type: 'string', description: 'Filter by developer login (optional)' },
          minComplexity: { type: 'number', description: 'Minimum complexity score 1-10 (optional)' },
          maxComplexity: { type: 'number', description: 'Maximum complexity score 1-10 (optional)' },
          type: { type: 'string', enum: ['feature', 'bug', 'refactor', 'infra', 'docs', 'test', 'other'], description: 'Commit type filter (optional)' },
          days: { type: 'number', description: 'Only commits from last N days (optional)' },
          aiOnly: { type: 'boolean', description: 'Only AI-assisted commits (optional)' },
          limit: { type: 'number', description: 'Max results (default 20, max 100)' },
        },
        required: ['org'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'queryTeams',
      description: 'Get team information with members and aggregate stats. Use for questions about team performance, team composition, cross-team comparisons.',
      parameters: {
        type: 'object',
        properties: {
          org: { type: 'string', description: 'GitHub org name' },
          name: { type: 'string', description: 'Specific team name (optional, returns all teams if omitted)' },
        },
        required: ['org'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'queryOrgSummary',
      description: 'Get high-level org summary: total developers, commits, PRs, averages, trends. Use for overview questions.',
      parameters: {
        type: 'object',
        properties: {
          org: { type: 'string', description: 'GitHub org name' },
        },
        required: ['org'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'queryJiraIssues',
      description: 'Search Jira issues resolved by developers. Use for questions about what Jira tickets someone worked on, issue types, story points, project breakdown.',
      parameters: {
        type: 'object',
        properties: {
          org: { type: 'string', description: 'GitHub org name' },
          login: { type: 'string', description: 'Filter by developer GitHub login (optional)' },
          projectKey: { type: 'string', description: 'Filter by Jira project key e.g. TCM, BRZ (optional)' },
          issueType: { type: 'string', description: 'Filter by issue type e.g. Story, Bug, Task (optional)' },
          limit: { type: 'number', description: 'Max results (default 20, max 100)' },
        },
        required: ['org'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'queryJiraSummary',
      description: 'Get aggregate Jira stats: total issues, story points, breakdown by project and type. Use for questions about Jira workload, project distribution, story points totals.',
      parameters: {
        type: 'object',
        properties: {
          org: { type: 'string', description: 'GitHub org name' },
          login: { type: 'string', description: 'Filter by developer GitHub login (optional)' },
        },
        required: ['org'],
      },
    },
  },
];

// Tool execution
export async function executeTool(name: string, args: Record<string, any>): Promise<string> {
  try {
    switch (name) {
      case 'queryLeaderboard': return JSON.stringify(await queryLeaderboard(args));
      case 'queryDevStats': return JSON.stringify(await queryDevStats(args));
      case 'queryCommits': return JSON.stringify(await queryCommits(args));
      case 'queryTeams': return JSON.stringify(await queryTeams(args));
      case 'queryOrgSummary': return JSON.stringify(await queryOrgSummary(args));
      case 'queryJiraIssues': return JSON.stringify(await queryJiraIssues(args));
      case 'queryJiraSummary': return JSON.stringify(await queryJiraSummary(args));
      default: return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
  } catch (err) {
    console.error(`[chat-tool] ${name} error:`, err);
    return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
  }
}

// Get the latest completed report ID for an org
async function latestReportId(org: string): Promise<string | null> {
  const [rows] = await db.execute(
    `SELECT id FROM reports WHERE org = ? AND status = 'completed' ORDER BY completed_at DESC LIMIT 1`,
    [org],
  ) as [any[], any];
  return rows[0]?.id || null;
}

async function queryLeaderboard(args: any) {
  const { org, metric, order = 'desc', limit: rawLimit = 10, team } = args;
  const limit = Math.min(Number(rawLimit) || 10, 100);
  const reportId = await latestReportId(org);
  if (!reportId) return { error: 'No completed reports found' };

  const safeMetric = ['impact_score','total_commits','total_prs','avg_complexity','lines_added','lines_removed','ai_percentage','pr_percentage'].includes(metric) ? metric : 'impact_score';
  const safeOrder = order === 'asc' ? 'ASC' : 'DESC';

  const teamJoin = team
    ? `JOIN team_members tm ON tm.github_login = ds.github_login JOIN teams t ON t.id = tm.team_id AND t.org = ? AND t.name = ?`
    : '';
  const params = team ? [org, team, reportId, String(limit)] : [reportId, String(limit)];

  const [rows] = await db.execute(
    `SELECT ds.github_login, ds.github_name, ds.total_commits, ds.total_prs,
            ds.lines_added, ds.lines_removed, ds.avg_complexity, ds.impact_score,
            ds.pr_percentage, ds.ai_percentage
     FROM developer_stats ds ${teamJoin}
     WHERE ds.report_id = ?
     ORDER BY ds.${safeMetric} ${safeOrder}
     LIMIT ?`,
    params,
  ) as [any[], any];

  return { developers: rows, count: rows.length, metric: safeMetric, order };
}

async function queryDevStats(args: any) {
  const { org, logins } = args;
  const reportId = await latestReportId(org);
  if (!reportId) return { error: 'No completed reports found' };

  const placeholders = logins.map(() => '?').join(',');
  const [rows] = await db.execute(
    `SELECT github_login, github_name, total_commits, total_prs,
            lines_added, lines_removed, avg_complexity, impact_score,
            pr_percentage, ai_percentage, type_breakdown, active_repos
     FROM developer_stats
     WHERE report_id = ? AND github_login IN (${placeholders})`,
    [reportId, ...logins],
  ) as [any[], any];

  // Parse JSON fields
  return {
    developers: rows.map((r: any) => ({
      ...r,
      type_breakdown: typeof r.type_breakdown === 'string' ? JSON.parse(r.type_breakdown || '{}') : (r.type_breakdown || {}),
      active_repos: typeof r.active_repos === 'string' ? JSON.parse(r.active_repos || '[]') : (r.active_repos || []),
    })),
  };
}

async function queryCommits(args: any) {
  const { org, login, minComplexity, maxComplexity, type, days, aiOnly, limit: rawLimit = 20 } = args;
  const limit = Math.min(Number(rawLimit) || 20, 100);
  const reportId = await latestReportId(org);
  if (!reportId) return { error: 'No completed reports found' };

  const conditions = ['ca.report_id = ?'];
  const params: any[] = [reportId];

  if (login) { conditions.push('ca.github_login = ?'); params.push(login); }
  if (minComplexity) { conditions.push('ca.complexity >= ?'); params.push(minComplexity); }
  if (maxComplexity) { conditions.push('ca.complexity <= ?'); params.push(maxComplexity); }
  if (type) { conditions.push('ca.type = ?'); params.push(type); }
  if (days) {
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    conditions.push('ca.committed_at >= ?');
    params.push(cutoff);
  }
  if (aiOnly) { conditions.push('(ca.ai_co_authored = 1 OR ca.maybe_ai = 1)'); }

  params.push(String(limit));

  const [rows] = await db.execute(
    `SELECT ca.github_login, ca.repo, ca.commit_sha, ca.commit_message,
            ca.complexity, ca.type, ca.risk_level, ca.lines_added, ca.lines_removed,
            ca.ai_co_authored, ca.maybe_ai, ca.committed_at
     FROM commit_analyses ca
     WHERE ${conditions.join(' AND ')}
     ORDER BY ca.committed_at DESC
     LIMIT ?`,
    params,
  ) as [any[], any];

  return { commits: rows, count: rows.length };
}

async function queryTeams(args: any) {
  const { org, name } = args;

  const [teams] = await db.execute(
    name
      ? `SELECT id, name, color FROM teams WHERE org = ? AND name = ?`
      : `SELECT id, name, color FROM teams WHERE org = ? ORDER BY name`,
    name ? [org, name] : [org],
  ) as [any[], any];

  const reportId = await latestReportId(org);

  for (const team of teams) {
    const [members] = await db.execute(
      `SELECT github_login FROM team_members WHERE team_id = ?`,
      [team.id],
    ) as [any[], any];
    team.members = members.map((m: any) => m.github_login);

    // Aggregate stats if we have a report
    if (reportId && team.members.length > 0) {
      const placeholders = team.members.map(() => '?').join(',');
      const [stats] = await db.execute(
        `SELECT COUNT(*) as dev_count,
                SUM(total_commits) as total_commits, SUM(total_prs) as total_prs,
                AVG(avg_complexity) as avg_complexity, AVG(impact_score) as avg_impact,
                AVG(pr_percentage) as avg_pr_pct, AVG(ai_percentage) as avg_ai_pct
         FROM developer_stats
         WHERE report_id = ? AND github_login IN (${placeholders})`,
        [reportId, ...team.members],
      ) as [any[], any];
      team.stats = stats[0] || {};
    }
  }

  return { teams };
}

async function queryOrgSummary(args: any) {
  const { org } = args;
  const reportId = await latestReportId(org);
  if (!reportId) return { error: 'No completed reports found' };

  const [report] = await db.execute(
    `SELECT id, period_days, created_at, completed_at FROM reports WHERE id = ?`,
    [reportId],
  ) as [any[], any];

  const [stats] = await db.execute(
    `SELECT COUNT(*) as dev_count,
            SUM(total_commits) as total_commits, SUM(total_prs) as total_prs,
            SUM(lines_added) as total_lines_added, SUM(lines_removed) as total_lines_removed,
            AVG(avg_complexity) as avg_complexity, AVG(impact_score) as avg_impact,
            AVG(pr_percentage) as avg_pr_pct, AVG(ai_percentage) as avg_ai_pct
     FROM developer_stats WHERE report_id = ?`,
    [reportId],
  ) as [any[], any];

  const [teamCount] = await db.execute(
    `SELECT COUNT(*) as count FROM teams WHERE org = ?`,
    [org],
  ) as [any[], any];

  const [jiraStats] = await db.execute(
    `SELECT COUNT(*) as total_issues, SUM(story_points) as total_story_points,
            COUNT(DISTINCT project_key) as project_count
     FROM jira_issues WHERE report_id = ?`,
    [reportId],
  ) as [any[], any];

  return {
    org,
    report: report[0],
    stats: stats[0],
    teamCount: teamCount[0]?.count || 0,
    jira: jiraStats[0] || { total_issues: 0, total_story_points: 0, project_count: 0 },
  };
}

async function queryJiraIssues(args: any) {
  const { org, login, projectKey, issueType, limit: rawLimit = 20 } = args;
  const limit = Math.min(Number(rawLimit) || 20, 100);
  const reportId = await latestReportId(org);
  if (!reportId) return { error: 'No completed reports found' };

  const conditions = ['ji.report_id = ?'];
  const params: any[] = [reportId];

  if (login) { conditions.push('ji.github_login = ?'); params.push(login); }
  if (projectKey) { conditions.push('ji.project_key = ?'); params.push(projectKey); }
  if (issueType) { conditions.push('ji.issue_type = ?'); params.push(issueType); }

  params.push(String(limit));

  const [rows] = await db.execute(
    `SELECT ji.issue_key, ji.project_key, ji.issue_type, ji.summary,
            ji.status, ji.story_points, ji.github_login, ji.resolved_at
     FROM jira_issues ji
     WHERE ${conditions.join(' AND ')}
     ORDER BY ji.resolved_at DESC
     LIMIT ?`,
    params,
  ) as [any[], any];

  return { issues: rows, count: rows.length };
}

async function queryJiraSummary(args: any) {
  const { org, login } = args;
  const reportId = await latestReportId(org);
  if (!reportId) return { error: 'No completed reports found' };

  const loginFilter = login ? 'AND ji.github_login = ?' : '';
  const params = login ? [reportId, login] : [reportId];

  const [totals] = await db.execute(
    `SELECT COUNT(*) as total_issues,
            SUM(ji.story_points) as total_story_points,
            COUNT(DISTINCT ji.github_login) as developer_count
     FROM jira_issues ji
     WHERE ji.report_id = ? ${loginFilter}`,
    params,
  ) as [any[], any];

  const [byProject] = await db.execute(
    `SELECT ji.project_key, COUNT(*) as issue_count,
            SUM(ji.story_points) as story_points
     FROM jira_issues ji
     WHERE ji.report_id = ? ${loginFilter}
     GROUP BY ji.project_key
     ORDER BY issue_count DESC`,
    params,
  ) as [any[], any];

  const [byType] = await db.execute(
    `SELECT ji.issue_type, COUNT(*) as issue_count
     FROM jira_issues ji
     WHERE ji.report_id = ? ${loginFilter}
     GROUP BY ji.issue_type
     ORDER BY issue_count DESC`,
    params,
  ) as [any[], any];

  return {
    totals: totals[0],
    byProject,
    byType,
  };
}
