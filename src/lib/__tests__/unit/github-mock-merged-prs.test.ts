jest.mock('@octokit/rest', () => ({ Octokit: jest.fn().mockImplementation(() => ({})) }));
import { createMockGitHubProvider } from '@/lib/github-mock';

describe('mock fetchMergedPRs', () => {
  const since = new Date('2026-07-30T00:00:00Z');
  const until = new Date('2026-10-28T00:00:00Z');

  it('returns deterministic PRs inside [since, until)', async () => {
    const p = createMockGitHubProvider();
    const a = await p.fetchMergedPRs('acme', 'alice', since, undefined, until);
    const b = await p.fetchMergedPRs('acme', 'alice', since, undefined, until);
    expect(a.prs.length).toBeGreaterThan(0);
    expect(a).toEqual(b);
    for (const pr of a.prs) {
      const t = Date.parse(pr.mergedAt);
      expect(t).toBeGreaterThanOrEqual(since.getTime());
      expect(t).toBeLessThan(until.getTime());
    }
  });

  it('returns nothing for an empty window', async () => {
    const p = createMockGitHubProvider();
    expect((await p.fetchMergedPRs('acme', 'alice', until, undefined, since)).prs).toEqual([]);
  });
});
