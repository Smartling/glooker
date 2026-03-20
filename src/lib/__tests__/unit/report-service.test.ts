jest.mock('@octokit/rest', () => ({ Octokit: jest.fn().mockImplementation(() => ({})) }));
jest.mock('@/lib/db/index', () => ({ __esModule: true, default: { execute: jest.fn() } }));
jest.mock('@/lib/report-runner', () => ({ runReport: jest.fn().mockResolvedValue(undefined), requestStop: jest.fn() }));
jest.mock('@/lib/progress-store', () => ({ initProgress: jest.fn(), updateProgress: jest.fn(), getProgress: jest.fn() }));
jest.mock('uuid', () => ({ v4: jest.fn().mockReturnValue('mock-report-id') }));

import {
  listReports,
  createReport,
  getReport,
  deleteReport,
  getReportProgress,
  stopReport,
  resumeReport,
  ReportNotFoundError,
  ReportNotRunningError,
  ReportAlreadyCompletedError,
} from '@/lib/report/service';
import db from '@/lib/db/index';
import { runReport, requestStop } from '@/lib/report-runner';
import { initProgress, updateProgress, getProgress } from '@/lib/progress-store';

const mockDbExecute = db.execute as jest.Mock;
const mockRunReport = runReport as jest.Mock;
const mockRequestStop = requestStop as jest.Mock;
const mockInitProgress = initProgress as jest.Mock;
const mockUpdateProgress = updateProgress as jest.Mock;
const mockGetProgress = getProgress as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockDbExecute.mockResolvedValue([[], null]);
  mockGetProgress.mockReturnValue(null);
});

describe('listReports', () => {
  it('returns rows from DB', async () => {
    const rows = [
      { id: 'r1', org: 'acme', period_days: 30, status: 'completed', created_at: '2026-01-01', completed_at: '2026-01-01' },
      { id: 'r2', org: 'acme', period_days: 14, status: 'pending',   created_at: '2026-01-02', completed_at: null },
    ];
    mockDbExecute.mockResolvedValue([rows, null]);

    const result = await listReports();
    expect(result).toEqual(rows);
    expect(mockDbExecute).toHaveBeenCalledTimes(1);
  });
});

describe('createReport', () => {
  it('inserts into DB, calls initProgress, calls runReport (fire-and-forget), returns id', async () => {
    mockDbExecute.mockResolvedValue([{ affectedRows: 1 }, null]);

    const id = await createReport({ org: 'acme', periodDays: 30 });

    expect(id).toBe('mock-report-id');
    expect(mockDbExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO reports'),
      ['mock-report-id', 'acme', 30],
    );
    expect(mockInitProgress).toHaveBeenCalledWith('mock-report-id');
    expect(mockRunReport).toHaveBeenCalledWith('mock-report-id', 'acme', 30, false, false);
  });

  it('passes testMode=true to runReport when specified', async () => {
    mockDbExecute.mockResolvedValue([{ affectedRows: 1 }, null]);

    await createReport({ org: 'acme', periodDays: 14, testMode: true });

    expect(mockRunReport).toHaveBeenCalledWith('mock-report-id', 'acme', 14, false, true);
  });
});

describe('getReport', () => {
  it('returns { report, developers } with parsed JSON columns', async () => {
    const reportRow = { id: 'r1', org: 'acme', period_days: 30, status: 'completed', error: null, created_at: '2026-01-01', completed_at: '2026-01-01' };
    const devRow = {
      github_login: 'alice',
      github_name: 'Alice',
      avatar_url: 'alice.png',
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

    mockDbExecute
      .mockResolvedValueOnce([[reportRow], null])
      .mockResolvedValueOnce([[devRow], null]);

    const result = await getReport('r1');

    expect(result.report).toEqual(reportRow);
    expect(result.developers).toHaveLength(1);
    expect(result.developers[0].type_breakdown).toEqual({ feat: 5, fix: 3 });
    expect(result.developers[0].active_repos).toEqual(['repo-a', 'repo-b']);
  });

  it('handles already-parsed JSON columns (objects/arrays from MySQL)', async () => {
    const reportRow = { id: 'r1', org: 'acme', period_days: 30, status: 'completed', error: null, created_at: '2026-01-01', completed_at: '2026-01-01' };
    const devRow = {
      github_login: 'bob',
      github_name: 'Bob',
      avatar_url: 'bob.png',
      total_prs: 2,
      total_commits: 10,
      lines_added: 500,
      lines_removed: 100,
      avg_complexity: '2.0',
      impact_score: '50.0',
      pr_percentage: '20.0',
      ai_percentage: '5.0',
      type_breakdown: { feat: 2 },
      active_repos: ['repo-x'],
    };

    mockDbExecute
      .mockResolvedValueOnce([[reportRow], null])
      .mockResolvedValueOnce([[devRow], null]);

    const result = await getReport('r1');

    expect(result.developers[0].type_breakdown).toEqual({ feat: 2 });
    expect(result.developers[0].active_repos).toEqual(['repo-x']);
  });

  it('throws ReportNotFoundError when no rows returned', async () => {
    mockDbExecute.mockResolvedValue([[], null]);

    await expect(getReport('missing-id')).rejects.toThrow(ReportNotFoundError);
  });
});

describe('deleteReport', () => {
  it('succeeds when affectedRows > 0', async () => {
    mockDbExecute.mockResolvedValue([{ affectedRows: 1 }, null]);

    await expect(deleteReport('r1')).resolves.toBeUndefined();
    expect(mockDbExecute).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM reports'),
      ['r1'],
    );
  });

  it('throws ReportNotFoundError when affectedRows = 0', async () => {
    mockDbExecute.mockResolvedValue([{ affectedRows: 0 }, null]);

    await expect(deleteReport('missing-id')).rejects.toThrow(ReportNotFoundError);
  });
});

describe('getReportProgress', () => {
  it('returns from memory store if available', async () => {
    const progress = {
      status: 'running' as const,
      step: 'Analyzing...',
      totalRepos: 10,
      processedRepos: 5,
      totalDevelopers: 20,
      completedDevelopers: 8,
      logs: [],
    };
    mockGetProgress.mockReturnValue(progress);

    const result = await getReportProgress('r1');

    expect(result).toEqual(progress);
    expect(mockDbExecute).not.toHaveBeenCalled();
  });

  it('falls back to DB for running report and counts completed developers', async () => {
    mockGetProgress.mockReturnValue(null);
    mockDbExecute
      .mockResolvedValueOnce([[{ status: 'running', error: null }], null])
      .mockResolvedValueOnce([[{ completed: 5 }], null]);

    const result = await getReportProgress('r1');

    expect(result.status).toBe('running');
    expect(result.completedDevelopers).toBe(5);
    expect(mockDbExecute).toHaveBeenCalledTimes(2);
  });

  it('falls back to DB for non-running status', async () => {
    mockGetProgress.mockReturnValue(null);
    mockDbExecute.mockResolvedValueOnce([[{ status: 'completed', error: null }], null]);

    const result = await getReportProgress('r1');

    expect(result.status).toBe('completed');
    expect(result.completedDevelopers).toBe(0);
    expect(mockDbExecute).toHaveBeenCalledTimes(1);
  });

  it('throws ReportNotFoundError when report not in memory or DB', async () => {
    mockGetProgress.mockReturnValue(null);
    mockDbExecute.mockResolvedValue([[], null]);

    await expect(getReportProgress('missing-id')).rejects.toThrow(ReportNotFoundError);
  });
});

describe('stopReport', () => {
  it('calls requestStop, updates DB, updates progress', async () => {
    mockDbExecute
      .mockResolvedValueOnce([[{ status: 'running' }], null])
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]);

    await stopReport('r1');

    expect(mockRequestStop).toHaveBeenCalledWith('r1');
    expect(mockDbExecute).toHaveBeenCalledWith(
      expect.stringContaining("status = 'stopped'"),
      ['r1'],
    );
    expect(mockUpdateProgress).toHaveBeenCalledWith('r1', expect.objectContaining({ status: 'failed' }));
  });

  it('throws ReportNotFoundError when report does not exist', async () => {
    mockDbExecute.mockResolvedValue([[], null]);

    await expect(stopReport('missing-id')).rejects.toThrow(ReportNotFoundError);
  });

  it('throws ReportNotRunningError when status is not running', async () => {
    mockDbExecute.mockResolvedValue([[{ status: 'completed' }], null]);

    await expect(stopReport('r1')).rejects.toThrow(ReportNotRunningError);
  });
});

describe('resumeReport', () => {
  it('resets status, calls initProgress, calls runReport with resume=true', async () => {
    mockDbExecute
      .mockResolvedValueOnce([[{ id: 'r1', org: 'acme', period_days: 30, status: 'stopped' }], null])
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]);

    await resumeReport('r1');

    expect(mockDbExecute).toHaveBeenCalledWith(
      expect.stringContaining("status = 'running'"),
      ['r1'],
    );
    expect(mockInitProgress).toHaveBeenCalledWith('r1');
    expect(mockRunReport).toHaveBeenCalledWith('r1', 'acme', 30, true);
  });

  it('throws ReportNotFoundError when report does not exist', async () => {
    mockDbExecute.mockResolvedValue([[], null]);

    await expect(resumeReport('missing-id')).rejects.toThrow(ReportNotFoundError);
  });

  it('throws ReportAlreadyCompletedError when status is completed', async () => {
    mockDbExecute.mockResolvedValue([[{ id: 'r1', org: 'acme', period_days: 30, status: 'completed' }], null]);

    await expect(resumeReport('r1')).rejects.toThrow(ReportAlreadyCompletedError);
  });
});
