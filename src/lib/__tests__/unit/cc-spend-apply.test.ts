jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));
jest.mock('@/lib/db/index', () => ({
  __esModule: true,
  default: { execute: jest.fn().mockResolvedValue([[], null]) },
}));

import { applyCcSpend } from '@/lib/cc-spend/apply';
import db from '@/lib/db/index';

const mockExec = db.execute as jest.Mock;

beforeEach(() => {
  mockExec.mockReset();
  mockExec.mockResolvedValue([[], null]);
});

describe('applyCcSpend', () => {
  function arrangeDbCalls(commitEmails: Array<{ email: string; github_login: string }>, mappings: Array<{ email: string; github_login: string }>) {
    mockExec
      // 1. report lookup
      .mockResolvedValueOnce([[{ id: 'rep1' }], null])
      // 2. reset existing cc_* values
      .mockResolvedValueOnce([{ affectedRows: 1 }, null])
      // 3. commit_analyses author_email lookup
      .mockResolvedValueOnce([commitEmails, null])
      // 4. user_mappings jira_email fallback lookup
      .mockResolvedValueOnce([mappings, null]);
    // Any further UPDATE devstats calls — match each return with affectedRows
  }

  it('matches users by commit_analyses email and writes cc_* columns', async () => {
    arrangeDbCalls(
      [{ email: 'alice@example.com', github_login: 'alice' }],
      [],
    );
    // UPDATE developer_stats — assume the row exists
    mockExec.mockResolvedValueOnce([{ affectedRows: 1 }, null]);
    // UPDATE reports.cc_period_*
    mockExec.mockResolvedValueOnce([{ affectedRows: 1 }, null]);

    const result = await applyCcSpend({
      reportId: 'rep1',
      aggregates: [{ email: 'alice@example.com', costCents: 4000, requests: 25 }],
      periodStart: '2026-04-01',
      periodEnd: '2026-04-14',
    });

    expect(result.matched).toBe(1);
    expect(result.unmatched).toBe(0);
    expect(result.totalApiUsers).toBe(1);
    expect(result.totalSpendUsd).toBe(40);
    // Find the UPDATE developer_stats call (per-developer update, not the reset)
    const updateCall = mockExec.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('UPDATE developer_stats') && c[0].includes('cc_total_cost = ?'),
    );
    expect(updateCall).toBeDefined();
    expect(updateCall![1]).toEqual([4000, 25, 'rep1', 'alice']);
  });

  it('falls back to user_mappings when commit_analyses lacks the email', async () => {
    arrangeDbCalls(
      [],
      [{ email: 'bob@example.com', github_login: 'bob-gh' }],
    );
    mockExec.mockResolvedValueOnce([{ affectedRows: 1 }, null]);
    mockExec.mockResolvedValueOnce([{ affectedRows: 1 }, null]);

    const result = await applyCcSpend({
      reportId: 'rep1',
      aggregates: [{ email: 'bob@example.com', costCents: 200, requests: 4 }],
      periodStart: '2026-04-01',
      periodEnd: '2026-04-14',
    });

    expect(result.matched).toBe(1);
  });

  it('counts unmatched when neither source maps the email', async () => {
    arrangeDbCalls([], []);
    mockExec.mockResolvedValueOnce([{ affectedRows: 1 }, null]); // UPDATE reports.cc_period_*

    const result = await applyCcSpend({
      reportId: 'rep1',
      aggregates: [{ email: 'ghost@example.com', costCents: 500, requests: 2 }],
      periodStart: '2026-04-01',
      periodEnd: '2026-04-14',
    });

    expect(result.matched).toBe(0);
    expect(result.unmatched).toBe(1);
    expect(result.totalApiUsers).toBe(1);
    expect(result.totalSpendUsd).toBe(5);
  });

  it('lowercases emails consistently across all sources', async () => {
    arrangeDbCalls(
      [{ email: 'mixedcase@example.com', github_login: 'mixed' }],
      [],
    );
    mockExec.mockResolvedValueOnce([{ affectedRows: 1 }, null]);
    mockExec.mockResolvedValueOnce([{ affectedRows: 1 }, null]);

    const result = await applyCcSpend({
      reportId: 'rep1',
      aggregates: [{ email: 'MixedCase@Example.com', costCents: 100, requests: 1 }],
      periodStart: '2026-04-01',
      periodEnd: '2026-04-14',
    });

    expect(result.matched).toBe(1);
  });

  it('throws ReportNotFoundError when the report id is unknown', async () => {
    mockExec.mockResolvedValueOnce([[], null]); // report lookup empty

    await expect(applyCcSpend({
      reportId: 'missing',
      aggregates: [],
      periodStart: '2026-04-01',
      periodEnd: '2026-04-14',
    })).rejects.toThrow(/Report not found/);
  });
});
