// src/lib/cc-spend/service.ts
import db from '@/lib/db';
import { applyCcSpend, ReportNotFoundError } from './apply';
import { getCcSpendProvider } from './provider';
import type { CcApplyResult } from './apply';

export { ReportNotFoundError };

export async function refreshCcSpendForReport(
  reportId: string,
  log?: (msg: string) => void,
): Promise<CcApplyResult> {
  const [rows] = await db.execute(
    `SELECT id, created_at, period_days FROM reports WHERE id = ?`,
    [reportId],
  ) as [any[], any];
  if (!rows.length) throw new ReportNotFoundError(reportId);

  const parsed = Number(rows[0].period_days);
  const periodDays = Number.isFinite(parsed) && parsed > 0 ? parsed : 14;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    log?.(`CC spend: report.period_days invalid (${rows[0].period_days}); defaulting to 14`);
  }

  // Anthropic Analytics API allows up to 31 days inclusive; keep 1 day of safety.
  const MAX_PERIOD_DAYS = 30;
  const effectivePeriodDays = Math.min(periodDays, MAX_PERIOD_DAYS);
  if (periodDays > MAX_PERIOD_DAYS) {
    log?.(`CC spend: report.period_days=${periodDays} exceeds Anthropic ${MAX_PERIOD_DAYS}-day max; truncating window`);
  }

  const periodEnd = new Date(rows[0].created_at);
  const periodStart = new Date(periodEnd.getTime() - effectivePeriodDays * 86400_000);
  const startStr = periodStart.toISOString().slice(0, 10);
  const endStr = periodEnd.toISOString().slice(0, 10);

  const provider = getCcSpendProvider();
  const aggregates = await provider.pullByPeriod(startStr, endStr, log);

  return applyCcSpend({
    reportId,
    aggregates,
    periodStart: startStr,
    periodEnd: endStr,
  });
}
