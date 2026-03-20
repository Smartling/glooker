import { dedupCommitsBySha, aggregateWeekly } from '@/lib/report/timeline';

const commits = [
  { commit_sha: 'a1', github_login: 'alice', committed_at: '2025-01-06T10:00:00Z', lines_added: 10, lines_removed: 5, complexity: 3, type: 'feature', ai_co_authored: false, maybe_ai: false },
  { commit_sha: 'a2', github_login: 'bob', committed_at: '2025-01-07T10:00:00Z', lines_added: 20, lines_removed: 10, complexity: 7, type: 'bugfix', ai_co_authored: true, maybe_ai: false },
  { commit_sha: 'a3', github_login: 'alice', committed_at: '2025-01-13T10:00:00Z', lines_added: 5, lines_removed: 2, complexity: null, type: 'feature', ai_co_authored: false, maybe_ai: true },
];
// Jan 6 is a Monday. a1 and a2 are in week 2025-01-06, a3 is in week 2025-01-13.

describe('dedupCommitsBySha', () => {
  it('keeps first occurrence of each commit_sha, removes duplicates', () => {
    const rows = [
      { commit_sha: 'a1', value: 'first' },
      { commit_sha: 'a2', value: 'only' },
      { commit_sha: 'a1', value: 'duplicate' },
    ];
    const result = dedupCommitsBySha(rows);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ commit_sha: 'a1', value: 'first' });
    expect(result[1]).toEqual({ commit_sha: 'a2', value: 'only' });
  });
});

describe('aggregateWeekly', () => {
  it('groups commits into Monday-aligned ISO weeks', () => {
    const result = aggregateWeekly(commits);
    expect(result).toHaveLength(2);
    expect(result[0].week).toBe('2025-01-06');
    expect(result[0].commits).toBe(2);
    expect(result[1].week).toBe('2025-01-13');
    expect(result[1].commits).toBe(1);
  });

  it('calculates avgComplexity correctly (sum/count, rounded to 1 decimal)', () => {
    const result = aggregateWeekly(commits);
    // Week 2025-01-06: complexity 3 + 7 = 10, count 2, avg = 5.0
    expect(result[0].avgComplexity).toBe(5.0);
    // Week 2025-01-13: complexity is null, count 0, avg = 0
    expect(result[1].avgComplexity).toBe(0);
  });

  it('calculates aiPercent (commits where ai_co_authored OR maybe_ai is truthy)', () => {
    const result = aggregateWeekly(commits);
    // Week 2025-01-06: a2 has ai_co_authored=true, so 1/2 = 50%
    expect(result[0].aiPercent).toBe(50);
    // Week 2025-01-13: a3 has maybe_ai=true, so 1/1 = 100%
    expect(result[1].aiPercent).toBe(100);
  });

  it('with trackDevs: true counts unique activeDevs per week', () => {
    const result = aggregateWeekly(commits, { trackDevs: true });
    // Week 2025-01-06: alice and bob = 2
    expect(result[0].activeDevs).toBe(2);
    // Week 2025-01-13: alice = 1
    expect(result[1].activeDevs).toBe(1);
  });

  it('without trackDevs omits activeDevs field', () => {
    const result = aggregateWeekly(commits);
    expect(result[0].activeDevs).toBeUndefined();
    expect(result[1].activeDevs).toBeUndefined();
  });

  it('sorts output by week ascending', () => {
    const unordered = [commits[2], commits[0], commits[1]];
    const result = aggregateWeekly(unordered);
    expect(result[0].week).toBe('2025-01-06');
    expect(result[1].week).toBe('2025-01-13');
  });

  it('groups commit types into types record', () => {
    const result = aggregateWeekly(commits);
    expect(result[0].types).toEqual({ feature: 1, bugfix: 1 });
    expect(result[1].types).toEqual({ feature: 1 });
  });

  it('skips commits with null/undefined committed_at', () => {
    const withNulls = [
      ...commits,
      { commit_sha: 'x1', github_login: 'carol', committed_at: null, lines_added: 100, lines_removed: 50, complexity: 9, type: 'chore', ai_co_authored: false, maybe_ai: false },
      { commit_sha: 'x2', github_login: 'dave', committed_at: undefined, lines_added: 100, lines_removed: 50, complexity: 9, type: 'chore', ai_co_authored: false, maybe_ai: false },
    ];
    const result = aggregateWeekly(withNulls);
    expect(result).toHaveLength(2);
    expect(result[0].commits).toBe(2);
    expect(result[1].commits).toBe(1);
  });
});
