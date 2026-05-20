import { computeImpactScore } from '@/lib/impact-score';

/**
 * Snake-case to match the frontend `Developer` interface that already
 * flows out of /api/report/[id]. A TeamRow can therefore be rendered with
 * the same column components as a Developer row in the IC table.
 */
export interface TeamRow {
  team_id:           string;
  name:              string;
  color:             string;
  size:              number;          // authoritative count from team_members
  active_count:      number;          // devs in team_members who have stats this report
  members:           Array<{ github_login: string; impact_score: number; total_commits: number }>;

  total_prs:          number;
  total_commits:      number;
  lines_added:        number;
  lines_removed:      number;
  total_jira_issues:  number;
  cc_total_cost:      number;
  active_repos_count: number;
  type_breakdown:     Record<string, number>;

  avg_complexity: number;             // commit-weighted
  pr_percentage:  number;             // commit-weighted
  ai_percentage:  number;             // commit-weighted

  impact_sum:      number;            // (Σ) sum of active devs' impact_score — "cumulative team impact"
  impact_avg:      number;            // (A) arithmetic mean of active impact_score
  impact_weighted: number;            // (W) per-capita-then-apply, default sort
}

/** Inputs match the frontend types in src/app/report/[id]/team/page.tsx. */
export interface AggregatorDeveloper {
  github_login:       string;
  total_prs:          number;
  total_commits:      number;
  lines_added:        number;
  lines_removed:      number;
  avg_complexity:     number;
  impact_score:       number;
  pr_percentage:      number;
  ai_percentage:      number;
  total_jira_issues?: number;
  cc_total_cost?:     number;
  type_breakdown:     Record<string, number>;
  active_repos:       string[];
}

export interface AggregatorTeam {
  id:      string;
  name:    string;
  color:   string;
  members: string[];                   // github_login values
}

export function aggregateTeams(
  developers: AggregatorDeveloper[],
  teams:      AggregatorTeam[],
): TeamRow[] {
  const devByLogin = new Map(developers.map(d => [d.github_login, d]));

  const rows: TeamRow[] = [];
  for (const team of teams) {
    if (team.members.length === 0) {
      if (typeof console !== 'undefined') console.warn(`[team-aggregator] team ${team.id} (${team.name}) has 0 members; skipping`);
      continue;
    }

    const activeDevs = team.members
      .map(login => devByLogin.get(login))
      .filter((d): d is AggregatorDeveloper => d !== undefined);

    let total_prs = 0, total_commits = 0, lines_added = 0, lines_removed = 0;
    let total_jira_issues = 0, cc_total_cost = 0;
    for (const d of activeDevs) {
      total_prs         += d.total_prs;
      total_commits     += d.total_commits;
      lines_added       += d.lines_added;
      lines_removed     += d.lines_removed;
      total_jira_issues += d.total_jira_issues ?? 0;
      cc_total_cost     += Number(d.cc_total_cost ?? 0);
    }

    let weightedComplexity = 0, weightedPrPct = 0, weightedAiPct = 0;
    for (const d of activeDevs) {
      weightedComplexity += d.avg_complexity * d.total_commits;
      weightedPrPct      += d.pr_percentage  * d.total_commits;
      weightedAiPct      += d.ai_percentage  * d.total_commits;
    }
    const avg_complexity = total_commits > 0 ? weightedComplexity / total_commits : 0;
    const pr_percentage  = total_commits > 0 ? weightedPrPct      / total_commits : 0;
    const ai_percentage  = total_commits > 0 ? weightedAiPct      / total_commits : 0;

    const type_breakdown: Record<string, number> = {};
    const repoSet = new Set<string>();
    for (const d of activeDevs) {
      for (const [k, v] of Object.entries(d.type_breakdown ?? {})) {
        type_breakdown[k] = (type_breakdown[k] ?? 0) + v;
      }
      for (const r of d.active_repos ?? []) repoSet.add(r);
    }
    const active_repos_count = repoSet.size;

    const total_reviews = 0;       // not exposed via /api/report today; documented in spec
    const total_story_points = 0;  // ditto

    // Σ — cumulative team impact: sum of active developers' individual impact
    // scores. Unlike the previous sum-then-apply variant, this does not
    // saturate at the IC formula's `min(x/N, 1)` caps, so it actually reflects
    // team scale: a 12-person team will land roughly twice as high as a
    // 6-person team of similar per-IC quality. Each IC's contribution is
    // capped at the IC max (~9.3), so the column is bounded by team_size × 9.3.
    const impact_score_sum = activeDevs.reduce((s, d) => s + (Number(d.impact_score) || 0), 0);
    const impact_sum = Math.round(impact_score_sum * 10) / 10;

    const impact_avg = activeDevs.length === 0
      ? 0
      : Math.round((impact_score_sum / activeDevs.length) * 10) / 10;

    const teamSize = team.members.length;
    const impact_weighted = teamSize === 0
      ? 0
      : computeImpactScore({
          totalCommits:     total_commits     / teamSize,
          totalPRs:         total_prs         / teamSize,
          avgComplexity:    avg_complexity,
          prPercentage:     pr_percentage,
          totalStoryPoints: total_story_points / teamSize,
          totalJiraIssues:  total_jira_issues / teamSize,
          totalReviews:     total_reviews     / teamSize,
        });

    rows.push({
      team_id: team.id,
      name:    team.name,
      color:   team.color,
      size:           team.members.length,
      active_count:   activeDevs.length,
      members:        activeDevs.map(d => ({ github_login: d.github_login, impact_score: Number(d.impact_score) || 0, total_commits: d.total_commits })),
      total_prs, total_commits, lines_added, lines_removed,
      total_jira_issues, cc_total_cost,
      active_repos_count,
      type_breakdown,
      avg_complexity, pr_percentage, ai_percentage,
      impact_sum, impact_avg, impact_weighted,
    });
  }
  return rows;
}
