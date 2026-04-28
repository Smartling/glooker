jest.mock('@octokit/rest', () => ({
  Octokit: jest.fn().mockImplementation(() => ({})),
}));

import { compareBranchCommits, __setOctokitForTest } from '../../github';

describe('compareBranchCommits', () => {
  afterEach(() => { __setOctokitForTest(null as any); });

  it('returns commits in head not in base', async () => {
    const reposGet = jest.fn().mockResolvedValue({ data: { default_branch: 'main' } });
    const compareCommits = jest.fn().mockResolvedValueOnce({
      data: {
        commits: [
          { sha: 'aaa1', commit: { message: 'feat', author: { date: '2026-04-15T10:00:00Z' }, committer: { date: '2026-04-15T10:00:00Z' } }, author: { login: 'alice' } },
          { sha: 'bbb2', commit: { message: 'fix',  author: { date: '2026-04-16T10:00:00Z' }, committer: { date: '2026-04-16T10:00:00Z' } }, author: { login: 'alice' } },
        ],
      },
    });
    __setOctokitForTest({ repos: { get: reposGet, compareCommits } } as any);

    const commits = await compareBranchCommits('acme', 'auth-branch-test', 'feature-foo-sha');

    expect(commits).toEqual([
      { sha: 'aaa1', message: 'feat', authorLogin: 'alice', committedAt: '2026-04-15T10:00:00Z' },
      { sha: 'bbb2', message: 'fix',  authorLogin: 'alice', committedAt: '2026-04-16T10:00:00Z' },
    ]);
    expect(compareCommits).toHaveBeenCalledWith(expect.objectContaining({
      owner: 'acme', repo: 'auth-branch-test', base: 'main', head: 'feature-foo-sha',
    }));
  });

  it('returns empty array when head equals base', async () => {
    const reposGet = jest.fn().mockResolvedValue({ data: { default_branch: 'main' } });
    const compareCommits = jest.fn().mockResolvedValueOnce({ data: { commits: [] } });
    __setOctokitForTest({ repos: { get: reposGet, compareCommits } } as any);
    expect(await compareBranchCommits('acme', 'auth-empty', 'sha')).toEqual([]);
  });
});
