// GLOOK-58 Decision 15: the pure coverage helpers in timeline.ts. Every timestamp is an absolute
// instant (…Z), so the expected keys hold on any host time zone, CI's UTC included. The one
// zone-less case is chosen so it gives the same answer in every zone within ±11h.
//
// *(Corrected after the Task 12 review.)* A window's right edge is created_at, not completed_at: a
// member searched early in a long run is not re-searched for commits made later in that same run,
// so completed_at could over-claim the tail. created_at ≤ runStart, which every member's search
// covered, so it's the safe right edge.
import { anchorWeekFor, completedReportWindows, coveredWeeksFromWindows } from '@/lib/report/timeline';

const win = (completedAt: string, createdAt: string, periodDays: number) => ({
  completedAt: new Date(completedAt),
  createdAt: new Date(createdAt),
  periodDays,
});
// A window whose completed_at and created_at are the same instant: a "quick" run, where the fix
// changes nothing from the old single-edge behavior.
const quickWin = (end: string, periodDays: number) => win(end, end, periodDays);

describe('coveredWeeksFromWindows', () => {
  it('a 14-day window ending on a Wednesday lists only the one week all 7 of whose days it covers', () => {
    // 2026-03-04T12:00Z → 2026-03-18T12:00Z. Whole UTC days: Thu 5 … Tue 17. The weeks of Mar 2 and
    // Mar 16 are only partly inside, so only the week of Mar 9 is listed.
    expect(coveredWeeksFromWindows([quickWin('2026-03-18T12:00:00Z', 14)])).toEqual(['2026-03-09']);
  });

  it('a window ending exactly at Monday midnight covers the Sunday before it', () => {
    expect(coveredWeeksFromWindows([quickWin('2026-03-16T00:00:00Z', 7)])).toEqual(['2026-03-09']);
  });

  it('a window that starts mid-day leaves that day, and so its week, out', () => {
    // 2026-03-09T03:00Z → 2026-03-16T03:00Z: Monday the 9th is only partly inside.
    expect(coveredWeeksFromWindows([quickWin('2026-03-16T03:00:00Z', 7)])).toEqual([]);
  });

  it('two reports with a gap of whole weeks between them leave the gap weeks out', () => {
    const weeks = coveredWeeksFromWindows([quickWin('2026-03-02T00:00:00Z', 14), quickWin('2026-04-06T00:00:00Z', 14)]);
    expect(weeks).toEqual(['2026-02-16', '2026-02-23', '2026-03-23', '2026-03-30']);
  });

  it('overlapping windows list each week once, in ascending order', () => {
    // Given newest first on purpose: the output is sorted regardless of input order.
    const weeks = coveredWeeksFromWindows([quickWin('2026-03-23T00:00:00Z', 14), quickWin('2026-03-16T00:00:00Z', 14)]);
    expect(weeks).toEqual(['2026-03-02', '2026-03-09', '2026-03-16']);
  });

  it('two windows that meet mid-day leave no hole: their union covers the shared day', () => {
    // 2026-02-25T12:00Z → 2026-03-11T12:00Z, then 2026-03-11T12:00Z → 2026-03-25T12:00Z. Marking each
    // window alone would lose Mar 11, and with it the week of Mar 9. The union is continuous.
    const weeks = coveredWeeksFromWindows([quickWin('2026-03-11T12:00:00Z', 14), quickWin('2026-03-25T12:00:00Z', 14)]);
    expect(weeks).toEqual(['2026-03-02', '2026-03-09', '2026-03-16']);
  });

  it('a gap of a few hours is still a gap: the day it cuts, and its week, stay out', () => {
    // First window ends 2026-03-11T10:00Z; the second starts 2026-03-11T14:00Z. Nothing searched
    // 10:00-14:00, so Mar 11 is not whole, and the week of Mar 9 is not listed.
    const weeks = coveredWeeksFromWindows([quickWin('2026-03-11T10:00:00Z', 14), quickWin('2026-03-25T14:00:00Z', 14)]);
    expect(weeks).toEqual(['2026-03-02', '2026-03-16']);
  });

  it('skips a window with a NaN period instead of letting it swallow the valid window behind it', () => {
    // Discriminating on purpose (checked by mutation in Step 12): without the guard, the NaN
    // interval [NaN, end] sorts ahead, the valid window merges into it, and its NaN start marks no
    // days, so the result would be [] instead of the valid window's week.
    const weeks = coveredWeeksFromWindows([
      quickWin('2026-03-16T00:00:00Z', Number.NaN),
      quickWin('2026-03-16T00:00:00Z', 7),
    ]);
    expect(weeks).toEqual(['2026-03-09']);
  });

  it('other degenerate windows (an unparseable date, a zero or negative period) add nothing and never throw', () => {
    const weeks = coveredWeeksFromWindows([
      { completedAt: new Date('y'), createdAt: new Date('2026-03-16T00:00:00Z'), periodDays: 14 },
      quickWin('2026-03-16T00:00:00Z', 0),
      quickWin('2026-03-16T00:00:00Z', -7),
    ]);
    expect(weeks).toEqual([]);
  });

  it('no windows, no weeks', () => {
    expect(coveredWeeksFromWindows([])).toEqual([]);
  });

  it("the right edge is created_at, not completed_at — a completed_at far past created_at doesn't extend the window", () => {
    // start = completed_at(2026-03-23) - 14d = 2026-03-09T00:00Z. end = created_at = 2026-03-16T00:00Z.
    // Whole days Mar 9-15 cover exactly the week of Mar 9. If completed_at were (wrongly) used as the
    // right edge instead, the window would reach 2026-03-23T00:00Z, whole days would run through
    // Mar 22, and the week of Mar 16 would be wrongly claimed too.
    const weeks = coveredWeeksFromWindows([win('2026-03-23T00:00:00Z', '2026-03-16T00:00:00Z', 14)]);
    expect(weeks).toEqual(['2026-03-09']);
    expect(weeks).not.toContain('2026-03-16');
  });

  it('a long run (created Monday 23:00Z, completed Tuesday 02:00Z the next day) does not claim the week holding that Tuesday', () => {
    // created_at 2026-03-16T23:00Z (Monday), completed_at 2026-03-17T02:00Z (Tuesday): the run
    // straddled midnight. A second, quick report starts its own window exactly at that completed_at
    // (2026-03-17T02:00Z), the way a report started right after this one would. Under the OLD
    // (completed_at-anchored) formula the two windows would touch exactly at 2026-03-17T02:00Z and
    // merge, wrongly making the week of Mar 16 whole. Under the fix, the long run's right edge is its
    // OWN created_at (2026-03-16T23:00Z), 3 hours earlier, so a gap opens between the two windows:
    // nothing searched 23:00-02:00. Mar 16 and Mar 17 both stay partial, and the week of Mar 16 is not
    // claimed by either window or their union.
    const longRun = win('2026-03-17T02:00:00Z', '2026-03-16T23:00:00Z', 21);
    const nextRun = quickWin('2026-03-24T02:00:00Z', 7); // starts 2026-03-17T02:00Z
    const weeks = coveredWeeksFromWindows([longRun, nextRun]);
    expect(weeks).toEqual(['2026-03-02', '2026-03-09']);
    expect(weeks).not.toContain('2026-03-16');
  });

  it('a report resumed long after it was created yields an empty window: no coverage, no throw', () => {
    // completed_at 2026-04-06, created_at 2026-01-05: start = completed_at - 14d = 2026-03-23, which
    // is AFTER end (created_at 2026-01-05). The window is inverted, so it contributes nothing.
    const weeks = coveredWeeksFromWindows([win('2026-04-06T00:00:00Z', '2026-01-05T09:00:00Z', 14)]);
    expect(weeks).toEqual([]);
  });
});

describe('completedReportWindows', () => {
  it('keeps completed reports only, each carrying its completed_at and created_at', () => {
    const windows = completedReportWindows([
      { status: 'completed', period_days: 14, completed_at: '2026-03-18T12:00:00Z', created_at: '2026-03-16T00:00:00Z' },
      { status: 'failed', period_days: 30, completed_at: '2026-03-02T00:00:00Z', created_at: '2026-01-31T00:00:00Z' },
      { status: 'stopped', period_days: 14, completed_at: '2026-01-19T00:00:00Z', created_at: '2026-01-05T00:00:00Z' },
      { status: 'running', period_days: 14, completed_at: '2026-05-04T00:00:00Z', created_at: '2026-04-15T12:00:00Z' },
      { status: 'pending', period_days: 14, completed_at: null, created_at: '2026-05-13T12:00:00Z' },
      { status: 'completed', period_days: 14, completed_at: null, created_at: '2026-05-13T12:00:00Z' },
      { status: 'completed', period_days: 14, completed_at: 'y', created_at: '2026-03-04T12:00:00Z' },
      // Unparseable created_at is skipped too, even though completed_at is fine.
      { status: 'completed', period_days: 14, completed_at: '2026-03-18T12:00:00Z', created_at: 'y' },
    ]);
    expect(windows.map(w => [w.completedAt.toISOString(), w.createdAt.toISOString(), w.periodDays])).toEqual([
      ['2026-03-18T12:00:00.000Z', '2026-03-16T00:00:00.000Z', 14],
    ]);
  });

  it('accepts a MySQL Date and a string period_days', () => {
    const windows = completedReportWindows([
      {
        status: 'completed', period_days: '14',
        completed_at: new Date('2026-03-18T12:00:00Z'), created_at: new Date('2026-03-16T00:00:00Z'),
      },
    ]);
    expect(windows.map(w => [w.completedAt.toISOString(), w.createdAt.toISOString(), w.periodDays])).toEqual([
      ['2026-03-18T12:00:00.000Z', '2026-03-16T00:00:00.000Z', 14],
    ]);
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
