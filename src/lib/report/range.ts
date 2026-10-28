import { createHash } from 'crypto';
import db from '@/lib/db';
import { computeImpactScore } from '@/lib/impact-score';
import { canonicalCommitIdsSql, completedReportWindows, measuredDaysInWindow, unionDayCount, windowOverlaps } from './timeline';
import { RANGE_DAYS, type ReportRangeKey } from './range-options';

export * from './range-options';

const DAY_MS = 86_400_000;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Whole UTC days; `until` is exclusive. */
export interface RangeWindow {
  since: string;
  until: string;
  days: number;
}

/**
 * GLOOK-63: a range ends on the report's end date (completed_at, else created_at) and starts 90 or
 * 365 days before. `until` is the UTC midnight after that date, so the end day is included.
 */
export function rangeWindow(
  report: { completed_at?: unknown; created_at?: unknown },
  range: ReportRangeKey,
): RangeWindow {
  let end = NaN;
  for (const v of [report.completed_at, report.created_at]) {
    if (v == null) continue;
    const t = new Date(v as string | number | Date).getTime();
    if (Number.isFinite(t)) { end = t; break; }
  }
  if (!Number.isFinite(end)) end = Date.now();
  const days = RANGE_DAYS[range];
  const untilMs = Math.floor(end / DAY_MS) * DAY_MS + DAY_MS;
  return { since: isoDay(untilMs - days * DAY_MS), until: isoDay(untilMs), days };
}

export interface RangeDeveloperRow {
  github_login: string;
  github_name: string;
  avatar_url: string;
  total_prs: number;
  total_commits: number;
  lines_added: number;
  lines_removed: number;
  avg_complexity: number;
  impact_score: number;
  pr_percentage: number;
  ai_percentage: number;
  total_jira_issues: number;
  total_story_points: number;
  total_reviews: number;
  type_breakdown: Record<string, number>;
  active_repos: string[];
  measured_days: number;
  pr_covered_days: number;
  pr_covered_since: string | null;
}

const dayMs = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const placeholders = (n: number) => Array.from({ length: n }, () => '?').join(',');

/** One jira_issues id per issue_key (the latest copy) among the given reports. */
function canonicalJiraIdsSql(reportCount: number): string {
  return `SELECT MAX(id) AS id FROM jira_issues
          WHERE report_id IN (${placeholders(reportCount)})
          GROUP BY issue_key`;
}

/**
 * The org's completed reports whose search window overlaps the range, and the range's measured
 * days. Canonical-row dedupe runs over these ids only, so its cost scales with the window rather
 * than with the org's whole history.
 */
async function rangeReports(org: string, window: RangeWindow): Promise<{ ids: string[]; measuredDays: number }> {
  const [reportRows] = await db.execute(
    `SELECT id, status, period_days, created_at, completed_at FROM reports WHERE org = ?`,
    [org],
  ) as [any[], any];
  const sinceMs = dayMs(window.since);
  const untilMs = dayMs(window.until);
  const measuredDays = measuredDaysInWindow(completedReportWindows(reportRows), window.since, window.until);
  const ids = reportRows
    .filter((r: any) => { const [w] = completedReportWindows([r]); return !!w && windowOverlaps(w, sinceMs, untilMs); })
    .map((r: any) => r.id);
  return { ids, measuredDays };
}

/**
 * GLOOK-63: every developer figure recomputed over [window.since, window.until), each source
 * de-duplicated by its own key (spec requirement 6). Developers are those with a developer_stats
 * row in any completed report whose search window overlaps the range (requirement 7).
 */
export async function getRangeDeveloperStats(org: string, window: RangeWindow): Promise<RangeDeveloperRow[]> {
  const { ids, measuredDays } = await rangeReports(org, window);
  if (ids.length === 0) return [];
  // The key carries the exact report set, so a newly completed or deleted report is a new key and
  // a cached result is never stale for report-scoped data. Only an out-of-band pr_activity load
  // (backfill/import) can lag, and that by at most RANGE_CACHE_TTL_MS.
  const key = createHash('sha1').update(JSON.stringify([org, window.since, window.until, measuredDays, ids])).digest('hex');
  const now = Date.now();
  const hit = rangeCache.get(key);
  if (hit && hit.expires > now) return hit.rows;
  const rows = computeRangeDeveloperStats(window, ids, measuredDays, org);
  rangeCache.set(key, { rows, expires: now + RANGE_CACHE_TTL_MS });
  rows.catch(() => { if (rangeCache.get(key)?.rows === rows) rangeCache.delete(key); });
  while (rangeCache.size > RANGE_CACHE_MAX) rangeCache.delete(rangeCache.keys().next().value!);
  return rows;
}

/**
 * Range figures are expensive on a small MySQL (the canonical de-dupe plus tens of thousands of
 * row lookups, ~4s for 12 months on dev's db.t4g.micro) and identical for every viewer of the same
 * window, so they are memoised per (org, window, report set). The promise is stored, so concurrent
 * requests share one computation. globalThis survives Next.js HMR, like the progress store.
 */
const RANGE_CACHE_TTL_MS = 60 * 60 * 1000;
const RANGE_CACHE_MAX = 32;
const g = globalThis as unknown as { __glookerRangeCache?: Map<string, { rows: Promise<RangeDeveloperRow[]>; expires: number }> };
const rangeCache = (g.__glookerRangeCache ??= new Map());

/** Test hook. */
export function clearRangeCache(): void { rangeCache.clear(); }

/**
 * Computes the 90-day and 12-month figures ending at this report so the first viewer doesn't pay
 * for them. Fire-and-forget after a report completes; failures only cost the warm-up.
 */
export async function warmRangeCache(reportId: string): Promise<void> {
  const [rows] = await db.execute(`SELECT org, created_at, completed_at FROM reports WHERE id = ?`, [reportId]) as [any[], any];
  if (!rows[0]) return;
  for (const range of ['90d', '12m'] as const) {
    await getRangeDeveloperStats(rows[0].org, rangeWindow(rows[0], range));
  }
}

async function computeRangeDeveloperStats(
  window: RangeWindow, ids: string[], measuredDays: number, org: string,
): Promise<RangeDeveloperRow[]> {
  const sinceMs = dayMs(window.since);
  const untilMs = dayMs(window.until);

  const [devRows] = await db.execute(
    `SELECT ds.github_login, ds.github_name, ds.avatar_url, r.created_at
     FROM developer_stats ds JOIN reports r ON r.id = ds.report_id
     WHERE ds.report_id IN (${ids.map(() => '?').join(',')})`,
    ids,
  ) as [any[], any];
  const people = new Map<string, { name: string; avatar: string; at: number }>();
  for (const d of devRows) {
    const at = new Date(d.created_at).getTime() || 0;
    const prev = people.get(d.github_login);
    if (!prev || at >= prev.at) people.set(d.github_login, { name: d.github_name || '', avatar: d.avatar_url || '', at });
  }

  const [commitRows] = await db.execute(
    `SELECT /*+ JOIN_FIXED_ORDER() */ ca.github_login, ca.repo, ca.lines_added, ca.lines_removed, ca.complexity, ca.type,
            ca.ai_co_authored, ca.maybe_ai, ca.pr_number
     FROM (${canonicalCommitIdsSql(ids.length)}) one
     JOIN commit_analyses ca ON ca.id = one.id
     WHERE ca.committed_at >= ? AND ca.committed_at < ?`,
    [...ids, window.since, window.until],
  ) as [any[], any];

  const [jiraRows] = await db.execute(
    `SELECT /*+ JOIN_FIXED_ORDER() */ ji.github_login, ji.story_points
     FROM (${canonicalJiraIdsSql(ids.length)}) one
     JOIN jira_issues ji ON ji.id = one.id
     WHERE ji.resolved_at >= ? AND ji.resolved_at < ?`,
    [...ids, window.since, window.until],
  ) as [any[], any];

  const [prRows] = await db.execute(
    `SELECT github_login, kind, merged_at FROM pr_activity
     WHERE org = ? AND merged_at >= ? AND merged_at < ?`,
    [org, window.since, window.until],
  ) as [any[], any];

  const [covRows] = await db.execute(
    `SELECT github_login, since_date, until_date FROM pr_activity_coverage
     WHERE org = ? AND until_date > ? AND since_date < ?`,
    [org, window.since, window.until],
  ) as [any[], any];

  type Acc = {
    commits: number; added: number; removed: number; cx: number; cxN: number; pr: number; ai: number;
    types: Record<string, number>; repos: Set<string>; issues: number; sp: number;
    prs: number; reviews: number; cov: Array<[number, number]>; covSince: string | null;
  };
  const acc = new Map<string, Acc>();
  const get = (login: string): Acc | undefined => {
    if (!people.has(login)) return undefined;
    let a = acc.get(login);
    if (!a) {
      a = { commits: 0, added: 0, removed: 0, cx: 0, cxN: 0, pr: 0, ai: 0, types: {}, repos: new Set(),
            issues: 0, sp: 0, prs: 0, reviews: 0, cov: [], covSince: null };
      acc.set(login, a);
    }
    return a;
  };
  for (const login of people.keys()) get(login);

  for (const c of commitRows) {
    const a = get(c.github_login); if (!a) continue;
    a.commits++;
    a.added += Number(c.lines_added) || 0;
    a.removed += Number(c.lines_removed) || 0;
    if (c.complexity != null) { a.cx += Number(c.complexity); a.cxN++; }
    if (c.pr_number != null) a.pr++;
    if (Number(c.ai_co_authored) || Number(c.maybe_ai)) a.ai++;
    if (c.type) a.types[c.type] = (a.types[c.type] || 0) + 1;
    if (c.repo) a.repos.add(c.repo);
  }
  for (const j of jiraRows) {
    const a = get(j.github_login); if (!a) continue;
    a.issues++;
    a.sp += Number(j.story_points) || 0;
  }
  for (const c of covRows) {
    const a = get(c.github_login); if (!a) continue;
    a.cov.push([dayMs(c.since_date), dayMs(c.until_date)]);
    const from = c.since_date > window.since ? c.since_date : window.since;
    if (a.covSince == null || from < a.covSince) a.covSince = from;
  }
  // A PR or review counts only when it merged inside one of this developer's PR coverage slices
  // (intersected with the range), so the counts pair with pr_covered_days.
  for (const p of prRows) {
    const a = get(p.github_login); if (!a) continue;
    const t = new Date(p.merged_at).getTime();
    if (!Number.isFinite(t) || t < sinceMs || t >= untilMs) continue;
    if (!a.cov.some(([s, e]) => t >= s && t < e)) continue;
    if (p.kind === 'authored') a.prs++;
    else if (p.kind === 'reviewed') a.reviews++;
  }

  const rows: RangeDeveloperRow[] = [];
  for (const [login, a] of acc) {
    const p = people.get(login)!;
    const avgComplexity = a.cxN > 0 ? Math.round((a.cx / a.cxN) * 10) / 10 : 0;
    const prPercentage = a.commits > 0 ? Math.round((a.pr / a.commits) * 100) : 0;
    const aiPercentage = a.commits > 0 ? Math.round((a.ai / a.commits) * 100) : 0;
    const prCoveredDays = unionDayCount(a.cov, sinceMs, untilMs);
    rows.push({
      github_login: login, github_name: p.name, avatar_url: p.avatar,
      total_prs: a.prs, total_commits: a.commits, lines_added: a.added, lines_removed: a.removed,
      avg_complexity: avgComplexity,
      impact_score: computeImpactScore({
        totalCommits: a.commits, totalPRs: a.prs, avgComplexity, prPercentage,
        totalStoryPoints: a.sp, totalJiraIssues: a.issues, totalReviews: a.reviews,
        periodDays: measuredDays, prPeriodDays: prCoveredDays,
      }),
      pr_percentage: prPercentage, ai_percentage: aiPercentage,
      total_jira_issues: a.issues, total_story_points: a.sp, total_reviews: a.reviews,
      type_breakdown: a.types, active_repos: [...a.repos],
      measured_days: measuredDays, pr_covered_days: prCoveredDays, pr_covered_since: a.covSince,
    });
  }
  return rows.sort((x, y) => y.impact_score - x.impact_score || x.github_login.localeCompare(y.github_login));
}

/** GLOOK-63: this developer's commits in the range, one row per commit_sha. */
export async function getRangeCommits(org: string, login: string, window: RangeWindow): Promise<any[]> {
  const { ids } = await rangeReports(org, window);
  if (ids.length === 0) return [];
  const [rows] = await db.execute(
    `SELECT /*+ JOIN_FIXED_ORDER() */ ca.commit_sha, ca.repo, ca.commit_message, ca.pr_number, ca.pr_title,
            ca.type, ca.complexity, ca.risk_level, ca.impact_summary,
            ca.lines_added, ca.lines_removed, ca.committed_at,
            ca.ai_co_authored, ca.ai_tool_name, ca.maybe_ai
     FROM (${canonicalCommitIdsSql(ids.length, true)}) one
     JOIN commit_analyses ca ON ca.id = one.id
     WHERE ca.committed_at >= ? AND ca.committed_at < ?
     ORDER BY ca.committed_at DESC`,
    [login, ...ids, window.since, window.until],
  ) as [any[], any];
  return rows;
}

/** GLOOK-63: resolved Jira issues in the range, one row per issue_key; same shape as getJiraIssues. */
export async function getRangeJiraIssues(org: string, login: string | undefined, window: RangeWindow): Promise<any[]> {
  const { ids } = await rangeReports(org, window);
  if (ids.length === 0) return [];
  const [rows] = await db.execute(
    `SELECT /*+ JOIN_FIXED_ORDER() */ ji.issue_key, ji.project_key, ji.issue_type, ji.summary, ji.description,
            ji.status, ji.labels, ji.story_points, ji.original_estimate_seconds,
            ji.issue_url, ji.created_at, ji.resolved_at
     FROM (${canonicalJiraIdsSql(ids.length)}) one
     JOIN jira_issues ji ON ji.id = one.id
     WHERE ji.resolved_at >= ? AND ji.resolved_at < ?${login ? ' AND ji.github_login = ?' : ''}
     ORDER BY ji.resolved_at DESC`,
    login ? [...ids, window.since, window.until, login] : [...ids, window.since, window.until],
  ) as [any[], any];
  return rows.map((r: any) => ({
    ...r,
    labels: typeof r.labels === 'string' ? parseLabels(r.labels) : (r.labels || []),
    story_points: r.story_points != null ? Number(r.story_points) : null,
  }));
}

function parseLabels(raw: string): unknown[] {
  try {
    const v = JSON.parse(raw || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** Report id → its org and range window; null when the report doesn't exist. */
export async function loadReportRangeWindow(
  reportId: string, range: ReportRangeKey,
): Promise<{ org: string; window: RangeWindow } | null> {
  const [rows] = await db.execute(
    `SELECT org, created_at, completed_at FROM reports WHERE id = ?`,
    [reportId],
  ) as [any[], any];
  if (!rows.length) return null;
  return { org: rows[0].org, window: rangeWindow(rows[0], range) };
}
