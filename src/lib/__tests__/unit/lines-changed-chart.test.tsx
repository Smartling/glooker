/** @jest-environment jsdom */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { LinesChangedChart, LinesTooltip, buildLinesRows } from '@/components/charts/lines-changed-chart';
import { fixChartSize } from '../setup/chart-size';

fixChartSize();

const weeks = ['2026-09-07', '2026-09-14', '2026-09-21'];
const rectsWithFill = (c: HTMLElement, fill: RegExp) =>
  Array.from(c.querySelectorAll('.recharts-bar-rectangle path.recharts-rectangle')).filter(r => fill.test(r.getAttribute('fill') ?? ''));
const extent = (r: Element) => {
  const y = Number(r.getAttribute('y'));
  const h = Number(r.getAttribute('height'));
  return [Math.min(y, y + h), Math.max(y, y + h)];
};

it('draws removed lines below the zero baseline and added lines above it', () => {
  const data = [
    { week: '2026-09-07', linesP95Added: 120, linesP95Removed: 40 },
    { week: '2026-09-14', linesP95Added: '80', linesP95Removed: '60' },
  ];
  const { container } = render(<LinesChangedChart data={data} weeks={weeks} />);
  const zero = container.querySelector('.recharts-reference-line line')!;
  expect(zero.getAttribute('stroke')).toBe('var(--chart-axis)');
  const zeroY = Number(zero.getAttribute('y1'));

  const removed = rectsWithFill(container, /^var\(--chart-lines-removed\)$/);
  const added = rectsWithFill(container, /^var\(--chart-lines-added\)$/);
  expect(removed).toHaveLength(2);
  expect(added).toHaveLength(2);
  removed.forEach(r => {
    const [top, bottom] = extent(r);
    expect(top).toBeGreaterThanOrEqual(zeroY - 0.5);
    expect(bottom).toBeGreaterThan(zeroY);
  });
  added.forEach(r => {
    const [top, bottom] = extent(r);
    expect(bottom).toBeLessThanOrEqual(zeroY + 0.5);
    expect(top).toBeLessThan(zeroY);
  });
});

it('GLOOK-58 fix round 1: a short in-flight segment on either side still gets a legible floor, but a zero-in-flight week stays hatch-free', () => {
  const data = [
    // Added side: a large shipped total with a tiny in-flight sliver on top.
    { week: '2026-09-07', linesP95Added: 5000, linesP95Removed: 40, inFlightLinesP95Added: 1 },
    // Removed side: same shape, mirrored (inFlightRemoved is negative once built).
    { week: '2026-09-14', linesP95Added: 80, linesP95Removed: 5000, inFlightLinesP95Removed: 1 },
    // No in-flight at all, despite large shipped values on both sides.
    { week: '2026-09-21', linesP95Added: 3000, linesP95Removed: 3000 },
  ];
  const { container } = render(<LinesChangedChart data={data} weeks={weeks} />);
  const hatched = rectsWithFill(container, /^url\(#hatch-/);
  // Exactly two hatch rects (one per in-flight week), each floored to a legible height — proof
  // minPointSize is reading each row's own in-flight value, not the stack's cumulative top.
  // The removed-side rect's `height` is negative (it extends downward from the baseline); its
  // magnitude is what must be legible.
  expect(hatched).toHaveLength(2);
  hatched.forEach(r => expect(Math.abs(Number(r.getAttribute('height')))).toBeGreaterThanOrEqual(4));
});

it('hatches the in-flight part of each side and lists it in the legend only when present', () => {
  const data = [{ week: '2026-09-14', linesP95Added: 50, linesP95Removed: 20, inFlightLinesP95Added: 30, inFlightLinesP95Removed: 10 }];
  const { container } = render(<LinesChangedChart data={data} weeks={weeks} />);
  expect(rectsWithFill(container, /^url\(#hatch-/)).toHaveLength(2);
  expect(screen.getByText('In flight')).toBeTruthy();
});

it('omits the in-flight legend entry when nothing is in flight', () => {
  render(<LinesChangedChart data={[{ week: '2026-09-14', linesP95Added: 5, linesP95Removed: 5 }]} weeks={weeks} />);
  expect(screen.queryByText('In flight')).toBeNull();
});

it('shows an explicit empty state when every week is zero', () => {
  render(<LinesChangedChart data={[{ week: '2026-09-14', linesP95Added: 0, linesP95Removed: '0' }]} weeks={weeks} />);
  expect(screen.getByText('No line changes in the 90 days before this report')).toBeTruthy();
});

it('shows the empty state for an old report whose weeks are all outside the domain', () => {
  render(<LinesChangedChart data={[{ week: '2025-01-06', linesP95Added: 90, linesP95Removed: 10 }]} weeks={weeks} />);
  expect(screen.getByText('No line changes in the 90 days before this report')).toBeTruthy();
});

it('the tooltip shows added, removed, in-flight and total for the week', () => {
  const row = { week: '2026-09-14', added: 50, inFlightAdded: 30, removed: -20, inFlightRemoved: -10 };
  const { container } = render(<LinesTooltip active payload={[{ payload: row }] as never} />);
  expect(container.textContent).toContain('+50 added');
  expect(container.textContent).toContain('+30 added in flight');
  expect(container.textContent).toContain('−20 removed');
  expect(container.textContent).toContain('−10 removed in flight');
  // Total is churn (added + removed as magnitudes), matching the card title "Lines
  // Changed / Week": 50 + 30 + 20 + 10 = 110, not the net change of 50.
  expect(container.textContent).toContain('110 total');
});

it('the tooltip total is churn, never negative, even when removed exceeds added', () => {
  // buildLinesRows() is LinesChangedChart's own row builder — the real pipeline, not a
  // hand-built row — so this exercises the actual toNum()+negate step together with the
  // tooltip's Math.abs() in one path. Recharts never activates its tooltip on a synthetic
  // jsdom mouse event (confirmed: the wrapper stays visibility:hidden), so this is the way
  // to drive the real row-building code into the real tooltip component.
  const data = [{ week: '2026-09-14', linesP95Added: 20, linesP95Removed: 60 }];
  const row = buildLinesRows(data, weeks).find(r => r.week === '2026-09-14')!;
  expect(row.added).toBe(20);
  expect(row.removed).toBe(-60);

  const { container } = render(<LinesTooltip active payload={[{ payload: row }] as never} />);
  expect(container.textContent).toContain('+20 added');
  expect(container.textContent).toContain('−60 removed');
  expect(container.textContent).toContain('80 total');
  expect(container.textContent).not.toMatch(/−\d+ total/);
});

describe('Decision 15: measured weeks', () => {
  it('buildLinesRows marks each row measured from its data or the covered set, keeping values numeric', () => {
    const rows = buildLinesRows([{ week: '2026-09-21', linesP95Added: 5, linesP95Removed: 1 }], weeks, new Set(['2026-09-07']));
    expect(rows.map(r => r.measured)).toEqual([true, false, true]);
    expect(rows.map(r => r.added)).toEqual([0, 0, 5]);
  });

  it('buildLinesRows with no covered set marks every week measured', () => {
    expect(buildLinesRows([], weeks).map(r => r.measured)).toEqual([true, true, true]);
  });

  it('the lines tooltip reads "Not measured", not zero counts, for an unmeasured week', () => {
    const row = buildLinesRows([], weeks, new Set<string>())[0];
    const { container } = render(<LinesTooltip active payload={[{ payload: row }] as never} />);
    expect(container.textContent).toContain('Sep 7');
    expect(container.textContent).toContain('Not measured');
    expect(container.textContent).not.toContain('added');
    expect(container.textContent).not.toContain('total');
  });
});
