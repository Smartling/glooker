jest.mock('@octokit/rest', () => ({ Octokit: jest.fn().mockImplementation(() => ({})) }));
jest.mock('@/lib/db', () => ({ __esModule: true, default: { execute: jest.fn() } }));

import { RANGE_OPTIONS, parseRange, withRange, rangeNotes, type RangeMeta } from '@/lib/report/range-options';
import { rangeWindow } from '@/lib/report/range';
import { unionDayCount, measuredDaysInWindow, type CoverageWindow } from '@/lib/report/timeline';

const D = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

describe('range options', () => {
  it('offers current, 90d, 12m in that order', () => {
    expect(RANGE_OPTIONS).toEqual(['current', '90d', '12m']);
  });
  it('parseRange: missing/empty is current, exact values pass, anything else is invalid', () => {
    expect(parseRange(null)).toBe('current');
    expect(parseRange('')).toBe('current');
    expect(parseRange('90d')).toBe('90d');
    expect(parseRange('12m')).toBe('12m');
    for (const bad of ['90D', 'all', '30d', ' 90d']) expect(parseRange(bad)).toBeNull();
  });
  it('withRange adds nothing for current and appends correctly otherwise', () => {
    expect(withRange('/api/report/r1', 'current')).toBe('/api/report/r1');
    expect(withRange('/api/report/r1', '90d')).toBe('/api/report/r1?range=90d');
    expect(withRange('/x?login=a', '12m')).toBe('/x?login=a&range=12m');
  });
});

describe('rangeWindow', () => {
  it('ends the day after the report end date and spans exactly the range', () => {
    expect(rangeWindow({ completed_at: '2026-10-27T15:00:00Z', created_at: '2026-10-27T09:00:00Z' }, '90d'))
      .toEqual({ since: '2026-07-30', until: '2026-10-28', days: 90 });
    expect(rangeWindow({ completed_at: '2026-10-27T15:00:00Z' }, '12m'))
      .toEqual({ since: '2025-10-28', until: '2026-10-28', days: 365 });
  });
  it('falls back to created_at when completed_at is missing', () => {
    expect(rangeWindow({ completed_at: null, created_at: '2026-03-10T08:00:00Z' }, '90d').until).toBe('2026-03-11');
  });
});

describe('unionDayCount / measuredDaysInWindow', () => {
  it('counts whole UTC days in the union, clipped to the range', () => {
    // [Sep 1, Sep 11) ∪ [Sep 5, Sep 15) overlap → Sep 1..14 = 14 days; gap; [Sep 20, Sep 22) = 2 days
    const iv: Array<[number, number]> = [[D('2026-09-05'), D('2026-09-15')], [D('2026-09-01'), D('2026-09-11')], [D('2026-09-20'), D('2026-09-22')]];
    expect(unionDayCount(iv, D('2026-08-01'), D('2026-10-01'))).toBe(16);
    expect(unionDayCount(iv, D('2026-09-10'), D('2026-09-21'))).toBe(6); // Sep 10..14 + Sep 20
  });
  it('does not count a partly covered day', () => {
    expect(unionDayCount([[D('2026-09-01') + 3_600_000, D('2026-09-03') + 3_600_000]], 0, D('2027-01-01'))).toBe(1);
  });
  it('measured days come from report windows [completed_at − period, created_at]', () => {
    const w = (created: string, completed: string, periodDays: number): CoverageWindow =>
      ({ createdAt: new Date(created), completedAt: new Date(completed), periodDays });
    const windows = [
      w('2026-10-01T12:00:00Z', '2026-10-01T13:00:00Z', 14),
      w('2026-10-02T12:00:00Z', '2026-10-02T13:00:00Z', 14),
      w('2026-10-03T12:00:00Z', '2026-10-03T13:00:00Z', 14),
    ];
    expect(measuredDaysInWindow(windows, '2026-07-30', '2026-10-28')).toBe(15); // Sep 18 .. Oct 2
    expect(measuredDaysInWindow([], '2026-07-30', '2026-10-28')).toBe(0);
  });
});

describe('rangeNotes', () => {
  const meta: RangeMeta = { key: '12m', since: '2025-10-28', until: '2026-10-28', days: 365, measuredDays: 212, prCoveredSince: '2026-03-03' };
  it('says how many days were measured and from when PR data exists', () => {
    expect(rangeNotes(meta)).toEqual(['212 of 365 days measured', 'PR and review data from Mar 3']);
  });
  it('is silent when fully measured and covered', () => {
    expect(rangeNotes({ ...meta, measuredDays: 365, prCoveredSince: '2025-10-28' })).toEqual([]);
    expect(rangeNotes(null)).toEqual([]);
  });
  it('says when no PR data exists at all', () => {
    expect(rangeNotes({ ...meta, measuredDays: 365, prCoveredSince: null })).toEqual(['No PR and review data in this range']);
  });
});
