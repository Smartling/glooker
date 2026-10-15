import { formatWeek } from '@/components/charts/chart-format';

/**
 * POC: how far back the Org Summary timeline charts reach. The org endpoint already returns the
 * org's whole history; the range only widens the week domain the charts draw (weekDomainEndingAt),
 * so changing it never refetches. Weeks before the first report render as "Not measured", never 0.
 */
export const CHART_RANGES = ['90d', '12m', '3y'] as const;
export type ChartRange = typeof CHART_RANGES[number];

export const CHART_RANGE_DAYS: Record<ChartRange, number> = { '90d': 90, '12m': 365, '3y': 3 * 365 };
export const CHART_RANGE_LABELS: Record<ChartRange, string> = { '90d': '90 days', '12m': '12 months', '3y': '3 years' };

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
