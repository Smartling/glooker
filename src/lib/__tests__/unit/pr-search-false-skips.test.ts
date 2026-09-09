// @octokit/rest is ESM-only; FACTORY-form mock required before the import.
jest.mock('@octokit/rest', () => ({ Octokit: jest.fn().mockImplementation(() => ({})) }));

import { fetchUserActivity, __setOctokitForTest } from '@/lib/github';

/**
 * GLOOK-50 follow-up. The first fix made the merged-PR search raise on any
 * untrustworthy result. On 2026-09-09 that aborted the whole report at 21%:
 *
 *   ABORT (GLOOK-13): 21 of 100 engineers couldn't be fetched (21%).
 *   Most failures are GitHub search timeouts (21 of 21)
 *
 * ~19 of those 21 were false. Verified against GitHub: sl-chromatic-bot,
 * sl-data-team-jenkins, magdalenastaller, keser, flaksie, gkim-smartling and
 * viakivchuk-smartling all have GENUINELY zero merged PRs, and an empty issue
 * search routinely reports incomplete_results=true while being correct.
 *
 * Commit search is different and stays strict: there an empty timed-out page
 * really did hide 43 commits. The asymmetry is the point.
 */

jest.useFakeTimers({ doNotFake: ['nextTick'], now: new Date('2026-09-09T12:00:00Z') });
afterEach(() => { jest.clearAllTimers(); __setOctokitForTest(null); });

async function drain<T>(p: Promise<T>): Promise<T> {
  for (let i = 0; i < 60; i++) {
    for (let j = 0; j < 5; j++) await Promise.resolve();
    if (jest.getTimerCount() === 0) break;
    jest.advanceTimersByTime(10_000);
  }
  return p;
}

const SINCE = new Date('2026-08-26T00:00:00Z');
const HEALTHY_EMPTY_COMMITS = { total_count: 0, items: [], incomplete_results: false };

/** Octokit stub: healthy commit search, scripted issue search. */
function stub(issueData: any) {
  const calls = { commits: 0, issues: 0 };
  __setOctokitForTest({
    search: {
      commits: async () => { calls.commits++; return { data: HEALTHY_EMPTY_COMMITS }; },
      issuesAndPullRequests: async () => { calls.issues++; return { data: issueData }; },
    },
  });
  return calls;
}

describe('an empty merged-PR search that timed out', () => {
  const TIMED_OUT_EMPTY = { total_count: 0, items: [], incomplete_results: true };

  it('does NOT skip the member — it keeps the zero and records the doubt', async () => {
    stub(TIMED_OUT_EMPTY);
    const activity = await drain(fetchUserActivity('Smartling', 'sl-chromatic-bot', SINCE));
    expect(activity.prs).toEqual([]);
    expect(activity.prsUnverified).toMatch(/timed out on an empty result/);
  });

  it('retries before giving up on it', async () => {
    const calls = stub(TIMED_OUT_EMPTY);
    await drain(fetchUserActivity('Smartling', 'keser', SINCE));
    // Exactly 3 attempts on the merged-PR page: 1 + SEARCH_TIMEOUT_RETRIES.
    expect(calls.issues).toBe(3);
  });

  it('takes the good answer when a retry recovers', async () => {
    let n = 0;
    __setOctokitForTest({
      search: {
        commits: async () => ({ data: HEALTHY_EMPTY_COMMITS }),
        issuesAndPullRequests: async () => {
          n++;
          if (n === 1) return { data: TIMED_OUT_EMPTY };
          return {
            data: {
              total_count: 1, incomplete_results: false,
              items: [{
                number: 7, title: 'fix', repository_url: 'https://api.github.com/repos/Smartling/pinch',
                pull_request: { merged_at: '2026-09-01T00:00:00Z' },
              }],
            },
          };
        },
      },
    });
    const activity = await drain(fetchUserActivity('Smartling', 'devx', SINCE));
    expect(activity.prs).toHaveLength(1);
    expect(activity.prsUnverified).toBeUndefined();
  });
});

describe('a self-contradicting merged-PR page still raises', () => {
  it('raises when GitHub counts PRs but delivers none', async () => {
    // The protection worth keeping: this is the shape that would land a
    // developer with 42 merged PRs in the report as 0. Observed in the same
    // run for ksoloviov-smartling (total_count=3) and kbroadrick (2).
    stub({ total_count: 3, items: [], incomplete_results: true });
    await expect(drain(fetchUserActivity('Smartling', 'ksoloviov-smartling', SINCE)))
      .rejects.toThrow(/counted 3 PRs for @ksoloviov-smartling but delivered none/);
  });
});

describe('a healthy empty merged-PR search', () => {
  it('is trusted with no retry and no doubt recorded', async () => {
    const calls = stub({ total_count: 0, items: [], incomplete_results: false });
    const activity = await drain(fetchUserActivity('Smartling', 'flaksie', SINCE));
    expect(activity.prs).toEqual([]);
    expect(activity.prsUnverified).toBeUndefined();
    // One call only: fetchUserActivity does commits + merged PRs;
    // countReviewedPRs is invoked separately by report-runner.
    expect(calls.issues).toBe(1);
  });
});
