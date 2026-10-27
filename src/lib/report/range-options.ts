/**
 * GLOOK-63: the Team/Engineer page date range. Pure, so client pages and server code share one
 * definition. `range.ts` (server, imports db) re-exports everything here.
 */
export const RANGE_OPTIONS = ['current', '90d', '12m'] as const;
export type ReportRange = typeof RANGE_OPTIONS[number];
export type ReportRangeKey = Exclude<ReportRange, 'current'>;

export const RANGE_LABELS: Record<ReportRange, string> = {
  current: 'Current report',
  '90d': 'Past 90 days',
  '12m': 'Past 12 months',
};

export const RANGE_DAYS: Record<ReportRangeKey, number> = { '90d': 90, '12m': 365 };

/** Missing or empty → 'current'; one of the exact values → itself; anything else → null (API: 400). */
export function parseRange(value: string | null | undefined): ReportRange | null {
  if (value == null || value === '') return 'current';
  return (RANGE_OPTIONS as readonly string[]).includes(value) ? (value as ReportRange) : null;
}

/** Current report sends no range parameter, so its requests stay byte-identical to before. */
export function withRange(url: string, range: ReportRange): string {
  if (range === 'current') return url;
  return `${url}${url.includes('?') ? '&' : '?'}range=${range}`;
}

/** Response `range` block. Dates are YYYY-MM-DD; `until` is exclusive. */
export interface RangeMeta {
  key: ReportRangeKey;
  since: string;
  until: string;
  days: number;
  measuredDays: number;
  /** Earliest day with PR/review coverage inside the range; null when there is none. */
  prCoveredSince: string | null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function shortDay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}` : iso;
}

/** The notes shown next to the picker. Empty when nothing is missing. */
export function rangeNotes(meta: RangeMeta | null | undefined): string[] {
  if (!meta) return [];
  const notes: string[] = [];
  if (meta.measuredDays < meta.days) notes.push(`${meta.measuredDays} of ${meta.days} days measured`);
  if (meta.prCoveredSince == null) notes.push('No PR and review data in this range');
  else if (meta.prCoveredSince > meta.since) notes.push(`PR and review data from ${shortDay(meta.prCoveredSince)}`);
  return notes;
}
