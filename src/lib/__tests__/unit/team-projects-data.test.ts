jest.mock('@/lib/db', () => ({
  __esModule: true,
  default: { execute: jest.fn() },
}));

import db from '@/lib/db';
import { extractTeamProjectsData, type TeamProjectsInput } from '@/lib/team-pulse/data';

const exec = db.execute as jest.Mock;

beforeEach(() => exec.mockReset());

describe('extractTeamProjectsData', () => {
  it('returns empty input when team has no members', async () => {
    const result = await extractTeamProjectsData('r1', []);
    expect(result.commits).toEqual([]);
    expect(result.jira_issues).toEqual([]);
    expect(result.team_members).toEqual([]);
    expect(exec).not.toHaveBeenCalled();
  });

  it('filters commits + jira to team members for this report', async () => {
    exec
      .mockResolvedValueOnce([[
        { sha: 'aaa', repo: 'svc', pr_number: 1, commit_message: 'fix bug', github_login: 'alice', total_lines: 50, committed_at: '2026-05-20T10:00:00Z' },
        { sha: 'bbb', repo: 'svc', pr_number: null, commit_message: 'wip', github_login: 'bob', total_lines: 5, committed_at: '2026-05-21T10:00:00Z' },
      ], []])
      .mockResolvedValueOnce([[
        { issue_key: 'PROJ-1', project_key: 'PROJ', summary: 'Auth bug', github_login: 'alice', type: 'Bug', status: 'Done' },
      ], []]);

    const result = await extractTeamProjectsData('r1', ['alice', 'bob']);

    expect(result.commits).toHaveLength(2);
    expect(result.commits[0].github_login).toBe('alice');
    expect(result.commits[0].message_first_line).toBe('fix bug');
    // Locks in the total_lines → lines column-alias mapping (PR review S1).
    expect(result.commits[0].lines).toBe(50);
    expect(result.commits[1].lines).toBe(5);
    expect(result.jira_issues).toHaveLength(1);
    expect(result.team_members).toEqual(['alice', 'bob']);

    // Both queries used parameter binding for report_id and team_members
    expect(exec).toHaveBeenCalledTimes(2);
    expect(exec.mock.calls[0][1][0]).toBe('r1');
    expect(exec.mock.calls[0][1].slice(1)).toEqual(['alice', 'bob']);
  });

  it('caps commits at 200 (most recent first)', async () => {
    const many = Array.from({ length: 250 }, (_, i) => ({
      sha: `sha${i}`, repo: 'svc', pr_number: null,
      commit_message: `c${i}`, github_login: 'alice',
      total_lines: 1, committed_at: `2026-05-${String(i + 1).padStart(2, '0')}T10:00:00Z`,
    }));
    exec
      .mockResolvedValueOnce([many, []])
      .mockResolvedValueOnce([[], []]);

    const result = await extractTeamProjectsData('r1', ['alice']);
    expect(result.commits).toHaveLength(200);
  });
});
