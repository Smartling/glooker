jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));
jest.mock('@/lib/db/index', () => ({
  __esModule: true,
  default: {
    execute: jest.fn().mockResolvedValue([[], null]),
    // applyCcSpend wraps the reset + per-user updates in a transaction. By
    // default, invoke the callback with the same db handle so existing
    // .execute mocks continue to apply.
    transaction: jest.fn(async (fn: any) => fn(require('@/lib/db/index').default)),
  },
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
      org: 'my-org',
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
      org: 'my-org',
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
      org: 'my-org',
      created_at: '2026-04-15T00:00:00Z',
      period_days: 14,
    }], null]);
    mockGetProvider.mockReturnValue({
      pullByPeriod: jest.fn().mockRejectedValue(new Error('Anthropic API 401')),
      probe: jest.fn(),
    });

    await expect(refreshCcSpendForReport('rep1')).rejects.toThrow(/401/);
  });

  it('clamps period_days=30 to a 30-day window without truncation log', async () => {
    mockExec.mockResolvedValueOnce([[{
      id: 'rep1',
      org: 'my-org',
      created_at: '2026-05-01T00:00:00Z',
      period_days: 30,
    }], null]);
    mockExec.mockResolvedValueOnce([[{ id: 'rep1' }], null]);
    mockExec.mockResolvedValueOnce([{ affectedRows: 1 }, null]);
    mockExec.mockResolvedValueOnce([[], null]);
    mockExec.mockResolvedValueOnce([[], null]);
    mockExec.mockResolvedValueOnce([{ affectedRows: 1 }, null]);

    const pull = jest.fn().mockResolvedValue([]);
    mockGetProvider.mockReturnValue({ pullByPeriod: pull, probe: jest.fn() });
    const log = jest.fn();

    await refreshCcSpendForReport('rep1', log);

    const [start, end] = pull.mock.calls[0];
    expect(end).toBe('2026-05-01');
    expect(start).toBe('2026-04-01'); // 30 days before
    expect(log.mock.calls.flat().some(m => typeof m === 'string' && m.includes('truncating'))).toBe(false);
  });

  it('truncates period_days>30 to 30 days and logs', async () => {
    mockExec.mockResolvedValueOnce([[{
      id: 'rep1',
      org: 'my-org',
      created_at: '2026-05-01T00:00:00Z',
      period_days: 60,
    }], null]);
    mockExec.mockResolvedValueOnce([[{ id: 'rep1' }], null]);
    mockExec.mockResolvedValueOnce([{ affectedRows: 1 }, null]);
    mockExec.mockResolvedValueOnce([[], null]);
    mockExec.mockResolvedValueOnce([[], null]);
    mockExec.mockResolvedValueOnce([{ affectedRows: 1 }, null]);

    const pull = jest.fn().mockResolvedValue([]);
    mockGetProvider.mockReturnValue({ pullByPeriod: pull, probe: jest.fn() });
    const log = jest.fn();

    await refreshCcSpendForReport('rep1', log);

    const [start, end] = pull.mock.calls[0];
    expect(end).toBe('2026-05-01');
    expect(start).toBe('2026-04-01'); // 30 days, not 60
    expect(log.mock.calls.flat().some(m => typeof m === 'string' && /period_days=60.*30-day max/.test(m))).toBe(true);
  });

  it('defaults invalid period_days=0 to 14 and logs', async () => {
    mockExec.mockResolvedValueOnce([[{
      id: 'rep1',
      org: 'my-org',
      created_at: '2026-05-01T00:00:00Z',
      period_days: 0,
    }], null]);
    mockExec.mockResolvedValueOnce([[{ id: 'rep1' }], null]);
    mockExec.mockResolvedValueOnce([{ affectedRows: 1 }, null]);
    mockExec.mockResolvedValueOnce([[], null]);
    mockExec.mockResolvedValueOnce([[], null]);
    mockExec.mockResolvedValueOnce([{ affectedRows: 1 }, null]);

    const pull = jest.fn().mockResolvedValue([]);
    mockGetProvider.mockReturnValue({ pullByPeriod: pull, probe: jest.fn() });
    const log = jest.fn();

    await refreshCcSpendForReport('rep1', log);

    const [start, end] = pull.mock.calls[0];
    expect(end).toBe('2026-05-01');
    expect(start).toBe('2026-04-17'); // 14 days
    expect(log.mock.calls.flat().some(m => typeof m === 'string' && /period_days invalid/.test(m))).toBe(true);
  });

  // Regression: created_at is read by `new Date(...)` and then formatted via
  // .toISOString().slice(0,10). The result must be the same UTC date whether
  // mysql2 (with timezone:'Z') hands us a Date built from a UTC ISO string,
  // or better-sqlite3 hands us the raw ISO string. Both shapes must produce
  // the same periodStart / periodEnd — otherwise the same report refreshed
  // in two different container TZs disagrees on the analysis window.
  describe.each([
    ['raw ISO string (sqlite shape)', '2026-04-15T00:00:00Z' as any],
    ['Date built from UTC ISO (mysql2 timezone:Z shape)', new Date('2026-04-15T00:00:00Z')],
  ])('TZ-stable period boundaries with %s', (_label, createdAt) => {
    const originalTZ = process.env.TZ;
    afterAll(() => {
      if (originalTZ === undefined) delete process.env.TZ;
      else process.env.TZ = originalTZ;
    });
    beforeAll(() => {
      // Best-effort: even though Node caches the TZ at startup, setting this
      // gives a stronger signal to anyone reading the test that we care.
      process.env.TZ = 'America/Los_Angeles';
    });

    it('derives the same UTC YYYY-MM-DD window from either shape', async () => {
      mockExec.mockReset();
      mockExec.mockResolvedValueOnce([[{
        id: 'rep1',
        org: 'my-org',
        created_at: createdAt,
        period_days: 14,
      }], null]);
      // Subsequent calls inside applyCcSpend: report lookup, UPDATE reset,
      // SELECT commit_analyses, SELECT user_mappings, UPDATE reports cc_period.
      mockExec.mockResolvedValueOnce([[{ id: 'rep1' }], null]);
      mockExec.mockResolvedValueOnce([{ affectedRows: 1 }, null]);
      mockExec.mockResolvedValueOnce([[], null]);
      mockExec.mockResolvedValueOnce([[], null]);
      mockExec.mockResolvedValueOnce([{ affectedRows: 1 }, null]);

      const pull = jest.fn().mockResolvedValue([]);
      mockGetProvider.mockReturnValue({ pullByPeriod: pull, probe: jest.fn() });

      const result = await refreshCcSpendForReport('rep1');

      expect(pull).toHaveBeenCalledWith('2026-04-01', '2026-04-15', undefined);
      expect(result.periodStart).toBe('2026-04-01');
      expect(result.periodEnd).toBe('2026-04-15');
    });
  });
});
