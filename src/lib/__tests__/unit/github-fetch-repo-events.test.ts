jest.mock('@octokit/rest', () => ({
  Octokit: jest.fn().mockImplementation(() => ({})),
}));

import {
  fetchRepoEvents,
  getBranchHeadSha,
  __setOctokitForTest,
  __clearRepoEventsCacheForTest,
} from '../../github';

describe('fetchRepoEvents', () => {
  afterEach(() => {
    __setOctokitForTest(null as any);
    __clearRepoEventsCacheForTest();
  });

  it('returns PushEvents and CreateEvents (branch type) with actor + ref', async () => {
    const mockListRepoEvents = jest.fn().mockResolvedValueOnce({
      data: [
        {
          type: 'PushEvent',
          actor: { login: 'alice' },
          repo: { name: 'acme/auth' },
          payload: { ref: 'refs/heads/feature-foo', head: 'aaa1' },
          created_at: '2026-04-22T10:00:00Z',
        },
        {
          type: 'CreateEvent',
          actor: { login: 'alice' },
          repo: { name: 'acme/auth' },
          payload: { ref_type: 'branch', ref: 'feature-bar', full_ref: 'refs/heads/feature-bar' },
          created_at: '2026-04-22T11:00:00Z',
        },
        {
          type: 'PullRequestEvent',
          actor: { login: 'alice' },
          repo: { name: 'acme/auth' },
          payload: {},
          created_at: '2026-04-22T12:00:00Z',
        },
      ],
    });
    __setOctokitForTest({
      activity: { listRepoEvents: mockListRepoEvents },
    } as any);

    const events = await fetchRepoEvents('acme', 'auth-evfoo');

    expect(events).toEqual([
      { type: 'PushEvent', actorLogin: 'alice', ref: 'refs/heads/feature-foo', headSha: 'aaa1', createdAt: '2026-04-22T10:00:00Z' },
      { type: 'CreateEvent', actorLogin: 'alice', ref: 'refs/heads/feature-bar', headSha: null, createdAt: '2026-04-22T11:00:00Z' },
    ]);
    expect(mockListRepoEvents).toHaveBeenCalledWith(expect.objectContaining({ owner: 'acme', repo: 'auth-evfoo', per_page: 100 }));
  }, 15000);

  it('returns empty array when the repo has no events', async () => {
    const mockListRepoEvents = jest.fn().mockResolvedValueOnce({ data: [] });
    __setOctokitForTest({ activity: { listRepoEvents: mockListRepoEvents } } as any);
    expect(await fetchRepoEvents('acme', 'auth-empty')).toEqual([]);
  }, 15000);

  it('caches per (owner, repo) and avoids re-fetching', async () => {
    const mockListRepoEvents = jest.fn().mockResolvedValueOnce({ data: [] });
    __setOctokitForTest({ activity: { listRepoEvents: mockListRepoEvents } } as any);
    await fetchRepoEvents('acme', 'auth-cached');
    await fetchRepoEvents('acme', 'auth-cached');
    expect(mockListRepoEvents).toHaveBeenCalledTimes(1);
  }, 15000);
});

describe('getBranchHeadSha', () => {
  afterEach(() => { __setOctokitForTest(null as any); });

  it('returns the head SHA from the branches API', async () => {
    const mockGetBranch = jest.fn().mockResolvedValueOnce({ data: { commit: { sha: 'abcdef0123' } } });
    __setOctokitForTest({ repos: { getBranch: mockGetBranch } } as any);
    expect(await getBranchHeadSha('acme', 'auth', 'feature-foo')).toBe('abcdef0123');
    expect(mockGetBranch).toHaveBeenCalledWith(expect.objectContaining({ owner: 'acme', repo: 'auth', branch: 'feature-foo' }));
  });

  it('returns null when the branch is missing or the call fails', async () => {
    const mockGetBranch = jest.fn().mockRejectedValueOnce(new Error('404'));
    __setOctokitForTest({ repos: { getBranch: mockGetBranch } } as any);
    expect(await getBranchHeadSha('acme', 'auth', 'no-such-branch')).toBeNull();
  });
});
