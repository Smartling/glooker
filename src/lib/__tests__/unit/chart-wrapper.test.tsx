/** @jest-environment jsdom */
// GLOOK-58 Task 2 gate: Recharts 3 renders real marks in jsdom through the ported wrapper, and the
// wrapper's theme selectors and chrome classes follow Decisions 4 and 6.
import React from 'react';
import { render, screen } from '@testing-library/react';
import { Bar, BarChart } from 'recharts';
import {
  ChartContainer, ChartLegendContent, ChartStyle, ChartTooltipContent, type ChartConfig,
} from '@/components/charts/chart';
import { fixChartSize } from '../setup/chart-size';

fixChartSize();

const config: ChartConfig = { commits: { label: 'Commits', color: 'var(--accent)' } };

it('renders one bar rectangle per non-zero datum (spike: Recharts draws in jsdom)', () => {
  const { container } = render(
    <ChartContainer config={config}>
      <BarChart data={[{ w: 'a', commits: 3 }, { w: 'b', commits: 0 }, { w: 'c', commits: 5 }]}>
        <Bar dataKey="commits" fill="var(--color-commits)" isAnimationActive={false} />
      </BarChart>
    </ChartContainer>,
  );
  const rects = container.querySelectorAll('.recharts-bar-rectangle path.recharts-rectangle');
  expect(rects).toHaveLength(2);
  rects.forEach(r => expect(r.getAttribute('fill')).toBe('var(--color-commits)'));
});

it('ChartStyle scopes dark to the unprefixed selector and light to [data-theme-mode="light"]', () => {
  const { container } = render(
    <ChartStyle id="chart-x" config={{ a: { theme: { dark: 'var(--dark-a)', light: 'var(--light-a)' } } }} />,
  );
  const css = container.querySelector('style')!.innerHTML;
  expect(css).toMatch(/(^|\n)\s*\[data-chart=chart-x\] \{\s*--color-a: var\(--dark-a\);/);
  expect(css).toContain('[data-theme-mode="light"] [data-chart=chart-x] {\n  --color-a: var(--light-a);');
  expect(css).not.toContain('.dark');
});

it('the tooltip shows the configured label and a zero value, on chrome tokens', () => {
  const payload = [{ name: 'commits', dataKey: 'commits', value: 0, color: 'var(--accent)', payload: {}, graphicalItemId: 'bar-commits' }];
  const { container } = render(
    <ChartContainer config={config}>
      <ChartTooltipContent active payload={payload as React.ComponentProps<typeof ChartTooltipContent>['payload']} label="2026-09-21" hideLabel />
    </ChartContainer>,
  );
  expect(screen.getByText('Commits')).toBeTruthy();
  expect(screen.getByText('0')).toBeTruthy();
  const root = container.querySelector('.bg-chart-tooltip-bg');
  expect(root).not.toBeNull();
  expect(root!.className).toContain('border-chart-tooltip-border');
  expect(root!.className).toContain('text-chart-tooltip-text');
});

it('the legend lists configured labels in chrome text', () => {
  const payload = [{ value: 'commits', dataKey: 'commits', color: 'var(--accent)', type: 'square' as const }];
  const { container } = render(
    <ChartContainer config={config}>
      <ChartLegendContent payload={payload} />
    </ChartContainer>,
  );
  expect(screen.getByText('Commits')).toBeTruthy();
  expect(container.querySelector('.text-chart-axis')).not.toBeNull();
});
