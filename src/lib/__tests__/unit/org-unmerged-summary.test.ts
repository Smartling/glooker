jest.mock('@octokit/rest', () => ({ Octokit: jest.fn().mockImplementation(() => ({})) }));
jest.mock('@/lib/db/index', () => ({
  __esModule: true,
  default: { execute: jest.fn() },
}));
jest.mock('@/lib/report-runner', () => ({ runReport: jest.fn().mockResolvedValue(undefined), requestStop: jest.fn() }));
jest.mock('@/lib/progress-store', () => ({ initProgress: jest.fn(), updateProgress: jest.fn(), getProgress: jest.fn() }));

import { getOrgReport } from '@/lib/report/org';
import db from '@/lib/db/index';

describe('getOrgReport unmerged-work integration', () => {
  const dbExec = db.execute as jest.Mock;

  beforeEach(() => { dbExec.mockReset(); });

  function mockBaselineQueries({
    org = 'acme',
    devs = [],
    reportIds = ['r1'],
    timelineCommits = [],
    openPrRows = [],
    unmergedAgg = null,
  }: {
    org?: string;
    devs?: any[];
    reportIds?: string[];
    timelineCommits?: any[];
    openPrRows?: Array<{ pr_commits: number; pr_additions: number; pr_deletions: number; pr_updated_at: string }>;
    unmergedAgg?: { openPrCount: number; openPrDevCount: number; bareBranchCount: number; bareBranchDevCount: number; inFlightLinesAdded: number; inFlightLinesRemoved: number; } | null;
  }) {
    // 1. report metadata (cc_period_start/end NULL → spend-window branch is skipped)
    dbExec.mockResolvedValueOnce([[{ id: 'rep1', org, period_days: 14, status: 'completed', created_at: '2026-04-25', completed_at: '2026-04-25', cc_period_start: null, cc_period_end: null }], null]);
    // 2. developer_stats
    dbExec.mockResolvedValueOnce([devs, null]);
    // 3. all reportIds for org
    dbExec.mockResolvedValueOnce([reportIds.map(id => ({ id })), null]);
    // 4. timeline commits
    dbExec.mockResolvedValueOnce([timelineCommits, null]);
    // 5. open_pr rows (in-flight overlay source)
    dbExec.mockResolvedValueOnce([openPrRows, null]);
    // 6. unmerged summary aggregation
    if (unmergedAgg) {
      dbExec.mockResolvedValueOnce([[unmergedAgg], null]);
    } else {
      dbExec.mockResolvedValueOnce([[{ openPrCount: 0, openPrDevCount: 0, bareBranchCount: 0, bareBranchDevCount: 0, inFlightLinesAdded: 0, inFlightLinesRemoved: 0 }], null]);
    }
  }

  it('returns unmergedSummary=null when no in-flight rows', async () => {
    mockBaselineQueries({ unmergedAgg: null });
    const result = await getOrgReport('rep1');
    expect(result.unmergedSummary).toBeNull();
  });

  it('returns unmergedSummary with counts when in-flight rows exist', async () => {
    mockBaselineQueries({
      unmergedAgg: {
        openPrCount: 62, openPrDevCount: 33,
        bareBranchCount: 4, bareBranchDevCount: 2,
        inFlightLinesAdded: 12431, inFlightLinesRemoved: 2118,
      },
    });
    const result = await getOrgReport('rep1');
    expect(result.unmergedSummary).toEqual({
      openPrCount: 62,
      openPrDevCount: 33,
      bareBranchCount: 4,
      bareBranchDevCount: 2,
      inFlightLinesAdded: 12431,
      inFlightLinesRemoved: 2118,
    });
  });

  it('adds open-PR commits to types.in_flight bucketed by week of pr_updated_at', async () => {
    // Existing shipped commit on 2026-04-20 (a Monday). Open PR updated 2026-04-22 (also that week).
    mockBaselineQueries({
      timelineCommits: [
        { commit_sha: 'aaa', github_login: 'alice', committed_at: '2026-04-22T15:00:00Z', lines_added: 10, lines_removed: 2, complexity: 5, type: 'feature', ai_co_authored: 0, maybe_ai: 0 },
      ],
      openPrRows: [
        { pr_commits: 5, pr_additions: 100, pr_deletions: 30, pr_updated_at: '2026-04-22T10:00:00Z' },
      ],
      unmergedAgg: { openPrCount: 1, openPrDevCount: 1, bareBranchCount: 0, bareBranchDevCount: 0, inFlightLinesAdded: 100, inFlightLinesRemoved: 30 },
    });
    const result = await getOrgReport('rep1');
    // Find the week bucket containing 2026-04-20 (Monday key)
    const week = result.timeline.find((w: any) => w.week === '2026-04-20')!;
    expect(week).toBeDefined();
    expect(week.types.in_flight).toBe(5);
    expect(week.types.feature).toBe(1);                 // shipped commit's original type preserved
    expect(week.commits).toBe(6);                       // 1 shipped + 5 in-flight
    expect(week.linesAdded).toBe(110);                  // 10 + 100
    expect(week.linesRemoved).toBe(32);                 // 2 + 30
    expect(week.inFlightLinesAdded).toBe(100);
    expect(week.inFlightLinesRemoved).toBe(30);
  });

  it('creates a new week bucket if pr_updated_at falls outside existing weeks', async () => {
    mockBaselineQueries({
      timelineCommits: [],                               // no shipped commits at all
      openPrRows: [
        { pr_commits: 3, pr_additions: 50, pr_deletions: 10, pr_updated_at: '2026-04-22T10:00:00Z' },
      ],
      unmergedAgg: { openPrCount: 1, openPrDevCount: 1, bareBranchCount: 0, bareBranchDevCount: 0, inFlightLinesAdded: 50, inFlightLinesRemoved: 10 },
    });
    const result = await getOrgReport('rep1');
    expect(result.timeline.length).toBe(1);
    const week = result.timeline[0];
    expect(week.week).toBe('2026-04-20');
    expect(week.types.in_flight).toBe(3);
    expect(week.commits).toBe(3);
    expect(week.inFlightLinesAdded).toBe(50);
  });

  it('does not modify timeline when no open PRs exist', async () => {
    mockBaselineQueries({
      timelineCommits: [
        { commit_sha: 'xxx', github_login: 'a', committed_at: '2026-04-22T15:00:00Z', lines_added: 1, lines_removed: 0, complexity: 5, type: 'feature', ai_co_authored: 0, maybe_ai: 0 },
      ],
      openPrRows: [],
      unmergedAgg: null,
    });
    const result = await getOrgReport('rep1');
    const week = result.timeline.find((w: any) => w.week === '2026-04-20')!;
    expect(week.types.feature).toBe(1);
    expect(week.types.in_flight).toBeUndefined();
    expect(week.inFlightLinesAdded).toBeUndefined();
  });
});
