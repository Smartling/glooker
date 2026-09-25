import {
  buildWeekDomain, fillWeeks, formatCompact, formatValue, formatWeek, indexByWeek, isTopOfStack,
  mondayOf, recentWeekDomain, toNum,
} from '@/components/charts/chart-format';

const utc = (iso: string) => new Date(`${iso}T12:00:00Z`);
const dow = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay();

describe('toNum', () => {
  it('parses DECIMAL strings and passes numbers through', () => {
    expect(toNum('12.50')).toBe(12.5);
    expect(toNum(7)).toBe(7);
  });
  it('renders everything unusable as 0 instead of NaN', () => {
    expect(toNum('')).toBe(0);
    expect(toNum('abc')).toBe(0);
    expect(toNum(null)).toBe(0);
    expect(toNum(undefined)).toBe(0);
    expect(toNum(NaN)).toBe(0);
    expect(toNum(Infinity)).toBe(0);
  });
});

describe('week domain (UTC)', () => {
  it('mondayOf returns the Monday of the containing UTC week', () => {
    expect(mondayOf(utc('2026-09-25'))).toBe('2026-09-21'); // Friday
    expect(mondayOf(utc('2026-09-21'))).toBe('2026-09-21'); // Monday
    expect(mondayOf(utc('2026-09-27'))).toBe('2026-09-21'); // Sunday belongs to the week before
    expect(mondayOf(new Date('2026-09-27T23:59:59Z'))).toBe('2026-09-21');
  });

  it('buildWeekDomain lists every Monday from the cutoff week to the current week, 7 days apart', () => {
    const weeks = buildWeekDomain(utc('2026-06-27'), utc('2026-09-25'));
    expect(weeks[0]).toBe('2026-06-22');
    expect(weeks[weeks.length - 1]).toBe('2026-09-21');
    expect(weeks).toHaveLength(14);
    weeks.forEach(w => expect(dow(w)).toBe(1));
    for (let i = 1; i < weeks.length; i++) {
      expect(Date.parse(weeks[i]) - Date.parse(weeks[i - 1])).toBe(7 * 86_400_000);
    }
  });

  // GLOOK-58 final review: this used to also assert recentWeekDomain(now) equals
  // recentWeekDomain(now) — comparing the pure function's output with itself, which can't fail and
  // proves nothing. That equality is a tautology at the pure-function level; the real, renderable
  // promise this pure function makes ("every chart on a page gets an identical week array") is
  // checked against real chart output in chart-domain-alignment.test.tsx instead. What's left
  // here is the one thing that's actually specific to recentWeekDomain: its default 90-day window
  // matches an equivalent explicit buildWeekDomain call.
  it("recentWeekDomain's default 90-day window matches an equivalent buildWeekDomain call", () => {
    const now = utc('2026-09-25');
    expect(recentWeekDomain(now)).toEqual(buildWeekDomain(new Date(now.getTime() - 90 * 86_400_000), now));
  });
});

describe('fillWeeks', () => {
  const weeks = ['2026-09-07', '2026-09-14', '2026-09-21'];

  it("kind 'count': a missing week is a real 0", () => {
    const pts = fillWeeks(weeks, [{ week: '2026-09-14', n: 4 }], { value: r => r.n, kind: 'count' });
    expect(pts.map(p => p.value)).toEqual([0, 4, 0]);
    expect(pts.map(p => p.hasData)).toEqual([false, true, false]);
  });

  it("kind 'ratio': a missing week has no value (null), so it renders as a gap", () => {
    const pts = fillWeeks(weeks, [{ week: '2026-09-14', r: 2.5 }], { value: r => r.r, kind: 'ratio' });
    expect(pts.map(p => p.value)).toEqual([null, 2.5, null]);
  });

  it('isDefined returning false gives null for a ratio week that is present', () => {
    const data = [{ week: '2026-09-07', avg: 0, prs: 0 }, { week: '2026-09-14', avg: 120, prs: 3 }];
    const pts = fillWeeks(weeks, data, { value: r => r.avg, kind: 'ratio', isDefined: r => r.prs > 0 });
    expect(pts.map(p => p.value)).toEqual([null, 120, null]);
    expect(pts[0].hasData).toBe(false);
  });

  it('an undefined ratio value (an optional field) is a gap, not a 0', () => {
    const pts = fillWeeks(weeks, [{ week: '2026-09-14' } as { week: string; v?: number }], { value: r => r.v, kind: 'ratio' });
    expect(pts[1].value).toBeNull();
  });

  it('string numerics are converted, and rows outside the domain are ignored', () => {
    const data = [{ week: '2026-08-31', n: '9' }, { week: '2026-09-21', n: '3' }];
    expect(fillWeeks(weeks, data, { value: r => r.n, kind: 'count' }).map(p => p.value)).toEqual([0, 0, 3]);
  });

  it('data entirely outside the domain (an old report) yields no week with data', () => {
    const pts = fillWeeks(weeks, [{ week: '2025-01-06', n: 5 }], { value: r => r.n, kind: 'count' });
    expect(pts.some(p => p.hasData)).toBe(false);
  });

  it('two metrics filled from the same domain produce identical week sequences (syncId matches by index)', () => {
    const data = [{ week: '2026-09-14', a: 1, b: 2 }];
    const a = fillWeeks(weeks, data, { value: r => r.a, kind: 'count' }).map(p => p.week);
    const b = fillWeeks(weeks, data, { value: r => r.b, kind: 'ratio' }).map(p => p.week);
    expect(a).toEqual(weeks);
    expect(b).toEqual(weeks);
  });

  it('indexByWeek looks rows up by exact key', () => {
    const idx = indexByWeek([{ week: '2026-09-07', n: 1 }]);
    expect(idx.get('2026-09-07')?.n).toBe(1);
    expect(idx.get('2026-09-08')).toBeUndefined();
  });
});

describe('formatters', () => {
  it('formatWeek prints a short UTC date', () => {
    expect(formatWeek('2026-09-21')).toBe('Sep 21');
    expect(formatWeek('not-a-date')).toBe('not-a-date');
  });
  it('formatValue respects suffix and decimals, groups thousands, and shows a dash for no value', () => {
    expect(formatValue(1234, { suffix: ' lines' })).toBe('1,234 lines');
    expect(formatValue(2.345, { decimals: 1 })).toBe('2.3');
    expect(formatValue(42, { suffix: '%' })).toBe('42%');
    expect(formatValue(null)).toBe('—');
  });
  it('formatCompact abbreviates axis values and keeps the sign', () => {
    expect(formatCompact(1500)).toBe('1.5K');
    expect(formatCompact(-2000)).toBe('-2K');
    expect(formatCompact(12)).toBe('12');
  });
});

describe('isTopOfStack', () => {
  const keys = ['a', 'b', 'c'];
  it('is true when every later key in the stack is zero', () => {
    expect(isTopOfStack({ a: 1, b: 2, c: 0 }, keys, 'b')).toBe(true);
    expect(isTopOfStack({ a: 1, b: 2, c: 3 }, keys, 'b')).toBe(false);
    expect(isTopOfStack({ a: 1, b: 0, c: '0' }, keys, 'a')).toBe(true);
  });
});
