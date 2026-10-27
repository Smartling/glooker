// @octokit/rest is ESM-only; FACTORY-form mock required before the import.
jest.mock('@octokit/rest', () => ({ Octokit: jest.fn().mockImplementation(() => ({})) }));

import { countReviewedPRs, searchUserMergedPRs, __setOctokitForTest } from '@/lib/github';

jest.useFakeTimers({ doNotFake: ['nextTick'], now: new Date('2026-10-27T12:00:00Z') });
afterEach(() => { jest.clearAllTimers(); __setOctokitForTest(null); });

/** Same pump as pr-search-false-skips.test.ts: drain 2.5s inter-page and retry sleeps. */
async function drain<T>(p: Promise<T>): Promise<T> {
  let settled = false;
  const tracked = p.then((v) => { settled = true; return v; }, (e) => { settled = true; throw e; });
  tracked.catch(() => {});
  for (let i = 0; i < 200 && !settled; i++) {
    jest.advanceTimersByTime(10_000);
    for (let j = 0; j < 10; j++) await Promise.resolve();
  }
  return tracked;
}

const SINCE = new Date('2026-10-13T00:00:00Z');
const item = (n: number) => ({
  number: n, title: `PR ${n}`,
  repository_url: 'https://api.github.com/repos/acme/app',
  pull_request: { merged_at: '2026-10-20T10:00:00Z' },
});
const page = (total: number, from: number, count: number, incomplete = false) => ({
  total_count: total, incomplete_results: incomplete,
  items: Array.from({ length: count }, (_, i) => item(from + i)),
});

function stubPages(pages: any[]) {
  const calls: any[] = [];
  __setOctokitForTest({
    search: {
      issuesAndPullRequests: async (args: any) => {
        calls.push(args);
        return { data: pages[Math.min(calls.length - 1, pages.length - 1)] };
      },
    },
  });
  return calls;
}

describe('countReviewedPRs (GLOOK-63)', () => {
  it('pages at per_page 100 and returns every reviewed PR', async () => {
    const calls = stubPages([page(150, 1, 100), page(150, 101, 50)]);
    const r = await drain(countReviewedPRs('acme', 'alice', SINCE));
    expect(calls.map(c => [c.per_page, c.page])).toEqual([[100, 1], [100, 2]]);
    expect(calls[0].q).toBe('org:acme is:pr is:merged reviewed-by:alice merged:>2026-10-13');
    expect(r.reviews).toBe(150);
    expect(r.prs).toHaveLength(150);
    expect(r.prs[0]).toEqual({ number: 1, title: 'PR 1', repo: 'app', mergedAt: '2026-10-20T10:00:00Z' });
    expect(r.itemsComplete).toBe(true);
    expect(r.unverified).toBeUndefined();
  });

  it('keeps the page-1 count as unverified when page 1 stays untrustworthy (unchanged GLOOK-50 rule)', async () => {
    stubPages([{ total_count: 3, incomplete_results: true, items: [] }]);
    const r = await drain(countReviewedPRs('acme', 'alice', SINCE));
    expect(r.reviews).toBe(3);
    expect(r.unverified).toMatch(/review-count search timed out \(total_count=3\)/);
    expect(r.itemsComplete).toBe(false);
  });

  it('a timed-out empty zero is still a kept, unverified zero', async () => {
    stubPages([{ total_count: 0, incomplete_results: true, items: [] }]);
    const r = await drain(countReviewedPRs('acme', 'bot', SINCE));
    expect(r).toMatchObject({ reviews: 0, prs: [], itemsComplete: false });
    expect(r.unverified).toBeDefined();
  });

  it('a later page going bad never raises: count kept, rows marked incomplete, no unverified', async () => {
    stubPages([page(150, 1, 100), { total_count: 150, incomplete_results: true, items: [] }]);
    const r = await drain(countReviewedPRs('acme', 'alice', SINCE));
    expect(r.reviews).toBe(150);
    expect(r.prs).toHaveLength(100);
    expect(r.itemsComplete).toBe(false);
    expect(r.unverified).toBeUndefined();
  });

  it('a bounded window uses an inclusive merged range', async () => {
    const calls = stubPages([page(0, 1, 0)]);
    await drain(countReviewedPRs('acme', 'alice', new Date('2026-03-01T00:00:00Z'), undefined, new Date('2026-03-31T00:00:00Z')));
    expect(calls[0].q).toBe('org:acme is:pr is:merged reviewed-by:alice merged:2026-03-01..2026-03-31');
  });
});

describe('searchUserMergedPRs with until (GLOOK-63)', () => {
  it('uses an inclusive merged range and keeps its raise-on-provable-loss rule', async () => {
    const calls = stubPages([page(2, 1, 2)]);
    const r = await drain(searchUserMergedPRs('acme', 'alice', new Date('2026-03-01T00:00:00Z'), undefined, new Date('2026-03-31T00:00:00Z')));
    expect(calls[0].q).toBe('org:acme type:pr is:merged author:alice merged:2026-03-01..2026-03-31');
    expect(r.prs).toHaveLength(2);
    expect(r.itemsComplete).toBe(true);

    stubPages([{ total_count: 4, incomplete_results: false, items: [] }]);
    await expect(drain(searchUserMergedPRs('acme', 'alice', SINCE))).rejects.toThrow(/counted 4 PRs but delivered none/);
  });

  it('past the 1000-result cap the rows are truncated, so itemsComplete is false (no raise)', async () => {
    const pages = Array.from({ length: 10 }, (_, i) => page(1500, i * 100 + 1, 100));
    const calls = stubPages(pages);
    const r = await drain(searchUserMergedPRs('acme', 'alice', SINCE));
    expect(calls).toHaveLength(10);
    expect(r.prs).toHaveLength(1000);
    expect(r.itemsComplete).toBe(false);
    expect(r.unverified).toBeUndefined();
  });
});
