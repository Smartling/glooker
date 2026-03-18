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

  it('verifies impact score formula with known inputs (max score)', () => {
    // 20 commits → min(20/20,1)=1 → *2 = 2
    // 10 PRs    → min(10/10,1)=1 → *3 = 3
    // complexity=10 → (10/10)*3.5 = 3.5
    // prPercentage=100 → (100/100)*1.1 = 1.1
    // rawImpact = 2+3+3.5+1.1 = 9.6
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

  it('weights complexity higher than volume in impact score', () => {
    // Both devs have same PRs (10) and PR% (100%) to isolate volume vs complexity
    // Dev A: high volume (20 commits), low complexity (2) → volume=2.0, complexity=0.7
    // Dev B: low volume (5 commits), high complexity (9) → volume=0.5, complexity=3.15
    // The complexity delta (2.45) outweighs the volume delta (1.5)
    const commitsA = Array.from({ length: 20 }, (_, i) =>
      makeCommit({ sha: `a${i}`, author: 'volume-dev', prNumber: i + 1, repo: 'r' }),
    );
    const analysesA = new Map<string, CommitAnalysis>(
      commitsA.map((c) => [c.sha, makeAnalysis({ sha: c.sha, complexity: 2 })]),
    );
    const commitsB = Array.from({ length: 5 }, (_, i) =>
      makeCommit({ sha: `b${i}`, author: 'quality-dev', prNumber: i + 1, repo: 'r' }),
    );
    const analysesB = new Map<string, CommitAnalysis>(
      commitsB.map((c) => [c.sha, makeAnalysis({ sha: c.sha, complexity: 9 })]),
    );
    const allCommits = [...commitsA, ...commitsB];
    const allAnalyses = new Map([...analysesA, ...analysesB]);
    // Same PR count for both to isolate volume vs complexity
    const prCounts = new Map([['volume-dev', 10], ['quality-dev', 10]]);
    const result = aggregate(allCommits, allAnalyses, prCounts);
    const volumeDev = result.find(d => d.githubLogin === 'volume-dev')!;
    const qualityDev = result.find(d => d.githubLogin === 'quality-dev')!;
    // Quality dev should score higher: complexity advantage (2.45) > volume advantage (1.5)
    expect(qualityDev.impactScore).toBeGreaterThan(volumeDev.impactScore);
  });

  it('volume component caps at 20 commits', () => {
    // 40 commits should score same as 20 commits (volume caps at min(n/20,1))
    const make = (n: number, prefix: string) => {
      const commits = Array.from({ length: n }, (_, i) =>
        makeCommit({ sha: `${prefix}${i}`, author: `dev-${prefix}`, prNumber: null, repo: 'r' }),
      );
      const analyses = new Map<string, CommitAnalysis>(
        commits.map((c) => [c.sha, makeAnalysis({ sha: c.sha, complexity: 5 })]),
      );
      return { commits, analyses };
    };
    const a = make(20, 'a');
    const b = make(40, 'b');
    const allCommits = [...a.commits, ...b.commits];
    const allAnalyses = new Map([...a.analyses, ...b.analyses]);
    const result = aggregate(allCommits, allAnalyses, new Map());
    // Both should have same impact (volume capped, same complexity, same PR%)
    expect(result.find(d => d.githubLogin === 'dev-a')!.impactScore)
      .toBe(result.find(d => d.githubLogin === 'dev-b')!.impactScore);
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
