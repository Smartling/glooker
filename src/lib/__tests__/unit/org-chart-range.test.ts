import { CHART_RANGES, CHART_RANGE_DAYS, weekTickFormatter } from '@/app/report/[id]/org/chart-range';
import { formatWeek, weekDomainEndingAt } from '@/components/charts/chart-format';

describe('org chart range (POC)', () => {
  it('offers 90 days, 12 months and 3 years, with 90 days first (the default)', () => {
    expect(CHART_RANGES).toEqual(['90d', '12m', '3y']);
  });

  it('widens the week domain ending at the report week', () => {
    const anchor = '2026-10-12';
    const lens = CHART_RANGES.map(r => weekDomainEndingAt(anchor, CHART_RANGE_DAYS[r]).length);
    expect(lens[0]).toBeGreaterThanOrEqual(13);
    expect(lens[0]).toBeLessThanOrEqual(14);
    expect(lens[1]).toBeGreaterThanOrEqual(52);
    expect(lens[1]).toBeLessThanOrEqual(54);
    expect(lens[2]).toBeGreaterThanOrEqual(156);
    expect(lens[2]).toBeLessThanOrEqual(158);
    for (const r of CHART_RANGES) expect(weekDomainEndingAt(anchor, CHART_RANGE_DAYS[r]).at(-1)).toBe(anchor);
  });

  it('keeps "Oct 13" labels on 90 days and adds the year beyond it', () => {
    expect(weekTickFormatter('90d')).toBe(formatWeek);
    expect(weekTickFormatter('12m')('2025-10-13')).toBe("Oct '25");
    expect(weekTickFormatter('3y')('2026-01-05')).toBe("Jan '26");
    expect(weekTickFormatter('3y')('not-a-week')).toBe('not-a-week');
  });
});
