import { aggregateInflight, type Inflight, type TeamPulseData } from '@/lib/team-pulse/data';
import { buildTeamPulsePrompt } from '@/lib/team-pulse/prompt';

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

function makeData(inflight: Inflight): TeamPulseData {
  return {
    teamName: 'X',
    members: new Map(),
    currentDays: ['2026-05-19', '2026-05-20'],
    priorDays:   ['2026-05-15', '2026-05-16'],
    teamAvgCommits: 0, teamAvgPrs: 0,
    activeCount: 0, totalCount: 0,
    trendingPct: 0, trendDirection: 'stable',
    inflight,
  };
}

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

  it('counts unmerged branches (distinct repo+branch) and total commits', () => {
    const commits: CommitRow[] = [
      { github_login: 'alice', repo: 'frontend', branch: 'feature/x' },
      { github_login: 'alice', repo: 'frontend', branch: 'feature/x' },   // dup branch → 1 slot
      { github_login: 'alice', repo: 'frontend', branch: 'feature/y' },
      { github_login: 'bob',   repo: 'api',      branch: 'fix/z' },
      { github_login: 'bob',   repo: 'api',      branch: null },          // branchless commits in same repo dedupe
      { github_login: 'bob',   repo: 'api',      branch: null },          // ↑ still one branch slot, not two
    ];
    const out = aggregateInflight([], commits, NOW);
    // 6 raw commits across 4 distinct (repo, branch) keys:
    //   (frontend, feature/x), (frontend, feature/y), (api, fix/z), (api, '')
    expect(out.unmerged_branches.total_commits).toBe(6);
    expect(out.unmerged_branches.total_branches).toBe(4);
  });
});

describe('buildTeamPulsePrompt — inflight', () => {
  it('renders an empty block (literal "(none)") when in-flight is empty', () => {
    const json = JSON.parse(buildTeamPulsePrompt(makeData(aggregateInflight([], [], NOW))));
    expect(json.INFLIGHT_BLOCK).toBe('IN-FLIGHT WORK (snapshot at report time): (none)');
  });

  it('renders the structured block when in-flight is populated', () => {
    const inflight: Inflight = {
      open_prs: {
        total: 6, draft: 2, ready: 4,
        by_author: [{ login: 'alice', count: 3 }, { login: 'bob', count: 2 }],
        by_repo:   [{ repo: 'frontend', count: 4 }, { repo: 'api', count: 2 }],
        oldest_days: 7, lines_added: 250, lines_removed: 40,
      },
      unmerged_branches: { total_branches: 5, total_commits: 18 },
    };
    const json = JSON.parse(buildTeamPulsePrompt(makeData(inflight)));
    expect(json.INFLIGHT_BLOCK).toBe(
      'IN-FLIGHT WORK (snapshot at report time):\n' +
      '- Open PRs: 6 (2 draft, 4 ready); oldest 7d; +250/-40 lines\n' +
      '- Unmerged branches: 5 branches, 18 commits\n' +
      '- In-flight by repo:   frontend (4), api (2)\n' +
      '- In-flight by author: @alice (3), @bob (2)'
    );
  });
});
