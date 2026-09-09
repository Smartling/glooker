// @octokit/rest is ESM-only; FACTORY-form mock required before the import.
jest.mock('@octokit/rest', () => ({ Octokit: jest.fn().mockImplementation(() => ({})) }));

import { fetchUserActivity, __setOctokitForTest } from '@/lib/github';
import { formatIntegrityAbortReason, DEFAULT_THRESHOLDS } from '@/lib/report-runner/types';

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

/**
 * Drain the 2.5s inter-page and 5s retry sleeps.
 *
 * Deliberately does NOT stop at the first moment `getTimerCount()` hits zero:
 * between two awaited sleeps there is a tick with no timer pending, and
 * breaking there leaves the promise waiting forever on a clock that has
 * stopped advancing.
 */
async function drain<T>(p: Promise<T>): Promise<T> {
  let settled = false;
  const tracked = p.then(
    (v) => { settled = true; return v; },
    (e) => { settled = true; throw e; },
  );
  tracked.catch(() => {}); // don't trip unhandled-rejection while we pump
  for (let i = 0; i < 200 && !settled; i++) {
    jest.advanceTimersByTime(10_000);
    for (let j = 0; j < 10; j++) await Promise.resolve();
  }
  return tracked;
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
      .rejects.toThrow(/no trustworthy result for @ksoloviov-smartling: counted 3 PRs but delivered none/);
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

/**
 * The abort banner classifies a skip as a search brownout by pattern-matching
 * the skip reason. Nothing coupled the thrown messages to that matcher, so a
 * reworded raise silently sent the on-call to rotate the PAT during a GitHub
 * outage — which is the exact lead #70 added the attribution to prevent.
 */
describe('thrown search messages stay matched to the brownout attribution', () => {
  const attributable = (reason: string) => {
    const snap = {
      expectedCount: 100,
      thresholds: DEFAULT_THRESHOLDS,
      skipped: Array.from({ length: 6 }, (_, i) => ({
        login: `u${i}`, reason, classification: 'unknown' as const,
      })),
    };
    return formatIntegrityAbortReason(snap);
  };

  it('attributes the contradictory merged-PR raise to a search brownout', () => {
    const msg = attributable(
      'GitHub merged-PR search gave no trustworthy result for @u: counted 3 PRs but delivered none (page 1)',
    );
    expect(msg).toMatch(/GitHub search timeouts/);
    expect(msg).not.toMatch(/auth\/permission/);
  });

  it('attributes the mid-pagination merged-PR raise too', () => {
    const msg = attributable(
      'GitHub merged-PR search gave no trustworthy result for @u: under-delivered 100 of 250 (page 2)',
    );
    expect(msg).toMatch(/GitHub search timeouts/);
  });

  it('attributes the commit-search raises', () => {
    expect(attributable('GitHub commit search gave no trustworthy result for @u (…) after 3 attempts'))
      .toMatch(/GitHub search timeouts/);
    expect(attributable('GitHub commit search under-delivered for @u (…): got 0 of 21'))
      .toMatch(/GitHub search timeouts/);
  });

  it('still blames auth for a genuine permission failure', () => {
    expect(attributable('Validation Failed: the listed users cannot be searched'))
      .toMatch(/auth\/permission/);
  });
});
