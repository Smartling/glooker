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

  const periodDays = Number(rows[0].period_days) || 14;
  const periodEnd = new Date(rows[0].created_at);
  const periodStart = new Date(periodEnd.getTime() - periodDays * 86400_000);
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
