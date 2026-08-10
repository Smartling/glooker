import db from '@/lib/db';
import type { PerEmailAggregate } from './provider';
import { buildEmailToLoginMap } from './identity';

export class ReportNotFoundError extends Error {
  constructor(id: string) {
    super(`Report not found: ${id}`);
    this.name = 'ReportNotFoundError';
  }
}

export interface CcApplyResult {
  /** Email->login resolved AND developer_stats row updated (affectedRows > 0). */
  matched: number;
  /** No email->github_login mapping found in commit_analyses or user_mappings. */
  unmappedEmail: number;
  /** Mapping resolved but no developer_stats row exists for this report+login
   *  — i.e. a user with Claude usage but no commits in the analyzed window. */
  noDevStatsRow: number;
  totalApiUsers: number;
  totalSpendUsd: number;
  periodStart: string;
  periodEnd: string;
}

export interface CcApplyInput {
  reportId: string;
  org: string;
  aggregates: PerEmailAggregate[];
  periodStart: string;
  periodEnd: string;
}

export async function applyCcSpend(input: CcApplyInput): Promise<CcApplyResult> {
  const { reportId, org, aggregates, periodStart, periodEnd } = input;

  const [reportRows] = await db.execute(
    `SELECT id FROM reports WHERE id = ?`,
    [reportId],
  ) as [any[], any];
  if (!reportRows.length) throw new ReportNotFoundError(reportId);

  // All mutations (reset + per-user UPDATE + reports.cc_period_*) are wrapped
  // in a single transaction so a mid-loop driver error rolls back instead of
  // leaving the table half-written with visibly $0 for some developers.
  return await db.transaction(async (tx) => {
    // Reset existing cc_* values for this report so partial pulls don't leave stale data.
    await tx.execute(
      `UPDATE developer_stats
         SET cc_total_cost = 0, cc_requests = 0
       WHERE report_id = ?`,
      [reportId],
    );

    // Build email → github_login map (commit_analyses primary, user_mappings fallback).
    const emailToLogin = await buildEmailToLoginMap(tx, reportId, org);

    let matched = 0;
    let unmappedEmail = 0;
    let noDevStatsRow = 0;
    let totalSpendCents = 0;
    for (const agg of aggregates) {
      totalSpendCents += agg.costCents;
      const lookup = agg.email.trim().toLowerCase();
      const login = emailToLogin.get(lookup);
      if (!login) { unmappedEmail++; continue; }
      const [result] = await tx.execute(
        `UPDATE developer_stats
           SET cc_total_cost = ?, cc_requests = ?
         WHERE report_id = ? AND github_login = ?`,
        [agg.costCents, agg.requests, reportId, login],
      ) as [any, any];
      if (result.affectedRows > 0) matched++;
      else noDevStatsRow++;
    }

    await tx.execute(
      `UPDATE reports SET cc_period_start = ?, cc_period_end = ? WHERE id = ?`,
      [periodStart, periodEnd, reportId],
    );

    return {
      matched,
      unmappedEmail,
      noDevStatsRow,
      totalApiUsers: aggregates.length,
      totalSpendUsd: totalSpendCents / 100,
      periodStart,
      periodEnd,
    };
  });
}
