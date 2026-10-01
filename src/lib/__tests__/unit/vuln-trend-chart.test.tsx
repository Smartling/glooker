/** @jest-environment jsdom */
// src/lib/__tests__/unit/vuln-trend-chart.test.tsx
// GLOOK-58: TrendChart is a Recharts LineChart. Colours come from the caller's colorByTeam map
// (assignTeamColors over the UNFILTERED series), so a team keeps its colour when the page filter
// narrows the chart. The legend names every team in chrome text beside a coloured swatch.
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import TrendChart from '@/app/vulnerabilities/trend-chart';
import { assignTeamColors } from '@/app/vulnerabilities/team-colors';
import type { TrendSeries } from '@/lib/vulnerabilities/aggregate';
import { fixChartSize } from '../setup/chart-size';

fixChartSize();

const series: TrendSeries[] = [
  { team: 'TeamA', points: [{ date: '2026-09-01', open: 4 }, { date: '2026-09-08', open: 6 }] },
  { team: 'TeamB', points: [{ date: '2026-09-01', open: 9 }, { date: '2026-09-08', open: 7 }] },
  { team: 'team.alpha', points: [{ date: '2026-09-01', open: 2 }, { date: '2026-09-08', open: 3 }] },
];
const colors = assignTeamColors(series);
const strokes = (c: HTMLElement) => Array.from(c.querySelectorAll('path.recharts-line-curve')).map(p => p.getAttribute('stroke'));

it('draws one line per team in its assigned colour, and the colours are distinct', () => {
  const { container } = render(<TrendChart series={series} colorByTeam={colors} />);
  const drawn = strokes(container);
  expect(drawn).toHaveLength(3);
  expect(new Set(drawn).size).toBe(3);
  expect([...drawn].sort()).toEqual(Object.values(colors).sort());
});

it('a team keeps its colour after the page filters the chart down to it', () => {
  const { container } = render(<TrendChart series={series.filter(s => s.team === 'TeamB')} colorByTeam={colors} />);
  expect(strokes(container)).toEqual([colors.TeamB]);
  expect(colors.TeamB).not.toBe('var(--vuln-series-1)');
});

it('draws a line for a team whose name contains a dot (no lodash-path dataKey lookup)', () => {
  const { container } = render(<TrendChart series={series.filter(s => s.team === 'team.alpha')} colorByTeam={colors} />);
  const path = container.querySelector('path.recharts-line-curve');
  expect(path).not.toBeNull();
  expect(path!.getAttribute('d')).toMatch(/^M[\d.]+,[\d.]+L/);
});

it('the legend names every team in chrome text beside a swatch in the team colour', () => {
  render(<TrendChart series={series} colorByTeam={colors} />);
  for (const s of series) {
    const label = screen.getByText(s.team);
    expect(label.className).toContain('text-chart-axis');
    expect(label.getAttribute('style') ?? '').not.toContain('color');
    const swatch = label.parentElement!.querySelector('i') as HTMLElement;
    expect(swatch.style.background).toBe(colors[s.team]);
  }
});

it('falls back to the "other" grey for a team missing from the map', () => {
  const { container } = render(<TrendChart series={[series[0]]} colorByTeam={{}} />);
  expect(strokes(container)).toEqual(['var(--vuln-series-other)']);
});

it('shows the empty state when there are no measurements, in a box the same height as the chart (no panel collapse)', () => {
  render(<TrendChart series={[]} colorByTeam={{}} />);
  const message = screen.getByText('No measurements yet for this view.');
  expect(message.parentElement!.className).toContain('h-[200px]');
});

// ---------------------------------------------------------------------------------------------
// Layout stability: the empty and populated renders share one skeleton. jsdom has no layout, so
// these guard structure and classes only; the acceptance harness (trend panel height with vs
// without data, per action) is the real check.
// ---------------------------------------------------------------------------------------------
describe('trend skeleton is shared by the empty and populated renders', () => {
  const sig = (el: Element) => `${el.tagName.toLowerCase()}:${el.getAttribute('data-testid') ?? ''}`;
  const nonPlot = (root: HTMLElement) => Array.from(root.children).slice(1).map(sig);

  // Revert: return the empty state without the legend / note placeholders (or render them only in
  // the populated branch): the panel is then ~54px shorter with no data (measured).
  it('an empty render and a populated render have the same non-plot children in the same order: legend, then note', () => {
    const { unmount } = render(<TrendChart series={[]} colorByTeam={{}} />);
    const empty = nonPlot(screen.getByTestId('trend-panel'));
    unmount();
    render(<TrendChart series={series} colorByTeam={colors} />);
    const populated = nonPlot(screen.getByTestId('trend-panel'));
    expect(empty).toEqual(['div:trend-legend', 'p:trend-note']);
    expect(populated).toEqual(empty);
  });

  it('in the empty render the legend and note are invisible aria-hidden placeholders; in the populated render they are visible', () => {
    const { unmount } = render(<TrendChart series={[]} colorByTeam={{}} />);
    for (const id of ['trend-legend', 'trend-note']) {
      const el = screen.getByTestId(id);
      expect(el.className).toContain('invisible');
      expect(el.getAttribute('aria-hidden')).toBe('true');
    }
    unmount();
    render(<TrendChart series={series} colorByTeam={colors} />);
    for (const id of ['trend-legend', 'trend-note']) {
      const el = screen.getByTestId(id);
      expect(el.className).not.toContain('invisible');
      expect(el.hasAttribute('aria-hidden')).toBe(false);
    }
  });

  // Decision (a): the legend reserves TWO lines, identically in both branches. Revert: change either
  // branch's `min-h-[32px]` (2 x the 16px leading), the leading, or the zero row gap.
  it('the legend row reserves two lines (min-h-[32px] on a 16px leading, no row gap) in both branches, and the note keeps the same text and leading', () => {
    const { unmount } = render(<TrendChart series={[]} colorByTeam={{}} />);
    const emptyLegend = screen.getByTestId('trend-legend').className;
    const emptyNote = screen.getByTestId('trend-note');
    const emptyNoteText = emptyNote.textContent;
    unmount();
    render(<TrendChart series={series} colorByTeam={colors} />);
    const legend = screen.getByTestId('trend-legend');
    for (const cls of ['min-h-[32px]', 'leading-4', 'gap-y-0']) {
      expect(emptyLegend).toContain(cls);
      expect(legend.className).toContain(cls);
    }
    const note = screen.getByTestId('trend-note');
    expect(note.textContent).toBe(emptyNoteText); // same text, so it wraps to the same number of lines
    expect(note.textContent).toContain('Each dot is one measurement');
    expect(note.className.replace(/\binvisible\b/, '').trim()).toBe(emptyNote.className.replace(/\binvisible\b/, '').trim());
    expect(note.className).toContain('leading-[14px]');
  });

  // The message stays the DIRECT child of the plot box (existing assertion, kept), and the plot box is
  // the first child of the shared root in BOTH branches, carrying the same h-[200px]. Revert: drop
  // CHART_HEIGHT_CLASS from either branch's plot box (the empty box or the ChartContainer).
  it('the plot box is the first child of the trend panel in both branches, h-[200px] in each, with the message as its direct child when empty', () => {
    const { unmount } = render(<TrendChart series={[]} colorByTeam={{}} />);
    const root = screen.getByTestId('trend-panel');
    const box = root.children[0] as HTMLElement;
    expect(box.className).toContain('h-[200px]');
    expect(screen.getByText('No measurements yet for this view.').parentElement).toBe(box);
    unmount();
    render(<TrendChart series={series} colorByTeam={colors} />);
    const populatedBox = screen.getByTestId('trend-panel').children[0] as HTMLElement;
    expect(populatedBox.className).toContain('h-[200px]');
  });

  // Legend entries are keyed by position, so a team swap repaints the same nodes in place instead of
  // remounting them (keyed by team, the layout-shift API scored the survivor "sliding" to the start of
  // the row). Revert: key the legend spans by `s.team`.
  it('the legend spans are the same DOM nodes across a series swap, with their text updated', () => {
    const swapped: TrendSeries[] = series.map((s, i) => ({ ...s, team: `Swapped${i}` }));
    const { rerender } = render(<TrendChart series={series} colorByTeam={colors} />);
    const before = Array.from(screen.getByTestId('trend-legend').children);
    expect(before).toHaveLength(3);
    rerender(<TrendChart series={swapped} colorByTeam={{}} />);
    const after = Array.from(screen.getByTestId('trend-legend').children);
    expect(after).toHaveLength(3);
    after.forEach((el, i) => expect(el).toBe(before[i]));
    expect(after.map(el => el.textContent).sort()).toEqual(['Swapped0', 'Swapped1', 'Swapped2']);
  });
});

// A hover on a legend entry dims every other line. Legend spans are keyed by position, so when a team
// filter removes the hovered team its span is reused and its mouseleave never fires: `hover` goes
// stale. Revert: use `hover` instead of `activeHover` in opacity() (the surviving lines then stay at
// 0.15 for a team that is no longer shown).
describe('a stale legend hover does not dim the lines', () => {
  const opacities = (c: HTMLElement) => Array.from(c.querySelectorAll('path.recharts-line-curve')).map(p => p.getAttribute('stroke-opacity'));

  it('hovering a shown team dims the others; after that team leaves the chart the remaining lines are fully opaque', () => {
    const { container, rerender } = render(<TrendChart series={series} colorByTeam={colors} />);
    expect(opacities(container)).toEqual(['1', '1', '1']);
    fireEvent.mouseEnter(screen.getByText('TeamB').parentElement!);
    // ranked by latest value: TeamB (7), TeamA (6), team.alpha (3): only TeamB stays opaque
    expect(opacities(container)).toEqual(['1', '0.15', '0.15']);
    // the page filters TeamB out; no mouseleave fires
    rerender(<TrendChart series={series.filter(s => s.team !== 'TeamB')} colorByTeam={colors} />);
    expect(screen.queryByText('TeamB')).toBeNull();
    expect(opacities(container)).toEqual(['1', '1']);
  });
});
