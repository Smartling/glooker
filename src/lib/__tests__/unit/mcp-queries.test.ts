jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));
jest.mock('@/lib/db/index', () => ({ __esModule: true, default: { execute: jest.fn() } }));

import { queryCommits, queryJiraIssues, queryDeveloperStats, listReports, getEpicSummaries, getMetricTimeseries, TIMESERIES_ROW_CAP } from '@/lib/mcp/queries';
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

  it('report-scoped: plain SELECT, no GROUP BY dedup', async () => {
    mockExecute
      .mockResolvedValueOnce([[{ id: 'r1' }], null])            // resolveReportId (explicit)
      .mockResolvedValueOnce([[
        { commit_sha: 'a', committed_at: '2026-01-02' },
        { commit_sha: 'b', committed_at: '2026-01-01' },
      ], null]);
    const out = await queryCommits({ report_id: 'r1' }) as { commits: any[]; count: number };
    expect(out.count).toBe(2);
    const sql = mockExecute.mock.calls[1][0] as string;
    expect(sql).not.toContain('GROUP BY'); // sha is unique per report
  });

  it('cross-report: dedups by commit_sha in SQL (GROUP BY before LIMIT)', async () => {
    mockExecute
      .mockResolvedValueOnce([[{ id: 'r9' }], null])            // resolveReportId (latest completed)
      .mockResolvedValueOnce([[{ org: 'acme' }], null])          // org lookup
      .mockResolvedValueOnce([[                                  // SQL already deduped → 2 distinct commits
        { commit_sha: 'a', committed_at: '2026-01-01' },
        { commit_sha: 'b', committed_at: '2026-02-01' },
      ], null]);
    const out = await queryCommits({}) as { commits: any[]; count: number };
    expect(out.count).toBe(2);
    const sql = mockExecute.mock.calls[2][0] as string;
    expect(sql).toContain('GROUP BY ca.commit_sha'); // dedup before LIMIT, not after
    expect(sql).toContain('LIMIT ?');
  });
});

describe('queryDeveloperStats', () => {
  it('coerces numeric string columns and sorts by a safe metric', async () => {
    mockExecute
      .mockResolvedValueOnce([[{ id: 'r1' }], null])            // resolveReportId
      .mockResolvedValueOnce([[{ org: 'acme' }], null])          // reportOrg
      .mockResolvedValueOnce([[{ github_login: 'u', impact_score: '4.5', total_commits: '10' }], null]);
    const out = await queryDeveloperStats({ report_id: 'r1', sort_by: 'impact_score' }) as { developers: any[]; count: number };
    expect(out.developers[0].impact_score).toBe(4.5);
    expect(typeof out.developers[0].impact_score).toBe('number');
  });

  it('rejects an unsafe sort_by and falls back to impact_score', async () => {
    mockExecute
      .mockResolvedValueOnce([[{ id: 'r1' }], null])
      .mockResolvedValueOnce([[{ org: 'acme' }], null])          // reportOrg
      .mockResolvedValueOnce([[], null]);
    await queryDeveloperStats({ report_id: 'r1', sort_by: 'name; DROP TABLE reports' });
    const sql = mockExecute.mock.calls[2][0] as string;
    expect(sql).toContain('ORDER BY ds.impact_score');
  });
});

describe('queryJiraIssues', () => {
  it('cross-report: dedups by issue_key in SQL (GROUP BY before LIMIT)', async () => {
    mockExecute
      .mockResolvedValueOnce([[{ id: 'r9' }], null])            // resolveReportId
      .mockResolvedValueOnce([[{ org: 'acme' }], null])          // org lookup
      .mockResolvedValueOnce([[{ issue_key: 'K-1', resolved_at: '2026-01-01', project_key: 'K' }], null]);
    const out = await queryJiraIssues({}) as { issues: any[]; count: number };
    expect(out.count).toBe(1);
    const sql = mockExecute.mock.calls[2][0] as string;
    expect(sql).toContain('GROUP BY ji.issue_key');
    expect(sql).toContain('LIMIT ?');
  });

  it('report-scoped: plain SELECT, no GROUP BY dedup', async () => {
    mockExecute
      .mockResolvedValueOnce([[{ id: 'r1' }], null])            // resolveReportId (explicit)
      .mockResolvedValueOnce([[
        { issue_key: 'K-1', resolved_at: '2026-01-02', project_key: 'K' },
        { issue_key: 'K-2', resolved_at: '2026-01-01', project_key: 'K' },
      ], null]);
    const out = await queryJiraIssues({ report_id: 'r1' }) as { issues: any[]; count: number };
    expect(out.count).toBe(2);
    const sql = mockExecute.mock.calls[1][0] as string;
    expect(sql).not.toContain('GROUP BY');
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
  it('commits by week: SQL-deduped rows bucketed by Monday', async () => {
    mockExecute
      .mockResolvedValueOnce([[{ id: 'r9' }], null])            // resolveReportId
      .mockResolvedValueOnce([[{ org: 'acme' }], null])          // reportOrg
      .mockResolvedValueOnce([[                                   // rows already deduped by SQL GROUP BY
        { ts: '2026-01-05T00:00:00Z' }, // Mon wk 01-05
        { ts: '2026-01-07T00:00:00Z' }, // Wed wk 01-05
      ], null]);
    const out = await getMetricTimeseries({ metric: 'commits', group_by: 'week' });
    expect(out).toEqual({ metric: 'commits', group_by: 'week', series: [{ bucket: '2026-01-05', value: 2 }], truncated: false });
  });

  it('dedups in SQL: query GROUP BYs the commit key with MIN(timestamp)', async () => {
    mockExecute
      .mockResolvedValueOnce([[{ id: 'r9' }], null])
      .mockResolvedValueOnce([[{ org: 'acme' }], null])
      .mockResolvedValueOnce([[], null]);
    await getMetricTimeseries({ metric: 'commits', group_by: 'week' });
    const sql = mockExecute.mock.calls[2][0] as string;
    expect(sql).toContain('GROUP BY ca.commit_sha');
    expect(sql).toContain('MIN(ca.committed_at) AS ts');
  });

  it('lines_added by repo: sums the metric per group', async () => {
    mockExecute
      .mockResolvedValueOnce([[{ id: 'r9' }], null])
      .mockResolvedValueOnce([[{ org: 'acme' }], null])
      .mockResolvedValueOnce([[
        { ts: '2026-01-01', repo: 'x', lines_added: '10' },
        { ts: '2026-01-02', repo: 'x', lines_added: '5' },
        { ts: '2026-01-03', repo: 'y', lines_added: '3' },
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

  it('commits grouped by report: per-report COUNT bucketed by report date', async () => {
    mockExecute
      .mockResolvedValueOnce([[                          // per-report aggregate (org supplied: 1 call)
        { report_id: 'rA', created_at: '2026-01-01', value: '2' },
        { report_id: 'rB', created_at: '2026-01-08', value: '1' },
      ], null]);
    const out = await getMetricTimeseries({ metric: 'commits', group_by: 'report', org: 'acme' }) as { series: any[] };
    expect(out.series).toEqual([{ bucket: '2026-01-01', value: 2 }, { bucket: '2026-01-08', value: 1 }]);
    const sql = mockExecute.mock.calls[0][0] as string;
    expect(sql).toContain('COUNT(DISTINCT ca.commit_sha)');
    expect(sql).toContain('GROUP BY r.id, r.created_at');
  });

  it('lines_added grouped by report SUMs lines per report', async () => {
    mockExecute
      .mockResolvedValueOnce([[{ report_id: 'rA', created_at: '2026-01-01', value: '500' }], null]);
    const out = await getMetricTimeseries({ metric: 'lines_added', group_by: 'report', org: 'acme' }) as { series: any[] };
    expect(out.series).toEqual([{ bucket: '2026-01-01', value: 500 }]);
    expect(mockExecute.mock.calls[0][0] as string).toContain('COALESCE(SUM(ca.lines_added), 0)');
  });

  it('formats report buckets as ISO dates even when the driver returns Date objects', async () => {
    // mysql2 returns DATETIME columns as JS Date objects, not strings.
    mockExecute
      .mockResolvedValueOnce([[{ report_id: 'rA', created_at: new Date('2026-03-16T18:00:00.000Z'), value: '5' }], null]);
    const out = await getMetricTimeseries({ metric: 'commits', group_by: 'report', org: 'acme' }) as { series: any[] };
    expect(out.series).toEqual([{ bucket: '2026-03-16', value: 5 }]);
  });

  it('jira_resolved by week counts SQL-deduped issues', async () => {
    mockExecute
      .mockResolvedValueOnce([[
        { ts: '2026-01-05T00:00:00Z', github_login: 'u' },
        { ts: '2026-01-07T00:00:00Z', github_login: 'v' },
      ], null]);
    const out = await getMetricTimeseries({ metric: 'jira_resolved', group_by: 'week', org: 'acme' }) as { series: any[] };
    expect(out.series).toEqual([{ bucket: '2026-01-05', value: 2 }]);
    expect(mockExecute.mock.calls[0][0] as string).toContain('GROUP BY ji.issue_key');
  });

  it('jira_resolved grouped by developer buckets by github_login', async () => {
    mockExecute
      .mockResolvedValueOnce([[
        { ts: '2026-01-01', github_login: 'alice' },
        { ts: '2026-01-02', github_login: 'alice' },
        { ts: '2026-01-03', github_login: 'bob' },
      ], null]);
    const out = await getMetricTimeseries({ metric: 'jira_resolved', group_by: 'developer', org: 'acme' }) as { series: any[] };
    expect(out.series).toEqual([{ bucket: 'alice', value: 2 }, { bucket: 'bob', value: 1 }]);
  });

  it('prs metric dedups on (repo, pr_number) — per-repo PR numbers — and filters non-PR commits', async () => {
    mockExecute
      .mockResolvedValueOnce([[
        { ts: '2026-01-05T00:00:00Z' },
        { ts: '2026-01-06T00:00:00Z' },
      ], null]);
    const out = await getMetricTimeseries({ metric: 'prs', group_by: 'week', org: 'acme' }) as { series: any[] };
    expect(out.series).toEqual([{ bucket: '2026-01-05', value: 2 }]);
    const sql = mockExecute.mock.calls[0][0] as string;
    // PR #N is per-repo, so dedup must key on (repo, pr_number), not pr_number alone.
    expect(sql).toContain('GROUP BY ca.repo, ca.pr_number');
    expect(sql).not.toMatch(/GROUP BY ca\.pr_number\b/);
    expect(sql).toContain('ca.pr_number IS NOT NULL');
  });

  it('prs grouped by report counts distinct (repo, pr_number) per report', async () => {
    mockExecute
      .mockResolvedValueOnce([[{ report_id: 'rA', created_at: '2026-01-01', value: '452' }], null]);
    const out = await getMetricTimeseries({ metric: 'prs', group_by: 'report', org: 'acme' }) as { series: any[] };
    expect(out.series).toEqual([{ bucket: '2026-01-01', value: 452 }]);
    const sql = mockExecute.mock.calls[0][0] as string;
    expect(sql).toContain('COUNT(DISTINCT ca.repo, ca.pr_number)');
    expect(sql).not.toContain('COUNT(DISTINCT ca.pr_number)');
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

  it('applies a default 180-day window and a row cap when neither since nor until is given', async () => {
    mockExecute
      .mockResolvedValueOnce([[{ id: 'r9' }], null])   // resolveReportId (no org given)
      .mockResolvedValueOnce([[{ org: 'acme' }], null]) // reportOrg
      .mockResolvedValueOnce([[], null]);               // rows
    await getMetricTimeseries({ metric: 'commits', group_by: 'week' });
    const rowSql = mockExecute.mock.calls[2][0] as string;
    const rowParams = mockExecute.mock.calls[2][1] as any[];
    expect(rowSql).toContain('committed_at >= ?');
    expect(rowSql).toContain('LIMIT ?');
    expect(rowParams[rowParams.length - 1]).toBe(String(TIMESERIES_ROW_CAP));
    expect(rowParams.some(p => typeof p === 'string' && /^\d{4}-\d{2}-\d{2}/.test(p))).toBe(true);
  });

  it('treats an empty-string since as absent and still applies the default window', async () => {
    mockExecute
      .mockResolvedValueOnce([[{ id: 'r9' }], null])   // resolveReportId (no org given)
      .mockResolvedValueOnce([[{ org: 'acme' }], null]) // reportOrg
      .mockResolvedValueOnce([[], null]);               // rows
    await getMetricTimeseries({ metric: 'commits', group_by: 'week', since: '   ' });
    const rowSql = mockExecute.mock.calls[2][0] as string;
    expect(rowSql).toContain('committed_at >= ?'); // default window applied, not bypassed
  });

  it('does not add a default window when since is provided, and reports truncated=false for a small result', async () => {
    mockExecute
      .mockResolvedValueOnce([[{ id: 'r9' }], null])
      .mockResolvedValueOnce([[{ org: 'acme' }], null])
      .mockResolvedValueOnce([[{ ts: '2026-01-01' }], null]);
    const out = await getMetricTimeseries({ metric: 'commits', group_by: 'week', since: '2026-01-01' }) as { truncated: boolean };
    expect(out.truncated).toBe(false);
  });

  it('skips resolveReportId when org is supplied (1 db call)', async () => {
    mockExecute
      .mockResolvedValueOnce([[{ ts: '2026-01-01' }], null]); // dedup query only
    const out = await getMetricTimeseries({ metric: 'commits', group_by: 'week', org: 'acme', since: '2026-01-01' }) as { truncated: boolean };
    expect(mockExecute).toHaveBeenCalledTimes(1);
    expect(out.truncated).toBe(false);
  });
});
