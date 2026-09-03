// src/lib/report-runner/skip-classifier.ts
//
// GLOOK-13: classifies SKIPs as expected/auto-flagged/unknown and evaluates
// the integrity state from a tracker snapshot.

import db from '@/lib/db';
import type { IntegrityState, RunMetadata, SkipClassification } from './types';
import { integrityCounts } from './types';

export const AUTO_FLAG_RECENT_RUNS = 5;
export const AUTO_FLAG_THRESHOLD = 4;

/**
 * Loads per-login skip counts across the last N completed reports.
 * Shared by the classifier and the settings API (auto-flagged candidate
 * list). Tolerates malformed run_metadata rows.
 */
export async function loadRecentSkipCounts(limit = AUTO_FLAG_RECENT_RUNS): Promise<Map<string, number>> {
  // LIMIT is inlined: mysql2's prepared-statement binary protocol rejects
  // bound LIMIT params. `limit` is sanitized via Number() — callers pass
  // a hardcoded module constant, never user input.
  const safeLimit = Number(limit) || AUTO_FLAG_RECENT_RUNS;
  // 'failed' runs are included deliberately. A run that aborts on the integrity
  // guard is exactly the run whose skips an operator needs to see, and
  // promoting a candidate into report_skip_allowlist is the only lever for
  // unblocking one (the thresholds are compile-time constants). Filtering to
  // 'completed' froze the history the moment runs started failing, so the
  // Settings candidate list — the unblock path — stayed empty.
  //
  // Safe because auto-flagging no longer silences anything: 'auto-flagged' and
  // 'unknown' both count toward the thresholds, so this only affects the labels
  // and the Settings suggestions.
  const [recentRows] = await db.execute(
    `SELECT run_metadata FROM reports
      WHERE status IN ('completed', 'failed') AND run_metadata IS NOT NULL
      ORDER BY completed_at DESC
      LIMIT ${safeLimit}`,
  ) as [any[], any];

  const counts = new Map<string, number>();
  for (const row of recentRows) {
    let parsed: any = null;
    try {
      parsed = typeof row.run_metadata === 'string'
        ? JSON.parse(row.run_metadata)
        : row.run_metadata;
    } catch {
      continue;
    }
    const skipped: Array<{ login?: unknown }> = Array.isArray(parsed?.skipped) ? parsed.skipped : [];
    for (const s of skipped) {
      if (typeof s?.login === 'string') {
        counts.set(s.login, (counts.get(s.login) ?? 0) + 1);
      }
    }
  }
  return counts;
}

/**
 * Loads the allowlist + recent-history once and returns a synchronous
 * classifier closure that is hot during the report run.
 */
export async function loadSkipClassifier(): Promise<(login: string) => SkipClassification> {
  // 1. Allowlist
  const [allowlistRows] = await db.execute(
    `SELECT github_login FROM report_skip_allowlist`,
  ) as [any[], any];
  const allowlisted = new Set<string>(allowlistRows.map((r: any) => r.github_login));

  // 2. Recent skip counts (shared helper)
  const skipCountsByLogin = await loadRecentSkipCounts();

  const autoFlagged = new Set<string>(
    [...skipCountsByLogin.entries()]
      .filter(([, n]) => n >= AUTO_FLAG_THRESHOLD)
      .map(([login]) => login),
  );

  return (login: string): SkipClassification =>
    allowlisted.has(login) ? 'expected' :
    autoFlagged.has(login) ? 'auto-flagged' :
    'unknown';
}

/**
 * Pure evaluator — given a tracker snapshot, returns the integrity state.
 *
 * Which skips count, and against what denominator, lives in `integrityCounts`
 * (types.ts) so the runner's abort message and the UI badge cannot drift from
 * this verdict. Only 'expected' SKIPs are excluded: those are members a human
 * put on the allowlist, i.e. someone looked and accepted the gap.
 *
 * 'auto-flagged' DOES count. It previously did not, which is how GLOOK-13
 * regressed on 2026-09-02: a member failing persistently is auto-flagged after
 * >=4 of the last 5 runs (see loadSkipClassifier), so it dropped out of this
 * calculation and the report went back to 'ok'. Reports fell from 65 to 51
 * developers over four runs with integrity green the whole way, because every
 * newly-failing member walked the same path out of the numerator.
 *
 * Auto-flagging is a *suggestion* — /api/settings/skip-allowlist surfaces
 * `autoFlaggedCandidates` for a human to promote to the allowlist. Suggesting
 * that someone might be a known-inactive member is not the same as confirming
 * it, and only the confirmation may silence the alarm.
 *
 * The AND gate on abort is deliberate and unchanged: a run must be degraded in
 * both absolute and relative terms before it aborts, so a small org isn't
 * killed by a handful of skips and a large one isn't killed by a rounding error.
 */
export function evaluateIntegrity(
  snapshot: Pick<RunMetadata, 'skipped' | 'expectedCount' | 'thresholds'>,
): IntegrityState {
  const T = snapshot.thresholds;
  const { countable, countablePct } = integrityCounts(snapshot);

  if (countable >= T.abortUnknownCount && countablePct >= T.abortUnknownPct) return 'failed';
  if (countable >= T.degradedUnknownCount || countablePct >= T.degradedUnknownPct) return 'degraded';
  return 'ok';
}
