// src/lib/report-runner/skip-classifier.ts
//
// GLOOK-13: classifies SKIPs as expected/auto-flagged/unknown and evaluates
// the integrity state from a tracker snapshot.

import db from '@/lib/db';
import type { IntegrityState, RunMetadata, SkipClassification } from './types';

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
  const [recentRows] = await db.execute(
    `SELECT run_metadata FROM reports
      WHERE status = 'completed' AND run_metadata IS NOT NULL
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
 * Only unknown SKIPs count toward thresholds; expected + auto-flagged are
 * surfaced in run_metadata but ignored here.
 */
export function evaluateIntegrity(
  snapshot: Pick<RunMetadata, 'skipped' | 'expectedCount' | 'thresholds'>,
): IntegrityState {
  const T = snapshot.thresholds;
  const unknownCount = snapshot.skipped.filter(s => s.classification === 'unknown').length;
  const expected = snapshot.expectedCount;
  const unknownPct = expected > 0 ? unknownCount / expected : 0;

  if (unknownCount >= T.abortUnknownCount && unknownPct >= T.abortUnknownPct) return 'failed';
  if (unknownCount >= T.degradedUnknownCount || unknownPct >= T.degradedUnknownPct) return 'degraded';
  return 'ok';
}
