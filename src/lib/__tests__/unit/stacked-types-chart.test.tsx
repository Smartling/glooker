/** @jest-environment jsdom */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { buildStackRows, StackedTypesChart, StackedTypesTooltip } from '@/components/charts/stacked-types-chart';
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

it('GLOOK-58 fix round 1: a short in_flight segment still gets a legible floor, but a zero-in_flight week stays hatch-free', () => {
  const data = [
    { week: '2026-09-07', types: { feature: 200, in_flight: 1 } },
    { week: '2026-09-14', types: { feature: 11 } },
  ];
  const { container } = render(<StackedTypesChart data={data} weeks={weeks} />);
  const hatched = rects(container).filter(r => (r.getAttribute('fill') ?? '').startsWith('url(#hatch-'));
  // Exactly one hatch rect: the 1-in_flight week's, floored to a legible height. The other week
  // has no in_flight at all, even though its own feature value (11) is well above zero — proof
  // minPointSize is reading this row's own in_flight value, not the stack's cumulative top.
  expect(hatched).toHaveLength(1);
  expect(Number(hatched[0].getAttribute('height'))).toBeGreaterThanOrEqual(4);
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
  expect(screen.getByText('No commits in the 90 days before this report')).toBeTruthy();
});

it('shows the empty state for an old report whose weeks are all outside the domain', () => {
  render(<StackedTypesChart data={[{ week: '2025-01-06', types: { feature: 4 } }]} weeks={weeks} />);
  expect(screen.getByText('No commits in the 90 days before this report')).toBeTruthy();
});

it('the tooltip lists the week total and only the non-zero types', () => {
  const row = { week: '2026-09-14', total: 4, feature: 3, bug: 0, refactor: 0, infra: 0, docs: 0, test: 0, other: 0, in_flight: 1 };
  const { container } = render(<StackedTypesTooltip active payload={[{ payload: row }] as never} />);
  expect(container.textContent).toContain('Sep 14 · 4 total');
  expect(container.textContent).toContain('feature3');
  expect(container.textContent).toContain('in_flight1');
  expect(container.textContent).not.toContain('bug');
});

describe('Decision 15: measured weeks', () => {
  it('buildStackRows marks each row measured from its data or the covered set, keeping values numeric', () => {
    const rows = buildStackRows([{ week: '2026-09-21', types: { feature: 2 } }], weeks, new Set(['2026-09-07']));
    expect(rows.map(r => r.measured)).toEqual([true, false, true]);
    expect(rows.map(r => r.total)).toEqual([0, 0, 2]);
  });

  it('buildStackRows with no covered set marks every week measured', () => {
    expect(buildStackRows([], weeks).map(r => r.measured)).toEqual([true, true, true]);
  });

  it('the stacked tooltip reads "Not measured", not a 0 total, for an unmeasured week', () => {
    const row = buildStackRows([], weeks, new Set<string>())[0];
    const { container } = render(<StackedTypesTooltip active payload={[{ payload: row }] as never} />);
    expect(container.textContent).toContain('Sep 7');
    expect(container.textContent).toContain('Not measured');
    expect(container.textContent).not.toContain('total');
  });

  it('the stacked tooltip still shows the total and types for a measured week', () => {
    // Measured by its data, even with an empty covered set.
    const row = buildStackRows([{ week: '2026-09-14', types: { feature: 3 } }], weeks, new Set<string>())[1];
    expect(row.measured).toBe(true);
    const { container } = render(<StackedTypesTooltip active payload={[{ payload: row }] as never} />);
    expect(container.textContent).toContain('Sep 14 · 3 total');
    expect(container.textContent).toContain('feature3');
    expect(container.textContent).not.toContain('Not measured');
  });
});
