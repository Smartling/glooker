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
