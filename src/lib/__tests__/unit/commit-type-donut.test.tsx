/** @jest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { CommitTypeDonut } from '@/components/charts/commit-type-donut';
import { typeEntriesFrom } from '@/components/charts/commit-types';
import { fixChartSize } from '../setup/chart-size';

fixChartSize(320, 320);

const entries: [string, number][] = [['feature', 6], ['bug', 3], ['in_flight', 1]];
const center = () => screen.getByTestId('donut-center');

it('orders slices and legend rows by COMMIT_TYPE_ORDER, not by count', () => {
  const byOrder = typeEntriesFrom([{ in_flight: 9, feature: 1, other: 5, bug: 3 }]);
  const { container } = render(<CommitTypeDonut entries={byOrder} total={18} />);
  const legend = Array.from(container.querySelectorAll('[data-testid^="donut-legend-"]')).map(e => e.getAttribute('data-testid'));
  expect(legend).toEqual(['donut-legend-feature', 'donut-legend-bug', 'donut-legend-other', 'donut-legend-in_flight']);
  const fills = Array.from(container.querySelectorAll('.recharts-pie-sector path')).map(p => p.getAttribute('fill'));
  expect(fills.slice(0, 3)).toEqual(['var(--chart-type-feature)', 'var(--chart-type-bug)', 'var(--chart-type-other)']);
  expect(fills[3]).toMatch(/^url\(#hatch-/);
});

it('shows every type with count and % without any hover', () => {
  render(<CommitTypeDonut entries={entries} total={10} />);
  expect(screen.getByText('6 (60%)')).toBeTruthy();
  expect(screen.getByText('3 (30%)')).toBeTruthy();
  expect(screen.getByText('1 (10%)')).toBeTruthy();
});

it('shows the total in the centre when nothing is hovered', () => {
  render(<CommitTypeDonut entries={entries} total={10} />);
  expect(center().textContent).toBe('10commits');
});

it('hovering a legend row moves that type into the centre, in chrome text, and dims the other slices', () => {
  const { container } = render(<CommitTypeDonut entries={entries} total={10} />);
  fireEvent.mouseEnter(screen.getByTestId('donut-legend-bug'));
  expect(center().textContent).toBe('3bug30%');
  center().querySelectorAll('span').forEach(s => {
    expect(s.getAttribute('style') ?? '').not.toContain('color');
    expect(s.className).toMatch(/text-chart-(tooltip-text|axis)/);
  });
  const sectors = Array.from(container.querySelectorAll('.recharts-pie-sector path'));
  expect(sectors.map(p => p.getAttribute('opacity'))).toEqual(['0.3', '1', '0.3']);
  fireEvent.mouseLeave(screen.getByTestId('donut-legend-bug'));
  expect(center().textContent).toBe('10commits');
});

it('fills the in_flight wedge and its legend swatch with a hatch pattern', () => {
  const { container } = render(<CommitTypeDonut entries={entries} total={10} />);
  const sectors = Array.from(container.querySelectorAll('.recharts-pie-sector path'));
  expect(sectors[0].getAttribute('fill')).toBe('var(--chart-type-feature)');
  const hatchFill = sectors[2].getAttribute('fill')!;
  expect(hatchFill).toMatch(/^url\(#hatch-/);
  expect(container.querySelector(`pattern#${hatchFill.slice(5, -1)}`)).not.toBeNull();
  expect(screen.getByTestId('donut-legend-in_flight').querySelector('pattern')).not.toBeNull();
});

it('an unknown type folds into a single "other" row with a single wedge', () => {
  const folded = typeEntriesFrom([{ feature: 2, chore: 1, other: 1 }]);
  const { container } = render(<CommitTypeDonut entries={folded} total={4} />);
  expect(screen.queryByTestId('donut-legend-chore')).toBeNull();
  expect(screen.getByTestId('donut-legend-other').textContent).toContain('2 (50%)');
  const otherWedges = Array.from(container.querySelectorAll('.recharts-pie-sector path'))
    .filter(p => p.getAttribute('fill') === 'var(--chart-type-other)');
  expect(otherWedges).toHaveLength(1);
});

it('a total of 0 (or "0") renders the empty state instead of a chart', () => {
  const { container, rerender } = render(<CommitTypeDonut entries={[]} total={0} />);
  expect(screen.getByText('No categorized commits')).toBeTruthy();
  expect(container.querySelector('svg')).toBeNull();
  rerender(<CommitTypeDonut entries={[['feature', 0]]} total="0" />);
  expect(screen.getByText('No categorized commits')).toBeTruthy();
});

it('hovering a slice also moves its figures into the centre', () => {
  const { container } = render(<CommitTypeDonut entries={entries} total={10} />);
  fireEvent.mouseEnter(container.querySelectorAll('.recharts-pie-sector')[0]);
  expect(center().textContent).toBe('6feature60%');
});

it('GLOOK-58 final review, fix round 2: the first sector (feature) starts at 12 o\'clock and sweeps clockwise', () => {
  const { container } = render(<CommitTypeDonut entries={entries} total={10} />);
  const first = container.querySelector('.recharts-pie-sector path')!;
  const cx = Number(first.getAttribute('cx'));
  const cy = Number(first.getAttribute('cy'));
  const d = first.getAttribute('d')!;

  // The path's opening "M x,y" is the outer edge's start point. Recharts' Sector always starts an
  // arc at its own startAngle, so this is where the wedge begins drawing: at 12 o'clock, that's
  // directly above the centre (same x, smaller y — SVG's y axis points down).
  const start = /^M\s*([\d.]+),([\d.]+)/.exec(d)!;
  const [startX, startY] = [Number(start[1]), Number(start[2])];
  expect(startX).toBeCloseTo(cx, 0);
  expect(startY).toBeLessThan(cy);

  // The first "A" (arc) command draws the outer edge from that start point. Its sweep-flag (the
  // 5th number: rx,ry,x-rotation,large-arc-flag,SWEEP-FLAG,x,y) is 1 for a clockwise sweep in
  // SVG's y-down coordinate system, and 0 for counter-clockwise — this is what startAngle={90}
  // endAngle={-270} actually changes, independent of how large any one slice is.
  const arc = /A\s*[\d.]+,[\d.]+,\d+,\s*[01],\s*([01]),/.exec(d)!;
  expect(arc[1]).toBe('1');
});
