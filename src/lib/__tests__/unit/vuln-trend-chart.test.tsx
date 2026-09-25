/** @jest-environment jsdom */
// src/lib/__tests__/unit/vuln-trend-chart.test.tsx
// GLOOK-58: TrendChart is a Recharts LineChart. Colours come from the caller's colorByTeam map
// (assignTeamColors over the UNFILTERED series), so a team keeps its colour when the page filter
// narrows the chart. The legend names every team in chrome text beside a coloured swatch.
import React from 'react';
import { render, screen } from '@testing-library/react';
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

it('shows the empty state when there are no measurements', () => {
  render(<TrendChart series={[]} colorByTeam={{}} />);
  expect(screen.getByText('No measurements yet for this view.')).toBeTruthy();
});
