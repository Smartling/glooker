jest.mock('@/lib/db', () => ({
  __esModule: true,
  default: { execute: jest.fn() },
}));

import db from '@/lib/db';
import { extractTeamProjectsData, type TeamProjectsInput } from '@/lib/team-pulse/data';

const exec = db.execute as jest.Mock;

beforeEach(() => exec.mockReset());

// Helper: stub all 4 DB calls with provided row arrays (default empty)
function stubCalls(
  commitRows: any[] = [],
  jiraRows: any[] = [],
  prRows: any[] = [],
  branchRows: any[] = [],
) {
  exec
    .mockResolvedValueOnce([commitRows, []])
    .mockResolvedValueOnce([jiraRows, []])
    .mockResolvedValueOnce([prRows, []])
    .mockResolvedValueOnce([branchRows, []]);
}

describe('extractTeamProjectsData', () => {
  it('returns empty input when team has no members', async () => {
    const result = await extractTeamProjectsData('r1', []);
    expect(result.commits).toEqual([]);
    expect(result.jira_issues).toEqual([]);
    expect(result.team_members).toEqual([]);
    expect(result.in_flight_prs).toEqual([]);
    expect(result.in_flight_branches).toEqual([]);
    expect(exec).not.toHaveBeenCalled();
  });

  it('filters commits + jira to team members for this report', async () => {
    stubCalls(
      [
        { sha: 'aaa', repo: 'svc', pr_number: 1, commit_message: 'fix bug', github_login: 'alice', total_lines: 50, committed_at: '2026-05-20T10:00:00Z' },
        { sha: 'bbb', repo: 'svc', pr_number: null, commit_message: 'wip', github_login: 'bob', total_lines: 5, committed_at: '2026-05-21T10:00:00Z' },
      ],
      [{ issue_key: 'PROJ-1', project_key: 'PROJ', summary: 'Auth bug', github_login: 'alice', type: 'Bug', status: 'Done' }],
    );

    const result = await extractTeamProjectsData('r1', ['alice', 'bob']);

    expect(result.commits).toHaveLength(2);
    expect(result.commits[0].github_login).toBe('alice');
    expect(result.commits[0].message_first_line).toBe('fix bug');
    expect(result.commits[0].lines).toBe(50);
    expect(result.commits[1].lines).toBe(5);
    expect(result.jira_issues).toHaveLength(1);
    expect(result.team_members).toEqual(['alice', 'bob']);
    expect(result.in_flight_prs).toEqual([]);
    expect(result.in_flight_branches).toEqual([]);

    expect(exec).toHaveBeenCalledTimes(4);
    expect(exec.mock.calls[0][1][0]).toBe('r1');
    expect(exec.mock.calls[0][1].slice(1)).toEqual(['alice', 'bob']);
  });

  it('caps commits at 200 (most recent first)', async () => {
    const many = Array.from({ length: 250 }, (_, i) => ({
      sha: `sha${i}`, repo: 'svc', pr_number: null,
      commit_message: `c${i}`, github_login: 'alice',
      total_lines: 1, committed_at: `2026-05-${String(i + 1).padStart(2, '0')}T10:00:00Z`,
    }));
    stubCalls(many);

    const result = await extractTeamProjectsData('r1', ['alice']);
    expect(result.commits).toHaveLength(200);
  });

  it('populates in_flight_prs with boolean is_draft coercion', async () => {
    stubCalls(
      [], // commits
      [], // jira
      [
        { repo: 'r1', title: 'Big feature', author: 'alice', additions: 300, deletions: 20, is_draft: 0 },
        { repo: 'r2', title: 'WIP: refactor', author: 'bob', additions: 50, deletions: 10, is_draft: 1 },
      ],
    );

    const result = await extractTeamProjectsData('r1', ['alice', 'bob']);

    expect(result.in_flight_prs).toHaveLength(2);
    expect(result.in_flight_prs[0]).toEqual({
      repo: 'r1', title: 'Big feature', author: 'alice',
      additions: 300, deletions: 20, is_draft: false,
    });
    expect(result.in_flight_prs[1]).toEqual({
      repo: 'r2', title: 'WIP: refactor', author: 'bob',
      additions: 50, deletions: 10, is_draft: true,
    });
  });

  it('populates in_flight_branches from bare unmerged commits', async () => {
    stubCalls(
      [], [], [], // commits, jira, prs empty
      [
        { repo: 'infra', branch: 'feat/k8s-autoscale', author: 'carol', commit_count: 7, lines: 240 },
      ],
    );

    const result = await extractTeamProjectsData('r1', ['carol']);

    expect(result.in_flight_branches).toHaveLength(1);
    expect(result.in_flight_branches[0]).toEqual({
      repo: 'infra', branch: 'feat/k8s-autoscale', author: 'carol',
      commit_count: 7, lines: 240,
    });
  });

  it('returns empty in_flight arrays when no in-flight data exists', async () => {
    stubCalls();
    const result = await extractTeamProjectsData('r1', ['alice']);
    expect(result.in_flight_prs).toEqual([]);
    expect(result.in_flight_branches).toEqual([]);
  });
});
