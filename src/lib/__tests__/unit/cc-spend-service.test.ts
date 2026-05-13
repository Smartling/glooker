jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));
jest.mock('@/lib/db/index', () => ({
  __esModule: true,
  default: { execute: jest.fn().mockResolvedValue([[], null]) },
}));
jest.mock('@/lib/cc-spend/provider', () => {
  const realModule = jest.requireActual('@/lib/cc-spend/provider');
  return {
    ...realModule,
    getCcSpendProvider: jest.fn(),
  };
});

import { refreshCcSpendForReport } from '@/lib/cc-spend/service';
import { getCcSpendProvider } from '@/lib/cc-spend/provider';
import db from '@/lib/db/index';

const mockExec = db.execute as jest.Mock;
const mockGetProvider = getCcSpendProvider as jest.Mock;

beforeEach(() => {
  mockExec.mockReset();
  mockExec.mockResolvedValue([[], null]);
  mockGetProvider.mockReset();
});

describe('refreshCcSpendForReport', () => {
  it('computes the right period from report.created_at and period_days', async () => {
    mockExec.mockResolvedValueOnce([[{
      id: 'rep1',
      created_at: '2026-04-15T00:00:00Z',
      period_days: 14,
    }], null]);
    mockExec.mockResolvedValue([{ affectedRows: 1 }, null]);
    mockExec.mockResolvedValueOnce([[{ id: 'rep1' }], null]);
    mockExec.mockResolvedValue([{ affectedRows: 1 }, null]);
    // Provide iterable results for apply's commit_analyses + user_mappings SELECTs
    // (these come after the report lookup and UPDATE reset).
    mockExec.mockResolvedValueOnce([{ affectedRows: 1 }, null]); // UPDATE reset
    mockExec.mockResolvedValueOnce([[], null]); // SELECT commit_analyses
    mockExec.mockResolvedValueOnce([[], null]); // SELECT user_mappings
    mockExec.mockResolvedValueOnce([{ affectedRows: 1 }, null]); // UPDATE reports cc_period

    const pull = jest.fn().mockResolvedValue([]);
    mockGetProvider.mockReturnValue({ pullByPeriod: pull, probe: jest.fn() });

    await refreshCcSpendForReport('rep1');

    expect(pull).toHaveBeenCalledTimes(1);
    const [start, end] = pull.mock.calls[0];
    expect(end).toBe('2026-04-15');
    expect(start).toBe('2026-04-01');
  });

  it('returns the aggregated result from applyCcSpend', async () => {
    mockExec.mockResolvedValueOnce([[{
      id: 'rep1',
      created_at: '2026-04-15T00:00:00Z',
      period_days: 14,
    }], null]);
    mockExec.mockResolvedValueOnce([[{ id: 'rep1' }], null]);
    mockExec.mockResolvedValueOnce([{ affectedRows: 1 }, null]);
    mockExec.mockResolvedValueOnce([[{ email: 'alice@example.com', github_login: 'alice' }], null]);
    mockExec.mockResolvedValueOnce([[], null]);
    mockExec.mockResolvedValueOnce([{ affectedRows: 1 }, null]);
    mockExec.mockResolvedValueOnce([{ affectedRows: 1 }, null]);

    const pull = jest.fn().mockResolvedValue([
      { email: 'alice@example.com', costCents: 4000, requests: 25 },
    ]);
    mockGetProvider.mockReturnValue({ pullByPeriod: pull, probe: jest.fn() });

    const result = await refreshCcSpendForReport('rep1');
    expect(result.matched).toBe(1);
    expect(result.totalSpendUsd).toBe(40);
    expect(result.periodStart).toBe('2026-04-01');
    expect(result.periodEnd).toBe('2026-04-15');
  });

  it('throws ReportNotFoundError if the report does not exist', async () => {
    mockExec.mockResolvedValueOnce([[], null]);
    mockGetProvider.mockReturnValue({ pullByPeriod: jest.fn(), probe: jest.fn() });

    await expect(refreshCcSpendForReport('missing')).rejects.toThrow(/Report not found/);
  });

  it('propagates provider errors', async () => {
    mockExec.mockResolvedValueOnce([[{
      id: 'rep1',
      created_at: '2026-04-15T00:00:00Z',
      period_days: 14,
    }], null]);
    mockGetProvider.mockReturnValue({
      pullByPeriod: jest.fn().mockRejectedValue(new Error('Anthropic API 401')),
      probe: jest.fn(),
    });

    await expect(refreshCcSpendForReport('rep1')).rejects.toThrow(/401/);
  });
});
