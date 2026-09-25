/** @jest-environment jsdom */
// GLOOK-58 final review: the spec's Risks section promises that every chart on a page renders the
// exact same week domain, because they all share one `weeks` array and Recharts' syncId hover sync
// matches by array INDEX. chart-format.test.ts's old guard compared recentWeekDomain(now) with
// itself, which can't fail — it never rendered a chart, so a chart that quietly built its own
// domain from its own `data` instead of the passed `weeks` prop would still pass it.
//
// This renders three real charts from one shared domain and checks what a user would actually
// see: the same number of categories, with data landing on the same first/last category in every
// chart. It deliberately does NOT read x-axis tick text or count rendered ticks — a first attempt
// did, and found only 1 of 5 ticks rendered in jsdom (Recharts' `interval="preserveEnd"` culls
// ticks using text-width math, and jsdom's getComputedTextLength/getBoundingClientRect always
// return 0). That's exactly what this repo's own testing convention warns about (see the spec's
// Testing section: "jsdom has no SVG text layout... they never assert on tick counts, tick
// positions, or label placement"), so tick-based assertions would be flaky by construction, not a
// real signal. Instead this reads the Bar rectangles directly: every Bar in a chart shares that
// chart's `data` array 1:1, so the first Bar's rectangle-wrapper count IS the category count
// (jsdom-safe DOM-node counting, no text layout involved), and "does this wrapper contain a
// rendered <path>" is a value check (present vs. absent), not a pixel position — which is also
// why this doesn't hit the "y-axis width differs between charts" pixel-x problem.
import React from 'react';
import { render } from '@testing-library/react';
import { TimelineChart } from '@/components/charts/timeline-chart';
import { StackedTypesChart } from '@/components/charts/stacked-types-chart';
import { LinesChangedChart } from '@/components/charts/lines-changed-chart';
import { fixChartSize } from '../setup/chart-size';

fixChartSize();

// A first Bar's category slots, in the same order as `weeks`, for whichever chart rendered it.
function categorySlots(container: HTMLElement): boolean[] {
  const firstBar = container.querySelector('.recharts-bar');
  if (!firstBar) return [];
  return Array.from(firstBar.querySelectorAll('.recharts-bar-rectangle')).map(g => g.querySelector('path') !== null);
}

const weeks = ['2026-08-24', '2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21'];
// Real, non-zero data on the first Bar's series in the first and last week only — the middle
// three weeks are the real-world case this domain alignment matters for: a chart that fell back
// to its own data-derived domain would shrink to just 2 categories instead of the shared 5, and a
// chart that mis-aligned the shared domain would land that data on the wrong slot.
const timelineData = [
  { week: '2026-08-24', commits: 5, prs: 1 },
  { week: '2026-09-21', commits: 7, prs: 2 },
];
// StackedTypesChart's first rendered <Bar> is whichever COMMIT_TYPE_ORDER type is present; using
// the same type ('feature') at both ends keeps that same Bar the one carrying both edge values.
const stackedData = [
  { week: '2026-08-24', types: { feature: 3 } },
  { week: '2026-09-21', types: { feature: 2 } },
];
// LinesChangedChart's first rendered <Bar> is "added".
const linesData = [
  { week: '2026-08-24', linesP95Added: 100, linesP95Removed: 20 },
  { week: '2026-09-21', linesP95Added: 80, linesP95Removed: 30 },
];

it.each([
  ['TimelineChart', () => render(
    <TimelineChart data={timelineData} weeks={weeks} valueKey="commits" kind="count" label="Commits / Week" syncId="align" />,
  )],
  ['StackedTypesChart', () => render(<StackedTypesChart data={stackedData} weeks={weeks} />)],
  ['LinesChangedChart', () => render(<LinesChangedChart data={linesData} weeks={weeks} syncId="align" />)],
] as const)('%s renders the exact same shared week domain, not its own data-derived one', (_name, renderChart) => {
  const { container } = renderChart();
  const slots = categorySlots(container);
  expect(slots).toHaveLength(weeks.length); // one category per shared-domain week, not per own data
  expect(slots[0]).toBe(true); // week[0]'s real value landed on category 0
  expect(slots[slots.length - 1]).toBe(true); // week[last]'s real value landed on the last category
  expect(slots.slice(1, -1).every(hasValue => !hasValue)).toBe(true); // the untouched middle weeks stayed empty
});
