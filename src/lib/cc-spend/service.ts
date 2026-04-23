import { parse } from 'csv-parse/sync';
import db from '@/lib/db';

export class ReportNotFoundError extends Error {
  constructor(id: string) {
    super(`Report not found: ${id}`);
    this.name = 'ReportNotFoundError';
  }
}

export interface CcSpendUploadResult {
  matched: number;
  unmatched: number;
  totalCsvUsers: number;
  totalSpendUsd: number;
  periodStart: string;
  periodEnd: string;
}

interface AggregatedRow {
  cost: number;
  inputTokens: number;
  outputTokens: number;
  sessions: number;
}

interface CsvRow {
  user_email?: string;
  product?: string;
  total_requests?: string;
  total_prompt_tokens?: string;
  total_completion_tokens?: string;
  total_net_spend_usd?: string;
}

export async function uploadCcSpend(input: {
  reportId: string;
  csvText: string;
  periodStart: string;
  periodEnd: string;
}): Promise<CcSpendUploadResult> {
  const { reportId, csvText, periodStart, periodEnd } = input;

  const [reportRows] = await db.execute(
    `SELECT id FROM reports WHERE id = ?`,
    [reportId],
  ) as [any[], any];
  if (!reportRows.length) throw new ReportNotFoundError(reportId);

  const rows = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as CsvRow[];

  if (rows.length === 0) {
    throw new Error('CSV has no data rows');
  }

  // Aggregate Claude Code rows by lowercased email (a user may have multiple rows — one per model)
  const byEmail = new Map<string, AggregatedRow>();
  for (const row of rows) {
    if (row.product?.trim() !== 'Claude Code') continue;
    const email = row.user_email?.trim().toLowerCase();
    if (!email) continue;
    const existing = byEmail.get(email) || { cost: 0, inputTokens: 0, outputTokens: 0, sessions: 0 };
    existing.cost += Math.round(parseFloat(row.total_net_spend_usd || '0') * 100); // dollars → cents
    existing.inputTokens += parseInt(row.total_prompt_tokens || '0', 10) || 0;
    existing.outputTokens += parseInt(row.total_completion_tokens || '0', 10) || 0;
    existing.sessions += parseInt(row.total_requests || '0', 10) || 0;
    byEmail.set(email, existing);
  }

  // Build email → github_login map from commit_analyses (primary) and user_mappings (fallback)
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

  // Reset then write matched developers
  await db.execute(
    `UPDATE developer_stats
       SET cc_total_cost = 0, cc_input_tokens = 0, cc_output_tokens = 0, cc_sessions = 0
     WHERE report_id = ?`,
    [reportId],
  );

  let matched = 0;
  let unmatched = 0;
  let totalSpendCents = 0;
  for (const [email, data] of byEmail.entries()) {
    totalSpendCents += data.cost;
    const login = emailToLogin.get(email);
    if (!login) { unmatched++; continue; }
    const [result] = await db.execute(
      `UPDATE developer_stats
         SET cc_total_cost = ?, cc_input_tokens = ?, cc_output_tokens = ?, cc_sessions = ?
       WHERE report_id = ? AND github_login = ?`,
      [data.cost, data.inputTokens, data.outputTokens, data.sessions, reportId, login],
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
    totalCsvUsers: byEmail.size,
    totalSpendUsd: totalSpendCents / 100,
    periodStart,
    periodEnd,
  };
}
