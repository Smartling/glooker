// GLOOK-58 Decision 15: the pure coverage helpers in timeline.ts. Every timestamp is an absolute
// instant (…Z), so the expected keys hold on any host time zone, CI's UTC included. The one
// zone-less case is chosen so it gives the same answer in every zone within ±11h.
import { anchorWeekFor, completedReportWindows, coveredWeeksFromWindows } from '@/lib/report/timeline';

const win = (end: string, periodDays: number) => ({ end: new Date(end), periodDays });

describe('coveredWeeksFromWindows', () => {
  it('a 14-day window ending on a Wednesday lists only the one week all 7 of whose days it covers', () => {
    // 2026-03-04T12:00Z → 2026-03-18T12:00Z. Whole UTC days: Thu 5 … Tue 17. The weeks of Mar 2 and
    // Mar 16 are only partly inside, so only the week of Mar 9 is listed.
    expect(coveredWeeksFromWindows([win('2026-03-18T12:00:00Z', 14)])).toEqual(['2026-03-09']);
  });

  it('a window ending exactly at Monday midnight covers the Sunday before it', () => {
    expect(coveredWeeksFromWindows([win('2026-03-16T00:00:00Z', 7)])).toEqual(['2026-03-09']);
  });

  it('a window that starts mid-day leaves that day, and so its week, out', () => {
    // 2026-03-09T03:00Z → 2026-03-16T03:00Z: Monday the 9th is only partly inside.
    expect(coveredWeeksFromWindows([win('2026-03-16T03:00:00Z', 7)])).toEqual([]);
  });

  it('two reports with a gap of whole weeks between them leave the gap weeks out', () => {
    const weeks = coveredWeeksFromWindows([win('2026-03-02T00:00:00Z', 14), win('2026-04-06T00:00:00Z', 14)]);
    expect(weeks).toEqual(['2026-02-16', '2026-02-23', '2026-03-23', '2026-03-30']);
  });

  it('overlapping windows list each week once, in ascending order', () => {
    // Given newest first on purpose: the output is sorted regardless of input order.
    const weeks = coveredWeeksFromWindows([win('2026-03-23T00:00:00Z', 14), win('2026-03-16T00:00:00Z', 14)]);
    expect(weeks).toEqual(['2026-03-02', '2026-03-09', '2026-03-16']);
  });

  it('two windows that meet mid-day leave no hole: their union covers the shared day', () => {
    // 2026-02-25T12:00Z → 2026-03-11T12:00Z, then 2026-03-11T12:00Z → 2026-03-25T12:00Z. Marking each
    // window alone would lose Mar 11, and with it the week of Mar 9. The union is continuous.
    const weeks = coveredWeeksFromWindows([win('2026-03-11T12:00:00Z', 14), win('2026-03-25T12:00:00Z', 14)]);
    expect(weeks).toEqual(['2026-03-02', '2026-03-09', '2026-03-16']);
  });

  it('a gap of a few hours is still a gap: the day it cuts, and its week, stay out', () => {
    // First window ends 2026-03-11T10:00Z; the second starts 2026-03-11T14:00Z. Nothing searched
    // 10:00-14:00, so Mar 11 is not whole, and the week of Mar 9 is not listed.
    const weeks = coveredWeeksFromWindows([win('2026-03-11T10:00:00Z', 14), win('2026-03-25T14:00:00Z', 14)]);
    expect(weeks).toEqual(['2026-03-02', '2026-03-16']);
  });

  it('skips a window with a NaN period instead of letting it swallow the valid window behind it', () => {
    // Discriminating on purpose (checked by mutation in Step 12): without the guard, the NaN
    // interval [NaN, end] sorts ahead, the valid window merges into it, and its NaN start marks no
    // days, so the result would be [] instead of the valid window's week.
    const weeks = coveredWeeksFromWindows([
      win('2026-03-16T00:00:00Z', Number.NaN),
      win('2026-03-16T00:00:00Z', 7),
    ]);
    expect(weeks).toEqual(['2026-03-09']);
  });

  it('other degenerate windows (an unparseable end, a zero or negative period) add nothing and never throw', () => {
    const weeks = coveredWeeksFromWindows([
      { end: new Date('y'), periodDays: 14 },
      win('2026-03-16T00:00:00Z', 0),
      win('2026-03-16T00:00:00Z', -7),
    ]);
    expect(weeks).toEqual([]);
  });

  it('no windows, no weeks', () => {
    expect(coveredWeeksFromWindows([])).toEqual([]);
  });
});

describe('completedReportWindows', () => {
  it('keeps completed reports only, each windowed on its completed_at', () => {
    const windows = completedReportWindows([
      { status: 'completed', period_days: 14, completed_at: '2026-03-18T12:00:00Z' },
      { status: 'failed', period_days: 30, completed_at: '2026-03-02T00:00:00Z' },
      { status: 'stopped', period_days: 14, completed_at: '2026-01-19T00:00:00Z' },
      { status: 'running', period_days: 14, completed_at: '2026-05-04T00:00:00Z' },
      { status: 'pending', period_days: 14, completed_at: null },
      { status: 'completed', period_days: 14, completed_at: null },
      { status: 'completed', period_days: 14, completed_at: 'y' },
    ]);
    expect(windows.map(w => [w.end.toISOString(), w.periodDays])).toEqual([['2026-03-18T12:00:00.000Z', 14]]);
  });

  it('accepts a MySQL Date and a string period_days', () => {
    const windows = completedReportWindows([
      { status: 'completed', period_days: '14', completed_at: new Date('2026-03-18T12:00:00Z') },
    ]);
    expect(windows.map(w => [w.end.toISOString(), w.periodDays])).toEqual([['2026-03-18T12:00:00.000Z', 14]]);
  });
});

describe('anchorWeekFor', () => {
  const NOW = new Date('2026-09-25T12:00:00Z'); // current UTC week: 2026-09-21

  it("is completed_at's UTC week for a completed report", () => {
    expect(anchorWeekFor('completed', '2026-03-18T12:00:00Z', '2026-03-04T12:00:00Z', NOW)).toBe('2026-03-16');
  });

  it("is created_at's week for a pending report, whose completed_at is null", () => {
    expect(anchorWeekFor('pending', null, '2026-05-13T12:00:00Z', NOW)).toBe('2026-05-11');
  });

  it("is created_at's week for a resumed running report, ignoring its stale completed_at", () => {
    expect(anchorWeekFor('running', '2026-05-04T00:00:00Z', '2026-04-15T12:00:00Z', NOW)).toBe('2026-04-13');
  });

  it("is created_at's week for a failed report, even though failed runs set completed_at", () => {
    expect(anchorWeekFor('failed', '2026-03-02T00:00:00Z', '2026-01-31T00:00:00Z', NOW)).toBe('2026-01-26');
  });

  it("reads SQLite's zone-less local timestamp as host local time, the way getOrgReport already does", () => {
    // Noon local on Wednesday 18 March is still the 18th in UTC for any host zone within ±11h.
    expect(anchorWeekFor('completed', '2026-03-18 12:00:00', null, NOW)).toBe('2026-03-16');
  });

  it('falls back to the current UTC week when the source does not parse, instead of throwing', () => {
    // A completed report's source is completed_at: an unparseable one does NOT fall through to
    // created_at. This is org-model-usage.test.ts's mock row (completed_at 'y', created_at 'x').
    expect(anchorWeekFor('completed', 'y', '2026-03-04T12:00:00Z', NOW)).toBe('2026-09-21');
    expect(anchorWeekFor('running', null, 'x', NOW)).toBe('2026-09-21');
  });
});
