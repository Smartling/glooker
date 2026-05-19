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

describe('aggregateTeams — commit-weighted ratios', () => {
  it('weights complexity, pr_percentage, ai_percentage by per-dev commits', () => {
    const devs: AggregatorDeveloper[] = [
      { ...DEV_BASE, github_login: 'a', total_commits: 30, avg_complexity: 4, pr_percentage: 80, ai_percentage: 20 },
      { ...DEV_BASE, github_login: 'b', total_commits: 10, avg_complexity: 8, pr_percentage: 40, ai_percentage: 50 },
    ];
    const teams: AggregatorTeam[] = [{ ...TEAM_BASE, members: ['a', 'b'] }];
    const [row] = aggregateTeams(devs, teams);
    // (4*30 + 8*10) / 40 = 5.0
    expect(row.avg_complexity).toBeCloseTo(5.0, 5);
    // (80*30 + 40*10) / 40 = 70
    expect(row.pr_percentage).toBeCloseTo(70, 5);
    // (20*30 + 50*10) / 40 = 27.5
    expect(row.ai_percentage).toBeCloseTo(27.5, 5);
  });

  it('returns zero ratios when the team has zero commits', () => {
    const devs: AggregatorDeveloper[] = [{ ...DEV_BASE, github_login: 'a', avg_complexity: 5, pr_percentage: 100 }];
    const teams: AggregatorTeam[] = [{ ...TEAM_BASE, members: ['a'] }];
    const [row] = aggregateTeams(devs, teams);
    expect(row.avg_complexity).toBe(0);
    expect(row.pr_percentage).toBe(0);
    expect(row.ai_percentage).toBe(0);
  });
});

describe('aggregateTeams — type_breakdown and active_repos_count', () => {
  it('sums type_breakdown counts across active members', () => {
    const devs: AggregatorDeveloper[] = [
      { ...DEV_BASE, github_login: 'a', type_breakdown: { feature: 3, fix: 2 } },
      { ...DEV_BASE, github_login: 'b', type_breakdown: { feature: 1, docs: 4 } },
    ];
    const teams: AggregatorTeam[] = [{ ...TEAM_BASE, members: ['a', 'b'] }];
    const [row] = aggregateTeams(devs, teams);
    expect(row.type_breakdown).toEqual({ feature: 4, fix: 2, docs: 4 });
  });

  it('counts distinct active_repos across active members', () => {
    const devs: AggregatorDeveloper[] = [
      { ...DEV_BASE, github_login: 'a', active_repos: ['x', 'y'] },
      { ...DEV_BASE, github_login: 'b', active_repos: ['y', 'z'] },
    ];
    const teams: AggregatorTeam[] = [{ ...TEAM_BASE, members: ['a', 'b'] }];
    const [row] = aggregateTeams(devs, teams);
    expect(row.active_repos_count).toBe(3);
  });
});

describe('aggregateTeams — impact strategies', () => {
  it('(A) impact_avg is the arithmetic mean of active devs impact_score', () => {
    const devs: AggregatorDeveloper[] = [
      { ...DEV_BASE, github_login: 'a', impact_score: 7.0, total_commits: 1 },
      { ...DEV_BASE, github_login: 'b', impact_score: 6.0, total_commits: 1 },
      { ...DEV_BASE, github_login: 'c', impact_score: 5.0, total_commits: 1 },
    ];
    const teams: AggregatorTeam[] = [{ ...TEAM_BASE, members: ['a', 'b', 'c'] }];
    const [row] = aggregateTeams(devs, teams);
    expect(row.impact_avg).toBe(6.0);
  });

  it('(T) impact_total runs the IC formula on sums', () => {
    // Two devs, 10 commits each → 20 total, saturates min(20/20,1)*2 = 2.0
    // Two devs, 5 PRs each → 10 total, saturates min(10/10,1)*2.7 = 2.7
    const devs: AggregatorDeveloper[] = [
      { ...DEV_BASE, github_login: 'a', total_commits: 10, total_prs: 5 },
      { ...DEV_BASE, github_login: 'b', total_commits: 10, total_prs: 5 },
    ];
    const teams: AggregatorTeam[] = [{ ...TEAM_BASE, members: ['a', 'b'] }];
    const [row] = aggregateTeams(devs, teams);
    expect(row.impact_total).toBe(4.7);
  });

  it('(W) impact_weighted divides additive metrics by team size, then runs the formula', () => {
    // size = 4, only 2 devs active with 10 commits each → per-capita = 20/4 = 5
    // min(5/20, 1) * 2 = 0.5; min(0/10,1) * 2.7 = 0
    const devs: AggregatorDeveloper[] = [
      { ...DEV_BASE, github_login: 'a', total_commits: 10 },
      { ...DEV_BASE, github_login: 'b', total_commits: 10 },
    ];
    const teams: AggregatorTeam[] = [{ ...TEAM_BASE, members: ['a', 'b', 'inactive1', 'inactive2'] }];
    const [row] = aggregateTeams(devs, teams);
    expect(row.size).toBe(4);
    expect(row.active_count).toBe(2);
    expect(row.impact_weighted).toBe(0.5);
  });

  it('single-member team where the dev IS active: W == T (per-capita-with-size-1 collapses to total)', () => {
    const devs: AggregatorDeveloper[] = [
      { ...DEV_BASE, github_login: 'solo', total_commits: 8, total_prs: 4, avg_complexity: 5, pr_percentage: 50, impact_score: 9.9 },
    ];
    const teams: AggregatorTeam[] = [{ ...TEAM_BASE, members: ['solo'] }];
    const [row] = aggregateTeams(devs, teams);
    expect(row.impact_weighted).toBe(row.impact_total);
  });

  it('zero active devs: all three impact scores are 0', () => {
    const devs: AggregatorDeveloper[] = [];
    const teams: AggregatorTeam[] = [{ ...TEAM_BASE, members: ['nobody1', 'nobody2'] }];
    const [row] = aggregateTeams(devs, teams);
    expect(row.size).toBe(2);
    expect(row.active_count).toBe(0);
    expect(row.impact_total).toBe(0);
    expect(row.impact_avg).toBe(0);
    expect(row.impact_weighted).toBe(0);
  });
});
