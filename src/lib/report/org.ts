import db from '../db/index';
import { ReportNotFoundError } from './service';
import { dedupCommitsBySha, aggregateWeekly, weekKeyForDate } from './timeline';

export async function getOrgReport(reportId: string) {
  // 1. Report metadata
  const [reportRows] = await db.execute(
    `SELECT id, org, period_days, status, created_at, completed_at,
            cc_period_start, cc_period_end
     FROM reports WHERE id = ?`,
    [reportId],
  ) as [any[], any];
  if (!reportRows.length) throw new ReportNotFoundError(reportId);

  const org = reportRows[0].org;
  const ccStart: Date | string | null = reportRows[0].cc_period_start;
  const ccEnd: Date | string | null = reportRows[0].cc_period_end;

  // 2. Developer stats with JSON parsing
  const [devRows] = await db.execute(
    `SELECT github_login, github_name, avatar_url,
            total_prs, total_commits, lines_added, lines_removed,
            avg_complexity, impact_score, pr_percentage, ai_percentage,
            total_jira_issues,
            type_breakdown, active_repos,
            cc_total_cost, cc_requests
     FROM developer_stats WHERE report_id = ? ORDER BY impact_score DESC`,
    [reportId],
  ) as [any[], any];

  const developers = devRows.map((row: any) => ({
    ...row,
    type_breakdown: typeof row.type_breakdown === 'string' ? JSON.parse(row.type_breakdown || '{}') : (row.type_breakdown || {}),
    active_repos: typeof row.active_repos === 'string' ? JSON.parse(row.active_repos || '[]') : (row.active_repos || []),
  }));

  // 3. All commits across all reports for org, deduped
  const [allReportIds] = await db.execute(
    `SELECT id FROM reports WHERE org = ?`, [org],
  ) as [any[], any];
  const reportIds = allReportIds.map((r: any) => r.id);

  let timelineCommits: any[] = [];
  if (reportIds.length > 0) {
    const placeholders = reportIds.map(() => '?').join(',');
    const [tlRows] = await db.execute(
      `SELECT commit_sha, github_login, committed_at, lines_added, lines_removed,
              complexity, type, ai_co_authored, maybe_ai, pr_number
       FROM commit_analyses WHERE report_id IN (${placeholders}) ORDER BY committed_at ASC`,
      [...reportIds],
    ) as [any[], any];
    timelineCommits = dedupCommitsBySha(tlRows);
  }

  // 4. Weekly aggregation with trackDevs
  const timeline = aggregateWeekly(timelineCommits, { trackDevs: true });

  // 4a. In-flight overlay: per-commit data from unmerged_commits, bucketed by committed_at.
  const [overlayRows] = await db.execute(
    `SELECT committed_at, lines_added, lines_removed
     FROM unmerged_commits
     WHERE report_id = ?`,
    [reportId],
  ) as [any[], any];

  if (overlayRows.length > 0) {
    // P95 threshold for in-flight commits — same logic aggregateWeekly uses for shipped.
    // Without this, a single huge in-flight commit dominates the Lines Changed/Week chart
    // and breaks the "outliers excluded" smoothing.
    const inFlightTotals = overlayRows
      .filter((r: any) => r.committed_at)
      .map((r: any) => (Number(r.lines_added) || 0) + (Number(r.lines_removed) || 0))
      .sort((a: number, b: number) => a - b);
    const inFlightP95 = inFlightTotals.length > 0
      ? inFlightTotals[Math.floor(inFlightTotals.length * 0.95)]
      : Infinity;

    const weekMap = new Map<string, any>();
    for (const w of timeline) weekMap.set(w.week, w);

    for (const row of overlayRows) {
      if (!row.committed_at) continue;
      const d = new Date(row.committed_at);
      if (Number.isNaN(d.getTime())) continue;
      const weekKey = weekKeyForDate(d);

      let bucket = weekMap.get(weekKey);
      if (!bucket) {
        bucket = {
          week: weekKey,
          commits: 0,
          linesAdded: 0,
          linesRemoved: 0,
          linesP95Added: 0,
          linesP95Removed: 0,
          avgComplexity: 0,
          aiPercent: 0,
          types: {},
          inFlightLinesAdded: 0,
          inFlightLinesRemoved: 0,
          inFlightLinesP95Added: 0,
          inFlightLinesP95Removed: 0,
          activeDevs: 0,
        };
        weekMap.set(weekKey, bucket);
        timeline.push(bucket);
      }

      const a = Number(row.lines_added   || 0);
      const r = Number(row.lines_removed || 0);

      bucket.commits         += 1;
      bucket.linesAdded      += a;
      bucket.linesRemoved    += r;
      bucket.types           = { ...(bucket.types || {}) };
      bucket.types.in_flight = (bucket.types.in_flight || 0) + 1;
      bucket.inFlightLinesAdded   = (bucket.inFlightLinesAdded   || 0) + a;
      bucket.inFlightLinesRemoved = (bucket.inFlightLinesRemoved || 0) + r;
      // Only contribute to the P95-filtered tally if this row is below threshold.
      // linesP95Added/Removed remain shipped-only (untouched by overlay).
      if ((a + r) <= inFlightP95) {
        bucket.inFlightLinesP95Added   = (bucket.inFlightLinesP95Added   || 0) + a;
        bucket.inFlightLinesP95Removed = (bucket.inFlightLinesP95Removed || 0) + r;
      }
    }

    timeline.sort((a, b) => a.week.localeCompare(b.week));
  }

  // KPI-card aggregation: PR counts from unmerged_prs, commit counts from unmerged_commits.
  // In-flight lines = open-PR diffs (from unmerged_prs.pr_additions/pr_deletions) PLUS
  // bare-branch commits with no PR yet (unmerged_commits WHERE pr_number IS NULL).
  // We can't sum across all unmerged_commits because PR-attached rows there
  // double-count work already represented in unmerged_prs.pr_additions.
  const [unmergedAggRows] = await db.execute(
    `SELECT
       (SELECT COUNT(*)              FROM unmerged_prs     WHERE report_id = ?) AS openPrCount,
       (SELECT COUNT(DISTINCT github_login) FROM unmerged_prs WHERE report_id = ?) AS openPrDevCount,
       (SELECT COUNT(*)              FROM unmerged_commits WHERE report_id = ? AND pr_number IS NULL) AS bareBranchCount,
       (SELECT COUNT(DISTINCT github_login) FROM unmerged_commits WHERE report_id = ? AND pr_number IS NULL) AS bareBranchDevCount,
       (SELECT COALESCE(SUM(pr_additions), 0) FROM unmerged_prs WHERE report_id = ?) AS prLinesAdded,
       (SELECT COALESCE(SUM(pr_deletions), 0) FROM unmerged_prs WHERE report_id = ?) AS prLinesRemoved,
       (SELECT COALESCE(SUM(lines_added),   0) FROM unmerged_commits WHERE report_id = ? AND pr_number IS NULL) AS bareLinesAdded,
       (SELECT COALESCE(SUM(lines_removed), 0) FROM unmerged_commits WHERE report_id = ? AND pr_number IS NULL) AS bareLinesRemoved`,
    [reportId, reportId, reportId, reportId, reportId, reportId, reportId, reportId],
  ) as [any[], any];

  const aggRow = unmergedAggRows[0] || {};
  const openPrCount = Number(aggRow.openPrCount || 0);
  const bareBranchCount = Number(aggRow.bareBranchCount || 0);
  const unmergedSummary = (openPrCount > 0 || bareBranchCount > 0)
    ? {
        openPrCount,
        openPrDevCount:       Number(aggRow.openPrDevCount || 0),
        bareBranchCount,
        bareBranchDevCount:   Number(aggRow.bareBranchDevCount || 0),
        inFlightLinesAdded:   Number(aggRow.prLinesAdded || 0)   + Number(aggRow.bareLinesAdded   || 0),
        inFlightLinesRemoved: Number(aggRow.prLinesRemoved || 0) + Number(aggRow.bareLinesRemoved || 0),
      }
    : null;

  // 5. Spend-window per-developer stats (only when a period is set on the report)
  let spendWindow: {
    periodStart: string;
    periodEnd: string;
    firstCoveredDate: string | null;
    perDev: Record<string, { commits: number; prs: number; lines_added: number; lines_removed: number }>;
  } | null = null;

  const toIso = (v: Date | string): string =>
    v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);

  if (ccStart && ccEnd && reportIds.length > 0) {
    const startStr = toIso(ccStart);
    const endStr = toIso(ccEnd);
    const placeholders = reportIds.map(() => '?').join(',');

    // Fetch commits in the spend window across all reports for the org, dedupe by sha
    const [winRows] = await db.execute(
      `SELECT commit_sha, github_login, pr_number, lines_added, lines_removed, committed_at
       FROM commit_analyses
       WHERE report_id IN (${placeholders})
         AND committed_at >= ?
         AND committed_at < DATE_ADD(?, INTERVAL 1 DAY)`,
      [...reportIds, startStr, endStr],
    ) as [any[], any];

    const seenSha = new Set<string>();
    const perDev = new Map<string, { commits: number; prSet: Set<number>; lines_added: number; lines_removed: number }>();
    for (const r of winRows) {
      if (seenSha.has(r.commit_sha)) continue;
      seenSha.add(r.commit_sha);
      const login = r.github_login;
      if (!perDev.has(login)) {
        perDev.set(login, { commits: 0, prSet: new Set(), lines_added: 0, lines_removed: 0 });
      }
      const dev = perDev.get(login)!;
      dev.commits++;
      dev.lines_added += Number(r.lines_added || 0);
      dev.lines_removed += Number(r.lines_removed || 0);
      if (r.pr_number != null) dev.prSet.add(Number(r.pr_number));
    }

    // Earliest commit date seen anywhere for the org (coverage check)
    const [coverRows] = await db.execute(
      `SELECT MIN(committed_at) AS first FROM commit_analyses WHERE report_id IN (${placeholders})`,
      [...reportIds],
    ) as [any[], any];
    const first = coverRows[0]?.first ? toIso(coverRows[0].first) : null;

    const perDevOut: Record<string, any> = {};
    for (const [login, v] of perDev.entries()) {
      perDevOut[login] = {
        commits: v.commits,
        prs: v.prSet.size,
        lines_added: v.lines_added,
        lines_removed: v.lines_removed,
      };
    }

    spendWindow = {
      periodStart: startStr,
      periodEnd: endStr,
      firstCoveredDate: first,
      perDev: perDevOut,
    };
  }

  return { report: reportRows[0], developers, timeline, spendWindow, unmergedSummary };
}
