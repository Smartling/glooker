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
    overlayCommits = [],
    unmergedAgg = null,
  }: {
    org?: string;
    devs?: any[];
    reportIds?: string[];
    timelineCommits?: any[];
    overlayCommits?: Array<{ committed_at: string; lines_added: number; lines_removed: number }>;
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
    // 5. unmerged_commits rows for overlay
    dbExec.mockResolvedValueOnce([overlayCommits, null]);
    // 6. unmerged summary aggregation (single multi-aggregation row)
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

  it('adds unmerged_commits rows to types.in_flight bucketed by week of committed_at', async () => {
    mockBaselineQueries({
      timelineCommits: [
        { commit_sha: 'aaa', github_login: 'alice', committed_at: '2026-04-22T15:00:00Z', lines_added: 10, lines_removed: 2, complexity: 5, type: 'feature', ai_co_authored: 0, maybe_ai: 0 },
      ],
      overlayCommits: [
        { committed_at: '2026-04-22T15:00:00Z', lines_added: 100, lines_removed: 30 },
        { committed_at: '2026-04-22T15:00:00Z', lines_added: 50,  lines_removed: 5  },
      ],
      unmergedAgg: { openPrCount: 1, openPrDevCount: 1, bareBranchCount: 0, bareBranchDevCount: 0, inFlightLinesAdded: 150, inFlightLinesRemoved: 35 },
    });
    const result = await getOrgReport('rep1');
    const week = result.timeline.find((w: any) => w.week === '2026-04-20')!;
    expect(week).toBeDefined();
    expect(week.types.in_flight).toBe(2);
    expect(week.types.feature).toBe(1);
    expect(week.commits).toBe(3);
    expect(week.linesAdded).toBe(160);
    expect(week.linesRemoved).toBe(37);
    expect(week.inFlightLinesAdded).toBe(150);
    expect(week.inFlightLinesRemoved).toBe(35);
  });

  it('creates a new week bucket if a unmerged commit is in a week without shipped commits', async () => {
    mockBaselineQueries({
      timelineCommits: [],
      overlayCommits: [{ committed_at: '2026-04-22T15:00:00Z', lines_added: 50, lines_removed: 10 }],
      unmergedAgg: { openPrCount: 0, openPrDevCount: 0, bareBranchCount: 1, bareBranchDevCount: 1, inFlightLinesAdded: 50, inFlightLinesRemoved: 10 },
    });
    const result = await getOrgReport('rep1');
    expect(result.timeline.length).toBe(1);
    const week = result.timeline[0];
    expect(week.week).toBe('2026-04-20');
    expect(week.types.in_flight).toBe(1);
    expect(week.commits).toBe(1);
    expect(week.inFlightLinesAdded).toBe(50);
  });

  it('does not modify timeline when no overlay commits exist', async () => {
    mockBaselineQueries({
      timelineCommits: [
        { commit_sha: 'xxx', github_login: 'a', committed_at: '2026-04-22T15:00:00Z', lines_added: 1, lines_removed: 0, complexity: 5, type: 'feature', ai_co_authored: 0, maybe_ai: 0 },
      ],
      overlayCommits: [],
      unmergedAgg: null,
    });
    const result = await getOrgReport('rep1');
    const week = result.timeline.find((w: any) => w.week === '2026-04-20')!;
    expect(week.types.feature).toBe(1);
    expect(week.types.in_flight).toBeUndefined();
    expect(week.inFlightLinesAdded).toBeUndefined();
  });
});
