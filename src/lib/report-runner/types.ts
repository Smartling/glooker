// src/lib/report-runner/types.ts
//
// Shared types for the GLOOK-13 report-integrity feature. Lives in its own
// module so the tracker, classifier, runner, service, and React component
// can all import without circular deps.

export type SkipClassification = 'expected' | 'auto-flagged' | 'unknown';

export interface SkippedMember {
  /** github_login of the member that was dropped from the report */
  login: string;
  /** Raw error message captured at the L1 catch site (truncated to 500 chars) */
  reason: string;
  /** How the classifier categorized this skip — drives the threshold logic */
  classification: SkipClassification;
}

export interface IntegrityError {
  /** Which sub-operation failed (a member-kept partial-data condition, not a SKIP) */
  context: 'openPRs' | 'unmerged-commit-detail' | 'sha-merge-check' | 'other';
  /** Member login if the error is member-scoped */
  login?: string;
  /** Commit SHA if the error is commit-scoped (e.g. sha-merge-check) */
  sha?: string;
  /** Truncated error message (max 500 chars) */
  message: string;
}

export interface IntegrityThresholds {
  abortUnknownCount: 5;
  abortUnknownPct: 0.10;
  degradedUnknownCount: 3;
  degradedUnknownPct: 0.05;
  /**
   * Members whose data was KEPT but could not be verified (GLOOK-50). Its own
   * gate, deliberately separate from the skip thresholds: an unverified member
   * still has a row in the report, so this must never abort a run — but a
   * correlated brownout that leaves a third of the org unverified has to stop
   * reading as a clean bill of health.
   */
  degradedUnverifiedPct: 0.15;
}

export type IntegrityState = 'ok' | 'degraded' | 'failed';

/**
 * A member kept in the report whose data could not be verified.
 *
 * Deliberately NOT an IntegrityError: `errors` already mixes per-commit
 * `sha-merge-check` and `unmerged-commit-detail` entries that run to hundreds
 * on a healthy run, so anything thresholded on `errors.length` would cry wolf
 * and get switched off. This is member-scoped, deduped, and countable.
 */
export interface UnverifiedMember {
  login: string;
  /** Which figure is unverified — lets the badge and an operator filter. */
  field: 'merged-prs' | 'reviews' | 'commits';
  /** What was kept in its place (usually 0). */
  kept: number;
  reason: string;
}

export interface RunMetadata {
  state: IntegrityState;
  skipped: SkippedMember[];
  errors: IntegrityError[];
  /** Members kept in the report with an unverified figure (GLOOK-50). */
  unverified?: UnverifiedMember[];
  /** Org member count at run start — denominator for percentage calculations */
  expectedCount: number;
  thresholds: IntegrityThresholds;
  /** Human-readable abort summary; populated only when state === 'failed' */
  abortReason?: string;
}

/** Canonical threshold constants used by `evaluateIntegrity()` and persisted into RunMetadata. */
export const DEFAULT_THRESHOLDS: IntegrityThresholds = {
  abortUnknownCount: 5,
  abortUnknownPct: 0.10,
  degradedUnknownCount: 3,
  degradedUnknownPct: 0.05,
  degradedUnverifiedPct: 0.15,
};

/**
 * Skip classifications that count against the integrity thresholds.
 *
 * Deliberately an explicit inclusion list rather than `!== 'expected'`: adding
 * a new SkipClassification must be a conscious decision about whether it is
 * allowed to silence the guard. The 2026-09-02 regression happened precisely
 * because 'auto-flagged' drifted out of this set.
 */
export const COUNTABLE_SKIP_CLASSIFICATIONS: readonly SkipClassification[] = [
  'unknown',
  'auto-flagged',
];

/** The skips that count against the thresholds — everything except human-allowlisted. */
export function countableSkips<T extends { classification: SkipClassification }>(
  skipped: readonly T[],
): T[] {
  return skipped.filter((s) => COUNTABLE_SKIP_CLASSIFICATIONS.includes(s.classification));
}

/**
 * The single place the integrity numerator and denominator are computed.
 *
 * `evaluateIntegrity`, the runner's abort message, and the UI badge all read
 * from here. Three hand-written copies of "which skips count" is what let the
 * guard abort correctly and then tell the operator `0 of 102 (0%)`.
 */
export function integrityCounts(
  snapshot: Pick<RunMetadata, 'skipped' | 'expectedCount'>,
): { countable: number; allowlisted: number; effectiveExpected: number; countablePct: number } {
  const countable = countableSkips(snapshot.skipped).length;
  const allowlisted = snapshot.skipped.filter((s) => s.classification === 'expected').length;

  // Allowlisted members leave the numerator, so they must leave the denominator
  // too. Otherwise every allowlist addition makes the percentage gate strictly
  // less sensitive — and since the thresholds are compile-time constants, the
  // allowlist is the only lever for unblocking a hard-failing run. The guard
  // would desensitise exactly as it gets used.
  const effectiveExpected = Math.max((snapshot.expectedCount ?? 0) - allowlisted, 0);
  const countablePct = effectiveExpected > 0 ? countable / effectiveExpected : 0;

  return { countable, allowlisted, effectiveExpected, countablePct };
}

/**
 * How many members were kept but unverified, as a share of those expected.
 *
 * Separate from `integrityCounts` because an unverified member is NOT a skip:
 * they are present in the report with a figure we could not confirm. The only
 * thing this may do is downgrade a run to `degraded` — never abort it.
 */
export function unverifiedCounts(
  snapshot: Pick<RunMetadata, 'unverified' | 'skipped' | 'expectedCount'>,
): { count: number; pct: number } {
  const logins = new Set((snapshot.unverified ?? []).map((u) => u.login));
  const count = logins.size;
  const allowlisted = snapshot.skipped.filter((s) => s.classification === 'expected').length;
  const expected = Math.max((snapshot.expectedCount ?? 0) - allowlisted, 0);
  return { count, pct: expected > 0 ? count / expected : 0 };
}

/**
 * The operator-facing abort summary, persisted to `reports.error` and
 * `run_metadata.abortReason` and rendered verbatim by IntegrityBadge.
 *
 * Lives here, next to the counts it reports, so the message can never again
 * disagree with the verdict that produced it.
 */
export function formatIntegrityAbortReason(
  snapshot: Pick<RunMetadata, 'skipped' | 'expectedCount'>,
): string {
  const { countable, effectiveExpected, countablePct } = integrityCounts(snapshot);
  const pct = Math.round(countablePct * 100);

  // Name the actual failure mode rather than always blaming auth. A GitHub
  // search brownout (GLOOK-50) trips this gate through many correlated
  // per-member timeouts, and "likely auth/permission regression" sends the
  // on-call to check the PAT — the wrong lead, at the worst moment.
  const searchTimeouts = countableSkips(snapshot.skipped)
    .filter((s) => /no trustworthy result|under-delivered/i.test(s.reason)).length;
  const cause = searchTimeouts >= Math.max(1, Math.ceil(countable / 2))
    ? `Most failures are GitHub search timeouts (${searchTimeouts} of ${countable}) — ` +
      'likely a GitHub search brownout rather than a credential problem.'
    : 'Likely upstream auth/permission regression.';

  return (
    `GitHub API degraded: ${countable} of ${effectiveExpected} engineers couldn't be fetched ` +
    `(${pct}%). ${cause}`
  );
}
