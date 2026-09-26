/** @jest-environment jsdom */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { buildTimelineRows, TimelineChart, TimelineTooltip } from '@/components/charts/timeline-chart';
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
  expect(screen.getByText('No data in the 90 days before this report')).toBeTruthy();
});

it('shows the empty state, not a blank card, for an old report whose weeks are all outside the domain', () => {
  const data: Row[] = [{ week: '2025-01-06', commits: 7, prs: 1 }];
  const { container } = render(<TimelineChart data={data} weeks={weeks} valueKey="commits" kind="count" label="Commits / Week" syncId="t" />);
  expect(screen.getByText('No data in the 90 days before this report')).toBeTruthy();
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

it('GLOOK-58 fix round 1: a short in-flight segment still gets a legible floor, but a zero-in-flight week stays hatch-free', () => {
  const data: Row[] = [
    { week: '2026-09-14', commits: 200, prs: 0, types: { in_flight: 1 } },
    { week: '2026-09-21', commits: 11, prs: 0, types: { in_flight: 0 } },
  ];
  const { container } = render(
    <TimelineChart data={data} weeks={weeks} valueKey="commits" kind="count" label="C" syncId="t" inFlightValue={d => d.types?.in_flight ?? 0} />,
  );
  const drawn = rects(container);
  const hatched = drawn.filter(r => (r.getAttribute('fill') ?? '').startsWith('url(#hatch-'));
  // Exactly one hatch rect: the 1-in-flight week's, floored to a legible height. The 0-in-flight
  // week draws no hatch rect at all, even though its own shipped value (11) is well above zero —
  // proof minPointSize is reading this row's own in-flight value, not the stack's cumulative top.
  expect(hatched).toHaveLength(1);
  expect(Number(hatched[0].getAttribute('height'))).toBeGreaterThanOrEqual(4);
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

describe('Decision 15: measured weeks', () => {
  it('buildTimelineRows marks each row measured from its data or the covered set, keeping values numeric', () => {
    const data: Row[] = [{ week: '2026-09-21', commits: 5, prs: 2 }];
    const { rows } = buildTimelineRows(weeks, data, { value: d => d.commits, kind: 'count', covered: new Set(['2026-09-07']) });
    expect(rows.map(r => r.measured)).toEqual([false, true, false, true]);
    expect(rows.map(r => r.value)).toEqual([0, 0, 0, 5]);
  });

  it('buildTimelineRows with no covered set marks every week measured (the pre-Decision-15 behavior)', () => {
    // Any caller that passes no coveredWeeks relies on this, e.g. chart-domain-alignment.test.tsx.
    const data: Row[] = [{ week: '2026-09-21', commits: 5, prs: 2 }];
    const { rows } = buildTimelineRows(weeks, data, { value: d => d.commits, kind: 'count' });
    expect(rows.map(r => r.measured)).toEqual([true, true, true, true]);
    expect(rows.map(r => r.value)).toEqual([0, 0, 0, 5]);
  });

  it('the tooltip reads "Not measured", not a value, for an unmeasured week', () => {
    const row = { week: '2026-08-31', value: 0, shipped: 0, inFlight: 0, measured: false };
    const { container } = render(<TimelineTooltip active payload={[{ payload: row }] as never} split />);
    expect(container.textContent).toContain('Aug 31');
    expect(container.textContent).toContain('Not measured');
    expect(container.textContent).not.toContain('0');
  });

  it('the tooltip still shows a measured zero as 0', () => {
    const row = { week: '2026-09-14', value: 0, shipped: 0, inFlight: 0, measured: true };
    const { container } = render(<TimelineTooltip active payload={[{ payload: row }] as never} />);
    expect(container.textContent).toContain('0');
    expect(container.textContent).not.toContain('Not measured');
  });

  it("a real unmeasured row from the chart's own builder reaches the tooltip as \"Not measured\"", () => {
    const data: Row[] = [{ week: '2026-09-21', commits: 5, prs: 2 }];
    const { rows } = buildTimelineRows(weeks, data, { value: d => d.commits, kind: 'count', covered: new Set<string>() });
    const { container } = render(<TimelineTooltip active payload={[{ payload: rows[0] }] as never} />);
    expect(container.textContent).toContain('Not measured');
  });
});

describe('Decision 15: only shipped work proves a week measured (in-flight-only weeks)', () => {
  // The org page's overlay bucket for a week with only in-flight commits: commits and types.in_flight
  // both count the in-flight commits, and prs is 0.
  const inFlightOnly: Row = { week: '2026-09-21', commits: 3, prs: 0, types: { in_flight: 3 } };
  const shipped: Row = { week: '2026-09-14', commits: 5, prs: 2 };
  const inFlight = (d: Row) => d.types?.in_flight ?? 0;

  it('an uncovered in-flight-only week is unmeasured, and its tooltip says shipped work was not measured, with the in-flight count', () => {
    const { rows } = buildTimelineRows(weeks, [shipped, inFlightOnly], {
      value: d => d.commits, kind: 'count', inFlightValue: inFlight, covered: new Set<string>(),
    });
    const row = rows[3];
    expect(row.measured).toBe(false);
    expect(row.inFlight).toBe(3); // the hatch still draws
    const { container } = render(<TimelineTooltip active payload={[{ payload: row }] as never} split />);
    expect(container.textContent).toContain('Sep 21');
    expect(container.textContent).toContain('Not measured');
    expect(container.textContent).toContain('In flight3');
  });

  it('a chart with no in-flight layer (PRs / Week) shows plain "Not measured" for that week, never a proven 0', () => {
    const { rows } = buildTimelineRows(weeks, [shipped, inFlightOnly], { value: d => d.prs, kind: 'count', covered: new Set<string>() });
    const { container } = render(<TimelineTooltip active payload={[{ payload: rows[3] }] as never} />);
    expect(container.textContent).toBe('Sep 21Not measured');
  });

  it('a COVERED in-flight-only week is measured and shows its shipped 0 and in-flight part', () => {
    const { rows } = buildTimelineRows(weeks, [shipped, inFlightOnly], {
      value: d => d.commits, kind: 'count', inFlightValue: inFlight, covered: new Set(['2026-09-21']),
    });
    expect(rows[3]).toMatchObject({ measured: true, value: 3, shipped: 0, inFlight: 3 });
    const { container } = render(<TimelineTooltip active payload={[{ payload: rows[3] }] as never} split />);
    expect(container.textContent).not.toContain('Not measured');
    expect(container.textContent).toContain('Shipped0');
    expect(container.textContent).toContain('In flight3');
  });

  it('the header never headlines an uncovered in-flight-only final week: latest and change come from measured weeks', () => {
    const data: Row[] = [{ week: '2026-09-07', commits: 4, prs: 1 }, shipped, inFlightOnly];
    render(<TimelineChart data={data} weeks={weeks} coveredWeeks={[]} valueKey="prs" kind="count" label="PRs / Week" syncId="t" />);
    // Without the rule the header would read 0 (the in-flight-only week's prs) and "−2".
    expect(screen.getByTestId('timeline-latest').textContent).toBe('2');
    expect(screen.getByTestId('timeline-change').textContent).toBe('+1');
  });

  it('a chart whose only data is uncovered in-flight still draws (no empty state) but headlines nothing', () => {
    const { container } = render(
      <TimelineChart data={[inFlightOnly]} weeks={weeks} coveredWeeks={[]} valueKey="commits" kind="count"
        label="Commits / Week" inFlightValue={inFlight} syncId="t" />,
    );
    expect(container.textContent).not.toContain('No data in the 90 days before this report');
    expect(screen.queryByTestId('timeline-latest')).toBeNull();
  });
});
