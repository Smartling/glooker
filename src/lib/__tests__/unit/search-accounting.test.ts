// @octokit/rest is ESM-only; must be mocked with the FACTORY form before the
// import or the suite fails to load (see CLAUDE.md).
jest.mock('@octokit/rest', () => ({ Octokit: jest.fn().mockImplementation(() => ({})) }));

import { isSuspectSearchResult } from '@/lib/github';

/**
 * GLOOK-50. On 2026-09-08 six developers were recorded with 0 commits while
 * GitHub held 21/15/9/8/5/2 for them. Nothing failed, so nothing was skipped
 * and the integrity guard was blind. These are the two response shapes whose
 * emptiness must not be trusted.
 */
describe('isSuspectSearchResult', () => {
  it('trusts a genuine empty result', () => {
    // GitHub finished looking and found nothing — the one trustworthy zero.
    expect(isSuspectSearchResult({ total_count: 0, incomplete_results: false, items: [] }))
      .toBe(false);
  });

  it('trusts a normal populated result', () => {
    expect(isSuspectSearchResult({ total_count: 2, incomplete_results: false, items: [{}, {}] }))
      .toBe(false);
  });

  it('flags a timed-out query that returned nothing', () => {
    // The shape that loses a developer: GitHub timed out before finding
    // anything, so 0 means "did not finish", not "nothing exists".
    expect(isSuspectSearchResult({ total_count: 0, incomplete_results: true, items: [] }))
      .toBe(true);
  });

  it('does NOT flag a timed-out query that still returned items', () => {
    // Deliberate, and it is why the marker is narrow: GitHub warns that
    // "reaching a timeout does not necessarily mean that search results are
    // incomplete", and on the 2026-09-08 local run 5 of 6 flagged pages were
    // fine (3 genuine zeros, 2 complete-despite-flag). Treating every flagged
    // page as broken would retry constantly for one real fault.
    //
    // Under-delivery of a NON-empty page is not ignored — it is caught exactly,
    // by reconciling collected hits against total_count at the end of
    // collectCommits (see the 'got 2 of 5' case in
    // search-timeout-recovery.test.ts), which beats acting on an advisory flag.
    expect(isSuspectSearchResult({ total_count: 5, incomplete_results: true, items: [{}, {}] }))
      .toBe(false);
  });

  it('flags a timed-out query that returned NOTHING', () => {
    // The shape that lost 43 commits: the zero means "did not finish".
    expect(isSuspectSearchResult({ total_count: 0, incomplete_results: true, items: [] }))
      .toBe(true);
  });

  it('flags a self-contradicting response: counts matches, delivers none', () => {
    // Needs no interpretation to reject, and this is the arm the pagination
    // break in searchUserCommits silently accepts as a zero:
    //   hits(0) >= total_count(21) -> false;  items(0) < 100 -> true -> break
    expect(isSuspectSearchResult({ total_count: 21, incomplete_results: false, items: [] }))
      .toBe(true);
  });

  it('does not flag a capped-page response where items are legitimately short', () => {
    // per_page:1 (countReviewedPRs) — items is capped, not truncated.
    expect(isSuspectSearchResult({ total_count: 33, incomplete_results: false, items: [{}] }))
      .toBe(false);
  });

  it('treats missing fields as not-suspect rather than inventing a failure', () => {
    // A provider (or the mock) that omits the accounting fields must not start
    // reporting every search as suspect.
    expect(isSuspectSearchResult({})).toBe(false);
    expect(isSuspectSearchResult({ items: [] })).toBe(false);
  });
});
