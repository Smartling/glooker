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

  impact_total:    number;            // (T) sum-then-apply
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

    rows.push({
      team_id: team.id,
      name:    team.name,
      color:   team.color,
      size:           team.members.length,
      active_count:   activeDevs.length,
      members:        activeDevs.map(d => ({ github_login: d.github_login, impact_score: Number(d.impact_score) || 0, total_commits: d.total_commits })),
      total_prs, total_commits, lines_added, lines_removed,
      total_jira_issues, cc_total_cost,
      active_repos_count: 0,
      type_breakdown:     {},
      avg_complexity: 0, pr_percentage: 0, ai_percentage: 0,
      impact_total: 0, impact_avg: 0, impact_weighted: 0,
    });
  }
  return rows;
}
