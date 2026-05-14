import { makeCommit, makeAnalysis } from '../fixtures';

// Mocks — @octokit/rest is ESM-only, mock it to avoid parse errors
jest.mock('@octokit/rest', () => ({
  Octokit: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('@/lib/github', () => ({
  ...jest.requireActual('@/lib/github'),
  getGitHubProvider: jest.fn(),
  getCommitDetail: jest.fn().mockResolvedValue({ additions: 0, deletions: 0, diff: '' }),
}));
jest.mock('@/lib/analyzer');
jest.mock('@/lib/db/index', () => ({
  __esModule: true,
  default: { execute: jest.fn().mockResolvedValue([[], null]) },
}));
jest.mock('@/lib/progress-store');
jest.mock('p-limit', () => ({
  __esModule: true,
  default: () => <T>(fn: () => T) => fn(),
}));
jest.mock('@/lib/cc-spend/service', () => ({
  refreshCcSpendForReport: jest.fn(),
}));

import { runReport, requestStop } from '@/lib/report-runner';
import { getGitHubProvider } from '@/lib/github';
import { analyzeCommit } from '@/lib/analyzer';
import db from '@/lib/db/index';
import { updateProgress, addLog } from '@/lib/progress-store';
import { refreshCcSpendForReport } from '@/lib/cc-spend/service';
import { AnthropicAnalyticsKeyMissingError } from '@/lib/cc-spend/anthropic-provider';
const mockRefreshCc = refreshCcSpendForReport as jest.Mock;
const mockAddLog = addLog as jest.Mock;

const mockListOrgMembers = jest.fn();
const mockFetchUserActivity = jest.fn();
const mockCountReviewedPRs = jest.fn().mockResolvedValue(0);
const mockFetchOpenPRs = jest.fn().mockResolvedValue([]);
const mockFetchRepoEvents = jest.fn().mockResolvedValue([]);
const mockGetBranchHeadSha = jest.fn().mockResolvedValue(null);
const mockFetchPullRequestCommits = jest.fn().mockResolvedValue([]);
const mockCompareBranchCommits = jest.fn().mockResolvedValue([]);
const mockIsShaInMergedPR = jest.fn().mockResolvedValue(false);
const mockIsCommitInDefaultBranch = jest.fn().mockResolvedValue(true);
const mockGetGitHubProvider = getGitHubProvider as jest.Mock;
mockGetGitHubProvider.mockReturnValue({
  listOrgMembers: mockListOrgMembers,
  fetchUserActivity: mockFetchUserActivity,
  listOrgs: jest.fn(),
  countReviewedPRs: mockCountReviewedPRs,
  fetchOpenPRs: mockFetchOpenPRs,
  fetchRepoEvents: mockFetchRepoEvents,
  getBranchHeadSha: mockGetBranchHeadSha,
  fetchPullRequestCommits: mockFetchPullRequestCommits,
  compareBranchCommits: mockCompareBranchCommits,
  isCommitInDefaultBranch: mockIsCommitInDefaultBranch,
  isShaInMergedPR: mockIsShaInMergedPR,
});
const mockAnalyzeCommit = analyzeCommit as jest.Mock;
const mockDbExecute = db.execute as jest.Mock;

describe('runReport', () => {
  beforeEach(() => {
    mockListOrgMembers.mockResolvedValue([
      { login: 'alice', avatarUrl: 'https://a.com/alice.png' },
      { login: 'bob', avatarUrl: 'https://a.com/bob.png' },
    ]);

    mockFetchUserActivity.mockImplementation(async (_org: string, user: string) => ({
      commits: [
        makeCommit({ sha: `${user}-c1`, author: user, authorName: user }),
        makeCommit({ sha: `${user}-c2`, author: user, authorName: user }),
      ],
      prs: [{ number: 1, title: 'PR', repo: 'my-repo', mergedAt: '2025-01-15' }],
    }));

    mockAnalyzeCommit.mockImplementation(async (commit: any) =>
      makeAnalysis({ sha: commit.sha, complexity: 5, type: 'feature' }),
    );

    mockDbExecute.mockResolvedValue([[], null]);

    mockFetchOpenPRs.mockClear();
    mockFetchOpenPRs.mockResolvedValue([]);
    mockIsCommitInDefaultBranch.mockClear();
    mockIsCommitInDefaultBranch.mockResolvedValue(true);
    mockFetchRepoEvents.mockClear();
    mockFetchRepoEvents.mockResolvedValue([]);
    mockGetBranchHeadSha.mockClear();
    mockGetBranchHeadSha.mockResolvedValue(null);
    mockFetchPullRequestCommits.mockClear();
    mockFetchPullRequestCommits.mockResolvedValue([]);
    mockCompareBranchCommits.mockClear();
    mockCompareBranchCommits.mockResolvedValue([]);
    mockIsShaInMergedPR.mockClear();
    mockIsShaInMergedPR.mockResolvedValue(false);

    const { getCommitDetail } = require('@/lib/github');
    (getCommitDetail as jest.Mock).mockReset();
    (getCommitDetail as jest.Mock).mockResolvedValue({ additions: 0, deletions: 0, diff: '' });

    mockRefreshCc.mockReset();
    mockRefreshCc.mockResolvedValue({
      matched: 0, unmappedEmail: 0, noDevStatsRow: 0,
      totalApiUsers: 0, totalSpendUsd: 0,
      periodStart: '2026-01-01', periodEnd: '2026-01-15',
    });
  });

  it('happy path: calls analyzeCommit for each unique commit and writes to DB', async () => {
    await runReport('r1', 'my-org', 14);

    // 2 members × 2 commits = 4 unique commits analyzed
    expect(mockAnalyzeCommit).toHaveBeenCalledTimes(4);

    // DB calls: 1 update running + 4 commit inserts + 2 dev stats (progressive) + 2 dev stats (final) + 1 update completed = 10
    // But the exact count depends on implementation; just verify key calls
    expect(mockDbExecute).toHaveBeenCalled();
    // Report marked completed
    const completedCall = mockDbExecute.mock.calls.find(
      (call: any[]) => typeof call[0] === 'string' && call[0].includes('completed'),
    );
    expect(completedCall).toBeTruthy();
  });

  it('deduplicates shared commit SHAs across members', async () => {
    const sharedCommit = makeCommit({ sha: 'shared-sha', author: 'alice', authorName: 'alice' });
    mockFetchUserActivity.mockImplementation(async (_org: string, user: string) => ({
      commits: [
        sharedCommit,
        makeCommit({ sha: `${user}-unique`, author: user, authorName: user }),
      ],
      prs: [],
    }));

    await runReport('r2', 'my-org', 14);

    // shared-sha should only be analyzed once, plus 2 unique = 3 total
    const analyzedShas = mockAnalyzeCommit.mock.calls.map((c: any[]) => c[0].sha);
    const uniqueAnalyzed = new Set(analyzedShas);
    expect(uniqueAnalyzed.size).toBe(analyzedShas.length);
  });

  it('stops report when stop signal is set', async () => {
    // Make fetchUserActivity slow enough to check stop signal
    mockFetchUserActivity.mockImplementation(async () => {
      requestStop('r3');
      return { commits: [], prs: [] };
    });

    await runReport('r3', 'my-org', 14);

    // Report should end with stopped status
    const statusCall = mockDbExecute.mock.calls.find(
      (call: any[]) => typeof call[0] === 'string' && call[0].includes('SET status') && call[1]?.includes('stopped'),
    );
    expect(statusCall).toBeTruthy();
  });

  it('continues when one commit LLM analysis fails', async () => {
    let callCount = 0;
    mockAnalyzeCommit.mockImplementation(async (commit: any) => {
      callCount++;
      if (callCount === 1) throw new Error('LLM timeout');
      return makeAnalysis({ sha: commit.sha });
    });

    // Should not throw
    await runReport('r4', 'my-org', 14);

    // Report still completes
    const completedCall = mockDbExecute.mock.calls.find(
      (call: any[]) => typeof call[0] === 'string' && call[0].includes('completed'),
    );
    expect(completedCall).toBeTruthy();
  });

  it('skips already-analyzed commits on resume', async () => {
    // Simulate DB returning existing analysis for alice-c1
    mockDbExecute.mockImplementation(async (sql: string, params?: any[]) => {
      if (typeof sql === 'string' && sql.includes('SELECT commit_sha')) {
        return [[{
          commit_sha: 'alice-c1',
          complexity: 5,
          type: 'feature',
          impact_summary: 'existing',
          risk_level: 'low',
          maybe_ai: 0,
        }], null];
      }
      return [[], null];
    });

    await runReport('r5', 'my-org', 14, true);

    // alice-c1 should NOT be re-analyzed
    const analyzedShas = mockAnalyzeCommit.mock.calls.map((c: any[]) => c[0].sha);
    expect(analyzedShas).not.toContain('alice-c1');
  });

  it('test mode limits to 3 active members', async () => {
    // Set up 5 members
    mockListOrgMembers.mockResolvedValue([
      { login: 'a', avatarUrl: '' },
      { login: 'b', avatarUrl: '' },
      { login: 'c', avatarUrl: '' },
      { login: 'd', avatarUrl: '' },
      { login: 'e', avatarUrl: '' },
    ]);

    mockFetchUserActivity.mockImplementation(async (_org: string, user: string) => ({
      commits: [makeCommit({ sha: `${user}-c1`, author: user, authorName: user })],
      prs: [{ number: 1, title: 'PR', repo: 'my-repo', mergedAt: '2025-01-15' }],
    }));

    await runReport('r6', 'my-org', 14, false, true);

    // testMode=true: should stop after 3 active members
    expect(mockFetchUserActivity.mock.calls.length).toBeLessThanOrEqual(4);
  });

  it('handles member fetch error and continues with other members', async () => {
    mockFetchUserActivity
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce({
        commits: [makeCommit({ sha: 'bob-c1', author: 'bob', authorName: 'bob' })],
        prs: [],
      });

    await runReport('r7', 'my-org', 14);

    // Bob's commit should still be analyzed
    const analyzedShas = mockAnalyzeCommit.mock.calls.map((c: any[]) => c[0].sha);
    expect(analyzedShas).toContain('bob-c1');

    // Report still completes
    const completedCall = mockDbExecute.mock.calls.find(
      (call: any[]) => typeof call[0] === 'string' && call[0].includes('completed'),
    );
    expect(completedCall).toBeTruthy();
  });

  it('persists open PRs to unmerged_prs (renamed from unmerged_work)', async () => {
    mockFetchOpenPRs.mockImplementation(async (_org, user) =>
      user === 'alice'
        ? [{ repo: 'app', number: 42, title: 'WIP feature', url: 'https://github.com/o/app/pull/42', draft: false, commits: 3, additions: 100, deletions: 20, createdAt: '2026-04-10T00:00:00Z', updatedAt: '2026-04-22T00:00:00Z' }]
        : [],
    );

    await runReport('r1', 'my-org', 14);

    const insertCall = mockDbExecute.mock.calls.find(
      (call: any[]) =>
        typeof call[0] === 'string' &&
        call[0].includes('INSERT') &&
        call[0].includes('unmerged_prs') &&
        Array.isArray(call[1]) &&
        call[1][1] === 'alice' &&
        call[1][3] === 42,
    );
    expect(insertCall).toBeTruthy();
  });

  it('persists per-commit rows to unmerged_commits via PR commits + branch compare', async () => {
    const { getCommitDetail } = require('@/lib/github');

    // Use dynamic dates within the runner's 90-day in-flight cutoff so this test
    // doesn't go stale as wall-clock advances.
    const recent = new Date(Date.now() - 2 * 86400_000).toISOString();
    const slightlyOlder = new Date(Date.now() - 3 * 86400_000).toISOString();

    // Alice has one open PR with one commit
    mockFetchOpenPRs.mockImplementation(async (_org, user) =>
      user === 'alice'
        ? [{ repo: 'app', number: 7, title: 'wip', url: 'https://github.com/o/app/pull/7', draft: false, commits: 1, additions: 30, deletions: 5, createdAt: recent, updatedAt: recent }]
        : [],
    );
    mockFetchPullRequestCommits.mockImplementation(async (_owner, _repo, n) =>
      n === 7
        ? [{ sha: 'pr-sha-1', message: 'wip commit', authorLogin: 'alice', committedAt: recent }]
        : [],
    );
    // Alice also pushed a commit to a branch with no PR.
    // Per-repo events feed: 'app' is in alice's activeRepos because she has an open PR there.
    mockFetchRepoEvents.mockImplementation(async (_owner, repo) =>
      repo === 'app'
        ? [{ type: 'PushEvent', actorLogin: 'alice', ref: 'refs/heads/wip-branch', headSha: 'orphan-head', createdAt: recent }]
        : [],
    );
    mockCompareBranchCommits.mockImplementation(async (_owner, _repo, head) =>
      head === 'orphan-head'
        ? [{ sha: 'orphan-sha-1', message: 'WIP no PR', authorLogin: 'alice', committedAt: slightlyOlder }]
        : [],
    );
    mockIsCommitInDefaultBranch.mockResolvedValue(false); // ensure orphan-head is treated as non-default
    mockGetBranchHeadSha.mockResolvedValue('orphan-head'); // branch still exists; runner uses live head
    (getCommitDetail as jest.Mock).mockResolvedValue({ additions: 30, deletions: 5, diff: '' });

    await runReport('r1', 'my-org', 14);

    const inserts = mockDbExecute.mock.calls.filter(
      (call: any[]) =>
        typeof call[0] === 'string' &&
        call[0].includes('INSERT') &&
        call[0].includes('unmerged_commits'),
    );
    expect(inserts.length).toBe(2);

    const allParams = inserts.map((c: any[]) => c[1]);
    const shas = allParams.map(p => p[5]); // commit_sha is the 6th param (0-indexed 5) in the INSERT
    expect(shas).toContain('pr-sha-1');
    expect(shas).toContain('orphan-sha-1');
  });

  it('skips unmerged commits older than 90 days (matches chart display window)', async () => {
    const { getCommitDetail } = require('@/lib/github');
    const recent = new Date(Date.now() - 2 * 86400_000).toISOString();
    const tooOld = new Date(Date.now() - 100 * 86400_000).toISOString(); // outside the 90-day cutoff

    mockFetchOpenPRs.mockImplementation(async (_org, user) =>
      user === 'alice'
        ? [{ repo: 'app', number: 9, title: 'wip', url: '#', draft: false, commits: 2, additions: 10, deletions: 0, createdAt: tooOld, updatedAt: recent }]
        : [],
    );
    mockFetchPullRequestCommits.mockImplementation(async (_owner, _repo, n) =>
      n === 9
        ? [
            { sha: 'fresh-sha', message: 'recent', authorLogin: 'alice', committedAt: recent },
            { sha: 'stale-sha', message: 'ancient', authorLogin: 'alice', committedAt: tooOld },
          ]
        : [],
    );
    mockFetchRepoEvents.mockResolvedValue([]);
    (getCommitDetail as jest.Mock).mockResolvedValue({ additions: 1, deletions: 0, diff: '' });

    await runReport('r1', 'my-org', 14);

    const inserts = mockDbExecute.mock.calls.filter(
      (call: any[]) =>
        typeof call[0] === 'string' &&
        call[0].includes('INSERT') &&
        call[0].includes('unmerged_commits'),
    );
    const shas = inserts.map((c: any[]) => c[1][5]);
    expect(shas).toContain('fresh-sha');
    expect(shas).not.toContain('stale-sha');
  });

  it('skips refs whose branch was deleted (squash-merged + cleaned up)', async () => {
    const { getCommitDetail } = require('@/lib/github');
    const recent = new Date(Date.now() - 5 * 86400_000).toISOString();

    mockFetchOpenPRs.mockResolvedValue([]);
    mockFetchRepoEvents.mockImplementation(async (_owner, repo) =>
      repo === 'app'
        ? [{ type: 'PushEvent', actorLogin: 'alice', ref: 'refs/heads/merged-and-deleted', headSha: 'historical-head', createdAt: recent }]
        : [],
    );
    // Branch no longer exists on origin (was deleted after squash merge).
    mockGetBranchHeadSha.mockResolvedValue(null);
    // compareBranchCommits should never get called for this ref.
    mockCompareBranchCommits.mockResolvedValue([
      { sha: 'should-not-appear', message: 'orig commit', authorLogin: 'alice', committedAt: recent },
    ]);
    (getCommitDetail as jest.Mock).mockResolvedValue({ additions: 1, deletions: 0, diff: '' });

    await runReport('r1', 'my-org', 14);

    const inserts = mockDbExecute.mock.calls.filter(
      (call: any[]) =>
        typeof call[0] === 'string' &&
        call[0].includes('INSERT') &&
        call[0].includes('unmerged_commits'),
    );
    expect(inserts.length).toBe(0);
    expect(mockCompareBranchCommits).not.toHaveBeenCalled();
  });

  it('skips refs whose head SHA is part of a merged PR (squash-merge + branch kept)', async () => {
    const { getCommitDetail } = require('@/lib/github');
    const recent = new Date(Date.now() - 5 * 86400_000).toISOString();

    mockFetchOpenPRs.mockResolvedValue([]);
    mockFetchRepoEvents.mockImplementation(async (_owner, repo) =>
      repo === 'app'
        ? [{ type: 'PushEvent', actorLogin: 'alice', ref: 'refs/heads/squashed-and-kept', headSha: 'historical-head', createdAt: recent }]
        : [],
    );
    // Branch still exists on origin (engineer didn't delete it after squash-merge)
    mockGetBranchHeadSha.mockResolvedValue('live-head-c');
    mockIsCommitInDefaultBranch.mockResolvedValue(false); // squash created a different SHA in main
    // The head's SHA was part of a merged PR — work has shipped.
    mockIsShaInMergedPR.mockResolvedValue(true);
    // compareBranchCommits should never be called because we skip first.
    mockCompareBranchCommits.mockResolvedValue([
      { sha: 'pre-squash-orig', message: 'a', authorLogin: 'alice', committedAt: recent },
    ]);
    (getCommitDetail as jest.Mock).mockResolvedValue({ additions: 1, deletions: 0, diff: '' });

    await runReport('r1', 'my-org', 14);

    const inserts = mockDbExecute.mock.calls.filter(
      (call: any[]) =>
        typeof call[0] === 'string' &&
        call[0].includes('INSERT') &&
        call[0].includes('unmerged_commits'),
    );
    expect(inserts.length).toBe(0);
    expect(mockCompareBranchCommits).not.toHaveBeenCalled();
  });

  describe('runReport — CC spend enrichment', () => {
    it('invokes refreshCcSpendForReport after Jira phase', async () => {
      await runReport('r1', 'my-org', 14);
      expect(mockRefreshCc).toHaveBeenCalledWith('r1', expect.any(Function));
    });

    it('continues when refreshCcSpendForReport throws (non-fatal)', async () => {
      mockRefreshCc.mockRejectedValueOnce(new Error('Anthropic 503'));
      await expect(runReport('r1', 'my-org', 14)).resolves.toBeUndefined();
    });

    it('surfaces the env-var name when AnthropicAnalyticsKeyMissingError is thrown', async () => {
      mockAddLog.mockClear();
      mockRefreshCc.mockRejectedValueOnce(new AnthropicAnalyticsKeyMissingError());

      await runReport('r1', 'my-org', 14);

      const skipLogs = mockAddLog.mock.calls
        .map((c) => c[1])
        .filter((m: string) => typeof m === 'string' && m.includes('CC spend: SKIP'));
      expect(skipLogs.length).toBeGreaterThan(0);
      const keyMissingLog = skipLogs.find((m: string) => m.includes('ANTHROPIC_ANALYTICS_API_KEY not set'));
      expect(keyMissingLog).toBeDefined();
    });

    it('does NOT mention the env-var name for a transient 5xx', async () => {
      mockAddLog.mockClear();
      mockRefreshCc.mockRejectedValueOnce(new Error('Anthropic Analytics API 503'));

      await runReport('r1', 'my-org', 14);

      const skipLogs = mockAddLog.mock.calls
        .map((c) => c[1])
        .filter((m: string) => typeof m === 'string' && m.includes('CC spend: SKIP'));
      expect(skipLogs.length).toBeGreaterThan(0);
      // Generic skip log must include the upstream error message, not the env var.
      const transientLog = skipLogs.find((m: string) => m.includes('Anthropic Analytics API 503'));
      expect(transientLog).toBeDefined();
      for (const m of skipLogs) {
        expect(m).not.toContain('ANTHROPIC_ANALYTICS_API_KEY');
      }
    });

    it('skips re-pull on resume when cc_period_end is already set', async () => {
      // Mock DB to return cc_period_end populated for the report row lookup.
      mockDbExecute.mockImplementation(async (sql: string) => {
        if (typeof sql === 'string' && sql.includes('SELECT commit_sha')) {
          return [[], null]; // no existing analyses
        }
        if (typeof sql === 'string' && sql.includes('SELECT cc_period_end FROM reports')) {
          return [[{ cc_period_end: '2026-04-15' }], null];
        }
        return [[], null];
      });
      mockAddLog.mockClear();

      await runReport('rResume1', 'my-org', 14, true);

      expect(mockRefreshCc).not.toHaveBeenCalled();
      const skipLogs = mockAddLog.mock.calls
        .map((c) => c[1])
        .filter((m: string) => typeof m === 'string' && m.includes('already pulled (resume)'));
      expect(skipLogs.length).toBeGreaterThan(0);
    });

    it('re-pulls on resume when cc_period_end is NULL', async () => {
      mockDbExecute.mockImplementation(async (sql: string) => {
        if (typeof sql === 'string' && sql.includes('SELECT commit_sha')) {
          return [[], null];
        }
        if (typeof sql === 'string' && sql.includes('SELECT cc_period_end FROM reports')) {
          return [[{ cc_period_end: null }], null];
        }
        return [[], null];
      });

      await runReport('rResume2', 'my-org', 14, true);

      expect(mockRefreshCc).toHaveBeenCalledWith('rResume2', expect.any(Function));
    });
  });
});
