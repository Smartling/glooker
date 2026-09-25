/** @jest-environment jsdom */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { TimelineChart, TimelineTooltip } from '@/components/charts/timeline-chart';
import { fixChartSize } from '../setup/chart-size';

fixChartSize();

const weeks = ['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21'];
type Row = { week: string; commits: number | string; prs: number; avg?: number | string; types?: Record<string, number> };

const rects = (c: HTMLElement) => Array.from(c.querySelectorAll('.recharts-bar-rectangle path.recharts-rectangle'));

it("kind 'count': one accent bar per week with a value, zero weeks draw nothing", () => {
  const data: Row[] = [{ week: '2026-09-07', commits: 3, prs: 1 }, { week: '2026-09-21', commits: 5, prs: 2 }];
  const { container } = render(<TimelineChart data={data} weeks={weeks} valueKey="commits" kind="count" label="Commits / Week" syncId="t" />);
  expect(rects(container)).toHaveLength(2);
  rects(container).forEach(r => expect(r.getAttribute('fill')).toBe('var(--accent)'));
});

it("kind 'ratio' with isDefined: a present week with prs === 0 is a gap, not a 0 bar", () => {
  const data: Row[] = [
    { week: '2026-09-07', commits: 2, prs: 0, avg: 0 },
    { week: '2026-09-14', commits: 2, prs: 2, avg: 80 },
    { week: '2026-09-21', commits: 2, prs: 1, avg: 40 },
  ];
  const { container } = render(
    <TimelineChart data={data} weeks={weeks} valueKey="avg" kind="ratio" isDefined={d => d.prs > 0} label="Avg" suffix=" lines" syncId="t" />,
  );
  expect(rects(container)).toHaveLength(2);
});

it('the header shows the latest week with data and its change from the previous one', () => {
  const data: Row[] = [{ week: '2026-09-07', commits: 3, prs: 0 }, { week: '2026-09-14', commits: 5, prs: 0 }];
  render(<TimelineChart data={data} weeks={weeks} valueKey="commits" kind="count" label="Commits / Week" syncId="t" />);
  // Scoped by test id: y-axis tick text can also render a bare "5".
  expect(screen.getByTestId('timeline-latest').textContent).toBe('5');
  expect(screen.getByTestId('timeline-change').textContent).toBe('+2');
});

it('a downward change carries a minus sign, so direction is not shown by colour alone', () => {
  const data: Row[] = [{ week: '2026-09-07', commits: 5, prs: 0 }, { week: '2026-09-14', commits: 2, prs: 0 }];
  render(<TimelineChart data={data} weeks={weeks} valueKey="commits" kind="count" label="Commits / Week" syncId="t" />);
  expect(screen.getByTestId('timeline-change').textContent).toBe('−3');
});

it('string DECIMAL values render as numbers in the header', () => {
  const data: Row[] = [{ week: '2026-09-14', commits: 1, prs: 1, avg: '2.50' }];
  render(<TimelineChart data={data} weeks={weeks} valueKey="avg" kind="ratio" decimals={1} label="Avg Complexity" syncId="t" />);
  expect(screen.getByTestId('timeline-latest').textContent).toBe('2.5');
});

it('the hatch appears only with inFlightValue, and the in-flight segment uses it', () => {
  const data: Row[] = [{ week: '2026-09-14', commits: 5, prs: 0, types: { feature: 3, in_flight: 2 } }];
  const plain = render(<TimelineChart data={data} weeks={weeks} valueKey="commits" kind="count" label="C" syncId="t" />);
  expect(plain.container.querySelector('pattern')).toBeNull();
  plain.unmount();

  const { container } = render(
    <TimelineChart data={data} weeks={weeks} valueKey="commits" kind="count" label="C" syncId="t" inFlightValue={d => d.types?.in_flight ?? 0} />,
  );
  const pattern = container.querySelector('pattern')!;
  const fills = rects(container).map(r => r.getAttribute('fill'));
  expect(fills).toEqual(['var(--accent)', `url(#${pattern.id})`]);
});

it('in-flight larger than the week total is clamped: the stack is all hatch, never negative', () => {
  const data: Row[] = [{ week: '2026-09-14', commits: 2, prs: 0, types: { in_flight: 9 } }];
  const { container } = render(
    <TimelineChart data={data} weeks={weeks} valueKey="commits" kind="count" label="C" syncId="t" inFlightValue={d => d.types?.in_flight ?? 0} />,
  );
  const fills = rects(container).map(r => r.getAttribute('fill'));
  expect(fills).toHaveLength(1);
  expect(fills[0]).toMatch(/^url\(#hatch-/);
});

it('two instances on one page get different pattern ids', () => {
  const data: Row[] = [{ week: '2026-09-14', commits: 5, prs: 0, types: { in_flight: 2 } }];
  const { container } = render(
    <>
      <TimelineChart data={data} weeks={weeks} valueKey="commits" kind="count" label="A" syncId="t" inFlightValue={d => d.types?.in_flight ?? 0} />
      <TimelineChart data={data} weeks={weeks} valueKey="commits" kind="count" label="B" syncId="t" inFlightValue={d => d.types?.in_flight ?? 0} />
    </>,
  );
  const ids = Array.from(container.querySelectorAll('pattern')).map(p => p.id);
  expect(ids).toHaveLength(2);
  expect(ids[0]).not.toBe(ids[1]);
});

it('shows an explicit empty state when no week has data', () => {
  render(<TimelineChart data={[] as Row[]} weeks={weeks} valueKey="commits" kind="count" label="Commits / Week" syncId="t" />);
  expect(screen.getByText('No data in the last 90 days')).toBeTruthy();
});

it('shows the empty state, not a blank card, for an old report whose weeks are all outside the domain', () => {
  const data: Row[] = [{ week: '2025-01-06', commits: 7, prs: 1 }];
  const { container } = render(<TimelineChart data={data} weeks={weeks} valueKey="commits" kind="count" label="Commits / Week" syncId="t" />);
  expect(screen.getByText('No data in the last 90 days')).toBeTruthy();
  expect(container.querySelector('svg.recharts-surface')).toBeNull();
});

it('the tooltip shows the week, the value, and the shipped / in-flight split when present', () => {
  const row = { week: '2026-09-21', value: 5, shipped: 3, inFlight: 2 };
  const { container } = render(<TimelineTooltip active payload={[{ payload: row }] as never} split />);
  expect(screen.getByText('Sep 21')).toBeTruthy();
  expect(container.textContent).toContain('Shipped3');
  expect(container.textContent).toContain('In flight2');
});

it('the tooltip omits the split when the week has no in-flight work', () => {
  const row = { week: '2026-09-21', value: 5, shipped: 5, inFlight: 0 };
  const { container } = render(<TimelineTooltip active payload={[{ payload: row }] as never} split suffix="%" />);
  expect(container.textContent).toContain('5%');
  expect(container.textContent).not.toContain('In flight');
});

it('ratio: when the latest domain week fails isDefined, the header uses the last week that has data', () => {
  const data: Row[] = [
    { week: '2026-09-07', commits: 2, prs: 1, avg: 40 },
    { week: '2026-09-14', commits: 2, prs: 2, avg: 80 },
    { week: '2026-09-21', commits: 2, prs: 0, avg: 0 },
  ];
  render(<TimelineChart data={data} weeks={weeks} valueKey="avg" kind="ratio" isDefined={d => d.prs > 0} label="Avg" suffix=" lines" syncId="t" />);
  const latest = screen.getByTestId('timeline-latest').textContent;
  const change = screen.getByTestId('timeline-change').textContent;
  expect(latest).toBe('80 lines');
  expect(change).toBe('+40 lines');
  for (const t of [latest, change]) {
    expect(t).not.toBe('');
    expect(t).not.toContain('NaN');
  }
});

it('a negative in-flight value clamps to 0: no hatched segment, shipped bar identical to a chart without in-flight', () => {
  const data: Row[] = [{ week: '2026-09-14', commits: 5, prs: 0, types: { in_flight: -3 } }];
  const plain = render(<TimelineChart data={data} weeks={weeks} valueKey="commits" kind="count" label="C" syncId="t" />);
  const plainD = rects(plain.container).map(r => r.getAttribute('d'));
  plain.unmount();

  const { container } = render(
    <TimelineChart data={data} weeks={weeks} valueKey="commits" kind="count" label="C" syncId="t" inFlightValue={d => d.types?.in_flight ?? 0} />,
  );
  const drawn = rects(container);
  expect(drawn.map(r => r.getAttribute('fill'))).toEqual(['var(--accent)']);
  // Same geometry (height and rounded top) as the plain chart, so shipped is still the full 5.
  expect(drawn.map(r => r.getAttribute('d'))).toEqual(plainD);
});
