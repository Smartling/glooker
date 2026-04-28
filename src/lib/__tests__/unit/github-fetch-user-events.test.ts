jest.mock('@octokit/rest', () => ({
  Octokit: jest.fn().mockImplementation(() => ({})),
}));

import { fetchUserOrgEvents, __setOctokitForTest } from '../../github';

describe('fetchUserOrgEvents', () => {
  afterEach(() => { __setOctokitForTest(null as any); });

  it('returns push events with repo + ref + head sha for the user in the org', async () => {
    const mockListEvents = jest.fn().mockResolvedValueOnce({
      data: [
        {
          type: 'PushEvent',
          repo: { name: 'acme/auth' },
          payload: { ref: 'refs/heads/feature-foo', head: 'aaa1' },
        },
        {
          type: 'PushEvent',
          repo: { name: 'acme/auth' },
          payload: { ref: 'refs/heads/main', head: 'aaa2' },
        },
        {
          type: 'PullRequestEvent',
          repo: { name: 'acme/auth' },
          payload: {},
        },
      ],
    });
    __setOctokitForTest({
      activity: { listOrgEventsForAuthenticatedUser: mockListEvents },
    } as any);

    const events = await fetchUserOrgEvents('acme', 'alice');

    expect(events).toEqual([
      { type: 'PushEvent', repo: 'auth', ref: 'refs/heads/feature-foo', headSha: 'aaa1' },
      { type: 'PushEvent', repo: 'auth', ref: 'refs/heads/main',        headSha: 'aaa2' },
    ]);
    expect(mockListEvents).toHaveBeenCalledWith(expect.objectContaining({ org: 'acme', username: 'alice', per_page: 100 }));
  });

  it('returns empty array when the user has no events', async () => {
    const mockListEvents = jest.fn().mockResolvedValueOnce({ data: [] });
    __setOctokitForTest({
      activity: { listOrgEventsForAuthenticatedUser: mockListEvents },
    } as any);
    expect(await fetchUserOrgEvents('acme', 'alice')).toEqual([]);
  });

  it('paginates and stops at 3 pages (300-event GitHub cap)', async () => {
    const mockListEvents = jest.fn().mockResolvedValue({
      data: Array.from({ length: 100 }).map((_, i) => ({
        type: 'PushEvent',
        repo: { name: 'acme/x' },
        payload: { ref: 'refs/heads/branch-' + i, head: 'sha-' + i },
      })),
    });
    __setOctokitForTest({
      activity: { listOrgEventsForAuthenticatedUser: mockListEvents },
    } as any);
    const events = await fetchUserOrgEvents('acme', 'alice');
    expect(events.length).toBe(300);
    expect(mockListEvents).toHaveBeenCalledTimes(3);
  }, 15000);
});
