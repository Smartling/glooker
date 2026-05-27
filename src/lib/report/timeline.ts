export interface WeeklyBucket {
  week: string;
  commits: number;
  prs: number;
  avgLinesPerPr: number;
  linesAdded: number;
  linesRemoved: number;
  linesP95Added: number;
  linesP95Removed: number;
  avgComplexity: number;
  aiPercent: number;
  types: Record<string, number>;
  activeDevs?: number;
  // Populated post-aggregation by getOrgReport when open-PR rows overlay the timeline.
  inFlightLinesAdded?: number;
  inFlightLinesRemoved?: number;
  inFlightLinesP95Added?: number;
  inFlightLinesP95Removed?: number;
}

// ISO date string for the Monday of the week containing `d`. Used by both the
// shipped-commit aggregator below and the in-flight overlay in `org.ts`, so the
// two paths can't drift on what counts as the same week.
export function weekKeyForDate(d: Date): string {
  const day = d.getDay();
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((day + 6) % 7));
  return monday.toISOString().split('T')[0];
}

export function dedupCommitsBySha(rows: any[]): any[] {
  const seen = new Set<string>();
  const result: any[] = [];
  for (const row of rows) {
    if (!seen.has(row.commit_sha)) {
      seen.add(row.commit_sha);
      result.push(row);
    }
  }
  return result;
}

export function aggregateWeekly(commits: any[], opts?: { trackDevs?: boolean }): WeeklyBucket[] {
  // Compute P95 threshold for per-commit line counts (used for filtered lines chart)
  const commitLineTotals = commits
    .filter(c => c.committed_at)
    .map(c => (Number(c.lines_added) || 0) + (Number(c.lines_removed) || 0))
    .sort((a, b) => a - b);
  const p95Threshold = commitLineTotals.length > 0
    ? commitLineTotals[Math.floor(commitLineTotals.length * 0.95)]
    : Infinity;

  // Total lines per PR across all weeks — used to apply a P95 outlier filter to the
  // per-week avgLinesPerPr so one giant refactor PR can't dominate the chart.
  //
  // Threshold math: index = ceil(N * 0.95) - 1. With <= comparison this excludes
  // the top ~5% even at small N (floor(N*0.95) returns the max itself at N≤20,
  // making the filter a no-op for typical dev pages).
  const prLineTotals = new Map<string, number>();
  for (const c of commits) {
    if (c.pr_number == null || !c.committed_at) continue;
    const key = String(c.pr_number);
    prLineTotals.set(key, (prLineTotals.get(key) ?? 0) + (Number(c.lines_added) || 0) + (Number(c.lines_removed) || 0));
  }
  const sortedPrTotals = [...prLineTotals.values()].sort((a, b) => a - b);
  const prP95Threshold = sortedPrTotals.length > 0
    ? sortedPrTotals[Math.ceil(sortedPrTotals.length * 0.95) - 1]
    : Infinity;

  const weeklyMap = new Map<string, {
    week: string;
    commits: number;
    linesAdded: number;
    linesRemoved: number;
    linesP95Added: number;
    linesP95Removed: number;
    totalComplexity: number;
    complexityCount: number;
    aiCount: number;
    types: Record<string, number>;
    activeDevs: Set<string>;
    prNumbers: Set<string>;
    prNumbersP95: Set<string>;
    prLinesP95: number;
  }>();

  for (const c of commits) {
    if (!c.committed_at) continue;
    const d = new Date(c.committed_at);
    const weekKey = weekKeyForDate(d);

    if (!weeklyMap.has(weekKey)) {
      weeklyMap.set(weekKey, {
        week: weekKey,
        commits: 0, linesAdded: 0, linesRemoved: 0,
        linesP95Added: 0, linesP95Removed: 0,
        totalComplexity: 0, complexityCount: 0, aiCount: 0,
        types: {}, activeDevs: new Set(), prNumbers: new Set(),
        prNumbersP95: new Set(), prLinesP95: 0,
      });
    }
    const w = weeklyMap.get(weekKey)!;
    const la = Number(c.lines_added) || 0;
    const lr = Number(c.lines_removed) || 0;
    w.commits++;
    w.linesAdded += la;
    w.linesRemoved += lr;
    // Only include in P95-filtered totals if this commit is below the threshold
    if (la + lr <= p95Threshold) {
      w.linesP95Added += la;
      w.linesP95Removed += lr;
    }
    if (c.complexity != null) {
      w.totalComplexity += Number(c.complexity);
      w.complexityCount++;
    }
    if (c.ai_co_authored || c.maybe_ai) w.aiCount++;
    if (c.type) w.types[c.type] = (w.types[c.type] || 0) + 1;
    if (c.github_login) w.activeDevs.add(c.github_login);
    if (c.pr_number != null) {
      const key = String(c.pr_number);
      w.prNumbers.add(key);
      // avgLinesPerPr semantic: per-week slice of activity. A PR's TOTAL across all weeks
      // decides whether it's an outlier (so the filter is stable across the chart), but
      // only the lines from this week's commits go into this week's numerator, and the
      // denominator is the count of PRs active in this week. A 400-line PR split 200/200
      // across two weeks shows avg=200 in each; a 400-line PR landing in one week shows
      // avg=400 there. This is "average per-PR activity in week W," not "size of the
      // average PR overall."
      if ((prLineTotals.get(key) ?? 0) <= prP95Threshold) {
        w.prNumbersP95.add(key);
        w.prLinesP95 += la + lr;
      }
    }
  }

  return [...weeklyMap.values()]
    .sort((a, b) => a.week.localeCompare(b.week))
    .map(w => {
      const bucket: WeeklyBucket = {
        week: w.week,
        commits: w.commits,
        prs: w.prNumbers.size,
        avgLinesPerPr: w.prNumbersP95.size > 0 ? Math.round(w.prLinesP95 / w.prNumbersP95.size) : 0,
        linesAdded: w.linesAdded,
        linesRemoved: w.linesRemoved,
        linesP95Added: w.linesP95Added,
        linesP95Removed: w.linesP95Removed,
        avgComplexity: w.complexityCount > 0 ? Math.round((w.totalComplexity / w.complexityCount) * 10) / 10 : 0,
        aiPercent: w.commits > 0 ? Math.round((w.aiCount / w.commits) * 100) : 0,
        types: w.types,
      };
      if (opts?.trackDevs) {
        bucket.activeDevs = w.activeDevs.size;
      }
      return bucket;
    });
}
