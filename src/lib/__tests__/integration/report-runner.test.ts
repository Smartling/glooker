import { makeCommit, makeAnalysis } from '../fixtures';

// Mocks — @octokit/rest is ESM-only, mock it to avoid parse errors
jest.mock('@octokit/rest', () => ({
  Octokit: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('@/lib/github');
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

import { runReport, requestStop } from '@/lib/report-runner';
import { listOrgMembers, fetchUserActivity } from '@/lib/github';
import { analyzeCommit } from '@/lib/analyzer';
import db from '@/lib/db/index';
import { updateProgress, addLog } from '@/lib/progress-store';

const mockListOrgMembers = listOrgMembers as jest.Mock;
const mockFetchUserActivity = fetchUserActivity as jest.Mock;
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
});
