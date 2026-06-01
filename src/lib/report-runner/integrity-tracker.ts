// src/lib/report-runner/integrity-tracker.ts
//
// GLOOK-13: accumulates SKIPs + non-fatal errors during a report run.
// One instance per runReport() call. Caller queries .snapshot() at the end
// of the gather loop to feed evaluateIntegrity() and persist into the
// reports.run_metadata column.

import type {
  IntegrityError,
  IntegrityThresholds,
  RunMetadata,
  SkipClassification,
  SkippedMember,
} from './types';

const MAX_MESSAGE_LENGTH = 500;

function truncate(s: string): string {
  return s.length > MAX_MESSAGE_LENGTH ? s.slice(0, MAX_MESSAGE_LENGTH) : s;
}

export interface IntegrityTrackerOptions {
  expectedCount: number;
  thresholds: IntegrityThresholds;
}

export class IntegrityTracker {
  /** Map keyed by github_login so duplicate skip records collapse (last-write-wins). */
  private readonly skipsByLogin = new Map<string, SkippedMember>();
  /** Errors appended in order; not deduped (could be many per member/sha). */
  private readonly errors: IntegrityError[] = [];
  readonly expectedCount: number;
  readonly thresholds: IntegrityThresholds;

  constructor(opts: IntegrityTrackerOptions) {
    this.expectedCount = opts.expectedCount;
    this.thresholds = opts.thresholds;
  }

  recordSkip(login: string, reason: string, classification: SkipClassification): void {
    this.skipsByLogin.set(login, {
      login,
      reason: truncate(reason),
      classification,
    });
  }

  recordError(err: IntegrityError): void {
    this.errors.push({
      ...err,
      message: truncate(err.message),
    });
  }

  /** Frozen snapshot for evaluator + persistence. Independent of tracker state. */
  snapshot(): Pick<RunMetadata, 'skipped' | 'errors' | 'expectedCount' | 'thresholds'> {
    return Object.freeze({
      skipped: Object.freeze([...this.skipsByLogin.values()]) as readonly SkippedMember[] as SkippedMember[],
      errors: Object.freeze([...this.errors]) as readonly IntegrityError[] as IntegrityError[],
      expectedCount: this.expectedCount,
      thresholds: this.thresholds,
    });
  }
}
