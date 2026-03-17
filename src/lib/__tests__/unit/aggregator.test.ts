import { aggregate } from '@/lib/aggregator';
import type { CommitAnalysis } from '@/lib/analyzer';
import { makeCommit, makeAnalysis } from '../fixtures';

describe('aggregate', () => {
  it('returns empty array for empty inputs', () => {
    const result = aggregate([], new Map(), new Map());
    expect(result).toEqual([]);
  });

  it('computes all fields for a single dev with one commit', () => {
    const commit = makeCommit({ sha: 'a1', author: 'alice', additions: 50, deletions: 10, prNumber: 1 });
    const analyses = new Map<string, CommitAnalysis>([
      ['a1', makeAnalysis({ sha: 'a1', complexity: 7, type: 'feature' })],
    ]);
    const prCounts = new Map([['alice', 1]]);

    const [stat] = aggregate([commit], analyses, prCounts);
    expect(stat.githubLogin).toBe('alice');
    expect(stat.totalCommits).toBe(1);
    expect(stat.totalPRs).toBe(1);
    expect(stat.linesAdded).toBe(50);
    expect(stat.linesRemoved).toBe(10);
    expect(stat.avgComplexity).toBe(7);
    expect(stat.prPercentage).toBe(100);
    expect(stat.typeBreakdown).toEqual({ feature: 1 });
    expect(stat.activeRepos).toEqual(['my-repo']);
  });

  it('calculates PR percentage correctly', () => {
    const commits = [
      makeCommit({ sha: 'a1', author: 'bob', prNumber: 1 }),
      makeCommit({ sha: 'a2', author: 'bob', prNumber: 2 }),
      makeCommit({ sha: 'a3', author: 'bob', prNumber: null }),
    ];
    const result = aggregate(commits, new Map(), new Map());
    expect(result[0].prPercentage).toBe(67);
  });

  it('counts AI percentage from confirmed trailer without double-counting', () => {
    const commits = [
      makeCommit({ sha: 'a1', author: 'eve', aiCoAuthored: true }),
      makeCommit({ sha: 'a2', author: 'eve', aiCoAuthored: false }),
      makeCommit({ sha: 'a3', author: 'eve', aiCoAuthored: false }),
    ];
    const analyses = new Map<string, CommitAnalysis>([
      ['a1', makeAnalysis({ sha: 'a1', maybeAi: true })],  // already confirmed, should not double-count
      ['a2', makeAnalysis({ sha: 'a2', maybeAi: true })],  // not confirmed, counts via maybe_ai
      ['a3', makeAnalysis({ sha: 'a3', maybeAi: false })],
    ]);
    const result = aggregate(commits, analyses, new Map());
    // a1 confirmed + a2 maybe_ai = 2/3 = 67%
    expect(result[0].aiPercentage).toBe(67);
  });

  it('sorts multiple devs by descending impactScore', () => {
    const commits = [
      makeCommit({ sha: 'a1', author: 'low', prNumber: null }),
      makeCommit({ sha: 'a2', author: 'high', prNumber: 1 }),
    ];
    const analyses = new Map<string, CommitAnalysis>([
      ['a1', makeAnalysis({ sha: 'a1', complexity: 1 })],
      ['a2', makeAnalysis({ sha: 'a2', complexity: 10 })],
    ]);
    const prCounts = new Map([['high', 5]]);
    const result = aggregate(commits, analyses, prCounts);
    expect(result[0].githubLogin).toBe('high');
    expect(result[1].githubLogin).toBe('low');
    expect(result[0].impactScore).toBeGreaterThan(result[1].impactScore);
  });

  it('verifies impact score formula with known inputs', () => {
    // 20 commits → min(20/20,1)=1 → *3 = 3
    // 10 PRs    → min(10/10,1)=1 → *3 = 3
    // complexity=10 → (10/10)*2.5 = 2.5
    // prPercentage=100 → (100/100)*1.1 = 1.1
    // rawImpact = 3+3+2.5+1.1 = 9.6
    const commits = Array.from({ length: 20 }, (_, i) =>
      makeCommit({ sha: `s${i}`, author: 'dev', prNumber: i + 1, repo: 'r' }),
    );
    const analyses = new Map<string, CommitAnalysis>(
      commits.map((c) => [c.sha, makeAnalysis({ sha: c.sha, complexity: 10 })]),
    );
    const prCounts = new Map([['dev', 10]]);
    const result = aggregate(commits, analyses, prCounts);
    expect(result[0].impactScore).toBe(9.6);
  });

  it('groups type breakdown correctly', () => {
    const commits = [
      makeCommit({ sha: 'a1', author: 'dev' }),
      makeCommit({ sha: 'a2', author: 'dev' }),
      makeCommit({ sha: 'a3', author: 'dev' }),
      makeCommit({ sha: 'a4', author: 'dev' }),
    ];
    const analyses = new Map<string, CommitAnalysis>([
      ['a1', makeAnalysis({ sha: 'a1', type: 'feature' })],
      ['a2', makeAnalysis({ sha: 'a2', type: 'feature' })],
      ['a3', makeAnalysis({ sha: 'a3', type: 'feature' })],
      ['a4', makeAnalysis({ sha: 'a4', type: 'bug' })],
    ]);
    const result = aggregate(commits, analyses, new Map());
    expect(result[0].typeBreakdown).toEqual({ feature: 3, bug: 1 });
  });

  it('deduplicates active repos', () => {
    const commits = [
      makeCommit({ sha: 'a1', author: 'dev', repo: 'api' }),
      makeCommit({ sha: 'a2', author: 'dev', repo: 'api' }),
      makeCommit({ sha: 'a3', author: 'dev', repo: 'web' }),
    ];
    const result = aggregate(commits, new Map(), new Map());
    expect(result[0].activeRepos.sort()).toEqual(['api', 'web']);
  });

  it('handles commit with no analysis entry without crashing', () => {
    const commits = [
      makeCommit({ sha: 'a1', author: 'dev' }),
      makeCommit({ sha: 'a2', author: 'dev' }),
    ];
    const analyses = new Map<string, CommitAnalysis>([
      ['a1', makeAnalysis({ sha: 'a1', complexity: 8 })],
      // a2 has no analysis
    ]);
    const result = aggregate(commits, analyses, new Map());
    expect(result[0].totalCommits).toBe(2);
    // avgComplexity based only on the one analyzed commit
    expect(result[0].avgComplexity).toBe(8);
  });
});
