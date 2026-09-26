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
  // Populated post-aggregation by getOrgReport when open-PR rows overlay the timeline.
  inFlightLinesAdded?: number;
  inFlightLinesRemoved?: number;
  inFlightLinesP95Added?: number;
  inFlightLinesP95Removed?: number;
  avgImpact?: number;
}

// ISO date string for the Monday of the UTC week containing `d`. Used by both the shipped-commit
// aggregator below and the in-flight overlay in `org.ts`, so the two paths can't drift on what
// counts as the same week. GLOOK-58: UTC throughout. The old local-time arithmetic formatted with
// toISOString(), so on a server west of UTC a Monday-evening commit got a Tuesday key and one week
// arrived as two buckets. No week keys are persisted (timelines are computed per request), so this
// needs no migration.
export function weekKeyForDate(d: Date): string {
  const day = d.getUTCDay();
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - ((day + 6) % 7));
  return monday.toISOString().split('T')[0];
}

const DAY_MS = 86_400_000;

/** One report's searched period (GLOOK-58 Decision 15): see completedReportWindows for the edges. */
export interface CoverageWindow {
  completedAt: Date;
  createdAt: Date;
  periodDays: number;
}

/**
 * GLOOK-58 Decision 15: which reports' windows count, and both edges' justification. *(Corrected
 * after the Task 12 review: the right edge was completed_at; that could over-claim a long run's
 * tail, because a member searched early in the run is not re-searched for commits made later in
 * that same run.)*
 *
 * Completed reports only. Every run, resumed ones included, computes since = runStart − period_days
 * (report-runner.ts:44), then searches each member from since with NO upper bound, at some moment at
 * or after runStart. So every member's search covered [runStart − period_days, runStart].
 * created_at ≤ runStart ≤ completed_at, so:
 * - the left edge, completed_at − period_days, is ≥ since (completed_at ≥ runStart), never claiming
 *   earlier than what was actually searched;
 * - the right edge, created_at, is ≤ runStart (it is set when the report row is inserted, before any
 *   member is searched), so every member's search — even the earliest — reached back through it.
 * A window whose edges land the wrong way round (a report resumed long after it was created)
 * contributes nothing; see coveredWeeksFromWindows.
 *
 * The filter is on status, not on completed_at being set: a failed run sets completed_at, and a
 * resumed run is 'running' with its old completed_at still set.
 *
 * Timestamps are parsed with new Date(value), exactly as getOrgReport's avg-impact bucketing does:
 * MySQL DATETIME arrives as a Date; SQLite's zone-less 'YYYY-MM-DD HH:MM:SS' (datetime('now',
 * 'localtime')) is read as local time, on the same host that wrote it. A row whose completed_at or
 * created_at doesn't parse is skipped, which is conservative.
 */
export function completedReportWindows(
  rows: Array<{ status?: unknown; period_days?: unknown; completed_at?: unknown; created_at?: unknown }>,
): CoverageWindow[] {
  const out: CoverageWindow[] = [];
  for (const r of rows) {
    if (r.status !== 'completed' || r.completed_at == null) continue;
    const completedAt = new Date(r.completed_at as string | number | Date);
    if (Number.isNaN(completedAt.getTime())) continue;
    const createdAt = new Date(r.created_at as string | number | Date);
    if (Number.isNaN(createdAt.getTime())) continue;
    out.push({ completedAt, createdAt, periodDays: Number(r.period_days) });
  }
  return out;
}

/**
 * GLOOK-58 Decision 15: the UTC Monday keys of every week all 7 of whose UTC days lie wholly inside
 * the UNION of the windows [completedAt − periodDays, createdAt]. The windows are merged as time
 * intervals first, so two windows that meet (or overlap) mid-day form one continuous interval and
 * don't lose the day they share. The union never over-claims, because every instant in it was
 * searched. A partly covered week is left out, so the edges of a real gap never claim a measured
 * zero. A window whose computed start is at or after its end — an invalid date, a period that isn't
 * a positive number, or a report resumed long after it was created — contributes nothing. Sorted
 * ascending, no duplicates.
 */
export function coveredWeeksFromWindows(windows: CoverageWindow[]): string[] {
  const intervals: Array<[number, number]> = [];
  for (const { completedAt, createdAt, periodDays } of windows) {
    const period = Number(periodDays);
    const startMs = completedAt.getTime() - period * DAY_MS;
    const endMs = createdAt.getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs >= endMs) continue;
    intervals.push([startMs, endMs]);
  }
  intervals.sort((a, b) => a[0] - b[0]);

  // Union: an interval that starts at or before the current one's end extends it.
  const merged: Array<[number, number]> = [];
  for (const [start, end] of intervals) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }

  // A UTC day is marked only if it lies wholly inside one merged interval: it starts at or after
  // the interval's start and ends at or before its end.
  const days = new Set<number>(); // UTC midnights, as epoch ms
  for (const [start, end] of merged) {
    for (let d = Math.ceil(start / DAY_MS) * DAY_MS; d + DAY_MS <= end; d += DAY_MS) days.add(d);
  }

  const weeks = new Set<string>();
  for (const d of days) {
    const key = weekKeyForDate(new Date(d));
    const monday = Date.parse(`${key}T00:00:00Z`);
    let whole = true;
    for (let i = 0; i < 7 && whole; i++) whole = days.has(monday + i * DAY_MS);
    if (whole) weeks.add(key);
  }
  return [...weeks].sort();
}

/**
 * GLOOK-58 Decision 15: the week this report's charts end at. The source is completed_at when
 * status is 'completed', and created_at otherwise: completed_at is not a reliable completion marker
 * for other statuses, because failed runs set it and a resumed run keeps its old value while it
 * runs. Parsed with new Date() as above. If the source is missing or doesn't parse, the current UTC
 * week, so weekKeyForDate never sees an Invalid Date (it would throw a RangeError).
 */
export function anchorWeekFor(status: unknown, completedAt: unknown, createdAt: unknown, now: Date = new Date()): string {
  const source = status === 'completed' ? completedAt : createdAt;
  if (source != null) {
    const d = new Date(source as string | number | Date);
    if (!Number.isNaN(d.getTime())) return weekKeyForDate(d);
  }
  return weekKeyForDate(now);
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

export function aggregateWeekly(commits: any[]): WeeklyBucket[] {
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
        types: {}, prNumbers: new Set(),
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
      return bucket;
    });
}
