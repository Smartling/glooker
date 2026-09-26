// GLOOK-58: pure helpers shared by every chart. Numbers from DECIMAL/REAL columns can arrive as
// strings, so every value goes through toNum(). Weeks are UTC calendar weeks, matching the
// server's weekKeyForDate(), so keys match exactly.

export type MetricKind = 'count' | 'ratio';

const DAY_MS = 86_400_000;

/** Number, or 0 for anything unusable. Charts never throw and never render NaN. */
export function toNum(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function isoOf(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
}

function utcDay(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isoOf(t) === iso ? t : null; // rejects 2026-13-01, 2026-02-30
}

/** Monday of the UTC week containing `date`, as YYYY-MM-DD. Same rule as weekKeyForDate(). */
export function mondayOf(date: Date): string {
  const t = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const dow = new Date(t).getUTCDay();
  return isoOf(t - ((dow + 6) % 7) * DAY_MS);
}

/** Every Monday from the cutoff's week to today's week, inclusive. */
export function buildWeekDomain(cutoff: Date, today: Date): string[] {
  const start = utcDay(mondayOf(cutoff)) as number;
  const end = utcDay(mondayOf(today)) as number;
  const out: string[] = [];
  for (let t = start; t <= end; t += 7 * DAY_MS) out.push(isoOf(t));
  return out;
}

/** The page-wide domain: the last `days` days (default 90). Compute once per page and pass it to every chart. */
export function recentWeekDomain(now: Date = new Date(), days = 90): string[] {
  return buildWeekDomain(new Date(now.getTime() - days * DAY_MS), now);
}

/**
 * GLOOK-58 Decision 15: the page-wide domain, the `days` days (default 90) ending at the report's
 * own week, `${anchorWeek}T00:00:00Z`. The server computes anchorWeek, so the client never re-parses
 * a DB timestamp. A missing or malformed anchor falls back to today's domain: charts never throw.
 */
export function weekDomainEndingAt(anchorWeek: string | null | undefined, days = 90): string[] {
  const t = utcDay(anchorWeek ?? '');
  return recentWeekDomain(t === null ? new Date() : new Date(t), days);
}

/** Rows keyed by their exact week. aggregateWeekly emits one row per key, so there are no collisions. */
export function indexByWeek<T extends { week: string }>(data: T[]): Map<string, T> {
  return new Map(data.map(r => [r.week, r]));
}

export interface WeekPoint<T> {
  week: string;
  value: number | null;
  hasData: boolean;
  /** Decision 15: false when the week has no data AND no report provably measured it. */
  measured: boolean;
  row?: T;
}

export interface FillOptions<T> {
  value: (row: T) => unknown;
  kind: MetricKind;
  isDefined?: (row: T) => boolean;
  /** Decision 15: weeks some report provably measured. Omitted: every week counts as measured. */
  covered?: ReadonlySet<string>;
}

/**
 * GLOOK-58 Decision 15: a week counts as measured when it has data (even outside every report
 * period, e.g. an old in-flight commit) or some report provably measured it. With no `covered`
 * set, every week counts as measured: the behavior before Decision 15.
 */
export function isMeasured(week: string, hasRow: boolean, covered?: ReadonlySet<string>): boolean {
  return hasRow || !covered || covered.has(week);
}

/**
 * One point per domain week. kind 'count': a missing or undefined week is 0.
 * kind 'ratio': a missing or undefined week is null (a gap). Rows outside the domain are ignored.
 * `measured` (Decision 15) never changes a value; tooltips read it.
 */
export function fillWeeks<T extends { week: string }>(weeks: string[], data: T[], opts: FillOptions<T>): WeekPoint<T>[] {
  const byWeek = indexByWeek(data);
  return weeks.map(week => {
    const row = byWeek.get(week);
    const raw = row ? opts.value(row) : undefined;
    const defined = !!row && raw != null && (opts.isDefined ? opts.isDefined(row) : true);
    const measured = isMeasured(week, !!row, opts.covered);
    if (opts.kind === 'count') return { week, row, hasData: !!row, measured, value: defined ? toNum(raw) : 0 };
    return { week, row, hasData: defined, measured, value: defined ? toNum(raw) : null };
  });
}

export function formatWeek(iso: string): string {
  const t = utcDay(iso);
  if (t === null) return iso;
  return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function formatValue(v: number | null | undefined, { suffix = '', decimals = 0 }: { suffix?: string; decimals?: number } = {}): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const body = decimals > 0 ? v.toFixed(decimals) : Math.round(v).toLocaleString('en-US');
  return body + suffix;
}

const COMPACT = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

export function formatCompact(v: number): string {
  return COMPACT.format(toNum(v));
}

/** True when every key after `key` in stacking order is zero in this row: that segment gets the rounded top. */
export function isTopOfStack(row: Record<string, unknown>, keys: readonly string[], key: string): boolean {
  const i = keys.indexOf(key);
  return keys.slice(i + 1).every(k => toNum(row[k]) === 0);
}
