import { aggregateInflight, type Inflight } from '@/lib/team-pulse/data';

interface PrRow {
  github_login: string;
  repo: string;
  is_draft: 0 | 1 | boolean | null;
  pr_additions: number | null;
  pr_deletions: number | null;
  pr_updated_at: string | Date | null;
}

interface CommitRow {
  github_login: string;
  repo: string;
  branch: string | null;
}

const NOW = new Date('2026-05-20T12:00:00Z');

describe('aggregateInflight', () => {
  it('returns the empty struct for empty inputs', () => {
    const out = aggregateInflight([], [], NOW);
    expect(out.open_prs.total).toBe(0);
    expect(out.open_prs.draft).toBe(0);
    expect(out.open_prs.ready).toBe(0);
    expect(out.open_prs.by_author).toEqual([]);
    expect(out.open_prs.by_repo).toEqual([]);
    expect(out.open_prs.oldest_days).toBe(0);
    expect(out.open_prs.lines_added).toBe(0);
    expect(out.open_prs.lines_removed).toBe(0);
    expect(out.unmerged_branches.total_branches).toBe(0);
    expect(out.unmerged_branches.total_commits).toBe(0);
  });

  it('counts open PRs total / draft / ready', () => {
    const prs: PrRow[] = [
      { github_login: 'alice', repo: 'frontend', is_draft: false, pr_additions: 10, pr_deletions: 2, pr_updated_at: '2026-05-19T00:00:00Z' },
      { github_login: 'bob',   repo: 'frontend', is_draft: true,  pr_additions: 5,  pr_deletions: 1, pr_updated_at: '2026-05-18T00:00:00Z' },
      { github_login: 'alice', repo: 'api',      is_draft: false, pr_additions: 3,  pr_deletions: 0, pr_updated_at: '2026-05-19T00:00:00Z' },
    ];
    const out = aggregateInflight(prs, [], NOW);
    expect(out.open_prs.total).toBe(3);
    expect(out.open_prs.draft).toBe(1);
    expect(out.open_prs.ready).toBe(2);
    expect(out.open_prs.lines_added).toBe(18);
    expect(out.open_prs.lines_removed).toBe(3);
  });

  it('computes by_author top 5 descending, alphabetical tie-break', () => {
    const prs: PrRow[] = [
      { github_login: 'a', repo: 'r1', is_draft: false, pr_additions: 0, pr_deletions: 0, pr_updated_at: null },
      { github_login: 'a', repo: 'r1', is_draft: false, pr_additions: 0, pr_deletions: 0, pr_updated_at: null },
      { github_login: 'b', repo: 'r1', is_draft: false, pr_additions: 0, pr_deletions: 0, pr_updated_at: null },
      { github_login: 'c', repo: 'r1', is_draft: false, pr_additions: 0, pr_deletions: 0, pr_updated_at: null },
      { github_login: 'd', repo: 'r1', is_draft: false, pr_additions: 0, pr_deletions: 0, pr_updated_at: null },
      { github_login: 'e', repo: 'r1', is_draft: false, pr_additions: 0, pr_deletions: 0, pr_updated_at: null },
      { github_login: 'f', repo: 'r1', is_draft: false, pr_additions: 0, pr_deletions: 0, pr_updated_at: null },
    ];
    const out = aggregateInflight(prs, [], NOW);
    expect(out.open_prs.by_author).toEqual([
      { login: 'a', count: 2 },
      { login: 'b', count: 1 },
      { login: 'c', count: 1 },
      { login: 'd', count: 1 },
      { login: 'e', count: 1 },
    ]);
  });

  it('computes by_repo top 3 descending', () => {
    const prs: PrRow[] = [
      { github_login: 'a', repo: 'r3', is_draft: false, pr_additions: 0, pr_deletions: 0, pr_updated_at: null },
      { github_login: 'a', repo: 'r3', is_draft: false, pr_additions: 0, pr_deletions: 0, pr_updated_at: null },
      { github_login: 'a', repo: 'r3', is_draft: false, pr_additions: 0, pr_deletions: 0, pr_updated_at: null },
      { github_login: 'a', repo: 'r2', is_draft: false, pr_additions: 0, pr_deletions: 0, pr_updated_at: null },
      { github_login: 'a', repo: 'r2', is_draft: false, pr_additions: 0, pr_deletions: 0, pr_updated_at: null },
      { github_login: 'a', repo: 'r1', is_draft: false, pr_additions: 0, pr_deletions: 0, pr_updated_at: null },
      { github_login: 'a', repo: 'r4', is_draft: false, pr_additions: 0, pr_deletions: 0, pr_updated_at: null },
    ];
    const out = aggregateInflight(prs, [], NOW);
    expect(out.open_prs.by_repo).toEqual([
      { repo: 'r3', count: 3 },
      { repo: 'r2', count: 2 },
      { repo: 'r1', count: 1 },
    ]);
  });

  it('computes oldest_days as floor((now - max-age updated_at) / day)', () => {
    const prs: PrRow[] = [
      { github_login: 'a', repo: 'r1', is_draft: false, pr_additions: 0, pr_deletions: 0, pr_updated_at: '2026-05-15T12:00:00Z' },
      { github_login: 'a', repo: 'r1', is_draft: false, pr_additions: 0, pr_deletions: 0, pr_updated_at: '2026-05-18T12:00:00Z' },
    ];
    const out = aggregateInflight(prs, [], NOW);
    expect(out.open_prs.oldest_days).toBe(5);
  });

  it('counts unmerged branches and commits', () => {
    const commits: CommitRow[] = [
      { github_login: 'alice', repo: 'frontend', branch: 'feature/x' },
      { github_login: 'alice', repo: 'frontend', branch: 'feature/x' },
      { github_login: 'alice', repo: 'frontend', branch: 'feature/y' },
      { github_login: 'bob',   repo: 'api',      branch: 'fix/z' },
      { github_login: 'bob',   repo: 'api',      branch: null },
    ];
    const out = aggregateInflight([], commits, NOW);
    expect(out.unmerged_branches.total_commits).toBe(5);
    expect(out.unmerged_branches.total_branches).toBe(4);
  });
});
