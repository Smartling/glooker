import db from '@/lib/db';
import type { PerEmailAggregate } from './provider';

export class ReportNotFoundError extends Error {
  constructor(id: string) {
    super(`Report not found: ${id}`);
    this.name = 'ReportNotFoundError';
  }
}

export interface CcApplyResult {
  matched: number;
  unmatched: number;
  totalApiUsers: number;
  totalSpendUsd: number;
  periodStart: string;
  periodEnd: string;
}

export interface CcApplyInput {
  reportId: string;
  aggregates: PerEmailAggregate[];
  periodStart: string;
  periodEnd: string;
}

export async function applyCcSpend(input: CcApplyInput): Promise<CcApplyResult> {
  const { reportId, aggregates, periodStart, periodEnd } = input;

  const [reportRows] = await db.execute(
    `SELECT id FROM reports WHERE id = ?`,
    [reportId],
  ) as [any[], any];
  if (!reportRows.length) throw new ReportNotFoundError(reportId);

  // Reset existing cc_* values for this report so partial pulls don't leave stale data.
  await db.execute(
    `UPDATE developer_stats
       SET cc_total_cost = 0, cc_requests = 0
     WHERE report_id = ?`,
    [reportId],
  );

  // Build email → github_login map (commit_analyses primary, user_mappings fallback).
  const emailToLogin = new Map<string, string>();
  const [commitEmails] = await db.execute(
    `SELECT DISTINCT LOWER(author_email) AS email, github_login
     FROM commit_analyses
     WHERE report_id = ? AND author_email IS NOT NULL AND author_email <> ''`,
    [reportId],
  ) as [any[], any];
  for (const r of commitEmails) {
    if (r.email && r.github_login) emailToLogin.set(r.email, r.github_login);
  }
  const [jiraMappings] = await db.execute(
    `SELECT LOWER(jira_email) AS email, github_login
     FROM user_mappings
     WHERE jira_email IS NOT NULL AND jira_email <> ''`,
  ) as [any[], any];
  for (const r of jiraMappings) {
    if (r.email && r.github_login && !emailToLogin.has(r.email)) {
      emailToLogin.set(r.email, r.github_login);
    }
  }

  let matched = 0;
  let unmatched = 0;
  let totalSpendCents = 0;
  for (const agg of aggregates) {
    totalSpendCents += agg.costCents;
    const lookup = agg.email.trim().toLowerCase();
    const login = emailToLogin.get(lookup);
    if (!login) { unmatched++; continue; }
    const [result] = await db.execute(
      `UPDATE developer_stats
         SET cc_total_cost = ?, cc_requests = ?
       WHERE report_id = ? AND github_login = ?`,
      [agg.costCents, agg.requests, reportId, login],
    ) as [any, any];
    if (result.affectedRows > 0) matched++;
    else unmatched++;
  }

  await db.execute(
    `UPDATE reports SET cc_period_start = ?, cc_period_end = ? WHERE id = ?`,
    [periodStart, periodEnd, reportId],
  );

  return {
    matched,
    unmatched,
    totalApiUsers: aggregates.length,
    totalSpendUsd: totalSpendCents / 100,
    periodStart,
    periodEnd,
  };
}
