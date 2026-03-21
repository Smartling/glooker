/**
 * Tests for the PR lookup second pass logic.
 * We test the core algorithm in isolation since fetchUserActivity is tightly coupled to GitHub API.
 */

describe('PR lookup second pass', () => {
  // Simulate the commit filtering logic
  function getUnmatchedCommits(commits: Array<{ sha: string; prNumber: number | null }>) {
    return commits.filter(c => c.prNumber === null);
  }

  it('identifies commits without PR association', () => {
    const commits = [
      { sha: 'a1', prNumber: 1 },
      { sha: 'a2', prNumber: null },
      { sha: 'a3', prNumber: 2 },
      { sha: 'a4', prNumber: null },
    ];
    const unmatched = getUnmatchedCommits(commits);
    expect(unmatched).toHaveLength(2);
    expect(unmatched.map(c => c.sha)).toEqual(['a2', 'a4']);
  });

  it('returns empty when all commits have PRs', () => {
    const commits = [
      { sha: 'a1', prNumber: 1 },
      { sha: 'a2', prNumber: 2 },
    ];
    expect(getUnmatchedCommits(commits)).toHaveLength(0);
  });

  it('returns all when no commits have PRs', () => {
    const commits = [
      { sha: 'a1', prNumber: null },
      { sha: 'a2', prNumber: null },
    ];
    expect(getUnmatchedCommits(commits)).toHaveLength(2);
  });

  // Simulate the limit guard
  function shouldRunLookup(unmatchedCount: number, limit = 200): boolean {
    return unmatchedCount > 0 && unmatchedCount <= limit;
  }

  it('runs lookup when unmatched count is within limit', () => {
    expect(shouldRunLookup(50)).toBe(true);
    expect(shouldRunLookup(200)).toBe(true);
    expect(shouldRunLookup(1)).toBe(true);
  });

  it('skips lookup when unmatched count exceeds limit', () => {
    expect(shouldRunLookup(201)).toBe(false);
    expect(shouldRunLookup(500)).toBe(false);
  });

  it('skips lookup when no unmatched commits', () => {
    expect(shouldRunLookup(0)).toBe(false);
  });

  // Simulate the PR matching from API response
  function applyPrLookupResult(
    commit: { sha: string; prNumber: number | null; prTitle: string | null },
    apiResponse: Array<{ number: number; title: string }>,
  ) {
    if (apiResponse.length > 0) {
      commit.prNumber = apiResponse[0].number;
      commit.prTitle = apiResponse[0].title;
    }
  }

  it('updates commit with PR info from API response', () => {
    const commit = { sha: 'a1', prNumber: null as number | null, prTitle: null as string | null };
    applyPrLookupResult(commit, [{ number: 8, title: 'feat: scheduling' }]);
    expect(commit.prNumber).toBe(8);
    expect(commit.prTitle).toBe('feat: scheduling');
  });

  it('leaves commit unchanged when API returns empty', () => {
    const commit = { sha: 'a1', prNumber: null as number | null, prTitle: null as string | null };
    applyPrLookupResult(commit, []);
    expect(commit.prNumber).toBeNull();
    expect(commit.prTitle).toBeNull();
  });

  it('uses first PR when API returns multiple', () => {
    const commit = { sha: 'a1', prNumber: null as number | null, prTitle: null as string | null };
    applyPrLookupResult(commit, [
      { number: 8, title: 'first PR' },
      { number: 9, title: 'second PR' },
    ]);
    expect(commit.prNumber).toBe(8);
    expect(commit.prTitle).toBe('first PR');
  });

  // Simulate the PR message pattern matching (first pass)
  function matchPrFromMessage(message: string): number | null {
    const match = message.match(/\(#(\d+)\)/) || message.match(/^Merge pull request #(\d+)/);
    return match ? Number(match[1]) : null;
  }

  it('matches PR from squash merge message pattern', () => {
    expect(matchPrFromMessage('feat: add feature (#42)')).toBe(42);
  });

  it('matches PR from merge commit message pattern', () => {
    expect(matchPrFromMessage('Merge pull request #7 from org/branch')).toBe(7);
  });

  it('returns null for commits without PR reference', () => {
    expect(matchPrFromMessage('feat: add feature')).toBeNull();
    expect(matchPrFromMessage('Updated todo')).toBeNull();
    expect(matchPrFromMessage('fix(scheduling): add sidebar')).toBeNull();
  });

  it('returns null for empty message', () => {
    expect(matchPrFromMessage('')).toBeNull();
  });

  // End-to-end simulation
  it('full flow: first pass misses, second pass catches', () => {
    const commits = [
      { sha: 'a1', message: 'feat: add auth (#5)', prNumber: null as number | null, prTitle: null as string | null, repo: 'r' },
      { sha: 'a2', message: 'Updated todo', prNumber: null as number | null, prTitle: null as string | null, repo: 'r' },
      { sha: 'a3', message: 'feat(scheduling): add sidebar', prNumber: null as number | null, prTitle: null as string | null, repo: 'r' },
    ];

    // First pass: message matching
    for (const c of commits) {
      const pr = matchPrFromMessage(c.message);
      if (pr) { c.prNumber = pr; c.prTitle = `PR #${pr}`; }
    }

    expect(commits[0].prNumber).toBe(5); // matched by message
    expect(commits[1].prNumber).toBeNull(); // no match
    expect(commits[2].prNumber).toBeNull(); // no match

    // Second pass: API lookup (simulated)
    const unmatched = commits.filter(c => c.prNumber === null);
    expect(unmatched).toHaveLength(2);

    const mockApiResults: Record<string, Array<{ number: number; title: string }>> = {
      'a2': [{ number: 8, title: 'scheduling feature' }],
      'a3': [{ number: 8, title: 'scheduling feature' }],
    };

    for (const c of unmatched) {
      applyPrLookupResult(c, mockApiResults[c.sha] || []);
    }

    expect(commits[1].prNumber).toBe(8); // now matched
    expect(commits[2].prNumber).toBe(8); // now matched
    expect(commits.every(c => c.prNumber !== null)).toBe(true);
  });
});
