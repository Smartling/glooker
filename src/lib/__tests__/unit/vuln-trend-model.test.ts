// src/lib/__tests__/unit/vuln-trend-model.test.ts
// The trend card's pure rules: the domain, the rows, the history messages and the legend.
import {
  buildLegend, dayNumber, isoOfDay, trendDomain, trendRows, trendStatus, trendTicks, SHORT_HISTORY_DAYS, TREND_MIN_SPAN_DAYS,
} from '@/app/vulnerabilities/trend-model';
import { addDays } from '@/lib/vulnerabilities/time';
import { OTHER_TEAM_COLOR } from '@/app/vulnerabilities/team-colors';
import { ovSeries } from '../support/security-fixtures';

const TODAY = '2026-09-30';

describe('trendDomain', () => {
  // Revert: start "All" at the window start instead of the first point, or drop the 7-day floor.
  it('All runs from the first point to today', () => {
    const s = [ovSeries('Payments', [['2026-03-18', 5], ['2026-09-29', 11]])];
    expect(trendDomain('all', s, TODAY)).toEqual({ start: '2026-03-18', end: TODAY });
  });

  it(`All never spans less than ${TREND_MIN_SPAN_DAYS} days: two recent points, one point, or none`, () => {
    const floor = '2026-09-23';
    expect(trendDomain('all', [ovSeries('A', [['2026-09-28', 1], ['2026-09-29', 2]])], TODAY)).toEqual({ start: floor, end: TODAY });
    expect(trendDomain('all', [ovSeries('A', [['2026-09-30', 1]])], TODAY)).toEqual({ start: floor, end: TODAY });
    expect(trendDomain('all', [], TODAY)).toEqual({ start: floor, end: TODAY });
  });

  // Revert: compute the start from the first point for the other ranges too.
  it('the other ranges run from today minus 30, 90 or 365 days to today, whatever the data', () => {
    const s = [ovSeries('A', [['2026-09-20', 1], ['2026-09-29', 2]])];
    expect(trendDomain('30d', s, TODAY).start).toBe('2026-08-31');
    expect(trendDomain('90d', s, TODAY).start).toBe('2026-07-02');
    expect(trendDomain('1y', s, TODAY).start).toBe('2025-09-30');
    expect(trendDomain('30d', s, TODAY).end).toBe(TODAY);
  });

  it('a point after today extends the end instead of falling off the plot', () => {
    expect(trendDomain('all', [ovSeries('A', [['2026-09-01', 1], ['2026-10-02', 2]])], TODAY).end).toBe('2026-10-02');
  });
});

describe('ticks and day numbers', () => {
  it('round-trip an ISO date through the day number', () => {
    expect(isoOfDay(dayNumber('2026-09-30'))).toBe('2026-09-30');
    expect(dayNumber('2026-10-01') - dayNumber('2026-09-30')).toBe(1);
  });

  it('five evenly spaced whole-day ticks including both ends', () => {
    const t = trendTicks('2026-09-02', '2026-09-30');
    expect(t).toHaveLength(5);
    expect(t[0]).toBe(dayNumber('2026-09-02'));
    expect(t[4]).toBe(dayNumber('2026-09-30'));
    expect(t.every(Number.isInteger)).toBe(true);
  });

  // Revert: floor or ceil instead of round (a half day goes to the later day), or space the ticks by a fixed step.
  it('a 7-day span rounds each tick to a whole day: offsets 0, 2, 4, 5, 7', () => {
    const d = dayNumber('2026-09-01');
    expect(trendTicks('2026-09-01', '2026-09-08')).toEqual([d, d + 2, d + 4, d + 5, d + 7]);
  });

  it('honours the count', () => {
    const d = dayNumber('2026-09-01');
    expect(trendTicks('2026-09-01', '2026-09-08', 3)).toEqual([d, d + 4, d + 7]);
  });
});

describe('trendRows', () => {
  // Revert: key rows by index, or merge teams that have different dates.
  it('has one row per date, keyed by team, with the actual day number (names with dots stay intact)', () => {
    const rows = trendRows([
      ovSeries('team.alpha', [['2026-09-01', 2], ['2026-09-29', 3]]),
      ovSeries('Search', [['2026-09-29', 7]]),
    ]);
    expect(rows.map(r => r.date)).toEqual(['2026-09-01', '2026-09-29']);
    expect(rows[1].values).toEqual({ 'team.alpha': 3, Search: 7 });
    expect(rows[0].values).toEqual({ 'team.alpha': 2 });
    expect(rows[1].t - rows[0].t).toBe(28);
  });

  it('coerces a string count from the database', () => {
    expect(trendRows([{ team: 'A', points: [{ date: '2026-09-29', open: '4' as unknown as number }] }])[0].values.A).toBe(4);
  });
});

describe('trendStatus', () => {
  // Revert: swap the two messages, or require only one point for a line.
  it('0 points: "No measurements yet", with the sub-line for the range', () => {
    expect(trendStatus([], 'all', TODAY).message).toEqual({ title: 'No measurements yet', sub: 'History starts at the first sync.' });
    expect(trendStatus([], '30d', TODAY).message).toEqual({ title: 'No measurements yet', sub: 'No measurements in this range.' });
  });

  it('1 point: "Not enough history yet" and where it is', () => {
    const s = trendStatus([ovSeries('A', [['2026-09-30', 1]]), ovSeries('B', [['2026-09-30', 2]])], 'all', TODAY);
    expect(s.measurements).toBe(1);
    expect(s.message).toEqual({ title: 'Not enough history yet', sub: '1 measurement so far (Sep 30). The line appears after the next sync.' });
  });

  it('counts distinct dates across all teams, not points per team', () => {
    const s = trendStatus([ovSeries('A', [['2026-09-01', 1]]), ovSeries('B', [['2026-09-29', 2]])], 'all', TODAY);
    expect(s.measurements).toBe(2);
    expect(s.message).toBeNull();
  });

  // Revert: show the note for an older history, or for a range other than All.
  it(`a history younger than ${SHORT_HISTORY_DAYS} days under All gets the "History starts" note`, () => {
    const young = [ovSeries('A', [['2026-09-22', 1], ['2026-09-29', 2]])];
    expect(trendStatus(young, 'all', TODAY).note).toBe('History starts Sep 22 (first sync) · 2 measurements');
    expect(trendStatus(young, '90d', TODAY).note).toBeNull();
    const old = [ovSeries('A', [['2026-03-18', 1], ['2026-09-29', 2]])];
    expect(trendStatus(old, 'all', TODAY).note).toBeNull();
    const edge = [ovSeries('A', [['2026-09-16', 1], ['2026-09-29', 2]])]; // exactly 14 days: not short
    expect(trendStatus(edge, 'all', TODAY).note).toBeNull();
  });

  // Revert: change the constant's comparison (< to <=), or hard-code another number in trendStatus.
  it('the note boundary is the constant: a first point SHORT_HISTORY_DAYS - 1 days back shows it, SHORT_HISTORY_DAYS back does not', () => {
    const history = (daysBack: number) => [ovSeries('A', [[addDays(TODAY, -daysBack), 1], [addDays(TODAY, -1), 2]])];
    expect(trendStatus(history(SHORT_HISTORY_DAYS - 1), 'all', TODAY).note).not.toBeNull();
    expect(trendStatus(history(SHORT_HISTORY_DAYS), 'all', TODAY).note).toBeNull();
    expect(SHORT_HISTORY_DAYS).toBe(14);
  });

  it('writes the first date with its year when that date is not in the current year', () => {
    // "today" is in 2031, a year the suite never runs in, so a note that ignored the argument would fail.
    const s = trendStatus([ovSeries('A', [['2030-12-30', 1], ['2031-01-02', 2]])], 'all', '2031-01-05');
    expect(s.note).toBe('History starts Dec 30, 2030 (first sync) · 2 measurements');
    const same = trendStatus([ovSeries('A', [['2031-01-01', 1], ['2031-01-02', 2]])], 'all', '2031-01-05');
    expect(same.note).toBe('History starts Jan 1 (first sync) · 2 measurements');
  });
});

describe('buildLegend', () => {
  const many = Array.from({ length: 15 }, (_, i) => ovSeries(`Team ${String(i + 1).padStart(2, '0')}`, [['2026-09-01', 15 - i], ['2026-09-29', 15 - i]]));

  // Revert: list only the teams that got a colour, or one "Other" entry per team.
  it('lists every team: the top 12 by open count, then one "Other · N teams" entry', () => {
    const l = buildLegend(many, null);
    expect(l).toHaveLength(13);
    expect(l.slice(0, 12).map(e => e.label)).toEqual(many.slice(0, 12).map(s => s.team));
    expect(l[12].label).toBe('Other · 3 teams');
    expect(l[12].color).toBe(OTHER_TEAM_COLOR);
    expect(l[12].open).toBe(3 + 2 + 1);
    expect(new Set(l.slice(0, 12).map(e => e.color)).size).toBe(12);
  });

  // Revert: leave the names out of the tooltip.
  it('the "Other" entry\'s title names every team it stands for, and a named entry\'s title is its name', () => {
    const l = buildLegend(many, null);
    expect(l[12].title).toBe('Team 13, Team 14, Team 15');
    expect(l[0].title).toBe('Team 01');
  });

  it('"Other · 1 team" is singular, and no "Other" entry exists with 12 teams or fewer', () => {
    expect(buildLegend(many.slice(0, 13), null).at(-1)?.label).toBe('Other · 1 team');
    expect(buildLegend(many.slice(0, 12), null).some(e => e.label.startsWith('Other'))).toBe(false);
  });

  it('orders by open count, ties by name, and shows each team\'s latest count', () => {
    const l = buildLegend([ovSeries('Search', [['2026-09-29', 3]]), ovSeries('Payments', [['2026-09-29', 3]]), ovSeries('Platform', [['2026-09-22', 1], ['2026-09-29', 9]])], null);
    expect(l.map(e => [e.label, e.open])).toEqual([['Platform', 9], ['Payments', 3], ['Search', 3]]);
  });

  // Revert: drop entries for the unselected teams (the legend would then change height), or dim the selected one.
  it('selecting a team keeps every entry and dims all but that one to "dimmed"', () => {
    const l = buildLegend(many, 'Team 02');
    expect(l).toHaveLength(13);
    expect(l.filter(e => !e.dimmed).map(e => e.label)).toEqual(['Team 02']);
    expect(l.find(e => e.selected)?.label).toBe('Team 02');
  });

  it('selecting a team inside "Other" leaves only the "Other" entry undimmed', () => {
    const l = buildLegend(many, 'Team 14');
    expect(l.filter(e => !e.dimmed).map(e => e.label)).toEqual(['Other · 3 teams']);
  });

  it('with no team selected nothing is dimmed or selected', () => {
    const l = buildLegend(many, null);
    expect(l.some(e => e.dimmed || e.selected)).toBe(false);
  });

  it('no series, no entries', () => {
    expect(buildLegend([], null)).toEqual([]);
  });
});
