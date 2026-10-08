/** @jest-environment jsdom */
// src/lib/__tests__/unit/vuln-kpi-tiles.test.tsx
// The KPI row and its first tile, "Open {severity} alerts": the count, the change sentence and the
// sparkline. The other three tiles have their own files (vuln-kpi-since, -resolved, -sla).
import { render, screen, within } from '@testing-library/react';
import KpiTiles from '@/app/vulnerabilities/kpi-tiles';
import * as labels from '@/app/vulnerabilities/labels';
import type { SummaryData, TrendData } from '@/app/vulnerabilities/api-types';
import { KPI_ROW_H, SPARK_H } from '@/app/vulnerabilities/dimensions';
import {
  ovBaseline, ovCell, ovDelta, ovDeltaTeam, ovNoBaseline, ovProps, ovSeries, ovTeam, slot, trendFixture,
} from '../support/security-fixtures';

beforeEach(() => { jest.useFakeTimers().setSystemTime(new Date('2026-09-30T12:00:00Z')); });
afterEach(() => { jest.useRealTimers(); });

const openTile = () => screen.getByTestId('kpi-open');
const criticalDelta = (deltaOpen: number, takenOn = '2026-09-15') =>
  ovDelta(ovDeltaTeam('Total', deltaOpen), { baseline: ovBaseline(takenOn) });

describe('the row', () => {
  // Revert: drop the inline height, or set it only in the populated branch.
  it('is KPI_ROW_H tall in every branch: populated, stale, with a loading sparkline and with a failed one', () => {
    const branches = [
      ovProps(),
      ovProps({ data: { summary: slot<SummaryData>(undefined, { stale: true, loading: false }) } }),
      ovProps({ data: { sparkline: slot<TrendData>(undefined, { loading: true }) } }),
      ovProps({ data: { sparkline: slot<TrendData>(undefined, { error: new Error('x'), errorText: "Couldn't load trend: x", loading: false }) } }),
      ovProps({ data: { sparkline: slot(trendFixture([ovSeries('Payments', [['2026-09-22', 2], ['2026-09-29', 3]])]), { errorText: "Couldn't load trend: x" }) } }),
      ovProps({ data: { sparkline: slot<TrendData>(undefined, { unavailable: { available: false, reason: 'x' }, loading: false }) } }),
    ];
    for (const p of branches) {
      const { unmount } = render(<KpiTiles {...p} />);
      expect(screen.getByTestId('kpi-tiles').style.height).toBe(`${KPI_ROW_H}px`);
      unmount();
    }
  });

  // Revert: remove the `opacity-60` on a stale summary.
  it('dims while the summary shows the previous key, and not otherwise', () => {
    const { rerender } = render(<KpiTiles {...ovProps({ data: { summary: slot<SummaryData>(undefined, { stale: true, loading: false }) } })} />);
    expect(screen.getByTestId('kpi-tiles').className).toContain('opacity-60');
    rerender(<KpiTiles {...ovProps()} />);
    expect(screen.getByTestId('kpi-tiles').className).not.toContain('opacity-60');
  });
});

describe('one "today" for the whole Open tile', () => {
  afterEach(() => jest.restoreAllMocks());

  // Revert: call utcToday() again for the sparkline (or let openChange read its own): when the clock crosses a year, the two
  // dates in one tile print against different years.
  it('the change sentence and the sparkline caption print dates against the same day, however the clock moves between calls', () => {
    // The first read of "today" is 2026-12-31; every later read says 2027-06-01. Dates from December 2026 print without a year
    // against the first and with it against the second, so a tile that reads the clock twice shows one of each.
    const spy = jest.spyOn(labels, 'utcToday').mockReturnValue('2027-06-01').mockReturnValueOnce('2026-12-31');
    const p = ovProps({
      summary: { delta: { critical: ovDelta(ovDeltaTeam('Total', 2), { baseline: ovBaseline('2026-12-30') }), high: ovNoBaseline() } },
      data: { sparkline: slot(trendFixture([ovSeries('Payments', [['2026-12-29', 3]])])) },
    });
    render(<KpiTiles {...p} />);
    expect(spy.mock.calls.length).toBeGreaterThan(0);
    expect(screen.getByTestId('kpi-open-change').textContent).toBe('▲ 2 more than on Dec 30');
    expect(screen.getByTestId('sparkline-caption').textContent).toBe('1 measurement so far (Dec 29)');
  });
});

describe('titles on truncating labels (B4)', () => {
  // Revert: drop a title.
  it('every tile label carries its full text', () => {
    render(<KpiTiles {...ovProps()} />);
    for (const [id, text] of [['kpi-open', 'Open critical alerts'], ['kpi-resolved', 'Resolved critical'], ['kpi-sla', 'SLA · open alerts'], ['kpi-since', 'critical since baseline']] as const) {
      expect(within(screen.getByTestId(id)).getByText(text).getAttribute('title')).toBe(text);
    }
  });
});

describe('Open tile: count and severity', () => {
  it('reads "Open critical alerts" and the critical total', () => {
    render(<KpiTiles {...ovProps()} />);
    expect(within(openTile()).getByText('Open critical alerts')).toBeTruthy();
    expect(within(openTile()).getByText('10')).toBeTruthy();
  });

  // Revert: read `critical` regardless of kSev, or sum both severities.
  it('follows kSev: "High only" shows the high total under "Open high alerts", never a sum', () => {
    render(<KpiTiles {...ovProps({ url: { severity: 'high', kSev: 'high' } })} />);
    expect(within(openTile()).getByText('Open high alerts')).toBeTruthy();
    expect(within(openTile()).getByText('3')).toBeTruthy();
    expect(within(openTile()).queryByText('13')).toBeNull();
  });

  // Revert: read the team table's summary (data.teamSummary) instead of the scoped one (props.summary).
  it('shows the team-scoped number while the table beside it lists every team', () => {
    const scoped = { pivot: { rows: [ovTeam('Payments', ovCell(3), ovCell(1))], total: ovTeam('Total', ovCell(3), ovCell(1)) } };
    const p = ovProps({ summary: scoped, url: { team: 'Payments' } });
    p.data.teamSummary = slot({ ...p.summary, pivot: { rows: [], total: ovTeam('Total', ovCell(10), ovCell(3)) } });
    render(<KpiTiles {...p} />);
    expect(within(openTile()).getByText('3')).toBeTruthy();
    expect(within(openTile()).queryByText('10')).toBeNull();
  });
});

describe('Open tile: the change sentence', () => {
  // Revert: use one tone for all deltas (the old deltaClass rule: red up, green down, grey flat).
  it('a large change is grouped', () => {
    render(<KpiTiles {...ovProps({ summary: { delta: { critical: criticalDelta(1234), high: ovNoBaseline() } } })} />);
    expect(screen.getByTestId('kpi-open-change').textContent).toBe('▲ 1,234 more than on Sep 15');
  });

  it('is red for more alerts, green for fewer and grey for no change, each with its arrow and date', () => {
    const cases: Array<[number, string, string]> = [
      [5, '▲ 5 more than on Sep 15', 'text-red-400'],
      [-3, '▼ 3 fewer than on Sep 15', 'text-green-400'],
      [0, 'Same as on Sep 15', 'text-gray-500'],
    ];
    for (const [delta, text, tone] of cases) {
      const { unmount } = render(<KpiTiles {...ovProps({ summary: { delta: { critical: criticalDelta(delta), high: ovNoBaseline() } } })} />);
      const el = screen.getByText(text);
      expect(el.className).toContain(tone);
      expect(el.getAttribute('data-testid')).toBe('kpi-open-change');
      unmount();
    }
  });

  it('a rise in high alerts is orange, not red', () => {
    render(<KpiTiles {...ovProps({ url: { severity: 'high', kSev: 'high' }, summary: { delta: { critical: ovNoBaseline(), high: criticalDelta(2) } } })} />);
    expect(screen.getByText('▲ 2 more than on Sep 15').className).toContain('text-orange-400');
  });

  // Revert: leave the sentence slot empty when there is no delta (the row's shape then changes).
  it('says why there is no change: "No earlier measurement yet" for a null baseline', () => {
    render(<KpiTiles {...ovProps({ summary: { delta: { critical: ovNoBaseline(), high: ovNoBaseline() } } })} />);
    const el = screen.getByTestId('kpi-open-change');
    expect(el.textContent).toBe('No earlier measurement yet');
    expect(el.className).toContain('h-5');
  });

  it('says "No measurement on or before <date>" when a baseline exists but does not cover this view', () => {
    const d = ovDelta(null, { baseline: ovBaseline('2026-09-29') });
    render(<KpiTiles {...ovProps({ summary: { delta: { critical: d, high: d } } })} />);
    expect(screen.getByTestId('kpi-open-change').textContent).toBe('No measurement on or before Sep 29');
  });

  // Revert: trust `available` and dereference the null total.
  it('an available delta with a null total never throws and never prints NaN or undefined', () => {
    const d = ovDelta(null, { available: true });
    render(<KpiTiles {...ovProps({ summary: { delta: { critical: d, high: d } } })} />);
    const text = openTile().textContent ?? '';
    expect(text).not.toMatch(/NaN|undefined|null/);
    expect(screen.getByTestId('kpi-open-change').textContent).toBe('No measurement on or before Sep 15');
  });
});

describe('Open tile: the sparkline', () => {
  const sparkSlot = (series: ReturnType<typeof ovSeries>[]) => ({ sparkline: slot(trendFixture(series)) });

  // Revert: sparkPoints ignores the team, or the tile passes null instead of url.team.
  it('with an owning team selected, the line is summed from that team only', () => {
    const series = [
      ovSeries('Payments', [['2026-09-22', 2], ['2026-09-29', 3]]),
      ovSeries('Search', [['2026-09-22', 5], ['2026-09-29', 1]]),
    ];
    render(<KpiTiles {...ovProps({ url: { team: 'Payments' }, data: sparkSlot(series) })} />);
    expect(screen.getByTestId('sparkline-caption').textContent).toBe('2 measurements since Sep 22');
    const pts = openTile().querySelector('polyline')!.getAttribute('points')!.split(' ').map(p => Number(p.split(',')[1]));
    expect(pts).toHaveLength(2);
    expect(pts[1]).toBeLessThan(pts[0]); // Payments 2 -> 3 rises (y falls); with Search's 5 -> 1 summed it would fall
  });

  it('shows the three history states: no measurements, one, and a line', () => {
    const { rerender } = render(<KpiTiles {...ovProps({ data: sparkSlot([]) })} />);
    expect(screen.getByText('Not enough history yet')).toBeTruthy();
    expect(screen.getByTestId('sparkline-caption').textContent).toBe('No measurements yet');
    rerender(<KpiTiles {...ovProps({ data: sparkSlot([ovSeries('Payments', [['2026-09-29', 3]])]) })} />);
    expect(screen.getByTestId('sparkline-caption').textContent).toBe('1 measurement so far (Sep 29)');
    rerender(<KpiTiles {...ovProps({ data: sparkSlot([ovSeries('Payments', [['2026-09-22', 2], ['2026-09-29', 3]])]) })} />);
    expect(openTile().querySelectorAll('polyline')).toHaveLength(1);
  });

  // Revert: render the slot only when there is a line.
  it('keeps its 24px slot in the tile in every history state', () => {
    for (const series of [[], [ovSeries('Payments', [['2026-09-29', 3]])]]) {
      const { unmount } = render(<KpiTiles {...ovProps({ data: sparkSlot(series) })} />);
      expect(screen.getByTestId('sparkline-slot').style.height).toBe(`${SPARK_H}px`);
      unmount();
    }
  });

  const TWO = [ovSeries('Payments', [['2026-09-22', 2], ['2026-09-29', 3]])];

  // Revert: read spark.errorText before spark.data (the old order).
  it('a failed refresh keeps the line (and dims nothing) and says so in a red caption', () => {
    render(<KpiTiles {...ovProps({ data: { sparkline: slot(trendFixture(TWO), { errorText: "Couldn't load trend: x" }) } })} />);
    expect(openTile().querySelectorAll('polyline')).toHaveLength(1);
    expect(screen.getByTestId('sparkline-caption').textContent).toBe("Couldn't refresh · showing last load");
    expect(screen.queryByText('Trend unavailable')).toBeNull();
    expect(screen.getByTestId('sparkline').className).not.toContain('opacity-60');
  });

  // Revert: drop `stale` from the sparkline's props.
  it('the sparkline dims while the previous key\'s trend is on screen, even when the summary is current', () => {
    render(<KpiTiles {...ovProps({ data: { sparkline: slot(trendFixture(TWO), { stale: true }) } })} />);
    expect(screen.getByTestId('sparkline').className).toContain('opacity-60');
    expect(screen.getByTestId('kpi-tiles').className).not.toContain('opacity-60');
  });

  // Revert: drop `unavailableText`: the slot is blank forever.
  it('an unavailable trend answer shows a short text in the sparkline slot', () => {
    render(<KpiTiles {...ovProps({ data: { sparkline: slot<TrendData>(undefined, { unavailable: { available: false, reason: 'x' }, loading: false }) } })} />);
    expect(within(screen.getByTestId('sparkline-slot')).getByText('Not available yet')).toBeTruthy();
  });

  it('a failed trend request shows its message in the caption, "Trend unavailable" in the slot, and leaves the rest of the tile alone', () => {
    render(<KpiTiles {...ovProps({ data: { sparkline: slot<TrendData>(undefined, { error: new Error('x'), errorText: "Couldn't load trend: x", loading: false }) } })} />);
    expect(screen.getByTestId('sparkline-caption').textContent).toBe("Couldn't load trend: x");
    expect(within(screen.getByTestId('sparkline-slot')).getByText('Trend unavailable')).toBeTruthy();
    expect(within(openTile()).getByText('10')).toBeTruthy();
  });
});
