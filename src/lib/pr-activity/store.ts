import db from '@/lib/db';
import type { PRInfo } from '@/lib/github';

/** GLOOK-63: one row per merged PR a developer authored or reviewed. */
export type PrActivityKind = 'authored' | 'reviewed';

const DAY_MS = 86_400_000;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Rows per multi-row INSERT: well under MySQL's packet limit and SQLite's 32k-variable cap. */
export const PR_ACTIVITY_BATCH = 200;

/**
 * Upsert PR rows; returns how many were written. Rows without a repo or a parseable merge time are
 * skipped. Written as multi-row INSERTs of PR_ACTIVITY_BATCH rows inside one transaction, so a
 * heavy reviewer costs a few statements instead of one per PR, and a failure writes nothing.
 */
export async function upsertPrActivity(
  org: string, login: string, kind: PrActivityKind, prs: PRInfo[],
): Promise<number> {
  const rows: unknown[][] = [];
  for (const pr of prs) {
    const t = Date.parse(pr.mergedAt);
    if (!pr.repo || !Number.isFinite(t)) continue;
    rows.push([org, login, kind, pr.repo, pr.number, new Date(t).toISOString()]);
  }
  if (rows.length === 0) return 0;
  await db.transaction(async (tx) => {
    for (let i = 0; i < rows.length; i += PR_ACTIVITY_BATCH) {
      const chunk = rows.slice(i, i + PR_ACTIVITY_BATCH);
      await tx.execute(
        `INSERT INTO pr_activity (org, github_login, kind, repo, pr_number, merged_at)
         VALUES ${chunk.map(() => '(?, ?, ?, ?, ?, ?)').join(', ')}
         ON DUPLICATE KEY UPDATE merged_at = VALUES(merged_at)`,
        chunk.flat(),
      );
    }
  });
  return rows.length;
}

/** Record that [sinceDate, untilDate) of this login's PR data is complete. Idempotent. */
export async function recordPrCoverage(
  org: string, login: string, sinceDate: string, untilDate: string, source: 'report' | 'backfill',
): Promise<void> {
  await db.execute(
    `INSERT IGNORE INTO pr_activity_coverage (org, github_login, since_date, until_date, source)
     VALUES (?, ?, ?, ?, ?)`,
    [org, login, sinceDate, untilDate, source],
  );
}

export async function hasPrCoverage(
  org: string, login: string, sinceDate: string, untilDate: string,
): Promise<boolean> {
  const [rows] = await db.execute(
    `SELECT 1 AS hit FROM pr_activity_coverage
     WHERE org = ? AND github_login = ? AND since_date = ? AND until_date = ? LIMIT 1`,
    [org, login, sinceDate, untilDate],
  ) as [any[], any];
  return rows.length > 0;
}

/**
 * The whole UTC days a report run's PR searches provably covered. The review query is
 * `merged:>since-date` (exclusive) and the run keeps going past midnight, so we start the day after
 * since and stop before the run-start day. Returns null when that leaves no day.
 */
export function reportCoverageSlice(since: Date, runStart: Date): { sinceDate: string; untilDate: string } | null {
  const sinceDay = Math.floor(since.getTime() / DAY_MS) * DAY_MS + DAY_MS;
  const untilDay = Math.floor(runStart.getTime() / DAY_MS) * DAY_MS;
  if (!Number.isFinite(sinceDay) || !Number.isFinite(untilDay) || sinceDay >= untilDay) return null;
  return { sinceDate: isoDay(sinceDay), untilDate: isoDay(untilDay) };
}
