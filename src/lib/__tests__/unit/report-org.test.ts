jest.mock('@octokit/rest', () => ({ Octokit: jest.fn().mockImplementation(() => ({})) }));
jest.mock('@/lib/db/index', () => ({ __esModule: true, default: { execute: jest.fn() } }));
jest.mock('@/lib/report-runner', () => ({ runReport: jest.fn().mockResolvedValue(undefined), requestStop: jest.fn() }));
jest.mock('@/lib/progress-store', () => ({ initProgress: jest.fn(), updateProgress: jest.fn(), getProgress: jest.fn() }));

import { getReportCommits } from '@/lib/report/commits';
import { getOrgReport } from '@/lib/report/org';
import { ReportNotFoundError } from '@/lib/report/service';
import db from '@/lib/db/index';

const mockDbExecute = db.execute as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockDbExecute.mockResolvedValue([[], null]);
});

describe('getReportCommits', () => {
  it('returns commit rows for given report and login', async () => {
    const commitRows = [
      {
        commit_sha: 'abc123',
        repo: 'acme/frontend',
        commit_message: 'feat: add button',
        type: 'feat',
        complexity: 3,
        risk_level: 'low',
        lines_added: 50,
        lines_removed: 10,
        committed_at: '2026-01-15T10:00:00Z',
      },
      {
        commit_sha: 'def456',
        repo: 'acme/backend',
        commit_message: 'fix: null pointer',
        type: 'fix',
        complexity: 2,
        risk_level: 'medium',
        lines_added: 5,
        lines_removed: 3,
        committed_at: '2026-01-14T09:00:00Z',
      },
    ];

    mockDbExecute.mockResolvedValueOnce([commitRows, null]);

    const result = await getReportCommits('report-1', 'alice');

    expect(result).toEqual(commitRows);
    expect(mockDbExecute).toHaveBeenCalledTimes(1);
    expect(mockDbExecute).toHaveBeenCalledWith(
      expect.stringContaining('FROM commit_analyses'),
      ['report-1', 'alice'],
    );
  });

  it('returns empty array when no commits found', async () => {
    mockDbExecute.mockResolvedValueOnce([[], null]);

    const result = await getReportCommits('report-1', 'unknown-user');

    expect(result).toEqual([]);
  });
});

describe('getOrgReport', () => {
  const reportRow = {
    id: 'report-1',
    org: 'acme',
    period_days: 30,
    status: 'completed',
    created_at: '2026-01-01T00:00:00Z',
    completed_at: '2026-01-02T00:00:00Z',
  };

  const devRow = {
    github_login: 'alice',
    github_name: 'Alice',
    avatar_url: 'https://example.com/alice.png',
    total_prs: 5,
    total_commits: 20,
    lines_added: 1000,
    lines_removed: 200,
    avg_complexity: '3.5',
    impact_score: '87.5',
    pr_percentage: '25.0',
    ai_percentage: '10.0',
    type_breakdown: '{"feat":5,"fix":3}',
    active_repos: '["repo-a","repo-b"]',
  };

  const commitRow = {
    commit_sha: 'sha1',
    github_login: 'alice',
    committed_at: '2026-01-15T10:00:00Z',
    lines_added: 50,
    lines_removed: 10,
    complexity: 3,
    type: 'feat',
    ai_co_authored: false,
    maybe_ai: false,
  };

  it('returns { report, developers, timeline } with correct shape', async () => {
    mockDbExecute
      .mockResolvedValueOnce([[reportRow], null])   // report metadata
      .mockResolvedValueOnce([[devRow], null])        // developer stats
      .mockResolvedValueOnce([[{ id: 'report-1' }], null])  // all report IDs for org
      .mockResolvedValueOnce([[commitRow], null]);    // timeline commits

    const result = await getOrgReport('report-1');

    expect(result).toHaveProperty('report');
    expect(result).toHaveProperty('developers');
    expect(result).toHaveProperty('timeline');
    expect(result.report).toEqual(reportRow);
    expect(result.developers).toHaveLength(1);
    expect(result.timeline).toBeInstanceOf(Array);
  });

  it('throws ReportNotFoundError when report is missing', async () => {
    mockDbExecute.mockResolvedValueOnce([[], null]);

    await expect(getOrgReport('missing-id')).rejects.toThrow(ReportNotFoundError);
    await expect(getOrgReport('missing-id')).rejects.toThrow('missing-id');
  });

  it('parses JSON string columns (type_breakdown, active_repos)', async () => {
    mockDbExecute
      .mockResolvedValueOnce([[reportRow], null])
      .mockResolvedValueOnce([[devRow], null])
      .mockResolvedValueOnce([[{ id: 'report-1' }], null])
      .mockResolvedValueOnce([[], null]);

    const result = await getOrgReport('report-1');

    expect(result.developers[0].type_breakdown).toEqual({ feat: 5, fix: 3 });
    expect(result.developers[0].active_repos).toEqual(['repo-a', 'repo-b']);
  });

  it('handles already-parsed JSON columns (objects/arrays)', async () => {
    const devRowParsed = {
      ...devRow,
      type_breakdown: { feat: 5, fix: 3 },
      active_repos: ['repo-a', 'repo-b'],
    };

    mockDbExecute
      .mockResolvedValueOnce([[reportRow], null])
      .mockResolvedValueOnce([[devRowParsed], null])
      .mockResolvedValueOnce([[{ id: 'report-1' }], null])
      .mockResolvedValueOnce([[], null]);

    const result = await getOrgReport('report-1');

    expect(result.developers[0].type_breakdown).toEqual({ feat: 5, fix: 3 });
    expect(result.developers[0].active_repos).toEqual(['repo-a', 'repo-b']);
  });

  it('timeline uses trackDevs:true (has activeDevs field)', async () => {
    mockDbExecute
      .mockResolvedValueOnce([[reportRow], null])
      .mockResolvedValueOnce([[devRow], null])
      .mockResolvedValueOnce([[{ id: 'report-1' }], null])
      .mockResolvedValueOnce([[commitRow], null]);

    const result = await getOrgReport('report-1');

    expect(result.timeline).toHaveLength(1);
    expect(result.timeline[0]).toHaveProperty('activeDevs');
    expect(typeof result.timeline[0].activeDevs).toBe('number');
  });

  it('returns empty timeline when no commits exist', async () => {
    mockDbExecute
      .mockResolvedValueOnce([[reportRow], null])
      .mockResolvedValueOnce([[devRow], null])
      .mockResolvedValueOnce([[{ id: 'report-1' }], null])
      .mockResolvedValueOnce([[], null]);

    const result = await getOrgReport('report-1');

    expect(result.timeline).toEqual([]);
  });

  it('deduplicates commits by SHA across multiple reports', async () => {
    const dupCommit = { ...commitRow };
    const uniqueCommit = { ...commitRow, commit_sha: 'sha2', committed_at: '2026-01-22T10:00:00Z' };

    mockDbExecute
      .mockResolvedValueOnce([[reportRow], null])
      .mockResolvedValueOnce([[devRow], null])
      .mockResolvedValueOnce([[{ id: 'report-1' }, { id: 'report-2' }], null])
      .mockResolvedValueOnce([[commitRow, dupCommit, uniqueCommit], null]);

    const result = await getOrgReport('report-1');

    // sha1 appears twice, sha2 once → 2 unique commits → potentially 2 weeks
    const totalCommits = result.timeline.reduce((sum: number, w: any) => sum + w.commits, 0);
    expect(totalCommits).toBe(2);
  });
});
