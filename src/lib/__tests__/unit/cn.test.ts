import { cn } from '@/lib/cn';

it('joins truthy classes and drops falsy ones', () => {
  expect(cn('a', false && 'b', undefined, 'c')).toBe('a c');
});

it('lets a later conflicting utility win', () => {
  expect(cn('px-2', 'px-4')).toBe('px-4');
});

it('keeps a font-size and a chart colour together (different groups, both survive)', () => {
  expect(cn('text-xs', 'text-chart-axis')).toBe('text-xs text-chart-axis');
});
