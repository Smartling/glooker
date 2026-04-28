jest.mock('@octokit/rest', () => ({
  Octokit: jest.fn().mockImplementation(() => ({})),
}));

import { fetchPullRequestCommits, __setOctokitForTest } from '../../github';

describe('fetchPullRequestCommits', () => {
  afterEach(() => { __setOctokitForTest(null as any); });

  it('returns commits for a PR with author login + date + message', async () => {
    const mockListCommits = jest.fn().mockResolvedValueOnce({
      data: [
        {
          sha: 'aaa1',
          commit: {
            message: 'feat: thing',
            author: { name: 'Alice', email: 'alice@x', date: '2026-04-15T10:00:00Z' },
            committer: { date: '2026-04-15T10:00:00Z' },
          },
          author: { login: 'alice' },
        },
        {
          sha: 'bbb2',
          commit: {
            message: 'fix: typo',
            author: { name: 'Alice', email: 'alice@x', date: '2026-04-16T11:00:00Z' },
            committer: { date: '2026-04-16T11:00:00Z' },
          },
          author: { login: 'alice' },
        },
      ],
    });
    __setOctokitForTest({ pulls: { listCommits: mockListCommits } } as any);

    const commits = await fetchPullRequestCommits('acme', 'auth', 42);

    expect(commits).toEqual([
      { sha: 'aaa1', message: 'feat: thing', authorLogin: 'alice', committedAt: '2026-04-15T10:00:00Z' },
      { sha: 'bbb2', message: 'fix: typo',   authorLogin: 'alice', committedAt: '2026-04-16T11:00:00Z' },
    ]);
    expect(mockListCommits).toHaveBeenCalledWith(expect.objectContaining({ owner: 'acme', repo: 'auth', pull_number: 42, per_page: 100 }));
  }, 15000);

  it('returns empty array when the PR has no commits', async () => {
    const mockListCommits = jest.fn().mockResolvedValueOnce({ data: [] });
    __setOctokitForTest({ pulls: { listCommits: mockListCommits } } as any);
    expect(await fetchPullRequestCommits('acme', 'auth', 42)).toEqual([]);
  }, 15000);

  it('falls back to null authorLogin when author is unlinked', async () => {
    const mockListCommits = jest.fn().mockResolvedValueOnce({
      data: [{
        sha: 'ccc3',
        commit: { message: 'msg', author: { date: '2026-04-15T10:00:00Z' }, committer: { date: '2026-04-15T10:00:00Z' } },
        author: null,
      }],
    });
    __setOctokitForTest({ pulls: { listCommits: mockListCommits } } as any);
    const commits = await fetchPullRequestCommits('acme', 'auth', 42);
    expect(commits[0].authorLogin).toBeNull();
  }, 15000);
});
