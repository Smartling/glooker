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

describe('aggregateTeams — sum aggregation', () => {
  it('sums total_prs, total_commits, lines, jira, spend across active members', () => {
    const devs: AggregatorDeveloper[] = [
      { ...DEV_BASE, github_login: 'a', total_prs: 4, total_commits: 12, lines_added: 100, lines_removed: 30, total_jira_issues: 3, cc_total_cost: 0.5 },
      { ...DEV_BASE, github_login: 'b', total_prs: 2, total_commits: 8,  lines_added: 50,  lines_removed: 10, total_jira_issues: 1, cc_total_cost: 0.3 },
    ];
    const teams: AggregatorTeam[] = [{ ...TEAM_BASE, members: ['a', 'b'] }];
    const [row] = aggregateTeams(devs, teams);
    expect(row.total_prs).toBe(6);
    expect(row.total_commits).toBe(20);
    expect(row.lines_added).toBe(150);
    expect(row.lines_removed).toBe(40);
    expect(row.total_jira_issues).toBe(4);
    expect(row.cc_total_cost).toBeCloseTo(0.8, 5);
  });

  it('treats missing optional fields as zero (total_jira_issues, cc_total_cost)', () => {
    const devs: AggregatorDeveloper[] = [{ ...DEV_BASE, github_login: 'a', total_commits: 5 }];
    const teams: AggregatorTeam[] = [{ ...TEAM_BASE, members: ['a'] }];
    const [row] = aggregateTeams(devs, teams);
    expect(row.total_jira_issues).toBe(0);
    expect(row.cc_total_cost).toBe(0);
  });
});
