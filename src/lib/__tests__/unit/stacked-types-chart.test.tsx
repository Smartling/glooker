/** @jest-environment jsdom */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { StackedTypesChart, StackedTypesTooltip } from '@/components/charts/stacked-types-chart';
import { fixChartSize } from '../setup/chart-size';

fixChartSize();

const weeks = ['2026-09-07', '2026-09-14', '2026-09-21'];
const rects = (c: HTMLElement) => Array.from(c.querySelectorAll('.recharts-bar-rectangle path.recharts-rectangle'));

it('draws one segment per non-zero type per week, in type tokens, with in-flight hatched', () => {
  const data = [
    { week: '2026-09-07', types: { feature: 2, bug: 1 } },
    { week: '2026-09-14', types: { feature: 1, in_flight: 3 } },
  ];
  const { container } = render(<StackedTypesChart data={data} weeks={weeks} />);
  const fills = rects(container).map(r => r.getAttribute('fill'));
  expect(fills).toHaveLength(4);
  expect(fills.filter(f => f === 'var(--chart-type-feature)')).toHaveLength(2);
  expect(fills.filter(f => f === 'var(--chart-type-bug)')).toHaveLength(1);
  const hatched = fills.filter(f => f?.startsWith('url(#hatch-'));
  expect(hatched).toHaveLength(1);
  expect(container.querySelector(`pattern#${hatched[0]!.slice(5, -1)}`)).not.toBeNull();
});

it('the legend lists the types present, in stacking order, in chrome text', () => {
  const data = [{ week: '2026-09-07', types: { test: 1, feature: 2 } }];
  const { container } = render(<StackedTypesChart data={data} weeks={weeks} />);
  const legend = Array.from(container.querySelectorAll('span.text-chart-axis')).map(s => s.textContent);
  expect(legend).toEqual(['feature', 'test']);
});

it('folds unknown types into other instead of dropping them', () => {
  const data = [{ week: '2026-09-07', types: { chore: 2 } }];
  const { container } = render(<StackedTypesChart data={data} weeks={weeks} />);
  expect(rects(container).map(r => r.getAttribute('fill'))).toEqual(['var(--chart-type-other)']);
  expect(screen.getByText('other')).toBeTruthy();
});

it('shows an explicit empty state when no week has commits', () => {
  render(<StackedTypesChart data={[]} weeks={weeks} />);
  expect(screen.getByText('No commits in the last 90 days')).toBeTruthy();
});

it('shows the empty state for an old report whose weeks are all outside the domain', () => {
  render(<StackedTypesChart data={[{ week: '2025-01-06', types: { feature: 4 } }]} weeks={weeks} />);
  expect(screen.getByText('No commits in the last 90 days')).toBeTruthy();
});

it('the tooltip lists the week total and only the non-zero types', () => {
  const row = { week: '2026-09-14', total: 4, feature: 3, bug: 0, refactor: 0, infra: 0, docs: 0, test: 0, other: 0, in_flight: 1 };
  const { container } = render(<StackedTypesTooltip active payload={[{ payload: row }] as never} />);
  expect(container.textContent).toContain('Sep 14 · 4 total');
  expect(container.textContent).toContain('feature3');
  expect(container.textContent).toContain('in_flight1');
  expect(container.textContent).not.toContain('bug');
});
