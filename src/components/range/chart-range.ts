import { formatWeek, mondayOf } from '@/components/charts/chart-format';

/**
 * How far back the Org Summary timeline charts reach. The org endpoint already returns the org's
 * whole history; the range only widens the week domain the charts draw (weekDomainEndingAt), so
 * changing it never refetches. Weeks no report measured render as "Not measured", never 0.
 */
export const CHART_RANGES = ['90d', '12m', 'all'] as const;
export type ChartRange = typeof CHART_RANGES[number];

export const CHART_RANGE_LABELS: Record<ChartRange, string> = { '90d': '90 days', '12m': '12 months', all: 'All time' };

const DAY_MS = 86_400_000;
const FIXED_DAYS = { '90d': 90, '12m': 365 } as const;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const utc = (iso: string | null | undefined) => Date.parse(`${iso ?? ''}T00:00:00Z`);

/**
 * Days back from the anchor week for weekDomainEndingAt. "All time" starts at the first week that
 * has data (`firstWeek`; any day of it works, since the domain floors to that week's Monday), but
 * never spans less than 90 days, so switching 90 days → All time can't shrink a young org's chart.
 * With no usable anchor, weekDomainEndingAt ends at the current week, so the span is measured from
 * there too; with no usable first week, All time is 90 days.
 */
export function chartRangeDays(
  range: ChartRange,
  anchorWeek: string | null | undefined,
  firstWeek: string | null | undefined,
  now: Date = new Date(),
): number {
  if (range !== 'all') return FIXED_DAYS[range];
  let a = utc(anchorWeek);
  if (Number.isNaN(a)) a = utc(mondayOf(now));
  const f = utc(firstWeek);
  if (Number.isNaN(f)) return FIXED_DAYS['90d'];
  return Math.max(FIXED_DAYS['90d'], Math.round((a - f) / DAY_MS));
}

/**
 * Explicit x-axis ticks for 12 months / All time: the first week of each month, or of each quarter
 * when that would exceed 13 labels. Without them every week of a month formats to the same
 * "Oct '25" and Recharts spaces the repeats unevenly. 90 days keeps Recharts' own picks.
 */
export function chartTicks(range: ChartRange, weeks: string[]): string[] | undefined {
  if (range === '90d') return undefined;
  const monthStarts = weeks.filter((w, i) => i === 0 || w.slice(0, 7) !== weeks[i - 1].slice(0, 7));
  if (monthStarts.length <= 13) return monthStarts;
  return monthStarts.filter(w => (Number(w.slice(5, 7)) - 1) % 3 === 0);
}

/**
 * "Oct 13" on 90 days; "Oct '25" beyond, where the same month and day recur a year apart. Returns
 * module-level functions, so the charts get a stable prop across renders.
 */
export function weekTickFormatter(range: ChartRange): (iso: string) => string {
  return range === '90d' ? formatWeek : formatMonthYear;
}

function formatMonthYear(iso: string): string {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(iso);
  if (!m) return iso;
  return `${MONTHS[Number(m[2]) - 1] ?? m[2]} '${m[1].slice(2)}`;
}
