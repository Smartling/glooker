import db from '@/lib/db';
import { resolveReportId } from './resolve';
import { dedupByKeyEarliest } from './dedup';

export const MAX_ROWS = 500;

const clampLimit = (raw: unknown, def: number) => String(Math.min(Number(raw) || def, MAX_ROWS));

// Resolve the org of the report we are anchored to (for cross-report queries).
async function reportOrg(reportId: string): Promise<string | null> {
  const [rows] = await db.execute(`SELECT org FROM reports WHERE id = ?`, [reportId]) as [any[], any];
  return rows[0]?.org ?? null;
}

export async function listReports(args: { org?: string; status?: string; limit?: number }) {
  const conditions: string[] = [];
  const params: any[] = [];
  if (args.org) { conditions.push('org = ?'); params.push(args.org); }
  if (args.status) { conditions.push('status = ?'); params.push(args.status); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(clampLimit(args.limit, 50));
  const [rows] = await db.execute(
    `SELECT id, org, period_days, status, created_at, completed_at
     FROM reports ${where} ORDER BY created_at DESC LIMIT ?`,
    params,
  ) as [any[], any];
  return { reports: rows };
}

export async function getOrgSummaryTool(args: { report_id?: string }) {
  const r = await resolveReportId(args.report_id);
  if ('error' in r) return r;
  const [report] = await db.execute(
    `SELECT id, org, period_days, created_at, completed_at FROM reports WHERE id = ?`, [r.id],
  ) as [any[], any];
  const [stats] = await db.execute(
    `SELECT COUNT(*) AS dev_count, SUM(total_commits) AS total_commits, SUM(total_prs) AS total_prs,
            SUM(lines_added) AS total_lines_added, SUM(lines_removed) AS total_lines_removed,
            AVG(avg_complexity) AS avg_complexity, AVG(impact_score) AS avg_impact,
            AVG(pr_percentage) AS avg_pr_pct, AVG(ai_percentage) AS avg_ai_pct
     FROM developer_stats WHERE report_id = ?`, [r.id],
  ) as [any[], any];
  const [jira] = await db.execute(
    `SELECT COUNT(*) AS total_issues, SUM(story_points) AS total_story_points,
            COUNT(DISTINCT project_key) AS project_count
     FROM jira_issues WHERE report_id = ?`, [r.id],
  ) as [any[], any];
  const s = stats[0] || {};
  return {
    report: report[0],
    developers: Number(s.dev_count ?? 0),
    total_commits: Number(s.total_commits ?? 0),
    total_prs: Number(s.total_prs ?? 0),
    total_lines_added: Number(s.total_lines_added ?? 0),
    total_lines_removed: Number(s.total_lines_removed ?? 0),
    avg_complexity: Number(s.avg_complexity ?? 0),
    avg_impact: Number(s.avg_impact ?? 0),
    avg_pr_percentage: Number(s.avg_pr_pct ?? 0),
    avg_ai_percentage: Number(s.avg_ai_pct ?? 0),
    jira: {
      total_issues: Number(jira[0]?.total_issues ?? 0),
      total_story_points: Number(jira[0]?.total_story_points ?? 0),
      project_count: Number(jira[0]?.project_count ?? 0),
    },
  };
}

export async function queryCommits(args: {
  report_id?: string; login?: string; repo?: string; type?: string;
  since?: string; until?: string; min_complexity?: number; ai_only?: boolean; limit?: number;
}) {
  const r = await resolveReportId(args.report_id);
  if ('error' in r) return r;
  const crossReport = !args.report_id;

  const conditions: string[] = [];
  const params: any[] = [];
  if (crossReport) {
    const org = await reportOrg(r.id);
    conditions.push(`ca.report_id IN (SELECT id FROM reports WHERE org = ? AND status = 'completed')`);
    params.push(org);
  } else {
    conditions.push('ca.report_id = ?');
    params.push(r.id);
  }
  if (args.login) { conditions.push('ca.github_login = ?'); params.push(args.login); }
  if (args.repo) { conditions.push('ca.repo = ?'); params.push(args.repo); }
  if (args.type) { conditions.push('ca.type = ?'); params.push(args.type); }
  if (args.since) { conditions.push('ca.committed_at >= ?'); params.push(args.since); }
  if (args.until) { conditions.push('ca.committed_at <= ?'); params.push(args.until); }
  if (args.min_complexity != null) { conditions.push('ca.complexity >= ?'); params.push(args.min_complexity); }
  if (args.ai_only) { conditions.push('(ca.ai_co_authored = 1 OR ca.maybe_ai = 1)'); }
  params.push(clampLimit(args.limit, 100));

  const [rows] = await db.execute(
    `SELECT ca.commit_sha, ca.repo, ca.github_login, ca.pr_number, ca.commit_message,
            ca.type, ca.complexity, ca.risk_level, ca.lines_added, ca.lines_removed,
            ca.ai_co_authored, ca.maybe_ai, ca.committed_at
     FROM commit_analyses ca
     WHERE ${conditions.join(' AND ')}
     ORDER BY ca.committed_at DESC
     LIMIT ?`,
    params,
  ) as [any[], any];

  const commits = crossReport ? dedupByKeyEarliest(rows, 'commit_sha', 'committed_at') : rows;
  return { commits, count: commits.length };
}

export async function queryJiraIssues(args: {
  report_id?: string; login?: string; project_key?: string; issue_type?: string;
  status?: string; since?: string; until?: string; limit?: number;
}) {
  const r = await resolveReportId(args.report_id);
  if ('error' in r) return r;
  const crossReport = !args.report_id;

  const conditions: string[] = [];
  const params: any[] = [];
  if (crossReport) {
    const org = await reportOrg(r.id);
    conditions.push(`ji.report_id IN (SELECT id FROM reports WHERE org = ? AND status = 'completed')`);
    params.push(org);
  } else {
    conditions.push('ji.report_id = ?');
    params.push(r.id);
  }
  if (args.login) { conditions.push('ji.github_login = ?'); params.push(args.login); }
  if (args.project_key) { conditions.push('ji.project_key = ?'); params.push(args.project_key); }
  if (args.issue_type) { conditions.push('ji.issue_type = ?'); params.push(args.issue_type); }
  if (args.status) { conditions.push('ji.status = ?'); params.push(args.status); }
  if (args.since) { conditions.push('ji.resolved_at >= ?'); params.push(args.since); }
  if (args.until) { conditions.push('ji.resolved_at <= ?'); params.push(args.until); }
  params.push(clampLimit(args.limit, 100));

  const [rows] = await db.execute(
    `SELECT ji.issue_key, ji.project_key, ji.issue_type, ji.summary, ji.status,
            ji.story_points, ji.github_login, ji.created_at, ji.resolved_at, ji.issue_url
     FROM jira_issues ji
     WHERE ${conditions.join(' AND ')}
     ORDER BY ji.resolved_at DESC
     LIMIT ?`,
    params,
  ) as [any[], any];

  const issues = crossReport ? dedupByKeyEarliest(rows, 'issue_key', 'resolved_at') : rows;
  return { issues, count: issues.length };
}

const DEV_SORT_COLUMNS = ['impact_score', 'total_commits', 'total_prs', 'avg_complexity', 'lines_added', 'lines_removed', 'ai_percentage', 'pr_percentage'];
const NUMERIC_DEV_FIELDS = ['total_prs', 'total_commits', 'lines_added', 'lines_removed', 'avg_complexity', 'impact_score', 'pr_percentage', 'ai_percentage', 'total_jira_issues', 'cc_total_cost', 'cc_requests'];

export async function queryDeveloperStats(args: { report_id?: string; login?: string; sort_by?: string; limit?: number }) {
  const r = await resolveReportId(args.report_id);
  if ('error' in r) return r;
  const sortBy = DEV_SORT_COLUMNS.includes(args.sort_by ?? '') ? args.sort_by : 'impact_score';

  const conditions = ['ds.report_id = ?'];
  const params: any[] = [r.id];
  if (args.login) { conditions.push('ds.github_login = ?'); params.push(args.login); }
  params.push(clampLimit(args.limit, 100));

  const [rows] = await db.execute(
    `SELECT ds.github_login, ds.github_name, ds.total_prs, ds.total_commits,
            ds.lines_added, ds.lines_removed, ds.avg_complexity, ds.impact_score,
            ds.pr_percentage, ds.ai_percentage, ds.total_jira_issues,
            ds.cc_total_cost, ds.cc_requests
     FROM developer_stats ds
     WHERE ${conditions.join(' AND ')}
     ORDER BY ds.${sortBy} DESC
     LIMIT ?`,
    params,
  ) as [any[], any];

  const developers = rows.map((row: any) => {
    const out = { ...row };
    for (const f of NUMERIC_DEV_FIELDS) if (out[f] != null) out[f] = Number(out[f]);
    return out;
  });
  return { developers, count: developers.length };
}

export async function queryUnmergedWork(args: { report_id?: string; login?: string; repo?: string }) {
  const r = await resolveReportId(args.report_id);
  if ('error' in r) return r;

  const prConds = ['report_id = ?']; const prParams: any[] = [r.id];
  const brConds = ['report_id = ?', 'pr_number IS NULL']; const brParams: any[] = [r.id];
  if (args.login) { prConds.push('github_login = ?'); prParams.push(args.login); brConds.push('github_login = ?'); brParams.push(args.login); }
  if (args.repo) { prConds.push('repo = ?'); prParams.push(args.repo); brConds.push('repo = ?'); brParams.push(args.repo); }

  const [prs] = await db.execute(
    `SELECT repo, pr_number, pr_title, pr_url, is_draft, pr_commits, pr_additions, pr_deletions,
            github_login, pr_created_at, pr_updated_at
     FROM unmerged_prs WHERE ${prConds.join(' AND ')}
     ORDER BY COALESCE(pr_additions,0) + COALESCE(pr_deletions,0) DESC LIMIT ?`,
    [...prParams, String(MAX_ROWS)],
  ) as [any[], any];

  const [branches] = await db.execute(
    `SELECT repo, branch, github_login, COUNT(*) AS commit_count,
            SUM(lines_added + lines_removed) AS total_lines
     FROM unmerged_commits WHERE ${brConds.join(' AND ')}
     GROUP BY repo, branch, github_login ORDER BY total_lines DESC LIMIT ?`,
    [...brParams, String(MAX_ROWS)],
  ) as [any[], any];

  return {
    prs: prs.map((p: any) => ({ ...p, pr_additions: Number(p.pr_additions ?? 0), pr_deletions: Number(p.pr_deletions ?? 0), is_draft: p.is_draft === 1 || p.is_draft === true })),
    branches: branches.map((b: any) => ({ ...b, commit_count: Number(b.commit_count ?? 0), total_lines: Number(b.total_lines ?? 0) })),
  };
}

export async function getEpicSummaries(args: { org?: string; epic_key?: string }) {
  const conditions: string[] = [];
  const params: any[] = [];
  if (args.org) { conditions.push('es.org = ?'); params.push(args.org); }
  if (args.epic_key) { conditions.push('es.epic_key = ?'); params.push(args.epic_key); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const [rows] = await db.execute(
    `SELECT es.epic_key, es.org, es.summary_text, es.jira_resolved, es.jira_remaining,
            es.commit_count, es.lines_added, es.lines_removed, es.repos,
            est.total_jiras, est.dev_count
     FROM epic_summaries es
     LEFT JOIN epic_stats est ON est.epic_key = es.epic_key AND est.org = es.org
     ${where}
     ORDER BY es.commit_count DESC`,
    params,
  ) as [any[], any];
  const epics = rows.map((r: any) => ({
    ...r,
    jira_resolved: Number(r.jira_resolved ?? 0),
    jira_remaining: Number(r.jira_remaining ?? 0),
    commit_count: Number(r.commit_count ?? 0),
    lines_added: Number(r.lines_added ?? 0),
    lines_removed: Number(r.lines_removed ?? 0),
    total_jiras: r.total_jiras == null ? null : Number(r.total_jiras),
    dev_count: r.dev_count == null ? null : Number(r.dev_count),
  }));
  return { epics };
}
