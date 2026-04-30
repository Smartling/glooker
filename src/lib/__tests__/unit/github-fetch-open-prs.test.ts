jest.mock('@octokit/rest', () => ({
  Octokit: jest.fn().mockImplementation(() => ({})),
}));

import { fetchOpenPRs, __setOctokitForTest } from '../../github';

describe('fetchOpenPRs', () => {
  afterEach(() => {
    __setOctokitForTest(null as any);
  });

  it('returns a list of open PRs for a user in an org', async () => {
    const mockSearch = jest.fn().mockResolvedValue({
      data: {
        total_count: 2,
        items: [
          {
            number: 101,
            title: 'Refactor auth module',
            html_url: 'https://github.com/acme/auth/pull/101',
            draft: false,
            repository_url: 'https://api.github.com/repos/acme/auth',
            created_at: '2026-04-01T10:00:00Z',
            updated_at: '2026-04-22T12:00:00Z',
          },
          {
            number: 202,
            title: 'WIP billing fix',
            html_url: 'https://github.com/acme/billing/pull/202',
            draft: true,
            repository_url: 'https://api.github.com/repos/acme/billing',
            created_at: '2026-04-20T08:00:00Z',
            updated_at: '2026-04-23T09:00:00Z',
          },
        ],
      },
    });
    const mockPullsGet = jest.fn()
      .mockResolvedValueOnce({ data: { commits: 7, additions: 284, deletions: 112 } })
      .mockResolvedValueOnce({ data: { commits: 2, additions: 47, deletions: 12 } });

    __setOctokitForTest({
      search: { issuesAndPullRequests: mockSearch },
      pulls: { get: mockPullsGet },
    } as any);

    const since = new Date('2026-04-10');
    const result = await fetchOpenPRs('acme', 'alice', since);

    expect(result).toEqual([
      {
        repo: 'auth',
        number: 101,
        title: 'Refactor auth module',
        url: 'https://github.com/acme/auth/pull/101',
        draft: false,
        commits: 7,
        additions: 284,
        deletions: 112,
        createdAt: '2026-04-01T10:00:00Z',
        updatedAt: '2026-04-22T12:00:00Z',
      },
      {
        repo: 'billing',
        number: 202,
        title: 'WIP billing fix',
        url: 'https://github.com/acme/billing/pull/202',
        draft: true,
        commits: 2,
        additions: 47,
        deletions: 12,
        createdAt: '2026-04-20T08:00:00Z',
        updatedAt: '2026-04-23T09:00:00Z',
      },
    ]);

    expect(mockSearch).toHaveBeenCalledWith(expect.objectContaining({
      q: 'org:acme author:alice is:pr is:open updated:>=2026-04-10',
    }));
  });

  it('returns empty array when the user has no open PRs', async () => {
    const mockSearch = jest.fn().mockResolvedValue({ data: { total_count: 0, items: [] } });
    __setOctokitForTest({ search: { issuesAndPullRequests: mockSearch } } as any);
    const result = await fetchOpenPRs('acme', 'alice', new Date('2026-04-10'));
    expect(result).toEqual([]);
  });
});
