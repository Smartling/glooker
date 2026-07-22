jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));
jest.mock('@/lib/db/index', () => ({ __esModule: true, default: { execute: jest.fn() } }));

import { queryCommits, queryJiraIssues, queryDeveloperStats, listReports, getEpicSummaries, getMetricTimeseries } from '@/lib/mcp/queries';
import db from '@/lib/db/index';

const mockExecute = db.execute as jest.Mock;
beforeEach(() => mockExecute.mockReset());

describe('listReports', () => {
  it('returns reports without needing a report id', async () => {
    mockExecute.mockResolvedValueOnce([[{ id: 'r1', org: 'acme', period_days: 30, status: 'completed', created_at: 'x', completed_at: 'y' }], null]);
    const out = await listReports({ limit: 5 });
    expect(out.reports).toHaveLength(1);
    // limit passed as string, capped
    const params = mockExecute.mock.calls[0][1];
    expect(params).toContain('5');
  });

  describe('limit clamping', () => {
    const limitParam = () => {
      const params = mockExecute.mock.calls[0][1] as any[];
      return params[params.length - 1];
    };

    it('caps an over-large limit at MAX_ROWS (500)', async () => {
      mockExecute.mockResolvedValueOnce([[], null]);
      await listReports({ limit: 100000 });
      expect(limitParam()).toBe('500');
    });

    it('falls back to the default for a negative limit', async () => {
      mockExecute.mockResolvedValueOnce([[], null]);
      await listReports({ limit: -1 });
      expect(limitParam()).toBe('50');
    });

    it('falls back to the default for zero or NaN limit', async () => {
      mockExecute.mockResolvedValueOnce([[], null]);
      await listReports({ limit: 0 });
      expect(limitParam()).toBe('50');
    });

    it('floors a fractional limit', async () => {
      mockExecute.mockResolvedValueOnce([[], null]);
      await listReports({ limit: 7.9 });
      expect(limitParam()).toBe('7');
    });
  });
});

describe('queryCommits', () => {
  it('errors when no completed report exists and none specified', async () => {
    mockExecute.mockResolvedValueOnce([[], null]); // resolveReportId → none
    expect(await queryCommits({})).toEqual({ error: 'no completed reports' });
  });

  it('report-scoped: filters to one report and does NOT dedup', async () => {
    mockExecute
      .mockResolvedValueOnce([[{ id: 'r1' }], null])            // resolveReportId (explicit)
      .mockResolvedValueOnce([[                                  // rows
        { commit_sha: 'a', committed_at: '2026-01-02', repo: 'x', github_login: 'u', type: 'feature', lines_added: 1, lines_removed: 0 },
        { commit_sha: 'a', committed_at: '2026-01-01', repo: 'x', github_login: 'u', type: 'feature', lines_added: 1, lines_removed: 0 },
      ], null]);
    const out = await queryCommits({ report_id: 'r1' }) as { commits: any[]; count: number };
    expect(out.count).toBe(2); // duplicates preserved when report-scoped
  });

  it('cross-report: dedups by commit_sha keeping earliest committed_at', async () => {
    mockExecute
      .mockResolvedValueOnce([[{ id: 'r9' }], null])            // resolveReportId (latest completed)
      .mockResolvedValueOnce([[{ org: 'acme' }], null])          // org lookup
      .mockResolvedValueOnce([[                                  // rows across reports
        { commit_sha: 'a', committed_at: '2026-03-01', repo: 'x', github_login: 'u', type: 'feature', lines_added: 1, lines_removed: 0 },
        { commit_sha: 'a', committed_at: '2026-01-01', repo: 'x', github_login: 'u', type: 'feature', lines_added: 1, lines_removed: 0 },
        { commit_sha: 'b', committed_at: '2026-02-01', repo: 'x', github_login: 'u', type: 'bug', lines_added: 2, lines_removed: 1 },
      ], null]);
    const out = await queryCommits({}) as { commits: any[]; count: number };
    expect(out.count).toBe(2);
    expect(out.commits.find((c: any) => c.commit_sha === 'a').committed_at).toBe('2026-01-01');
  });
});

describe('queryDeveloperStats', () => {
  it('coerces numeric string columns and sorts by a safe metric', async () => {
    mockExecute
      .mockResolvedValueOnce([[{ id: 'r1' }], null])            // resolveReportId
      .mockResolvedValueOnce([[{ github_login: 'u', impact_score: '4.5', total_commits: '10' }], null]);
    const out = await queryDeveloperStats({ report_id: 'r1', sort_by: 'impact_score' }) as { developers: any[]; count: number };
    expect(out.developers[0].impact_score).toBe(4.5);
    expect(typeof out.developers[0].impact_score).toBe('number');
  });

  it('rejects an unsafe sort_by and falls back to impact_score', async () => {
    mockExecute
      .mockResolvedValueOnce([[{ id: 'r1' }], null])
      .mockResolvedValueOnce([[], null]);
    await queryDeveloperStats({ report_id: 'r1', sort_by: 'name; DROP TABLE reports' });
    const sql = mockExecute.mock.calls[1][0] as string;
    expect(sql).toContain('ORDER BY ds.impact_score');
  });
});

describe('queryJiraIssues', () => {
  it('cross-report dedups by issue_key keeping earliest resolved_at', async () => {
    mockExecute
      .mockResolvedValueOnce([[{ id: 'r9' }], null])            // resolveReportId
      .mockResolvedValueOnce([[{ org: 'acme' }], null])          // org lookup
      .mockResolvedValueOnce([[
        { issue_key: 'K-1', resolved_at: '2026-03-01', project_key: 'K' },
        { issue_key: 'K-1', resolved_at: '2026-01-01', project_key: 'K' },
      ], null]);
    const out = await queryJiraIssues({}) as { issues: any[]; count: number };
    expect(out.count).toBe(1);
    expect(out.issues[0].resolved_at).toBe('2026-01-01');
  });
});

describe('getEpicSummaries', () => {
  it('lists epics for an org when no epic_key given', async () => {
    mockExecute.mockResolvedValueOnce([[{ epic_key: 'E-1', org: 'acme', resolved_jiras: 3, remaining_jiras: 1, commit_count: 12 }], null]);
    const out = await getEpicSummaries({ org: 'acme' });
    expect(out.epics).toHaveLength(1);
    expect(out.epics[0].epic_key).toBe('E-1');
  });
});

describe('getMetricTimeseries', () => {
  it('commits by week: dedups then buckets by Monday', async () => {
    mockExecute
      .mockResolvedValueOnce([[{ id: 'r9' }], null])            // resolveReportId
      .mockResolvedValueOnce([[{ org: 'acme' }], null])          // reportOrg
      .mockResolvedValueOnce([[
        { commit_sha: 'a', committed_at: '2026-01-05T00:00:00Z' }, // Mon wk 01-05
        { commit_sha: 'a', committed_at: '2026-03-01T00:00:00Z' }, // dup, later → dropped
        { commit_sha: 'b', committed_at: '2026-01-07T00:00:00Z' }, // Wed wk 01-05
      ], null]);
    const out = await getMetricTimeseries({ metric: 'commits', group_by: 'week' });
    expect(out).toEqual({ metric: 'commits', group_by: 'week', series: [{ bucket: '2026-01-05', value: 2 }] });
  });

  it('lines_added by repo: sums the metric per group', async () => {
    mockExecute
      .mockResolvedValueOnce([[{ id: 'r9' }], null])
      .mockResolvedValueOnce([[{ org: 'acme' }], null])
      .mockResolvedValueOnce([[
        { commit_sha: 'a', committed_at: '2026-01-01', repo: 'x', lines_added: '10' },
        { commit_sha: 'b', committed_at: '2026-01-02', repo: 'x', lines_added: '5' },
        { commit_sha: 'c', committed_at: '2026-01-03', repo: 'y', lines_added: '3' },
      ], null]);
    const out = await getMetricTimeseries({ metric: 'lines_added', group_by: 'repo' }) as { series: any[] };
    expect(out.series).toEqual([{ bucket: 'x', value: 15 }, { bucket: 'y', value: 3 }]);
  });

  it('impact_score forces group_by=report and averages per report', async () => {
    mockExecute.mockResolvedValueOnce([[
      { report_id: 'r1', created_at: '2026-01-01', value: '4.0' },
      { report_id: 'r2', created_at: '2026-02-01', value: '4.5' },
    ], null]);
    const out = await getMetricTimeseries({ metric: 'impact_score', org: 'acme' }) as { group_by: string; series: any[] };
    expect(out.group_by).toBe('report');
    expect(out.series).toEqual([{ bucket: '2026-01-01', value: 4 }, { bucket: '2026-02-01', value: 4.5 }]);
  });

  it('rejects an unknown metric', async () => {
    expect(await getMetricTimeseries({ metric: 'bogus' })).toEqual({ error: 'unknown metric: bogus' });
  });

  it('commits grouped by report buckets by report_id', async () => {
    mockExecute
      .mockResolvedValueOnce([[{ id: 'r9' }], null])   // resolveReportId(undefined)
      .mockResolvedValueOnce([[                          // rows
        { commit_sha: 'a', committed_at: '2026-01-01', report_id: 'rA', lines_added: 1 },
        { commit_sha: 'b', committed_at: '2026-01-02', report_id: 'rA', lines_added: 1 },
        { commit_sha: 'c', committed_at: '2026-01-03', report_id: 'rB', lines_added: 1 },
      ], null]);
    const out = await getMetricTimeseries({ metric: 'commits', group_by: 'report', org: 'acme' }) as { series: any[] };
    expect(out.series).toEqual([{ bucket: 'rA', value: 2 }, { bucket: 'rB', value: 1 }]);
  });

  it('jira_resolved by week dedups by issue_key then counts', async () => {
    mockExecute
      .mockResolvedValueOnce([[{ id: 'r9' }], null])
      .mockResolvedValueOnce([[
        { issue_key: 'K-1', resolved_at: '2026-01-05T00:00:00Z', report_id: 'rA', github_login: 'u' },
        { issue_key: 'K-1', resolved_at: '2026-03-01T00:00:00Z', report_id: 'rB', github_login: 'u' },
        { issue_key: 'K-2', resolved_at: '2026-01-07T00:00:00Z', report_id: 'rA', github_login: 'v' },
      ], null]);
    const out = await getMetricTimeseries({ metric: 'jira_resolved', group_by: 'week', org: 'acme' }) as { series: any[] };
    expect(out.series).toEqual([{ bucket: '2026-01-05', value: 2 }]);
  });

  it('jira_resolved grouped by developer buckets by github_login', async () => {
    mockExecute
      .mockResolvedValueOnce([[{ id: 'r9' }], null])
      .mockResolvedValueOnce([[
        { issue_key: 'K-1', resolved_at: '2026-01-01', report_id: 'rA', github_login: 'alice' },
        { issue_key: 'K-2', resolved_at: '2026-01-02', report_id: 'rA', github_login: 'alice' },
        { issue_key: 'K-3', resolved_at: '2026-01-03', report_id: 'rA', github_login: 'bob' },
      ], null]);
    const out = await getMetricTimeseries({ metric: 'jira_resolved', group_by: 'developer', org: 'acme' }) as { series: any[] };
    expect(out.series).toEqual([{ bucket: 'alice', value: 2 }, { bucket: 'bob', value: 1 }]);
  });

  it('rejects an unsupported group_by with no DB call', async () => {
    const out = await getMetricTimeseries({ metric: 'commits', group_by: 'daily' });
    expect(out).toEqual({ error: 'unknown group_by: daily' });
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('rejects repo/type grouping for jira_resolved with no DB call', async () => {
    const out = await getMetricTimeseries({ metric: 'jira_resolved', group_by: 'repo' });
    expect(out).toEqual({ error: "group_by 'repo' is not supported for metric 'jira_resolved'" });
    expect(mockExecute).not.toHaveBeenCalled();
  });
});
