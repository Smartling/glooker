/** @jest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { SpendImpactScatter, type ScatterPoint } from '@/components/charts/spend-impact-scatter';
import { SpendTab } from '@/app/report/[id]/org/spend-tab';
import { fixChartSize } from '../setup/chart-size';

fixChartSize(640, 320);

const points: ScatterPoint[] = [
  { login: 'dev-a', impact: 2, cost: 100, outlier: false },
  { login: 'dev-b', impact: 5, cost: 500, outlier: false },
  { login: 'dev-c', impact: 8, cost: 900, outlier: false },
  { login: 'dev-d', impact: 1, cost: 800, outlier: true },
];

const symbolsOf = (c: HTMLElement, series: 'typical' | 'outlier') =>
  Array.from(c.querySelectorAll(`.recharts-scatter.scatter-${series} path.recharts-symbols`));
const centre = (p: Element) => {
  const m = /translate\(([-\d.]+),\s*([-\d.]+)\)/.exec(p.getAttribute('transform') ?? '');
  return { cx: Number(m![1]), cy: Number(m![2]) };
};

it('a developer at exactly the median impact and cost sits on both reference lines', () => {
  const { container } = render(<SpendImpactScatter points={points} medianImpact={5} medianCost={500} onSelect={() => {}} />);
  const lines = Array.from(container.querySelectorAll('.recharts-reference-line line'));
  const vertical = lines.find(l => l.getAttribute('x1') === l.getAttribute('x2'))!;
  const horizontal = lines.find(l => l.getAttribute('y1') === l.getAttribute('y2'))!;
  const atMedian = centre(symbolsOf(container, 'typical')[1]); // dev-b
  expect(atMedian.cx).toBeCloseTo(Number(vertical.getAttribute('x1')), 1);
  expect(atMedian.cy).toBeCloseTo(Number(horizontal.getAttribute('y1')), 1);
});

it('outliers use the triangle marker and the outlier colour; typical developers use circles', () => {
  const { container } = render(<SpendImpactScatter points={points} medianImpact={5} medianCost={500} onSelect={() => {}} />);
  const outliers = symbolsOf(container, 'outlier');
  const typical = symbolsOf(container, 'typical');
  expect(outliers).toHaveLength(1);
  expect(typical).toHaveLength(3);
  // d3's circle symbol is drawn with arcs; its triangle is straight segments only.
  expect(outliers[0].getAttribute('d')).not.toMatch(/A/);
  typical.forEach(p => expect(p.getAttribute('d')).toMatch(/A/));
  expect(outliers[0].getAttribute('fill')).toBe('var(--chart-scatter-outlier)');
  typical.forEach(p => expect(p.getAttribute('fill')).toBe('var(--chart-scatter-typical)'));
  expect(screen.getByText('Typical')).toBeTruthy();
  expect(screen.getByText(/Outlier/)).toBeTruthy();
});

it('string cost and impact values still place a dot', () => {
  const stringy = [{ login: 'dev-s', impact: '4.5' as unknown as number, cost: '300' as unknown as number, outlier: false }];
  const { container } = render(<SpendImpactScatter points={stringy} medianImpact={4.5} medianCost={300} onSelect={() => {}} />);
  const { cx, cy } = centre(symbolsOf(container, 'typical')[0]);
  expect(Number.isFinite(cx) && Number.isFinite(cy)).toBe(true);
});

it('shows an explicit empty state when no developer has spend', () => {
  render(<SpendImpactScatter points={[]} medianImpact={0} medianCost={0} onSelect={() => {}} />);
  expect(screen.getByText('No developer has spend in this period')).toBeTruthy();
});

it('clicking a dot on the spend tab navigates to that developer', () => {
  const push = jest.fn();
  const developers = [
    { github_login: 'alice', cc_total_cost: 600, cc_requests: 10, impact_score: 5 },
    { github_login: 'bob', cc_total_cost: 400, cc_requests: 40, impact_score: 4 },
  ] as never[];
  const { container } = render(
    <SpendTab developers={developers} reportId="r1" router={{ push } as never} report={{ id: 'r1', org: 'acme', period_days: 14 } as never}
      spendWindow={null} modelUsage={[]} skillsUsage={[]} />,
  );
  const first = container.querySelector('.recharts-scatter.scatter-typical .recharts-scatter-symbol')!; // withSpend is sorted by cost: alice first
  fireEvent.click(first);
  expect(push).toHaveBeenCalledWith('/report/r1/dev/alice');
});
