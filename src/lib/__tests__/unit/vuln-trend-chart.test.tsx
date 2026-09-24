/** @jest-environment jsdom */
// src/lib/__tests__/unit/vuln-trend-chart.test.tsx
import React from 'react';
import { render } from '@testing-library/react';
import TrendChart from '@/app/vulnerabilities/trend-chart';
import type { TrendSeries } from '@/lib/vulnerabilities/aggregate';

// only the top 4 teams used to get a colour (trend-chart.tsx's old `COLORS` constant), so
// with 11+ teams seven-plus grey lines couldn't be told apart. Now ranks 1-12 (by current/latest
// open count, descending, same ranking as before) each get a distinct colour from a CSS custom
// property, and rank 13+ shares the grey "other" colour. Distinct `open` values per series avoid
// ties, so the rank order is unambiguous.
function series(n: number): TrendSeries[] {
  return Array.from({ length: n }, (_, i) => ({
    team: `Team${i + 1}`,
    points: [{ date: '2026-09-01', open: 100 - i }],
  }));
}

it('ranks 1-12 get distinct --vuln-series-N strokes/fills, rank 13 gets --vuln-series-other', () => {
  const { container } = render(<TrendChart series={series(13)} />);
  const polylines = Array.from(container.querySelectorAll('polyline')) as SVGPolylineElement[];
  expect(polylines).toHaveLength(13);
  polylines.forEach((p, i) => {
    const expected = i < 12 ? `var(--vuln-series-${i + 1})` : 'var(--vuln-series-other)';
    expect(p.style.stroke).toBe(expected);
    // Presentation attributes don't reliably resolve var() — the colour must be on style, not
    // a bare `stroke="var(...)"` attribute.
    expect(p.getAttribute('stroke') ?? '').not.toContain('var(');
  });

  const circles = Array.from(container.querySelectorAll('circle')) as SVGCircleElement[];
  expect(circles).toHaveLength(13);
  circles.forEach((c, i) => {
    const expected = i < 12 ? `var(--vuln-series-${i + 1})` : 'var(--vuln-series-other)';
    expect(c.style.fill).toBe(expected);
  });

  // The legend spans (one per series, in the same ranked order) carry the same colours.
  const legendSpans = Array.from(container.querySelectorAll('span[style]')) as HTMLSpanElement[];
  expect(legendSpans).toHaveLength(13);
  legendSpans.forEach((s, i) => {
    const expected = i < 12 ? `var(--vuln-series-${i + 1})` : 'var(--vuln-series-other)';
    expect(s.style.color).toBe(expected);
  });
});

// Axis counts and dates are 9px text. A hardcoded #6b7280 measured 3.96:1 on the dark theme
// bodies, under the 4.5:1 text bar. They now use var(--vuln-series-other), which
// vuln-series-contrast.test.ts checks against every theme body in both modes.
it('axis counts and date labels use the contrast-checked --vuln-series-other colour', () => {
  const { container } = render(<TrendChart series={series(2)} />);
  // Scoped to the axis labels, so other on-chart text added later isn't forced into this grey.
  const texts = Array.from(container.querySelectorAll('svg text[data-role="axis"]')) as SVGTextElement[];
  expect(texts).toHaveLength(5); // 3 gridline counts + first and last date
  texts.forEach(t => {
    expect(t.style.fill).toBe('var(--vuln-series-other)');
    expect(t.getAttribute('fill')).toBeNull();
  });
});
