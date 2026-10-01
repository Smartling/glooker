import { Cron } from 'croner';

const GRACE_MS = 12 * 3600 * 1000;
const LOOKAHEAD = 8;

/**
 * GLOOK-59: how old the latest good report may get before it reads stale. Derived from the
 * enabled schedules: the largest gap between consecutive upcoming fires (so a weekday schedule's
 * Fri→Mon gap is normal) plus a 12h grace; the tightest schedule wins. null = no enabled schedule,
 * which means "never stale" — without a schedule there is no expectation to miss.
 */
export function staleAfterMs(
  schedules: Array<{ cron_expr: string; timezone: string; enabled: unknown }>,
  now: Date,
): number | null {
  let best: number | null = null;
  for (const s of schedules) {
    if (!s.enabled || s.enabled === '0') continue;
    let runs: Date[];
    try {
      const job = new Cron(s.cron_expr, { timezone: s.timezone, paused: true });
      runs = job.nextRuns(LOOKAHEAD, now);
      job.stop();
    } catch {
      continue;
    }
    if (runs.length < 2) continue;
    let gap = 0;
    for (let i = 1; i < runs.length; i++) gap = Math.max(gap, runs[i].getTime() - runs[i - 1].getTime());
    const ms = gap + GRACE_MS;
    best = best === null ? ms : Math.min(best, ms);
  }
  return best;
}

export function isStale(lastAt: string | Date | null, staleMs: number | null, now: Date): boolean {
  if (staleMs === null) return false;
  if (!lastAt) return true;
  const t = (lastAt instanceof Date ? lastAt : new Date(lastAt)).getTime();
  return Number.isNaN(t) || now.getTime() - t > staleMs;
}
