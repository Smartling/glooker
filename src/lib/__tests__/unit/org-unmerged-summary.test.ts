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
    bareBranchShas = [],
    unmergedAgg = null,
  }: {
    org?: string;
    devs?: any[];
    reportIds?: string[];
    timelineCommits?: any[];
    bareBranchShas?: string[];
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
    // 5. bare-branch SHAs
    dbExec.mockResolvedValueOnce([bareBranchShas.map(sha => ({ commit_sha: sha })), null]);
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

  it("overrides commit type to 'in_flight' for bare-branch SHAs", async () => {
    mockBaselineQueries({
      timelineCommits: [
        { commit_sha: 'aaa', github_login: 'alice', committed_at: '2026-04-20', lines_added: 10, lines_removed: 2, complexity: 5, type: 'feature', ai_co_authored: 0, maybe_ai: 0 },
        { commit_sha: 'bbb', github_login: 'bob',   committed_at: '2026-04-20', lines_added: 5,  lines_removed: 1, complexity: 4, type: 'bug',     ai_co_authored: 0, maybe_ai: 0 },
      ],
      bareBranchShas: ['aaa'],
      unmergedAgg: { openPrCount: 0, openPrDevCount: 0, bareBranchCount: 1, bareBranchDevCount: 1, inFlightLinesAdded: 0, inFlightLinesRemoved: 0 },
    });
    const result = await getOrgReport('rep1');
    const allTypes = result.timeline.flatMap((w: any) => Object.entries(w.types));
    const typeCounts: Record<string, number> = {};
    for (const [t, c] of allTypes) typeCounts[t] = (typeCounts[t] || 0) + (c as number);
    expect(typeCounts.in_flight).toBe(1);
    expect(typeCounts.bug).toBe(1);
    expect(typeCounts.feature).toBeUndefined();
  });

  it('does not override type when bareBranchShas is empty', async () => {
    mockBaselineQueries({
      timelineCommits: [
        { commit_sha: 'xxx', github_login: 'a', committed_at: '2026-04-20', lines_added: 1, lines_removed: 0, complexity: 5, type: 'feature', ai_co_authored: 0, maybe_ai: 0 },
      ],
      bareBranchShas: [],
      unmergedAgg: null,
    });
    const result = await getOrgReport('rep1');
    const allTypes = result.timeline.flatMap((w: any) => Object.entries(w.types));
    const typeCounts: Record<string, number> = {};
    for (const [t, c] of allTypes) typeCounts[t] = (typeCounts[t] || 0) + (c as number);
    expect(typeCounts.feature).toBe(1);
    expect(typeCounts.in_flight).toBeUndefined();
  });
});
