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
  _developers: AggregatorDeveloper[],
  _teams:      AggregatorTeam[],
): TeamRow[] {
  return [];
}
