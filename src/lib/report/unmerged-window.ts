// Lookback window for unmerged work (open PRs + bare-branch commits).
// Used by both the runner (to bound the GitHub fetch) and the readers
// (dev.ts, summary.ts, org.ts) so a report's unmerged surfaces stay
// consistent with what the runner actually inserted.
//
// Decoupled from the shipped-work `period_days` window because in-flight
// work is often older than the report period (long-running PRs, drafts)
// and is the most actionable signal precisely when it is stale.
//
// Lives in its own module so consumers don't pull in `report-runner` (which
// drags GitHub/LLM/db dependencies and is heavily mocked in tests).
export const UNMERGED_LOOKBACK_DAYS = 90;
