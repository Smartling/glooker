import { CHART_RANGES, chartRangeDays, chartTicks, weekTickFormatter, type ChartRange } from '@/app/report/[id]/org/chart-range';
import { formatWeek, formatWeekLong, weekDomainEndingAt } from '@/components/charts/chart-format';

const ANCHOR = '2026-10-12'; // a Monday
const domain = (r: ChartRange, first?: string, anchor: string | undefined = ANCHOR) =>
  weekDomainEndingAt(anchor, chartRangeDays(r, anchor, first));

describe('org chart range', () => {
  it('offers 90 days, 12 months and all time, with 90 days first (the default)', () => {
    expect(CHART_RANGES).toEqual(['90d', '12m', 'all']);
  });

  it('fixed ranges end at the report week and start where expected', () => {
    expect(domain('90d')[0]).toBe('2026-07-13');
    expect(domain('90d').at(-1)).toBe(ANCHOR);
    expect(domain('90d')).toHaveLength(14);
    expect(domain('12m')[0]).toBe('2025-10-06'); // 365 days back is Sun 2025-10-12, floored to its Monday
    expect(domain('12m').at(-1)).toBe(ANCHOR);
    expect(domain('12m')).toHaveLength(54);
  });

  it('all time starts exactly at the first week with data', () => {
    const d = domain('all', '2025-06-02');
    expect(d[0]).toBe('2025-06-02');
    expect(d.at(-1)).toBe(ANCHOR);
  });

  it('all time accepts a first date that is not a Monday (floors to its week)', () => {
    expect(domain('all', '2025-06-04')[0]).toBe('2025-06-02');
  });

  it('all time is never shorter than 90 days', () => {
    expect(domain('all', ANCHOR)).toEqual(domain('90d'));          // first week = anchor
    expect(domain('all', '2026-09-21')).toEqual(domain('90d'));    // 3 weeks of history
    expect(chartRangeDays('all', ANCHOR, '2027-01-04')).toBe(90);  // first week after the anchor
  });

  it('all time without an anchor measures from the current week, like weekDomainEndingAt does', () => {
    const now = new Date('2026-10-14T12:00:00Z');
    expect(chartRangeDays('all', undefined, '2025-06-02', now)).toBe(chartRangeDays('all', ANCHOR, '2025-06-02'));
  });

  it('all time without a usable first week is 90 days', () => {
    expect(chartRangeDays('all', ANCHOR, undefined)).toBe(90);
    expect(chartRangeDays('all', ANCHOR, 'garbage')).toBe(90);
  });

  it('labels: "Oct 13" on 90 days, month and year beyond it', () => {
    expect(weekTickFormatter('90d')).toBe(formatWeek);
    expect(weekTickFormatter('12m')('2025-10-13')).toBe("Oct '25");
    expect(weekTickFormatter('all')('2026-01-05')).toBe("Jan '26");
    expect(weekTickFormatter('all')('not-a-week')).toBe('not-a-week');
    expect(weekTickFormatter('12m')).toBe(weekTickFormatter('all')); // stable reference
  });

  it('tooltips carry the year', () => {
    expect(formatWeekLong('2025-10-13')).toBe('Oct 13, 2025');
  });

  it('ticks: none on 90 days; one per month on 12 months, each label unique', () => {
    expect(chartTicks('90d', domain('90d'))).toBeUndefined();
    const t = chartTicks('12m', domain('12m'))!;
    expect(t[0]).toBe('2025-10-06');
    expect(t).toHaveLength(13);
    const labels = t.map(weekTickFormatter('12m'));
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('ticks: quarter starts once months would exceed 13 labels', () => {
    const t = chartTicks('all', domain('all', '2024-01-01'))!;
    expect(t.length).toBeLessThanOrEqual(13);
    expect(t.every(w => ['01', '04', '07', '10'].includes(w.slice(5, 7)))).toBe(true);
  });
});
