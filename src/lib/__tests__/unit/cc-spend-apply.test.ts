jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));
jest.mock('@/lib/db/index', () => ({
  __esModule: true,
  default: {
    execute: jest.fn().mockResolvedValue([[], null]),
    // transaction wraps a callback in a BEGIN/COMMIT (or rolls back on throw).
    // Default impl: just invoke the callback with the same db handle so tests
    // can keep stacking mockResolvedValueOnce on execute as before. Override
    // per-test for transaction-specific behavior (e.g. rollback on error).
    transaction: jest.fn(async (fn: any) => fn((require('@/lib/db/index').default))),
  },
}));

import { applyCcSpend } from '@/lib/cc-spend/apply';
import db from '@/lib/db/index';

const mockExec = db.execute as jest.Mock;
const mockTx = db.transaction as jest.Mock;

beforeEach(() => {
  mockExec.mockReset();
  mockExec.mockResolvedValue([[], null]);
  mockTx.mockReset();
  // Default: invoke callback with the same db handle so .execute mocks apply.
  mockTx.mockImplementation(async (fn: any) => fn(db));
});

describe('applyCcSpend', () => {
  function arrangeDbCalls(commitEmails: Array<{ email: string; github_login: string }>, mappings: Array<{ email: string; github_login: string }>) {
    mockExec
      // 1. report lookup (outside tx)
      .mockResolvedValueOnce([[{ id: 'rep1' }], null])
      // 2. reset existing cc_* values (inside tx)
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
      org: 'my-org',
      aggregates: [{ email: 'alice@example.com', costCents: 4000, requests: 25 }],
      periodStart: '2026-04-01',
      periodEnd: '2026-04-14',
    });

    expect(result.matched).toBe(1);
    expect(result.unmappedEmail).toBe(0);
    expect(result.noDevStatsRow).toBe(0);
    expect(result.totalApiUsers).toBe(1);
    expect(result.totalSpendUsd).toBe(40);
    // Find the UPDATE developer_stats call (per-developer update, not the reset)
    const updateCall = mockExec.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('UPDATE developer_stats') && c[0].includes('cc_total_cost = ?'),
    );
    expect(updateCall).toBeDefined();
    expect(updateCall![1]).toEqual([4000, 25, 'rep1', 'alice']);
    // Everything except the initial report lookup must be wrapped in tx.
    expect(mockTx).toHaveBeenCalledTimes(1);
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
      org: 'my-org',
      aggregates: [{ email: 'bob@example.com', costCents: 200, requests: 4 }],
      periodStart: '2026-04-01',
      periodEnd: '2026-04-14',
    });

    expect(result.matched).toBe(1);
  });

  it('counts unmappedEmail when neither source maps the email', async () => {
    arrangeDbCalls([], []);
    mockExec.mockResolvedValueOnce([{ affectedRows: 1 }, null]); // UPDATE reports.cc_period_*

    const result = await applyCcSpend({
      reportId: 'rep1',
      org: 'my-org',
      aggregates: [{ email: 'ghost@example.com', costCents: 500, requests: 2 }],
      periodStart: '2026-04-01',
      periodEnd: '2026-04-14',
    });

    expect(result.matched).toBe(0);
    expect(result.unmappedEmail).toBe(1);
    expect(result.noDevStatsRow).toBe(0);
    expect(result.totalApiUsers).toBe(1);
    expect(result.totalSpendUsd).toBe(5);
  });

  it('counts noDevStatsRow when email maps to login but no dev_stats row exists', async () => {
    // Mapping resolves (login=carol from user_mappings) but the UPDATE returns
    // affectedRows=0 — the user has Anthropic usage but no commits in the
    // analyzed window, so no developer_stats row was created for them.
    arrangeDbCalls(
      [],
      [{ email: 'carol@example.com', github_login: 'carol' }],
    );
    mockExec.mockResolvedValueOnce([{ affectedRows: 0 }, null]); // UPDATE devstats — no row
    mockExec.mockResolvedValueOnce([{ affectedRows: 1 }, null]); // UPDATE reports

    const result = await applyCcSpend({
      reportId: 'rep1',
      org: 'my-org',
      aggregates: [{ email: 'carol@example.com', costCents: 700, requests: 9 }],
      periodStart: '2026-04-01',
      periodEnd: '2026-04-14',
    });

    expect(result.matched).toBe(0);
    expect(result.unmappedEmail).toBe(0);
    expect(result.noDevStatsRow).toBe(1);
    expect(result.totalApiUsers).toBe(1);
    expect(result.totalSpendUsd).toBe(7);
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
      org: 'my-org',
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
      org: 'my-org',
      aggregates: [],
      periodStart: '2026-04-01',
      periodEnd: '2026-04-14',
    })).rejects.toThrow(/Report not found/);
    // The transaction must NOT have been opened for an unknown report —
    // the existence check is outside the tx.
    expect(mockTx).not.toHaveBeenCalled();
  });

  it('scopes the user_mappings fallback query by org', async () => {
    arrangeDbCalls(
      [],
      [{ email: 'bob@example.com', github_login: 'bob-gh' }],
    );
    mockExec.mockResolvedValueOnce([{ affectedRows: 1 }, null]); // UPDATE devstats
    mockExec.mockResolvedValueOnce([{ affectedRows: 1 }, null]); // UPDATE reports

    await applyCcSpend({
      reportId: 'rep1',
      org: 'acme-org',
      aggregates: [{ email: 'bob@example.com', costCents: 200, requests: 4 }],
      periodStart: '2026-04-01',
      periodEnd: '2026-04-14',
    });

    const mappingsCall = mockExec.mock.calls.find(
      (c) =>
        typeof c[0] === 'string' &&
        c[0].includes('FROM user_mappings') &&
        c[0].includes('WHERE org = ?'),
    );
    expect(mappingsCall).toBeDefined();
    expect(mappingsCall![1]).toEqual(['acme-org']);
  });

  it('rolls back the apply transaction when a mid-loop UPDATE throws', async () => {
    // Simulate a driver error halfway through the per-user UPDATE loop.
    // Override transaction to assert it rejected (caller would have rolled back).
    arrangeDbCalls(
      [
        { email: 'alice@example.com', github_login: 'alice' },
        { email: 'bob@example.com',   github_login: 'bob' },
      ],
      [],
    );
    // First per-user UPDATE succeeds, second throws.
    mockExec.mockResolvedValueOnce([{ affectedRows: 1 }, null]);
    mockExec.mockRejectedValueOnce(new Error('connection lost'));

    // The default mockTx impl calls fn() — if fn throws, the impl re-throws.
    // We want to assert the rollback path: confirm tx callback rejected.
    let txCallbackRejected = false;
    mockTx.mockImplementation(async (fn: any) => {
      try {
        return await fn(db);
      } catch (err) {
        txCallbackRejected = true;
        throw err;
      }
    });

    await expect(applyCcSpend({
      reportId: 'rep1',
      org: 'my-org',
      aggregates: [
        { email: 'alice@example.com', costCents: 100, requests: 1 },
        { email: 'bob@example.com',   costCents: 200, requests: 2 },
      ],
      periodStart: '2026-04-01',
      periodEnd: '2026-04-14',
    })).rejects.toThrow(/connection lost/);

    expect(txCallbackRejected).toBe(true);
    // The final UPDATE reports.cc_period_* must not have been issued —
    // the transaction wrapper rolls back before that statement is reached.
    const periodUpdateCall = mockExec.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('UPDATE reports SET cc_period_start'),
    );
    expect(periodUpdateCall).toBeUndefined();
  });
});
