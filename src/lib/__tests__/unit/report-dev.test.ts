jest.mock('@octokit/rest', () => ({ Octokit: jest.fn().mockImplementation(() => ({})) }));
jest.mock('@/lib/db/index', () => ({ __esModule: true, default: { execute: jest.fn() } }));
jest.mock('@/lib/report-runner', () => ({ runReport: jest.fn().mockResolvedValue(undefined), requestStop: jest.fn() }));
jest.mock('@/lib/progress-store', () => ({ initProgress: jest.fn(), updateProgress: jest.fn(), getProgress: jest.fn() }));

import { getDevReport, DeveloperNotFoundError } from '@/lib/report/dev';
import { ReportNotFoundError } from '@/lib/report/service';
import db from '@/lib/db/index';

const mockDbExecute = db.execute as jest.Mock;

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

const allDevRow = {
  github_login: 'alice',
  total_prs: 5,
  total_commits: 20,
  lines_added: 1000,
  lines_removed: 200,
  avg_complexity: '3.5',
  impact_score: '87.5',
  pr_percentage: '25.0',
  ai_percentage: '10.0',
};

const commitRow = {
  commit_sha: 'abc123',
  repo: 'acme/frontend',
  commit_message: 'feat: add button',
  pr_number: null,
  pr_title: null,
  type: 'feat',
  complexity: 3,
  risk_level: 'low',
  impact_summary: 'minor',
  lines_added: 50,
  lines_removed: 10,
  committed_at: '2026-01-15T10:00:00Z',
  ai_co_authored: false,
  ai_tool_name: null,
  maybe_ai: false,
};

const timelineCommitRow = {
  commit_sha: 'abc123',
  committed_at: '2026-01-15T10:00:00Z',
  lines_added: 50,
  lines_removed: 10,
  complexity: 3,
  type: 'feat',
  ai_co_authored: false,
  maybe_ai: false,
};

function setupHappyPath() {
  mockDbExecute
    .mockResolvedValueOnce([[reportRow], null])        // report metadata
    .mockResolvedValueOnce([[devRow], null])            // this dev's stats
    .mockResolvedValueOnce([[allDevRow], null])         // all devs stats
    .mockResolvedValueOnce([[commitRow], null])         // this dev's commits
    .mockResolvedValueOnce([[{ id: 'report-1' }], null]) // all report IDs for org
    .mockResolvedValueOnce([[timelineCommitRow], null]); // timeline commits
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDbExecute.mockResolvedValue([[], null]);
});

describe('getDevReport', () => {
  it('returns correct shape { report, developer, allDevelopers, commits, timeline }', async () => {
    setupHappyPath();

    const result = await getDevReport('report-1', 'alice');

    expect(result).toHaveProperty('report');
    expect(result).toHaveProperty('developer');
    expect(result).toHaveProperty('allDevelopers');
    expect(result).toHaveProperty('commits');
    expect(result).toHaveProperty('timeline');
    expect(result.report).toEqual(reportRow);
    expect(result.allDevelopers).toHaveLength(1);
    expect(result.commits).toHaveLength(1);
    expect(result.timeline).toBeInstanceOf(Array);
  });

  it('throws ReportNotFoundError when report is missing', async () => {
    mockDbExecute.mockResolvedValueOnce([[], null]);

    await expect(getDevReport('missing-id', 'alice')).rejects.toThrow(ReportNotFoundError);
    await expect(getDevReport('missing-id', 'alice')).rejects.toThrow('missing-id');
  });

  it('throws DeveloperNotFoundError when dev not in report', async () => {
    mockDbExecute
      .mockResolvedValueOnce([[reportRow], null]) // report found
      .mockResolvedValueOnce([[], null])           // dev not found
      .mockResolvedValueOnce([[reportRow], null]) // report found (second call)
      .mockResolvedValueOnce([[], null]);          // dev not found (second call)

    await expect(getDevReport('report-1', 'unknown')).rejects.toThrow(DeveloperNotFoundError);
    await expect(getDevReport('report-1', 'unknown')).rejects.toThrow('unknown');
  });

  it('parses JSON string columns (type_breakdown, active_repos)', async () => {
    setupHappyPath();

    const result = await getDevReport('report-1', 'alice');

    expect(result.developer.type_breakdown).toEqual({ feat: 5, fix: 3 });
    expect(result.developer.active_repos).toEqual(['repo-a', 'repo-b']);
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
      .mockResolvedValueOnce([[allDevRow], null])
      .mockResolvedValueOnce([[commitRow], null])
      .mockResolvedValueOnce([[{ id: 'report-1' }], null])
      .mockResolvedValueOnce([[], null]);

    const result = await getDevReport('report-1', 'alice');

    expect(result.developer.type_breakdown).toEqual({ feat: 5, fix: 3 });
    expect(result.developer.active_repos).toEqual(['repo-a', 'repo-b']);
  });

  it('timeline has NO activeDevs field (trackDevs not used)', async () => {
    setupHappyPath();

    const result = await getDevReport('report-1', 'alice');

    expect(result.timeline).toHaveLength(1);
    expect(result.timeline[0]).not.toHaveProperty('activeDevs');
  });

  it('deduplicates timeline commits by SHA', async () => {
    const dupCommit = { ...timelineCommitRow };
    const uniqueCommit = { ...timelineCommitRow, commit_sha: 'def456', committed_at: '2026-01-22T10:00:00Z' };

    mockDbExecute
      .mockResolvedValueOnce([[reportRow], null])
      .mockResolvedValueOnce([[devRow], null])
      .mockResolvedValueOnce([[allDevRow], null])
      .mockResolvedValueOnce([[commitRow], null])
      .mockResolvedValueOnce([[{ id: 'report-1' }, { id: 'report-2' }], null])
      .mockResolvedValueOnce([[timelineCommitRow, dupCommit, uniqueCommit], null]);

    const result = await getDevReport('report-1', 'alice');

    const totalCommits = result.timeline.reduce((sum: number, w: any) => sum + w.commits, 0);
    expect(totalCommits).toBe(2);
  });

  it('returns empty timeline when no commits exist', async () => {
    mockDbExecute
      .mockResolvedValueOnce([[reportRow], null])
      .mockResolvedValueOnce([[devRow], null])
      .mockResolvedValueOnce([[allDevRow], null])
      .mockResolvedValueOnce([[commitRow], null])
      .mockResolvedValueOnce([[{ id: 'report-1' }], null])
      .mockResolvedValueOnce([[], null]);

    const result = await getDevReport('report-1', 'alice');

    expect(result.timeline).toEqual([]);
  });
});

describe('DeveloperNotFoundError', () => {
  it('has correct name and message', () => {
    const err = new DeveloperNotFoundError('bob');
    expect(err.name).toBe('DeveloperNotFoundError');
    expect(err.message).toContain('bob');
    expect(err instanceof Error).toBe(true);
  });
});
