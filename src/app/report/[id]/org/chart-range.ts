import { formatWeek } from '@/components/charts/chart-format';

/**
 * POC: how far back the Org Summary timeline charts reach. The org endpoint already returns the
 * org's whole history; the range only widens the week domain the charts draw (weekDomainEndingAt),
 * so changing it never refetches. Weeks before the first report render as "Not measured", never 0.
 */
export const CHART_RANGES = ['90d', '12m', 'all'] as const;
export type ChartRange = typeof CHART_RANGES[number];

export const CHART_RANGE_LABELS: Record<ChartRange, string> = { '90d': '90 days', '12m': '12 months', all: 'All time' };

const DAY_MS = 86_400_000;
const FIXED_DAYS = { '90d': 90, '12m': 365 } as const;

/**
 * Days back from the anchor week for weekDomainEndingAt. "All time" starts at the first week that
 * has data (`firstWeek`, the timeline's earliest row), so the chart never opens on a run of empty
 * weeks. With no usable first week (or one after the anchor) it falls back to 90 days.
 */
export function chartRangeDays(range: ChartRange, anchorWeek: string | null | undefined, firstWeek: string | null | undefined): number {
  if (range !== 'all') return FIXED_DAYS[range];
  const a = Date.parse(`${anchorWeek ?? ''}T00:00:00Z`);
  const f = Date.parse(`${firstWeek ?? ''}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(f) || f > a) return FIXED_DAYS['90d'];
  return Math.round((a - f) / DAY_MS);
}

/** "Oct 13" on 90 days; "Oct '25" beyond, where the same month and day recur a year apart. */
export function weekTickFormatter(range: ChartRange): (iso: string) => string {
  if (range === '90d') return formatWeek;
  return (iso: string) => {
    const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(iso);
    if (!m) return iso;
    return `${MONTHS[Number(m[2]) - 1] ?? m[2]} '${m[1].slice(2)}`;
  };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
