import db from '@/lib/db';
import { resolveReportId } from './resolve';
import { bucketByPeriod } from './dedup';
import { buildCostVisibility, stripDevCost, type Requester, type CostVisibility } from '@/lib/cost-visibility';

export const MAX_ROWS = 500;
const DEFAULT_TIMESERIES_WINDOW_DAYS = 180;
// Backstop on the number of distinct entities (commits/PRs/issues) a single
// timeseries query pulls into memory. The query dedups in SQL (GROUP BY the
// entity key) before this cap, so it bounds *distinct* rows — one per real
// commit/PR/issue — not the raw per-report duplication. 20k was too low once a
// full extra year of history was backfilled: an 18-month all-commits/lines query
// exceeds it and, because rows come back ORDER BY ts DESC, the cap silently drops
// the OLDEST buckets. 250k comfortably holds many years of this org's distinct
// commits (~30k/18mo) at ~tens of MB, while still guarding against a pathological
// unbounded fetch. `truncated` still flags the (now far-off) ceiling.
export const TIMESERIES_ROW_CAP = 250000;

const clampLimit = (raw: unknown, def: number) => {
  const n = Number(raw);
  const v = Number.isFinite(n) && n > 0 ? Math.floor(n) : def;
  return String(Math.min(v, MAX_ROWS));
};

// Normalize a DB timestamp to a YYYY-MM-DD label. mysql2 returns DATETIME as JS
// Date objects (String(date) would give "Mon Mar 16 2026 …"); SQLite returns
// strings. Falls back to the raw first-10-chars if the value is unparseable.
function isoDate(value: any): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value).slice(0, 10) : d.toISOString().slice(0, 10);
}

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
  const where = conditions.join(' AND ');

  // Cross-report: the same commit_sha appears in every overlapping report window.
  // Dedup in SQL (GROUP BY the sha) so LIMIT bounds *distinct* commits — limiting
  // raw rows and deduping afterward could silently return fewer than `limit`.
  // Report-scoped: commit_sha is unique per report, so a plain SELECT suffices.
  const sql = crossReport
    ? `SELECT ca.commit_sha,
              MIN(ca.repo) AS repo, MIN(ca.github_login) AS github_login, MIN(ca.pr_number) AS pr_number,
              MIN(ca.commit_message) AS commit_message, MIN(ca.type) AS type, MIN(ca.complexity) AS complexity,
              MIN(ca.risk_level) AS risk_level, MIN(ca.lines_added) AS lines_added, MIN(ca.lines_removed) AS lines_removed,
              MIN(ca.ai_co_authored) AS ai_co_authored, MIN(ca.maybe_ai) AS maybe_ai, MIN(ca.committed_at) AS committed_at
       FROM commit_analyses ca
       WHERE ${where}
       GROUP BY ca.commit_sha
       ORDER BY committed_at DESC
       LIMIT ?`
    : `SELECT ca.commit_sha, ca.repo, ca.github_login, ca.pr_number, ca.commit_message,
              ca.type, ca.complexity, ca.risk_level, ca.lines_added, ca.lines_removed,
              ca.ai_co_authored, ca.maybe_ai, ca.committed_at
       FROM commit_analyses ca
       WHERE ${where}
       ORDER BY ca.committed_at DESC
       LIMIT ?`;

  const [rows] = await db.execute(sql, params) as [any[], any];
  return { commits: rows, count: rows.length };
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
  const where = conditions.join(' AND ');

  // Cross-report: dedup by issue_key in SQL so LIMIT bounds distinct issues
  // (see queryCommits). Report-scoped: issue_key is unique per report.
  const sql = crossReport
    ? `SELECT ji.issue_key,
              MIN(ji.project_key) AS project_key, MIN(ji.issue_type) AS issue_type, MIN(ji.summary) AS summary,
              MIN(ji.status) AS status, MIN(ji.story_points) AS story_points, MIN(ji.github_login) AS github_login,
              MIN(ji.created_at) AS created_at, MIN(ji.resolved_at) AS resolved_at, MIN(ji.issue_url) AS issue_url
       FROM jira_issues ji
       WHERE ${where}
       GROUP BY ji.issue_key
       ORDER BY resolved_at DESC
       LIMIT ?`
    : `SELECT ji.issue_key, ji.project_key, ji.issue_type, ji.summary, ji.status,
              ji.story_points, ji.github_login, ji.created_at, ji.resolved_at, ji.issue_url
       FROM jira_issues ji
       WHERE ${where}
       ORDER BY ji.resolved_at DESC
       LIMIT ?`;

  const [rows] = await db.execute(sql, params) as [any[], any];
  return { issues: rows, count: rows.length };
}

const DEV_SORT_COLUMNS = ['impact_score', 'total_commits', 'total_prs', 'avg_complexity', 'lines_added', 'lines_removed', 'ai_percentage', 'pr_percentage'];
const NUMERIC_DEV_FIELDS = ['total_prs', 'total_commits', 'lines_added', 'lines_removed', 'avg_complexity', 'impact_score', 'pr_percentage', 'ai_percentage', 'total_jira_issues', 'cc_total_cost', 'cc_requests'];

export async function queryDeveloperStats(
  args: { report_id?: string; login?: string; sort_by?: string; limit?: number },
  requester?: Requester,
) {
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

  // Team-scoped cost gating (GLOOK-27). Fail closed: a missing requester (or an
  // org we couldn't resolve) means no cost visibility — strip all cc, never
  // see-all. Admins / auth-disabled short-circuit before the reportOrg lookup so
  // that query only runs on the team-scoped path that actually needs it.
  let vis: CostVisibility;
  if (!requester) {
    vis = { canSeeCost: () => false, canSeeAnyCost: false };
  } else if (requester.authDisabled || requester.isAdmin) {
    vis = { canSeeCost: () => true, canSeeAnyCost: true };
  } else {
    const org = await reportOrg(r.id);
    vis = org
      ? await buildCostVisibility(org, requester)
      : { canSeeCost: () => false, canSeeAnyCost: false };
  }
  const gated = stripDevCost(developers, vis.canSeeCost);
  return { developers: gated, count: gated.length };
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

export async function getEpicSummaries(args: { org?: string; epic_key?: string; limit?: number }) {
  const conditions: string[] = [];
  const params: any[] = [];
  if (args.org) { conditions.push('es.org = ?'); params.push(args.org); }
  if (args.epic_key) { conditions.push('es.epic_key = ?'); params.push(args.epic_key); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(clampLimit(args.limit, 100));
  const [rows] = await db.execute(
    `SELECT es.epic_key, es.org, es.summary_text, es.jira_resolved, es.jira_remaining,
            es.commit_count, es.lines_added, es.lines_removed, es.repos,
            est.total_jiras, est.dev_count
     FROM epic_summaries es
     LEFT JOIN epic_stats est ON est.epic_key = es.epic_key AND est.org = es.org
     ${where}
     ORDER BY es.commit_count DESC
     LIMIT ?`,
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

const ROW_METRICS = new Set(['commits', 'prs', 'lines_added', 'jira_resolved']);
const REPORT_METRICS = new Set(['impact_score', 'ai_percentage']);

export async function getMetricTimeseries(args: { metric: string; group_by?: string; org?: string; since?: string; until?: string }) {
  const { metric } = args;
  if (!ROW_METRICS.has(metric) && !REPORT_METRICS.has(metric)) {
    return { error: `unknown metric: ${metric}` };
  }
  // Treat empty/whitespace date bounds as absent so the default window and the
  // explicit-filter checks below don't get bypassed by e.g. since: ''.
  const since = args.since?.trim() || undefined;
  const until = args.until?.trim() || undefined;

  // Report-based metrics: average developer_stats per report.
  if (REPORT_METRICS.has(metric)) {
    const col = metric === 'impact_score' ? 'impact_score' : 'ai_percentage';
    const conditions = [`r.status = 'completed'`];
    const params: any[] = [];
    if (args.org) { conditions.push('r.org = ?'); params.push(args.org); }
    if (since) { conditions.push('r.created_at >= ?'); params.push(since); }
    if (until) { conditions.push('r.created_at <= ?'); params.push(until); }
    const [rows] = await db.execute(
      `SELECT r.id AS report_id, r.created_at, AVG(ds.${col}) AS value
       FROM reports r JOIN developer_stats ds ON ds.report_id = r.id
       WHERE ${conditions.join(' AND ')}
       GROUP BY r.id, r.created_at
       ORDER BY r.created_at ASC`,
      params,
    ) as [any[], any];
    return {
      metric, group_by: 'report',
      series: rows.map((r: any) => ({ bucket: isoDate(r.created_at), value: Number(r.value ?? 0) })),
    };
  }

  // Row-based metrics. Dedup is done in SQL (GROUP BY the entity key) so Node
  // receives one row per distinct commit/PR/issue — bounded by real activity,
  // not by raw rows duplicated across overlapping report windows. This keeps
  // counts accurate and avoids the raw-row blow-up that a pre-dedup LIMIT would
  // silently truncate (which dropped the most recent buckets).
  const groupBy = args.group_by ?? 'week';

  const ALLOWED_GROUP_BY = ['week', 'month', 'report', 'developer', 'repo', 'type'];
  if (!ALLOWED_GROUP_BY.includes(groupBy)) return { error: `unknown group_by: ${groupBy}` };
  if (metric === 'jira_resolved' && (groupBy === 'repo' || groupBy === 'type')) {
    return { error: `group_by '${groupBy}' is not supported for metric 'jira_resolved'` };
  }

  let org = args.org ?? null;
  if (!org) {
    // latest completed anchors the org when org not given
    const r = await resolveReportId(undefined);
    if ('error' in r) return r;
    org = await reportOrg(r.id);
  }

  const isJira = metric === 'jira_resolved';
  const table = isJira ? 'jira_issues' : 'commit_analyses';
  const alias = isJira ? 'ji' : 'ca';
  const tsCol = isJira ? 'resolved_at' : 'committed_at';
  // The entity a distinct row represents: PR for 'prs', issue for jira, else commit.
  // PR numbers are per-repo (GitHub restarts at #1 in every repo), so a PR is
  // uniquely (repo, pr_number) — grouping by pr_number alone collapses PR #42 in
  // repo A with PR #42 in repo B, badly undercounting. commit_sha and issue_key
  // are already globally unique, so they group by a single column.
  const keyCol = isJira ? 'issue_key' : (metric === 'prs' ? 'pr_number' : 'commit_sha');
  const entityGroupBy = metric === 'prs' ? `${alias}.repo, ${alias}.pr_number` : `${alias}.${keyCol}`;
  const entityCountDistinct = metric === 'prs' ? `COUNT(DISTINCT ${alias}.repo, ${alias}.pr_number)` : `COUNT(DISTINCT ${alias}.${keyCol})`;

  // Shared WHERE: org scope + optional time window (+ PR filter for 'prs').
  const conditions = [`${alias}.report_id IN (SELECT id FROM reports WHERE org = ? AND status = 'completed')`];
  const params: any[] = [org];
  if (since) { conditions.push(`${alias}.${tsCol} >= ?`); params.push(since); }
  if (until) { conditions.push(`${alias}.${tsCol} <= ?`); params.push(until); }
  if (since === undefined && until === undefined) {
    const defaultSince = new Date(Date.now() - DEFAULT_TIMESERIES_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
    conditions.push(`${alias}.${tsCol} >= ?`);
    params.push(defaultSince);
  }
  if (metric === 'prs') conditions.push('ca.pr_number IS NOT NULL');
  const where = conditions.join(' AND ');

  // count metrics contribute 1 per distinct entity; lines_added sums the column.
  const valueOfRow = (linesAdded: number): number => metric === 'lines_added' ? linesAdded : 1;

  // ── group_by = report: per-report totals. Grouping BY report is itself the
  //    partition, so there is no cross-report dedup here — each report reports
  //    its own count. Fully aggregated in SQL (one row per report). ──────────
  if (groupBy === 'report') {
    const valueExpr =
      metric === 'lines_added' ? `COALESCE(SUM(${alias}.lines_added), 0)` :
                                 entityCountDistinct;
    const [rows] = await db.execute(
      `SELECT r.id AS report_id, r.created_at, ${valueExpr} AS value
       FROM ${table} ${alias} JOIN reports r ON ${alias}.report_id = r.id
       WHERE ${where}
       GROUP BY r.id, r.created_at
       ORDER BY r.created_at ASC`,
      params,
    ) as [any[], any];
    return {
      metric, group_by: 'report',
      series: rows.map((row: any) => ({ bucket: isoDate(row.created_at), value: Number(row.value ?? 0) })),
      truncated: false,
    };
  }

  // ── week | month | developer | repo | type: dedup entities in SQL (one row
  //    per distinct entity at its earliest timestamp), then bucket/group in JS
  //    (portable — no dialect-specific date SQL). ──────────────────────────────
  const dedupSelect = isJira
    ? `MIN(ji.resolved_at) AS ts, MIN(ji.github_login) AS github_login`
    : `MIN(ca.committed_at) AS ts, MIN(ca.repo) AS repo, MIN(ca.github_login) AS github_login, MIN(ca.type) AS type, MIN(ca.lines_added) AS lines_added`;

  params.push(String(TIMESERIES_ROW_CAP));
  const [rows] = await db.execute(
    `SELECT ${dedupSelect}
     FROM ${table} ${alias}
     WHERE ${where}
     GROUP BY ${entityGroupBy}
     ORDER BY ts DESC
     LIMIT ?`,
    params,
  ) as [any[], any];
  // Backstop only: with SQL dedup + default window this is effectively never hit;
  // DESC order means any truncation keeps the most recent entities.
  const truncated = rows.length >= TIMESERIES_ROW_CAP;

  if (groupBy === 'week' || groupBy === 'month') {
    const buckets = bucketByPeriod(rows, 'ts', groupBy);
    return {
      metric, group_by: groupBy,
      series: buckets.map(b => ({ bucket: b.bucket, value: b.rows.reduce((s, row: any) => s + valueOfRow(Number(row.lines_added ?? 0)), 0) })),
      truncated,
    };
  }

  // Dimension grouping: developer | repo | type
  const DIM_FIELDS: Record<string, string> = { developer: 'github_login', repo: 'repo', type: 'type' };
  const dimField = DIM_FIELDS[groupBy];
  const agg = new Map<string, number>();
  for (const row of rows) {
    const key = String(row[dimField] ?? 'unknown');
    agg.set(key, (agg.get(key) ?? 0) + valueOfRow(Number(row.lines_added ?? 0)));
  }
  const series = [...agg.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([bucket, value]) => ({ bucket, value }));
  return { metric, group_by: groupBy, series, truncated };
}
