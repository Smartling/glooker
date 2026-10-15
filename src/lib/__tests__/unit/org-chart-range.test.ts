import { CHART_RANGES, chartRangeDays, weekTickFormatter } from '@/app/report/[id]/org/chart-range';
import { formatWeek, weekDomainEndingAt } from '@/components/charts/chart-format';

const ANCHOR = '2026-10-12';
const domain = (r: (typeof CHART_RANGES)[number], first?: string) => weekDomainEndingAt(ANCHOR, chartRangeDays(r, ANCHOR, first));

describe('org chart range (POC)', () => {
  it('offers 90 days, 12 months and all time, with 90 days first (the default)', () => {
    expect(CHART_RANGES).toEqual(['90d', '12m', 'all']);
  });

  it('90 days and 12 months end at the report week', () => {
    expect(domain('90d').length).toBeGreaterThanOrEqual(13);
    expect(domain('90d').length).toBeLessThanOrEqual(14);
    expect(domain('12m').length).toBeGreaterThanOrEqual(52);
    expect(domain('12m').length).toBeLessThanOrEqual(54);
    expect(domain('12m').at(-1)).toBe(ANCHOR);
  });

  it('all time starts exactly at the first week with data', () => {
    const d = domain('all', '2025-06-02');
    expect(d[0]).toBe('2025-06-02');
    expect(d.at(-1)).toBe(ANCHOR);
  });

  it('all time falls back to 90 days without a usable first week', () => {
    expect(chartRangeDays('all', ANCHOR, undefined)).toBe(90);
    expect(chartRangeDays('all', ANCHOR, 'garbage')).toBe(90);
    expect(chartRangeDays('all', ANCHOR, '2027-01-04')).toBe(90); // after the anchor
  });

  it('keeps "Oct 13" labels on 90 days and adds the year beyond it', () => {
    expect(weekTickFormatter('90d')).toBe(formatWeek);
    expect(weekTickFormatter('12m')('2025-10-13')).toBe("Oct '25");
    expect(weekTickFormatter('all')('2026-01-05')).toBe("Jan '26");
    expect(weekTickFormatter('all')('not-a-week')).toBe('not-a-week');
  });
});
