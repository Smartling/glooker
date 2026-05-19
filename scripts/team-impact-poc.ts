// One-off: compute three team-impact strategies from the latest report
// and emit JSON for the visual companion to render.
//
// Strategies:
//   1. sum-then-apply   — aggregate raw metrics across team, run impact formula
//   2. avg-of-impacts   — AVG(per-dev impact)
//   3. weighted-mean    — per-dev impact weighted by per-dev commit count
import mysql from 'mysql2/promise';

interface DevRow {
  github_login: string;
  team_id: string | null;
  team_name: string | null;
  total_prs: number;
  total_commits: number;
  avg_complexity: number;
  pr_percentage: number;
  total_jira_issues: number;
  total_reviews: number;
  impact_score: number;
}

// Mirror of computeImpactScore from src/lib/aggregator.ts (no storyPoints here).
function computeImpactScore(s: {
  totalCommits: number; totalPRs: number; avgComplexity: number;
  prPercentage: number; totalJiraIssues: number; totalReviews: number;
}): number {
  const jiraFactor = Math.min(s.totalJiraIssues / 10, 1);
  const raw =
    Math.min(s.totalCommits / 20, 1) * 2 +
    Math.min(s.totalPRs / 10, 1)     * 2.7 +
    (s.avgComplexity / 10)            * 3.5 +
    (s.prPercentage / 100)            * 1.1 +
    jiraFactor                        * 0.5 +
    Math.min(s.totalReviews / 15, 1)  * 0.5;
  return Math.round(raw * 10) / 10;
}

(async () => {
  const reportId = process.argv[2];
  if (!reportId) { console.error('Usage: tsx team-impact-poc.ts <report_id>'); process.exit(1); }

  const conn = await mysql.createConnection({
    host: 'localhost', port: 3307, user: 'glooker', password: 'glooker', database: 'glooker',
  });

  const [rows] = await conn.execute(`
    SELECT ds.github_login,
           t.id   AS team_id,
           t.name AS team_name,
           ds.total_prs,
           ds.total_commits,
           ds.avg_complexity,
           ds.pr_percentage,
           ds.total_jira_issues,
           ds.total_reviews,
           ds.impact_score
      FROM developer_stats ds
      LEFT JOIN team_members tm ON tm.github_login = ds.github_login
      LEFT JOIN teams        t  ON t.id            = tm.team_id
                                 AND t.org         = (SELECT org FROM reports WHERE id = ?)
     WHERE ds.report_id = ?
  `, [reportId, reportId]);

  const devRows = rows as DevRow[];

  // Authoritative team size from the team_members table — independent of who
  // happened to ship anything in this period. A 5-person team with 2 on PTO
  // is still a 5-person team, and per-capita math should reflect that.
  const [teamSizeRows] = await conn.execute(`
    SELECT t.id AS team_id, COUNT(tm.github_login) AS size
      FROM teams t
      LEFT JOIN team_members tm ON tm.team_id = t.id
     WHERE t.org = (SELECT org FROM reports WHERE id = ?)
     GROUP BY t.id
  `, [reportId]);
  const teamSizeById = new Map<string, number>(
    (teamSizeRows as Array<{ team_id: string; size: number | string }>).map(
      r => [r.team_id, Number(r.size)]
    ),
  );

  // Group devs by team_id (null for unteamed)
  const byTeam = new Map<string, { name: string; devs: DevRow[] }>();
  for (const d of devRows) {
    const k = d.team_id ?? '__none__';
    const name = d.team_name ?? '(no team)';
    if (!byTeam.has(k)) byTeam.set(k, { name, devs: [] });
    byTeam.get(k)!.devs.push(d);
  }

  // Compute the three strategies per team
  type Out = {
    name: string;
    size: number;
    sumThenApply: number;
    avgOfImpacts: number;
    weightedByCommits: number;
    totalCommits: number;
    totalPRs: number;
    minImpact: number;
    medianImpact: number;
    maxImpact: number;
  };

  const teams: Out[] = [];
  for (const [tid, info] of byTeam) {
    if (info.name === '(no team)') continue;            // skip orphans
    const devs = info.devs;
    const teamSize = teamSizeById.get(tid) ?? devs.length;

    // (1) sum-then-apply
    const totalCommits = devs.reduce((s, d) => s + d.total_commits, 0);
    const totalPRs     = devs.reduce((s, d) => s + d.total_prs, 0);
    const totalJira    = devs.reduce((s, d) => s + d.total_jira_issues, 0);
    const totalRev     = devs.reduce((s, d) => s + d.total_reviews, 0);
    // commit-weighted complexity (avoid letting tiny contributors skew it)
    const wcWeighted   = devs.reduce((s, d) => s + d.avg_complexity * d.total_commits, 0);
    const teamComplexity = totalCommits > 0 ? wcWeighted / totalCommits : 0;
    // commit-weighted PR percentage
    const wpWeighted   = devs.reduce((s, d) => s + d.pr_percentage * d.total_commits, 0);
    const teamPrPct    = totalCommits > 0 ? wpWeighted / totalCommits : 0;
    const sumThenApply = computeImpactScore({
      totalCommits, totalPRs, avgComplexity: teamComplexity,
      prPercentage: teamPrPct, totalJiraIssues: totalJira, totalReviews: totalRev,
    });

    // (2) avg of individual impacts
    const impacts = devs.map(d => Number(d.impact_score) || 0);
    const avgOfImpacts = Math.round((impacts.reduce((s, n) => s + n, 0) / impacts.length) * 10) / 10;

    // (3) per-capita-then-apply: divide additive raw metrics by authoritative
    //     team size (from team_members), then run the IC impact formula.
    //     Ratios (complexity, PR%) are already team-level weighted averages
    //     from sum-then-apply above.
    const weightedByCommits = computeImpactScore({
      totalCommits:    totalCommits / teamSize,
      totalPRs:        totalPRs     / teamSize,
      avgComplexity:   teamComplexity,
      prPercentage:    teamPrPct,
      totalJiraIssues: totalJira    / teamSize,
      totalReviews:    totalRev     / teamSize,
    });

    // Distribution
    const sorted = [...impacts].sort((a, b) => a - b);
    const minImpact = sorted[0] ?? 0;
    const maxImpact = sorted[sorted.length - 1] ?? 0;
    const medianImpact = sorted.length % 2
      ? sorted[(sorted.length - 1) / 2]
      : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;

    teams.push({
      name: info.name, size: teamSize,
      sumThenApply, avgOfImpacts, weightedByCommits,
      totalCommits, totalPRs,
      minImpact, medianImpact: Math.round(medianImpact * 10) / 10, maxImpact,
    });
  }

  console.log(JSON.stringify(teams.sort((a, b) => b.weightedByCommits - a.weightedByCommits), null, 2));
  await conn.end();
})();
