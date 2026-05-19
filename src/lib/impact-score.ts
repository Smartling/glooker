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
}

export function computeImpactScore(s: ImpactScoreInputs): number {
  const jiraFactor = s.totalStoryPoints > 0
    ? Math.min(s.totalStoryPoints / 15, 1)
    : Math.min(s.totalJiraIssues / 10, 1);
  const raw =
    Math.min(s.totalCommits / 20, 1) * 2 +
    Math.min(s.totalPRs / 10, 1)     * 2.7 +
    (s.avgComplexity / 10)            * 3.5 +
    (s.prPercentage / 100)            * 1.1 +
    jiraFactor                        * 0.5 +
    Math.min(s.totalReviews / 15, 1)  * 0.5;
  return Math.round(raw * 10) / 10;
}
