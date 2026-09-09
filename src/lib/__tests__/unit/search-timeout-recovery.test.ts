// @octokit/rest is ESM-only; FACTORY-form mock required before the import.
jest.mock('@octokit/rest', () => ({ Octokit: jest.fn().mockImplementation(() => ({})) }));

import { searchUserCommits, splitDateWindow, __setOctokitForTest } from '@/lib/github';

/**
 * GLOOK-50. On 2026-09-08 GitHub's commit search timed out and returned
 * `{total_count: 0, items: [], incomplete_results: true}`. glooker accepted
 * that as "no commits", so oprokopenko-smartling was recorded with 0 commits
 * while holding 43 — alongside 42 merged PRs. Nothing failed, so nothing was
 * skipped and the integrity guard never saw it.
 *
 * The contract: an untrustworthy answer must never become a silent zero. It is
 * retried, then narrowed, and if it still cannot be trusted it RAISES, so the
 * runner turns it into a counted SKIP.
 */

// Pinned: collectCommits calls splitDateWindow with the ambient clock, so the
// midpoint these tests assert on would drift with the calendar and turn red in
// CI months from now, looking like a splitDateWindow regression.
jest.useFakeTimers({ doNotFake: ['nextTick'], now: new Date('2026-09-09T00:00:00Z') });
afterEach(() => { jest.clearAllTimers(); __setOctokitForTest(null); });

/** Drain the 2.5s inter-page and 5s retry sleeps. */
async function drain<T>(p: Promise<T>): Promise<T> {
  for (let i = 0; i < 40; i++) {
    for (let j = 0; j < 5; j++) await Promise.resolve();
    if (jest.getTimerCount() === 0) break;
    jest.advanceTimersByTime(10_000);
  }
  return p;
}

const TIMED_OUT_EMPTY = { total_count: 0, items: [], incomplete_results: true };
const GENUINE_EMPTY   = { total_count: 0, items: [], incomplete_results: false };

function commit(sha: string) {
  return {
    sha,
    repository: { name: 'repo-a' },
    commit: { message: `msg ${sha}`, author: { name: 'A', email: 'a@x' }, committer: { date: '2026-09-01T00:00:00Z' } },
    author: { login: 'devx', avatar_url: '' },
  };
}

/** Octokit stub returning a scripted sequence of responses. */
function scripted(pages: any[]) {
  const calls: string[] = [];
  let i = 0;
  __setOctokitForTest({
    search: {
      commits: async ({ q }: any) => {
        calls.push(q);
        const data = pages[Math.min(i, pages.length - 1)];
        i++;
        return { data };
      },
    },
  });
  return calls;
}

const SINCE = new Date('2026-08-26T00:00:00Z');

describe('splitDateWindow', () => {
  it('halves an open-ended window and keeps the upper bound open', () => {
    const [a, b] = splitDateWindow(new Date('2026-08-26'), null, new Date('2026-09-09'))!;
    expect(a.from.toISOString().slice(0, 10)).toBe('2026-08-26');
    expect(a.to!.toISOString().slice(0, 10)).toBe('2026-09-02');
    expect(b.from.toISOString().slice(0, 10)).toBe('2026-09-03');
    expect(b.to).toBeNull(); // still open — no commit can fall off the end
  });

  it('refuses to split a window too small to help', () => {
    expect(splitDateWindow(new Date('2026-09-08'), new Date('2026-09-09'))).toBeNull();
    expect(splitDateWindow(new Date('2026-09-09'), new Date('2026-09-09'))).toBeNull();
  });
});

describe('a genuine empty result is still trusted', () => {
  it('returns [] without retrying', async () => {
    const calls = scripted([GENUINE_EMPTY]);
    await expect(drain(searchUserCommits('Smartling', 'devx', SINCE)))
      .resolves.toEqual({ hits: [] });
    expect(calls).toHaveLength(1); // no retry, no split
  });
});

describe('a timed-out empty result is not trusted', () => {
  it('retries and uses the good answer when the retry succeeds', async () => {
    const calls = scripted([
      TIMED_OUT_EMPTY,
      { total_count: 2, items: [commit('aaa'), commit('bbb')], incomplete_results: false },
    ]);
    const { hits } = await drain(searchUserCommits('Smartling', 'devx', SINCE));
    expect(hits.map((h) => h.sha)).toEqual(['aaa', 'bbb']);
    expect(calls).toHaveLength(2);
  });

  it('narrows the window after repeated timeouts, and unions the halves', async () => {
    let call = 0;
    const seen: string[] = [];
    __setOctokitForTest({
      search: {
        commits: async ({ q }: any) => {
          seen.push(q);
          call++;
          // Only the ORIGINAL full window times out. Note the second half of a
          // split legitimately keeps an open `>=` bound (so nothing falls off
          // the end), so the stub must key off the date, not the operator.
          if (q.includes('committer-date:>=2026-08-26')) return { data: TIMED_OUT_EMPTY };
          return {
            data: { total_count: 1, items: [commit(`h${call}`)], incomplete_results: false },
          };
        },
      },
    });
    const { hits } = await drain(searchUserCommits('Smartling', 'devx', SINCE));
    // Both halves contributed, and the narrowed queries were actually issued:
    // a closed range for the first half, an open bound at the midpoint for the second.
    expect(hits).toHaveLength(2);
    expect(seen.some((q) => q.includes('committer-date:2026-08-26..2026-09'))).toBe(true);
    expect(seen.some((q) => /committer-date:>=2026-09/.test(q))).toBe(true);
  });

  it('RAISES rather than reporting zero when nothing can be trusted', async () => {
    scripted([TIMED_OUT_EMPTY]);
    // A raise becomes a counted SKIP; a zero would silently drop the developer.
    await expect(drain(searchUserCommits('Smartling', 'devx', SINCE)))
      .rejects.toThrow(/no trustworthy result for @devx/);
  });
});

describe('under-delivery is reconciled against total_count', () => {
  it('KEEPS partial data and reports a shortfall rather than discarding it', async () => {
    // 2 of 5 arrived. Throwing would lose two real commits and add abort
    // pressure — worse than main on both axes. The data is kept; the shortfall
    // becomes an IntegrityError in the runner.
    scripted([{ total_count: 5, items: [commit('a'), commit('b')], incomplete_results: false }]);
    const res = await drain(searchUserCommits('Smartling', 'devx', SINCE));
    expect(res.hits.map((h) => h.sha)).toEqual(['a', 'b']);
    expect(res.shortfall).toMatchObject({ expected: 5, collected: 2 });
    expect(res.shortfall!.detail).toMatch(/got 2 of 5/);
  });

  it('raises when under-delivery leaves nothing at all', async () => {
    // total_count claims 21 and no page ever delivers: retried, narrowed, then
    // raised, because there is no partial data worth keeping.
    scripted([{ total_count: 21, items: [], incomplete_results: false }]);
    await expect(drain(searchUserCommits('Smartling', 'devx', SINCE)))
      .rejects.toThrow(/@devx/);
  });

  it('reconciles ABOVE the 1000 cap instead of switching the check off', async () => {
    // The bug this replaces: `counted <= CAP && hits < counted` disabled the
    // guard entirely once total_count exceeded 1000, so a short page returned
    // silently — for exactly the high-volume authors the cap was added for.
    const full = (page: number) => Array.from({ length: 100 }, (_, i) => commit(`s${page}-${i}`));
    let page = 0;
    __setOctokitForTest({
      search: {
        commits: async () => {
          page++;
          return {
            data: {
              total_count: 1500,
              incomplete_results: false,
              items: page === 1 ? full(1) : full(2).slice(0, 40), // 140 of a capped 1000
            },
          };
        },
      },
    });
    const res = await drain(searchUserCommits('Smartling', 'devx', SINCE));
    expect(res.hits).toHaveLength(140);
    expect(res.shortfall).toMatchObject({ expected: 1000, collected: 140 });
    expect(res.shortfall!.detail).toMatch(/capped from 1500/);
  });
});

describe('a response missing items entirely', () => {
  it('does not TypeError on a shape the trust predicate tolerates', async () => {
    // isSuspectSearchResult({}) is deliberately false, so this reaches the
    // collection loop and must not die iterating an absent array.
    scripted([{ total_count: 0, incomplete_results: false } as any]);
    await expect(drain(searchUserCommits('Smartling', 'devx', SINCE)))
      .resolves.toEqual({ hits: [] });
  });
});

describe('union of split halves', () => {
  it('dedupes a commit that appears in both halves', async () => {
    // The dedup line was previously never exercised: the old stub minted a
    // unique sha per call, so the filter never filtered anything despite the
    // test being named "unions the halves".
    __setOctokitForTest({
      search: {
        commits: async ({ q }: any) => {
          if (q.includes('committer-date:>=2026-08-26')) return { data: TIMED_OUT_EMPTY };
          // Both halves report the SAME commit — a boundary commit visible to
          // both ranged queries.
          return { data: { total_count: 1, items: [commit('shared')], incomplete_results: false } };
        },
      },
    });
    const { hits } = await drain(searchUserCommits('Smartling', 'devx', SINCE));
    expect(hits.map((h) => h.sha)).toEqual(['shared']);
  });
});

describe("GitHub's 1000-result ceiling", () => {
  it('stops at the cap instead of paging past it', async () => {
    // total_count above the cap must not drive pagination past page 10, which
    // returns "Only the first 1000 search results are available".
    const fullPage = Array.from({ length: 100 }, (_, i) => commit(`p${i}`));
    let pages = 0;
    __setOctokitForTest({
      search: {
        commits: async ({ page }: any) => {
          pages++;
          return {
            data: {
              total_count: 5000,
              incomplete_results: false,
              items: fullPage.map((c, i) => commit(`s${page}-${i}`)),
            },
          };
        },
      },
    });
    const { hits } = await drain(searchUserCommits('Smartling', 'devx', SINCE));
    expect(hits).toHaveLength(1000);
    expect(pages).toBe(10); // not 50
  });
});
