/**
 * Shared impact-score formula. Used by:
 *   - the report runner (server-side, per developer)
 *   - the team aggregator (client-side, per team via per-capita inputs)
 *
 * Keep this module pure — no I/O, no DB, no Next.js APIs — so both server
 * and client can import it without dragging server-only code into the bundle.
 */
export interface ImpactScoreInputs {
  totalCommits: number;
  totalPRs: number;
  avgComplexity: number;
  prPercentage: number;
  totalStoryPoints: number;
  totalJiraIssues: number;
  totalReviews: number;
  /** Days the volume figures cover. Caps scale as cap x periodDays / 14. Default 14. */
  periodDays?: number;
  /** Days the PR/review figures cover (GLOOK-63 PR coverage). Defaults to periodDays. */
  prPeriodDays?: number;
}

/** The period the fixed caps below were tuned for. */
export const BASE_PERIOD_DAYS = 14;

/** Sum of every term's weight: 2 + 2.7 + 3.5 + 1.1 + 0.5 + 0.5. */
const MAX_RAW = 10.3;

/** min(value / scaledCap, 1); a non-positive scaled cap (no measured days) contributes 0, never NaN. */
function capped(value: number, cap: number, days: number): number {
  const scaled = (cap * days) / BASE_PERIOD_DAYS;
  if (!(scaled > 0)) return 0;
  return Math.min(value / scaled, 1);
}

export function computeImpactScore(s: ImpactScoreInputs): number {
  const days = s.periodDays ?? BASE_PERIOD_DAYS;
  const prDays = s.prPeriodDays ?? days;
  const jiraFactor = s.totalStoryPoints > 0
    ? capped(s.totalStoryPoints, 15, days)
    : capped(s.totalJiraIssues, 10, days);
  const raw =
    capped(s.totalCommits, 20, days)   * 2 +
    capped(s.totalPRs, 10, prDays)     * 2.7 +
    (s.avgComplexity / 10)             * 3.5 +
    (s.prPercentage / 100)             * 1.1 +
    jiraFactor                         * 0.5 +
    capped(s.totalReviews, 15, prDays) * 0.5;
  // No PR coverage at all: drop the PR and review terms and rescale the rest,
  // so missing data never reads as low activity (GLOOK-63 spec req. 9).
  const scaled = prDays > 0 ? raw : (raw * MAX_RAW) / (MAX_RAW - 2.7 - 0.5);
  return Math.round(scaled * 10) / 10;
}
