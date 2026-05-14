/**
 * End-to-end integration test for CC spend enrichment.
 *
 * Unlike report-runner.test.ts (which fully mocks refreshCcSpendForReport)
 * and cc-spend-apply.test.ts (which mocks the DB execute calls), this test
 * exercises the FULL real path:
 *
 *   refreshCcSpendForReport → real applyCcSpend → real SQL → in-memory SQLite
 *
 * Only the provider's network layer is replaced (via
 * __resetCcSpendProviderForTest + a fake provider injected through the
 * factory module). This catches regressions in apply.ts, the transaction
 * wrapper, the three-bucket counting, and the SQL translator that all the
 * other tests skip.
 */

jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));

// Build a single in-memory SQLite DB and expose it as the default export
// of @/lib/db/index. The proxy in index.ts is lazy, so this mock fully
// replaces the real DB before the cc-spend modules import it.
let testDb: import('@/lib/db').DB;

jest.mock('@/lib/db/index', () => {
  // Lazily build the SQLite test DB the first time the module is imported,
  // so the schema is created once per test file.
  const path = require('path');
  process.env.SQLITE_PATH = ':memory:';
  const { createSQLiteDB } = require(path.resolve(__dirname, '../../db/sqlite'));
  const db = createSQLiteDB();
  // Save it for the test bodies below.
  // We attach to a known global so the outer scope can reach it.
  (globalThis as any).__cc_test_db__ = db;
  return { __esModule: true, default: db };
});

import db from '@/lib/db/index';
import { refreshCcSpendForReport } from '@/lib/cc-spend/service';
import {
  __resetCcSpendProviderForTest,
  type CcSpendProvider,
  type PerEmailAggregate,
} from '@/lib/cc-spend/provider';

// Mock the provider factory so getCcSpendProvider() returns whatever the
// current test injects. Each test sets the aggregates that the fake
// provider will return.
let providerAggregates: PerEmailAggregate[] = [];
const fakeProvider: CcSpendProvider = {
  pullByPeriod: jest.fn(async () => providerAggregates),
  probe: jest.fn(async () => ({ userCount: 0 })),
};

jest.mock('@/lib/cc-spend/anthropic-provider', () => ({
  createAnthropicCcSpendProvider: () => fakeProvider,
  AnthropicAnalyticsKeyMissingError: class extends Error {},
}));

beforeEach(async () => {
  __resetCcSpendProviderForTest();
  providerAggregates = [];
  (fakeProvider.pullByPeriod as jest.Mock).mockClear();

  // Reset all tables touched by the test.
  testDb = (globalThis as any).__cc_test_db__;
  await testDb.execute(`DELETE FROM developer_stats`);
  await testDb.execute(`DELETE FROM commit_analyses`);
  await testDb.execute(`DELETE FROM user_mappings`);
  await testDb.execute(`DELETE FROM reports`);
});

async function seedReport(): Promise<string> {
  const reportId = 'rep-int-1';
  await testDb.execute(
    `INSERT INTO reports (id, org, period_days, status, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [reportId, 'my-org', 14, 'running', '2026-04-15T00:00:00Z'],
  );
  return reportId;
}

async function seedDeveloperStats(reportId: string, login: string, opts: { ccCost?: number; ccRequests?: number } = {}) {
  await testDb.execute(
    `INSERT INTO developer_stats
       (report_id, github_login, github_name, avatar_url,
        total_prs, total_commits, lines_added, lines_removed,
        avg_complexity, impact_score, pr_percentage, ai_percentage,
        total_jira_issues, total_reviews,
        type_breakdown, active_repos,
        cc_total_cost, cc_requests)
     VALUES (?, ?, ?, ?, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, '{}', '[]', ?, ?)`,
    [reportId, login, login, '', opts.ccCost ?? 0, opts.ccRequests ?? 0],
  );
}

async function seedCommitAnalysis(reportId: string, login: string, email: string) {
  await testDb.execute(
    `INSERT INTO commit_analyses
       (report_id, github_login, author_email, repo, commit_sha,
        commit_message, lines_added, lines_removed,
        complexity, type, impact_summary, risk_level, maybe_ai)
     VALUES (?, ?, ?, ?, ?, ?, 0, 0, 5, 'feature', 'x', 'low', 0)`,
    [reportId, login, email, 'repo-a', `sha-${login}`, 'msg'],
  );
}

describe('CC spend end-to-end (SQLite, real apply)', () => {
  it('happy path: matches one user, leaves another unmapped, and a third without dev_stats', async () => {
    const reportId = await seedReport();

    // alice has a commit (email→login mapped via commit_analyses) AND a dev_stats row.
    await seedDeveloperStats(reportId, 'alice');
    await seedCommitAnalysis(reportId, 'alice', 'alice@example.com');

    // bob has a dev_stats row but NO commit_analyses; we'll add a user_mappings entry
    // so the email-only-via-mappings → no-dev-stats bucket can be exercised too.
    // (intentionally NOT seeding dev_stats for him: see "carol" below for that bucket)

    // carol has a user_mappings entry but NO developer_stats row — she has Claude
    // usage but didn't commit in the window. Bucket: noDevStatsRow.
    await testDb.execute(
      `INSERT INTO user_mappings (org, github_login, jira_account_id, jira_email)
       VALUES (?, ?, ?, ?)`,
      ['my-org', 'carol', 'jira-c', 'carol@example.com'],
    );

    // dave has Claude usage but no mapping anywhere. Bucket: unmappedEmail.

    providerAggregates = [
      { email: 'alice@example.com', costCents: 5000, requests: 100 },
      { email: 'carol@example.com', costCents: 3000, requests: 60 },
      { email: 'dave@example.com',  costCents: 2000, requests: 40 },
    ];

    const result = await refreshCcSpendForReport(reportId);

    expect(result.totalApiUsers).toBe(3);
    expect(result.matched).toBe(1);
    expect(result.noDevStatsRow).toBe(1);
    expect(result.unmappedEmail).toBe(1);
    expect(result.totalSpendUsd).toBeCloseTo(100, 2); // (5000 + 3000 + 2000) / 100

    // Verify alice's dev_stats row was actually written.
    const [aliceRows] = await testDb.execute(
      `SELECT cc_total_cost, cc_requests FROM developer_stats WHERE report_id = ? AND github_login = ?`,
      [reportId, 'alice'],
    ) as [any[], any];
    expect(Number(aliceRows[0].cc_total_cost)).toBe(5000);
    expect(Number(aliceRows[0].cc_requests)).toBe(100);

    // Verify reports row received the period.
    const [periodRows] = await testDb.execute(
      `SELECT cc_period_start, cc_period_end FROM reports WHERE id = ?`,
      [reportId],
    ) as [any[], any];
    expect(periodRows[0].cc_period_start).toBe('2026-04-01');
    expect(periodRows[0].cc_period_end).toBe('2026-04-15');
  });

  it('provider returns empty: all dev_stats rows are zeroed (reset path runs)', async () => {
    const reportId = await seedReport();

    // Pre-seed a row with non-zero cc_total_cost — must be zeroed by the reset
    // statement at the top of applyCcSpend, even though no aggregates arrive.
    await seedDeveloperStats(reportId, 'alice', { ccCost: 999, ccRequests: 88 });
    await seedCommitAnalysis(reportId, 'alice', 'alice@example.com');

    providerAggregates = [];

    const result = await refreshCcSpendForReport(reportId);

    expect(result.totalApiUsers).toBe(0);
    expect(result.matched).toBe(0);
    expect(result.unmappedEmail).toBe(0);
    expect(result.noDevStatsRow).toBe(0);
    expect(result.totalSpendUsd).toBe(0);

    const [rows] = await testDb.execute(
      `SELECT cc_total_cost, cc_requests FROM developer_stats WHERE report_id = ? AND github_login = ?`,
      [reportId, 'alice'],
    ) as [any[], any];
    expect(Number(rows[0].cc_total_cost)).toBe(0);
    expect(Number(rows[0].cc_requests)).toBe(0);
  });

  it('user_mappings fallback works when commit_analyses has no entry for the email', async () => {
    const reportId = await seedReport();

    // bob has a dev_stats row, no commit_analyses, but DOES have a user_mappings entry.
    await seedDeveloperStats(reportId, 'bob');
    await testDb.execute(
      `INSERT INTO user_mappings (org, github_login, jira_account_id, jira_email)
       VALUES (?, ?, ?, ?)`,
      ['my-org', 'bob', 'jira-b', 'bob@example.com'],
    );

    providerAggregates = [
      { email: 'bob@example.com', costCents: 1500, requests: 30 },
    ];

    const result = await refreshCcSpendForReport(reportId);
    expect(result.matched).toBe(1);

    const [bobRows] = await testDb.execute(
      `SELECT cc_total_cost, cc_requests FROM developer_stats WHERE report_id = ? AND github_login = ?`,
      [reportId, 'bob'],
    ) as [any[], any];
    expect(Number(bobRows[0].cc_total_cost)).toBe(1500);
    expect(Number(bobRows[0].cc_requests)).toBe(30);
  });
});
