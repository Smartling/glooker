import { RANGE_DAYS, type ReportRangeKey } from './range-options';

export * from './range-options';

const DAY_MS = 86_400_000;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Whole UTC days; `until` is exclusive. */
export interface RangeWindow {
  since: string;
  until: string;
  days: number;
}

/**
 * GLOOK-63: a range ends on the report's end date (completed_at, else created_at) and starts 90 or
 * 365 days before. `until` is the UTC midnight after that date, so the end day is included.
 */
export function rangeWindow(
  report: { completed_at?: unknown; created_at?: unknown },
  range: ReportRangeKey,
): RangeWindow {
  let end = NaN;
  for (const v of [report.completed_at, report.created_at]) {
    if (v == null) continue;
    const t = new Date(v as string | number | Date).getTime();
    if (Number.isFinite(t)) { end = t; break; }
  }
  if (!Number.isFinite(end)) end = Date.now();
  const days = RANGE_DAYS[range];
  const untilMs = Math.floor(end / DAY_MS) * DAY_MS + DAY_MS;
  return { since: isoDay(untilMs - days * DAY_MS), until: isoDay(untilMs), days };
}
