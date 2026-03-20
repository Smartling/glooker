export interface WeeklyBucket {
  week: string;
  commits: number;
  linesAdded: number;
  linesRemoved: number;
  avgComplexity: number;
  aiPercent: number;
  types: Record<string, number>;
  activeDevs?: number;
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
  const weeklyMap = new Map<string, {
    week: string;
    commits: number;
    linesAdded: number;
    linesRemoved: number;
    totalComplexity: number;
    complexityCount: number;
    aiCount: number;
    types: Record<string, number>;
    activeDevs: Set<string>;
  }>();

  for (const c of commits) {
    if (!c.committed_at) continue;
    const d = new Date(c.committed_at);
    const day = d.getDay();
    const monday = new Date(d);
    monday.setDate(d.getDate() - ((day + 6) % 7));
    const weekKey = monday.toISOString().split('T')[0];

    if (!weeklyMap.has(weekKey)) {
      weeklyMap.set(weekKey, {
        week: weekKey,
        commits: 0, linesAdded: 0, linesRemoved: 0,
        totalComplexity: 0, complexityCount: 0, aiCount: 0,
        types: {}, activeDevs: new Set(),
      });
    }
    const w = weeklyMap.get(weekKey)!;
    w.commits++;
    w.linesAdded += Number(c.lines_added) || 0;
    w.linesRemoved += Number(c.lines_removed) || 0;
    if (c.complexity != null) {
      w.totalComplexity += Number(c.complexity);
      w.complexityCount++;
    }
    if (c.ai_co_authored || c.maybe_ai) w.aiCount++;
    if (c.type) w.types[c.type] = (w.types[c.type] || 0) + 1;
    if (c.github_login) w.activeDevs.add(c.github_login);
  }

  return [...weeklyMap.values()]
    .sort((a, b) => a.week.localeCompare(b.week))
    .map(w => {
      const bucket: WeeklyBucket = {
        week: w.week,
        commits: w.commits,
        linesAdded: w.linesAdded,
        linesRemoved: w.linesRemoved,
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
