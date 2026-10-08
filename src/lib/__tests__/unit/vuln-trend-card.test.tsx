/** @jest-environment jsdom */
// src/lib/__tests__/unit/vuln-trend-card.test.tsx
// The trend card (replaces vuln-trend-chart.test.tsx). Dates are built relative to today so the tests
// need no fake clock (Recharts schedules animation frames).
import { fireEvent, render, screen, within } from '@testing-library/react';
import TrendCard from '@/app/vulnerabilities/trend-card';
import { TREND_PLOT_H } from '@/app/vulnerabilities/dimensions';
import { assignTeamColors } from '@/app/vulnerabilities/team-colors';
import { dayNumber, trendDomain } from '@/app/vulnerabilities/trend-model';
import { displayDate } from '@/app/vulnerabilities/labels';
import { addDays } from '@/lib/vulnerabilities/time';
import type { TrendData } from '@/app/vulnerabilities/api-types';
import { ovBaseline, ovDelta, ovDeltaTeam, ovProps, ovSeries, slot, trendFixture } from '../support/security-fixtures';
import { fixChartSize } from '../setup/chart-size';

fixChartSize();

const TODAY = new Date().toISOString().slice(0, 10);
const ago = (n: number) => addDays(TODAY, -n);
const SERIES = [
  ovSeries('TeamA', [[ago(40), 4], [ago(1), 6]]),
  ovSeries('TeamB', [[ago(40), 9], [ago(1), 7]]),
  ovSeries('team.alpha', [[ago(40), 2], [ago(1), 3]]),
];
const props = (series = SERIES, o: Parameters<typeof ovProps>[0] = {}) => ovProps({ ...o, data: { trend: slot(trendFixture(series)), ...o.data } });
const strokes = (c: HTMLElement) => Array.from(c.querySelectorAll('path.recharts-line-curve')).map(p => p.getAttribute('stroke'));
const legend = () => screen.getAllByTestId('trend-legend-entry');

describe('the plot box', () => {
  const err = { error: new Error('x'), errorText: "Couldn't load trend: x", loading: false };
  const branches: Array<[string, ReturnType<typeof ovProps>]> = [
    ['populated', props()],
    ['stale', ovProps({ data: { trend: slot(trendFixture(SERIES), { stale: true }) } })],
    ['loading', ovProps({ data: { trend: slot<TrendData>(undefined, { loading: true }) } })],
    ['error', ovProps({ data: { trend: slot<TrendData>(undefined, err) } })],
    ['no measurements', props([])],
    ['one measurement', props([ovSeries('TeamA', [[ago(1), 4]])])],
  ];

  // Revert: apply the height only to the populated chart, or on the outer section.
  it.each(branches)('%s: 220px tall, with no fixed height on the card', (_n, p) => {
    render(<TrendCard {...p} />);
    expect(screen.getByTestId('trend-plot').style.height).toBe(`${TREND_PLOT_H}px`);
    expect(screen.getByTestId('trend-card').style.height).toBe('');
  });

  it('a failed request shows its message and Loading… shows before the first response', () => {
    const { unmount } = render(<TrendCard {...branches[3][1]} />);
    expect(within(screen.getByTestId('trend-plot')).getByText("Couldn't load trend: x")).toBeTruthy();
    unmount();
    render(<TrendCard {...branches[2][1]} />);
    expect(within(screen.getByTestId('trend-plot')).getByText('Loading…')).toBeTruthy();
  });

  it('dims while it shows the previous key\'s data', () => {
    render(<TrendCard {...branches[1][1]} />);
    expect(screen.getByTestId('trend-plot').className).toContain('opacity-60');
  });
});

describe('header', () => {
  it('names the severity: "Open critical alerts by owning team", or high under "High only"', () => {
    const { rerender } = render(<TrendCard {...props()} />);
    expect(screen.getByText('Open critical alerts by owning team')).toBeTruthy();
    rerender(<TrendCard {...props(SERIES, { url: { severity: 'high', kSev: 'high' } })} />);
    expect(screen.getByText('Open high alerts by owning team')).toBeTruthy();
    expect(screen.getByText('One point per stored measurement')).toBeTruthy();
  });

  // Revert: change the default, the order or the labels.
  it('the range select lists All time (the default), Last year, Last 90 days, Last 30 days', () => {
    render(<TrendCard {...props()} />);
    const select = screen.getByLabelText('Range') as HTMLSelectElement;
    expect(select.value).toBe('all');
    expect(Array.from(select.options).map(o => [o.value, o.textContent])).toEqual([
      ['all', 'All time'], ['1y', 'Last year'], ['90d', 'Last 90 days'], ['30d', 'Last 30 days'],
    ]);
  });

  // Revert: write another URL key, or ignore the change.
  it('choosing a range calls url.setRange', () => {
    const p = props();
    render(<TrendCard {...p} />);
    fireEvent.change(screen.getByLabelText('Range'), { target: { value: '90d' } });
    expect(p.url.setRange).toHaveBeenCalledWith('90d');
  });

  it('shows "N open now" from the scoped summary and the change sentence under it', () => {
    const p = props(SERIES, { summary: { delta: { critical: ovDelta(ovDeltaTeam('Total', 2), { baseline: ovBaseline('2026-09-29') }), high: ovDelta(null) } } });
    render(<TrendCard {...p} />);
    expect(screen.getByTestId('trend-open-now').textContent).toBe('10 open now');
    expect(screen.getByTestId('trend-change').textContent).toBe('▲ 2 more than on Sep 29');
    expect(screen.getByTestId('trend-change').className).toContain('text-red-400');
  });

  it('with no baseline the sentence says so', () => {
    render(<TrendCard {...props()} />);
    expect(screen.getByTestId('trend-change').textContent).toBe('No earlier measurement yet');
  });
});

describe('lines and colours', () => {
  // Revert: build colours from the drawn (filtered) series.
  it('draws one line per team in its own colour; the colours are distinct and come from the unfiltered series', () => {
    const { container } = render(<TrendCard {...props()} />);
    const colors = assignTeamColors(SERIES);
    expect(strokes(container)).toHaveLength(3);
    expect([...strokes(container)].sort()).toEqual(Object.values(colors).sort());
    expect(new Set(strokes(container)).size).toBe(3);
  });

  // Revert: draw every team when one is selected, or recompute the colour from the filtered series.
  it('a selected team draws only its own line, in the colour it had before', () => {
    const colors = assignTeamColors(SERIES);
    const { container } = render(<TrendCard {...props(SERIES, { url: { team: 'TeamB' } })} />);
    expect(strokes(container)).toEqual([colors.TeamB]);
    expect(colors.TeamB).not.toBe('var(--vuln-series-1)');
  });

  it('draws a line for a team whose name contains a dot (no lodash-path dataKey lookup)', () => {
    const { container } = render(<TrendCard {...props(SERIES, { url: { team: 'team.alpha' } })} />);
    const path = container.querySelector('path.recharts-line-curve');
    expect(path).not.toBeNull();
    expect(path!.getAttribute('d')).toMatch(/^M[\d.]+,[\d.]+L/);
  });

  it('teams beyond the top 12 are thinner grey lines', () => {
    const many = Array.from({ length: 14 }, (_, i) => ovSeries(`Team ${String(i + 1).padStart(2, '0')}`, [[ago(40), 14 - i], [ago(1), 14 - i]]));
    const { container } = render(<TrendCard {...props(many)} />);
    const paths = Array.from(container.querySelectorAll('path.recharts-line-curve'));
    const grey = paths.filter(p => p.getAttribute('stroke') === 'var(--vuln-series-other)');
    expect(grey).toHaveLength(2);
    expect(grey.every(p => Number(p.getAttribute('stroke-width')) < 2)).toBe(true);
    expect(paths.filter(p => p.getAttribute('stroke') !== 'var(--vuln-series-other)').every(p => p.getAttribute('stroke-width') === '2')).toBe(true);
  });
});

describe('placement by date', () => {
  // The plot's left and right edges: the first gridline spans the whole plot.
  const edges = (c: HTMLElement): [number, number] => {
    const line = c.querySelector('.recharts-cartesian-grid-horizontal line')!;
    return [Number(line.getAttribute('x1')), Number(line.getAttribute('x2'))];
  };
  const dotXs = (c: HTMLElement) => Array.from(c.querySelectorAll('circle.recharts-dot')).map(d => Number(d.getAttribute('cx'))).sort((a, b) => a - b);

  // Revert: use a category axis (even spacing) instead of the numeric date axis.
  it('puts each dot at its date\'s share of the axis, not evenly spaced', () => {
    const s = [ovSeries('TeamA', [[ago(28), 1], [ago(21), 2], [ago(0), 3]])];
    const { container } = render(<TrendCard {...props(s)} />);
    const [x0, x4] = edges(container);
    const { start, end } = trendDomain('all', s, TODAY);
    const frac = (iso: string) => (dayNumber(iso) - dayNumber(start)) / (dayNumber(end) - dayNumber(start));
    const dots = dotXs(container);
    expect(dots).toHaveLength(3);
    dots.forEach((cx, i) => expect((cx - x0) / (x4 - x0)).toBeCloseTo(frac([ago(28), ago(21), ago(0)][i]), 2));
  });

  // Revert: start All at the first point regardless of the 7-day floor.
  it('All spans at least 7 days even when the first point is yesterday', () => {
    const s = [ovSeries('TeamA', [[ago(2), 1], [ago(1), 2]])];
    const { container } = render(<TrendCard {...props(s)} />);
    const [x0, x4] = edges(container);
    const dots = dotXs(container);
    expect((dots[0] - x0) / (x4 - x0)).toBeCloseTo(5 / 7, 2);
    expect((dots[1] - x0) / (x4 - x0)).toBeCloseTo(6 / 7, 2);
  });

  it('the other ranges run from today minus 30, 90 or 365 days', () => {
    const s = [ovSeries('TeamA', [[ago(20), 1], [ago(10), 2]])];
    const { container } = render(<TrendCard {...props(s, { url: { range: '30d' } })} />);
    const [x0, x4] = edges(container);
    expect((dotXs(container)[0] - x0) / (x4 - x0)).toBeCloseTo(10 / 30, 2);
  });
});

describe('history messages', () => {
  it('shows "No measurements yet" instead of a chart for 0 points, and the range-specific sub-line', () => {
    const { container, rerender } = render(<TrendCard {...props([])} />);
    expect(screen.getByTestId('trend-message').textContent).toBe('No measurements yetHistory starts at the first sync.');
    expect(container.querySelector('svg')).toBeNull();
    rerender(<TrendCard {...props([], { url: { range: '30d' } })} />);
    expect(screen.getByTestId('trend-message').textContent).toBe('No measurements yetNo measurements in this range.');
  });

  it('shows "Not enough history yet" for 1 point, naming it', () => {
    const { container } = render(<TrendCard {...props([ovSeries('TeamA', [[ago(1), 4]]), ovSeries('TeamB', [[ago(1), 2]])])} />);
    expect(screen.getByTestId('trend-message').textContent).toBe(`Not enough history yet1 measurement so far (${displayDate(ago(1))}). The line appears after the next sync.`);
    expect(container.querySelector('svg')).toBeNull();
  });

  // Revert: show the note for an old history, or never.
  it('a history younger than 14 days shows the "History starts" note over the chart; an older one does not', () => {
    const young = [ovSeries('TeamA', [[ago(6), 1], [ago(1), 2]])];
    const { rerender } = render(<TrendCard {...props(young)} />);
    expect(screen.getByTestId('trend-note').textContent).toMatch(/^History starts .* \(first sync\) · 2 measurements$/);
    rerender(<TrendCard {...props()} />);
    expect(screen.queryByTestId('trend-note')).toBeNull();
  });

  it('a team with fewer points than the rest does not turn the chart into the message', () => {
    const { container } = render(<TrendCard {...props([ovSeries('TeamA', [[ago(40), 4], [ago(1), 6]]), ovSeries('TeamB', [[ago(1), 7]])], { url: { team: 'TeamB' } })} />);
    expect(screen.queryByTestId('trend-message')).toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();
  });
});

describe('legend', () => {
  const many = Array.from({ length: 15 }, (_, i) => ovSeries(`Team ${String(i + 1).padStart(2, '0')}`, [[ago(40), 15 - i], [ago(1), 15 - i]]));

  it('names every team in chrome text beside a swatch in the team colour, with its open count', () => {
    render(<TrendCard {...props()} />);
    const colors = assignTeamColors(SERIES);
    expect(legend()).toHaveLength(3);
    for (const e of legend()) {
      const label = e.children[1] as HTMLElement;
      expect(label.className).toContain('text-chart-axis');
      expect(label.getAttribute('style') ?? '').not.toContain('color');
      expect((e.querySelector('i') as HTMLElement).style.background).toBe(colors[label.textContent!]);
    }
    expect(legend().map(e => e.textContent)).toEqual(['TeamB7 open', 'TeamA6 open', 'team.alpha3 open']);
  });

  // Revert: list only the coloured teams.
  it('with more than 12 teams: the top 12, then one "Other · N teams" entry whose tooltip names the rest', () => {
    render(<TrendCard {...props(many)} />);
    expect(legend()).toHaveLength(13);
    const other = legend()[12];
    expect(other.textContent).toBe('Other · 3 teams6 open');
    expect(other.getAttribute('title')).toBe('Team 13, Team 14, Team 15');
    expect((other.querySelector('i') as HTMLElement).style.background).toBe('var(--vuln-series-other)');
  });

  // Revert: filter the legend to the selected team, or skip the dimming.
  it('selecting a team keeps every entry, dims the others to 0.4 and bolds the selected one', () => {
    const { rerender } = render(<TrendCard {...props(many)} />);
    const count = legend().length;
    expect(legend().every(e => e.style.opacity === '1')).toBe(true);
    rerender(<TrendCard {...props(many, { url: { team: 'Team 02' } })} />);
    expect(legend()).toHaveLength(count);
    expect(legend().filter(e => e.style.opacity === '1').map(e => e.getAttribute('title'))).toEqual(['Team 02']);
    expect(legend().filter(e => e.style.opacity === '0.4')).toHaveLength(count - 1);
    expect(within(legend()[1]).getByText('Team 02').className).toContain('font-semibold');
  });

  it('selecting a team inside "Other" leaves only the "Other" entry undimmed', () => {
    render(<TrendCard {...props(many, { url: { team: 'Team 14' } })} />);
    expect(legend().filter(e => e.style.opacity === '1').map(e => e.textContent)).toEqual(['Other · 3 teams6 open']);
  });

  // Revert: key the entries by team name.
  it('entries are the same DOM nodes across a series swap, with their text updated', () => {
    const swapped = SERIES.map((s, i) => ({ ...s, team: `Swapped${i}` }));
    const { rerender } = render(<TrendCard {...props()} />);
    const before = legend();
    rerender(<TrendCard {...props(swapped)} />);
    legend().forEach((el, i) => expect(el).toBe(before[i]));
    expect(legend().map(e => e.textContent).join(' ')).toContain('Swapped');
  });

  // Revert: drop the min-height (the card then resizes between an empty and a populated state).
  it('reserves two lines in every state, and the footnote is always there', () => {
    for (const p of [props(), props([]), ovProps({ data: { trend: slot<TrendData>(undefined, { loading: true }) } })]) {
      const { unmount } = render(<TrendCard {...p} />);
      expect(screen.getByTestId('trend-legend').className).toContain('min-h-[32px]');
      expect(screen.getByTestId('trend-footnote').textContent).toBe('Each dot is one stored measurement (an imported CSV run or a sync).');
      unmount();
    }
  });
});
