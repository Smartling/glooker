import { aggregateTeams, type AggregatorDeveloper, type AggregatorTeam } from '@/lib/teams/team-aggregator';

const DEV_BASE: AggregatorDeveloper = {
  github_login: 'placeholder', total_prs: 0, total_commits: 0,
  lines_added: 0, lines_removed: 0, avg_complexity: 0, impact_score: 0,
  pr_percentage: 0, ai_percentage: 0, total_jira_issues: 0,
  cc_total_cost: 0, type_breakdown: {}, active_repos: [],
};

const TEAM_BASE: AggregatorTeam = { id: 't1', name: 'T1', color: '#fff', members: [] };

describe('aggregateTeams', () => {
  it('returns an empty array for empty inputs', () => {
    expect(aggregateTeams([], [])).toEqual([]);
  });
});
