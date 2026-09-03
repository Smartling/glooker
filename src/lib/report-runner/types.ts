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
}

export type IntegrityState = 'ok' | 'degraded' | 'failed';

export interface RunMetadata {
  state: IntegrityState;
  skipped: SkippedMember[];
  errors: IntegrityError[];
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
  return (
    `GitHub API degraded: ${countable} of ${effectiveExpected} engineers couldn't be fetched ` +
    `(${pct}%). Likely upstream auth/permission regression.`
  );
}
