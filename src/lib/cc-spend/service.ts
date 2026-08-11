// src/lib/cc-spend/service.ts
import db from '@/lib/db';
import { applyCcSpend, ReportNotFoundError } from './apply';
import { getCcSpendProvider } from './provider';
import type { CcApplyResult } from './apply';
import { applySkillsUsage, applyModelUsage } from './apply-breakdowns';
import type { BreakdownApplyResult } from './apply-breakdowns';

export { ReportNotFoundError };

export type CcRefreshResult = CcApplyResult & {
  skills?: BreakdownApplyResult;
  models?: BreakdownApplyResult;
  /**
   * Set when the skills/model pull threw. Each dimension is independently
   * non-fatal by design (a failure here must not discard the cost result that
   * already succeeded), but that only stays honest if a caller can tell
   * "succeeded with 0 rows" (skills present, no error) apart from "failed"
   * (skills absent, skillsError set) — otherwise POST
   * /api/report/[id]/cc-spend/refresh returns HTTP 200 with no signal that
   * the Spend tab's Model Mix/Skills panel will be silently missing.
   */
  skillsError?: string;
  modelsError?: string;
};

/** The /users endpoint trails real time by ~2 days and 400s on a too-recent end date. */
const SKILLS_LAG_DAYS = 2;

export async function refreshCcSpendForReport(
  reportId: string,
  log?: (msg: string) => void,
): Promise<CcRefreshResult> {
  const [rows] = await db.execute(
    `SELECT id, org, created_at, period_days FROM reports WHERE id = ?`,
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

  const costResult = await applyCcSpend({
    reportId,
    org: String(rows[0].org),
    aggregates,
    periodStart: startStr,
    periodEnd: endStr,
  });

  const org = String(rows[0].org);
  const result: CcRefreshResult = { ...costResult };

  // Skills: clamp the end date back to the API's latest available data. Each
  // extra dimension is independently non-fatal — a failure here must not discard
  // the cost result that already succeeded.
  const lagCutoff = new Date(Date.now() - SKILLS_LAG_DAYS * 86400_000).toISOString().slice(0, 10);
  const skillsEnd = endStr < lagCutoff ? endStr : lagCutoff;
  try {
    if (skillsEnd < startStr) {
      log?.(`CC skills: window ${startStr}..${skillsEnd} is empty after the ${SKILLS_LAG_DAYS}-day data lag; skipping`);
    } else {
      const skills = await provider.pullSkillsByPeriod(startStr, skillsEnd, log);
      result.skills = await applySkillsUsage({ reportId, org, skills });
      log?.(`CC skills: ${result.skills.matched} matched, ${result.skills.rows} rows (${startStr} → ${skillsEnd}) [${result.skills.unmappedEmail} unmapped, ${result.skills.noDevStatsRow} no-devstats-row]`);
    }
  } catch (err) {
    result.skillsError = err instanceof Error ? err.message : String(err);
    log?.(`CC skills: SKIP (${result.skillsError})`);
  }

  try {
    const models = await provider.pullModelCostByPeriod(startStr, endStr, log);
    result.models = await applyModelUsage({ reportId, org, models });
    log?.(`CC models: ${result.models.matched} matched, ${result.models.rows} rows [${result.models.unmappedEmail} unmapped, ${result.models.noDevStatsRow} no-devstats-row]`);
  } catch (err) {
    result.modelsError = err instanceof Error ? err.message : String(err);
    log?.(`CC models: SKIP (${result.modelsError})`);
  }

  return result;
}
