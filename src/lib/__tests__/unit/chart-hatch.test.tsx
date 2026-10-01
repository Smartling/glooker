/** @jest-environment jsdom */
import React from 'react';
import { render } from '@testing-library/react';
import { HatchSwatch, useHatch } from '@/components/charts/hatch';

function Probe({ colorVar }: { colorVar: string }) {
  const hatch = useHatch(colorVar);
  return (
    <svg data-fill={hatch.fill}>
      {hatch.defs}
    </svg>
  );
}

it('gives each instance its own DOM-safe pattern id, and fill references it', () => {
  const { container } = render(<><Probe colorVar="var(--accent)" /><Probe colorVar="var(--chart-type-in-flight)" /></>);
  const patterns = Array.from(container.querySelectorAll('pattern'));
  expect(patterns).toHaveLength(2);
  const [a, b] = patterns.map(p => p.id);
  expect(a).not.toBe(b);
  patterns.forEach(p => expect(p.id).toMatch(/^hatch-[A-Za-z0-9_-]+$/));
  const fills = Array.from(container.querySelectorAll('svg[data-fill]')).map(s => s.getAttribute('data-fill'));
  expect(fills).toEqual([`url(#${a})`, `url(#${b})`]);
});

it('draws stripes in the given colour over an explicit surface background, never transparent', () => {
  const { container } = render(<Probe colorVar="var(--accent)" />);
  const rect = container.querySelector('pattern rect') as SVGRectElement;
  const line = container.querySelector('pattern line') as SVGLineElement;
  expect(rect.style.fill).toBe('var(--chart-surface)');
  expect(line.style.stroke).toBe('var(--accent)');
});

it('HatchSwatch is a self-contained hatched square for HTML legends', () => {
  const { container } = render(<HatchSwatch colorVar="var(--chart-type-in-flight)" />);
  const pattern = container.querySelector('pattern')!;
  const filled = container.querySelector('svg > rect')!;
  expect(filled.getAttribute('fill')).toBe(`url(#${pattern.id})`);
  expect(container.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
});
