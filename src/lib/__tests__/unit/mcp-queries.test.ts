jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));
jest.mock('@/lib/db/index', () => ({ __esModule: true, default: { execute: jest.fn() } }));

import { queryCommits, queryJiraIssues, queryDeveloperStats, listReports, getEpicSummaries } from '@/lib/mcp/queries';
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
    const out = await queryCommits({ report_id: 'r1' });
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
    const out = await queryCommits({});
    expect(out.count).toBe(2);
    expect(out.commits.find((c: any) => c.commit_sha === 'a').committed_at).toBe('2026-01-01');
  });
});

describe('queryDeveloperStats', () => {
  it('coerces numeric string columns and sorts by a safe metric', async () => {
    mockExecute
      .mockResolvedValueOnce([[{ id: 'r1' }], null])            // resolveReportId
      .mockResolvedValueOnce([[{ github_login: 'u', impact_score: '4.5', total_commits: '10' }], null]);
    const out = await queryDeveloperStats({ report_id: 'r1', sort_by: 'impact_score' });
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
    const out = await queryJiraIssues({});
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
